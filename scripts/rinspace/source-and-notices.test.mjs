// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import dependencyModule from './generate-dependency-notices.cjs';
import candidateModule from './source-candidate.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

test('source candidate binds every changed source path to the current base commit', async () => {
	const candidate = await candidateModule.collectSourceCandidate(root);
	assert.match(candidate.baseCommit, /^[0-9a-f]{40}$/);
	assert.match(candidate.baseTree, /^[0-9a-f]{40}$/);
	assert.match(candidate.candidateSha256, /^[0-9a-f]{64}$/);
	assert.equal(candidate.changedPaths, candidate.entries.length);
	assert.deepEqual(candidate.entries.map((entry) => entry.path),
		[...candidate.entries.map((entry) => entry.path)].sort());
	assert.ok(candidate.entries.some((entry) => entry.path === 'scripts/rinspace/source-candidate.cjs'));
	assert.equal(candidate.cleanCommit, false);
	assert.equal(candidate.correspondingSourceAvailableAtSourceUrl, false);
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
