// SPDX-License-Identifier: AGPL-3.0-or-later
const assert = require('node:assert/strict');
const path = require('node:path');

const {
	copyVerifiedAssetTree,
	inventory,
	inventoryDigest,
} = require('./asset-integrity.cjs');
const review = require('../../config/rinspace/texlive-cjk.review.json');

const root = path.resolve(__dirname, '../..');

function validateReview(candidate = review) {
	assert.equal(candidate.schema, 'rinspace-vendored-runtime-asset/v1');
	assert.equal(candidate.stage, 'source-development');
	assert.equal(candidate.productionAccepted, false);
	assert.match(candidate.assetSet, /^[a-z0-9-]+$/);
	assert.match(candidate.inventorySha256, /^[0-9a-f]{64}$/);
	assert.ok(Number.isSafeInteger(candidate.files) && candidate.files > 0);
	assert.ok(Number.isSafeInteger(candidate.bytes) && candidate.bytes > 0);
	assert.equal(candidate.entries.length, candidate.files);
	return candidate;
}

function paths(candidate = review, rootDir = root) {
	validateReview(candidate);
	return {
		source: path.join(
			rootDir,
			'vendor/rinspace',
			candidate.assetSet,
			candidate.inventorySha256,
		),
		destination: path.join(
			rootDir,
			'public/assets',
			candidate.assetSet,
			candidate.inventorySha256,
		),
	};
}

async function verifyVendoredSource(candidate = review, rootDir = root) {
	const locations = paths(candidate, rootDir);
	const files = await inventory(locations.source);
	assert.deepEqual(files, candidate.entries.map(({ path: filePath, size, sha256 }) => ({
		path: filePath,
		size,
		sha256,
	})));
	assert.equal(files.reduce((total, file) => total + file.size, 0), candidate.bytes);
	assert.equal(inventoryDigest(files), candidate.inventorySha256);
	return { ...locations, files };
}

async function installVendoredRuntimeAssets(candidate = review, rootDir = root) {
	const verified = await verifyVendoredSource(candidate, rootDir);
	const result = await copyVerifiedAssetTree(
		verified.source,
		verified.destination,
		path.join(rootDir, 'public'),
	);
	console.log(`✓ ${candidate.assetSet} ${result.status}`);
	return {
		assetSet: candidate.assetSet,
		inventorySha256: candidate.inventorySha256,
		files: result.files.length,
		bytes: result.files.reduce((total, file) => total + file.size, 0),
		status: result.status,
	};
}

if (require.main === module) {
	installVendoredRuntimeAssets().catch((error) => {
		console.error(`Vendored runtime asset setup failed: ${error.message}`);
		process.exitCode = 1;
	});
}

module.exports = {
	installVendoredRuntimeAssets,
	paths,
	validateReview,
	verifyVendoredSource,
};
