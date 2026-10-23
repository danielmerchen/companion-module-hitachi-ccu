import net from 'node:net'
import { EventEmitter } from 'node:events'
import * as P from './protocol.js'
import { fstopTarget, stepFstopValue, IrisCurve } from './fstop.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const initialState = () => ({
	link: 'disconnected', // disconnected | connecting | connected | no_reply
	power: null, // true | false | null (unknown)
	iris: null, // signed -128..127 (commanded IRIS, mode 2E)
	irisMode: null, // 'REMOTE' | 'AUTO' | '?n'
	irisFollow: null, // 0..65535 (lens iris position, status 22)
	masterBlack: null, // signed -128..127 (mode 2B)
	extender: null, // 0 = x1, 1 = x2, 2 = x0.8 (mode 12, read only)
	camAlarm: null, // 0 none, 1 head fan, 2 head temperature (status 13, read only)
	fiberBits: null, // on/off mode 50 raw byte: 0x11 OK, 0x10 partial, 0x80 down (read only, from capture)
	linkStatus: null, // status 0F raw byte: 0x00 OK, 0x20 down (read only, from capture)
	autoResult: null, // { code, at } from the last auto function reply (40 00 RESULT)
})

/**
 * Owns the TCP connection to one CCU: reconnects, polls, parses replies into
 * `state`, and emits:
 *   'link'   (link, detail)        connection / reply-health changed
 *   'change' (changedKeys, state)  one or more state values changed
 * No Companion dependency, so it can be tested against a mock CCU.
 */
class CcuClient extends EventEmitter {
	constructor(opts = {}) {
		super()
		this.opts = {
			host: '',
			port: 10001,
			pollMs: 1000,
			takeOnConnect: false,
			connectTimeoutMs: 3000,
			reconnectMs: 2000,
			staleMs: null, // default: max(5000, pollMs * 5)
			readBackMs: 200,
			fstopMinMs: 250, // lens needs a moment to start moving before its position is meaningful
			fstopPollMs: 120,
			fstopMaxSettleMs: 3000,
			fstopStable: 3, // identical consecutive lens readings that mean "stopped"
			fstopMaxTries: 10,
			log: () => {},
			...opts,
		}
		this.state = initialState()
		this.sock = null
		this.parser = new P.FrameParser()
		this.stopped = true
		this.timers = { poll: null, reconnect: null, readBack: new Set() }
		this.lastRx = 0
		this.lastError = ''
		this.irisCurve = new IrisCurve() // IRIS command -> settled lens position for THIS lens, learned as it moves
		this._fs = null // the f-stop move in progress, if any
	}

	start() {
		this.stopped = false
		this._connect()
	}

	stop() {
		this.stopped = true
		clearInterval(this.timers.poll)
		clearTimeout(this.timers.reconnect)
		this.timers.readBack.forEach(clearTimeout)
		this.timers.readBack.clear()
		this.timers.poll = this.timers.reconnect = null
		if (this.sock) {
			this.sock.removeAllListeners()
			this.sock.on('error', () => {})
			this.sock.destroy()
			this.sock = null
		}
		this._setLink('disconnected', 'stopped')
	}

	getState() {
		return { ...this.state }
	}

	// ---- connection -----------------------------------------------------
	_connect() {
		if (this.stopped) return
		if (!this.opts.host) return this._setLink('disconnected', 'no host configured')
		this._setLink('connecting', `${this.opts.host}:${this.opts.port}`)
		this.parser = new P.FrameParser()
		const sock = net.createConnection({ host: this.opts.host, port: this.opts.port })
		this.sock = sock
		sock.setNoDelay(true)
		sock.setKeepAlive(true, 10000)
		sock.setTimeout(this.opts.connectTimeoutMs)
		sock.on('connect', () => {
			sock.setTimeout(0)
			this.lastRx = Date.now()
			this._setLink('connected', `${this.opts.host}:${this.opts.port}`)
			if (this.opts.takeOnConnect) this._write([P.FRAMES.TAKE])
			this.poll()
			clearInterval(this.timers.poll)
			this.timers.poll = setInterval(() => this._tick(), Math.max(250, this.opts.pollMs))
		})
		sock.on('data', (chunk) => this._onData(chunk))
		sock.on('timeout', () => sock.destroy(new Error('connect timeout')))
		sock.on('error', (e) => {
			this.lastError = e.message
		})
		sock.on('close', () => {
			if (this.sock !== sock) return
			this.sock = null
			clearInterval(this.timers.poll)
			this.timers.poll = null
			if (this.stopped) return
			this._setLink('disconnected', this.lastError || 'connection closed')
			this.timers.reconnect = setTimeout(() => this._connect(), this.opts.reconnectMs)
		})
	}

