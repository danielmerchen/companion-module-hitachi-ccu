import test from 'node:test'
import assert from 'node:assert/strict'
import { Host } from './host-sim.js'
import { MockCcu, sleep, waitFor } from './mock-ccu.js'

async function boot(mockOpts = {}, cfg = {}) {
	const ccu = new MockCcu(mockOpts)
	const port = await ccu.listen()
	const host = new Host()
	const init = await host.start({ host: '127.0.0.1', port, pollMs: 250, takeOnConnect: false, ...cfg })
	assert.ok(init.ok, 'init succeeded: ' + JSON.stringify(init))
	return { ccu, host, port, done: async () => (await host.stop(), ccu.close()) }
}

const EXPECTED_ACTIONS = [
	'power_on',
	'power_off',
	'power_toggle',
	'take',
	'iris_set',
	'iris_step',
	'iris_fstop_set',
	'iris_fstop_step',
	'auto_hold_start',
	'auto_hold_cancel',
	'power_hold_start',
	'preset_hold_start',
	'master_black_set',
	'master_black_step',
	'refresh',
]
const EXPECTED_VARS = [
	'link_status',
	'power',
	'iris',
	'iris_pct',
	'iris_mode',
	'iris_follow',
	'iris_follow_pct',
	'iris_fstop',
	'master_black',
	'extender',
	'cam_alarm',
	'fiber_link',
	'fiber_raw',
	'auto_result',
]

