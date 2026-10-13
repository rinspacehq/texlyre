// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const review = require('../../config/rinspace/texlive-cjk.review.json');
const {
	paths,
	validateReview,
	verifyVendoredSource,
} = require('./install-vendored-runtime-assets.cjs');

test('fixed TeX Live CJK source inventory matches every reviewed byte', async () => {
	validateReview(review);
	const verified = await verifyVendoredSource(review);
	assert.equal(verified.files.length, 20);
	assert.equal(
		verified.files.reduce((total, file) => total + file.size, 0),
		18888796,
	);
	assert.equal(review.productionAccepted, false);
	assert.equal(
		review.source.archiveSha256,
		'438c997af1f851dcd87c91d3b16710ccb3620f8a7b6db488afcf458411931bcb',
	);
});

test('runtime destination is content-addressed and stays below public assets', () => {
	const locations = paths(review);
	assert.match(
		locations.destination.replaceAll('\\', '/'),
		new RegExp(`/public/assets/texlive-2026-cjk/${review.inventorySha256}$`),
	);
});

test('vendored CJK notice covers every contributing package', async () => {
	const notice = await readFile(
		new URL('../../vendor/rinspace/texlive-2026-cjk/NOTICE.md', import.meta.url),
		'utf8',
	);
	for (const id of review.packages.map((entry) => entry.id)) {
		assert.match(notice.toLowerCase(), new RegExp(`\\b${id.toLowerCase()}\\b`));
	}
});
