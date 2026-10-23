const LINK_TEXT = {
	disconnected: 'Disconnected',
	connecting: 'Connecting',
	connected: 'Connected',
	no_reply: 'No reply',
}

const definitions = {
	link_status: { name: 'Connection status (Connected / No reply / Disconnected)' },
	power: { name: 'Camera power (ON / OFF / ?)' },
	iris: { name: 'IRIS command value, signed -128..127 (mode 2E)' },
	iris_pct: { name: 'IRIS command as % of range (-128 = 0%, 127 = 100%)' },
	iris_mode: { name: 'IRIS mode (REMOTE / AUTO)' },
	iris_follow: { name: 'Lens iris position, raw 0 (open) .. 65535 (closed)' },
	iris_follow_pct: { name: 'Lens iris position, % open (NO LENS if unplugged)' },
	iris_fstop: { name: 'Lens aperture as the f-number only, e.g. "2.8" (CLOSED / NO LENS / ?). Add the "f/" in your button text.' },
	master_black: { name: 'Master black, signed -128..127 (mode 2B)' },
	extender: { name: 'Lens extender (x1 / x2 / x0.8), read only' },
	cam_alarm: { name: 'Camera head alarm (OK / HEAD FAN / HEAD TEMP), read only' },
	fiber_link: { name: 'Fiber link to the camera head (OK / PARTIAL / CHANGING / DOWN), read only; decoded from captures, not in the Hitachi PDF' },
	fiber_raw: { name: 'Fiber link raw bytes as hex, mode 50 then status 0F (e.g. 11/00 OK, 10/00 partial, 80/20 down)' },
	auto_result: { name: 'Result of the last auto white / auto black (OK, LOW LIGHT, ...; - if none yet)' },
}

const EXTENDER_TEXT = ['x1', 'x2', 'x0.8']
const AUTO_RESULT_TEXT = {
	0x00: 'OK',
	0x11: 'CHANGE TO CAM',
	0x12: 'CHANGE WHITE BAL TO MEM',
	0x13: 'LOW LIGHT',
	0x14: 'LEVEL HIGH',
	0x15: 'C.TEMP HIGH',
	0x16: 'C.TEMP LOW',
	0x17: 'IRIS NOT CLOSED',
	0x18: 'TRY AGAIN',
	0x1f: 'LOW CHROMA LEVEL',
	0x22: 'NOT GRAY SCALE',
	0x70: 'NG',
	0x80: 'TRY AGAIN',
	0xf0: 'BREAK OFF',
}
const hex = (n) => `0x${n.toString(16).toUpperCase().padStart(2, '0')}`

const known = (v) => v !== null && v !== undefined

/**
 * Lens iris position -> f-stop. Empirically calibrated on hardware 2026-10-05 against this
 * lens's own markings (f/1.8 .. f/22): iris_follow is exactly f-number * 10 across that whole
 * range. 0xFF00 = no lens; 0xFFFF = fully closed (beyond the last marked stop, not a stop itself).
 */
function fstopFromFollow(irisFollow) {
	if (!known(irisFollow)) return '?'
	if (irisFollow === 0xff00) return 'NO LENS'
	if (irisFollow === 0xffff) return 'CLOSED'
	return (irisFollow / 10).toFixed(1)
}

/** The lens f-number as a number, or null when unknown / no lens / closed. */
function fstopNumber(irisFollow) {
	return known(irisFollow) && irisFollow < 0xff00 ? irisFollow / 10 : null
}

/** "f/2.8" for a button, or the same words as `iris_fstop` when there is no number. */
function irisLabel(irisFollow) {
	const n = fstopNumber(irisFollow)
	return n === null ? fstopFromFollow(irisFollow) : `f/${n.toFixed(1)}`
}

/**
 * Iris openness for a gauge, 0..100: 100 = wide open, 0 = the lens's smallest marked aperture, linear in STOPS
 * (an f-stop is a factor of sqrt(2)), so equal gauge steps are equal exposure steps. 0 when there is no number.
 */
function irisGaugePct(irisFollow, wideOpen = 1.8, smallest = 22) {
	const n = fstopNumber(irisFollow)
	if (n === null || !(smallest > wideOpen) || !(wideOpen > 0)) return 0
	const stops = 2 * Math.log2(n / wideOpen)
	const total = 2 * Math.log2(smallest / wideOpen)
	return Math.max(0, Math.min(100, Math.round((1 - stops / total) * 100)))
}

/** Master black as a signed number for a button ("+3", "-13", "0"), or "?". */
const blackLabel = (v) => (!known(v) ? '?' : v > 0 ? `+${v}` : String(v))

const extenderText = (v) => (!known(v) ? '?' : (EXTENDER_TEXT[v] ?? '?'))
const alarmText = (v) => {
	if (!known(v)) return '?'
	if (v === 0) return 'OK'
	if (v === 1) return 'HEAD FAN'
	if (v === 2) return 'HEAD TEMP'
	if (v === 3) return 'HEAD FAN + TEMP'
	return `ALARM ${hex(v)}`
}
/**
 * Fiber link state from the CCU's own reports (on/off mode 50, status 0F). Meaning decoded from fiber-pull tests on the
 * Z-HD5500 / CU-HD1500 (2026-10-20): 50=11 and 0F=00 both strands, 50=10 one half up, 80/20 link down, 40 or 0F=10 while losing it.
 */
const fiberText = (bits, link) => {
	if (!known(bits) || !known(link)) return '?'
	if (bits & 0x80 || link & 0x20) return 'DOWN'
	if (bits === 0x11 && link === 0x00) return 'OK'
	if (bits === 0x10 && link === 0x00) return 'PARTIAL'
	return 'CHANGING'
}
const byteHex = (n) => n.toString(16).toUpperCase().padStart(2, '0')
const fiberRaw = (bits, link) => (!known(bits) || !known(link) ? '?' : `${byteHex(bits)}/${byteHex(link)}`)
const autoResultText = (r) => (!r ? '-' : (AUTO_RESULT_TEXT[r.code] ?? `ERR ${hex(r.code)}`))

/** Map client state -> Companion variable values. Unknown values show "?". */
function valuesFromState(s) {
	return {
		link_status: LINK_TEXT[s.link] ?? s.link,
		power: s.power === null ? '?' : s.power ? 'ON' : 'OFF',
		iris: known(s.iris) ? s.iris : '?',
		iris_pct: known(s.iris) ? Math.round(((s.iris + 128) / 255) * 100) : '?',
		iris_mode: s.irisMode ?? '?',
		iris_follow: known(s.irisFollow) ? s.irisFollow : '?',
		iris_follow_pct: !known(s.irisFollow)
			? '?'
			: s.irisFollow === 0xff00
				? 'NO LENS'
				: Math.round((1 - s.irisFollow / 65535) * 100),
		iris_fstop: fstopFromFollow(s.irisFollow),
		master_black: known(s.masterBlack) ? s.masterBlack : '?',
		extender: extenderText(s.extender),
		cam_alarm: alarmText(s.camAlarm),
		fiber_link: fiberText(s.fiberBits, s.linkStatus),
		fiber_raw: fiberRaw(s.fiberBits, s.linkStatus),
		auto_result: autoResultText(s.autoResult),
	}
}

export default function updateVariableDefinitions(self) {
	self.setVariableDefinitions(definitions)
}
export { valuesFromState, definitions, fstopFromFollow, fstopNumber, irisLabel, irisGaugePct, blackLabel, extenderText, alarmText, fiberText, fiberRaw, autoResultText }
