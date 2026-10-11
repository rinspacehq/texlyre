// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const oid = /^[0-9a-f]{40}$/;
const digest = /^[0-9a-f]{64}$/;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function validateDeclarations(baseline, pkg, nodeVersion) {
	assert.equal(baseline.schemaVersion, 1, 'unknown baseline schema');
	assert.equal(baseline.repository, 'rinspacehq/texlyre', 'wrong fork identity');
	assert.equal(baseline.upstream.repository, 'TeXlyre/texlyre', 'wrong upstream');
	for (const key of ['commit', 'tree', 'releaseCommit']) {
		assert.match(baseline.upstream[key], oid, `upstream ${key} must be an exact OID`);
	}
	for (const key of ['licenseSha256', 'lockfileSha256']) {
		assert.match(baseline.upstream[key], digest, `${key} must be SHA-256`);
	}
	assert.equal(baseline.license, 'AGPL-3.0-or-later');
	assert.equal(pkg.license, baseline.license, 'package license changed');
	assert.equal(baseline.toolchain.node, '24.13.1', 'unreviewed Node version');
	assert.equal(nodeVersion.trim(), baseline.toolchain.node, 'Node pin drift');
	assert.equal(pkg.engines.node, '>=24.13.1', 'upstream Node minimum drift');
	assert.equal(baseline.toolchain.packageManager, 'pnpm@10.20.0');
	assert.equal(pkg.packageManager, baseline.toolchain.packageManager);
	assert.equal(baseline.toolchain.lockfile, 'pnpm-lock.yaml');
	assert.match(baseline.toolchain.lockfileSha256, digest, 'reviewed fork lock must be SHA-256');
	assert.equal(pkg.repository.url, 'https://github.com/rinspacehq/texlyre.git');
	assert.ok(!/(?:\blint:[\w:-]*fix\b|(?:^|\s)--fix(?:\s|$))/.test(pkg.scripts['build:prod']),
		'production build must not run source fixers');
	assert.equal(baseline.stage, 'source-development');
	assert.equal(baseline.productionAccepted, false, 'source check is not production acceptance');
}

export function verifySource(root) {
	const baseline = JSON.parse(readFileSync(resolve(root, 'config/rinspace/upstream-baseline.json'), 'utf8'));
	const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
	validateDeclarations(baseline, pkg, readFileSync(resolve(root, '.node-version'), 'utf8'));
	const git = (...args) => execFileSync('git', ['-C', root, ...args], {
		encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
		env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_TERMINAL_PROMPT: '0', GIT_NO_LAZY_FETCH: '1' },
	});
	const source = baseline.upstream;
	assert.equal(git('rev-parse', `${source.commit}^{tree}`).trim(), source.tree, 'baseline tree mismatch');
	git('merge-base', '--is-ancestor', source.commit, 'HEAD');
	git('merge-base', '--is-ancestor', source.releaseCommit, source.commit);
	assert.equal(Number(git('rev-list', '--count', `${source.releaseCommit}..${source.commit}`)), source.commitsAhead);
	for (const [file, expected] of [['LICENSE', source.licenseSha256], ['pnpm-lock.yaml', source.lockfileSha256]]) {
		const original = execFileSync('git', ['-C', root, 'show', `${source.commit}:${file}`], {
			stdio: ['ignore', 'pipe', 'pipe'], env: { PATH: process.env.PATH, GIT_NO_LAZY_FETCH: '1' },
		});
		assert.equal(sha256(original), expected, `upstream ${file} hash mismatch`);
		const reviewed = file === 'pnpm-lock.yaml' ? baseline.toolchain.lockfileSha256 : expected;
		assert.equal(sha256(readFileSync(resolve(root, file))), reviewed, `working ${file} changed; re-review required`);
	}
	return { stage: baseline.stage, upstreamCommit: source.commit, upstreamTree: source.tree, license: baseline.license, productionAccepted: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const root = fileURLToPath(new URL('../../', import.meta.url));
		console.log(JSON.stringify(verifySource(root), null, 2));
	} catch (error) {
		console.error(`Source foundation rejected: ${error.message}`);
		process.exitCode = 1;
	}
}
