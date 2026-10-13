#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
const path = require('node:path');
const { buildPackFromArchive } = require('./texlive-runtime.cjs');

const [archivePath, treeListPath, outputDir] = process.argv.slice(2);
if (!archivePath || !treeListPath || !outputDir) {
	console.error('usage: build-texlive-runtime.cjs TEXMF_DIST_TAR_ZST TREE_LIST OUTPUT_DIRECTORY');
	process.exit(2);
}

buildPackFromArchive(path.resolve(archivePath), path.resolve(treeListPath), path.resolve(outputDir))
	.then(({ manifest }) => console.log(JSON.stringify(manifest, null, 2)))
	.catch((error) => { console.error(error); process.exitCode = 1; });
