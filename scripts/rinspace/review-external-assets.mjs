// SPDX-License-Identifier: AGPL-3.0-or-later
// Source-development acquisition evidence, never an artifact acceptance claim.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const allowedHosts = new Set(['github.com', 'codeload.github.com',
	'release-assets.githubusercontent.com', 'objects.githubusercontent.com']);

export function validateAssetUrl(value) {
	const url = new URL(value);
	assert.ok(url.protocol === 'https:' && allowedHosts.has(url.hostname)
		&& !url.username && !url.password && (!url.port || url.port === '443'), 'unapproved public asset URL');
	return url;
}

export function validateReview(review) {
	assert.equal(review.schema, 'texlyre-external-asset-review/v1');
	assert.equal(review.stage, 'inventory-review');
	assert.equal(review.productionAccepted, false);
	assert.ok(Array.isArray(review.assets) && review.assets.length > 0);
	const ids = new Set();
	for (const asset of review.assets) {
		assert.match(asset.id, /^[a-z0-9-]+$/);
		assert.ok(!ids.has(asset.id), 'duplicate asset identity');
		ids.add(asset.id);
		const url = validateAssetUrl(asset.url);
		assert.ok(!url.search && !url.hash, 'initial asset URL must not contain credentials or fragments');
		assert.match(asset.repository, /^TeXlyre\/[a-zA-Z0-9-]+$/);
		assert.ok(Number.isSafeInteger(asset.maxBytes) && asset.maxBytes > 0 && asset.maxBytes <= 1024 * 1024 * 1024, 'invalid archive limit');
		assert.match(asset.sha256, /^[0-9a-f]{64}$/, 'asset digest must be fixed');
		assert.ok(Number.isSafeInteger(asset.size) && asset.size > 0 && asset.size <= asset.maxBytes, 'asset size must be fixed');
		if (asset.extracted !== undefined) {
			assert.ok(Number.isSafeInteger(asset.extracted.files) && asset.extracted.files > 0, 'invalid extracted file count');
			assert.ok(Number.isSafeInteger(asset.extracted.bytes) && asset.extracted.bytes > 0, 'invalid extracted byte count');
			assert.match(asset.extracted.inventorySha256, /^[0-9a-f]{64}$/, 'invalid extracted inventory digest');
		}
		if (asset.excludedUnsafeArchiveEntries !== undefined) {
			assert.ok(Number.isSafeInteger(asset.excludedUnsafeArchiveEntries) && asset.excludedUnsafeArchiveEntries > 0,
				'invalid excluded archive entry count');
		}
		if (asset.sourceCommit) {
			assert.match(asset.sourceCommit, /^[0-9a-f]{40}$/);
			assert.equal(url.href, `https://codeload.github.com/${asset.repository}/zip/${asset.sourceCommit}`);
		} else {
			assert.equal(url.hostname, 'github.com');
			assert.ok(url.pathname.startsWith(`/${asset.repository}/releases/download/`));
		}
		if (asset.buildSourceCommit) {
			assert.match(asset.buildSourceCommit, /^[0-9a-f]{40}$/);
		}
	}
	return review;
}

export async function measureAsset(asset, request = fetch) {
	let url = validateAssetUrl(asset.url);
	// This verifier also streams the fixed 522 MB BusyTeX archive.
	const signal = AbortSignal.timeout(45 * 60 * 1000);
	let response;
	for (let redirects = 0; redirects <= 5; redirects++) {
		response = await request(url.href, { redirect: 'manual', signal, credentials: 'omit' });
		if (![301, 302, 303, 307, 308].includes(response.status)) break;
		assert.ok(redirects < 5, 'too many asset redirects');
		const location = response.headers.get('location');
		assert.ok(location, 'asset redirect is missing a location');
		await response.body?.cancel();
		url = validateAssetUrl(new URL(location, url).href);
	}
	assert.equal(response.status, 200, `asset ${asset.id} download failed`);
	assert.ok(response.body, 'empty asset response');
	const hash = createHash('sha256');
	let size = 0;
	for await (const chunk of response.body) {
		size += chunk.byteLength;
		assert.ok(size <= asset.maxBytes, 'asset exceeds reviewed byte limit');
		hash.update(chunk);
	}
	const sha256 = hash.digest('hex');
	assert.ok(size > 0, 'empty asset download');
	assert.equal(size, asset.size, `asset ${asset.id} size mismatch`);
	assert.equal(sha256, asset.sha256, `asset ${asset.id} digest mismatch`);
	return { id: asset.id, version: asset.version, size, sha256,
		previouslyPinned: true, stage: 'inventory-review', productionAccepted: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const review = validateReview(JSON.parse(await readFile(new URL('../../config/rinspace/external-assets.review.json', import.meta.url), 'utf8')));
		for (const asset of review.assets) {
			console.log(JSON.stringify({ id: asset.id, stage: 'acquiring-public-archive' }));
			console.log(JSON.stringify(await measureAsset(asset)));
		}
	} catch (error) {
		// Avoid echoing presigned redirect URLs or response bodies into logs.
		console.error(`Public asset review failed: ${error.code ?? error.name}`);
		process.exitCode = 1;
	}
}
