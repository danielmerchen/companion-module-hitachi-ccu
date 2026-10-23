import test from 'node:test'
import assert from 'node:assert/strict'
import { fstopTarget, IrisCurve, stepFstopValue } from '../fstop.js'

test('fstopTarget converts to lens-position tenths and rejects out-of-range', () => {
	assert.equal(fstopTarget(2.8), 28)
	assert.equal(fstopTarget(22), 220)
	assert.throws(() => fstopTarget(0.5), /out of range/)
	assert.throws(() => fstopTarget(64), /out of range/)
	assert.throws(() => fstopTarget('x'), /out of range/)
})

test('IrisCurve: measured points are exact, in-between positions interpolate, and it learns this lens', () => {
	const c = new IrisCurve()
	assert.equal(c.cmdFor(28), 66)
	assert.equal(c.cmdFor(56), 7) // the old sweep-based table guessed ~21 here, 14 units off
	assert.equal(c.cmdFor(100), -42)
	assert.equal(c.cmdFor(220), -118)
	const mid = c.cmdFor(45)
	assert.ok(mid < 36 && mid > 21, `interpolated between f/4.0 and f/4.8: ${mid}`)
	// monotonic: more closed (higher position) always needs a lower command
	let prev = Infinity
	for (let f = 18; f <= 220; f++) {
		const v = c.cmdFor(f)
		assert.ok(v <= prev + 1e-9, `non-increasing at ${f}`)
		prev = v
	}
	// a different lens: the learned point wins, and neighbours re-interpolate around it
	c.add(30, 56)
	assert.equal(c.cmdFor(56), 30)
	assert.ok(Number.isFinite(c.cmdFor(52)) && c.cmdFor(52) > c.cmdFor(56)) // contradicting older points were dropped, curve stays monotonic
	c.add(10, 0xffff) // closed sentinel is not a position
	c.add(10, null)
	assert.equal(c.points.has(0xffff), false)
	// beyond either end it extrapolates instead of throwing
	assert.ok(Number.isFinite(c.cmdFor(10)) && Number.isFinite(c.cmdFor(400)))
})

test('stepFstopValue moves by stops, closing raises the f-number, and always moves at least 0.1', () => {
	assert.equal(stepFstopValue(2.8, 1), 4)
	assert.equal(stepFstopValue(4, 1), 5.7)
	assert.equal(stepFstopValue(4, -1), 2.8)
	assert.equal(stepFstopValue(2.8, 0.33), 3.1)
	assert.equal(stepFstopValue(4, 0), 4)
	assert.equal(stepFstopValue(1.8, 0.01), 1.9)
	assert.equal(stepFstopValue(22, -0.01), 21.9)
})
