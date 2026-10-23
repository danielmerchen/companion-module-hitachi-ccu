import test from 'node:test'
import assert from 'node:assert/strict'
import { CcuClient } from '../client.js'
import { MockCcu, sleep, waitFor } from './mock-ccu.js'

async function setup(mockOpts = {}, clientOpts = {}) {
	const ccu = new MockCcu(mockOpts)
	const port = await ccu.listen()
	const client = new CcuClient({ host: '127.0.0.1', port, pollMs: 250, reconnectMs: 100, ...clientOpts })
	const links = []
	client.on('link', (l) => links.push(l))
	client.start()
	return { ccu, client, links, done: async () => (client.stop(), ccu.close()) }
}

test('connects, polls, and populates every tracked value', async () => {
	const { client, done } = await setup()
	await waitFor(() => client.state.irisFollow !== null && client.state.irisMode !== null)
	assert.deepEqual(client.getState(), {
		link: 'connected',
		power: true,
		iris: 0,
		irisMode: 'REMOTE',
		irisFollow: 0x3d,
		masterBlack: -13,
		extender: 0,
		camAlarm: 0,
		fiberBits: 0x11,
		linkStatus: 0x00,
		autoResult: null,
	})
	await done()
})

test('set IRIS / master black send the right frames, update optimistically, then read back', async () => {
	const { ccu, client, done } = await setup()
	await waitFor(() => client.state.iris !== null)
	const changes = []
	client.on('change', (keys) => changes.push(...keys))
	client.setIris(-20)
	assert.equal(client.state.iris, -20) // optimistic
	client.setMasterBlack(7)
	await waitFor(() => ccu.count([0x30, 0x2e, 0xec, 0x00]) === 1 && ccu.count([0x30, 0x2b, 0x07, 0x00]) === 1)
	await waitFor(() => ccu.state.iris === -20 && ccu.state.masterBlack === 7)
	await sleep(500) // allow read-back + poll
	assert.equal(client.state.iris, -20)
	assert.equal(client.state.masterBlack, 7)
	assert.ok(changes.includes('iris') && changes.includes('masterBlack'))
	await done()
})

test('every analog set is preceded by the analog control-right claim (08 02 FF 00)', async () => {
	const { ccu, client, done } = await setup()
	await waitFor(() => client.state.iris !== null)
	client.setIris(5)
	await waitFor(() => ccu.state.iris === 5)
	client.setMasterBlack(-5)
	await waitFor(() => ccu.state.masterBlack === -5)
	assert.equal(ccu.count([0x08, 0x02, 0xff, 0x00]), 2)
	const order = ccu.received.map((r) => r.toString('hex')).filter((h) => h.startsWith('30') || h.startsWith('0802'))
	assert.deepEqual(order, ['0802ff00', '302e0500', '0802ff00', '302bfb00'])
	await done()
})

test('setFstop closes the loop on the lens position and lands exactly on the target', async () => {
	const { ccu, client, done } = await setup({}, { fstopMinMs: 40, fstopPollMs: 30 })
	await waitFor(() => client.state.irisMode !== null && client.state.irisFollow !== null)
	near(await client.setFstop(4), 4)
	assert.ok(Math.abs(ccu.state.irisFollow - 40) <= 1)
	near(await client.setFstop(2.8), 2.8)
	assert.ok(Math.abs(ccu.state.irisFollow - 28) <= 1)
	await done()
})

test('stepFstop is relative to the current f-number, and steps queue in order', async () => {
	const { client, done } = await setup({}, { fstopMinMs: 40, fstopPollMs: 30 })
	await waitFor(() => client.state.irisMode !== null && client.state.irisFollow !== null)
	await client.setFstop(4)
	near(await client.stepFstop(1), 5.7)
	near(await client.stepFstop(-1), 4, 'back near f/4')
	const [a, b] = await Promise.all([client.stepFstop(1), client.stepFstop(1)])
	assert.equal(a, b) // the second press retargets the same move
	assert.ok(b > 5.5, `two quick presses end further than one: ${b}`)
	await done()
})

test('setFstop refuses outside REMOTE mode, out of range, or with no lens', async () => {
	const a = await setup({ state: { irisModeRaw: 0x06 } }, { fstopMinMs: 40, fstopPollMs: 30 })
	await waitFor(() => a.client.state.irisMode === 'AUTO')
	await assert.rejects(() => a.client.setFstop(4), /not REMOTE/)
	await a.done()
	const b = await setup({}, { fstopMinMs: 40, fstopPollMs: 30 })
	await waitFor(() => b.client.state.irisMode === 'REMOTE')
	await assert.rejects(() => b.client.setFstop(99), /out of range/)
	b.ccu.push([0x12, 0x22, 0xff, 0x00])
	await waitFor(() => b.client.state.irisFollow === 0xff00)
	await assert.rejects(() => b.client.stepFstop(1), /unavailable/)
	await b.done()
})

