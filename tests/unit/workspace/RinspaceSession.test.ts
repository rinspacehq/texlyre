// SPDX-License-Identifier: AGPL-3.0-or-later
import {
	ensureRinspaceGitSession,
	loadRinspaceSession,
} from '@src/plugins/workspace/rinspace/RinspaceSession';

const response = (body: unknown, status = 200): Response => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => body,
}) as Response;

const session = {
	status: 'authenticated' as const,
	csrfToken: 'csrf-proof',
	user: { id: 'rin-user-1', sessionEpoch: 2, identityVersion: 3 },
	currentSession: { sid: 'session-1', version: 4 },
};

describe('Rinspace browser session', () => {
	beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });
	it('validates the Native session contract', async () => {
		const request = jest.fn(async () => response(session)) as jest.MockedFunction<typeof fetch>;
		await expect(loadRinspaceSession(request)).resolves.toEqual(session);
		expect(request).toHaveBeenCalledWith(
			'/api/identity/v1/session',
			expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
		);
	});

	it('binds Smart HTTP with the current CSRF proof and no browser token', async () => {
		const queue = [response(session), response(null, 204), response(null)];
		const request = jest.fn(async () => {
			const next = queue.shift();
			if (!next) throw new Error('unexpected request');
			return next;
		}) as jest.MockedFunction<typeof fetch>;

		await expect(ensureRinspaceGitSession(request)).resolves.toEqual(session);
		expect(request.mock.calls[1]).toEqual([
			'/api/gitea/sso',
			expect.objectContaining({
				method: 'POST',
				headers: { 'X-Rinspace-CSRF': 'csrf-proof' },
			}),
		]);
		expect(JSON.stringify(request.mock.calls)).not.toMatch(/authorization|token/i);
		expect(request.mock.calls[2]).toEqual(['/repos/', expect.objectContaining({ credentials: 'include', cache: 'no-store' })]);
	});

	it('fails closed when the CSRF proof is absent', async () => {
		const request = jest.fn(async () => response({ ...session, csrfToken: '' })) as jest.MockedFunction<typeof fetch>;
		await expect(loadRinspaceSession(request)).rejects.toThrow('CSRF proof is unavailable');
	});

	it('completes one cold web-cookie round trip without replaying SSO or Git writes', async () => {
		const queue = [response(session), response(null,204), response(null,401), response(null)];
		const request = jest.fn(async () => queue.shift()!) as jest.MockedFunction<typeof fetch>;
		await expect(ensureRinspaceGitSession(request)).resolves.toEqual(session);
		expect(request.mock.calls.map(([path]) => path)).toEqual(['/api/identity/v1/session','/api/gitea/sso','/repos/','/repos/']);
		expect(request.mock.calls.filter(([,options]) => options?.method === 'POST')).toHaveLength(1);
	});

	it('fails closed if the second safe bootstrap GET is still rejected', async () => {
		const queue = [response(session), response(null,204), response(null,401), response(null,401)];
		const request = jest.fn(async () => queue.shift()!) as jest.MockedFunction<typeof fetch>;
		await expect(ensureRinspaceGitSession(request)).rejects.toThrow('initialization failed (401)');
		expect(request).toHaveBeenCalledTimes(4);
	});

	it('restores an expired access session with the shared idempotency and device keys', async () => {
		localStorage.setItem('rinspace-refresh-request-id', 'refresh-existing');
		localStorage.setItem('rinspace-device-id', 'browser-existing');
		const restoring = { status: 'restoring', csrfToken: 'refresh-csrf' };
		const queue = [response(restoring), response(restoring), response(null), response(session)];
		const request = jest.fn(async () => queue.shift()!) as jest.MockedFunction<typeof fetch>;
		await expect(loadRinspaceSession(request)).resolves.toEqual(session);
		expect(request.mock.calls[2]).toEqual(['/api/identity/v1/session/refresh', expect.objectContaining({
			method: 'POST', body: JSON.stringify({ requestId: 'refresh-existing' }),
			headers: expect.objectContaining({ 'x-device-id': 'browser-existing', 'X-Rinspace-CSRF': 'refresh-csrf' }),
		})]);
		expect(localStorage.getItem('rinspace-refresh-request-id')).toBeNull();
	});

	it.each(['anonymous', 'revoked'])('never refreshes a %s session', async (status) => {
		const request = jest.fn(async () => response({ status })) as jest.MockedFunction<typeof fetch>;
		await expect(loadRinspaceSession(request)).rejects.toThrow('sign-in is required');
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('respects a pending host logout without any request', async () => {
		localStorage.setItem('rinspace-logout-pending', 'logout-request');
		const request = jest.fn() as jest.MockedFunction<typeof fetch>;
		await expect(loadRinspaceSession(request)).rejects.toThrow('sign-in is required');
		expect(request).not.toHaveBeenCalled();
	});

	it('does not discard an idempotency key after uncertain refresh failure', async () => {
		const restoring = { status: 'restoring', csrfToken: 'refresh-csrf' };
		const queue = [response(restoring), response(restoring), response(null, 503)];
		const request = jest.fn(async () => queue.shift()!) as jest.MockedFunction<typeof fetch>;
		await expect(loadRinspaceSession(request)).rejects.toThrow('refresh failed (503)');
		expect(localStorage.getItem('rinspace-refresh-request-id')).toBeTruthy();
	});

	it('clears a completed uncertain rotation only after rechecking inside the shared lock', async () => {
		localStorage.setItem('rinspace-refresh-request-id', 'refresh-completed');
		const request = jest.fn(async () => response(session)) as jest.MockedFunction<typeof fetch>;
		await expect(loadRinspaceSession(request)).resolves.toEqual(session);
		expect(request).toHaveBeenCalledTimes(2);
		expect(localStorage.getItem('rinspace-refresh-request-id')).toBeNull();
		expect(request.mock.calls.every(([,options]) => options?.method !== 'POST')).toBe(true);
	});

	it('serializes competing refreshes and re-reads the rotated session', async () => {
		let refreshed = false;
		const request = jest.fn(async (path) => {
			if (path === '/api/identity/v1/session/refresh') { refreshed = true; return response(null); }
			return response(refreshed ? session : { status: 'restoring', csrfToken: 'proof' });
		}) as jest.MockedFunction<typeof fetch>;
		await expect(Promise.all([loadRinspaceSession(request), loadRinspaceSession(request)])).resolves.toEqual([session, session]);
		expect(request.mock.calls.filter(([path]) => path === '/api/identity/v1/session/refresh')).toHaveLength(1);
	});

	it('does not start refresh for an aborted integration request', async () => {
		const controller = new AbortController();
		const request = jest.fn(async () => { controller.abort(); return response({status:'restoring',csrfToken:'proof'}); }) as jest.MockedFunction<typeof fetch>;
		await expect(loadRinspaceSession(request, controller.signal)).rejects.toThrow();
		expect(request).toHaveBeenCalledTimes(1);
	});
});
