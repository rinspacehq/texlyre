// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import { copyLocalWriteContent, getLocalWritePathIssue, isIgnoredLocalEntry, isIgnoredLocalPath } from '../../src/workspace/LocalWritePolicy.ts';

test('writes reject malformed, traversing and OS paths before accessing a handle', () => {
	for (const path of ['', '/', '//main.tex', '/./main.tex', '/../main.tex', '/a/../main.tex', 'C:/main.tex', '/C:/main.tex', '/a\\b.tex', '/a\0.tex', '/a//b.tex', '/a/']) {
		assert.equal(getLocalWritePathIssue(path), 'invalid-path', path);
	}
});

test('write protection covers whole path segments, not unrelated prefix names', () => {
	for (const path of ['/.git', '/chapter/.GIT/config', '/node_modules/x.tex', '/.texlyre/state.json', '/.svn/x', '/.DS_Store']) {
		assert.equal(getLocalWritePathIssue(path), 'protected-path', path);
	}
	for (const path of ['/章节/文档.typ', 'main.tex', '/.gitignore', '/.gitattributes', '/node_modules-not-dependencies/readme.md']) {
		assert.equal(getLocalWritePathIssue(path), null, path);
	}
});

test('folder imports share write protection without discovering a project language', () => {
	for (const name of ['.git', '.GIT', '.svn', 'node_modules', '.texlyre', '.DS_Store']) {
		assert.equal(isIgnoredLocalEntry(name), true, name);
		assert.equal(isIgnoredLocalPath(`/章节/${name}/file`), true, name);
	}
	for (const path of ['/.gitignore', '/.gitattributes', '/node_modules-not-dependencies', '/main.tex', '/文档.typ', '/README.md']) {
		assert.equal(isIgnoredLocalPath(path), false, path);
	}
});

test('a queued binary write retains the exact pre-await byte cut', () => {
	const source = Uint8Array.of(0, 255, 128, 13, 10);
	const copied = copyLocalWriteContent(source.buffer);
	source.fill(1);
	assert.deepEqual(new Uint8Array(copied), Uint8Array.of(0, 255, 128, 13, 10));
	assert.equal(copyLocalWriteContent('中文源码'), '中文源码');
});
