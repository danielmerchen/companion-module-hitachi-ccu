import test from 'node:test'
import assert from 'node:assert/strict'
import { fstopFromFollow, fstopNumber, irisLabel, irisGaugePct, blackLabel, valuesFromState } from '../variables.js'

test('fstopFromFollow returns the bare f-number (add "f/" in button text): iris_follow is f-number * 10 (hardware-calibrated 2026-10-05, f/1.8..f/22)', () => {
	assert.equal(fstopFromFollow(18), '1.8')
	assert.equal(fstopFromFollow(20), '2.0')
	assert.equal(fstopFromFollow(28), '2.8')
	assert.equal(fstopFromFollow(40), '4.0')
	assert.equal(fstopFromFollow(220), '22.0')
	assert.equal(fstopFromFollow(0xff00), 'NO LENS')
	assert.equal(fstopFromFollow(0xffff), 'CLOSED')
	assert.equal(fstopFromFollow(null), '?')
	assert.equal(fstopFromFollow(undefined), '?')
})

test('valuesFromState includes iris_fstop', () => {
	assert.equal(valuesFromState({ irisFollow: 28 }).iris_fstop, '2.8')
	assert.equal(valuesFromState({ irisFollow: null }).iris_fstop, '?')
})

test('irisLabel / fstopNumber: "f/" is added for buttons only', () => {
	assert.equal(irisLabel(61), 'f/6.1')
	assert.equal(irisLabel(0xffff), 'CLOSED')
	assert.equal(irisLabel(0xff00), 'NO LENS')
	assert.equal(irisLabel(null), '?')
	assert.equal(fstopNumber(28), 2.8)
	assert.equal(fstopNumber(0xffff), null)
	assert.equal(fstopNumber(null), null)
})

test('irisGaugePct is linear in stops: 100 wide open, 0 at the smallest aperture, 0 with no number', () => {
	assert.equal(irisGaugePct(18), 100)
	assert.equal(irisGaugePct(220), 0)
	assert.equal(irisGaugePct(61), 51)
	assert.equal(irisGaugePct(40), 68)
	assert.ok(irisGaugePct(25) > irisGaugePct(40) && irisGaugePct(40) > irisGaugePct(80), 'monotonic: more open = fuller')
	assert.equal(irisGaugePct(10), 100, 'wider than the configured wide-open clamps')
	assert.equal(irisGaugePct(0xffff), 0)
	assert.equal(irisGaugePct(null), 0)
	assert.equal(
		irisGaugePct(40, 1.4, 16),
		Math.round((1 - Math.log2(4 / 1.4) / Math.log2(16 / 1.4)) * 100),
		'honours the configured lens limits',
	)
	assert.equal(irisGaugePct(40, 22, 1.8), 0, 'nonsense limits do not throw')
})

test('blackLabel shows a sign', () => {
	assert.equal(blackLabel(3), '+3')
	assert.equal(blackLabel(-13), '-13')
	assert.equal(blackLabel(0), '0')
	assert.equal(blackLabel(null), '?')
})

test('fiberText decodes the CCU link bytes captured in the fiber-pull tests (2026-10-20)', async () => {
	const { fiberText, fiberRaw } = await import('../variables.js')
	assert.equal(fiberText(0x11, 0x00), 'OK')
	assert.equal(fiberText(0x10, 0x00), 'PARTIAL')
	assert.equal(fiberText(0x80, 0x20), 'DOWN')
	assert.equal(fiberText(0x80, 0x00), 'DOWN')
	assert.equal(fiberText(0x10, 0x20), 'DOWN')
	assert.equal(fiberText(0x40, 0x10), 'CHANGING')
	assert.equal(fiberText(0x11, 0x10), 'CHANGING')
	assert.equal(fiberText(null, 0x00), '?')
	assert.equal(fiberText(0x11, undefined), '?')
	assert.equal(fiberRaw(0x11, 0x00), '11/00')
	assert.equal(fiberRaw(0x80, 0x20), '80/20')
	assert.equal(fiberRaw(null, null), '?')
})
