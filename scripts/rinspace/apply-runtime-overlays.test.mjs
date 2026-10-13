// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const {
	BUSYTEX_CACHE_FETCH_MARKER,
	BUSYTEX_WORKER_RELATIVE_PATH,
	applyRuntimeOverlays,
	createPatchedBusytexWorker,
} = require('./apply-runtime-overlays.cjs');

const digest = (value) => createHash('sha256').update(value).digest('hex');

test('worker overlay prefers CacheStorage only for GET requests', () => {
	const source = "importScripts('busytex_pipeline.js');\n";
	const patched = createPatchedBusytexWorker(source, digest(source));

	assert.match(patched, new RegExp(BUSYTEX_CACHE_FETCH_MARKER));
	assert.match(patched, /return rinspaceBusytexNetworkFetch\(input, init\)/);
	assert.match(patched, /method\.toUpperCase\(\) !== 'GET'/);
	assert.match(patched, /await caches\.match\(absoluteUrl\)/);
	assert.ok(patched.endsWith(source));
});

test('worker overlay rejects unreviewed upstream bytes', () => {
	assert.throws(
		() => createPatchedBusytexWorker('changed', '0'.repeat(64)),
		/worker source changed/,
	);
});

test('artifact overlay changes only the reviewed worker', async () => {
	const distDir = await mkdtemp(path.join(tmpdir(), 'texlyre-overlay-test-'));
	const workerPath = path.join(distDir, BUSYTEX_WORKER_RELATIVE_PATH);
	const upstream = "importScripts('busytex_pipeline.js');\n";

	try {
		await mkdir(path.dirname(workerPath), { recursive: true });
		await writeFile(workerPath, upstream);
		const result = await applyRuntimeOverlays(distDir, digest(upstream));
		const patched = await readFile(workerPath, 'utf8');

		assert.equal(result.file, BUSYTEX_WORKER_RELATIVE_PATH);
		assert.equal(result.upstreamSha256, digest(upstream));
		assert.match(patched, new RegExp(BUSYTEX_CACHE_FETCH_MARKER));
		assert.equal(result.artifactSha256, digest(patched));
	} finally {
		await rm(distDir, { recursive: true, force: true });
	}
});
