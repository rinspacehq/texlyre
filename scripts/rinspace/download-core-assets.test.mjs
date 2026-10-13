// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const {
	ASSETS,
	downloadArchive,
	downloadCoreAssets,
	getReviewEntry,
	resolveRequestedId,
	validateAssetUrl,
	verifyInventoryLock,
} = require('../download-core-assets.cjs');

const bytes = new TextEncoder().encode('fixed runtime archive');
const asset = {
	id: 'example',
	url: 'https://github.com/TeXlyre/example/releases/download/v1/assets.zip',
	sha256: createHash('sha256').update(bytes).digest('hex'),
	size: bytes.length,
	maxBytes: bytes.length,
};

async function temporaryFile(run) {
	const directory = await mkdtemp(path.join(tmpdir(), 'texlyre-download-test-'));
	try {
		await run(path.join(directory, 'archive'));
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

test('every downloaded core asset uses the exact reviewed source bytes', () => {
	for (const spec of ASSETS) {
		const entry = getReviewEntry(spec.id);
		assert.match(entry.sha256, /^[0-9a-f]{64}$/);
		assert.ok(entry.size > 0);
		assert.equal(validateAssetUrl(entry.url).protocol, 'https:');
	}
});

test('streams an exact archive to a private staging file', () =>
	temporaryFile(async (filename) => {
		const result = await downloadArchive(
			asset,
			filename,
			async () => new Response(bytes, { status: 200 }),
		);
		assert.deepEqual(result, { size: bytes.length, sha256: asset.sha256 });
		assert.deepEqual(await readFile(filename), Buffer.from(bytes));
	}));

test('removes a staged archive when size or digest validation fails', () =>
	temporaryFile(async (filename) => {
		await assert.rejects(
			downloadArchive(
				{ ...asset, sha256: '0'.repeat(64) },
				filename,
				async () => new Response(bytes, { status: 200 }),
			),
			/digest mismatch/,
		);
		await assert.rejects(readFile(filename), { code: 'ENOENT' });
	}));

test('rejects a redirect outside the public asset allowlist', () =>
	temporaryFile(async (filename) => {
		let requests = 0;
		await assert.rejects(
			downloadArchive(asset, filename, async () => {
				requests++;
				return new Response(null, {
					status: 302,
					headers: { location: 'https://127.0.0.1/private' },
				});
			}),
			/unapproved/,
		);
		assert.equal(requests, 1);
	}));

test('requires an exact extracted inventory lock for warm caches', () => {
	const summary = {
		files: 2,
		bytes: 42,
		inventorySha256: '1'.repeat(64),
	};
	assert.doesNotThrow(() =>
		verifyInventoryLock({ id: 'example', extracted: summary }, summary),
	);
	assert.throws(
		() => verifyInventoryLock({ id: 'example' }, summary),
		/no reviewed extracted inventory/,
	);
	assert.throws(
		() =>
			verifyInventoryLock(
				{ id: 'example', extracted: summary },
				{ ...summary, bytes: 43 },
			),
		/extracted inventory mismatch/,
	);
});

test('rejects unknown selective asset identities before downloading', async () => {
	await assert.rejects(
		downloadCoreAssets(false, {
			assetIds: ['unknown-runtime'],
			recordInventory: true,
		}),
		/unknown external asset id/,
	);
});

test('an explicitly requested optional variant is selected without the global flag', () => {
	const spec = ASSETS.find((candidate) => candidate.optionalId);
	assert.equal(
		resolveRequestedId(spec, new Set([spec.optionalId])),
		spec.optionalId,
	);
	assert.throws(
		() => resolveRequestedId(spec, new Set([spec.id, spec.optionalId])),
		/variants share a destination/,
	);
});
