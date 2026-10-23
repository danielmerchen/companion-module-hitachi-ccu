import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const baseConfig = await generateEslintConfig({})

export default [
	...baseConfig,
	{
		// The shared config parses plain .js as CommonJS; this module is ESM ("type": "module").
		files: ['**/*.js'],
		languageOptions: { sourceType: 'module' },
	},
]
