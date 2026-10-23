// A small simulated CCU for tests. Behaviour mirrors what the captures showed:
// read requests are answered, power-off is immediate, power-on lags, set commands are silent.
import net from 'node:net'
import * as P from '../protocol.js'

class MockCcu {
	constructor(opts = {}) {
		this.state = {
			power: true,
			iris: 0,
			masterBlack: -13,
			irisFollow: 0x003d,
			irisModeRaw: 0x04,
			extender: 0,
			camAlarm: 0,
			fiberBits: 0x11,
			linkStatus: 0x00,
			autoCode: 0x00,
			...opts.state,
		}
		this.silent = !!opts.silent
		// Lens: the settled position for an IRIS command (units), and how fast it gets there (follow units per 50 ms; 0 = instantly).
		this.lensCurve = opts.lensCurve ?? ((i) => Math.max(18, Math.round(61 - 0.4 * i)))
		this.lensSlew = opts.lensSlew ?? 0
		this.iris16 = this.state.iris // exact command in units (upper byte whole, lower byte quarter steps)
		this.lensTimer = null
		this.powerOnDelayMs = opts.powerOnDelayMs ?? 100
		this.received = [] // every decoded DT payload received
		this.sockets = new Set()
		this.connections = 0
		this.server = net.createServer((s) => this._onConnection(s))
	}

	async listen() {
		await new Promise((r) => this.server.listen(0, '127.0.0.1', r))
		this.port = this.server.address().port
		return this.port
	}

	async close() {
		clearInterval(this.lensTimer)
		this.dropAll()
		await new Promise((r) => this.server.close(r))
	}

	dropAll() {
		for (const s of this.sockets) s.destroy()
		this.sockets.clear()
	}

	push(dt) {
		for (const s of this.sockets) s.write(P.buildFrame(Buffer.from(dt)))
	}

	count(dt) {
		const key = Buffer.from(dt).toString('hex')
		return this.received.filter((r) => r.toString('hex') === key).length
	}

	_onConnection(sock) {
		this.connections++
		this.sockets.add(sock)
		const parser = new P.FrameParser()
		sock.on('error', () => {})
		sock.on('close', () => this.sockets.delete(sock))
		sock.on('data', (chunk) => {
			for (const dt of parser.push(chunk)) {
				this.received.push(dt)
				this._handle(sock, dt)
			}
		})
	}

	_moveLens(target) {
		clearInterval(this.lensTimer)
		if (!this.lensSlew) {
			this.state.irisFollow = target
			return
		}
		this.lensTimer = setInterval(() => {
			const d = target - this.state.irisFollow
			this.state.irisFollow += Math.abs(d) <= this.lensSlew ? d : Math.sign(d) * this.lensSlew
			if (this.state.irisFollow === target) clearInterval(this.lensTimer)
		}, 50)
	}

	_reply(sock, dt) {
		if (!this.silent && !sock.destroyed) sock.write(P.buildFrame(Buffer.from(dt)))
	}

	_handle(sock, dt) {
		const s = this.state
		const key = dt.toString('hex')
		const sbyte = (v) => v & 0xff
		if (key === '2322') this._reply(sock, [0x22, 0x22, s.power ? 1 : 0])
		else if (key === '332e')
			this._reply(sock, [
				0x32,
				0x2e,
				(Math.round(this.iris16 * 256) & 0xffff) >> 8,
				Math.round(this.iris16 * 256) & 0xff,
			])
		else if (key === '332b') this._reply(sock, [0x32, 0x2b, sbyte(s.masterBlack), 0x00])
		else if (key === '1322') this._reply(sock, [0x12, 0x22, s.irisFollow >> 8, s.irisFollow & 0xff])
		else if (key === '2304') this._reply(sock, [0x22, 0x04, s.irisModeRaw])
		else if (key === '080 0ff'.replace(/ /g, '')) this._reply(sock, [0x0a, 0x01, 0xff])
		else if (key === '2312') this._reply(sock, [0x22, 0x12, s.extender])
		else if (key === '1313') this._reply(sock, [0x12, 0x13, s.camAlarm])
		else if (key === '2350') this._reply(sock, [0x22, 0x50, s.fiberBits])
		else if (key === '130f') this._reply(sock, [0x12, 0x0f, s.linkStatus])
		else if (key === '4010' || key === '4020') this._reply(sock, [0x40, 0x00, s.autoCode])
		else if (key === '202200fe') s.power = false
		else if (key === '202201fe') setTimeout(() => (s.power = true), this.powerOnDelayMs)
		else if (key === '0802ff00') {
			sock.analogOk = true
			this._reply(sock, [0x0a, 0x03, 0xff])
		}
		// Like the real CCU: analog sets are silently ignored until the analog control right is claimed.
		else if (dt[0] === 0x30 && dt[1] === 0x2e && sock.analogOk) {
			const u = (dt[2] << 8) | dt[3]
			this.iris16 = (u >= 0x8000 ? u - 0x10000 : u) / 256 // upper byte whole units, lower byte quarter steps
			s.iris = P.toSigned8(dt[2])
			this._moveLens(this.lensCurve(this.iris16))
		} else if (dt[0] === 0x30 && dt[1] === 0x2b && sock.analogOk) s.masterBlack = P.toSigned8(dt[2])
	}
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function waitFor(fn, timeoutMs = 3000, stepMs = 20) {
	const end = Date.now() + timeoutMs
	for (;;) {
		const v = await fn()
		if (v) return v
		if (Date.now() > end) throw new Error('waitFor timed out')
		await sleep(stepMs)
	}
}

export { MockCcu, sleep, waitFor }
