// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import assets from './asset-integrity.cjs';

async function fixture(run) {
	const root = await mkdtemp(path.join(tmpdir(), 'texlyre-asset-test-'));
	try {
		const source = path.join(root, 'source');
		const publicRoot = path.join(root, 'public');
		const destination = path.join(publicRoot, 'core', 'example');
		await mkdir(source);
		await mkdir(publicRoot);
		await writeFile(path.join(source, 'engine.wasm'), Buffer.from([0, 97, 115, 109, 255]));
		await mkdir(path.join(source, 'nested'));
		await writeFile(path.join(source, 'nested', 'empty'), '');
		await run({ root, source, publicRoot, destination });
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

test('copies binary and empty files, then verifies an unchanged cache', () => fixture(async ({ source, publicRoot, destination }) => {
	const first = await assets.copyVerifiedAssetTree(source, destination, publicRoot);
	assert.equal(first.status, 'installed');
	assert.equal(first.files.length, 2);
	assert.deepEqual(await readFile(path.join(destination, 'engine.wasm')), Buffer.from([0, 97, 115, 109, 255]));
	assert.equal((await assets.copyVerifiedAssetTree(source, destination, publicRoot)).status, 'verified-cache');
}));

test('rejects a polluted nonempty cache without overwriting it', () => fixture(async ({ source, publicRoot, destination }) => {
	await assets.copyVerifiedAssetTree(source, destination, publicRoot);
	await writeFile(path.join(destination, 'engine.wasm'), 'polluted');
	await assert.rejects(assets.copyVerifiedAssetTree(source, destination, publicRoot), /integrity mismatch/);
	assert.equal(await readFile(path.join(destination, 'engine.wasm'), 'utf8'), 'polluted');
}));

test('rejects both missing and extra cache files', () => fixture(async ({ source, publicRoot, destination }) => {
	await assets.copyVerifiedAssetTree(source, destination, publicRoot);
	await rm(path.join(destination, 'engine.wasm'));
	await assert.rejects(assets.copyVerifiedAssetTree(source, destination, publicRoot), /integrity mismatch/);
	await writeFile(path.join(destination, 'engine.wasm'), await readFile(path.join(source, 'engine.wasm')));
	await writeFile(path.join(destination, 'unreviewed.js'), 'unexpected');
	await assert.rejects(assets.copyVerifiedAssetTree(source, destination, publicRoot), /integrity mismatch/);
}));

test('rejects a symlink source and a symlink destination parent', () => fixture(async ({ root, source, publicRoot, destination }) => {
	await symlink(path.join(source, 'engine.wasm'), path.join(source, 'escape'));
	await assert.rejects(assets.copyVerifiedAssetTree(source, destination, publicRoot), /symlink/);
	await rm(path.join(source, 'escape'));
	await symlink(source, path.join(publicRoot, 'core'));
	await assert.rejects(assets.copyVerifiedAssetTree(source, destination, publicRoot), /symlink/);
	assert.equal((await readFile(path.join(root, 'source', 'engine.wasm'))).length, 5);
}));

test('rejects paths outside the declared public asset root', () => fixture(async ({ root, source, publicRoot }) => {
	await assert.rejects(assets.copyVerifiedAssetTree(source, path.join(root, 'outside'), publicRoot), /unsafe/);
}));

test('supports a multi-package asset set without losing companion files', () => fixture(async ({ source, publicRoot, destination }) => {
	const sources = [
		{ path: 'model.onnx', source: path.join(source, 'engine.wasm') },
		{ path: 'runtime/empty', source: path.join(source, 'nested', 'empty') },
	];
	await assets.copyVerifiedAssetFiles(sources, destination, publicRoot);
	assert.equal((await assets.inventory(destination)).length, 2);
	await assert.rejects(assets.copyVerifiedAssetFiles([sources[0], sources[0]], destination, publicRoot), /duplicate/);
}));

test('rejects unsafe archive or output paths', () => {
	for (const value of ['', '/absolute', '../escape', 'dir/../escape', 'dir//file', 'C:/file', 'dir\\file', 'dir/\u0000file', 'dir/\u007ffile']) {
		assert.throws(() => assets.assetPath(value), /unsafe/);
	}
	assert.equal(assets.assetPath('中文字体/file.wasm'), '中文字体/file.wasm');
});
