// SPDX-License-Identifier: AGPL-3.0-or-later

export const BUSYTEX_RUNTIME_CACHE_NAME = 'rinspace-busytex-runtime-v1';

const RUNTIME_WASM_FILES = ['busytex.wasm', 'biber.wasm'] as const;

interface RuntimeCacheDependencies {
	cacheStorage?: CacheStorage;
	fetcher?: typeof fetch;
	responseFactory?: (body: ArrayBuffer, source: Response) => Response;
}

export interface BusyTeXRuntimeCacheResult {
	cached: number;
	downloaded: number;
}

export async function cacheBusyTeXRuntimeWasm(
	basePath: string,
	dependencies: RuntimeCacheDependencies = {},
): Promise<BusyTeXRuntimeCacheResult> {
	const cacheStorage = dependencies.cacheStorage ?? globalThis.caches;
	const fetcher = dependencies.fetcher ?? globalThis.fetch;
	const responseFactory =
		dependencies.responseFactory ??
		((body: ArrayBuffer, source: Response) =>
			new Response(body, {
				status: source.status,
				statusText: source.statusText,
				headers: source.headers,
			}));
	if (!cacheStorage || !fetcher) return { cached: 0, downloaded: 0 };

	const cache = await cacheStorage.open(BUSYTEX_RUNTIME_CACHE_NAME);
	let cached = 0;
	let downloaded = 0;

	for (const filename of RUNTIME_WASM_FILES) {
		const url = `${basePath.replace(/\/$/, '')}/${filename}`;
		if (await cache.match(url)) {
			cached++;
			continue;
		}

		const response = await fetcher(url, { credentials: 'same-origin' });
		if (!response.ok) {
			throw new Error(
				`Failed to cache BusyTeX runtime ${filename}: HTTP ${response.status}`,
			);
		}
		// Chromium can fail Cache.put(response.clone()) when the same large WASM
		// stream is also passing through the application service worker. Fully
		// materialize this fixed same-origin asset before handing it to CacheStorage.
		const bytes = await response.arrayBuffer();
		await cache.put(url, responseFactory(bytes, response));
		downloaded++;
	}

	return { cached, downloaded };
}