	_setLink(link, detail = '') {
		const changed = this.state.link !== link
		this.state.link = link
		if (changed || detail !== this._lastDetail) {
			this._lastDetail = detail
			this.emit('link', link, detail)
			if (changed) this.emit('change', ['link'], this.getState())
		}
	}

	_tick() {
		const stale = this.opts.staleMs ?? Math.max(5000, this.opts.pollMs * 5)
		if (this.state.link === 'connected' && Date.now() - this.lastRx > stale) {
			this._setLink('no_reply', `no reply from CCU for ${Math.round(stale / 1000)}s`)
		}
		this.poll()
	}

	_onData(chunk) {
		const changed = []
		this.lastRx = Date.now()
		if (this.state.link === 'no_reply') this._setLink('connected', `${this.opts.host}:${this.opts.port}`)
		for (const dt of this.parser.push(chunk)) {
			const update = P.interpret(dt)
			if (!update) continue
			for (const [k, v] of Object.entries(update)) {
				if (this.state[k] !== v) {
					this.state[k] = v
					changed.push(k)
				}
			}
		}
		if (changed.length) this.emit('change', changed, this.getState())
	}

	// ---- I/O --------------------------------------------------------------
	_write(dts) {
		if (!this.sock || this.state.link === 'disconnected' || this.state.link === 'connecting') {
			throw new Error('not connected to CCU')
		}
		const buf = Buffer.concat(dts.map((dt) => P.buildFrame(dt)))
		this.opts.log('debug', `tx ${buf.toString('latin1')}`)
		this.sock.write(buf)
	}

	/** Request every value we track (the CCU also pushes updates on its own). */
	poll() {
		try {
			this._write([
				P.FRAMES.READ_POWER,
				P.FRAMES.READ_IRIS,
				P.FRAMES.READ_MASTER_BLACK,
				P.FRAMES.READ_IRIS_FOLLOW,
				P.FRAMES.READ_IRIS_MODE,
				P.FRAMES.READ_EXTENDER,
				P.FRAMES.READ_CAM_ALARM,
				P.FRAMES.READ_FIBER,
				P.FRAMES.READ_LINK,
			])
		} catch (e) {
			this.opts.log('debug', `poll skipped: ${e.message}`)
		}
	}

	_readSoon(frame, ms = this.opts.readBackMs) {
		const t = setTimeout(() => {
			this.timers.readBack.delete(t)
			try {
				this._write([frame])
			} catch {
				/* ignore: reconnect logic will resync */
			}
		}, ms)
		this.timers.readBack.add(t)
	}

	// ---- commands ---------------------------------------------------------
	power(on) {
		this._write([on ? P.FRAMES.POWER_ON : P.FRAMES.POWER_OFF])
		// Power-on can take ~1.3 s to show up; read back a few times.
		for (const ms of [300, 1500, 3000]) this._readSoon(P.FRAMES.READ_POWER, ms)
	}

	togglePower() {
		if (this.state.power === null) throw new Error('power state unknown yet; cannot toggle')
		this.power(!this.state.power)
	}

	take() {
		this._write([P.FRAMES.TAKE])
		this._readSoon(P.FRAMES.READ_IRIS_MODE)
	}

	_setAnalog(mode, key, readFrame, value, clamp = P.clampSigned8) {
		const v = clamp(value)
		// The CCU silently ignores analog sets unless the analog control right was claimed; re-claiming
		// every time is cheap and survives the CCU revoking it (e.g. around power-on).
		this._write([P.FRAMES.CLAIM_ANALOG, P.analogSet(mode, v)])
		// Optimistic update so repeated step presses accumulate; the read-back corrects it.
		if (this.state[key] !== v) {
			this.state[key] = v
			this.emit('change', [key], this.getState())
		}
		this._readSoon(readFrame)
		return v
	}

	setIris(value) {
		return this._setAnalog(P.MODE.IRIS, 'iris', P.FRAMES.READ_IRIS, value, P.clampQuarter)
	}

	setMasterBlack(value) {
		return this._setAnalog(P.MODE.MASTER_BLACK, 'masterBlack', P.FRAMES.READ_MASTER_BLACK, value)
	}

	/** Read the lens position until it stops changing; returns the settled value. */
	async _settleFollow() {
		await sleep(this.opts.fstopMinMs)
		const end = Date.now() + this.opts.fstopMaxSettleMs
		let last = null
		let stable = 0
		while (Date.now() < end) {
			this._write([P.FRAMES.READ_IRIS_FOLLOW])
			await sleep(this.opts.fstopPollMs)
			const f = this.state.irisFollow
			if (f === last) {
				if (++stable >= this.opts.fstopStable - 1) return f
			} else {
				last = f
				stable = 0
			}
		}
		return this.state.irisFollow
	}

