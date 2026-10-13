// SPDX-License-Identifier: AGPL-3.0-or-later
// Fixed public runtime assets. Never use this path for user documents.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { createWriteStream } = require('node:fs');
const fs = require('fs-extra');
const path = require('node:path');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const JSZip = require('jszip');

const {
	assetPath,
	inventory,
	inventoryDigest,
} = require('./rinspace/asset-integrity.cjs');
const review = require('../config/rinspace/external-assets.review.json');

const execFileAsync = promisify(execFile);
const root = path.resolve(__dirname, '..');
const publicRoot = path.join(root, 'public');
const generatedManifestPath = path.join(
	publicRoot,
	'rinspace-external-assets.json',
);
const allowedHosts = new Set([
	'github.com',
	'codeload.github.com',
	'release-assets.githubusercontent.com',
	'objects.githubusercontent.com',
]);

const ASSETS = [
	{
		id: 'drawio-embed',
		dest: path.join(publicRoot, 'core/drawio-embed'),
		extractPath: (entry) =>
			`drawio-embed-mirror-${entry.sourceCommit}/drawio-embed/`,
	},
	{
		id: 'tikz-editor',
		dest: path.join(publicRoot, 'core/tikz-editor'),
		extractPath: (entry) =>
			`tikz-editor-embed-mirror-${entry.sourceCommit}/tikz-editor/`,
	},
	{
		id: 'tex-fmt',
		dest: path.join(publicRoot, 'core/texfmt'),
		extractPath: () => 'pkg/',
	},
	{
		id: 'busytex',
		dest: path.join(publicRoot, 'core/busytex'),
		tarRoot: 'busytex',
	},
	{
		id: 'grammar-assets',
		optionalId: 'grammar-assets-optional',
		dest: path.join(publicRoot, 'assets/grammars'),
		extractPath: (entry) =>
			`texlyre-grammar-assets-${entry.version.substring(1)}${
				entry.id.endsWith('-optional') ? '-include-optional' : ''
			}/`,
	},
	{
		id: 'font-assets',
		dest: path.join(publicRoot, 'assets/fonts'),
		extractPath: (entry) =>
			`texlyre-font-assets-${entry.version.substring(1)}/`,
	},
];

function validateReviewEntry(entry) {
	assert.match(entry.id, /^[a-z0-9-]+$/);
	assert.match(entry.sha256, /^[0-9a-f]{64}$/, 'asset digest is not fixed');
	assert.ok(
		Number.isSafeInteger(entry.size) &&
			entry.size > 0 &&
			entry.size <= entry.maxBytes,
		'asset size is not fixed',
	);
	validateAssetUrl(entry.url);
	if (entry.extracted !== undefined) {
		assert.ok(Number.isSafeInteger(entry.extracted.files) && entry.extracted.files > 0);
		assert.ok(Number.isSafeInteger(entry.extracted.bytes) && entry.extracted.bytes > 0);
		assert.match(entry.extracted.inventorySha256, /^[0-9a-f]{64}$/);
	}
	if (entry.buildSourceCommit !== undefined) {
		assert.match(entry.buildSourceCommit, /^[0-9a-f]{40}$/);
	}
	return entry;
}

function getReviewEntry(id) {
	assert.equal(review.schema, 'texlyre-external-asset-review/v1');
	assert.equal(review.productionAccepted, false);
	const entry = review.assets.find((candidate) => candidate.id === id);
	assert.ok(entry, `missing reviewed asset: ${id}`);
	return validateReviewEntry(entry);
}

function resolveRequestedId(spec, requestedIds) {
	const baseRequested = requestedIds.has(spec.id);
	const optionalRequested =
		Boolean(spec.optionalId) && requestedIds.has(spec.optionalId);
	assert.ok(
		!(baseRequested && optionalRequested),
		`external asset variants share a destination: ${spec.id}`,
	);
	return optionalRequested
		? spec.optionalId
		: baseRequested
			? spec.id
			: null;
}

function validateAssetUrl(value) {
	const url = new URL(value);
	assert.ok(
		url.protocol === 'https:' &&
			allowedHosts.has(url.hostname) &&
			!url.username &&
			!url.password &&
			(!url.port || url.port === '443'),
		'unapproved public asset URL',
	);
	return url;
}

async function verifyDownloadedArchive(entry, filename) {
	const hash = createHash('sha256');
	let size = 0;
	for await (const chunk of fs.createReadStream(filename)) {
		size += chunk.byteLength;
		assert.ok(size <= entry.maxBytes, 'asset exceeds reviewed byte limit');
		hash.update(chunk);
	}
	const sha256 = hash.digest('hex');
	assert.equal(size, entry.size, `asset ${entry.id} size mismatch`);
	assert.equal(sha256, entry.sha256, `asset ${entry.id} digest mismatch`);
	return { size, sha256 };
}

