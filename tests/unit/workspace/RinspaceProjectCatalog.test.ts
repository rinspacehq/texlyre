// SPDX-License-Identifier: AGPL-3.0-or-later
import {
	RinspaceProjectCatalog,
} from '@src/plugins/workspace/rinspace/RinspaceProjectCatalog';
import {
	RinspaceManagedWorkspaceRuntime,
} from '@src/plugins/workspace/rinspace/RinspaceManagedWorkspace';

function response(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	} as Response;
}

function enabledRuntime(): RinspaceManagedWorkspaceRuntime {
	return new RinspaceManagedWorkspaceRuntime(
		{
			fetch: jest.fn(),
			materialize: jest.fn(),
		},
		true,
	);
}

describe('Rinspace project catalog', () => {
	it('treats a missing Native session as anonymous without contacting Gitea', async () => {
		const request = jest.fn(async () => response({}, 401)) as jest.MockedFunction<typeof fetch>;
		const catalog = new RinspaceProjectCatalog(enabledRuntime(), request);

		await expect(
			catalog.listPage({ page: 1, pageSize: 24 }, new AbortController().signal),
		).resolves.toEqual({ status: 'anonymous', projects: [] });
		expect(request).toHaveBeenCalledTimes(1);
		expect(request).toHaveBeenCalledWith(
			'/api/identity/v1/session',
			expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
		);
	});

	it('does not bind Gitea when Native returns a non-authenticated session', async () => {
		const request = jest.fn(async () =>
			response({ status: 'anonymous' }),
		) as jest.MockedFunction<typeof fetch>;
		const catalog = new RinspaceProjectCatalog(enabledRuntime(), request);

		await expect(
			catalog.listPage({ page: 1, pageSize: 24 }, new AbortController().signal),
		).resolves.toEqual({ status: 'anonymous', projects: [] });
		expect(request).toHaveBeenCalledTimes(1);
	});

	it('lists owned and collaborator Rinspace projections without fetching repository content', async () => {
		const queue = [
			response({ status: 'authenticated' }),
			response(null, 204),
			response({ id: 17, login: 'alice' }),
			response([
				{
					id: 41,
					name: '41',
					full_name: 'a/41',
					description: 'Owned article',
					private: false,
					default_branch: 'main',
					updated_at: '2026-10-13T01:00:00Z',
					rinspace_title: 'Owned title',
					rinspace_content_type: 'article',
					rinspace_projection_version: 2,
					rinspace_content_owner_ids: [17],
					permissions: { pull: true, push: true },
				},
				{
					id: 73,
					name: '73',
					full_name: 'b/73',
					description: '',
					private: true,
					default_branch: 'draft',
					rinspace_title: 'Collaborative book',
					rinspace_content_type: 'book',
					rinspace_projection_version: 5,
					rinspace_content_owner_ids: [23],
					permissions: { pull: true, push: false },
				},
				{
					id: 99,
					name: 'notes',
					full_name: 'alice/notes',
					private: false,
					default_branch: 'main',
					owner: { login: 'alice' },
					permissions: { pull: true, push: true },
				},
				{
					id: 100,
					name: '100',
					full_name: 'a/100',
					private: false,
					default_branch: 'main',
					rinspace_title: 'No access projection',
					rinspace_content_type: 'article',
					rinspace_projection_version: 2,
					rinspace_content_owner_ids: [17],
					permissions: { pull: false, push: false, admin: false },
				},
			]),
		];
		const request = jest.fn(async () => {
			const next = queue.shift();
			if (!next) throw new Error('unexpected request');
			return next;
		}) as jest.MockedFunction<typeof fetch>;
		const catalog = new RinspaceProjectCatalog(enabledRuntime(), request);

		const result = await catalog.listPage(
			{ page: 2, pageSize: 24 },
			new AbortController().signal,
		);
		expect(result).toEqual(
			expect.objectContaining({
				status: 'authenticated',
				accountLabel: 'alice',
				page: 2,
				hasMore: false,
			}),
		);
		if (result.status !== 'authenticated') throw new Error('expected account catalog');
		expect(result.projects).toEqual([
			expect.objectContaining({
				id: '41',
				name: 'Owned title',
				access: 'owner',
				openIntent: { mode: 'managed', owner: 'a', repository: '41', ref: 'main' },
			}),
			expect.objectContaining({
				id: '73',
				access: 'collaborator',
				private: true,
				openIntent: { mode: 'managed', owner: 'b', repository: '73', ref: 'draft' },
			}),
		]);
		expect(request.mock.calls.map(([url]) => url)).toEqual([
			'/api/identity/v1/session',
			'/rinspace/api/gitea/sso',
			'/repos/api/v1/user',
			'/repos/api/v1/user/repos?page=2&limit=24',
		]);
		expect(JSON.stringify(request.mock.calls)).not.toMatch(
			/archive|git-upload-pack|authorization|token/i,
		);
	});

	it('does not request the platform while disabled', async () => {
		const runtime = new RinspaceManagedWorkspaceRuntime(
			{ fetch: jest.fn(), materialize: jest.fn() },
			false,
		);
		const request = jest.fn() as jest.MockedFunction<typeof fetch>;
		const catalog = new RinspaceProjectCatalog(runtime, request);
		await expect(
			catalog.listPage({ page: 1, pageSize: 24 }, new AbortController().signal),
		).resolves.toEqual({ status: 'anonymous', projects: [] });
		expect(request).not.toHaveBeenCalled();
	});

	it('aborts an in-flight catalog request when the plugin is disabled', async () => {
		const runtime = enabledRuntime();
		const request = jest.fn(
			async (_url: RequestInfo | URL, init?: RequestInit) =>
				new Promise<Response>((_resolve, reject) => {
					init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
				}),
		) as jest.MockedFunction<typeof fetch>;
		const catalog = new RinspaceProjectCatalog(runtime, request);
		const pending = catalog.listPage(
			{ page: 1, pageSize: 24 },
			new AbortController().signal,
		);
		runtime.setEnabled(false);
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
	});
});