test('module registers, declares actions/variables/feedbacks/presets, and reports Ok', { timeout: 15000 }, async () => {
	const { host, done } = await boot()
	await waitFor(() => host.status?.status === 'ok')

	const actions = Object.keys(host.actions)
	assert.deepEqual([...actions].sort(), [...EXPECTED_ACTIONS].sort())
	const vars = Object.keys(host.varDefs)
	assert.deepEqual([...vars].sort(), [...EXPECTED_VARS].sort())
	const feedbacks = Object.keys(host.feedbackDefs)
	for (const f of [
		'power_state',
		'link_ok',
		'iris_mode_is',
		'iris_compare',
		'master_black_compare',
		'iris_text',
		'master_black_text',
		'iris_fstop_text',
		'alarm_active',
		'extender_is',
		'extender_text',
		'cam_alarm_text',
		'fiber_is',
		'fiber_text',
		'auto_hold',
		'preset_hold',
	])
		assert.ok(feedbacks.includes(f), `feedback ${f} declared`)

	// Every preset must reference actions/feedbacks that exist, and be listed in the v2 structure.
	const ids = Object.keys(host.presets)
	assert.ok(ids.length >= 12)
	for (const sec of host.structure) {
		for (const title of [sec.name, ...sec.definitions.map((g) => g.name)])
			assert.ok(
				title.split(' ').every((w) => /^[A-Z]/.test(w)),
				`section title "${title}" is Title Case`,
			)
	}
	const listed = host.structure.flatMap((sec) => sec.definitions.flatMap((g) => g.presets))
	assert.deepEqual([...listed].sort(), [...ids].sort(), 'every preset appears exactly once in the structure')
	const localRefs = (v) => [...JSON.stringify(v).matchAll(/\$\(local:(\w+)\)/g)].map((m) => m[1])
	for (const [id, p] of Object.entries(host.presets)) {
		assert.ok(['simple', 'layered'].includes(p.type), `${id} type`)
		for (const step of p.steps)
			for (const k of ['down', 'up', 'rotate_left', 'rotate_right'])
				for (const a of step[k] ?? []) {
					assert.ok(actions.includes(a.actionId), `${id}: ${a.actionId}`)
					assert.ok(a.options && typeof a.options === 'object', `${id}: ${a.actionId} options`)
				}
		for (const f of p.feedbacks) {
			assert.ok(feedbacks.includes(f.feedbackId), `${id}: ${f.feedbackId}`)
			const type = host.feedbackDefs[f.feedbackId].type
			if (p.type === 'simple') {
				if (type === 'boolean') assert.ok(f.style, `${id}: boolean feedback ${f.feedbackId} needs a style`)
				else assert.equal(f.style, undefined, `${id}: ${f.feedbackId} must not carry a style`)
			} else {
				assert.equal(type, 'boolean', `${id}: layered presets use boolean feedbacks for overrides`)
				assert.ok(f.styleOverrides?.length, `${id}: ${f.feedbackId} needs styleOverrides`)
			}
		}
		if (p.type !== 'layered') continue
		// Layered presets: unique element ids, every $(local:x) is declared and driven by a value feedback, overrides hit real elements.
		const ids2 = []
		const walk = (els) => els.forEach((e) => (ids2.push(e.id), e.children && walk(e.children)))
		walk(p.elements)
		assert.equal(new Set(ids2).size, ids2.length, `${id}: element ids are unique`)
		const locals = Object.fromEntries((p.localVariables ?? []).map((l) => [l.variableName, l]))
		for (const l of Object.values(locals)) {
			assert.equal(l.variableType, 'feedback', `${id}.${l.variableName}`)
			assert.equal(
				host.feedbackDefs[l.feedbackId]?.type,
				'value',
				`${id}.${l.variableName} is driven by a value feedback`,
			)
		}
		for (const ref of localRefs(p.elements)) assert.ok(locals[ref], `${id}: $(local:${ref}) is declared`)
		for (const l of Object.keys(locals)) assert.ok(localRefs(p.elements).includes(l), `${id}: local ${l} is used`)
		for (const f of p.feedbacks)
			for (const o of f.styleOverrides) assert.ok(ids2.includes(o.elementId), `${id}: override targets ${o.elementId}`)
		// fontsize is a percentage of the text element's height: anything small renders tiny (a bug we shipped once).
		for (const e of p.elements.filter((x) => x.type === 'text')) {
			assert.ok(
				e.fontsize >= 60 && e.fontsize <= 200,
				`${id}: text ${e.id} fontsize ${e.fontsize} should be 60-200 (% of element height)`,
			)
			assert.equal(e.fontsizeAllowShrink, true, `${id}: text ${e.id} must shrink to fit`)
		}
		// Per Companion: symmetric = fill grows OUTWARD both ways from the origin (stereo width); a bipolar value like master black wants false.
		for (const e of p.elements.filter((x) => x.type === 'gauge' && x.origin !== undefined))
			assert.ok(
				e.origin >= e.min && e.origin <= e.max && e.symmetric === false,
				`${id}: bipolar gauge ${e.id} must grow from the origin (symmetric: false)`,
			)
		for (const e of p.elements.filter((x) => x.type === 'gauge'))
			assert.ok(e.min < e.max && e.value?.isExpression, `${id}: gauge ${e.id} has a range and a bound value`)
	}
	// StreamDeck+ knobs: turning steps, pushing resets.
	const knobs = ids.filter((i) => i.startsWith('knob_'))
	assert.ok(knobs.length >= 5)
	for (const k of knobs) {
		const step = host.presets[k].steps[0]
		assert.equal(step.rotate_right.length, 1, `${k} rotate_right`)
		assert.equal(step.rotate_left.length, 1, `${k} rotate_left`)
		assert.equal(step.down.length, 1, `${k} push`)
	}
	await done()
})

test(
	'variables are filled from the CCU readback (power, IRIS, Master Black, lens position)',
	{ timeout: 15000 },
	async () => {
		const { host, done } = await boot()
		await waitFor(() => host.vars.iris_follow === 61)
		assert.equal(host.vars.link_status, 'Connected')
		assert.equal(host.vars.power, 'ON')
		assert.equal(host.vars.iris, 0)
		assert.equal(host.vars.iris_pct, 50)
		assert.equal(host.vars.iris_mode, 'REMOTE')
		assert.equal(host.vars.master_black, -13)
		assert.equal(host.vars.iris_follow_pct, 100)
		assert.equal(host.vars.iris_fstop, '6.1')
		assert.deepEqual(
			host.logs.filter((l) => l.level === 'error'),
			[],
		)
		await done()
	},
)

