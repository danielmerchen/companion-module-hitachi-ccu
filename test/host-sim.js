// Simulated Companion v2 host: builds the InstanceContext the real @companion-module/base InstanceBase
// requires, then drives the module's default-export class exactly as Companion would (init, definitions,
// feedback re-checks, action execution). Companion launches modules from its own runtime, so this is the
// closest in-process equivalent; it is not a full Companion.
// MODULE_ENTRY=/path/to/main.js runs the same tests against a packaged build instead of the source.
const Module = (
	await import(process.env.MODULE_ENTRY ? new URL(`file://${process.env.MODULE_ENTRY}`).href : '../main.js')
).default
import { sleep } from './mock-ccu.js'

export class Host {
	constructor() {
		this.vars = {}
		this.fbValues = {}
		this.status = null
		this.logs = []
		this.actions = {}
		this.feedbackDefs = {}
		this.varDefs = {}
		this.presets = {}
		this.structure = []
		this.subs = new Map()
		global.COMPANION_LOGGER = (_source, level, message) => this.logs.push({ level, message })
	}

	_context() {
		return {
			_isInstanceContext: true,
			id: 'test-conn',
			label: 'ccu1',
			upgradeScripts: [],
			saveConfig() {},
			updateStatus: (status, message) => {
				this.status = { status, message }
			},
			oscSend() {},
			recordAction() {},
			setActionDefinitions: (a) => (this.actions = a),
			subscribeActions() {},
			unsubscribeActions() {},
			setFeedbackDefinitions: (f) => (this.feedbackDefs = f),
			unsubscribeFeedbacks() {},
			checkFeedbacks: (types) => this._recheck(types),
			checkAllFeedbacks: () => this._recheck(null),
			checkFeedbacksById() {},
			setPresetDefinitions: (structure, presets) => {
				this.structure = structure
				this.presets = presets
			},
			setCompositeElementDefinitions() {},
			setVariableDefinitions: (v) => (this.varDefs = v),
			setVariableValues: (v) => Object.assign(this.vars, v),
			getVariableValue: (id) => this.vars[id],
			sharedUdpSocketHandlers: new Map(),
		}
	}

	async start(config) {
		this.instance = new Module(this._context())
		await this.instance.init(config, false, undefined)
		return { ok: true }
	}

	async _eval(sub) {
		const def = this.feedbackDefs[sub.feedbackId]
		this.fbValues[sub.id] = await def.callback(
			{
				type: def.type,
				id: sub.id,
				controlId: `ctl-${sub.id}`,
				feedbackId: sub.feedbackId,
				options: sub.options,
				previousOptions: null,
			},
			{ signal: new AbortController().signal },
		)
	}

	_recheck(types) {
		for (const sub of this.subs.values()) {
			if (!types || types.includes(sub.feedbackId)) this._eval(sub)
		}
	}

	async subscribeFeedbacks(defs) {
		for (const [id, feedbackId, options] of defs) {
			const sub = { id, feedbackId, options }
			this.subs.set(id, sub)
			await this._eval(sub)
		}
	}

	async execute(actionId, options = {}, controlId = 'ctl-x') {
		const def = this.actions[actionId]
		await def.callback(
			{ id: `act-${actionId}-${controlId}`, controlId, actionId, options, surfaceId: undefined },
			{ signal: new AbortController().signal, setCustomVariableValue() {} },
		)
		return { ok: true }
	}

	async reconfigure(config) {
		await this.instance.configUpdated(config, undefined)
	}

	async stop() {
		await Promise.race([this.instance?.destroy(), sleep(1000)])
	}
}
