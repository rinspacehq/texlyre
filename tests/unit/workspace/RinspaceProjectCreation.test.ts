// SPDX-License-Identifier: AGPL-3.0-or-later
import { loadRinspaceSession } from '@extras/workspace/rinspace/RinspaceSession';

jest.mock('@extras/workspace/rinspace/RinspaceSession', () => ({
	loadRinspaceSession: jest.fn(),
}));

const response = (body: unknown, status = 200): Response =>
	({
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	}) as Response;

const session = {
	status: 'authenticated' as const,
	csrfToken: 'csrf-proof',
	user: { id: 'actor-1', sessionEpoch: 1, identityVersion: 1 },
	currentSession: { sid: 'session-1', version: 1 },
};

describe('Rinspace project creation capability', () => {
	const originalFetch = globalThis.fetch;

	beforeEach(() => {
		jest.useFakeTimers();
		jest.mocked(loadRinspaceSession).mockResolvedValue(session);
	});

	afterEach(() => {
		if (originalFetch)
			Object.defineProperty(globalThis, 'fetch', {
				configurable: true,
				writable: true,
				value: originalFetch,
			});
		else delete (globalThis as { fetch?: typeof fetch }).fetch;
		jest.useRealTimers();
		jest.restoreAllMocks();
	});

	it('rechecks the restored Native session and retries one safe capability GET after 401', async () => {
		const capability = {
			schemaVersion: 'rinspace-editor-project-creation/v1' as const,
			enabled: true,
			kinds: ['article', 'book'] as const,
			sourceFormats: ['latex', 'markdown', 'typst'] as const,
			maxTags: 6,
			defaultVisibility: 'private' as const,
			tagCreationEnabled: true,
		};
		const request = jest
			.fn()
			.mockResolvedValueOnce(response({ error: 'unauthorized' }, 401))
			.mockResolvedValueOnce(response(capability));
		Object.defineProperty(globalThis, 'fetch', {
			configurable: true,
			writable: true,
			value: request,
		});
		const { projectCreationCapability } = await import(
			'@extras/workspace/rinspace/RinspaceProjectCreation'
		);

		const pending = projectCreationCapability(
			new AbortController().signal,
			'actor-1',
		);
		await jest.advanceTimersByTimeAsync(200);
		await expect(pending).resolves.toEqual(capability);
		expect(loadRinspaceSession).toHaveBeenCalledTimes(2);
		expect(request).toHaveBeenCalledTimes(2);
		expect(request.mock.calls.every(([path]) =>
			path === '/rinspace/api/editor/v1/project-creations/capability',
		)).toBe(true);
	});
});
