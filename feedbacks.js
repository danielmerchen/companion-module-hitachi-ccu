import { combineRgb } from '@companion-module/base'
import { fstopFromFollow, irisLabel, irisGaugePct, blackLabel, extenderText, alarmText, fiberText, autoResultText } from './variables.js'
import { progressFill } from './png.js'

const OPS = {
	eq: { label: '=', fn: (a, b) => a === b },
	ne: { label: '≠', fn: (a, b) => a !== b },
	gt: { label: '>', fn: (a, b) => a > b },
	gte: { label: '≥', fn: (a, b) => a >= b },
	lt: { label: '<', fn: (a, b) => a < b },
	lte: { label: '≤', fn: (a, b) => a <= b },
}
const opChoices = Object.entries(OPS).map(([id, o]) => ({ id, label: o.label }))

const compareOptions = (def) => [
	{ id: 'op', type: 'dropdown', label: 'Operator', default: 'eq', choices: opChoices },
	{ id: 'value', type: 'number', label: 'Value', default: def, min: -128, max: 127 },
]

export default function updateFeedbacks(self) {
	const st = () => self.client?.getState() ?? {}
	const compare = (key) => (fb) => {
		const v = st()[key]
		if (v === null || v === undefined) return false
		return OPS[fb.options.op].fn(v, Number(fb.options.value))
	}
	const green = { bgcolor: combineRgb(0, 140, 0), color: combineRgb(255, 255, 255) }

	self.setFeedbackDefinitions({
		power_state: {
			name: 'Camera power state',
			description: 'Highlights the button while the camera power matches (unknown counts as no match)',
			type: 'boolean',
			defaultStyle: green,
			options: [
				{
					id: 'state',
					type: 'dropdown',
					label: 'Highlight when power is',
					default: 'on',
					choices: [
						{ id: 'on', label: 'ON' },
						{ id: 'off', label: 'OFF' },
					],
				},
			],
			callback: (fb) => {
				const p = st().power
				return p === null || p === undefined ? false : (fb.options.state === 'on') === p
			},
		},
		link_ok: {
			name: 'CCU connection healthy',
			description: 'True while connected and the CCU is replying',
			type: 'boolean',
			defaultStyle: green,
			options: [],
			callback: () => st().link === 'connected',
		},
		iris_mode_is: {
			name: 'IRIS mode is',
			description: 'IRIS set commands only take effect in REMOTE mode',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(200, 120, 0), color: combineRgb(0, 0, 0) },
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'AUTO',
					choices: [
						{ id: 'REMOTE', label: 'REMOTE' },
						{ id: 'AUTO', label: 'AUTO' },
					],
				},
			],
			callback: (fb) => st().irisMode === fb.options.mode,
		},
		iris_compare: {
			name: 'IRIS value compare',
			description: 'Compare the commanded IRIS value (-128..127)',
			type: 'boolean',
			defaultStyle: green,
			options: compareOptions(0),
			callback: compare('iris'),
		},
		master_black_compare: {
			name: 'Master black value compare',
			description: 'Compare the master black value (-128..127)',
			type: 'boolean',
			defaultStyle: green,
			options: compareOptions(0),
			callback: compare('masterBlack'),
		},
		iris_text: {
			name: 'Show IRIS value on button',
			description: 'Replaces the button text with "<label> <value>"; no variable names needed',
			type: 'advanced',
			affectedProperties: ['text'],
			options: [{ id: 'label', type: 'textinput', label: 'Label', default: 'IRIS' }],
			callback: (fb) => {
				const v = st().iris
				return { text: `${fb.options.label}\n${v === null || v === undefined ? '?' : v}` }
			},
		},
		master_black_text: {
			name: 'Show master black value on button',
			description: 'Replaces the button text with "<label> <value>"; no variable names needed',
			type: 'advanced',
			affectedProperties: ['text'],
			options: [{ id: 'label', type: 'textinput', label: 'Label', default: 'M.BLACK' }],
			callback: (fb) => {
				const v = st().masterBlack
				return { text: `${fb.options.label}\n${v === null || v === undefined ? '?' : v}` }
			},
		},
		// Value feedbacks: a preset turns each one into a local variable ($(local:name)) that its gauges and texts read.
		val_iris_gauge: {
			name: 'Value: iris gauge 0-100 (100 = wide open, linear in stops)',
			description: 'Uses the lens wide-open / smallest f-stop from the connection settings',
			type: 'value',
			options: [],
			callback: () => irisGaugePct(st().irisFollow, Number(self.config?.fstopWide) || 1.8, Number(self.config?.fstopClosed) || 22),
		},
		val_iris_label: {
			name: 'Value: iris as text ("f/5.6", CLOSED, NO LENS, ?)',
			type: 'value',
			options: [],
			callback: () => irisLabel(st().irisFollow),
		},
		val_black: {
			name: 'Value: master black as a number (-128..127; 0 until read)',
			type: 'value',
			options: [],
			callback: () => st().masterBlack ?? 0,
		},
		val_black_label: {
			name: 'Value: master black as text ("+3", "-13", ?)',
			type: 'value',
			options: [],
			callback: () => blackLabel(st().masterBlack),
		},
		val_link_label: {
			name: 'Value: connection as text (CONNECTED / NO REPLY / ...)',
			type: 'value',
			options: [],
			callback: () => ({ connected: 'CONNECTED', connecting: 'CONNECTING', no_reply: 'NO REPLY', disconnected: 'DISCONNECTED' })[st().link] ?? 'DISCONNECTED',
		},
		val_power_label: {
			name: 'Value: camera power as text (ON / OFF / ?)',
			type: 'value',
			options: [],
			callback: () => (st().power === null || st().power === undefined ? '?' : st().power ? 'ON' : 'OFF'),
		},
		val_iris_mode_label: {
			name: 'Value: iris mode as text (REMOTE / AUTO / ?)',
			type: 'value',
			options: [],
			callback: () => st().irisMode ?? '?',
		},
		val_lens_label: {
			name: 'Value: extender and head alarm as text ("x1  OK", "x2  HEAD TEMP")',
			type: 'value',
			options: [],
			callback: () => `${extenderText(st().extender)}  ${alarmText(st().camAlarm)}`,
		},
		val_auto_label: {
			name: 'Value: result of the last auto white / black as text',
			type: 'value',
			options: [],
			callback: () => autoResultText(st().autoResult),
		},
		alarm_active: {
			name: 'Camera head alarm active',
			description: 'True while the camera reports a head fan or head temperature alarm',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(200, 0, 0), color: combineRgb(255, 255, 255) },
			options: [],
			callback: () => {
				const a = st().camAlarm
				return a !== null && a !== undefined && a !== 0
			},
		},
		fiber_is: {
			name: 'Fiber link is',
			description: 'Fiber link to the camera head as reported by the CCU (decoded from captures; not in the Hitachi PDF)',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(200, 0, 0), color: combineRgb(255, 255, 255) },
			options: [
				{
					id: 'state',
					type: 'dropdown',
					label: 'State',
					default: 'DOWN',
					choices: [
						{ id: 'OK', label: 'OK (both strands)' },
						{ id: 'PARTIAL', label: 'PARTIAL (one half)' },
						{ id: 'CHANGING', label: 'CHANGING (losing / regaining)' },
						{ id: 'DOWN', label: 'DOWN' },
					],
				},
			],
			callback: (fb) => fiberText(st().fiberBits, st().linkStatus) === fb.options.state,
		},
		fiber_text: {
			name: 'Show fiber link on button',
			description: 'Shows OK / PARTIAL / CHANGING / DOWN; red when DOWN, amber when PARTIAL or CHANGING',
			type: 'advanced',
			affectedProperties: ['text', 'color', 'bgcolor'],
			options: [{ id: 'label', type: 'textinput', label: 'Label', default: 'FIBER' }],
			callback: (fb) => {
				const f = fiberText(st().fiberBits, st().linkStatus)
				const out = { text: `${fb.options.label}\n${f}` }
				if (f === 'DOWN') Object.assign(out, { bgcolor: combineRgb(200, 0, 0), color: combineRgb(255, 255, 255) })
				else if (f === 'PARTIAL' || f === 'CHANGING') Object.assign(out, { bgcolor: combineRgb(200, 120, 0), color: combineRgb(0, 0, 0) })
				return out
			},
		},
		extender_is: {
			name: 'Lens extender is',
			type: 'boolean',
			defaultStyle: { bgcolor: combineRgb(200, 120, 0), color: combineRgb(0, 0, 0) },
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Extender',
					default: 'x2',
					choices: [
						{ id: 'x1', label: 'x1 (off)' },
						{ id: 'x2', label: 'x2' },
						{ id: 'x0.8', label: 'x0.8' },
					],
				},
			],
			callback: (fb) => extenderText(st().extender) === fb.options.mode,
		},
		extender_text: {
			name: 'Show lens extender on button',
			type: 'advanced',
			affectedProperties: ['text'],
			options: [{ id: 'label', type: 'textinput', label: 'Label', default: 'EXT' }],
			callback: (fb) => ({ text: `${fb.options.label}\n${extenderText(st().extender)}` }),
		},
		cam_alarm_text: {
			name: 'Show camera head alarm on button',
			description: 'Shows OK / HEAD FAN / HEAD TEMP, and turns the button red during an alarm',
			type: 'advanced',
			affectedProperties: ['text', 'color', 'bgcolor'],
			options: [{ id: 'label', type: 'textinput', label: 'Label', default: 'ALARM' }],
			callback: (fb) => {
				const a = st().camAlarm
				const out = { text: `${fb.options.label}\n${alarmText(a)}` }
				if (a !== null && a !== undefined && a !== 0) Object.assign(out, { bgcolor: combineRgb(200, 0, 0), color: combineRgb(255, 255, 255) })
				return out
			},
		},
		auto_hold: {
			name: 'Press-and-hold progress (auto functions)',
			description: 'Fill + countdown while the button is held, then SENT and the camera result. Add to every auto-function button.',
			type: 'advanced',
			affectedProperties: ['text', 'color', 'bgcolor', 'png64'],
			options: [],
			callback: (fb) => {
				const l = self.latch?.get(fb.controlId)
				if (!l) return {}
				const white = combineRgb(255, 255, 255)
				if (l.phase === 'holding') {
					return {
						text: `${l.label}\nHOLD ${(l.remainingMs / 1000).toFixed(1)}s`,
						color: white,
						bgcolor: combineRgb(60, 30, 0),
						png64: progressFill(l.progress, [200, 110, 0, 255]),
					}
				}
				if (l.phase === 'error') return { text: `${l.label}\nFAILED`, color: white, bgcolor: combineRgb(170, 0, 0) }
				const r = l.showResult ? st().autoResult : null
				if (r && r.at >= l.firedAt) {
					return { text: `${l.label}\n${autoResultText(r)}`, color: white, bgcolor: r.code === 0 ? combineRgb(0, 140, 0) : combineRgb(170, 0, 0) }
				}
				return { text: `${l.label}\nSENT`, color: white, bgcolor: combineRgb(0, 90, 140) }
			},
		},
		preset_hold: {
			name: 'Preset hold animation (banner)',
			description:
				'Countdown fill in the banner while a preset button is held, "release now" once the time is up, then the done text. Add to the same button as "Preset: hold animation (press)".',
			type: 'advanced',
			affectedProperties: ['text', 'color', 'bgcolor', 'png64'],
			options: [],
			callback: (fb) => {
				const l = self.latch?.get(fb.controlId)
				if (!l) return {}
				const white = combineRgb(255, 255, 255)
				if (l.phase === 'holding') {
					return {
						text: `${l.label}\n${(l.remainingMs / 1000).toFixed(1)}s`,
						color: white,
						bgcolor: combineRgb(60, 30, 0),
						png64: progressFill(l.progress, [200, 110, 0, 255]),
					}
				}
				if (l.phase === 'sent') return { text: `${l.label}\nRELEASE`, color: white, bgcolor: combineRgb(0, 90, 140) }
				return { text: `${l.doneLabel ?? 'DONE'}\n`, color: white, bgcolor: combineRgb(0, 140, 0) }
			},
		},
		iris_fstop_text: {
			name: 'Show lens f-stop on button',
			description:
				'Replaces the button text with "<label>" and the f-number (CLOSED / NO LENS as appropriate); add the "f/" in the label if you want it',
			type: 'advanced',
			affectedProperties: ['text'],
			options: [{ id: 'label', type: 'textinput', label: 'Label', default: 'F-STOP' }],
			callback: (fb) => ({ text: `${fb.options.label}\n${fstopFromFollow(st().irisFollow)}` }),
		},
	})
}
