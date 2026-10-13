// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';

const review = JSON.parse(
	await readFile(
		new URL('../../config/rinspace/runtime-mirrors.review.json', import.meta.url),
		'utf8',
	),
);

test('mirror review never enables an unqualified browser runtime source', () => {
	assert.equal(review.schema, 'rinspace-runtime-mirror-review/v1');
	assert.equal(review.productionAccepted, false);
	assert.deepEqual(review.runtimeEnabled, []);

	for (const candidate of review.candidates) {
		const url = new URL(candidate.baseUrl);
		assert.equal(url.protocol, 'https:');
		assert.equal(url.username, '');
		assert.equal(url.password, '');
		assert.match(candidate.id, /^[a-z0-9-]+$/);
		assert.ok(
			['build-ctan', 'build-npm', 'runtime-data-candidate'].includes(
				candidate.purpose,
			),
		);
	}

	const runtimeReady = review.candidates.filter(
		(candidate) =>
			candidate.purpose === 'runtime-data-candidate' &&
			candidate.https &&
			candidate.range &&
			candidate.browserCors &&
			candidate.hotlinkTermsReviewed &&
			candidate.texlyreProtocolCompatible,
	);
	assert.deepEqual(runtimeReady.map((candidate) => candidate.id), []);
	assert.equal(review.runtimePolicy.executableAssets, 'same-origin-only');
	assert.match(review.runtimePolicy.fallback, /only enabled browser source/);
	assert.deepEqual(
		Object.keys(review.runtimePolicy.failureMatrix).sort(),
		['http404', 'missingCors', 'missingRange', 'timeout', 'wrongBytes'],
	);
});

test('large-provider CTAN mirrors remain build-only without browser CORS', () => {
	for (const id of ['aliyun-ctan', 'tencent-ctan']) {
		const candidate = review.candidates.find((entry) => entry.id === id);
		assert.equal(candidate.purpose, 'build-ctan');
		assert.equal(candidate.browserCors, false);
		assert.equal(candidate.officialIndex, 'https://www.ctan.org/mirrors');
		assert.equal(candidate.observation.status, 206);
		assert.equal(candidate.observation.contentRange, 'bytes 0-0/136228');
		assert.equal(candidate.observation.accessControlAllowOrigin, null);
	}
});

test('a CORS-capable candidate remains disabled until policy and protocol qualify', () => {
	const candidate = review.candidates.find((entry) => entry.id === 'huawei-ctan');
	assert.equal(candidate.browserCors, true);
	assert.equal(candidate.observation.status, 206);
	assert.equal(candidate.observation.accessControlAllowOrigin, '*');
	assert.equal(candidate.officialIndex, null);
	assert.equal(candidate.hotlinkTermsReviewed, false);
	assert.equal(candidate.texlyreProtocolCompatible, false);
	assert.ok(!review.runtimeEnabled.includes(candidate.id));
});
