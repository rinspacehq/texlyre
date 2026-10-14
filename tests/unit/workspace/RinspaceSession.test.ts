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
	it('validates the Native session contract', async () => {
		const request = jest.fn(async () => response(session)) as jest.MockedFunction<typeof fetch>;
		await expect(loadRinspaceSession(request)).resolves.toEqual(session);
		expect(request).toHaveBeenCalledWith(
			'/api/identity/v1/session',
			expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
		);
	});

	it('binds Smart HTTP with the current CSRF proof and no browser token', async () => {
		const queue = [response(session), response(null, 204)];
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
	});

	it('fails closed when the CSRF proof is absent', async () => {
		const request = jest.fn(async () => response({ ...session, csrfToken: '' })) as jest.MockedFunction<typeof fetch>;
		await expect(loadRinspaceSession(request)).rejects.toThrow('CSRF proof is unavailable');
	});
});
