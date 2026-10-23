// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import releaseModule from './assemble-release.cjs';
import config from '../../config/rinspace/release.json' with { type: 'json' };

const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

test('formal release config binds route, source, artifact and complete notice files', () => {
	releaseModule.validateReleaseConfig(config);
	assert.equal(config.routeBase, '/editor/');
	assert.equal(config.productionAccepted, true);
	assert.equal(config.texliveRuntime.runtimeId, 'texlive-2026-rinspace.1');
	assert.equal(config.texliveRuntime.endpointBasePath, '/editor/texlive/2026');
	assert.ok(config.externalNotices.length >= 30);
	assert.ok(config.externalNotices.some((entry) => entry.artifactPath.endsWith('/THIRD_PARTY.md')));
	assert.ok(config.externalNotices.some((entry) => entry.artifactPath.includes('/LICENSES/')));
});

test('release work uses the protected runner while public checks use hosted runners', async () => {
	const [releaseWorkflow, testWorkflow] = await Promise.all([
		readFile(new URL('../../.github/workflows/release.yml', import.meta.url), 'utf8'),
		readFile(new URL('../../.github/workflows/test.yml', import.meta.url), 'utf8'),
	]);
	assert.match(releaseWorkflow, /runs-on: \[self-hosted, linux, x64, rinspace-release-build\]/);
	assert.match(
		releaseWorkflow,
		/RINSPACE_ASSET_ARCHIVE_CACHE_DIR: \/repositories\/data\/texlyre-asset-cache/,
	);
	assert.match(releaseWorkflow, /build-texlive-runtime-stream\.cjs/);
	assert.match(releaseWorkflow, /reuse_texlive_runtime:[\s\S]*?default: true/);
	assert.match(releaseWorkflow, /prepare-reviewed-texlive-runtime\.cjs/);
	assert.match(releaseWorkflow, /if: \$\{\{ !inputs\.reuse_texlive_runtime \}\}/);
	assert.doesNotMatch(releaseWorkflow, /--output "\$source_dir\/texmf-dist\.tar\.zst"/);
	const outputDirectoryChange = releaseWorkflow.indexOf('cd "$output"');
	assert.ok(outputDirectoryChange > 0);
	assert.ok(
		releaseWorkflow.lastIndexOf("require('./config/rinspace/release.json')") <
			outputDirectoryChange,
	);
	assert.match(testWorkflow, /runs-on: ubuntu-latest/);
	assert.doesNotMatch(testWorkflow, /runs-on:.*rinspace-release-build/);
});

test('notice assembly rejects bytes that differ from the reviewed digest', async () => {
	const bytes = Buffer.from('reviewed notice\n');
	const target = await mkdtemp(path.join(tmpdir(), 'texlyre-release-notices-'));
	const fixture = {
		...config,
		externalNotices: [{
			id: 'fixture',
			sourcePath: 'LICENSE',
			sourceUrl: 'https://raw.githubusercontent.com/example/project/0123456789012345678901234567890123456789/LICENSE',
			size: bytes.length,
			sha256: sha256(bytes),
			artifactPath: 'notices/external/fixture/LICENSE',
		}],
	};
	const response = (body) => async () => new Response(body, { status: 200 });

	try {
		await releaseModule.assembleExternalNotices(target, fixture, response(bytes));
		assert.deepEqual(await readFile(path.join(target, fixture.externalNotices[0].artifactPath)), bytes);
		await assert.rejects(
			releaseModule.assembleExternalNotices(target, fixture, response(Buffer.from('tampered notice\n'))),
			/(size|digest) mismatch/,
		);
	} finally {
		await rm(target, { recursive: true, force: true });
	}
});
