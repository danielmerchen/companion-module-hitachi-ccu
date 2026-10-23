import test from 'node:test'
import zlib from 'node:zlib'
import assert from 'node:assert/strict'
import { Latch } from '../latch.js'
import { progressFill, crc32 } from '../png.js'
import { sleep } from './mock-ccu.js'

test('latch fires only after the full hold, and only once', async () => {
	const changes = []
	const l = new Latch({ tickMs: 10, lingerMs: 300, onChange: (id) => changes.push(id) })
	let fired = 0
	assert.equal(l.start('b1', { label: 'X', holdMs: 150, fire: () => fired++ }), true)
	assert.equal(
		l.start('b1', { label: 'X', holdMs: 150, fire: () => fired++ }),
		false,
		'second press ignored while active',
	)
	await sleep(60)
	const mid = l.get('b1')
	assert.equal(mid.phase, 'holding')
	assert.ok(mid.progress > 0.1 && mid.progress < 1 && mid.remainingMs > 0)
	assert.equal(fired, 0)
	await sleep(200)
	assert.equal(fired, 1)
	assert.equal(l.get('b1').phase, 'sent')
	assert.equal(l.cancel('b1'), false, 'release after firing is a no-op')
	await sleep(350)
	assert.equal(l.get('b1'), null, 'entry clears after the linger time')
	l.destroy()
})

test('latch cancel before the hold time sends nothing and leaves no timers', async () => {
	const l = new Latch({ tickMs: 10 })
	let fired = 0
	l.start('b1', { label: 'X', holdMs: 120, fire: () => fired++ })
	await sleep(40)
	assert.equal(l.cancel('b1'), true)
	await sleep(200)
	assert.equal(fired, 0)
	assert.equal(l.get('b1'), null)
	assert.equal(l.start('b1', { label: 'X', holdMs: 20, fire: () => fired++ }), true, 'can start again after cancel')
	await sleep(80)
	assert.equal(fired, 1)
	l.destroy()
})

test('latch reports a failed send and buttons are independent', async () => {
	const l = new Latch({ tickMs: 10, lingerMs: 400 })
	l.start('a', {
		label: 'A',
		holdMs: 20,
		fire: () => {
			throw new Error('not connected to CCU')
		},
	})
	l.start('b', { label: 'B', holdMs: 500, fire: () => {} })
	await sleep(80)
	assert.equal(l.get('a').phase, 'error')
	assert.match(l.get('a').error, /not connected/)
	assert.equal(l.get('b').phase, 'holding')
	l.destroy()
})

test('latch stays on SENT until settle() is called (auto black takes ~19 s), then clears', async () => {
	const l = new Latch({ tickMs: 10 })
	l.start('b', { label: 'B', holdMs: 20, fire: () => {} })
	await sleep(120)
	assert.equal(l.get('b').phase, 'sent')
	await sleep(400)
	assert.equal(l.get('b').phase, 'sent', 'still waiting for the camera result')
	l.settle(100)
	await sleep(60)
	assert.equal(l.get('b').phase, 'sent', 'result stays visible briefly')
	await sleep(150)
	assert.equal(l.get('b'), null)
	l.destroy()
})

test('latch: a hold without a result (power) clears after its own linger time and reports showResult false', async () => {
	const l = new Latch({ tickMs: 10, lingerMs: 5000 })
	l.start('p', { label: 'P', holdMs: 30, fire: () => {}, lingerMs: 120, showResult: false })
	await sleep(80)
	const mid = l.get('p')
	assert.equal(mid.phase, 'sent')
	assert.equal(mid.showResult, false)
	await sleep(200)
	assert.equal(l.get('p'), null, 'cleared after the per-entry linger, not the 5 s default')
	l.start('a', { label: 'A', holdMs: 20, fire: () => {} })
	await sleep(60)
	assert.equal(l.get('a').showResult, true, 'auto functions still wait for their result')
	l.destroy()
})

test('png: crc32 check value and a valid RGBA PNG of the right size', () => {
	assert.equal(crc32(Buffer.from('123456789')), 0xcbf43926)
	const png = Buffer.from(progressFill(0.5, [200, 110, 0, 255]), 'base64')
	assert.deepEqual([...png.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
	assert.equal(png.readUInt32BE(16), 72)
	assert.equal(png.readUInt32BE(20), 72)
	assert.equal(png[25], 6)
	const idat = png.subarray(png.indexOf('IDAT') + 4, png.indexOf('IEND') - 8)
	const raw = zlib.inflateSync(idat)
	assert.equal(raw.length, 72 * (1 + 72 * 4))
	assert.equal(raw[1 + 3], 0, 'top row transparent at 50%')
	assert.equal(raw[71 * (1 + 72 * 4) + 1 + 3], 255, 'bottom row filled')
})

test('release: cancels before the hold time; after it, a doneMs entry shows done then clears', async () => {
	const l = new Latch({ tickMs: 5, lingerMs: 500 })
	l.start('a', { label: 'STORE', doneLabel: 'STORED', holdMs: 40, fire: () => {}, doneMs: 30, showResult: false })
	assert.equal(l.release('a'), true) // early release cancels
	assert.equal(l.get('a'), null)
	l.start('b', { label: 'STORE', doneLabel: 'STORED', holdMs: 20, fire: () => {}, doneMs: 30, showResult: false })
	await new Promise((r) => setTimeout(r, 60))
	assert.equal(l.get('b').phase, 'sent')
	assert.equal(l.get('b').doneLabel, 'STORED')
	assert.equal(l.release('b'), true)
	assert.equal(l.get('b').phase, 'done')
	await new Promise((r) => setTimeout(r, 70))
	assert.equal(l.get('b'), null)
	l.start('c', { label: 'POWER', holdMs: 10, fire: () => {}, lingerMs: 500, showResult: false }) // no doneMs: release after firing does nothing
	await new Promise((r) => setTimeout(r, 40))
	assert.equal(l.release('c'), false)
	assert.equal(l.get('c').phase, 'sent')
	l.destroy()
})
