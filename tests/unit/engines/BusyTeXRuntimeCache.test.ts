// SPDX-License-Identifier: AGPL-3.0-or-later
import {
	BUSYTEX_RUNTIME_CACHE_NAME,
	cacheBusyTeXRuntimeWasm,
} from '@/extensions/texlyre-busytex/BusyTeXRuntimeCache';

describe('BusyTeX runtime cache', () => {
	it('downloads missing WASM once into the release-scoped cache', async () => {
		const stored = new Map<string, Response>();
		const cache = {
			match: jest.fn(async (url: string) => stored.get(url)),
			put: jest.fn(async (url: string, response: Response) => {
				stored.set(url, response);
			}),
		};
		const cacheStorage = {
			open: jest.fn(async () => cache),
		};
		const fetcher = jest.fn(async (url: string) => {
			const response = {
				ok: true,
				status: 200,
				statusText: 'OK',
				headers: new Headers({ 'content-type': 'application/wasm' }),
				url,
				arrayBuffer: async () => new TextEncoder().encode(url).buffer,
			};
			return response as unknown as Response;
		});
		const responseFactory = jest.fn((body: ArrayBuffer, source: Response) => ({
			...source,
			text: async () => new TextDecoder().decode(body),
		})) as unknown as (body: ArrayBuffer, source: Response) => Response;

		await expect(
			cacheBusyTeXRuntimeWasm('/editor/core/busytex', {
				cacheStorage: cacheStorage as unknown as CacheStorage,
				fetcher: fetcher as unknown as typeof fetch,
				responseFactory,
			}),
		).resolves.toEqual({ cached: 0, downloaded: 2 });
		await expect(
			cacheBusyTeXRuntimeWasm('/editor/core/busytex/', {
				cacheStorage: cacheStorage as unknown as CacheStorage,
				fetcher: fetcher as unknown as typeof fetch,
				responseFactory,
			}),
		).resolves.toEqual({ cached: 2, downloaded: 0 });

		expect(cacheStorage.open).toHaveBeenCalledWith(
			BUSYTEX_RUNTIME_CACHE_NAME,
		);
		expect(fetcher).toHaveBeenCalledTimes(2);
		expect([...stored.keys()]).toEqual([
			'/editor/core/busytex/busytex.wasm',
			'/editor/core/busytex/biber.wasm',
		]);
		expect(await stored.get('/editor/core/busytex/busytex.wasm')?.text()).toBe(
			'/editor/core/busytex/busytex.wasm',
		);
	});

	it('rejects a non-successful fixed runtime response', async () => {
		const cache = {
			match: jest.fn(async () => undefined),
			put: jest.fn(),
		};
		await expect(
			cacheBusyTeXRuntimeWasm('/editor/core/busytex', {
				cacheStorage: {
					open: jest.fn(async () => cache),
				} as unknown as CacheStorage,
				fetcher: jest.fn(async () => ({
					ok: false,
					status: 503,
				})) as unknown as typeof fetch,
			}),
		).rejects.toThrow('busytex.wasm: HTTP 503');
		expect(cache.put).not.toHaveBeenCalled();
	});
});
