// SPDX-License-Identifier: AGPL-3.0-or-later
// Build-time assets are public bytes, not user projects or browser caches.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createReadStream } = require('node:fs');
const fs = require('node:fs/promises');
const path = require('node:path');

const publicRoot = path.resolve(__dirname, '../../public');

function assetPath(value) {
	assert.equal(typeof value, 'string', 'asset path must be a string');
	assert.ok(value.length > 0 && !value.includes('\\') && !value.includes(':'), 'unsafe asset path');
	assert.ok(![...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127), 'unsafe asset control character');
	assert.ok(value.split('/').every((part) => part && part !== '.' && part !== '..'), 'unsafe asset path segment');
	return value;
}

async function statOrMissing(filename) {
	try {
		return await fs.lstat(filename);
	} catch (error) {
		if (error.code === 'ENOENT') return undefined;
		throw error;
	}
}

async function hashFile(filename) {
	const hash = createHash('sha256');
	for await (const chunk of createReadStream(filename)) hash.update(chunk);
	return hash.digest('hex');
}

async function inventory(root) {
	const rootStat = await fs.lstat(root);
	assert.ok(rootStat.isDirectory() && !rootStat.isSymbolicLink(), 'asset root must be a real directory');
	const files = [];
	async function walk(relative) {
		const directory = path.join(root, relative);
		for (const name of (await fs.readdir(directory)).sort()) {
			const relativePath = assetPath(relative ? `${relative}/${name}` : name);
			const filename = path.join(root, relativePath);
			const stat = await fs.lstat(filename);
			assert.ok(!stat.isSymbolicLink(), `asset symlink rejected: ${relativePath}`);
			if (stat.isDirectory()) await walk(relativePath);
			else {
				assert.ok(stat.isFile(), `non-file asset rejected: ${relativePath}`);
				files.push({ path: relativePath, size: stat.size, sha256: await hashFile(filename) });
			}
		}
	}
	await walk('');
	return files.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
}

function inventoryDigest(files) {
	return createHash('sha256').update(JSON.stringify(files)).digest('hex');
}

async function checkDestination(destination, root) {
	const relative = path.relative(root, destination);
	assetPath(relative.split(path.sep).join('/'));
	let current = root;
	for (const segment of ['', ...relative.split(path.sep)]) {
		if (segment) current = path.join(current, segment);
		const stat = await statOrMissing(current);
		assert.ok(!stat || (stat.isDirectory() && !stat.isSymbolicLink()), 'asset destination contains a symlink or non-directory');
	}
}

async function verifyInventory(destination, expected) {
	const actual = await inventory(destination);
	assert.equal(inventoryDigest(actual), inventoryDigest(expected),
		`asset cache integrity mismatch: ${path.basename(destination)}; preserve and review the cache, do not silently overwrite it`);
	return actual;
}

async function copyVerifiedAssetFiles(sources, destination, root = publicRoot) {
	await checkDestination(destination, root);
	const expected = [];
	const paths = new Set();
	for (const source of sources) {
		assetPath(source.path);
		assert.ok(!paths.has(source.path), 'duplicate asset output path');
		paths.add(source.path);
		const stat = await fs.lstat(source.source);
		assert.ok(stat.isFile() && !stat.isSymbolicLink(), 'asset source must be a real file');
		expected.push({ path: source.path, size: stat.size, sha256: await hashFile(source.source) });
	}
	expected.sort((left, right) => left.path < right.path ? -1 : left.path > right.path ? 1 : 0);
	assert.ok(expected.length > 0, 'empty asset input rejected');
	if (await statOrMissing(destination)) {
		await verifyInventory(destination, expected);
		return { status: 'verified-cache', files: expected };
	}

	const parent = path.dirname(destination);
	await fs.mkdir(parent, { recursive: true });
	await checkDestination(destination, root);
	const stage = await fs.mkdtemp(path.join(parent, '.rinspace-asset-stage-'));
	try {
		for (const source of sources) {
			const target = path.join(stage, source.path);
			await fs.mkdir(path.dirname(target), { recursive: true });
			await fs.copyFile(source.source, target);
		}
		// Also rejects a source change between hashing and copying.
		await verifyInventory(stage, expected);
		assert.ok(!(await statOrMissing(destination)), 'asset destination appeared during staging');
		await fs.rename(stage, destination);
		return { status: 'installed', files: expected };
	} finally {
		// Only the exact mkdtemp directory created by this invocation is removable.
		await fs.rm(stage, { recursive: true, force: true });
	}
}

async function copyVerifiedAssetTree(source, destination, root = publicRoot) {
	const files = await inventory(source);
	return copyVerifiedAssetFiles(files.map((file) => ({ path: file.path, source: path.join(source, file.path) })), destination, root);
}

module.exports = { assetPath, hashFile, inventory, inventoryDigest, verifyInventory, copyVerifiedAssetFiles, copyVerifiedAssetTree };
