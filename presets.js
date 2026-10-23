import { combineRgb } from '@companion-module/base'

const WHITE = combineRgb(255, 255, 255)
const BLACK = combineRgb(0, 0, 0)
const GREY = combineRgb(40, 40, 40)
const NAVY = combineRgb(30, 30, 60)
const GREEN = { bgcolor: combineRgb(0, 140, 0), color: WHITE }
const RED = { bgcolor: combineRgb(170, 0, 0), color: WHITE }
const AMBER = { bgcolor: combineRgb(200, 120, 0), color: BLACK }

const press = (actionId, options = {}) => [{ down: [{ actionId, options }], up: [] }]

const button = (name, text, bgcolor, steps, feedbacks = []) => ({
	type: 'simple',
	name,
	style: { text, size: '14', color: WHITE, bgcolor },
	steps,
	feedbacks,
})
const action = (name, text, bgcolor, actionId, options, feedbacks) =>
	button(name, text, bgcolor, press(actionId, options), feedbacks)
const display = (name, text, feedbacks) => button(name, text, BLACK, [{ down: [], up: [] }], feedbacks)
const hold = (text, fn) =>
	button(
		`${text.replace('\n', ' ')} (hold 5 s)`,
		text,
		GREY,
		[
			{
				down: [{ actionId: 'auto_hold_start', options: { fn, holdSeconds: 5 } }],
				up: [{ actionId: 'auto_hold_cancel', options: {} }],
			},
		],
		[{ feedbackId: 'auto_hold', options: {} }],
	)

// ---- Layered (Companion 5) presets -------------------------------------------------------------
// Numbers and labels come from value feedbacks, exposed to the button as local variables; elements read them with a bare
// $(local:name) expression. Element bounds are percentages of the button.
const DARK = combineRgb(18, 18, 22)
const GREEN_N = combineRgb(0, 120, 0)
const RED_N = combineRgb(150, 0, 0)
const AMBER_N = combineRgb(190, 110, 0)
const IRIS_C = combineRgb(255, 190, 40)
const BLACK_C = combineRgb(90, 170, 255)

// Text size is a PERCENTAGE of the text element's height (Companion: 3-200, default 100); with shrink-to-fit on, 100 means
// "as large as the box allows". Small numbers here render tiny.
const FS = 100

const ex = (name) => ({ value: `$(local:${name})`, isExpression: true })
const lv = (variableName, feedbackId) => ({ variableType: 'feedback', feedbackId, options: {}, variableName })
const box = (id, color, extra = {}) => ({ type: 'box', id, x: 0, y: 0, width: 100, height: 100, color, ...extra })
const text = (id, value, x, y, width, height, fontsize, color = WHITE, extra = {}) => ({
	type: 'text',
	id,
	text: value,
	x,
	y,
	width,
	height,
	fontsize,
	fontsizeAllowShrink: true,
	color,
	halign: 'center',
	valign: 'center',
	...extra,
})
const gauge = (id, x, y, width, height, valueName, extra = {}) => ({
	type: 'gauge',
	id,
	x,
	y,
	width,
	height,
	value: ex(valueName),
	min: 0,
	max: 100,
	orientation: 'vertical',
	fillEnabled: true,
	trackStyle: 'dimmed',
	...extra,
})
const override = (elementId, elementProperty, value) => ({ elementId, elementProperty, override: value })
const layered = (name, elements, localVariables, feedbacks = [], steps = [{ down: [], up: [] }]) => ({
	type: 'layered',
	name,
	canvas: { decoration: 'none' },
	elements,
	localVariables,
	feedbacks,
	steps,
})

// A StreamDeck+ encoder: rotate_right / rotate_left step the value, pushing the knob resets it. Shows a gauge and the value.
function knob(
	name,
	title,
	gaugeVar,
	labelVar,
	color,
	stepAction,
	rightOptions,
	leftOptions,
	pushAction,
	pushOptions,
	gaugeFeedback,
	labelFeedback,
	gaugeExtra = {},
) {
	return layered(
		name,
		[
			box('bg', DARK),
			text('title', title, 0, 2, 100, 20, FS, color),
			text('value', ex(labelVar), 0, 22, 100, 40, FS),
			gauge('bar', 8, 66, 84, 22, gaugeVar, { orientation: 'horizontal', ...gaugeExtra }),
		],
		[lv(gaugeVar, gaugeFeedback), lv(labelVar, labelFeedback)],
		[],
		[
			{
				down: [{ actionId: pushAction, options: pushOptions }],
				up: [],
				rotate_right: [{ actionId: stepAction, options: rightOptions }],
				rotate_left: [{ actionId: stepAction, options: leftOptions }],
			},
		],
	)
}

