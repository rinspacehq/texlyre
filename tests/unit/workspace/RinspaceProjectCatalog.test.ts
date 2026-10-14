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
	it('treats an unauthenticated Editor BFF response as anonymous', async () => {
		const request = jest.fn(async () => response({}, 401)) as jest.MockedFunction<typeof fetch>;
		const catalog = new RinspaceProjectCatalog(enabledRuntime(), request);

		await expect(
			catalog.listPage({ page: 1, pageSize: 24 }, new AbortController().signal),
		).resolves.toEqual({ status: 'anonymous', projects: [] });
		expect(request).toHaveBeenCalledTimes(1);
		expect(request).toHaveBeenCalledWith(
			'/rinspace/api/editor/v1/projects?page=1&limit=24',
			expect.objectContaining({ credentials: 'include', cache: 'no-store' }),
		);
	});

	it('lists every accessible repository without fetching repository content', async () => {
		const queue = [
			response({
				schemaVersion: 'rinspace-editor-projects/v1',
				account: { id: 17, login: 'alice' },
				page: 2,
				pageSize: 24,
				hasMore: false,
				projects: [
				{
					id: 41,
					name: '41',
					fullName: 'a/41',
					description: 'Owned article',
					private: false,
					archived: false,
					defaultBranch: 'main',
					objectFormat: 'sha1',
					updatedAt: '2026-10-13T01:00:00Z',
					rinspaceTitle: 'Owned title',
					rinspaceContentType: 'article',
					access: 'owner',
					permissions: { pull: true, push: true, admin: false },
				},
				{
					id: 73,
					name: '73',
					fullName: 'b/73',
					description: '',
					private: true,
					archived: false,
					defaultBranch: 'draft',
					objectFormat: 'sha1',
					rinspaceTitle: 'Collaborative book',
					rinspaceContentType: 'book',
					access: 'collaborator',
					permissions: { pull: true, push: false, admin: false },
				},
				{
					id: 99,
					name: 'notes',
					fullName: 'alice/notes',
					description: '',
					private: false,
					archived: false,
					defaultBranch: 'main',
					objectFormat: 'sha1',
					access: 'owner',
					permissions: { pull: true, push: true, admin: true },
				},
				{
					id: 100,
					name: '100',
					fullName: 'a/100',
					description: '',
					private: false,
					archived: false,
					defaultBranch: 'main',
					objectFormat: 'sha1',
					access: 'owner',
					permissions: { pull: false, push: false, admin: false },
				},
				],
			}),
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
			expect.objectContaining({
				id: '99',
				name: 'alice/notes',
				contentType: 'repository',
				openIntent: { mode: 'managed', owner: 'alice', repository: 'notes', ref: 'main' },
			}),
		]);
		expect(request.mock.calls.map(([url]) => url)).toEqual([
			'/rinspace/api/editor/v1/projects?page=2&limit=24',
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
