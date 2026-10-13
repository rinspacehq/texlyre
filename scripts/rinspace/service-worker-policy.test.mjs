// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import vm from 'node:vm';

const origin = 'https://app.example';
const source = await readFile(new URL('../../public/sw.js', import.meta.url), 'utf8');

function requestKey(input) {
	return typeof input === 'string' ? input : input.url;
}

function runtime() {
	const handlers = new Map();
	const deleted = [];
	const fetched = [];
	const stores = new Map();

	function cache(name) {
		if (!stores.has(name)) stores.set(name, new Map());
		const entries = stores.get(name);
		return {
			match: async (request) => entries.get(requestKey(request)),
			put: async (request, response) => {
				entries.set(requestKey(request), response);
			},
		};
	}

	class MockRequest {
		constructor(input, options = {}) {
			this.url = new URL(input, origin).href;
			this.method = options.method ?? 'GET';
			this.mode = options.mode ?? 'cors';
			this.destination = options.destination ?? '';
			this.credentials = options.credentials;
		}
	}

	const context = {
		URL,
		Request: MockRequest,
		Response,
		Headers,
		Promise,
		TypeError,
		Error,
		Date,
		crypto: { randomUUID: () => 'share-id' },
		indexedDB: { open: () => { throw new Error('share DB not used by this test'); } },
		navigator: { onLine: true },
		console: { log() {}, warn() {}, error() {} },
		fetch: async (request) => {
			fetched.push(requestKey(request));
			return new Response('asset', { status: 200 });
		},
		caches: {
			open: async (name) => cache(name),
			keys: async () => [...stores.keys()],
			delete: async (name) => {
				deleted.push(name);
				return stores.delete(name);
			},
			match: async () => {
				throw new Error('global cache lookup must not be used');
			},
		},
		self: {
			location: { origin, hostname: 'app.example' },
			addEventListener: (type, handler) => handlers.set(type, handler),
			skipWaiting: async () => {},
			clients: { claim: async () => {} },
		},
	};

	vm.runInNewContext(source, context, { filename: 'public/sw.js' });
	return { handlers, deleted, fetched, stores, cache, MockRequest };
}

async function dispatchExtendable(handler, extra = {}) {
	const waits = [];
	handler({
		...extra,
		waitUntil(promise) {
			waits.push(Promise.resolve(promise));
		},
	});
	await Promise.all(waits);
}

test('activation preserves other applications, compiler caches and older live shells', async () => {
	const value = runtime();
	value.cache('other-app-v7');
	value.cache('rinspace-busytex-runtime-v1');
	value.cache('texlyre-app-shell-v0.13.1');

	await dispatchExtendable(value.handlers.get('activate'));

	assert.deepEqual(value.deleted, []);
	assert.deepEqual(
		[...value.stores.keys()].sort(),
		['other-app-v7', 'rinspace-busytex-runtime-v1', 'texlyre-app-shell-v0.13.1'],
	);
});

test('manual precache accepts only resources below the editor static scope', async () => {
	const value = runtime();
	await dispatchExtendable(value.handlers.get('message'), {
		data: {
			type: 'CACHE_URLS',
			urls: [
				'/editor/assets/icon.png',
				'/api/private-draft',
				'https://rinspace.com/api/wiki/private',
			],
		},
	});

	assert.deepEqual(value.fetched, [`${origin}/editor/assets/icon.png`]);
	assert.deepEqual(
		[...value.stores.get('texlyre-app-shell-v0.13.2').keys()],
		[`${origin}/editor/assets/icon.png`],
	);
});

test('fetch handling ignores private APIs and non-static external requests', () => {
	const value = runtime();
	let handled = false;
	const dispatch = (request) => {
		handled = false;
		value.handlers.get('fetch')({
			request,
			respondWith() { handled = true; },
			waitUntil() {},
		});
		return handled;
	};

	assert.equal(dispatch(new value.MockRequest('/api/private-draft')), false);
	assert.equal(
		dispatch(new value.MockRequest('https://rinspace.com/api/wiki/private')),
		false,
	);
	assert.equal(
		dispatch(new value.MockRequest('https://rinspace.com/static/cover.png', {
			destination: 'image',
		})),
		true,
	);
});

test('managed navigation is cached only under the parameter-free app shell key', async () => {
	const value = runtime();
	const waits = [];
	let response;
	value.handlers.get('fetch')({
		request: new value.MockRequest('/editor/?mode=managed&owner=private&repository=42', {
			mode: 'navigate',
		}),
		respondWith(promise) { response = Promise.resolve(promise); },
		waitUntil(promise) { waits.push(Promise.resolve(promise)); },
	});

	assert.equal((await response).status, 200);
	await Promise.all(waits);
	assert.deepEqual(
		[...value.stores.get('texlyre-app-shell-v0.13.2').keys()],
		[`${origin}/editor/index.html`],
	);
});

test('offline lookup cannot borrow a matching response from another cache', async () => {
	const value = runtime();
	await value.cache('other-app-v7').put(
		`${origin}/editor/assets/missing.js`,
		new Response('foreign'),
	);
	value.handlers.get('message')({
		data: { type: 'SET_FORCE_OFFLINE_MODE', enabled: true },
		waitUntil() {},
	});

	let response;
	value.handlers.get('fetch')({
		request: new value.MockRequest('/editor/assets/missing.js', {
			destination: 'script',
		}),
		respondWith(promise) { response = Promise.resolve(promise); },
		waitUntil() {},
	});

	await assert.rejects(response, /not available offline/);
});
