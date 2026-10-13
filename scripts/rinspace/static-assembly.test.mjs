// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function read(relative) {
	return readFile(new URL(`../../${relative}`, import.meta.url), 'utf8');
}

test('the Rinspace release assembles one self-contained /editor application', async () => {
	const [config, vite, worker, workerGenerator, html, manifestText] = await Promise.all([
		read('texlyre.config.ts'),
		read('vite.config.ts'),
		read('public/sw.js'),
		read('scripts/update-sw-version.js'),
		read('index.html'),
		read('public/manifest.json'),
	]);
	const manifest = JSON.parse(manifestText);

	assert.match(config, /url:\s*'https:\/\/rinspace\.com'/);
	assert.match(config, /baseUrl:\s*'\/editor\/'/);
	assert.match(config, /favicon:\s*'\.\/favicon\.ico'/);
	assert.match(vite, /const basePath = '\/editor\/';/);
	assert.match(worker, /const BASE_PATH = '\/editor\/';/);
	assert.match(worker, /const APP_CACHE_PREFIX = 'texlyre-app-shell-v';/);
	assert.match(worker, /const FONTS_CACHE_NAME = 'texlyre-fonts-v1';/);
	assert.match(workerGenerator, /const APP_CACHE_PREFIX = 'texlyre-app-shell-v';/);
	assert.match(workerGenerator, /const FONTS_CACHE_NAME = 'texlyre-fonts-v1';/);
	assert.match(html, /href="\.\/favicon\.ico"/);
	assert.match(html, /href="\.\/manifest\.json"/);
	assert.equal(manifest.start_url, './');
	assert.equal(manifest.share_target.action, './?share-target');
	assert.equal(manifest.file_handlers[0].action, './');
});

test('new public profiles use the verified browser-only compiler by default', async () => {
	const [config, desktop, mobile, localDesktop, localMobile] = await Promise.all([
		read('texlyre.config.ts'),
		read('userdata.json'),
		read('userdata.mobile.json'),
		read('userdata.local.json'),
		read('userdata.local.mobile.json'),
	]);

	assert.match(config, /latexEngine:\s*'busytex-pdftex'/);
	assert.match(config, /local:\s*\{[\s\S]*latexEngine:\s*'pdftex'/);
	for (const profile of [desktop, mobile]) {
		const parsed = JSON.parse(profile);
		assert.equal(parsed.settings['latex-engine'], 'busytex-pdftex');
		assert.equal(parsed.settings['file-sync-enable'], false);
		assert.ok(parsed.forceUpdate.settings.includes('file-sync-enable'));
	}
	for (const profile of [localDesktop, localMobile]) {
		const parsed = JSON.parse(profile);
		assert.equal(parsed.settings['latex-engine'], 'pdftex');
		assert.equal(parsed.settings['file-sync-enable'], false);
		assert.ok(parsed.forceUpdate.settings.includes('file-sync-enable'));
	}
});

test('the fixed CJK tree is mounted below the release base by digest', async () => {
	const [runtime, reviewText] = await Promise.all([
		read('src/extensions/texlyre-busytex/RinspaceCjkPackageSet.ts'),
		read('config/rinspace/texlive-cjk.review.json'),
	]);
	const review = JSON.parse(reviewText);

	assert.match(runtime, /`\$\{__BASE_PATH__\}\/assets\/\$\{RINSPACE_BUSY_TEXLIVE_ASSET_SET\}\/\$\{RINSPACE_BUSY_TEXLIVE_DIGEST\}`/);
	assert.match(review.inventorySha256, /^[0-9a-f]{64}$/);
	assert.equal(review.productionAccepted, false);
});