test('feedbacks evaluate correctly and update when values change', { timeout: 15000 }, async () => {
	const { host, ccu, done } = await boot()
	await waitFor(() => host.vars.master_black === -13)
	await host.subscribeFeedbacks([
		['f_on', 'power_state', { state: 'on' }],
		['f_off', 'power_state', { state: 'off' }],
		['f_link', 'link_ok', {}],
		['f_auto', 'iris_mode_is', { mode: 'AUTO' }],
		['f_remote', 'iris_mode_is', { mode: 'REMOTE' }],
		['f_mb', 'master_black_compare', { op: 'lt', value: 0 }],
		['f_iris_gt', 'iris_compare', { op: 'gt', value: 10 }],
		['f_text', 'iris_text', { label: 'IRIS' }],
		['f_mbtext', 'master_black_text', { label: 'M.BLACK' }],
	])
	await waitFor(() => Object.keys(host.fbValues).length === 9)
	const v = host.fbValues
	assert.equal(v.f_on, true)
	assert.equal(v.f_off, false)
	assert.equal(v.f_link, true)
	assert.equal(v.f_auto, false)
	assert.equal(v.f_remote, true)
	assert.equal(v.f_mb, true) // -13 < 0
	assert.equal(v.f_iris_gt, false)
	assert.deepEqual(v.f_text, { text: 'IRIS\n0' })
	assert.deepEqual(v.f_mbtext, { text: 'M.BLACK\n-13' })

	// A value change on the CCU side (e.g. someone moves the RCP) flows through.
	ccu.push([0x32, 0x2e, 0x30, 0x00])
	await waitFor(() => host.fbValues.f_iris_gt === true && host.fbValues.f_text?.text === 'IRIS\n48')
	assert.equal(host.vars.iris, 48)
	await done()
})

test(
	'actions: power, set and step IRIS / Master Black reach the CCU and update readbacks',
	{ timeout: 20000 },
	async () => {
		const { host, ccu, done } = await boot()
		await waitFor(() => host.vars.power === 'ON' && host.vars.iris === 0)
		await host.subscribeFeedbacks([['f_on', 'power_state', { state: 'on' }]])
		await waitFor(() => host.fbValues.f_on === true)

		let r = await host.execute('power_off')
		assert.ok(r.ok)
		await waitFor(() => ccu.count([0x20, 0x22, 0x00, 0xfe]) === 1)
		await waitFor(() => host.vars.power === 'OFF')
		await waitFor(() => host.fbValues.f_on === false) // feedback follows the readback

		r = await host.execute('iris_set', { value: 25 })
		assert.ok(r.ok)
		await waitFor(() => ccu.state.iris === 25 && host.vars.iris === 25)
		assert.equal(host.vars.iris_pct, Math.round((153 / 255) * 100))

		await host.execute('master_black_step', { delta: -3 })
		await waitFor(() => ccu.state.masterBlack === -16 && host.vars.master_black === -16)

		await host.execute('iris_step', { delta: 4 })
		await host.execute('iris_step', { delta: 4 }) // rapid presses accumulate
		await waitFor(() => ccu.state.iris === 33 && host.vars.iris === 33)

		await host.execute('take')
		await waitFor(() => ccu.count([0x08, 0x00, 0xff]) === 1)
		assert.deepEqual(
			host.logs.filter((l) => l.level === 'error'),
			[],
		)
		await done()
	},
)