async function downloadArchive(entry, filename, request) {
	const useCurlTransport = request === undefined;
	request ??= fetch;
	let url = validateAssetUrl(entry.url);
	let response;
	// The fixed BusyTeX archive is about 522 MB. A ten-minute total timeout
	// made a valid acquisition impossible on slower mainland routes.
	const signal = AbortSignal.timeout(45 * 60 * 1000);

	for (let redirects = 0; redirects <= 5; redirects++) {
		response = await request(url.href, {
			credentials: 'omit',
			redirect: 'manual',
			signal,
		});
		if (![301, 302, 303, 307, 308].includes(response.status)) break;
		assert.ok(redirects < 5, 'too many asset redirects');
		const location = response.headers.get('location');
		assert.ok(location, 'asset redirect is missing a location');
		await response.body?.cancel();
		url = validateAssetUrl(new URL(location, url).href);
	}

	assert.equal(response?.status, 200, `asset ${entry.id} download failed`);
	assert.ok(response.body, 'empty asset response');

	if (useCurlTransport) {
		// Node's direct HTTPS path can be orders of magnitude slower than the
		// host's configured HTTPS transport. Redirects were already resolved
		// and allowlisted above; curl is forbidden from following another one.
		await response.body.cancel();
		try {
			await execFileAsync(
				'curl',
				[
					'--fail',
					'--silent',
					'--show-error',
					'--proto',
					'=https',
					'--max-redirs',
					'0',
					'--connect-timeout',
					'30',
					'--max-time',
					String(45 * 60),
					'--max-filesize',
					String(entry.maxBytes),
					'--output',
					filename,
					'--url',
					url.href,
				],
				{ maxBuffer: 1024 * 1024 },
			);
			await fs.chmod(filename, 0o600);
			return await verifyDownloadedArchive(entry, filename);
		} catch (error) {
			await fs.remove(filename);
			throw error;
		}
	}

	const hash = createHash('sha256');
	let size = 0;
	const meter = new Transform({
		transform(chunk, _encoding, callback) {
			size += chunk.byteLength;
			if (size > entry.maxBytes) {
				callback(new Error('asset exceeds reviewed byte limit'));
				return;
			}
			hash.update(chunk);
			callback(null, chunk);
		},
	});

	try {
		await pipeline(
			Readable.fromWeb(response.body),
			meter,
			createWriteStream(filename, { flags: 'wx', mode: 0o600 }),
		);
		const sha256 = hash.digest('hex');
		assert.equal(size, entry.size, `asset ${entry.id} size mismatch`);
		assert.equal(sha256, entry.sha256, `asset ${entry.id} digest mismatch`);
		return { size, sha256 };
	} catch (error) {
		await fs.remove(filename);
		throw error;
	}
}

function isZipSymlink(file) {
	const permissions = file.unixPermissions;
	return (
		typeof permissions === 'number' &&
		(permissions & 0o170000) === 0o120000
	);
}

async function extractZip(filename, destination, rootFolder) {
	const zip = await JSZip.loadAsync(await fs.readFile(filename));
	let extracted = 0;
	let excludedUnsafeArchiveEntries = 0;
	await fs.ensureDir(destination);

	for (const [normalizedName, file] of Object.entries(zip.files)) {
		const originalName = file.unsafeOriginalName ?? normalizedName;
		assert.equal(originalName, normalizedName, 'unsafe normalized ZIP path');
		assert.ok(!isZipSymlink(file), 'asset ZIP symlink rejected');
		if (!normalizedName.startsWith(rootFolder) || file.dir) continue;

		const relativePath = normalizedName.substring(rootFolder.length);
		if (!relativePath) continue;
		if (relativePath.includes('\\')) {
			excludedUnsafeArchiveEntries++;
			continue;
		}
		assetPath(relativePath);
		const target = path.join(destination, relativePath);
		await fs.ensureDir(path.dirname(target));
		await fs.writeFile(target, await file.async('nodebuffer'), {
			flag: 'wx',
			mode: 0o644,
		});
		extracted++;
	}

	assert.ok(extracted > 0, 'asset ZIP contained no reviewed files');
	return { excludedUnsafeArchiveEntries };
}

