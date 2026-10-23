/**
 * Hitachi RCP<->CCU control protocol (TCP, CCU port 10001).
 *
 * Wire frame: STX(0x02) + ASCII-hex( n DT1..DTn SUML SUMH ) + ETX(0x03)
 *   SUM = one's complement of (n + DT1..DTn) as 16 bit, low byte first.
 * Derived from packet captures plus the Hitachi "Protocol for remote control" /
 * DK-H200 command list PDFs. See companion/HELP.md for what is verified.
 */

const STX = 0x02
const ETX = 0x03

function buildFrame(dt) {
	const n = dt.length & 0xff // 256 bytes would encode as 0; never needed here
	const comp = ~(n + dt.reduce((a, b) => a + b, 0)) & 0xffff
	const raw = Buffer.from([n, ...dt, comp & 0xff, comp >> 8])
	return Buffer.concat([
		Buffer.from([STX]),
		Buffer.from(raw.toString('hex').toUpperCase(), 'ascii'),
		Buffer.from([ETX]),
	])
}

/** Stateful parser: feed it TCP chunks, get back checksum-valid DT payloads. */
class FrameParser {
	constructor() {
		this.buf = Buffer.alloc(0)
	}

	push(chunk) {
		this.buf = Buffer.concat([this.buf, chunk])
		const out = []
		for (;;) {
			const s = this.buf.indexOf(STX)
			if (s < 0) {
				this.buf = Buffer.alloc(0)
				break
			}
			const e = this.buf.indexOf(ETX, s)
			if (e < 0) {
				this.buf = this.buf.subarray(s)
				break
			}
			const body = this.buf.subarray(s + 1, e).toString('ascii')
			this.buf = this.buf.subarray(e + 1)
			const dt = decodeBody(body)
			if (dt) out.push(dt)
		}
		return out
	}
}

function decodeBody(body) {
	if (!/^(?:[0-9A-Fa-f]{2})+$/.test(body)) return null
	const raw = Buffer.from(body, 'hex')
	if (raw.length < 4) return null
	const n = raw[0]
	const len = n === 0 ? 256 : n
	if (raw.length !== len + 3) return null
	const dt = raw.subarray(1, 1 + len)
	const comp = ~(n + dt.reduce((a, b) => a + b, 0)) & 0xffff
	if (raw[1 + len] !== (comp & 0xff) || raw[2 + len] !== comp >> 8) return null
	return Buffer.from(dt)
}

const toSigned8 = (b) => (b & 0x80 ? b - 256 : b)

// --- Mode numbers (CTL 30/33/32 analog, CTL 20/23/22 on-off, CTL 13/12 status)
const MODE = {
	IRIS: 0x2e, // analog; CLOSE(80) .. 00 .. OPEN(7F) per DK-H200 list
	MASTER_BLACK: 0x2b, // analog; signed
	POWER: 0x22, // on/off, bit 0 (found by capture; not in the PDF)
	IRIS_MODE: 0x04, // on/off, DT3 bits 0-1: 0 = REMOTE, 2 = AUTO (per PDF)
	IRIS_FOLLOW: 0x22, // status read (CTL 13 / 12): 0000 OPEN .. FFFF CLOSE, FF00 = no lens
	EXTENDER: 0x12, // on/off, response only: DT3 bit 0 = x2, bit 1 = x0.8, neither = x1 (per PDF)
	CAM_ALARM: 0x13, // status read (CTL 13 / 12): 01 head fan, 02 head temperature (per PDF)
	FIBER: 0x50, // on/off (CTL 23 / 22): fiber link bits, undocumented; read live on hardware 2026-10-20 (11 OK, 10 partial, 80 down)
	LINK: 0x0f, // status (CTL 13 / 12): link flags, undocumented; 00 OK, 20 down (the CCU also pushes it about every 2.7 s)
	AUTO_WHITE: 0x10, // auto function (CTL 40), per PDF
	AUTO_BLACK: 0x20, // auto function (CTL 40), per PDF
}

