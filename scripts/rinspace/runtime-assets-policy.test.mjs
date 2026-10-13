// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function read(relative) {
	return readFile(new URL(`../../${relative}`, import.meta.url), 'utf8');
}

test('default browser profiles do not contact TeXlyre runtime services', async () => {
	for (const filename of ['userdata.json', 'userdata.mobile.json']) {
		const data = JSON.parse(await read(filename));
		assert.equal(data.version, '1.3.7');
		assert.equal(data.settings['latex-texlive-endpoint'], '');
		assert.equal(data.settings['latex-busytex-endpoint'], '');
		assert.equal(data.settings['status-json-url'], '');
		assert.equal(data.settings['status-page-url'], '');
		assert.ok(
			!JSON.stringify(data).includes('https://texlive.texlyre.org'),
		);
		assert.ok(
			!JSON.stringify(data).includes('https://texlive2026.texlyre.org'),
		);
		assert.ok(!JSON.stringify(data).includes('raw.githubusercontent.com'));
		assert.ok(data.forceUpdate.settings.includes('latex-texlive-endpoint'));
		assert.ok(data.forceUpdate.settings.includes('latex-busytex-endpoint'));
		assert.ok(data.forceUpdate.settings.includes('status-json-url'));
		assert.ok(data.forceUpdate.settings.includes('status-page-url'));
	}
});

test('local development profiles retain explicit localhost package endpoints', async () => {
	for (const filename of ['userdata.local.json', 'userdata.local.mobile.json']) {
		const data = JSON.parse(await read(filename));
		assert.match(data.settings['latex-texlive-endpoint'], /^http:\/\/localhost:/);
		assert.match(data.settings['latex-busytex-endpoint'], /^http:\/\/localhost:/);
	}
});

test('Typst compiler and renderer share the same-origin font loader', async () => {
	const runtime = await read(
		'src/extensions/typst.ts/TypstRendererRuntime.ts',
	);
	const worker = await read('src/extensions/typst.ts/typst-worker.ts');
	assert.match(runtime, /loadFonts\(fonts, \{ assets: false \}\)/);
	assert.match(worker, /createLocalTypstFontLoader\(\)/);
	assert.ok(!runtime.includes('cdn.jsdelivr.net'));
	assert.ok(!worker.includes('cdn.jsdelivr.net'));
});

test('blank LaTeX package settings resolve only to fixed same-origin paths', async () => {
	const swift = await read(
		'src/extensions/swiftlatex/SwiftLaTeXService.ts',
	);
	const busy = await read(
		'src/extensions/texlyre-busytex/BusyTeXService.ts',
	);
	const cjk = await read(
		'src/extensions/texlyre-busytex/RinspaceCjkPackageSet.ts',
	);
	assert.match(swift, /LOCAL_TEXLIVE_ENDPOINT/);
	assert.match(swift, /endpoint\.trim\(\) \|\| LOCAL_TEXLIVE_ENDPOINT/);
	assert.match(busy, /loadRinspaceCjkPackageSet/);
	assert.match(busy, /!this\.texliveEndpoint/);
	assert.match(cjk, /RINSPACE_BUSY_TEXLIVE_ASSET_ROOT/);
	assert.match(cjk, /crypto\.subtle\.digest\('SHA-256'/);
	assert.match(cjk, /credentials: 'same-origin'/);
	assert.ok(!swift.includes('texlive.localhost'));
	assert.ok(!busy.includes('texlive.localhost'));
});
