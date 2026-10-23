/**
 * Press-and-hold latch, one per button (controlId). The action fires only if the button is held for
 * the full hold time; releasing early cancels. After firing, the entry lingers so the button can show
 * "SENT" and then the result.
 *
 * phases: holding -> sent | error -> (removed). showResult: wait for an auto-function result (settle()); otherwise the entry
 * clears after its own lingerMs (e.g. power).
 */
class Latch {
	constructor({ tickMs = 100, lingerMs = 40000, onChange = () => {}, now = () => Date.now() } = {}) {
		this.opts = { tickMs, lingerMs, onChange, now }
		this.entries = new Map()
	}

	start(id, { label, holdMs, fire, lingerMs = null, showResult = true, doneLabel = null, doneMs = null }) {
		if (this.entries.has(id)) return false // ignore a second press while holding / showing result
		const startedAt = this.opts.now()
		const entry = {
			id,
			label,
			holdMs,
			startedAt,
			phase: 'holding',
			firedAt: null,
			error: null,
			timer: null,
			linger: null,
			lingerMs,
			showResult,
			doneLabel,
			doneMs,
		}
		entry.timer = setInterval(() => {
			if (this.opts.now() - startedAt >= holdMs) this._fire(entry, fire)
			else this.opts.onChange(id)
		}, this.opts.tickMs)
		this.entries.set(id, entry)
		this.opts.onChange(id)
		return true
	}

	cancel(id) {
		const e = this.entries.get(id)
		if (!e || e.phase !== 'holding') return false
		clearInterval(e.timer)
		this.entries.delete(id)
		this.opts.onChange(id)
		return true
	}

	/**
	 * Button released. Before the hold time: cancel. After it, for entries that complete on release (`doneMs` set, e.g. a
	 * preset store done by the button's own long-release actions): show the done state for `doneMs`, then clear.
	 */
	release(id) {
		const e = this.entries.get(id)
		if (!e) return false
		if (e.phase === 'holding') return this.cancel(id)
		if (e.phase !== 'sent' || !e.doneMs) return false
		clearTimeout(e.linger)
		e.phase = 'done'
		e.linger = setTimeout(() => {
			this.entries.delete(id)
			this.opts.onChange(id)
		}, e.doneMs)
		this.opts.onChange(id)
		return true
	}

	_fire(entry, fire) {
		clearInterval(entry.timer)
		entry.timer = null
		entry.firedAt = this.opts.now()
		try {
			fire()
			entry.phase = 'sent'
		} catch (e) {
			entry.phase = 'error'
			entry.error = e.message
		}
		entry.linger = setTimeout(() => {
			this.entries.delete(entry.id)
			this.opts.onChange(entry.id)
		}, entry.lingerMs ?? this.opts.lingerMs)
		this.opts.onChange(entry.id)
	}

	/** The camera answered: keep showing the result for `ms`, then clear every entry that was waiting for it. */
	settle(ms) {
		for (const e of this.entries.values()) {
			if (e.phase !== 'sent') continue
			clearTimeout(e.linger)
			e.linger = setTimeout(() => {
				this.entries.delete(e.id)
				this.opts.onChange(e.id)
			}, ms)
		}
		this.opts.onChange()
	}

	/** Snapshot for a button, or null when idle. */
	get(id) {
		const e = this.entries.get(id)
		if (!e) return null
		const elapsed = this.opts.now() - e.startedAt
		return {
			phase: e.phase,
			label: e.label,
			progress: e.phase === 'holding' ? Math.min(1, elapsed / e.holdMs) : 1,
			remainingMs: e.phase === 'holding' ? Math.max(0, e.holdMs - elapsed) : 0,
			firedAt: e.firedAt,
			error: e.error,
			showResult: e.showResult,
			doneLabel: e.doneLabel,
			releasable: !!e.doneMs,
		}
	}

	destroy() {
		for (const e of this.entries.values()) {
			clearInterval(e.timer)
			clearTimeout(e.linger)
		}
		this.entries.clear()
	}
}

export { Latch }