const FRAMES = {
	POWER_ON: Buffer.from([0x20, MODE.POWER, 0x01, 0xfe]),
	POWER_OFF: Buffer.from([0x20, MODE.POWER, 0x00, 0xfe]),
	TAKE: Buffer.from([0x08, 0x00, 0xff]),
	// Control-right demand for the IRIS / Master Black (analog) group. The CCU answers 0A 03 FF and
	// ignores every 30 xx analog set until this has been sent on the connection (captured from the RCP).
	CLAIM_ANALOG: Buffer.from([0x08, 0x02, 0xff, 0x00]),
	READ_POWER: Buffer.from([0x23, MODE.POWER]),
	READ_IRIS_MODE: Buffer.from([0x23, MODE.IRIS_MODE]),
	READ_IRIS: Buffer.from([0x33, MODE.IRIS]),
	READ_MASTER_BLACK: Buffer.from([0x33, MODE.MASTER_BLACK]),
	READ_IRIS_FOLLOW: Buffer.from([0x13, MODE.IRIS_FOLLOW]),
	READ_EXTENDER: Buffer.from([0x23, MODE.EXTENDER]),
	READ_CAM_ALARM: Buffer.from([0x13, MODE.CAM_ALARM]),
	READ_FIBER: Buffer.from([0x23, MODE.FIBER]),
	READ_LINK: Buffer.from([0x13, MODE.LINK]),
	// Auto functions write their result to camera memory (EEPROM): only ever send them deliberately.
	AUTO_WHITE: Buffer.from([0x40, MODE.AUTO_WHITE]),
	AUTO_BLACK: Buffer.from([0x40, MODE.AUTO_BLACK]),
}

/** Analog set: CTL 30, MODE, DATA1 (signed upper byte), DATA2 (lower byte, undefined -> 0). */
function analogSet(mode, value) {
	// The value is a signed 16 bit number: upper byte = whole units, lower byte = fraction. The RCP sends quarter steps (0x40).
	const u = (Math.round(value * 4) * 64) & 0xffff
	return Buffer.from([0x30, mode, u >> 8, u & 0xff])
}

/**
 * Interpret one decoded DT payload from the CCU.
 * Returns a partial state object, or null if it is not something we track.
 */
function interpret(dt) {
	if (dt.length >= 3 && dt[0] === 0x22 && dt[1] === MODE.POWER) return { power: !!(dt[2] & 1) }
	if (dt.length >= 3 && dt[0] === 0x22 && dt[1] === MODE.IRIS_MODE) {
		const v = dt[2] & 0x03
		return { irisMode: v === 0 ? 'REMOTE' : v === 2 ? 'AUTO' : `?${v}` }
	}
	if (dt.length >= 4 && dt[0] === 0x32 && dt[1] === MODE.IRIS) return { iris: toSigned8(dt[2]) }
	if (dt.length >= 4 && dt[0] === 0x32 && dt[1] === MODE.MASTER_BLACK) return { masterBlack: toSigned8(dt[2]) }
	if (dt.length >= 4 && dt[0] === 0x12 && dt[1] === MODE.IRIS_FOLLOW) return { irisFollow: (dt[2] << 8) | dt[3] }
	if (dt.length >= 3 && dt[0] === 0x22 && dt[1] === MODE.EXTENDER) return { extender: dt[2] & 0x03 }
	if (dt.length >= 3 && dt[0] === 0x12 && dt[1] === MODE.CAM_ALARM) return { camAlarm: dt[2] }
	if (dt.length >= 3 && dt[0] === 0x22 && dt[1] === MODE.FIBER) return { fiberBits: dt[2] }
	if (dt.length >= 3 && dt[0] === 0x12 && dt[1] === MODE.LINK) return { linkStatus: dt[2] }
	// Fresh object every time so a repeated identical result still counts as a change.
	if (dt.length >= 3 && dt[0] === 0x40 && dt[1] === 0x00) return { autoResult: { code: dt[2], at: Date.now() } }
	return null
}

const clampSigned8 = (v) => Math.max(-128, Math.min(127, Math.round(Number(v))))
/** Like clampSigned8 but keeps quarter-unit resolution (the RCP's own step). */
const clampQuarter = (v) => Math.max(-128, Math.min(127, Math.round(Number(v) * 4) / 4))

export {
	STX,
	ETX,
	buildFrame,
	FrameParser,
	decodeBody,
	toSigned8,
	MODE,
	FRAMES,
	analogSet,
	interpret,
	clampSigned8,
	clampQuarter,
}
