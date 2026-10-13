// SPDX-License-Identifier: AGPL-3.0-or-later
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { readFile, writeFile } = require('node:fs/promises');
const path = require('node:path');

const BUSYTEX_WORKER_RELATIVE_PATH = 'core/busytex/busytex_worker.js';
const BUSYTEX_WORKER_UPSTREAM_SHA256 =
	'80eca56a2eb015bdfbebff26e539dd793407b73b6c1cd351170e6fdb6e17c39a';
const BUSYTEX_CACHE_FETCH_MARKER = 'rinspace-busytex-cache-fetch-v1';

const BUSYTEX_CACHE_FETCH_OVERLAY = `// SPDX-License-Identifier: AGPL-3.0-or-later
// ${BUSYTEX_CACHE_FETCH_MARKER}
// BusyTeX fetches engine bytes from inside this dedicated worker. A controlling
// service worker cannot reliably satisfy large WASM fetches in every supported
// browser, so prefer the release-scoped same-origin CacheStorage copy.
const rinspaceBusytexNetworkFetch = self.fetch.bind(self);
self.fetch = async (input, init) => {
    const method = init?.method || (input instanceof Request ? input.method : 'GET');
    if (method.toUpperCase() !== 'GET')
        return rinspaceBusytexNetworkFetch(input, init);
    const rawUrl = input instanceof Request ? input.url : String(input);
    const absoluteUrl = new URL(rawUrl, self.location.href).href;
    const cached = await caches.match(absoluteUrl);
    if (cached)
        return cached;
    return rinspaceBusytexNetworkFetch(input, init);
};

`;

function sha256(bytes) {
	return createHash('sha256').update(bytes).digest('hex');
}

function createPatchedBusytexWorker(
	source,
	expectedSha256 = BUSYTEX_WORKER_UPSTREAM_SHA256,
) {
	assert.equal(
		sha256(source),
		expectedSha256,
		'BusyTeX worker source changed; review and update the runtime overlay',
	);
	assert.ok(
		!source.includes(BUSYTEX_CACHE_FETCH_MARKER),
		'BusyTeX worker source already contains the Rinspace overlay',
	);
	return `${BUSYTEX_CACHE_FETCH_OVERLAY}${source}`;
}

async function applyRuntimeOverlays(distDir = path.resolve(__dirname, '../../dist')) {
	const workerPath = path.join(distDir, BUSYTEX_WORKER_RELATIVE_PATH);
	const source = await readFile(workerPath, 'utf8');
	const patched = createPatchedBusytexWorker(source);
	await writeFile(workerPath, patched, 'utf8');
	return {
		file: BUSYTEX_WORKER_RELATIVE_PATH,
		upstreamSha256: BUSYTEX_WORKER_UPSTREAM_SHA256,
		artifactSha256: sha256(patched),
	};
}

if (require.main === module) {
	applyRuntimeOverlays()
		.then((result) => {
			console.log(
				`✓ Runtime overlay ${result.file} ${result.artifactSha256}`,
			);
		})
		.catch((error) => {
			console.error(`Runtime overlay failed: ${error.message}`);
			process.exitCode = 1;
		});
}

module.exports = {
	BUSYTEX_CACHE_FETCH_MARKER,
	BUSYTEX_CACHE_FETCH_OVERLAY,
	BUSYTEX_WORKER_RELATIVE_PATH,
	BUSYTEX_WORKER_UPSTREAM_SHA256,
	applyRuntimeOverlays,
	createPatchedBusytexWorker,
	sha256,
};
