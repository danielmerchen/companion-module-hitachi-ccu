import test from 'node:test'
import assert from 'node:assert/strict'
import * as P from '../protocol.js'

const wire = (dt) => P.buildFrame(Buffer.from(dt)).toString('latin1').slice(1, -1)

// Golden values: byte-for-byte what the RCP / CCU sent in the packet captures.
test('request frames match the RCP captures exactly', () => {
	assert.equal(wire(P.FRAMES.READ_POWER), '022322B8FF')
	assert.equal(wire(P.FRAMES.READ_IRIS), '02332E9CFF')
	assert.equal(wire(P.FRAMES.READ_MASTER_BLACK), '02332B9FFF')
	assert.equal(wire(P.FRAMES.READ_IRIS_FOLLOW), '021322C8FF')
	assert.equal(wire(P.FRAMES.READ_IRIS_MODE), '022304D6FF')
	assert.equal(wire(P.FRAMES.TAKE), '030800FFF5FE')
})

test('power frames match the verified on/off commands', () => {
	assert.equal(wire(P.FRAMES.POWER_ON), '04202201FEBAFE')
	assert.equal(wire(P.FRAMES.POWER_OFF), '04202200FEBBFE')
})

test('extender / alarm requests match the RCP capture; auto function frames follow the PDF', () => {
	assert.equal(wire(P.FRAMES.READ_EXTENDER), '022312C8FF') // seen on the wire from the RCP
	assert.equal(wire(P.FRAMES.READ_CAM_ALARM), '021313D7FF') // seen on the wire from the RCP
	assert.equal(wire(P.FRAMES.READ_FIBER), '0223508AFF') // answered by the CCU on hardware 2026-10-20 (not sent by the RCP)
	assert.equal(wire(P.FRAMES.READ_LINK), '02130FDBFF') // answered by the CCU on hardware 2026-10-20
	assert.deepEqual([...P.FRAMES.AUTO_WHITE], [0x40, 0x10]) // doc only, not yet captured
	assert.deepEqual([...P.FRAMES.AUTO_BLACK], [0x40, 0x20]) // sent by the RCP in groupC capture (reply 40 00 00 after ~19 s)
})

test('extender, alarm and auto-result replies decode', () => {
	assert.deepEqual(P.interpret(Buffer.from([0x22, 0x12, 0x00])), { extender: 0 })
	assert.deepEqual(P.interpret(Buffer.from([0x22, 0x12, 0xfd])), { extender: 1 })
	assert.deepEqual(P.interpret(Buffer.from([0x22, 0x12, 0xfe])), { extender: 2 })
	assert.deepEqual(P.interpret(Buffer.from([0x12, 0x13, 0x00])), { camAlarm: 0 })
	assert.deepEqual(P.interpret(Buffer.from([0x12, 0x13, 0x02])), { camAlarm: 2 })
	assert.equal(P.interpret(Buffer.from([0x40, 0x00, 0x13])).autoResult.code, 0x13)
	assert.deepEqual(P.interpret(Buffer.from([0x22, 0x50, 0x11])), { fiberBits: 0x11 })
	assert.deepEqual(P.interpret(Buffer.from([0x22, 0x50, 0x80])), { fiberBits: 0x80 })
	assert.deepEqual(P.interpret(Buffer.from([0x12, 0x0f, 0x00])), { linkStatus: 0x00 })
	assert.deepEqual(P.interpret(Buffer.from([0x12, 0x0f, 0x20])), { linkStatus: 0x20 })
})

test('analog control-right claim matches the RCP capture', () => {
	assert.equal(wire(P.FRAMES.CLAIM_ANALOG), '040802FF00F2FE')
})

test('captured CCU replies decode and interpret correctly', () => {
	const cases = [
		['04322E00009BFF', { iris: 0 }],
		['04322BF300ABFE', { masterBlack: -13 }],
		['041222003D8AFF', { irisFollow: 0x3d }],
		['03220404D2FF', { irisMode: 'REMOTE' }],
		['03222201B7FF', { power: true }],
		['03222200B8FF', { power: false }],
	]
	for (const [hex, expected] of cases) {
		const frames = new P.FrameParser().push(Buffer.from(`\x02${hex}\x03`, 'latin1'))
		assert.equal(frames.length, 1, hex)
		assert.deepEqual(P.interpret(frames[0]), expected, hex)
	}
})

test('parser reassembles split chunks and multiple frames per chunk', () => {
	const a = P.buildFrame(Buffer.from([0x22, 0x22, 0x01]))
	const b = P.buildFrame(Buffer.from([0x32, 0x2e, 0x05, 0x00]))
	const all = Buffer.concat([a, b])
	const p = new P.FrameParser()
	const out = []
	for (let i = 0; i < all.length; i += 3) out.push(...p.push(all.subarray(i, i + 3)))
	assert.equal(out.length, 2)
	assert.deepEqual(P.interpret(out[1]), { iris: 5 })
})

test('parser rejects bad checksum and garbage, then recovers', () => {
	const good = P.buildFrame(Buffer.from([0x22, 0x22, 0x00]))
	const bad = Buffer.from('\x0203222200B9FF\x03', 'latin1') // checksum off by one
	const junk = Buffer.from('hello\x02ZZ\x03', 'latin1')
	const out = new P.FrameParser().push(Buffer.concat([junk, bad, good]))
	assert.equal(out.length, 1)
	assert.deepEqual(P.interpret(out[0]), { power: false })
})

test('analog set encodes signed values and clamps', () => {
	assert.deepEqual([...P.analogSet(0x2e, -13)], [0x30, 0x2e, 0xf3, 0x00])
	assert.deepEqual([...P.analogSet(0x2b, 127)], [0x30, 0x2b, 0x7f, 0x00])
	assert.deepEqual([...P.analogSet(0x2b, -128)], [0x30, 0x2b, 0x80, 0x00])
	// quarter steps, the RCP's own resolution: lower byte 40 / 80 / C0, two's complement for negatives
	assert.deepEqual([...P.analogSet(0x2e, 7.25)], [0x30, 0x2e, 0x07, 0x40])
	assert.deepEqual([...P.analogSet(0x2e, 7.5)], [0x30, 0x2e, 0x07, 0x80])
	assert.deepEqual([...P.analogSet(0x2e, 7.75)], [0x30, 0x2e, 0x07, 0xc0])
	assert.deepEqual([...P.analogSet(0x2e, -0.25)], [0x30, 0x2e, 0xff, 0xc0])
	assert.deepEqual([...P.analogSet(0x2e, -13.5)], [0x30, 0x2e, 0xf2, 0x80])
	assert.equal(P.clampQuarter(7.3), 7.25)
	assert.equal(P.clampQuarter(999), 127)
	assert.equal(P.clampQuarter(-999), -128)
	assert.equal(P.clampSigned8(500), 127)
	assert.equal(P.clampSigned8(-500), -128)
	assert.equal(P.clampSigned8(3.6), 4)
})
