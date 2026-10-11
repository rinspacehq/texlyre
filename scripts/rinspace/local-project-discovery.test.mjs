// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import { discoverLocalProject, isIgnoredLocalPath, selectLocalProject } from '../../src/workspace/LocalProjectDiscovery.ts';

function reader(tree, calls = []) {
	return async function* (path) {
		calls.push(path);
		if (!(path in tree)) throw new Error('Directory unavailable');
		for (const item of tree[path]) yield { name: item.name ?? item, isDirectory: item.isDirectory ?? false };
	};
}

test('nested Chinese Typst project is not relabelled as LaTeX', async () => {
	const result = await discoverLocalProject(reader({
		'': ['references.bib', 'cover.png', { name: '章节', isDirectory: true }],
		'/章节': ['文档.typ'],
	}));
	assert.equal(result.fileCount, 3);
	assert.equal(result.suggestedKind, 'typst');
	assert.deepEqual(selectLocalProject(result, 'typst', '/章节/文档.typ'), {
		type: 'typst', group: 'typst', compilerId: 'internal:typst', mainFile: '/章节/文档.typ',
	});
});

test('mixed formats need a user choice and preserve all entry candidates', async () => {
	const result = await discoverLocalProject(reader({ '': ['part.tex', 'main.tex', 'README.MD', 'main.typ'] }));
	assert.equal(result.suggestedKind, null);
	assert.deepEqual(result.entryPoints.latex, ['/main.tex', '/part.tex']);
	assert.deepEqual(result.entryPoints.markdown, ['/README.MD']);
	assert.throws(() => selectLocalProject(result, 'latex'), /Choose an entry/);
	assert.throws(() => selectLocalProject(result, 'typst', '/main.tex'), /Choose an entry/);
	assert.deepEqual(selectLocalProject(result, 'markdown', '/README.MD'), {
		type: 'markdown', group: 'markdown', mainFile: '/README.MD',
	});
});

test('unknown and empty folders remain files-only with no fake compiler', async () => {
	for (const names of [[], ['tex', 'notes.txt', 'image.dat']]) {
		const result = await discoverLocalProject(reader({ '': names }));
		assert.equal(result.suggestedKind, 'files');
		assert.deepEqual(selectLocalProject(result, 'files'), { type: 'files', group: 'files' });
		assert.equal(result.entryPoints.latex.length, 0);
	}
});

test('Git metadata, worktree pointer files and dependency directories are never traversed', async () => {
	const calls = [];
	const result = await discoverLocalProject(reader({ '': [
		{ name: '.GIT', isDirectory: true }, '.git',
		{ name: 'node_modules', isDirectory: true }, { name: '.texlyre', isDirectory: true },
		'index.markdown',
	] }, calls));
	assert.deepEqual(calls, ['']);
	assert.equal(result.fileCount, 1);
	assert.equal(result.suggestedKind, 'markdown');
});

test('cancellation rejects a partial scan instead of returning a usable discovery', async () => {
	const controller = new AbortController();
	await assert.rejects(discoverLocalProject(async function* () {
		yield { name: 'main.tex', isDirectory: false };
		controller.abort();
		yield { name: 'next.tex', isDirectory: false };
	}, { signal: controller.signal }), { name: 'AbortError' });
});

test('entry and depth limits fail explicitly; no unlimited scan or truncated success', async () => {
	await assert.rejects(discoverLocalProject(reader({ '': ['one.tex', 'two.tex'] }), { maxEntries: 1 }), /entry limit/);
	await assert.rejects(discoverLocalProject(reader({
		'': [{ name: 'a', isDirectory: true }], '/a': [{ name: 'b', isDirectory: true }],
	}), { maxDepth: 1 }), /depth limit/);
	await assert.rejects(discoverLocalProject(reader({ '': [] }), { maxEntries: NaN }), /scan limits/);
});

test('large scans yield to the host before continuing serial discovery', async () => {
	let hostRan = false;
	const timer = setTimeout(() => { hostRan = true; }, 0);
	try {
		await discoverLocalProject(reader({ '': Array.from({ length: 256 }, (_, i) => `part${i}.tex`) }));
		assert.equal(hostRan, true);
	} finally { clearTimeout(timer); }
});

test('entry errors and unreadable children propagate without a partial success', async () => {
	await assert.rejects(discoverLocalProject(reader({ '': [{ name: 'missing', isDirectory: true }] })), /unavailable/);
	for (const name of ['..', 'a/b.tex', 'a\\b.tex', '\u0000.tex', '']) {
		await assert.rejects(discoverLocalProject(reader({ '': [{ name }] })), /Invalid local directory/);
	}
});

test('a fabricated selection cannot traverse outside the root or into Git metadata', () => {
	for (const mainFile of ['/../main.tex', '//main.tex', '/.git/main.tex', 'main.tex']) {
		assert.throws(() => selectLocalProject({
			fileCount: 1, suggestedKind: 'latex', entryPoints: { latex: [mainFile], typst: [], markdown: [] },
		}, 'latex', mainFile), /Invalid|Protected/);
	}
});

test('protection uses whole path segments and preserves Git attributes and unrelated prefix names', () => {
	for (const path of ['/.gitignore', '/.gitattributes', '/node_modules-not-dependencies/readme.md']) {
		assert.equal(isIgnoredLocalPath(path), false);
	}
	for (const path of ['/chapter/.git/config', '/NODE_MODULES/a.tex', '/.git', '/.DS_Store']) {
		assert.equal(isIgnoredLocalPath(path), true);
	}
});
