// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const review = require('../../config/rinspace/brand-assets.review.json');
const { installBrandAssets, sourceUrl, validateBrandReview } = require('./install-brand-assets.cjs');

test('brand review locks the accepted Rinspace v0.2.4 bytes', () => {
	validateBrandReview(review);
	assert.equal(review.sourceCommit, 'be0f9d887a07a6b56af833840d59cec79b2a8655');
	assert.equal(sourceUrl(review.assets[0]), `https://raw.githubusercontent.com/rinspacehq/rinspace-web/${review.sourceCommit}/public/favicon.ico`);
});

test('brand installer rejects changed bytes before release assembly', async () => {
	const fixture = {
		...review,
		assets: review.assets.map((asset) => ({
			...asset,
			size: 4,
			sha256: crypto.createHash('sha256').update('ring').digest('hex'),
		})),
	};
	const root = await mkdtemp(path.join(tmpdir(), 'rinspace-brand-'));
	await installBrandAssets(fixture, root, async () => ({ status: 200, arrayBuffer: async () => Buffer.from('ring') }));
	assert.deepEqual(await readFile(path.join(root, 'public/favicon.ico')), Buffer.from('ring'));
	await assert.rejects(installBrandAssets(fixture, root, async () => ({ status: 200, arrayBuffer: async () => Buffer.from('fake') })), /brand digest mismatch/);
});
