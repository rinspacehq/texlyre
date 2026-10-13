// SPDX-License-Identifier: AGPL-3.0-or-later
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const http = require('node:http');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { deflateRawSync, inflateRawSync } = require('node:zlib');

const review = require('../../config/rinspace/texlive-full-runtime.review.json');
const INDEX_SCHEMA = 'rinspace-texlive-runtime-index/v1';
const MANIFEST_SCHEMA = 'rinspace-texlive-runtime-artifacts/v1';
const MAX_FILENAME_BYTES = 255;
const SAFE_FILENAME = /^[A-Za-z0-9][A-Za-z0-9._+-]*$/;
const TEXMF_MARKER = '/texmf-dist/';

const FORMAT_EXTENSIONS = Object.freeze({
	0: ['.gf'], 1: ['.pk'], 3: ['.tfm'], 4: ['.afm'], 5: ['.base'],
	6: ['.bib'], 7: ['.bst'], 8: ['.cnf'], 10: ['.fmt'], 11: ['.map'],
	13: ['.mf'], 16: ['.mp'], 19: ['.ocp'], 20: ['.ofm', '.tfm'],
	21: ['.opl'], 22: ['.otp'], 23: ['.ovf', '.vf'], 24: ['.ovp'],
	26: ['.tex', '.sty', '.cls', '.fd', '.def', '.cfg', '.ltx', '.dtx', '.ldf', '.clo', '.bbx', '.cbx', '.lbx', '.dbx', '.rtx'],
	28: ['.pool'], 30: ['.pro'], 32: ['.pfa', '.pfb'], 33: ['.vf'],
	35: ['.ist'], 36: ['.ttf', '.ttc', '.dfont'], 44: ['.enc'], 46: ['.sfd'],
	47: ['.otf'], 49: ['.lig'], 50: ['.lua', '.pl', '.rb', '.py'],
	51: ['.lua', '.luc', '.luatex', '.texlua', '.tlu'], 52: ['.fea'],
	53: ['.cid', '.cidmap'], 54: ['.mlbib', '.bib'], 55: ['.mlbst', '.bst'],
	57: ['.ris'], 58: ['.bltxml'],
});

const FORMAT_PATH_PREFIXES = Object.freeze({
	3: ['fonts/tfm/'], 4: ['fonts/afm/'], 6: ['bibtex/bib/'], 7: ['bibtex/bst/'],
	8: ['web2c/'], 10: ['texmf-var/web2c/'], 11: ['fonts/map/'], 13: ['fonts/source/'],
	16: ['metapost/'], 20: ['fonts/ofm/', 'fonts/tfm/'], 21: ['fonts/opl/'],
	23: ['fonts/vf/'], 24: ['fonts/ovp/'], 26: ['tex/'], 32: ['fonts/type1/'],
	35: ['makeindex/'], 36: ['fonts/truetype/'], 44: ['fonts/enc/'], 46: ['fonts/sfd/'],
	47: ['fonts/opentype/'], 50: ['scripts/'], 51: ['tex/'], 52: ['fonts/'],
});

function sha256(value) {
	return crypto.createHash('sha256').update(value).digest('hex');
}

async function digestFile(filename) {
	const hash = crypto.createHash('sha256');
	let size = 0;
	for await (const chunk of fs.createReadStream(filename)) {
		size += chunk.length;
		hash.update(chunk);
	}
	return { size, sha256: hash.digest('hex') };
}