// A lens like the real one: non-linear, and it lags the command. Counts how many IRIS commands each move needed.
const realisticLens = (extra = {}) => ({
	lensCurve: (i) =>
		Math.round(
			18 +
				Math.max(0, 66 - i) * 0.32 +
				Math.max(0, 14 - i) * 0.35 +
				Math.max(0, -13 - i) * 0.9 +
				Math.max(0, -42 - i) * 0.5,
		),
	lensSlew: 4,
	...extra,
})
const near = (a, b, m) => assert.ok(Math.abs(a - b) < 0.11, `${m ?? ''} ${a} vs ${b}`)
const irisCmds = (ccu) => ccu.received.filter((r) => r[0] === 0x30 && r[1] === 0x2e).length

test(
	'f-stop moves on a lagging, non-linear lens take few commands, land exactly, and do not hunt',
	{ timeout: 60000 },
	async () => {
		const { ccu, client, done } = await setup(
			{ state: { irisFollow: 61 }, ...realisticLens() },
			{ fstopMinMs: 120, fstopPollMs: 50 },
		)
		await waitFor(() => client.state.irisMode !== null && client.state.irisFollow !== null)
		for (const f of [2.8, 10, 4, 16, 5.6, 8, 3.3]) {
			const before = irisCmds(ccu)
			const seen = []
			const onChange = (keys, st) => keys.includes('irisFollow') && seen.push(st.irisFollow)
			client.on('change', onChange)
			near(await client.setFstop(f), f, `f/${f}`)
			client.off('change', onChange)
			assert.ok(Math.abs(ccu.state.irisFollow - f * 10) <= 1, `f/${f} landed at ${ccu.state.irisFollow}`)
			assert.ok(irisCmds(ccu) - before <= 5, `f/${f} took ${irisCmds(ccu) - before} commands`)
		}
		await done()
	},
)

test('the learned curve makes the second move to the same place a single command', { timeout: 30000 }, async () => {
	const shifted = (i) => Math.round(30 + Math.max(0, 40 - i) * 0.5 + Math.max(0, -10 - i) * 1.2) // a lens unlike the seed
	const { ccu, client, done } = await setup(
		{ state: { irisFollow: 61 }, lensCurve: shifted, lensSlew: 6 },
		{ fstopMinMs: 100, fstopPollMs: 40 },
	)
	await waitFor(() => client.state.irisMode !== null && client.state.irisFollow !== null)
	await client.setFstop(5)
	await client.setFstop(9)
	const before = irisCmds(ccu)
	await client.setFstop(5)
	assert.equal(irisCmds(ccu) - before, 1, 'it already knew the command for f/5')
	assert.ok(Math.abs(ccu.state.irisFollow - 50) <= 1)
	await done()
})

test(
	'a new f-stop request during a move retargets it, and a step uses the in-flight target as its base',
	{ timeout: 30000 },
	async () => {
		const { ccu, client, done } = await setup(
			{ state: { irisFollow: 61 }, ...realisticLens({ lensSlew: 2 }) },
			{ fstopMinMs: 100, fstopPollMs: 40 },
		)
		await waitFor(() => client.state.irisMode !== null && client.state.irisFollow !== null)
		const first = client.setFstop(10)
		await sleep(200)
		const second = client.setFstop(3.3) // changes its mind mid-move
		const third = client.stepFstop(1) // relative to where it is now headed (3.3), not to the lens position
		const [a, b, c] = await Promise.all([first, second, third])
		assert.deepEqual([a, b], [c, c])
		near(c, 4.7, '3.3 + one stop')
		assert.ok(Math.abs(ccu.state.irisFollow - 47) <= 1)
		await done()
	},
)

test('values are clamped to the signed 8-bit range', async () => {
	const { ccu, client, done } = await setup()
	await waitFor(() => client.state.iris !== null)
	assert.equal(client.setIris(999), 127)
	assert.equal(client.setMasterBlack(-999), -128)
	await waitFor(() => ccu.count([0x30, 0x2e, 0x7f, 0x00]) && ccu.count([0x30, 0x2b, 0x80, 0x00]))
	await done()
})

test('step adds to the last known value and accumulates on rapid presses', async () => {
	const { ccu, client, done } = await setup({ state: { iris: 10 } })
	await waitFor(() => client.state.iris === 10)
	await client.stepIris(4)
	await client.stepIris(4)
	await client.stepIris(-1)
	assert.equal(client.state.iris, 17)
	await waitFor(() => ccu.state.iris === 17)
	await done()
})

test('step waits for a first read if the value is not known yet', async () => {
	const { client, ccu, done } = await setup({ state: { masterBlack: -5 } }, { pollMs: 10000 })
	await waitFor(() => client.state.link === 'connected')
	client.state.masterBlack = null
	await client.stepMasterBlack(2)
	assert.equal(client.state.masterBlack, -3)
	await waitFor(() => ccu.state.masterBlack === -3)
	await done()
})

