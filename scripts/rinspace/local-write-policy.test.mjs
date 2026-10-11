// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';

// Native Node tests resolve this one extensionless bundler import without changing
// application source or weakening the inherited Jest TypeScript configuration.
const resolution = registerHooks({
	resolve(specifier, context, nextResolve) {
		if (specifier === './LocalProjectDiscovery' && context.parentURL === new URL('../../src/workspace/LocalWritePolicy.ts', import.meta.url).href) {
			return nextResolve(new URL('./LocalProjectDiscovery.ts', context.parentURL).href, context);
		}
		return nextResolve(specifier, context);
	},
});
const { copyLocalWriteContent, getLocalWritePathIssue } = await import('../../src/workspace/LocalWritePolicy.ts');
resolution.deregister();

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

test('a queued binary write retains the exact pre-await byte cut', () => {
	const source = Uint8Array.of(0, 255, 128, 13, 10);
	const copied = copyLocalWriteContent(source.buffer);
	source.fill(1);
	assert.deepEqual(new Uint8Array(copied), Uint8Array.of(0, 255, 128, 13, 10));
	assert.equal(copyLocalWriteContent('中文源码'), '中文源码');
});