async function extractTarGz(filename, stageRoot, tarRoot) {
	const { stdout } = await execFileAsync(
		'tar',
		['--list', '--gzip', '--file', filename],
		{ encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
	);
	const entries = stdout.split('\n').filter(Boolean);
	assert.ok(entries.length > 0, 'asset tar contained no files');
	for (const entry of entries) {
		const normalized = entry.endsWith('/') ? entry.slice(0, -1) : entry;
		assetPath(normalized);
		assert.ok(
			normalized === tarRoot || normalized.startsWith(`${tarRoot}/`),
			'asset tar escaped its reviewed root',
		);
	}

	await execFileAsync(
		'tar',
		[
			'--extract',
			'--gzip',
			'--file',
			filename,
			'--directory',
			stageRoot,
			'--no-same-owner',
			'--no-same-permissions',
		],
		{ maxBuffer: 1024 * 1024 },
	);
}

function summarizeInventory(files) {
	return {
		files: files.length,
		bytes: files.reduce((total, file) => total + file.size, 0),
		inventorySha256: inventoryDigest(files),
	};
}

function verifyInventoryLock(entry, summary) {
	assert.ok(
		entry.extracted,
		`asset ${entry.id} has no reviewed extracted inventory`,
	);
	assert.deepEqual(
		summary,
		entry.extracted,
		`asset ${entry.id} extracted inventory mismatch`,
	);
}

async function verifyExisting(entry, destination) {
	const files = await inventory(destination);
	const summary = summarizeInventory(files);
	verifyInventoryLock(entry, summary);
	return { status: 'verified-cache', ...summary };
}

async function installAsset(spec, entry, recordInventory) {
	if (await fs.pathExists(spec.dest)) {
		return verifyExisting(entry, spec.dest);
	}

	const parent = path.dirname(spec.dest);
	await fs.ensureDir(parent);
	const stageRoot = await fs.mkdtemp(path.join(parent, '.rinspace-asset-stage-'));
	const archive = path.join(stageRoot, 'source.archive');
	const stagedDestination = path.join(stageRoot, path.basename(spec.dest));

	try {
		await downloadArchive(entry, archive);
		let extraction = { excludedUnsafeArchiveEntries: 0 };
		if (spec.tarRoot) {
			await extractTarGz(archive, stageRoot, spec.tarRoot);
			assert.equal(path.basename(stagedDestination), spec.tarRoot);
		} else {
			extraction = await extractZip(
				archive,
				stagedDestination,
				spec.extractPath(entry),
			);
		}

		const files = await inventory(stagedDestination);
		const summary = summarizeInventory(files);
		if (!recordInventory) {
			verifyInventoryLock(entry, summary);
			assert.equal(
				extraction.excludedUnsafeArchiveEntries,
				entry.excludedUnsafeArchiveEntries ?? 0,
				`asset ${entry.id} excluded archive entry mismatch`,
			);
		}
		assert.ok(
			!(await fs.pathExists(spec.dest)),
			'asset destination appeared during staging',
		);
		await fs.rename(stagedDestination, spec.dest);
		return {
			status: recordInventory ? 'recorded-candidate' : 'installed',
			...extraction,
			...summary,
		};
	} finally {
		await fs.remove(stageRoot);
	}
}

async function downloadCoreAssets(
	includeOptional = process.env.TEXLYRE_INCLUDE_OPTIONAL === '1',
	options = {},
) {
	const recordInventory =
		options.recordInventory ??
		process.env.RINSPACE_RECORD_EXTERNAL_ASSET_LOCK === '1';
	const requestedIds = new Set(
		options.assetIds ??
			(process.env.RINSPACE_EXTERNAL_ASSET_IDS
				? process.env.RINSPACE_EXTERNAL_ASSET_IDS.split(',').filter(Boolean)
				: ASSETS.map((asset) =>
						includeOptional && asset.optionalId ? asset.optionalId : asset.id,
					)),
	);
	const knownIds = new Set(
		ASSETS.flatMap((asset) => [asset.id, asset.optionalId].filter(Boolean)),
	);
	for (const id of requestedIds) {
		assert.ok(knownIds.has(id), `unknown external asset id: ${id}`);
	}
	const assets = [];

	for (const spec of ASSETS) {
		const id = resolveRequestedId(spec, requestedIds);
		if (!id) continue;
		const entry = getReviewEntry(id);
		const result = await installAsset(spec, entry, recordInventory);
		assets.push({
			id,
			version: entry.version,
			sourceUrl: entry.url,
			archiveSize: entry.size,
			archiveSha256: entry.sha256,
			...result,
		});
		console.log(`✓ ${id} ${result.status}`);
	}

	const manifest = {
		schema: 'texlyre-external-runtime-assets/v1',
		stage: recordInventory ? 'inventory-candidate' : 'source-development',
		productionAccepted: false,
		assets,
	};
	await fs.writeFile(
		generatedManifestPath,
		`${JSON.stringify(manifest, null, 2)}\n`,
	);
	console.log('✅ External runtime assets verified');
	return manifest;
}

if (require.main === module) {
	downloadCoreAssets().catch((error) => {
		console.error(`External runtime asset setup failed: ${error.message}`);
		process.exitCode = 1;
	});
}

module.exports = {
	ASSETS,
	downloadArchive,
	downloadCoreAssets,
	getReviewEntry,
	resolveRequestedId,
	summarizeInventory,
	validateAssetUrl,
	verifyInventoryLock,
};