test('extender / alarm variables and feedbacks', { timeout: 15000 }, async () => {
	const { host, ccu, done } = await boot({ state: { extender: 1, camAlarm: 0 } })
	await waitFor(() => host.vars.extender === 'x2' && host.vars.cam_alarm === 'OK')
	assert.equal(host.vars.auto_result, '-')
	await host.subscribeFeedbacks([
		['f_alarm', 'alarm_active', {}],
		['f_ext', 'extender_is', { mode: 'x2' }],
		['f_text', 'cam_alarm_text', { label: 'ALARM' }],
	])
	await waitFor(() => Object.keys(host.fbValues).length === 3)
	assert.equal(host.fbValues.f_alarm, false)
	assert.equal(host.fbValues.f_ext, true)
	assert.deepEqual(host.fbValues.f_text, { text: 'ALARM\nOK' })
	ccu.push([0x12, 0x13, 0x02])
	await waitFor(() => host.fbValues.f_alarm === true && host.vars.cam_alarm === 'HEAD TEMP')
	assert.equal(host.fbValues.f_text.text, 'ALARM\nHEAD TEMP')
	assert.ok(host.fbValues.f_text.bgcolor)
	await done()
})

test(
	'auto function needs a full 5 s hold: early release sends nothing, full hold sends once and shows the result',
	{ timeout: 30000 },
	async () => {
		const { host, ccu, done } = await boot()
		await waitFor(() => host.vars.power === 'ON')
		await host.subscribeFeedbacks([['f_hold', 'auto_hold', {}]])
		await waitFor(() => 'f_hold' in host.fbValues)
		assert.deepEqual(host.fbValues.f_hold, {})

		await host.execute('auto_hold_start', { fn: 'awb', holdSeconds: 5 }, 'ctl-f_hold')
		await waitFor(() => host.fbValues.f_hold?.text?.includes('HOLD'))
		assert.ok(host.fbValues.f_hold.png64, 'progress fill is drawn while holding')
		await sleep(1500)
		await host.execute('auto_hold_cancel', {}, 'ctl-f_hold')
		await waitFor(() => Object.keys(host.fbValues.f_hold).length === 0)
		await sleep(4500)
		assert.equal(ccu.count([0x40, 0x10]), 0, 'released early: nothing sent')

		await host.execute('auto_hold_start', { fn: 'awb', holdSeconds: 1 }, 'ctl-f_hold') // enforced minimum is 5 s
		await sleep(3000)
		assert.equal(ccu.count([0x40, 0x10]), 0, 'minimum hold time is enforced even if configured lower')
		await waitFor(() => ccu.count([0x40, 0x10]) === 1, 6000)
		await waitFor(() => host.vars.auto_result === 'OK')
		await waitFor(() => host.fbValues.f_hold?.text === 'AUTO\nWHITE\nOK')
		await host.execute('auto_hold_cancel', {}, 'ctl-f_hold') // release after firing is a no-op
		assert.equal(ccu.count([0x40, 0x10]), 1)
		await done()
	},
)

test(
	'v2 definition hygiene: required fields present on every action, feedback and variable',
	{ timeout: 15000 },
	async () => {
		const { host, done } = await boot()
		await waitFor(() => host.status?.status === 'ok')
		for (const [id, def] of Object.entries(host.actions)) {
			assert.ok(def.name && typeof def.callback === 'function' && Array.isArray(def.options), `action ${id}`)
			for (const o of def.options)
				if (o.type === 'number')
					assert.ok('min' in o && 'max' in o && 'default' in o, `${id}.${o.id} number needs min/max/default`)
		}
		for (const [id, def] of Object.entries(host.feedbackDefs)) {
			assert.ok(def.name && typeof def.callback === 'function', `feedback ${id}`)
			if (def.type === 'boolean') assert.ok(def.defaultStyle, `${id} needs defaultStyle`)
			if (def.type === 'advanced')
				assert.ok(
					Array.isArray(def.affectedProperties) && def.affectedProperties.length,
					`${id} needs affectedProperties`,
				)
			for (const o of def.options)
				if (o.type === 'number') assert.ok('min' in o && 'max' in o, `${id}.${o.id} number needs min/max`)
		}
		for (const [id, def] of Object.entries(host.varDefs)) assert.ok(def.name, `variable ${id}`)
		await waitFor(() => Object.keys(host.varDefs).every((v) => host.vars[v] !== undefined))
		const fields = host.instance.getConfigFields()
		assert.ok(
			fields.every((f) => f.id && f.type && f.label && f.width),
			'config fields complete',
		)
		await done()
	},
)

