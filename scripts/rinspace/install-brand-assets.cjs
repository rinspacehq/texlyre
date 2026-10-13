// SPDX-License-Identifier: AGPL-3.0-or-later
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');

const review = require('../../config/rinspace/brand-assets.review.json');
const root = path.resolve(__dirname, '../..');
const execFileAsync = promisify(execFile);

function validateBrandReview(candidate = review) {
	assert.equal(candidate.schema, 'rinspace-brand-assets/v1');
	assert.equal(candidate.sourceRepository, 'rinspacehq/rinspace-web');
	assert.match(candidate.sourceCommit, /^[0-9a-f]{40}$/);
	assert.ok(Array.isArray(candidate.assets) && candidate.assets.length >= 6);
	const outputs = new Set();
	for (const asset of candidate.assets) {
		assert.match(asset.path, /^(?:assets\/brand\/)?[a-z0-9.-]+$/);
		assert.match(asset.sourcePath, /^public\/(?:assets\/brand\/)?[a-z0-9.-]+$/);
		assert.ok(!outputs.has(asset.path), `duplicate brand output: ${asset.path}`);
		outputs.add(asset.path);
		assert.ok(Number.isSafeInteger(asset.size) && asset.size > 0);
		assert.match(asset.sha256, /^[0-9a-f]{64}$/);
	}
	return candidate;
}

function sourceUrl(asset, candidate = review) {
	return `https://raw.githubusercontent.com/${candidate.sourceRepository}/${candidate.sourceCommit}/${asset.sourcePath}`;
}

async function installBrandAssets(candidate = review, rootDir = root, request = fetch) {
	validateBrandReview(candidate);
	for (const asset of candidate.assets) {
		const url = sourceUrl(asset, candidate);
		let bytes;
		if (request === fetch) {
			const result = await execFileAsync('curl', [
				'--fail', '--silent', '--show-error', '--proto', '=https', '--max-redirs', '0', '--url', url,
			], { encoding: null, maxBuffer: 1024 * 1024 });
			bytes = Buffer.from(result.stdout);
		} else {
			const response = await request(url, {
				cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(60_000),
			});
			assert.equal(response.status, 200, `brand download failed: ${asset.path}`);
			bytes = Buffer.from(await response.arrayBuffer());
		}
		assert.equal(bytes.length, asset.size, `brand size mismatch: ${asset.path}`);
		assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), asset.sha256, `brand digest mismatch: ${asset.path}`);
		const destination = path.join(rootDir, 'public', asset.path);
		await fs.mkdir(path.dirname(destination), { recursive: true });
		await fs.writeFile(destination, bytes, { mode: 0o644 });
	}
	console.log(`✓ Rinspace brand assets ${candidate.sourceRelease}`);
}

if (require.main === module) {
	installBrandAssets().catch((error) => {
		console.error(`Brand asset setup failed: ${error.message}`);
		process.exitCode = 1;
	});
}

module.exports = { installBrandAssets, sourceUrl, validateBrandReview };
