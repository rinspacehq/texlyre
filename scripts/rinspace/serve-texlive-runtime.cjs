#!/usr/bin/env node
// SPDX-License-Identifier: AGPL-3.0-or-later
const path = require('node:path');
const { serveRuntime } = require('./texlive-runtime.cjs');

const [packPath, indexPath] = process.argv.slice(2);
if (!packPath || !indexPath) {
	console.error('usage: serve-texlive-runtime.cjs PACK INDEX');
	process.exit(2);
}

serveRuntime({
	packPath: path.resolve(packPath), indexPath: path.resolve(indexPath),
	host: process.env.TEXLIVE_HOST || '127.0.0.1', port: Number.parseInt(process.env.TEXLIVE_PORT || '8070', 10),
	prefix: process.env.TEXLIVE_PREFIX || '/', allowedOrigin: process.env.TEXLIVE_ALLOWED_ORIGIN || '',
}).then(({ runtime }) => console.log(`TeX Live runtime ${runtime.index.runtimeId} ready`))
	.catch((error) => { console.error(error); process.exitCode = 1; });