function validateSourceReview(candidate = review) {
	assert.equal(candidate.schema, 'rinspace-texlive-runtime-source/v1');
	assert.match(candidate.runtimeId, /^texlive-[0-9]{4}-rinspace\.[0-9]+$/);
	assert.equal(candidate.repository, 'TeXlyre/texlyre-busytex-build');
	assert.ok(Number.isSafeInteger(candidate.texmfRegularFiles) && candidate.texmfRegularFiles > 0);
	assert.ok(Number.isSafeInteger(candidate.releaseId) && candidate.releaseId > 0);
	assert.match(candidate.tagCommit, /^[0-9a-f]{40}$/);
	assert.match(candidate.archiveScope, /^texmf-dist runtime tree;/);
	for (const input of [candidate.archive, candidate.treeList]) {
		assert.match(input.url, /^https:\/\/github\.com\/TeXlyre\/texlyre-busytex-build\/releases\/download\//);
		assert.ok(Number.isSafeInteger(input.size) && input.size > 0);
		assert.match(input.sha256, /^[0-9a-f]{64}$/);
	}
	assert.match(candidate.endpointBasePath, /^\/editor\/texlive\/[0-9]{4}$/);
	return candidate;
}

class AsyncByteReader {
	constructor(readable) {
		this.iterator = readable[Symbol.asyncIterator]();
		this.queue = [];
		this.available = 0;
		this.done = false;
	}
	async readExactly(size) {
		while (this.available < size && !this.done) {
			const next = await this.iterator.next();
			if (next.done) this.done = true;
			else {
				const chunk = Buffer.from(next.value);
				this.queue.push(chunk);
				this.available += chunk.length;
			}
		}
		if (this.available < size) throw new Error(`truncated tar stream: wanted ${size} bytes`);
		const result = Buffer.allocUnsafe(size);
		let written = 0;
		while (written < size) {
			const first = this.queue[0];
			const take = Math.min(first.length, size - written);
			first.copy(result, written, 0, take);
			written += take;
			this.available -= take;
			if (take === first.length) this.queue.shift();
			else this.queue[0] = first.subarray(take);
		}
		return result;
	}
}

function tarString(block, start, length) {
	const end = block.indexOf(0, start);
	return block.subarray(start, end === -1 || end > start + length ? start + length : end).toString('utf8');
}

function tarSize(block) {
	const field = block.subarray(124, 136);
	if (field[0] & 0x80) {
		let value = BigInt(field[0] & 0x7f);
		for (const byte of field.subarray(1)) value = (value << 8n) | BigInt(byte);
		const number = Number(value);
		if (!Number.isSafeInteger(number)) throw new Error('tar entry is too large');
		return number;
	}
	const value = field.toString('ascii').replace(/\0.*$/, '').trim();
	return value ? Number.parseInt(value, 8) : 0;
}

function parsePax(bytes) {
	const values = {};
	let offset = 0;
	while (offset < bytes.length) {
		const space = bytes.indexOf(0x20, offset);
		if (space < 0) break;
		const length = Number.parseInt(bytes.subarray(offset, space).toString('ascii'), 10);
		if (!Number.isSafeInteger(length) || length <= 0 || offset + length > bytes.length) break;
		const record = bytes.subarray(space + 1, offset + length - 1).toString('utf8');
		const equals = record.indexOf('=');
		if (equals > 0) values[record.slice(0, equals)] = record.slice(equals + 1);
		offset += length;
	}
	return values;
}

function texmfPath(archivePath) {
	const normalized = archivePath.replace(/^\.\//, '');
	const marker = normalized.indexOf(TEXMF_MARKER);
	const relative = marker >= 0
		? normalized.slice(marker + TEXMF_MARKER.length)
		: normalized.startsWith('texmf-dist/') ? normalized.slice('texmf-dist/'.length) : '';
	if (!relative || relative.includes('\\') || path.posix.isAbsolute(relative) || relative.split('/').includes('..')) return '';
	return relative;
}

async function verifyInput(filename, expected, label) {
	const actual = await digestFile(filename);
	assert.deepEqual(actual, { size: expected.size, sha256: expected.sha256 }, `${label} changed`);
}

async function buildPackFromTarStream(readable, outputDir, candidate = review) {
	validateSourceReview(candidate);
	await fsp.mkdir(outputDir, { recursive: true });
	const stem = candidate.runtimeId;
	const packPath = path.join(outputDir, `${stem}.pack`);
	const indexPath = path.join(outputDir, `${stem}.index.json`);
	const manifestPath = path.join(outputDir, `${stem}.manifest.json`);
	for (const filename of [packPath, indexPath, manifestPath]) {
		try { await fsp.access(filename); throw new Error(`refusing to overwrite ${filename}`); } catch (error) {
			if (error.code !== 'ENOENT') throw error;
		}
	}
	const partialPack = `${packPath}.partial-${process.pid}`;
	const handle = await fsp.open(partialPack, 'wx', 0o644);
	const reader = new AsyncByteReader(readable);
	const entries = {};
	const packHash = crypto.createHash('sha256');
	let offset = 0;
	let fileCount = 0;
	let rawBytes = 0;
	let pendingLongName = '';
	let pendingPax = {};
	try {
		while (true) {
			const header = await reader.readExactly(512);
			if (header.every((byte) => byte === 0)) break;
			const size = tarSize(header);
			const padded = Math.ceil(size / 512) * 512;
			const body = await reader.readExactly(padded);
			const payload = body.subarray(0, size);
			const type = String.fromCharCode(header[156] || 0);
			let name = pendingLongName || pendingPax.path || [tarString(header, 345, 155), tarString(header, 0, 100)].filter(Boolean).join('/');
			pendingLongName = '';
			pendingPax = {};
			if (type === 'L') { pendingLongName = payload.toString('utf8').replace(/\0.*$/, ''); continue; }
			if (type === 'x') { pendingPax = parsePax(payload); continue; }
			if (type !== '\0' && type !== '0') continue;
			const relative = texmfPath(name);
			if (!relative) continue;
			const basename = path.posix.basename(relative);
			assert.ok(basename, `TeX Live entry has no basename: ${relative}`);
			assert.ok(
				Buffer.byteLength(basename) <= MAX_FILENAME_BYTES,
				`TeX Live basename exceeds the BusyTeX protocol limit: ${relative}`,
			);
			const compressed = deflateRawSync(payload, { level: 6 });
			await handle.write(compressed, 0, compressed.length, offset);
			packHash.update(compressed);
			const key = basename.toLowerCase();
			(entries[key] ||= []).push({ path: relative, offset, compressedSize: compressed.length, size, sha256: sha256(payload) });
			offset += compressed.length;
			fileCount += 1;
			rawBytes += size;
		}
		await handle.sync();
	} catch (error) {
		await handle.close();
		await fsp.rm(partialPack, { force: true });
		throw error;
	}
	await handle.close();
	for (const candidates of Object.values(entries)) candidates.sort((left, right) => left.path.localeCompare(right.path, 'en'));
	const orderedEntries = Object.fromEntries(Object.entries(entries).sort(([left], [right]) => left.localeCompare(right, 'en')));
	const index = {
		schema: INDEX_SCHEMA, runtimeId: candidate.runtimeId, texliveVersion: candidate.texliveVersion,
		compression: 'deflate-raw', selection: 'format-path-priority-then-stable-basename-v2',
		pack: { filename: path.basename(packPath), size: offset, sha256: packHash.digest('hex') },
		files: fileCount, rawBytes, basenames: Object.keys(orderedEntries).length,
		collisions: Object.values(orderedEntries).filter((values) => values.length > 1).length,
		formatExtensions: FORMAT_EXTENSIONS, entries: orderedEntries,
	};
	const indexBytes = Buffer.from(`${JSON.stringify(index)}\n`);
	const manifest = {
		schema: MANIFEST_SCHEMA, runtimeId: candidate.runtimeId, source: candidate,
		pack: index.pack, index: { filename: path.basename(indexPath), size: indexBytes.length, sha256: sha256(indexBytes) },
		files: fileCount, rawBytes, basenames: index.basenames, collisions: index.collisions,
	};
	await fsp.rename(partialPack, packPath);
	await fsp.writeFile(indexPath, indexBytes, { mode: 0o644, flag: 'wx' });
	await fsp.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644, flag: 'wx' });
	return { packPath, indexPath, manifestPath, manifest };
}