test('value feedbacks feed the gauges and labels, and follow the camera', { timeout: 15000 }, async () => {
	const { host, ccu, done } = await boot()
	await waitFor(() => host.vars.iris_follow === 61 && host.vars.master_black === -13)
	await host.subscribeFeedbacks([
		['g', 'val_iris_gauge', {}],
		['gl', 'val_iris_label', {}],
		['b', 'val_black', {}],
		['bl', 'val_black_label', {}],
		['lk', 'val_link_label', {}],
		['pw', 'val_power_label', {}],
		['md', 'val_iris_mode_label', {}],
		['ln', 'val_lens_label', {}],
		['au', 'val_auto_label', {}],
	])
	const v = host.fbValues
	assert.deepEqual([v.g, v.gl, v.b, v.bl], [51, 'f/6.1', -13, '-13'])
	assert.deepEqual([v.lk, v.pw, v.md, v.ln, v.au], ['CONNECTED', 'ON', 'REMOTE', 'x1  OK', '-'])
	ccu.push([0x12, 0x22, 0x00, 0x28]) // lens moves to f/4.0
	await waitFor(() => host.fbValues.gl === 'f/4.0' && host.fbValues.g === 68)
	ccu.push([0x32, 0x2b, 0x05, 0x00])
	await waitFor(() => host.fbValues.bl === '+5' && host.fbValues.b === 5)
	await done()
})

test(
	'power hold: early release sends nothing; a full hold powers the camera once, shows SENT, then clears',
	{ timeout: 20000 },
	async () => {
		const { host, ccu, done } = await boot()
		await waitFor(() => host.vars.power === 'ON')
		await host.subscribeFeedbacks([['f_hold', 'auto_hold', {}]])
		await waitFor(() => 'f_hold' in host.fbValues)

		await host.execute('power_hold_start', { state: 'off', holdSeconds: 2 }, 'ctl-f_hold')
		await waitFor(() => host.fbValues.f_hold?.text?.includes('HOLD'))
		assert.ok(host.fbValues.f_hold.png64, 'progress animation while holding')
		await sleep(700)
		await host.execute('auto_hold_cancel', {}, 'ctl-f_hold')
		await waitFor(() => Object.keys(host.fbValues.f_hold).length === 0)
		await sleep(2500)
		assert.equal(ccu.count([0x20, 0x22, 0x00, 0xfe]), 0, 'released early: camera untouched')

		await host.execute('power_hold_start', { state: 'off', holdSeconds: 1, label: 'ALL CAMS\\nOFF' }, 'ctl-f_hold')
		await waitFor(() => ccu.count([0x20, 0x22, 0x00, 0xfe]) === 1, 4000)
		await waitFor(() => host.fbValues.f_hold?.text === 'ALL CAMS\nOFF\nSENT') // custom label, \\n becomes a line break
		await waitFor(() => host.vars.power === 'OFF')
		await waitFor(() => Object.keys(host.fbValues.f_hold).length === 0, 6000) // clears by itself (no auto-result to wait for)
		assert.equal(ccu.count([0x20, 0x22, 0x00, 0xfe]), 1)
		await done()
	},
)

test(
	'power hold TOGGLE flips the camera at the moment the hold completes, in either direction',
	{ timeout: 20000 },
	async () => {
		const { host, ccu, done } = await boot()
		await waitFor(() => host.vars.power === 'ON')
		await host.execute('power_hold_start', { state: 'toggle', holdSeconds: 1 }, 'ctl-a')
		await waitFor(() => ccu.count([0x20, 0x22, 0x00, 0xfe]) === 1, 4000) // was on -> off
		await waitFor(() => host.vars.power === 'OFF')
		await sleep(3300) // let the previous hold's SENT state clear
		await host.execute('power_hold_start', { state: 'toggle', holdSeconds: 1 }, 'ctl-a')
		await waitFor(() => ccu.count([0x20, 0x22, 0x01, 0xfe]) === 1, 4000) // was off -> on
		await done()
	},
)

