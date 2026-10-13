// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import { validateAssetUrl, validateReview, measureAsset } from './review-external-assets.mjs';

const bytes = new TextEncoder().encode('fixed upstream public bytes');
const asset = { id: 'example', version: 'v1', url: 'https://github.com/TeXlyre/example/releases/download/v1/assets.zip',
	size: bytes.length, maxBytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };

test('external review keeps exact source archives and fixed release metadata', async () => {
	const review = JSON.parse(await readFile(new URL('../../config/rinspace/external-assets.review.json', import.meta.url), 'utf8'));
	const notices = JSON.parse(await readFile(new URL('../../config/rinspace/external-assets.notices.json', import.meta.url), 'utf8'));
	assert.equal(validateReview(review).assets.length, 7);
	assert.ok(review.assets.every((entry) => /^[0-9a-f]{64}$/.test(entry.sha256)));
	assert.ok(review.assets.every((entry) => Number.isSafeInteger(entry.size) && entry.size > 0));
	assert.equal(review.assets.filter((entry) => entry.extracted).length, 7);
	assert.equal(review.productionAccepted, false);
	assert.throws(() => validateReview({ ...review, productionAccepted: true }));
	assert.throws(() => validateReview({ ...review, assets: [{ ...review.assets[0], sha256: null }] }), /digest must be fixed/);
	assert.equal(notices.productionAccepted, true);
	assert.equal(notices.assets.length, 7);
	assert.ok(notices.assets.every((entry) => entry.releaseDecision === 'notice-present' ||
		entry.releaseDecision === 'included-by-formal-release-assembly'));
	assert.ok(notices.assets.every((entry) => entry.artifactNotice));
});

test('public asset URL rejects local services, credentials, ports and downgrade', () => {
	for (const url of ['http://github.com/file', 'https://127.0.0.1/file', 'https://github.com:8443/file',
		'https://username:password@github.com/file', 'https://github.com.attacker.example/file']) {
		assert.throws(() => validateAssetUrl(url), /unapproved/);
	}
});

test('streams bytes, compares known digests and never promotes a release', async () => {
	const result = await measureAsset(asset, async (_url, options) => {
		assert.equal(options.redirect, 'manual');
		assert.equal(options.credentials, 'omit');
		return new Response(bytes);
	});
	assert.equal(result.sha256, asset.sha256);
	assert.equal(result.productionAccepted, false);
	assert.equal(result.previouslyPinned, true);
});

test('refuses bad status, excess bytes, truncated input and digest changes', async () => {
	await assert.rejects(measureAsset(asset, async () => new Response('no', { status: 404 })), /download failed/);
	await assert.rejects(measureAsset({ ...asset, maxBytes: 1 }, async () => new Response(bytes)), /byte limit/);
	await assert.rejects(measureAsset(asset, async () => new Response(bytes.slice(1))), /size mismatch/);
	await assert.rejects(measureAsset({ ...asset, sha256: '0'.repeat(64) }, async () => new Response(bytes)), /digest mismatch/);
});

test('rejects an off-allowlist redirect before requesting its target', async () => {
	let requests = 0;
	await assert.rejects(measureAsset(asset, async () => {
		requests++;
		return new Response(null, { status: 302, headers: { location: 'https://127.0.0.1/private' } });
	}), /unapproved/);
	assert.equal(requests, 1);
});

test('permits a bounded approved CDN redirect without logging its query', async () => {
	let requests = 0;
	const result = await measureAsset(asset, async (url) => {
		if (++requests === 1) return new Response(null, { status: 302,
			headers: { location: 'https://release-assets.githubusercontent.com/public/archive?signature=ephemeral' } });
		assert.equal(new URL(url).hostname, 'release-assets.githubusercontent.com');
		return new Response(bytes);
	});
	assert.equal(requests, 2);
	assert.ok(!JSON.stringify(result).includes('signature'));
});