async function buildPackFromArchive(archivePath, treeListPath, outputDir, candidate = review) {
	await verifyInput(archivePath, candidate.archive, 'TeX Live archive');
	await verifyInput(treeListPath, candidate.treeList, 'TeX Live tree list');
	const lines = (await fsp.readFile(treeListPath, 'utf8')).trimEnd().split('\n').length;
	assert.equal(lines, candidate.treeList.lines, 'TeX Live tree list line count changed');
	const child = spawn('zstd', ['-dc', '--', archivePath], { stdio: ['ignore', 'pipe', 'inherit'] });
	const result = await buildPackFromTarStream(child.stdout, outputDir, candidate);
	const exitCode = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
	assert.equal(exitCode, 0, 'zstd decompression failed');
	assert.equal(result.manifest.files, candidate.texmfRegularFiles, 'TeX Live regular-file count changed');
	return result;
}

function safeRequestName(encoded) {
	let name;
	try { name = decodeURIComponent(encoded); } catch { return ''; }
	if (!SAFE_FILENAME.test(name) || Buffer.byteLength(name) > MAX_FILENAME_BYTES || name === '.' || name === '..') return '';
	return name;
}

function candidatePriority(entry, format) {
	const prefixes = FORMAT_PATH_PREFIXES[String(format)] || [];
	const prefixIndex = prefixes.findIndex((prefix) => entry.path.startsWith(prefix));
	let score = prefixIndex < 0 ? 100 : prefixIndex;
	// The TeX Live tree intentionally contains the next LaTeX development
	// snapshot alongside the stable tree. Normal compilation must not select it.
	if (entry.path.startsWith('tex/latex-dev/')) score += 1_000;
	return score;
}

