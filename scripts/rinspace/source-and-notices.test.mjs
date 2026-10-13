// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import dependencyModule from './generate-dependency-notices.cjs';
import candidateModule from './source-candidate.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('source candidate binds every changed source path to the current base commit', async () => {
	const repository = await mkdtemp(path.join(tmpdir(), 'texlyre-source-candidate-'));
	const git = (args) => execFileSync('git', ['-C', repository, ...args], {
		stdio: 'ignore',
		env: {
			...process.env,
			GIT_AUTHOR_NAME: 'Rinspace Tests',
			GIT_AUTHOR_EMAIL: 'tests@rinspace.local',
			GIT_COMMITTER_NAME: 'Rinspace Tests',
			GIT_COMMITTER_EMAIL: 'tests@rinspace.local',
		},
	});

	try {
		git(['init', '--quiet']);
		await writeFile(path.join(repository, 'tracked.txt'), 'base\n');
		git(['add', 'tracked.txt']);
		git(['commit', '--quiet', '-m', 'base']);
		await writeFile(path.join(repository, 'tracked.txt'), 'changed\n');
		await mkdir(path.join(repository, 'scripts/rinspace'), { recursive: true });
		await writeFile(
			path.join(repository, 'scripts/rinspace/source-candidate.cjs'),
			'candidate source\n',
		);

		const candidate = await candidateModule.collectSourceCandidate(repository);
		assert.match(candidate.baseCommit, /^[0-9a-f]{40}$/);
		assert.match(candidate.baseTree, /^[0-9a-f]{40}$/);
		assert.match(candidate.candidateSha256, /^[0-9a-f]{64}$/);
		assert.equal(candidate.changedPaths, candidate.entries.length);
		assert.deepEqual(candidate.entries.map((entry) => entry.path), [
			'scripts/rinspace/source-candidate.cjs',
			'tracked.txt',
		]);
		assert.equal(candidate.cleanCommit, false);
		assert.equal(candidate.correspondingSourceAvailableAtSourceUrl, false);
	} finally {
		await rm(repository, { recursive: true, force: true });
	}
});

test('production dependency notice follows the installed locked graph and retains license text', async () => {
	const notices = await dependencyModule.collectDependencyNotices(root);
	const lockfile = await readFile(path.join(root, 'pnpm-lock.yaml'));
	assert.equal(notices.lockfileSha256,
		createHash('sha256').update(lockfile).digest('hex'));
	assert.ok(notices.packages.length > 400);
	assert.ok(notices.licenseTexts.length > 100);
	assert.ok(notices.packages.some((pkg) =>
		pkg.name === 'js-yaml' && pkg.version === '5.4.2' && pkg.license === 'MIT'));
	for (const pkg of notices.packages) {
		assert.ok(pkg.license || pkg.licenseTextSha256.length > 0,
			`${pkg.name}@${pkg.version} lacks a declared license and package notice`);
	}
	assert.equal(notices.productionAccepted, false);
});
