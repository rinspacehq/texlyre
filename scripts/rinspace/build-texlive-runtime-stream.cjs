#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const review = require('../../config/rinspace/texlive-full-runtime.review.json');
const { buildPackFromTarStream, validateSourceReview } = require('./texlive-runtime.cjs');

async function main(treeListPath, outputDir) {
	validateSourceReview(review);
	const treeBytes = await fs.readFile(treeListPath);
	assert.equal(treeBytes.length, review.treeList.size, 'TeX Live tree list size changed');
	assert.equal(crypto.createHash('sha256').update(treeBytes).digest('hex'), review.treeList.sha256, 'TeX Live tree list digest changed');
	assert.equal(treeBytes.toString('utf8').trimEnd().split('\n').length, review.treeList.lines, 'TeX Live tree list line count changed');
	const result = await buildPackFromTarStream(process.stdin, path.resolve(outputDir), review);
	assert.equal(result.manifest.files, review.texmfRegularFiles, 'TeX Live regular-file count changed');
	console.log(JSON.stringify(result.manifest, null, 2));
}

const [treeListPath, outputDir] = process.argv.slice(2);
if (!treeListPath || !outputDir) {
	console.error('usage: curl ARCHIVE | zstd -dc | build-texlive-runtime-stream.cjs TREE_LIST OUTPUT_DIRECTORY');
	process.exit(2);
}
main(path.resolve(treeListPath), outputDir).catch((error) => {
	console.error(error);
	process.exitCode = 1;
});