export default function updatePresets(self) {
	const presets = {
		power_on: action('Power ON', 'POWER\nON', GREY, 'power_on', {}, [
			{ feedbackId: 'power_state', options: { state: 'on' }, style: GREEN },
		]),
		power_off: action('Power OFF', 'POWER\nOFF', GREY, 'power_off', {}, [
			{ feedbackId: 'power_state', options: { state: 'off' }, style: RED },
		]),
		power_toggle: action('Power toggle', 'POWER\nTOGGLE', GREY, 'power_toggle', {}, [
			{ feedbackId: 'power_state', options: { state: 'on' }, style: GREEN },
		]),

		iris_value: display('IRIS value display', 'IRIS\n?', [
			{ feedbackId: 'iris_text', options: { label: 'IRIS' } },
			{ feedbackId: 'iris_mode_is', options: { mode: 'AUTO' }, style: AMBER },
		]),
		iris_fstop_value: display('IRIS f-stop display', 'F-STOP\n?', [
			{ feedbackId: 'iris_fstop_text', options: { label: 'F-STOP' } },
			{ feedbackId: 'iris_mode_is', options: { mode: 'AUTO' }, style: AMBER },
		]),
		fstop_open: action('f-stop open 1/3', 'F-STOP\nOPEN ⅓', NAVY, 'iris_fstop_step', { stops: -0.33 }),
		fstop_close: action('f-stop close 1/3', 'F-STOP\nCLOSE ⅓', NAVY, 'iris_fstop_step', { stops: 0.33 }),
		fstop_28: action('Go to f/2.8', 'GO\nf/2.8', NAVY, 'iris_fstop_set', { fstop: 2.8 }),
		fstop_4: action('Go to f/4', 'GO\nf/4', NAVY, 'iris_fstop_set', { fstop: 4 }),
		fstop_56: action('Go to f/5.6', 'GO\nf/5.6', NAVY, 'iris_fstop_set', { fstop: 5.6 }),
		fstop_8: action('Go to f/8', 'GO\nf/8', NAVY, 'iris_fstop_set', { fstop: 8 }),
		iris_up: action('IRIS +', 'IRIS\n▲', NAVY, 'iris_step', { delta: 4 }),
		iris_down: action('IRIS -', 'IRIS\n▼', NAVY, 'iris_step', { delta: -4 }),
		iris_zero: action('IRIS to 0', 'IRIS\n0', NAVY, 'iris_set', { value: 0 }),

		mb_value: display('Master black value display', 'M.BLACK\n?', [
			{ feedbackId: 'master_black_text', options: { label: 'M.BLACK' } },
		]),
		mb_up: action('Master black +', 'M.BLK\n▲', NAVY, 'master_black_step', { delta: 1 }),
		mb_down: action('Master black -', 'M.BLK\n▼', NAVY, 'master_black_step', { delta: -1 }),
		mb_zero: action('Master black to 0', 'M.BLK\n0', NAVY, 'master_black_set', { value: 0 }),

		extender: display('Lens extender', 'EXT\n?', [{ feedbackId: 'extender_text', options: { label: 'EXT' } }]),
		cam_alarm: display('Camera head alarm', 'ALARM\n?', [
			{ feedbackId: 'cam_alarm_text', options: { label: 'ALARM' } },
		]),
		fiber_link: display('Fiber link', 'FIBER\n?', [{ feedbackId: 'fiber_text', options: { label: 'FIBER' } }]),

		power_toggle_hold: button(
			'Power toggle (hold 2 s)',
			'POWER\nTOGGLE\n(hold)',
			GREY,
			[
				{
					down: [{ actionId: 'power_hold_start', options: { state: 'toggle', holdSeconds: 2 } }],
					up: [{ actionId: 'auto_hold_cancel', options: {} }],
				},
			],
			[
				{
					feedbackId: 'power_state',
					options: { state: 'on' },
					style: { bgcolor: combineRgb(0, 140, 0), color: WHITE },
				},
				{ feedbackId: 'auto_hold', options: {} },
			],
		),
		power_on_hold: button(
			'Power ON (hold 3 s)',
			'POWER\nON\n(hold)',
			GREY,
			[
				{
					down: [{ actionId: 'power_hold_start', options: { state: 'on', holdSeconds: 3 } }],
					up: [{ actionId: 'auto_hold_cancel', options: {} }],
				},
			],
			[{ feedbackId: 'auto_hold', options: {} }],
		),
		power_off_hold: button(
			'Power OFF (hold 3 s)',
			'POWER\nOFF\n(hold)',
			GREY,
			[
				{
					down: [{ actionId: 'power_hold_start', options: { state: 'off', holdSeconds: 3 } }],
					up: [{ actionId: 'auto_hold_cancel', options: {} }],
				},
			],
			[{ feedbackId: 'auto_hold', options: {} }],
		),
		auto_white: hold('AUTO\nWHITE', 'awb'),
		auto_black: hold('AUTO\nBLACK', 'abb'),

		// --- Status buttons (layered) ---
		st_link: layered(
			'Status: connection',
			[
				box('bg', RED_N),
				text('title', 'CCU', 0, 4, 100, 22, FS, combineRgb(220, 220, 220)),
				text('value', ex('link'), 0, 30, 100, 60, FS),
			],
			[lv('link', 'val_link_label')],
			[{ feedbackId: 'link_ok', options: {}, styleOverrides: [override('bg', 'color', GREEN_N)] }],
		),
		st_power: layered(
			'Status: camera power',
			[
				box('bg', combineRgb(60, 60, 60)),
				text('title', 'POWER', 0, 4, 100, 22, FS, combineRgb(220, 220, 220)),
				text('value', ex('power'), 0, 30, 100, 60, FS),
			],
			[lv('power', 'val_power_label')],
			[
				{ feedbackId: 'power_state', options: { state: 'on' }, styleOverrides: [override('bg', 'color', GREEN_N)] },
				{ feedbackId: 'power_state', options: { state: 'off' }, styleOverrides: [override('bg', 'color', RED_N)] },
			],
		),
		st_iris_mode: layered(
			'Status: iris mode (amber in AUTO)',
			[
				box('bg', combineRgb(60, 60, 60)),
				text('title', 'IRIS', 0, 4, 100, 22, FS, combineRgb(220, 220, 220)),
				text('value', ex('mode'), 0, 30, 100, 60, FS),
			],
			[lv('mode', 'val_iris_mode_label')],
			[{ feedbackId: 'iris_mode_is', options: { mode: 'AUTO' }, styleOverrides: [override('bg', 'color', AMBER_N)] }],
		),
		st_lens: layered(
			'Status: extender and head alarm (red on alarm)',
			[
				box('bg', combineRgb(60, 60, 60)),
				text('title', 'EXT / ALARM', 0, 4, 100, 22, FS, combineRgb(220, 220, 220)),
				text('value', ex('lens'), 0, 30, 100, 60, FS),
			],
			[lv('lens', 'val_lens_label')],
			[{ feedbackId: 'alarm_active', options: {}, styleOverrides: [override('bg', 'color', RED_N)] }],
		),
		st_auto: layered(
			'Status: last auto white / black result',
			[
				box('bg', DARK),
				text('title', 'AUTO', 0, 4, 100, 22, FS, combineRgb(220, 220, 220)),
				text('value', ex('result'), 0, 30, 100, 60, FS),
			],
			[lv('result', 'val_auto_label')],
		),

		// --- Gauges (layered) ---
		gauge_iris_black: layered(
			'Gauges: IRIS (f-stop) and BLACK on one button',
			[
				box('bg', DARK),
				text('iris_title', 'IRIS', 0, 1, 50, 16, FS, IRIS_C),
				text('black_title', 'BLACK', 50, 1, 50, 16, FS, BLACK_C),
				gauge('iris_gauge', 12, 18, 26, 50, 'iris_pct'),
				gauge('black_gauge', 62, 18, 26, 50, 'black_value', { min: -128, max: 127, origin: 0, symmetric: false }),
				text('iris_value', ex('iris_label'), 0, 70, 50, 28, FS, IRIS_C),
				text('black_value', ex('black_label'), 50, 70, 50, 28, FS, BLACK_C),
			],
			[
				lv('iris_pct', 'val_iris_gauge'),
				lv('black_value', 'val_black'),
				lv('iris_label', 'val_iris_label'),
				lv('black_label', 'val_black_label'),
			],
		),
		gauge_iris: layered(
			'Gauge: IRIS ring with the f-stop in the middle',
			[
				box('bg', DARK),
				gauge('ring', 6, 6, 88, 88, 'iris_pct', { orientation: 'ring', startAngle: -135, endAngle: 135 }),
				text('title', 'IRIS', 0, 22, 100, 18, FS, IRIS_C),
				text('value', ex('iris_label'), 0, 40, 100, 30, FS),
			],
			[lv('iris_pct', 'val_iris_gauge'), lv('iris_label', 'val_iris_label')],
		),
		gauge_black: layered(
			'Gauge: MASTER BLACK ring with the value in the middle',
			[
				box('bg', DARK),
				gauge('ring', 6, 6, 88, 88, 'black_value', {
					orientation: 'ring',
					startAngle: -135,
					endAngle: 135,
					min: -128,
					max: 127,
					origin: 0,
					symmetric: false,
				}),
				text('title', 'BLACK', 0, 22, 100, 18, FS, BLACK_C),
				text('value', ex('black_label'), 0, 40, 100, 30, FS),
			],
			[lv('black_value', 'val_black'), lv('black_label', 'val_black_label')],
		),

		// --- StreamDeck+ knobs: turn = step, push = reset. Clockwise opens the iris / raises black. ---
		knob_fstop: knob(
			'F-STOP knob (1/3 stop per click, push = f/4)',
			'F-STOP',
			'iris_pct',
			'iris_label',
			IRIS_C,
			'iris_fstop_step',
			{ stops: -0.33 },
			{ stops: 0.33 },
			'iris_fstop_set',
			{ fstop: 4 },
			'val_iris_gauge',
			'val_iris_label',
		),
		knob_fstop_fine: knob(
			'F-STOP knob, fine (1/6 stop per click, push = f/4)',
			'F-STOP fine',
			'iris_pct',
			'iris_label',
			IRIS_C,
			'iris_fstop_step',
			{ stops: -0.17 },
			{ stops: 0.17 },
			'iris_fstop_set',
			{ fstop: 4 },
			'val_iris_gauge',
			'val_iris_label',
		),
		knob_fstop_coarse: knob(
			'F-STOP knob, coarse (1 stop per click, push = f/4)',
			'F-STOP coarse',
			'iris_pct',
			'iris_label',
			IRIS_C,
			'iris_fstop_step',
			{ stops: -1 },
			{ stops: 1 },
			'iris_fstop_set',
			{ fstop: 4 },
			'val_iris_gauge',
			'val_iris_label',
		),
		knob_black: knob(
			'MASTER BLACK knob (1 per click, push = 0)',
			'BLACK',
			'black_value',
			'black_label',
			BLACK_C,
			'master_black_step',
			{ delta: 1 },
			{ delta: -1 },
			'master_black_set',
			{ value: 0 },
			'val_black',
			'val_black_label',
			{ min: -128, max: 127, origin: 0, symmetric: false },
		),
		knob_black_coarse: knob(
			'MASTER BLACK knob, coarse (4 per click, push = 0)',
			'BLACK coarse',
			'black_value',
			'black_label',
			BLACK_C,
			'master_black_step',
			{ delta: 4 },
			{ delta: -4 },
			'master_black_set',
			{ value: 0 },
			'val_black',
			'val_black_label',
			{ min: -128, max: 127, origin: 0, symmetric: false },
		),

		take: action('Taken (claim control)', 'TAKEN', combineRgb(60, 40, 0), 'take', {}),
		refresh: action('Refresh values', 'REFRESH', GREY, 'refresh', {}, [
			{ feedbackId: 'link_ok', options: {}, style: { bgcolor: combineRgb(0, 90, 0), color: WHITE } },
		]),
	}

	const group = (id, name, ids) => ({
		id,
		name,
		definitions: [{ id: `${id}_group`, type: 'simple', name, presets: ids }],
	})
	const structure = [
		group('status', 'Status', ['st_link', 'st_power', 'st_iris_mode', 'st_lens', 'st_auto']),
		group('gauges', 'Gauges', ['gauge_iris_black', 'gauge_iris', 'gauge_black']),
		group('knobs', 'StreamDeck+ Knobs', [
			'knob_fstop',
			'knob_fstop_fine',
			'knob_fstop_coarse',
			'knob_black',
			'knob_black_coarse',
		]),
		group('power', 'Power', [
			'power_on',
			'power_off',
			'power_toggle',
			'power_toggle_hold',
			'power_on_hold',
			'power_off_hold',
		]),
		group('iris', 'Iris', [
			'iris_value',
			'iris_fstop_value',
			'fstop_open',
			'fstop_close',
			'fstop_28',
			'fstop_4',
			'fstop_56',
			'fstop_8',
			'iris_up',
			'iris_down',
			'iris_zero',
		]),
		group('master_black', 'Master Black', ['mb_value', 'mb_up', 'mb_down', 'mb_zero']),
		group('lens', 'Lens', ['extender', 'cam_alarm', 'fiber_link']),
		group('auto', 'Auto Functions', ['auto_white', 'auto_black']),
		group('system', 'System', ['take', 'refresh']),
	]

	self.setPresetDefinitions(structure, presets)
}
