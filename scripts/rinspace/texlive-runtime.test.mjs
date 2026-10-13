// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import http from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const review = require('../../config/rinspace/texlive-full-runtime.review.json');
const {
	buildPackFromTarStream,
	createRuntimeHandler,
	loadRuntime,
	resolveEntry,
	safeRequestName,
} = require('./texlive-runtime.cjs');

function writeOctal(block, offset, length, value) {
	const encoded = value.toString(8).padStart(length - 1, '0');
	block.write(encoded, offset, length - 1, 'ascii');
	block[offset + length - 1] = 0;
}

function tarEntry(name, content, type = '0') {
	const bytes = Buffer.from(content);
	const header = Buffer.alloc(512);
	header.write(name, 0, 100, 'utf8');
	writeOctal(header, 100, 8, 0o644);
	writeOctal(header, 108, 8, 0);
	writeOctal(header, 116, 8, 0);
	writeOctal(header, 124, 12, bytes.length);
	writeOctal(header, 136, 12, 0);
	header.fill(0x20, 148, 156);
	header[156] = type.charCodeAt(0);
	header.write('ustar\0', 257, 6, 'ascii');
	header.write('00', 263, 2, 'ascii');
	const checksum = header.reduce((sum, byte) => sum + byte, 0);
	header.write(checksum.toString(8).padStart(6, '0'), 148, 6, 'ascii');
	header[154] = 0;
	header[155] = 0x20;
	const padding = Buffer.alloc((512 - (bytes.length % 512)) % 512);
	return Buffer.concat([header, bytes, padding]);
}

function request(port, pathname, method = 'GET') {
	return new Promise((resolve, reject) => {
		const call = http.request({ host: '127.0.0.1', port, path: pathname, method }, (response) => {
			const chunks = [];
			response.on('data', (chunk) => chunks.push(chunk));
			response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
		});
		call.once('error', reject);
		call.end();
	});
}

test('full TeX Live runtime builds deterministic basename entries and serves immutable bytes', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'rinspace-texlive-runtime-'));
	const archive = Buffer.concat([
		tarEntry('root/texmf-dist/tex/latex/ctex/ctex.sty', 'ctex-primary'),
		tarEntry('root/texmf-dist/z-last/ctex.sty', 'ctex-secondary'),
		tarEntry('root/texmf-dist/fonts/opentype/public/fandol/FandolSong-Regular.otf', 'font-bytes'),
		Buffer.alloc(1024),
	]);
	let runtime;
	let server;
	try {
		const built = await buildPackFromTarStream(Readable.from(archive), root, review);
		const index = JSON.parse(await readFile(built.indexPath, 'utf8'));
		assert.equal(index.files, 3);
		assert.equal(index.entries['ctex.sty'].length, 2);
		assert.equal(resolveEntry(index, 26, 'ctex').path, 'tex/latex/ctex/ctex.sty');
		assert.equal(resolveEntry(index, 47, 'FandolSong-Regular').path, 'fonts/opentype/public/fandol/FandolSong-Regular.otf');
		assert.equal(safeRequestName('ctex.sty'), 'ctex.sty');
		assert.equal(safeRequestName('..'), '');

		runtime = await loadRuntime(built.packPath, built.indexPath);
		server = http.createServer(createRuntimeHandler(runtime, { prefix: review.endpointBasePath }));
		await new Promise((resolve, reject) => {
			server.once('error', reject);
			server.listen(0, '127.0.0.1', resolve);
		});
		const port = server.address().port;
		const style = await request(port, `${review.endpointBasePath}/26/ctex`);
		assert.equal(style.status, 200);
		assert.equal(style.body.toString(), 'ctex-primary');
		assert.equal(style.headers['cache-control'], 'public, max-age=31536000, immutable');
		assert.equal(style.headers['x-content-type-options'], 'nosniff');
		const head = await request(port, `${review.endpointBasePath}/47/FandolSong-Regular`, 'HEAD');
		assert.equal(head.status, 200);
		assert.equal(head.body.length, 0);
		assert.equal(await request(port, `${review.endpointBasePath}/26/not-installed`).then((value) => value.status), 404);
	} finally {
		if (server) await new Promise((resolve) => server.close(resolve));
		if (runtime) await runtime.handle.close();
		await rm(root, { recursive: true, force: true });
	}
});

test('runtime resolution prefers the requested format tree and stable LaTeX over latex-dev', () => {
	const index = {
		formatExtensions: { 26: ['.cls'], 47: ['.otf'] },
		entries: {
			'article.cls': [
				{ path: 'tex/latex-dev/base/article.cls' },
				{ path: 'tex/latex/base/article.cls' },
			],
			'shared.otf': [
				{ path: 'doc/fonts/shared.otf' },
				{ path: 'fonts/opentype/public/example/shared.otf' },
			],
		},
	};
	assert.equal(resolveEntry(index, 26, 'article').path, 'tex/latex/base/article.cls');
	assert.equal(resolveEntry(index, 47, 'shared').path, 'fonts/opentype/public/example/shared.otf');
});

test('runtime build fails instead of silently omitting a filename BusyTeX cannot request', async () => {
	const root = await mkdtemp(path.join(tmpdir(), 'rinspace-texlive-runtime-long-name-'));
	const longName = `root/texmf-dist/tex/latex/example/${'a'.repeat(256)}.sty`;
	const archive = Buffer.concat([
		tarEntry('././@LongLink', `${longName}\0`, 'L'),
		tarEntry('placeholder', 'not-addressable'),
		Buffer.alloc(1024),
	]);
	try {
		await assert.rejects(
			buildPackFromTarStream(Readable.from(archive), root, review),
			/BusyTeX protocol limit/,
		);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
});
