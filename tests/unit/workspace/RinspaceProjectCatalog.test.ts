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
	it('hides tags without a type projection by default but returns globally searched tags', async () => {
		const project = { id: 9000, name: '9000', fullName: 'tags/9000', description: '', private: false,
			archived: false, defaultBranch: 'main', objectFormat: 'sha1', access: 'collaborator',
			permissions: { pull: true, push: true, admin: false } };
		const wire = { schemaVersion: 'rinspace-editor-projects/v1', account: { id: 17, login: 'alice' },
			page: 1, pageSize: 24, hasMore: false, projects: [project] };
		const request = jest.fn(async (path) => response({ ...wire, query: String(path).includes('&q=') ? 'global title' : '' })) as jest.MockedFunction<typeof fetch>;
		const catalog = new RinspaceProjectCatalog(enabledRuntime(), request);
		const signal = new AbortController().signal;
		await expect(catalog.listPage({page:1,pageSize:24},signal)).resolves.toEqual(expect.objectContaining({projects:[]}));
		await expect(catalog.listPage({page:1,pageSize:24,query:'global title'},signal)).resolves.toEqual(expect.objectContaining({projects:[expect.objectContaining({repositoryLabel:'tags/9000'})]}));
		expect(request).toHaveBeenLastCalledWith('/rinspace/api/editor/v1/projects?page=1&limit=24&q=global%20title',expect.anything());
	});

	it('does not label a legacy backend ignoring the query as a complete search', async () => {
		const request = jest.fn(async () => response({schemaVersion:'rinspace-editor-projects/v1',account:{id:17,login:'alice'},page:1,pageSize:24,hasMore:false,projects:[]})) as jest.MockedFunction<typeof fetch>;
		const catalog = new RinspaceProjectCatalog(enabledRuntime(), request);
		await expect(catalog.listPage({page:1,pageSize:24,query:'unloaded title'},new AbortController().signal)).rejects.toThrow('catalog is invalid');
	});

	it('rechecks Native identity and retries only the metadata GET after an expired access cookie', async () => {
		const queue = [response({},401),response({status:'authenticated',csrfToken:'proof',user:{id:'rin-17',sessionEpoch:1,identityVersion:1},currentSession:{sid:'sid-17',version:1}}),
			response({schemaVersion:'rinspace-editor-projects/v1',account:{id:17,login:'alice'},page:1,pageSize:24,hasMore:false,projects:[]})];
		const request = jest.fn(async () => queue.shift()!) as jest.MockedFunction<typeof fetch>;
		const catalog = new RinspaceProjectCatalog(enabledRuntime(), request);
		await expect(catalog.listPage({page:1,pageSize:24},new AbortController().signal)).resolves.toEqual(expect.objectContaining({status:'authenticated'}));
		expect(request.mock.calls.map(([path])=>path)).toEqual(['/rinspace/api/editor/v1/projects?page=1&limit=24','/api/identity/v1/session','/rinspace/api/editor/v1/projects?page=1&limit=24']);
	});
	it('treats an unauthenticated Editor BFF response as anonymous', async () => {
		const request = jest.fn(async (path) => response(path === '/api/identity/v1/session' ? { status: 'anonymous' } : {}, path === '/api/identity/v1/session' ? 200 : 401)) as jest.MockedFunction<typeof fetch>;
		const catalog = new RinspaceProjectCatalog(enabledRuntime(), request);

		await expect(
			catalog.listPage({ page: 1, pageSize: 24 }, new AbortController().signal),
		).resolves.toEqual({ status: 'anonymous', projects: [] });
		expect(request).toHaveBeenCalledTimes(2);
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
