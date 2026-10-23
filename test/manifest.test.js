import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

// The build tool stamps the version into the packaged manifest, but the source copy is what GitHub shows: keep them equal.
test('companion/manifest.json version matches package.json', () => {
	const pkg = JSON.parse(fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
	const manifest = JSON.parse(fs.readFileSync(new URL('../companion/manifest.json', import.meta.url), 'utf8'))
	assert.equal(manifest.version, pkg.version)
	assert.notEqual(manifest.version, '0.0.0')
})