test('a failing action is logged as a warning, not thrown', { timeout: 15000 }, async () => {
	const { host, ccu, done } = await boot()
	await waitFor(() => host.vars.power === 'ON')
	ccu.dropAll()
	await waitFor(() => host.vars.link_status === 'Disconnected')
	const r = await host.execute('power_on')
	assert.ok(r.ok, 'executeAction itself still succeeds')
	await waitFor(() => host.logs.some((l) => l.level === 'warn' && /Power ON/.test(l.message)))
	await done()
})

test('connection loss -> status failure, then automatic recovery with state resync', { timeout: 20000 }, async () => {
	const { host, ccu, done } = await boot()
	await waitFor(() => host.status?.status === 'ok' && host.vars.power === 'ON')
	ccu.state.masterBlack = 55
	ccu.dropAll()
	await waitFor(() => host.status?.status === 'connection_failure')
	await waitFor(() => host.status?.status === 'ok' && host.vars.master_black === 55, 8000)
	await done()
})

test('config change reconnects to the new target; destroy closes the socket', { timeout: 20000 }, async () => {
	const a = await boot()
	await waitFor(() => a.host.vars.master_black === -13)
	const b = new MockCcu({ state: { masterBlack: 99, power: false } })
	const portB = await b.listen()
	await a.host.reconfigure({ host: '127.0.0.1', port: portB, pollMs: 250, takeOnConnect: true })
	await waitFor(() => a.host.vars.master_black === 99 && a.host.vars.power === 'OFF')
	await waitFor(() => b.count([0x08, 0x00, 0xff]) === 1) // takeOnConnect applied from new config
	assert.equal(a.ccu.sockets.size, 0, 'old connection closed')
	await a.host.stop()
	await waitFor(() => b.sockets.size === 0)
	await a.ccu.close()
	await b.close()
})

test('missing / unreachable CCU shows the right status and never crashes', { timeout: 15000 }, async () => {
	const h1 = new Host()
	await h1.start({ host: '', port: 10001, pollMs: 250 })
	await waitFor(() => h1.status?.status === 'bad_config')
	await h1.stop()

	const h2 = new Host()
	await h2.start({ host: '127.0.0.1', port: 1, pollMs: 250 })
	await waitFor(() => h2.status?.status === 'connection_failure')
	assert.equal(h2.vars.link_status, 'Disconnected')
	assert.deepEqual(
		h2.logs.filter((l) => l.level === 'error'),
		[],
	)
	await h2.stop()
})

test('fiber link variables and feedbacks', { timeout: 15000 }, async () => {
	const { host, ccu, done } = await boot({ state: { fiberBits: 0x11, linkStatus: 0x00 } })
	await waitFor(() => host.vars.fiber_link === 'OK' && host.vars.fiber_raw === '11/00')
	await host.subscribeFeedbacks([
		['f_down', 'fiber_is', { state: 'DOWN' }],
		['f_ok', 'fiber_is', { state: 'OK' }],
		['f_text', 'fiber_text', { label: 'FIBER' }],
	])
	await waitFor(() => Object.keys(host.fbValues).length === 3)
	assert.equal(host.fbValues.f_down, false)
	assert.equal(host.fbValues.f_ok, true)
	assert.deepEqual(host.fbValues.f_text, { text: 'FIBER\nOK' })
	ccu.push([0x22, 0x50, 0x80])
	ccu.push([0x12, 0x0f, 0x20])
	await waitFor(() => host.fbValues.f_down === true && host.vars.fiber_link === 'DOWN')
	assert.equal(host.vars.fiber_raw, '80/20')
	assert.equal(host.fbValues.f_ok, false)
	assert.equal(host.fbValues.f_text.text, 'FIBER\nDOWN')
	assert.ok(host.fbValues.f_text.bgcolor)
	await done()
})
