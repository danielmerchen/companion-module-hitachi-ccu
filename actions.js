const valueOption = (label, def) => ({
	id: 'value',
	type: 'number',
	label,
	default: def,
	min: -128,
	max: 127,
	range: true,
	step: 1,
})
const stepOption = (def) => ({
	id: 'delta',
	type: 'number',
	label: 'Step (use a negative number to go down)',
	default: def,
	min: -128,
	max: 128,
	step: 1,
})

const AUTO_FUNCTIONS = {
	awb: { label: 'AUTO\nWHITE', send: (c) => c.autoWhite() },
	abb: { label: 'AUTO\nBLACK', send: (c) => c.autoBlack() },
}

export default function updateActions(self) {
	// Wrap callbacks so a failed send is logged instead of throwing into Companion.
	const run = (name, fn) => async (event) => {
		try {
			if (!self.client) throw new Error('module not started')
			await fn(self.client, event.options)
		} catch (e) {
			self.log('warn', `${name}: ${e.message}`)
		}
	}

	self.setActionDefinitions({
		power_on: {
			name: 'Power ON',
			options: [],
			callback: run('Power ON', (c) => c.power(true)),
		},
		power_off: {
			name: 'Power OFF',
			options: [],
			callback: run('Power OFF', (c) => c.power(false)),
		},
		power_toggle: {
			name: 'Power toggle',
			description: 'Flips power based on the last known state (does nothing if state is unknown)',
			options: [],
			callback: run('Power toggle', (c) => c.togglePower()),
		},
		take: {
			name: 'Taken (claim control)',
			description: 'Sends the control-right demand the RCP sends when a camera is taken',
			options: [],
			callback: run('Taken', (c) => c.take()),
		},
		iris_set: {
			name: 'IRIS set',
			description: 'Only effective while the camera IRIS mode is REMOTE',
			options: [valueOption('IRIS value (-128 closed .. 127 open per spec)', 0)],
			callback: run('IRIS set', (c, o) => c.setIris(o.value)),
		},
		iris_step: {
			name: 'IRIS step',
			description: 'Adjust relative to the last known value; only effective in REMOTE mode',
			options: [stepOption(4)],
			callback: run('IRIS step', (c, o) => c.stepIris(Number(o.delta))),
		},
		iris_fstop_set: {
			name: 'IRIS set to f-stop',
			description: 'Drives the lens to an absolute f-number using the lens-position readback; only effective in REMOTE mode',
			options: [{ id: 'fstop', type: 'number', label: 'f-number', default: 4, min: 1, max: 32, step: 0.1 }],
			callback: run('IRIS set to f-stop', (c, o) => c.setFstop(Number(o.fstop))),
		},
		iris_fstop_step: {
			name: 'IRIS step f-stop',
			description: 'Moves the lens relative to its current f-number, in stops (1/3 stop = 0.33); only effective in REMOTE mode',
			options: [{ id: 'stops', type: 'number', label: 'Stops (positive = close, negative = open)', default: 0.33, min: -6, max: 6, step: 0.01 }],
			callback: run('IRIS step f-stop', (c, o) => c.stepFstop(Number(o.stops))),
		},
		master_black_set: {
			name: 'Master black set',
			options: [valueOption('Master black value', 0)],
			callback: run('Master black set', (c, o) => c.setMasterBlack(o.value)),
		},
		master_black_step: {
			name: 'Master black step',
			description: 'Adjust relative to the last known value',
			options: [stepOption(1)],
			callback: run('Master black step', (c, o) => c.stepMasterBlack(Number(o.delta))),
		},
		auto_hold_start: {
			name: 'Auto function: hold to send (press)',
			description:
				'Use on the button PRESS. Sends only if the button stays held for the full hold time; add "Auto function: cancel" on button RELEASE. Auto white / black write their result to camera memory.',
			options: [
				{
					id: 'fn',
					type: 'dropdown',
					label: 'Function',
					default: 'awb',
					choices: [
						{ id: 'awb', label: 'Auto white' },
						{ id: 'abb', label: 'Auto black' },
					],
				},
				{ id: 'holdSeconds', type: 'number', label: 'Hold time (seconds, min 5)', default: 5, min: 5, max: 15, step: 0.5 },
			],
			callback: (event) => {
				const fn = AUTO_FUNCTIONS[event.options.fn]
				if (!fn || !self.client) return self.log('warn', 'Auto function: module not started or unknown function')
				const holdMs = Math.max(5, Number(event.options.holdSeconds) || 5) * 1000
				self.latch.start(event.controlId, { label: fn.label, holdMs, fire: () => fn.send(self.client) })
			},
		},
		power_hold_start: {
			name: 'Power: hold to send (press)',
			description:
				'Use on the button PRESS. Powers the camera on or off only if the button stays held for the full hold time, with a progress animation (add the "Press-and-hold progress" feedback). Add "Hold: cancel (release)" on button RELEASE. Several cameras can share one button: add this action once per connection.',
			options: [
				{
					id: 'state',
					type: 'dropdown',
					label: 'Power',
					default: 'on',
					choices: [
						{ id: 'on', label: 'ON' },
						{ id: 'off', label: 'OFF' },
						{ id: 'toggle', label: 'TOGGLE (on if it is off, off if it is on)' },
					],
				},
				{ id: 'holdSeconds', type: 'number', label: 'Hold time (seconds)', default: 3, min: 1, max: 15, step: 0.5 },
				{
					id: 'label',
					type: 'textinput',
					label: 'Text while holding (use \\n for a new line; blank = POWER ON / POWER OFF)',
					default: '',
				},
			],
			callback: (event) => {
				if (!self.client) return self.log('warn', 'Power hold: module not started')
				const state = event.options.state
				const holdMs = Math.max(1, Number(event.options.holdSeconds) || 3) * 1000
				const fallback = state === 'toggle' ? 'POWER' : state === 'on' ? 'POWER\nON' : 'POWER\nOFF'
				self.latch.start(event.controlId, {
					label: String(event.options.label ?? '').trim().replace(/\\n/g, '\n') || fallback,
					holdMs,
					fire: () => (state === 'toggle' ? self.client.togglePower() : self.client.power(state === 'on')),
					lingerMs: 3000,
					showResult: false,
				})
			},
		},
		preset_hold_start: {
			name: 'Preset: hold animation (press)',
			description:
				'Use on the button PRESS together with a long-release action set of the same length (e.g. 2.9 s). Shows the hold countdown, then "release now"; the actual work is done by the button\'s own long-release actions. Add "Hold: cancel (release)" on button RELEASE and the "Preset hold animation" feedback.',
			options: [
				{ id: 'label', type: 'textinput', label: 'Banner text while holding (e.g. STORE)', default: 'STORE' },
				{ id: 'doneLabel', type: 'textinput', label: 'Banner text once done', default: 'STORED' },
				{ id: 'holdSeconds', type: 'number', label: 'Hold time (seconds)', default: 3, min: 1, max: 15, step: 0.1 },
			],
			callback: (event) => {
				self.latch.start(event.controlId, {
					label: String(event.options.label ?? '').trim() || 'STORE',
					doneLabel: String(event.options.doneLabel ?? '').trim() || 'DONE',
					holdMs: Math.max(1, Number(event.options.holdSeconds) || 3) * 1000,
					fire: () => {},
					lingerMs: 30000,
					doneMs: 1500,
					showResult: false,
				})
			},
		},
		auto_hold_cancel: {
			name: 'Hold: cancel (release)',
			description: 'Use on the button RELEASE: cancels an auto-function or power hold that has not reached its time yet',
			options: [],
			callback: (event) => {
				self.latch.release(event.controlId)
			},
		},
		refresh: {
			name: 'Refresh all values now',
			options: [],
			callback: run('Refresh', (c) => c.poll()),
		},
	})
}
