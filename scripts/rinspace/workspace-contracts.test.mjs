// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { WorkspaceExtensionRegistry } from '../../src/workspace/ExtensionRegistry.ts';
import { captureSourceSnapshot } from '../../src/workspace/SourceSnapshot.ts';

const extension = (id, extensions) => ({ id, name: id, version: '0.1.0', type: 'workspace', contractVersion: 1, extensions });
const host = { open: async () => ({ mode: 'local-unbound' }), onContextInvalidated: () => () => {} };
const input = (files, extra = {}) => ({ binding: null, clock: { kind: 'local', revision: 2 }, projectionVersion: 'plain/v1', files, ...extra });
const file = (path, bytes = new Uint8Array([1, 2, 3]), mode = '100644') => ({ path, bytes, mode });

test('unhosted mode has no extensions and no implicit server dependency', () => {
	assert.deepEqual(new WorkspaceExtensionRegistry().getExtensions(), {});
});
test('all seven hooks can be registered without changing upstream providers', () => {
	const registry = new WorkspaceExtensionRegistry();
	registry.register(extension('host', { host }));
	for (const name of ['git', 'collaboration', 'snapshots', 'recovery', 'actions', 'assets']) {
		registry.register(extension(name, { [name]: { marker: name } }));
	}
	assert.equal(registry.getExtensions().host, host);
	assert.equal(Object.keys(registry.getExtensions()).length, 7);
	assert.ok(Object.isFrozen(registry.getExtensions()));
});
test('conflicting registration is atomic and cannot replace the host', () => {
	const registry = new WorkspaceExtensionRegistry();
	registry.register(extension('existing', { host }));
	assert.throws(() => registry.register(extension('conflicting', { git: {}, host: {} })), /already provided/);
	assert.deepEqual(Object.keys(registry.getExtensions()), ['host']);
	registry.register(extension('conflicting', { git: { kind: 'native-http' } }));
	assert.equal(registry.getExtensions().git.kind, 'native-http');
});
test('unknown contracts and duplicate plugin identities are rejected', () => {
	const registry = new WorkspaceExtensionRegistry();
	assert.throws(() => registry.register({ ...extension('future', {}), contractVersion: 2 }), /Unsupported/);
	registry.register(extension('one', {}));
	assert.throws(() => registry.register(extension('one', {})), /Duplicate/);
});
test('snapshot captures every byte before asynchronous hashing', async () => {
	const first = file('main.tex', new TextEncoder().encode('原始正文'));
	const second = file('figures/image.bin', new Uint8Array([0, 255, 10, 128]));
	const originalFirst = first.bytes.slice();
	const originalSecond = second.bytes.slice();
	const request = input([first, second]);
	const capture = captureSourceSnapshot(request);
	first.bytes.fill(0);
	second.bytes.fill(1);
	request.clock.revision = 100;
	request.files.pop();
	const snapshot = await capture;
	assert.deepEqual(snapshot.readFile('main.tex'), originalFirst);
	assert.deepEqual(snapshot.readFile('figures/image.bin'), originalSecond);
	assert.equal(snapshot.clock.revision, 2);
	const binary = snapshot.files.find((entry) => entry.path === second.path);
	assert.equal(binary.sha256, createHash('sha256').update(originalSecond).digest('hex'));
	assert.equal(binary.byteLength, 4);
});
test('returned bytes and metadata cannot mutate a snapshot', async () => {
	const snapshot = await captureSourceSnapshot(input([file('main.tex')]));
	snapshot.readFile('main.tex').fill(9);
	assert.deepEqual(snapshot.readFile('main.tex'), new Uint8Array([1, 2, 3]));
	assert.throws(() => { snapshot.files[0].path = 'changed.tex'; }, TypeError);
	assert.throws(() => snapshot.files.pop(), TypeError);
	assert.throws(() => snapshot.readFile('missing.tex'), /not in/);
});
test('file input order does not alter the immutable snapshot identifier', async () => {
	const first = file('z.bin');
	const second = file('a.tex');
	const left = await captureSourceSnapshot(input([first, second]));
	const right = await captureSourceSnapshot(input([second, first]));
	assert.equal(left.id, right.id);
	assert.deepEqual(left.files.map((entry) => entry.path), ['a.tex', 'z.bin']);
});
test('mode, revision and projection rules are part of snapshot identity', async () => {
	const base = await captureSourceSnapshot(input([file('main.tex')]));
	for (const request of [
		input([file('main.tex', undefined, '100755')]),
		input([file('main.tex')], { clock: { kind: 'local', revision: 3 } }),
		input([file('main.tex')], { projectionVersion: 'annotations/v2' }),
	]) {
		assert.notEqual((await captureSourceSnapshot(request)).id, base.id);
	}
});
test('binding coordinates are copied canonically and unrecognized fields do not enter the snapshot', async () => {
	const binding = {
		repositoryId: 'repo1', branchBindingId: 'branch1', ref: 'refs/heads/main', workspaceId: 'workspace1',
		generation: 1, baseCommit: 'a'.repeat(40), objectFormat: 'sha1',
	};
	const reordered = Object.fromEntries(Object.entries(binding).reverse());
	const pending = captureSourceSnapshot(input([file('main.tex')], { binding: { ...binding, capability: 'must-not-be-captured' } }));
	const canonical = await captureSourceSnapshot(input([file('main.tex')], { binding: reordered }));
	const snapshot = await pending;
	assert.equal(snapshot.id, canonical.id);
	assert.deepEqual(snapshot.binding, binding);
	assert.equal(snapshot.binding.capability, undefined);
	const capture = captureSourceSnapshot(input([file('main.tex')], { binding }));
	binding.generation = 2;
	assert.equal((await capture).binding.generation, 1);
});
test('executable, symlink object bytes and empty files are preserved without following paths', async () => {
	const snapshot = await captureSourceSnapshot(input([
		file('run.sh', new Uint8Array([35, 33]), '100755'),
		file('link', new TextEncoder().encode('../../target'), '120000'),
		file('empty.tex', new Uint8Array()),
	]));
	assert.equal(snapshot.files.find((entry) => entry.path === 'link').mode, '120000');
	assert.equal(new TextDecoder().decode(snapshot.readFile('link')), '../../target');
	assert.equal(snapshot.readFile('empty.tex').byteLength, 0);
});
test('unsafe paths, duplicate paths and unsupported modes are rejected', async () => {
	for (const path of ['', '/absolute', '../escape', 'dir/../escape', 'a\\b', '.git/config', 'dir/.GiT/file', 'C:/drive', 'a//b', 'nul\u0000']) {
		await assert.rejects(captureSourceSnapshot(input([file(path)])), /repository-relative/);
	}
	await assert.rejects(captureSourceSnapshot(input([file('same'), file('same')])), /Duplicate/);
	await assert.rejects(captureSourceSnapshot(input([file('submodule', undefined, '160000')])), /Unsupported/);
});
test('invalid clocks, baseline identifiers and cancellation do not produce a snapshot', async () => {
	await assert.rejects(captureSourceSnapshot(input([], { clock: { kind: 'local', revision: -1 } })), /sequence/);
	await assert.rejects(captureSourceSnapshot(input([], { clock: { kind: 'unknown', cutSeq: 1 } })), /clock kind/);
	await assert.rejects(captureSourceSnapshot(input([], { binding: { objectFormat: 'sha1', baseCommit: 'main', generation: 1 } })), /baseline/);
	const controller = new AbortController();
	controller.abort();
	await assert.rejects(captureSourceSnapshot(input([]), controller.signal), { name: 'AbortError' });
});
