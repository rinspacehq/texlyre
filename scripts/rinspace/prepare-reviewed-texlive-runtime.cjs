// SPDX-License-Identifier: AGPL-3.0-or-later
// Reuse exact published runtime bytes; never infer them from main/latest.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { once } = require('node:events');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

async function hashFile(file) {
	const hash = createHash('sha256');
	for await (const chunk of fs.createReadStream(file)) hash.update(chunk);
	return hash.digest('hex');
}

async function verifyFile(file, expected) {
	const stat = await fsp.lstat(file);
	assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'Runtime asset must be a regular file');
	assert.equal(stat.size, expected.size, 'Runtime asset size mismatch');
	assert.equal(await hashFile(file), expected.sha256, 'Runtime asset digest mismatch');
}

function publishedMetadata(review) {
	const api = suffix => JSON.parse(execFileSync('gh', ['api', `repos/${review.repository}/${suffix}`], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }));
	const release = api(`releases/${review.release.id}`);
	const ref = api(`git/ref/tags/${review.release.tag}`);
	assert.equal(ref.object.type, 'commit');
	return { ...release, tagCommit: ref.object.sha };
}

async function downloadAsset(review, name, record, target) {
	const fd = fs.openSync(target, 'wx', 0o644);
	const child = spawn('gh', ['api', '-H', 'Accept: application/octet-stream', `repos/${review.repository}/releases/assets/${record.id}`], { stdio: ['ignore', 'pipe', 'inherit'] });
	const done = once(child, 'close');
	let size = 0;
	try {
		for await (const chunk of child.stdout) {
			size += chunk.length;
			assert.ok(size <= record.size, `Oversized runtime asset: ${name}`);
			let offset = 0;
			while (offset < chunk.length) offset += fs.writeSync(fd, chunk, offset, chunk.length - offset);
		}
		const [code] = await done;
		assert.equal(code, 0, `Runtime asset download failed: ${name}`);
		assert.equal(size, record.size);
	} catch (error) {
		child.kill('SIGTERM');
		throw error;
	} finally {
		fs.closeSync(fd);
	}
}

