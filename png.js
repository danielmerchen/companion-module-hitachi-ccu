import zlib from 'node:zlib'

const CRC_TABLE = (() => {
	const t = new Uint32Array(256)
	for (let n = 0; n < 256; n++) {
		let c = n
		for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
		t[n] = c >>> 0
	}
	return t
})()

function crc32(buf) {
	let c = 0xffffffff
	for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
	return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
	const len = Buffer.alloc(4)
	len.writeUInt32BE(data.length)
	const td = Buffer.concat([Buffer.from(type, 'ascii'), data])
	const crc = Buffer.alloc(4)
	crc.writeUInt32BE(crc32(td))
	return Buffer.concat([len, td, crc])
}

/** RGBA PNG (base64) of a size x size square with the bottom `fraction` filled with `rgba`, rest transparent. */
function progressFill(fraction, rgba, size = 72) {
	const filled = Math.round(Math.max(0, Math.min(1, fraction)) * size)
	const row = Buffer.alloc(1 + size * 4)
	const rows = []
	for (let y = 0; y < size; y++) {
		const r = Buffer.from(row)
		if (y >= size - filled) for (let x = 0; x < size; x++) r.set(rgba, 1 + x * 4)
		rows.push(r)
	}
	const ihdr = Buffer.alloc(13)
	ihdr.writeUInt32BE(size, 0)
	ihdr.writeUInt32BE(size, 4)
	ihdr[8] = 8 // bit depth
	ihdr[9] = 6 // RGBA
	const png = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', zlib.deflateSync(Buffer.concat(rows))),
		chunk('IEND', Buffer.alloc(0)),
	])
	return png.toString('base64')
}

export { progressFill, crc32 }
