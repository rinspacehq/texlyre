// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { validateDeclarations } from './check-source.mjs';

const baseline = JSON.parse(readFileSync(new URL('../../config/rinspace/upstream-baseline.json', import.meta.url), 'utf8'));
const pkg = JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8'));
const validate = (source = baseline, manifest = pkg, nodeVersion = '24.13.1') => validateDeclarations(source, manifest, nodeVersion);

test('fixed declarations retain upstream AGPL and fork identity', () => validate());
for (const [label, change] of [
	['mutable upstream input', (b) => { b.upstream.commit = 'main'; }],
	['personal namespace', (b) => { b.repository = 'lunifans/texlyre'; }],
	['wrong upstream', (b) => { b.upstream.repository = 'another/texlyre'; }],
	['missing license digest', (b) => { delete b.upstream.licenseSha256; }],
	['missing reviewed fork lock', (b) => { delete b.toolchain.lockfileSha256; }],
	['changed license', (b) => { b.license = 'MIT'; }],
	['floating package manager', (b) => { b.toolchain.packageManager = 'pnpm@latest'; }],
	['unreviewed Node version', (b) => { b.toolchain.node = '24.14.0'; }],
	['false production acceptance', (b) => { b.productionAccepted = true; }],
]) {
	test(`reject ${label}`, () => {
		const source = structuredClone(baseline);
		change(source);
		assert.throws(() => validate(source));
	});
}
test('package cannot change its license independently', () => {
	assert.throws(() => validate(baseline, { ...pkg, license: 'AGPL-3.0-only' }));
});
test('the Node version file must match the reviewed pin', () => {
	assert.throws(() => validate(baseline, pkg, '22.22.3'));
});
test('build source fixers are rejected', () => {
	for (const command of ['vite build && pnpm lint:biome:fix', 'vite build && biome check --fix']) {
		assert.throws(() => validate(baseline, { ...pkg, scripts: { ...pkg.scripts, 'build:prod': command } }));
	}
});
test('reviewed source generation cannot run inside the production build', () => {
	for (const command of ['pnpm prepare:source', 'pnpm generate:configs', 'pnpm generate:userdata-interfaces',
		'pnpm i18n:coverage', 'tsx scripts/update-sw-version.js']) {
		assert.throws(() => validate(baseline, { ...pkg, scripts: { ...pkg.scripts, 'build:prod': command } }));
	}
});
