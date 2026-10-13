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

	it('uses only the current same-origin browser session', async () => {
		const request = jest.fn(async () => response({ login: 'alice' }));
		global.fetch = request as typeof fetch;

		await expect(rinspaceGitRemoteProvider.testConnection('ignored')).resolves.toBe(true);
		expect(request).toHaveBeenCalledWith(
			'/repos/api/v1/user',
			expect.objectContaining({
				credentials: 'include',
				cache: 'no-store',
			}),
		);
		expect(JSON.stringify(request.mock.calls)).not.toMatch(/authorization|token/i);
	});

	it('reads the exact branch head and exposes the same-origin Smart HTTP URL', async () => {
		global.fetch = jest.fn(async () =>
			response({ name: 'release', commit: { id: 'a'.repeat(40) } }),
		) as typeof fetch;

		await expect(
			rinspaceGitRemoteProvider.historyTransport.getHead(
				'',
				'owner/book',
				'release',
			),
		).resolves.toBe('a'.repeat(40));
		expect(
			rinspaceGitRemoteProvider.smartHttp?.repositoryUrl('owner/book'),
		).toBe('http://localhost/repos/owner/book.git');
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