	/**
	 * The f-stop move. The IRIS command that lands on a target comes from the learned lens curve (seeded from measured data),
	 * is sent in quarter steps like the RCP, and every settled result refines the curve, so a move normally takes one or two
	 * commands instead of creeping up on the target.
	 */
	async _runFstop(job) {
		try {
			for (;;) {
				if (this.state.irisMode !== 'REMOTE') throw new Error(`IRIS mode is ${this.state.irisMode ?? 'unknown'}, not REMOTE`)
				const target = job.target
				let cmd = P.clampQuarter(this.irisCurve.cmdFor(target))
				// A command that was already tried and did not land: nudge one quarter step toward the target instead of repeating it.
				if (cmd <= job.lastCmd + 0.25 && cmd >= job.lastCmd - 0.25 && job.lastF !== null) {
					// The curve says (almost) the command we just sent, yet the lens is not there: it is on a plateau. Widen the nudge each time.
					job.nudge = job.lastF === job.prevF ? job.nudge * 2 : 0.25
					cmd = P.clampQuarter(job.lastCmd + (job.lastF > target ? job.nudge : -job.nudge))
				} else job.nudge = 0.25
				job.prevF = job.lastF
				job.lastCmd = cmd
				this.setIris(cmd)
				const f = await this._settleFollow()
				if (f === null || f >= 0xff00) throw new Error('lens position unavailable (no lens or fully closed)')
				job.lastF = f
				this.irisCurve.add(cmd, f)
				if (job.target !== target) {
					job.tries = 0 // a new request arrived while the lens was moving: aim at that instead
					if (f === job.target) break
					continue
				}
				if (f === target) break
				job.tries++
				if (Math.abs(f - target) <= 1 && job.tries >= 4) {
					this.irisCurve.add(cmd, target) // good enough: remember this command for the target so a repeat is one command
					break
				}
				if (job.tries >= this.opts.fstopMaxTries) throw new Error(`could not reach f/${target / 10}; lens is at f/${f / 10}`)
			}
			for (const w of job.waiters) w.resolve(job.lastF / 10)
		} catch (e) {
			for (const w of job.waiters) w.reject(e)
		} finally {
			this._fs = null
		}
	}

	/** Start an f-stop move, or retarget the one in progress (no queue: repeated presses just move the target). */
	async _requestFstop(computeTarget) {
		const t = computeTarget()
		const target = t instanceof Promise ? await t : t // stay synchronous when possible so rapid requests apply in call order
		return new Promise((resolve, reject) => {
			if (this._fs) {
				this._fs.target = target
				this._fs.waiters.push({ resolve, reject })
				return
			}
			if (this.state.irisMode !== 'REMOTE') return reject(new Error(`IRIS mode is ${this.state.irisMode ?? 'unknown'}, not REMOTE`))
			this._fs = { target, tries: 0, lastCmd: null, lastF: null, prevF: null, nudge: 0.25, waiters: [{ resolve, reject }] }
			this._runFstop(this._fs)
		})
	}

	/** Drive the lens to an absolute f-number. */
	setFstop(fstop) {
		return this._requestFstop(() => fstopTarget(fstop))
	}

	/** Move the lens by `stops` (positive = close, negative = open), relative to where it is now (or is already headed). */
	stepFstop(stops) {
		const stepFrom = (base) => {
			if (base >= 0xff00) throw new Error('lens position unavailable (no lens or fully closed)')
			return fstopTarget(stepFstopValue(base / 10, stops))
		}
		return this._requestFstop(() => (this._fs ? stepFrom(this._fs.target) : this._current('irisFollow', P.FRAMES.READ_IRIS_FOLLOW).then(stepFrom)))
	}

	/** Auto white / auto black. Both store their result in camera memory; the reply arrives as state.autoResult. */
	autoWhite() {
		this._write([P.FRAMES.AUTO_WHITE])
	}

	autoBlack() {
		this._write([P.FRAMES.AUTO_BLACK])
	}

	async _current(key, readFrame, timeoutMs = 1000) {
		if (this.state[key] !== null) return this.state[key]
		this._write([readFrame])
		await new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.off('change', onChange)
				reject(new Error(`${key} unknown (no reply to read request)`))
			}, timeoutMs)
			const onChange = (changed) => {
				if (changed.includes(key)) {
					clearTimeout(timer)
					this.off('change', onChange)
					resolve()
				}
			}
			this.on('change', onChange)
		})
		return this.state[key]
	}

	async stepIris(delta) {
		return this.setIris((await this._current('iris', P.FRAMES.READ_IRIS)) + delta)
	}

	async stepMasterBlack(delta) {
		return this.setMasterBlack((await this._current('masterBlack', P.FRAMES.READ_MASTER_BLACK)) + delta)
	}
}

export { CcuClient, initialState }
