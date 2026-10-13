// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

async function read(relative) {
	return readFile(new URL(`../../${relative}`, import.meta.url), 'utf8');
}

test('the Rinspace release assembles one self-contained /editor application', async () => {
	const [config, vite, worker, workerGenerator, html, manifestText, authApp, projectApp, splash, footer] = await Promise.all([
		read('texlyre.config.ts'),
		read('vite.config.ts'),
		read('public/sw.js'),
		read('scripts/update-sw-version.js'),
		read('index.html'),
		read('public/manifest.json'),
		read('src/components/app/AuthApp.tsx'),
		read('src/components/app/ProjectApp.tsx'),
		read('src/components/common/SplashScreen.tsx'),
		read('src/components/common/FooterLinks.tsx'),
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
	assert.match(html, /href="\.\/apple-touch-icon\.png"/);
	assert.match(html, /<title>Rinspace Online Editor<\/title>/);
	assert.match(html, /href="\.\/manifest\.json"/);
	assert.equal(manifest.name, 'Rinspace');
	assert.equal(manifest.icons[0].src, './favicon-192x192.png');
	assert.equal(manifest.icons[1].src, './favicon-512x512.png');
	assert.equal(manifest.start_url, './');
	assert.equal(manifest.share_target.action, './?share-target');
	assert.equal(manifest.file_handlers[0].action, './');
	for (const component of [authApp, projectApp, splash, footer]) {
		assert.match(component, /assets\/brand\/rinspace-mark-128\.png/);
		assert.doesNotMatch(component, /TeXlyre_notext/);
	}
});

test('new public profiles use the verified browser-only compiler by default', async () => {
	const [config, desktop, mobile, localDesktop, localMobile] = await Promise.all([
		read('texlyre.config.ts'),
		read('userdata.json'),
		read('userdata.mobile.json'),
		read('userdata.local.json'),
		read('userdata.local.mobile.json'),
	]);

	assert.match(config, /title:\s*'Rinspace Online Editor'/);
	assert.match(config, /latexEngine:\s*'busytex-xetex'/);
	assert.match(config, /latexBusytexEndpoint:\s*'\/editor\/texlive\/2026'/);
	assert.match(config, /local:\s*\{[\s\S]*latexEngine:\s*'pdftex'/);
	for (const profile of [desktop, mobile]) {
		const parsed = JSON.parse(profile);
		assert.equal(parsed.settings['latex-engine'], 'busytex-xetex');
		assert.equal(parsed.settings['latex-busytex-endpoint'], '/editor/texlive/2026');
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

test('the complete fixed TeX Live runtime is locked to the same-origin endpoint', async () => {
	const [runtime, reviewText] = await Promise.all([
		read('scripts/rinspace/texlive-runtime.cjs'),
		read('config/rinspace/texlive-full-runtime.review.json'),
	]);
	const review = JSON.parse(reviewText);

	assert.equal(review.endpointBasePath, '/editor/texlive/2026');
	assert.equal(review.treeList.lines, 189331);
	assert.equal(review.texmfRegularFiles, 180810);
	assert.match(review.archive.sha256, /^[0-9a-f]{64}$/);
	assert.match(runtime, /cache-control': 'public, max-age=31536000, immutable'/);
});
