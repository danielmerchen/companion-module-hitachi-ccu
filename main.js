import { InstanceBase, InstanceStatus, Regex } from '@companion-module/base'
import updateActions from './actions.js'
import updateFeedbacks from './feedbacks.js'
import updatePresets from './presets.js'
import updateVariableDefinitions, { valuesFromState } from './variables.js'
import { CcuClient, initialState } from './client.js'
import { Latch } from './latch.js'

export { UpgradeScripts } from './upgrades.js'

export default class HitachiCcuInstance extends InstanceBase {
	constructor(internal) {
		super(internal)
		this.client = null
		this.latch = new Latch({ onChange: () => this.checkFeedbacks('auto_hold', 'preset_hold') })
	}

	async init(config) {
		this.config = config
		this.updateStatus(InstanceStatus.Connecting)

		// Variables must be declared before their values are set.
		updateVariableDefinitions(this)
		this.setVariableValues(valuesFromState(initialState()))
		updateActions(this)
		updateFeedbacks(this)
		updatePresets(this)

		this.startClient()
	}

	async destroy() {
		this.latch.destroy()
		this.stopClient()
	}

	async configUpdated(config) {
		this.config = config
		this.startClient()
	}

	getConfigFields() {
		return [
			{
				type: 'textinput',
				id: 'host',
				label: 'CCU IP address',
				width: 8,
				regex: Regex.IP,
				default: '',
			},
			{
				type: 'number',
				id: 'port',
				label: 'CCU control port',
				width: 4,
				min: 1,
				max: 65535,
				default: 10001,
			},
			{
				type: 'number',
				id: 'pollMs',
				label: 'Poll interval (ms)',
				width: 6,
				min: 250,
				max: 10000,
				default: 1000,
			},
			{
				type: 'number',
				id: 'fstopWide',
				label: 'Lens wide-open f-stop (iris gauge: full)',
				width: 6,
				min: 0.5,
				max: 10,
				step: 0.1,
				default: 1.8,
			},
			{
				type: 'number',
				id: 'fstopClosed',
				label: 'Lens smallest f-stop (iris gauge: empty)',
				width: 6,
				min: 4,
				max: 64,
				step: 0.1,
				default: 22,
			},
			{
				type: 'checkbox',
				id: 'takeOnConnect',
				label: 'Send "Taken" (claim control) when connecting',
				width: 12,
				default: false,
			},
		]
	}

	stopClient() {
		if (this.client) {
			this.client.removeAllListeners()
			this.client.stop()
			this.client = null
		}
	}

	startClient() {
		this.stopClient()
		const host = (this.config?.host ?? '').trim()
		if (!host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No CCU IP address configured')
			this.setVariableValues(valuesFromState(initialState()))
			this.checkAllFeedbacks()
			return
		}
		const client = new CcuClient({
			host,
			port: Number(this.config.port) || 10001,
			pollMs: Number(this.config.pollMs) || 1000,
			takeOnConnect: !!this.config.takeOnConnect,
			log: (level, msg) => this.log(level, msg),
		})
		client.on('link', (link, detail) => this.applyLink(link, detail))
		client.on('change', (keys, state) => {
			if (keys.includes('autoResult')) this.latch.settle(5000)
			this.setVariableValues(valuesFromState(state))
			this.checkAllFeedbacks()
		})
		this.client = client
		this.setVariableValues(valuesFromState(client.getState()))
		client.start()
	}

	applyLink(link, detail) {
		switch (link) {
			case 'connecting':
				this.updateStatus(InstanceStatus.Connecting, detail)
				break
			case 'connected':
				this.updateStatus(InstanceStatus.Ok)
				break
			case 'no_reply':
				this.updateStatus(InstanceStatus.UnknownWarning, detail)
				break
			default:
				this.updateStatus(InstanceStatus.ConnectionFailure, detail)
		}
	}
}