test('power off is seen immediately; power on shows up after the camera lag', async () => {
	const { ccu, client, done } = await setup({ powerOnDelayMs: 400 })
	await waitFor(() => client.state.power === true)
	client.power(false)
	await waitFor(() => client.state.power === false)
	client.power(true)
	await sleep(150)
	assert.equal(client.state.power, false) // camera has not come up yet
	await waitFor(() => client.state.power === true, 4000)
	assert.equal(ccu.count([0x20, 0x22, 0x01, 0xfe]), 1)
	await done()
})

test('toggle follows current state and refuses when state is unknown', async () => {
	const { client, done } = await setup()
	await waitFor(() => client.state.power === true)
	client.togglePower()
	await waitFor(() => client.state.power === false)
	client.state.power = null
	assert.throws(() => client.togglePower(), /unknown/)
	await done()
})

test('takeOnConnect sends the Taken frame; take() sends it on demand', async () => {
	const a = await setup({}, { takeOnConnect: true })
	await waitFor(() => a.ccu.count([0x08, 0x00, 0xff]) === 1)
	a.client.take()
	await waitFor(() => a.ccu.count([0x08, 0x00, 0xff]) === 2)
	await a.done()
	const b = await setup()
	await waitFor(() => b.client.state.power !== null)
	assert.equal(b.ccu.count([0x08, 0x00, 0xff]), 0) // off by default
	await b.done()
})

test('unsolicited pushes from the CCU update state without polling', async () => {
	const { ccu, client, done } = await setup({}, { pollMs: 10000 })
	await waitFor(() => client.state.iris === 0)
	ccu.push([0x32, 0x2e, 0x21, 0x00])
	await waitFor(() => client.state.iris === 0x21)
	await done()
})

test('reconnects after the CCU drops the connection and resyncs', async () => {
	const { ccu, client, links, done } = await setup()
	await waitFor(() => client.state.power === true)
	ccu.state.masterBlack = 40
	ccu.dropAll()
	await waitFor(() => links.includes('disconnected'))
	await waitFor(() => client.state.link === 'connected' && client.state.masterBlack === 40, 4000)
	assert.equal(ccu.connections, 2)
	await done()
})

test('reports no_reply when connected but the CCU stays silent, and recovers', async () => {
	const { ccu, client, done } = await setup({ silent: true }, { staleMs: 400 })
	await waitFor(() => client.state.link === 'no_reply', 3000)
	ccu.silent = false
	await waitFor(() => client.state.link === 'connected' && client.state.power === true, 3000)
	await done()
})

test('commands throw a clear error while disconnected; unreachable host retries quietly', async () => {
	const client = new CcuClient({ host: '127.0.0.1', port: 1, reconnectMs: 100, pollMs: 250 })
	client.start()
	await sleep(250)
	assert.throws(() => client.power(true), /not connected/)
	assert.throws(() => client.setIris(1), /not connected/)
	client.stop()
})

test('fiber link bytes are polled read-only and follow pushes', async () => {
	const { ccu, client, done } = await setup({ state: { fiberBits: 0x10, linkStatus: 0x00 } })
	await waitFor(() => client.state.fiberBits === 0x10 && client.state.linkStatus === 0x00)
	ccu.push([0x22, 0x50, 0x80])
	ccu.push([0x12, 0x0f, 0x20])
	await waitFor(() => client.state.fiberBits === 0x80 && client.state.linkStatus === 0x20)
	assert.equal(ccu.received.filter((r) => r[0] === 0x20 || r[0] === 0x30 || r[0] === 0x40).length, 0, 'no writes sent')
	await done()
})

test('extender and head alarm are polled read-only and follow pushes', async () => {
	const { ccu, client, done } = await setup({ state: { extender: 1, camAlarm: 2 } })
	await waitFor(() => client.state.extender === 1 && client.state.camAlarm === 2)
	ccu.push([0x22, 0x12, 0x02])
	await waitFor(() => client.state.extender === 2)
	ccu.push([0x12, 0x13, 0x00])
	await waitFor(() => client.state.camAlarm === 0)
	assert.equal(ccu.received.filter((r) => r[0] === 0x20 || r[0] === 0x30 || r[0] === 0x40).length, 0, 'no writes sent')
	await done()
})

test('autoWhite / autoBlack send the documented frames and surface the camera result', async () => {
	const { ccu, client, done } = await setup({ state: { autoCode: 0x13 } })
	await waitFor(() => client.state.link === 'connected')
	client.autoWhite()
	await waitFor(() => ccu.count([0x40, 0x10]) === 1 && client.state.autoResult?.code === 0x13)
	const first = client.state.autoResult
	ccu.state.autoCode = 0x00
	client.autoBlack()
	await waitFor(() => ccu.count([0x40, 0x20]) === 1 && client.state.autoResult?.code === 0x00)
	assert.notEqual(client.state.autoResult, first)
	await done()
})

test('stop() leaves no timers or sockets behind', async () => {
	const { client, ccu } = await setup()
	await waitFor(() => client.state.power === true)
	client.stop()
	assert.equal(client.state.link, 'disconnected')
	assert.equal(client.timers.poll, null)
	await ccu.close()
})
