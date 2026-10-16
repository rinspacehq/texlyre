// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRinspaceGitRemoteProvider } from '@src/plugins/workspace/rinspace/RinspaceGitRemoteProvider';

const response = (body: unknown, status = 200): Response => ({
	ok: status >= 200 && status < 300,
	status,
	json: async () => body,
}) as Response;

describe('Rinspace Git remote provider', () => {
	const originalFetch = global.fetch;
	const rinspaceGitRemoteProvider = createRinspaceGitRemoteProvider();

	afterEach(() => {
		global.fetch = originalFetch;
		jest.restoreAllMocks();
	});

	it('uses the token-hiding Editor BFF for account metadata', async () => {
		const request = jest.fn(async () => response({
			schemaVersion: 'rinspace-editor-projects/v2',
			projects: [],
			hasMore: false,
		}));
		global.fetch = request as typeof fetch;

		await expect(rinspaceGitRemoteProvider.testConnection('ignored')).resolves.toBe(true);
		expect(request).toHaveBeenCalledWith(
			'/rinspace/api/editor/v1/projects?limit=1',
			expect.objectContaining({
				credentials: 'include',
				cache: 'no-store',
			}),
		);
		expect(JSON.stringify(request.mock.calls)).not.toMatch(/authorization|token/i);
	});

	it('rejects a legacy catalog while keeping project detail and branch responses on v1', async () => {
		global.fetch = jest.fn(async () => response({ schemaVersion: 'rinspace-editor-projects/v1', projects: [], hasMore: false })) as typeof fetch;
		await expect(rinspaceGitRemoteProvider.testConnection('')).resolves.toBe(false);
	});

	it('uses bounded keyset pages to include repositories beyond the first page', async () => {
		const request = jest.fn(async (url: string) => response({
			schemaVersion: 'rinspace-editor-projects/v2',
			projects: [{ fullName: url.includes('before_id=') ? 'alice/later' : 'alice/first', private: true, defaultBranch: 'main' }],
			hasMore: !url.includes('before_id='),
			nextCursor: '9007199254740993',
		}));
		global.fetch = request as typeof fetch;
		await expect(rinspaceGitRemoteProvider.listRepositories('')).resolves.toEqual([
			{ id: 'alice/first', label: 'alice/first', private: true, defaultBranch: 'main' },
			{ id: 'alice/later', label: 'alice/later', private: true, defaultBranch: 'main' },
		]);
		expect(request.mock.calls.map(([url]) => url)).toEqual([
			'/rinspace/api/editor/v1/projects?limit=50',
			'/rinspace/api/editor/v1/projects?limit=50&before_id=9007199254740993',
		]);
	});

	it.each([undefined, '0', 'wrong', '9223372036854775808'])('rejects invalid continuation cursor %s', async (nextCursor) => {
		global.fetch = jest.fn(async () => response({ schemaVersion: 'rinspace-editor-projects/v2', projects: [], hasMore: true, nextCursor })) as typeof fetch;
		await expect(rinspaceGitRemoteProvider.listRepositories('')).rejects.toThrow('cursor is invalid');
	});

	it('refuses repeated cursors instead of scanning indefinitely', async () => {
		const request = jest.fn(async () => response({ schemaVersion: 'rinspace-editor-projects/v2', projects: [], hasMore: true, nextCursor: '10' }));
		global.fetch = request as typeof fetch;
		await expect(rinspaceGitRemoteProvider.listRepositories('')).rejects.toThrow('cursor is invalid');
		expect(request).toHaveBeenCalledTimes(2);
	});

	it('rejects ascending continuation in the descending catalog', async () => {
		let calls = 0;
		global.fetch = jest.fn(async () => response({ schemaVersion: 'rinspace-editor-projects/v2', projects: [], hasMore: true, nextCursor: String(10 + calls++) })) as typeof fetch;
		await expect(rinspaceGitRemoteProvider.listRepositories('')).rejects.toThrow('cursor is invalid');
		expect(calls).toBe(2);
	});

	it('reads the exact branch head and exposes the same-origin Smart HTTP URL', async () => {
		const queue = [
			response({
				status: 'authenticated',
				csrfToken: 'csrf-proof',
				user: { id: 'rin-user-1', sessionEpoch: 2, identityVersion: 3 },
				currentSession: { sid: 'session-1', version: 4 },
			}),
			response(null, 204),
			response(null),
			response({
				schemaVersion: 'rinspace-editor-projects/v1',
				remoteHead: 'a'.repeat(40),
			}),
		];
		const request = jest.fn(async () => {
			const next = queue.shift();
			if (!next) throw new Error('unexpected request');
			return next;
		});
		global.fetch = request as typeof fetch;

		await expect(
			rinspaceGitRemoteProvider.historyTransport.getHead(
				'',
				'owner/book',
				'release',
			),
		).resolves.toBe('a'.repeat(40));
		expect(request.mock.calls.map(([url]) => url)).toEqual([
			'/api/identity/v1/session',
			'/api/gitea/sso',
			'/repos/',
			'/rinspace/api/editor/v1/projects/owner/book?ref=release',
		]);
		expect(request.mock.calls[1][1]).toEqual(
			expect.objectContaining({
				method: 'POST',
				headers: { 'X-Rinspace-CSRF': 'csrf-proof' },
			}),
		);
		expect(
			rinspaceGitRemoteProvider.smartHttp?.repositoryUrl('owner/book'),
		).toBe('http://localhost/repos/owner/book.git');
	});

	it('lists repositories and branches through the Editor BFF', async () => {
		const queue = [
			response({
				schemaVersion: 'rinspace-editor-projects/v2',
				projects: [{
					fullName: 'alice/notes',
					private: true,
					defaultBranch: 'main',
				}],
				hasMore: false,
			}),
			response({
				schemaVersion: 'rinspace-editor-projects/v1',
				branches: [{ name: 'main', commit: 'a'.repeat(40), protected: true }],
			}),
		];
		global.fetch = jest.fn(async () => {
			const next = queue.shift();
			if (!next) throw new Error('unexpected request');
			return next;
		}) as typeof fetch;

		await expect(rinspaceGitRemoteProvider.listRepositories('')).resolves.toEqual([{
			id: 'alice/notes',
			label: 'alice/notes',
			private: true,
			defaultBranch: 'main',
		}]);
		await expect(
			rinspaceGitRemoteProvider.listBranches('', 'alice/notes'),
		).resolves.toEqual([{ name: 'main', protected: true }]);
	});

	it('fails closed on invalid coordinates and hides itself from the manual picker', () => {
		expect(() =>
			rinspaceGitRemoteProvider.smartHttp?.repositoryUrl('../owner/book'),
		).toThrow('coordinate is invalid');
		expect(rinspaceGitRemoteProvider.hiddenFromPicker).toBe(true);
		expect(rinspaceGitRemoteProvider.usesBrowserSession).toBe(true);
	});

	it('links the managed repository to Gitea and the existing publication page', () => {
		expect(rinspaceGitRemoteProvider.repositoryLinks?.('42/a', 'main')).toEqual([
			{
				label: 'Open branch in Gitea',
				href: '/repos/42/a/src/branch/main',
			},
			{ label: 'Open publication page', href: '/a/42' },
		]);
		expect(rinspaceGitRemoteProvider.repositoryLinks?.('42/pdf', 'draft')).toEqual(
			expect.arrayContaining([
				{ label: 'Open publication page', href: '/books/42' },
			]),
		);
		expect(rinspaceGitRemoteProvider.repositoryLinks?.('owner/repo', 'feature/x')).toEqual([
			{
				label: 'Open branch in Gitea',
				href: '/repos/owner/repo/src/branch/feature%2Fx',
			},
		]);
	});

	it('reflects the owning plugin runtime instead of becoming independently active', () => {
		let enabled = true;
		const provider = createRinspaceGitRemoteProvider(() => enabled);
		expect(provider.isEnabled?.()).toBe(true);
		enabled = false;
		expect(provider.isEnabled?.()).toBe(false);
	});
});
