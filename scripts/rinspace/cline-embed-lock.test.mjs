// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const root = new URL('../../', import.meta.url);
const readJson = async (path) => JSON.parse(await readFile(new URL(path, root), 'utf8'));

test('Cline embed consumption is an exact reviewed Release asset', async () => {
	const review = await readJson('config/rinspace/cline-embed.review.json');
	const pkg = await readJson('package.json');
	const lock = await readFile(new URL('pnpm-lock.yaml', root), 'utf8');

	assert.equal(review.schemaVersion, 1);
	assert.match(review.version, /^0\.1\.0-rinspace\.1$/);
	assert.equal(review.tag, `v${review.version}`);
	assert.match(review.commit, /^[0-9a-f]{40}$/);
	assert.match(review.sha256, /^[0-9a-f]{64}$/);
	assert.equal(pkg.dependencies['@rinspacehq/cline-embed'], review.url);
	assert.match(review.url, /\/releases\/download\/v0\.1\.0-rinspace\.1\//);
	assert.doesNotMatch(review.url, /\/(main|latest)(\/|$)/);
	assert.ok(lock.includes(review.url), 'pnpm lock must retain the exact Release URL');
	const entry = lock.slice(lock.indexOf(`'@rinspacehq/cline-embed@${review.url}'`));
	assert.match(entry.slice(0, entry.indexOf('\n\n')), /version: 0\.1\.0-rinspace\.1/);
});
