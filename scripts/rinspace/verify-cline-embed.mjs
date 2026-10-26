// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { gunzipSync } from 'node:zlib';

const root = new URL('../../', import.meta.url);
const review = JSON.parse(
	await readFile(
		new URL('config/rinspace/cline-embed.review.json', root),
		'utf8',
	),
);

function readTarFile(archive, wantedPath) {
	for (let offset = 0; offset + 512 <= archive.length; ) {
		const header = archive.subarray(offset, offset + 512);
		if (header.every((byte) => byte === 0)) break;
		const string = (start, length) =>
			header
				.subarray(start, start + length)
				.toString('utf8')
				.replace(/\0.*$/, '');
		const path = string(0, 100);
		const size = Number.parseInt(string(124, 12).trim() || '0', 8);
		const body = archive.subarray(offset + 512, offset + 512 + size);
		if (path === wantedPath) return body;
		offset += 512 + Math.ceil(size / 512) * 512;
	}
	throw new Error(`Missing ${wantedPath} in Cline embed archive`);
}

assert.equal(
	process.argv[2],
	'--download',
	'usage: verify-cline-embed.mjs --download',
);
const bytes = execFileSync(
	'curl',
	[
		'--fail',
		'--silent',
		'--show-error',
		'--location',
		'--retry',
		'4',
		'--retry-all-errors',
		'--connect-timeout',
		'10',
		'--max-time',
		'60',
		review.url,
	],
	{ maxBuffer: 1024 * 1024 },
);
const digest = createHash('sha256').update(bytes).digest('hex');
assert.equal(digest, review.sha256, 'Cline embed Release digest mismatch');
const archive = gunzipSync(bytes);
const manifest = JSON.parse(readTarFile(archive, 'package/package.json'));
assert.equal(manifest.name, '@rinspacehq/cline-embed');
assert.equal(manifest.version, review.version);
assert.equal(manifest.license, review.license);
const ui = readTarFile(archive, 'package/dist/ui.js').toString('utf8');
assert.doesNotMatch(ui, /\bjsxDEV\b/, 'Release UI must not call jsxDEV');
assert.doesNotMatch(
	ui,
	/react\/jsx-dev-runtime/,
	'Release UI must not import the development JSX runtime',
);
console.log(
	`verified @rinspacehq/cline-embed ${manifest.version} sha256:${digest}`,
);
