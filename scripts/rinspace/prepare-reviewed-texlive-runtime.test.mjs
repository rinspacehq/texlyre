// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm, chmod, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import module from './prepare-reviewed-texlive-runtime.cjs';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

async function fixture() {
	const directory = await mkdtemp(path.join(tmpdir(), 'texlyre-reviewed-runtime-'));
	const cache = path.join(directory, 'cache'), output = path.join(directory, 'output');
	await mkdir(cache);
	const id = 'texlive-2026-rinspace.1';
	const source = { schema: 'rinspace-texlive-runtime-source/v1', runtimeId: id, texmfRegularFiles: 2 };
	const sourceBytes = Buffer.from(JSON.stringify(source));
	const runtime = { runtimeId: id, packFilename: id + '.pack', indexFilename: id + '.index.json', manifestFilename: id + '.manifest.json', maximumPackBytes: 2147483648 };
	const bodies = { [runtime.packFilename]: Buffer.from('exact tiny pack'), [runtime.indexFilename]: Buffer.from('exact tiny index') };
	const info = name => ({ filename: name, size: bodies[name].length, sha256: hash(bodies[name]) });
	bodies[runtime.manifestFilename] = Buffer.from(JSON.stringify({ schema: 'rinspace-texlive-runtime-artifacts/v1', runtimeId: id, source, files: 2, pack: info(runtime.packFilename), index: info(runtime.indexFilename) }));
	bodies[id + '.sha256'] = Buffer.from([runtime.packFilename, runtime.indexFilename, runtime.manifestFilename].map(name => `${hash(bodies[name])}  ${name}\n`).join(''));
	const review = { schema: 'rinspace-published-texlive-runtime/v1', runtimeId: id, sourceReviewSha256: hash(sourceBytes), repository: 'rinspacehq/texlyre', release: { id: 1, tag: 'v0.13.2-rinspace.3', commit: 'a'.repeat(40) }, assets: {} };
	let assetId = 1;
	for (const [name, bytes] of Object.entries(bodies)) {
		review.assets[name] = { id: assetId++, size: bytes.length, sha256: hash(bytes) };
		await writeFile(path.join(cache, name), bytes);
	}
	const metadata = { id: 1, tag_name: review.release.tag, tagCommit: review.release.commit, draft: false, prerelease: false, assets: Object.entries(review.assets).map(([name, item]) => ({ ...item, name, state: 'uploaded', digest: 'sha256:' + item.sha256 })) };
	const options = { review, sourceBytes, runtime, cacheDir: cache, outputDir: output, getMetadata: async () => metadata, download: async () => { throw Error('Cache must avoid network download'); } };
	return { directory, cache, output, bodies, metadata, options, cleanup: () => rm(directory, { recursive: true, force: true }) };
}

test('reuse copies only four exact published assets and retains original bytes', async () => {
	const f = await fixture();
	try {
		const result = await module.prepareReviewedRuntime(f.options);
		assert.equal(result.reused, true); assert.equal(result.files, 4);
		for (const [name, bytes] of Object.entries(f.bodies)) assert.deepEqual(await readFile(path.join(f.output, name)), bytes);
	} finally { await f.cleanup(); }
});
for (const kind of ['changed-input', 'moved-tag', 'wrong-asset-id', 'wrong-digest', 'draft']) {
	test(`reuse fails closed for ${kind}`, async () => {
		const f = await fixture();
		try {
			if (kind === 'changed-input') f.options.sourceBytes = Buffer.from('{}');
			if (kind === 'moved-tag') f.metadata.tagCommit = 'b'.repeat(40);
			if (kind === 'wrong-asset-id') f.metadata.assets[0].id = 99;
			if (kind === 'wrong-digest') f.metadata.assets[0].digest = 'sha256:' + '0'.repeat(64);
			if (kind === 'draft') f.metadata.draft = true;
			await assert.rejects(() => module.prepareReviewedRuntime(f.options));
		} finally { await f.cleanup(); }
	});
}
test('cache corruption and symlinks cannot become accepted runtime output', async () => {
	for (const link of [false, true]) {
		const f = await fixture();
		try {
			const name = f.options.runtime.packFilename, file = path.join(f.cache, name);
			if (link) { await rm(file); await symlink(path.join(f.cache, f.options.runtime.indexFilename), file); }
			else await writeFile(file, 'wrong pack');
			await assert.rejects(() => module.prepareReviewedRuntime(f.options));
		} finally { await f.cleanup(); }
	}
});
test('prior output is never overwritten', async () => {
	const f = await fixture();
	try {
		await mkdir(f.output); await writeFile(path.join(f.output, 'user-data'), 'preserve');
		await assert.rejects(() => module.prepareReviewedRuntime(f.options), /overwrite/);
		assert.equal(await readFile(path.join(f.output, 'user-data'), 'utf8'), 'preserve');
	} finally { await f.cleanup(); }
});
test('read-only cache inputs remain read-only while assembly outputs are writable', async () => {
	const f = await fixture();
	try {
		for (const name of Object.keys(f.bodies)) await chmod(path.join(f.cache, name), 0o444);
		await module.prepareReviewedRuntime(f.options);
		for (const name of Object.keys(f.bodies)) {
			assert.equal((await stat(path.join(f.cache, name))).mode & 0o777, 0o444);
			assert.equal((await stat(path.join(f.output, name))).mode & 0o777, 0o644);
		}
	} finally { await f.cleanup(); }
});
test('a missing cache downloads immutable IDs and verifies the result', async () => {
	const f = await fixture();
	try {
		const downloaded = [];
		f.options.cacheDir = undefined;
		f.options.download = async (_review, name, record, target) => { downloaded.push(record.id); await writeFile(target, f.bodies[name], { flag: 'wx' }); };
		await module.prepareReviewedRuntime(f.options);
		assert.deepEqual(downloaded, Object.values(f.options.review.assets).map(item => item.id));
	} finally { await f.cleanup(); }
});
