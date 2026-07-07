import { defineConfig, globalIgnores } from 'eslint/config';
import js from '@eslint/js';
import json from '@eslint/json';
import globals from 'globals';

export default defineConfig([
	globalIgnores([
		'node_modules',
		'po2lmo',
		'apk-tools',
	]),
	{
		files: ['**/*.json'],
		ignores: ['package-lock.json'],
		plugins: { json },
		language: 'json/json',
		extends: ['json/recommended'],
		rules: {
			'json/no-duplicate-keys': 'error',
		},
	},
	{
		files: ['htdocs/luci-static/resources/**/*.js'],
		language: '@/js',
		plugins: { js },
		extends: ['js/recommended'],
		linterOptions: {
			reportUnusedDisableDirectives: 'off',
		},
		languageOptions: {
			sourceType: 'script',
			ecmaVersion: 2026,
			globals: {
				...globals.browser,

				/* LuCI runtime / CBI exports */
				_: 'readonly',
				N_: 'readonly',
				L: 'readonly',
				E: 'readonly',
				TR: 'readonly',
				cbi_d: 'readonly',
				cbi_strings: 'readonly',
				cbi_d_add: 'readonly',
				cbi_d_check: 'readonly',
				cbi_d_checkvalue: 'readonly',
				cbi_d_update: 'readonly',
				cbi_init: 'readonly',
				cbi_update_table: 'readonly',
				cbi_validate_form: 'readonly',
				cbi_validate_field: 'readonly',
				cbi_validate_named_section_add: 'readonly',
				cbi_validate_reset: 'readonly',
				cbi_row_swap: 'readonly',
				cbi_tag_last: 'readonly',
				cbi_submit: 'readonly',
				cbi_dropdown_init: 'readonly',
				isElem: 'readonly',
				toElem: 'readonly',
				matchesElem: 'readonly',
				findParent: 'readonly',
				sfh: 'readonly',
				renderBadge: 'readonly',

				/* LuCI require() module aliases */
				baseclass: 'readonly',
				dom: 'readonly',
				firewall: 'readonly',
				form: 'readonly',
				fs: 'readonly',
				fwtool: 'readonly',
				network: 'readonly',
				poll: 'readonly',
				random: 'readonly',
				request: 'readonly',
				rpc: 'readonly',
				uci: 'readonly',
				ui: 'readonly',
				validation: 'readonly',
				view: 'readonly',
				widgets: 'readonly',

				/* HomeProxy LuCI module alias */
				hp: 'readonly',
			},
			parserOptions: {
				ecmaFeatures: {
					globalReturn: true,
				},
			},
		},
		rules: {
			'strict': 'off',
			'no-control-regex': 'off',
			'no-empty': 'off',
			'no-prototype-builtins': 'off',
			'no-regex-spaces': 'off',
			'no-undef': 'warn',
			'no-unused-vars': ['off', { caughtErrors: 'none' }],
		},
	},
]);
