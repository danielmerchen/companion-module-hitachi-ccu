// Lens iris position (status 22) is f-number * 10, hardware-calibrated on the test lens.
const FSTOP_MIN = 1
const FSTOP_MAX = 32

// IRIS command -> SETTLED lens position, measured on the Z-HD5500 test lens on 2026-10-06 (each command held until the lens stopped).
// An earlier table taken during a fast RCP sweep was off by several command units in mid-range because the lens lags a moving command.
// Only a starting point: IrisCurve learns this lens as it moves, so a different lens converges after a move or two.
const SEED = [
	[127, 18],
	[92, 20],
	[66, 28],
	[36, 40],
	[21, 48],
	[15, 51],
	[14, 52],
	[11, 54],
	[8, 55],
	[7, 56],
	[5, 58],
	[1, 60],
	[-1, 62],
	[-3, 63],
	[-7, 66],
	[-11, 69],
	[-13, 71],
	[-19, 76],
	[-22, 79],
	[-24, 81],
	[-42, 100],
	[-50, 109],
	[-81, 158],
	[-83, 160],
	[-85, 165],
	[-118, 220],
]

/** Settled lens position (tenths of an f-stop) as a function of the IRIS command, interpolated and learned from every move. */
class IrisCurve {
	constructor(seed = SEED) {
		this.points = new Map(seed.map(([cmd, follow]) => [follow, cmd]))
		this.seeded = new Set(this.points.keys()) // positions that are still unmeasured seed data
	}

	/** Record where the lens settled for a command. The newest measurement for a position wins. */
	add(cmd, follow) {
		if (Number.isFinite(cmd) && Number.isInteger(follow) && follow > 0 && follow < 0xff00) {
			// Keep the curve monotonic (more closed = lower command): a fresh measurement overrides older points that contradict it.
			// A contradiction means the seed is from a different lens, so all remaining seed data is dropped, not just that point.
			let contradicted = false
			for (const [f, c] of [...this.points]) {
				if ((f < follow && c <= cmd) || (f > follow && c >= cmd)) {
					this.points.delete(f)
					contradicted = true
				}
			}
			if (contradicted) for (const f of this.seeded) this.points.delete(f)
			this.seeded.delete(follow)
			this.points.set(follow, cmd)
		}
	}

	/** The IRIS command expected to settle at `target`: exact if seen, else interpolated (or extrapolated off either end). */
	cmdFor(target) {
		if (this.points.has(target)) return this.points.get(target)
		const pts = [...this.points].sort((a, b) => a[0] - b[0]) // [follow, cmd] by follow
		if (pts.length === 1) return pts[0][1] + (pts[0][0] - target) * 3 // one point only: assume a typical slope
		let i = pts.findIndex(([f]) => f > target)
		if (i === -1)
			i = pts.length - 1 // beyond the closed end: extrapolate from the last two
		else if (i === 0) i = 1 // beyond the open end: extrapolate from the first two
		const [f0, c0] = pts[i - 1]
		const [f1, c1] = pts[i]
		return c0 + ((c1 - c0) * (target - f0)) / (f1 - f0)
	}
}

/** f-number -> lens position target (tenths), validated. */
function fstopTarget(fstop) {
	const f = Number(fstop)
	if (!Number.isFinite(f) || f < FSTOP_MIN || f > FSTOP_MAX)
		throw new Error(`f-stop ${fstop} out of range ${FSTOP_MIN}..${FSTOP_MAX}`)
	return Math.round(f * 10)
}

/** Next f-number after moving `stops` stops (positive = closing) from `fstop`; always moves at least 0.1. */
function stepFstopValue(fstop, stops) {
	const next = Math.round(fstop * Math.pow(2, Number(stops) / 2) * 10) / 10
	if (next === fstop && Number(stops) !== 0) return Math.round((fstop + (Number(stops) > 0 ? 0.1 : -0.1)) * 10) / 10
	return next
}

export { FSTOP_MIN, FSTOP_MAX, SEED, IrisCurve, fstopTarget, stepFstopValue }
