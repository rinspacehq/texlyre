// SPDX-License-Identifier: AGPL-3.0-or-later
/* global AbortSignal, Response */
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';
import { TextEncoder } from 'node:util';

const require = createRequire(import.meta.url);
const {
	ASSETS,
	buildCurlArguments,
	downloadArchive,
	downloadCoreAssets,
	downloadRangeArchive,
	getReviewEntry,
	requestHeadWithCurl,
	requestWithRetries,
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

test('retries transient archive metadata failures with bounded backoff', async () => {
	let requests = 0;
	const waits = [];
	const response = await requestWithRetries(
		async () => {
			requests++;
			if (requests < 3) throw new TypeError('transient socket failure');
			return new Response(bytes, { status: 200 });
		},
		asset.url,
		{ signal: AbortSignal.timeout(1000) },
		{ attempts: 5, wait: async (milliseconds) => waits.push(milliseconds) },
	);
	assert.equal(response.status, 200);
	assert.equal(requests, 3);
	assert.deepEqual(waits, [1000, 2000]);
});

test('curl resolves release redirects without using the Node network stack', async () => {
	const redirect =
		'https://release-assets.githubusercontent.com/github-production-release-asset/1/fixed';
	const response = await requestHeadWithCurl(
		asset.url,
		{ signal: AbortSignal.timeout(1000) },
		async (command, args, options) => {
			assert.equal(command, 'curl');
			assert.ok(args.includes('--head'));
			assert.equal(args[args.indexOf('--proto') + 1], '=https');
			assert.equal(args[args.indexOf('--max-redirs') + 1], '0');
			assert.equal(args[args.indexOf('--connect-timeout') + 1], '30');
			assert.equal(args[args.indexOf('--retry') + 1], '4');
			assert.ok(args.includes('--retry-all-errors'));
			assert.equal(args[args.indexOf('--url') + 1], asset.url);
			assert.ok(options.signal);
			return { stdout: `302\n${redirect}`, stderr: '' };
		},
	);

	assert.equal(response.status, 302);
	assert.equal(response.headers.get('location'), redirect);
	assert.equal(response.headers.get('content-type'), null);
});

test('curl retries stalled transfers without relaxing source or size limits', () => {
	const filename = '/tmp/fixed-runtime.zip';
	const url = validateAssetUrl(asset.url);
	const args = buildCurlArguments(asset, filename, url);
	const valueAfter = (flag) => args[args.indexOf(flag) + 1];

	assert.equal(valueAfter('--proto'), '=https');
	assert.equal(valueAfter('--max-redirs'), '0');
	assert.equal(valueAfter('--connect-timeout'), '30');
	assert.equal(valueAfter('--max-time'), String(45 * 60));
	assert.equal(valueAfter('--retry'), '4');
	assert.ok(args.includes('--retry-all-errors'));
	assert.equal(valueAfter('--retry-max-time'), String(45 * 60));
	assert.equal(valueAfter('--speed-limit'), '1024');
	assert.equal(valueAfter('--speed-time'), '60');
	assert.equal(valueAfter('--max-filesize'), String(asset.maxBytes));
	assert.equal(valueAfter('--output'), filename);
	assert.equal(valueAfter('--url'), asset.url);
});

test('large release assets use at most eight bounded ranges and exact ordered assembly', () =>
	temporaryFile(async (filename) => {
		const url = validateAssetUrl(asset.url);
		const observed = [];
		await downloadRangeArchive(
			asset,
			filename,
			url,
			async (command, args) => {
				assert.equal(command, 'curl');
				const range = args[args.indexOf('--range') + 1];
				const output = args[args.indexOf('--output') + 1];
				const [start, end] = range.split('-').map(Number);
				observed.push({ start, end });
				assert.equal(
					args[args.indexOf('--max-filesize') + 1],
					String(end - start + 1),
				);
				await writeFile(output, Buffer.from(bytes).subarray(start, end + 1));
				return { stdout: '206', stderr: '' };
			},
		);
		assert.deepEqual(await readFile(filename), Buffer.from(bytes));
		assert.deepEqual(
			observed.sort((left, right) => left.start - right.start),
			[
				{ start: 0, end: 2 },
				{ start: 3, end: 5 },
				{ start: 6, end: 8 },
				{ start: 9, end: 11 },
				{ start: 12, end: 14 },
				{ start: 15, end: 17 },
				{ start: 18, end: 20 },
			],
		);
	}));

test('a failed range waits for peers and removes every partial file', () =>
	temporaryFile(async (filename) => {
		const url = validateAssetUrl(asset.url);
		let completedPeers = 0;
		await assert.rejects(
			downloadRangeArchive(
				asset,
				filename,
				url,
				async (_command, args) => {
					const range = args[args.indexOf('--range') + 1];
					const output = args[args.indexOf('--output') + 1];
					const [start, end] = range.split('-').map(Number);
					if (start === 0) throw new Error('range failed');
					await writeFile(output, Buffer.from(bytes).subarray(start, end + 1));
					completedPeers++;
					return { stdout: '206', stderr: '' };
				},
				4,
			),
			/range failed/,
		);
		assert.equal(completedPeers, 3);
		await assert.rejects(stat(filename), { code: 'ENOENT' });
		await assert.rejects(stat(`${filename}.parts`), { code: 'ENOENT' });
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