async function prepareReviewedRuntime({ review, sourceBytes, runtime, cacheDir, outputDir, verifyOnly = false, getMetadata = publishedMetadata, download = downloadAsset }) {
	assert.equal(review.schema, 'rinspace-published-texlive-runtime/v1');
	assert.equal(review.repository, 'rinspacehq/texlyre');
	assert.equal(digest(sourceBytes), review.sourceReviewSha256, 'Runtime inputs changed; review a new reuse record or select a full rebuild');
	const source = JSON.parse(sourceBytes);
	assert.equal(review.runtimeId, source.runtimeId);
	assert.equal(runtime.runtimeId, source.runtimeId);
	assert.ok(Number.isSafeInteger(review.release.id) && review.release.id > 0);
	assert.match(review.release.tag, /^v0\.13\.2-rinspace\.[1-9][0-9]*$/);
	assert.match(review.release.commit, /^[0-9a-f]{40}$/);
	const checksum = `${source.runtimeId}.sha256`;
	const names = [runtime.packFilename, runtime.indexFilename, runtime.manifestFilename, checksum];
	assert.deepEqual(Object.keys(review.assets).sort(), [...names].sort());
	for (const name of names) {
		assert.match(name, /^[A-Za-z0-9._-]+$/);
		const record = review.assets[name];
		assert.ok(Number.isSafeInteger(record.id) && record.id > 0);
		assert.ok(Number.isSafeInteger(record.size) && record.size > 0 && record.size <= runtime.maximumPackBytes);
		assert.match(record.sha256, /^[0-9a-f]{64}$/);
	}
	assert.ok(review.assets[runtime.manifestFilename].size < 1024 * 1024);
	assert.ok(review.assets[checksum].size < 1024);
	const published = await getMetadata(review);
	assert.equal(published.id, review.release.id);
	assert.equal(published.tag_name, review.release.tag);
	assert.equal(published.tagCommit, review.release.commit);
	assert.equal(published.draft, false);
	assert.equal(published.prerelease, false);
	for (const name of names) {
		const wanted = review.assets[name], matches = published.assets.filter(asset => asset.name === name);
		assert.equal(matches.length, 1);
		assert.equal(matches[0].id, wanted.id);
		assert.equal(matches[0].state, 'uploaded');
		assert.equal(matches[0].size, wanted.size);
		assert.equal(matches[0].digest, `sha256:${wanted.sha256}`);
	}
	const cached = cacheDir && fs.existsSync(cacheDir);
	if (verifyOnly) assert.ok(cached, 'Verification-only reuse requires the reviewed local runtime cache');
	if (cached) {
		assert.equal(await fsp.realpath(cacheDir), path.resolve(cacheDir));
		assert.deepEqual((await fsp.readdir(cacheDir)).sort(), [...names].sort());
		for (const name of names) await verifyFile(path.join(cacheDir, name), review.assets[name]);
	}
	const output = verifyOnly ? path.resolve(cacheDir) : path.resolve(outputDir);
	if (!verifyOnly) {
		await fsp.mkdir(output, { recursive: true });
		assert.equal(await fsp.realpath(output), output);
		assert.deepEqual(await fsp.readdir(output), [], 'Refusing to overwrite prior runtime output');
	}
	for (const name of names) {
		if (verifyOnly) continue;
		const target = path.join(output, name);
		if (cached) await fsp.copyFile(path.join(cacheDir, name), target, fs.constants.COPYFILE_EXCL);
		else await download(review, name, review.assets[name], target);
		await verifyFile(target, review.assets[name]);
		// Input caches are read-only; assembly may regenerate the checksum
		// file in its own output directory without mutating the cache.
		await fsp.chmod(target, 0o644);
	}
	const manifest = JSON.parse(await fsp.readFile(path.join(output, runtime.manifestFilename), 'utf8'));
	assert.equal(manifest.schema, 'rinspace-texlive-runtime-artifacts/v1');
	assert.equal(manifest.runtimeId, source.runtimeId);
	assert.deepEqual(manifest.source, source);
	assert.equal(manifest.files, source.texmfRegularFiles);
	assert.deepEqual(manifest.pack, { filename: runtime.packFilename, size: review.assets[runtime.packFilename].size, sha256: review.assets[runtime.packFilename].sha256 });
	assert.deepEqual(manifest.index, { filename: runtime.indexFilename, size: review.assets[runtime.indexFilename].size, sha256: review.assets[runtime.indexFilename].sha256 });
	const expectedChecksums = [runtime.packFilename, runtime.indexFilename, runtime.manifestFilename].map(name => `${review.assets[name].sha256}  ${name}\n`).join('');
	assert.equal(await fsp.readFile(path.join(output, checksum), 'utf8'), expectedChecksums);
	return { runtimeId: source.runtimeId, release: review.release, files: names.length, reused: true, verifyOnly };
}

module.exports = { prepareReviewedRuntime };
if (require.main === module) {
	const root = path.resolve(__dirname, '../..');
	const read = name => fs.readFileSync(path.join(root, name));
	prepareReviewedRuntime({
		review: JSON.parse(read('config/rinspace/texlive-published-runtime.review.json')),
		sourceBytes: read('config/rinspace/texlive-full-runtime.review.json'),
		runtime: JSON.parse(read('config/rinspace/release.json')).texliveRuntime,
		cacheDir: process.env.RINSPACE_TEXLIVE_ARTIFACT_CACHE_DIR,
		outputDir: process.argv.includes('--verify-only') ? undefined : process.argv[2],
		verifyOnly: process.argv.includes('--verify-only'),
	}).then(result => console.log(JSON.stringify(result))).catch(error => { console.error(error.message); process.exitCode = 1; });
}