function selectCandidate(candidates, format) {
	if (!candidates?.length) return null;
	return candidates.reduce((selected, entry) => {
		const selectedPriority = candidatePriority(selected, format);
		const entryPriority = candidatePriority(entry, format);
		if (entryPriority !== selectedPriority) return entryPriority < selectedPriority ? entry : selected;
		return entry.path.localeCompare(selected.path, 'en') < 0 ? entry : selected;
	});
}

function resolveEntry(index, format, requestedName) {
	const exact = index.entries[requestedName.toLowerCase()];
	if (exact?.length) return selectCandidate(exact, format);
	if (path.posix.extname(requestedName)) return null;
	for (const extension of index.formatExtensions[String(format)] || []) {
		const candidates = index.entries[`${requestedName}${extension}`.toLowerCase()];
		if (candidates?.length) return selectCandidate(candidates, format);
	}
	return null;
}

async function loadRuntime(packPath, indexPath) {
	const indexBytes = await fsp.readFile(indexPath);
	const index = JSON.parse(indexBytes);
	assert.equal(index.schema, INDEX_SCHEMA);
	assert.equal(index.compression, 'deflate-raw');
	assert.equal(path.basename(packPath), index.pack.filename);
	const stat = await fsp.stat(packPath);
	assert.equal(stat.size, index.pack.size);
	return { index, handle: await fsp.open(packPath, 'r') };
}

function createRuntimeHandler(runtime, options = {}) {
	const prefix = String(options.prefix || '/').replace(/\/$/, '');
	const allowedOrigin = options.allowedOrigin || '';
	return async (request, response) => {
		try {
			const url = new URL(request.url, 'http://runtime.invalid');
			if (url.pathname === `${prefix}/health`) {
				response.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
				response.end(JSON.stringify({ status: 'ok', runtimeId: runtime.index.runtimeId }));
				return;
			}
			const match = url.pathname.match(new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\/(\\d+)\\/([^/]+)$`));
			if (!match || !['GET', 'HEAD'].includes(request.method)) { response.writeHead(404); response.end(); return; }
			const format = Number.parseInt(match[1], 10);
			const name = safeRequestName(match[2]);
			if (!name || !Number.isSafeInteger(format) || format < 0 || format > 255) { response.writeHead(400); response.end(); return; }
			const entry = resolveEntry(runtime.index, format, name);
			if (!entry) { response.writeHead(404, { 'cache-control': 'public, max-age=300' }); response.end(); return; }
			const compressed = Buffer.allocUnsafe(entry.compressedSize);
			await runtime.handle.read(compressed, 0, entry.compressedSize, entry.offset);
			const bytes = inflateRawSync(compressed);
			if (bytes.length !== entry.size || sha256(bytes) !== entry.sha256) throw new Error(`runtime entry failed integrity: ${entry.path}`);
			const headers = {
				'content-type': 'application/octet-stream', 'content-length': String(bytes.length),
				'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff',
				'fileid': path.posix.basename(entry.path), 'access-control-expose-headers': 'fileid',
			};
			if (allowedOrigin) headers['access-control-allow-origin'] = allowedOrigin;
			response.writeHead(200, headers);
			response.end(request.method === 'HEAD' ? undefined : bytes);
		} catch (error) {
			console.error(error);
			if (!response.headersSent) response.writeHead(500, { 'cache-control': 'no-store' });
			response.end();
		}
	};
}

async function serveRuntime({ packPath, indexPath, host = '127.0.0.1', port = 8070, prefix = '/', allowedOrigin = '' }) {
	const runtime = await loadRuntime(packPath, indexPath);
	const server = http.createServer(createRuntimeHandler(runtime, { prefix, allowedOrigin }));
	await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, host, resolve); });
	return { runtime, server };
}

module.exports = {
	FORMAT_EXTENSIONS, FORMAT_PATH_PREFIXES, buildPackFromArchive, buildPackFromTarStream, createRuntimeHandler,
	digestFile, loadRuntime, resolveEntry, safeRequestName, serveRuntime, texmfPath,
	selectCandidate, validateSourceReview,
};
