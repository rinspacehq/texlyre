// SPDX-License-Identifier: AGPL-3.0-or-later

const session = {
	status: 'authenticated', csrfToken: 'csrf-proof',
	user: { id: 'user-1', sessionEpoch: 1, identityVersion: 1 },
	currentSession: { sid: 'session-1', version: 1 },
};
const restoring = { status: 'restoring', csrfToken: 'refresh-proof' };
const response = (body: unknown, status = 200) => ({
	ok: status >= 200 && status < 300, status, json: async () => body,
}) as Response;

describe('Rinspace session with full browser storage', () => {
	beforeEach(() => {
		jest.resetModules();
		localStorage.clear(); sessionStorage.clear();
		let previous: Promise<unknown> = Promise.resolve();
		Object.defineProperty(navigator, 'locks', { configurable: true, value: {
			request: jest.fn((_name, _options, run) => {
				const pending = previous.then(run);
				previous = pending.catch(() => {});
				return pending;
			}),
		} });
	});
	afterEach(() => {
		jest.restoreAllMocks();
		Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
	});

	function fullStorage(both: boolean) {
		const original = Storage.prototype.setItem;
		return jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
			if (this === localStorage || both)
				throw new DOMException('Storage quota exceeded', 'QuotaExceededError');
			return original.call(this, key, value);
		});
	}

	it.each([false, true])('continues refresh and SSO without deleting drafts (both full: %s)', async (both) => {
		localStorage.setItem('draft-to-preserve', 'unsaved article');
		localStorage.setItem('rinspace-device-id', 'browser-existing');
		fullStorage(both);
		const queue = [restoring, restoring, null, session, null, null];
		const fetcher = jest.fn(async () => response(queue.shift())) as jest.MockedFunction<typeof fetch>;
		const { ensureRinspaceGitSession } = await import('@src/plugins/workspace/rinspace/RinspaceSession');
		await expect(ensureRinspaceGitSession(fetcher)).resolves.toEqual(session);
		expect(fetcher.mock.calls[2]).toEqual(['/api/identity/v1/session/refresh', expect.objectContaining({
			headers: expect.objectContaining({ 'x-device-id': 'browser-existing' }),
		})]);
		expect(fetcher.mock.calls.map(([path]) => path)).toEqual([
			'/api/identity/v1/session', '/api/identity/v1/session', '/api/identity/v1/session/refresh',
			'/api/identity/v1/session', '/api/gitea/sso', '/repos/',
		]);
		expect(localStorage.getItem('draft-to-preserve')).toBe('unsaved article');
		expect(sessionStorage.getItem('rinspace-refresh-request-id')).toBeNull();
	});

	it.each([false, true])('reuses uncertain refresh and device identities (both full: %s)', async (both) => {
		fullStorage(both);
		const queue = [response(restoring), response(restoring), response(null, 503),
			response(restoring), response(restoring), response(null), response(session)];
		const fetcher = jest.fn(async () => queue.shift()!) as jest.MockedFunction<typeof fetch>;
		const uuid = jest.spyOn(crypto, 'randomUUID');
		let sequence = 0;
		uuid.mockImplementation(() => `00000000-0000-0000-0000-${String(++sequence).padStart(12, '0')}` as ReturnType<Crypto['randomUUID']>);
		const { loadRinspaceSession } = await import('@src/plugins/workspace/rinspace/RinspaceSession');
		await expect(loadRinspaceSession(fetcher)).rejects.toThrow('refresh failed (503)');
		if (!both) {
			expect(sessionStorage.getItem('rinspace-refresh-request-id')).toBeTruthy();
			// A page reload loses module memory but retains the tab's fallback.
			jest.resetModules();
		}
		const retry = both ? loadRinspaceSession : (await import('@src/plugins/workspace/rinspace/RinspaceSession')).loadRinspaceSession;
		await expect(retry(fetcher)).resolves.toEqual(session);
		const writes = fetcher.mock.calls.filter(([path]) => path === '/api/identity/v1/session/refresh');
		expect(writes).toHaveLength(2);
		expect(writes[0][1]?.body).toEqual(writes[1][1]?.body);
		expect(writes[0][1]?.headers).toEqual(writes[1][1]?.headers);
		expect(sessionStorage.getItem('rinspace-refresh-request-id')).toBeNull();
	});

	it('honors a pending logout even when both stores are full', async () => {
		localStorage.setItem('rinspace-logout-pending', 'logout-id'); fullStorage(true);
		const fetcher = jest.fn() as jest.MockedFunction<typeof fetch>;
		const { loadRinspaceSession } = await import('@src/plugins/workspace/rinspace/RinspaceSession');
		await expect(loadRinspaceSession(fetcher)).rejects.toThrow('sign-in is required');
		expect(fetcher).not.toHaveBeenCalled();
	});

	it('does not rotate without Web Locks if a shared lease cannot be stored', async () => {
		Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
		fullStorage(true);
		const fetcher = jest.fn(async () => response(restoring)) as jest.MockedFunction<typeof fetch>;
		const { loadRinspaceSession } = await import('@src/plugins/workspace/rinspace/RinspaceSession');
		await expect(loadRinspaceSession(fetcher)).rejects.toThrow('refresh coordination is unavailable');
		expect(fetcher).toHaveBeenCalledTimes(1);
	});
});
