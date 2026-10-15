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
	const project = (id: number, owner = 'b') => ({
		id, name: String(id), fullName: `${owner}/${id}`, description: '', private: false, archived: false,
		defaultBranch: 'main', objectFormat: 'sha1', access: 'collaborator',
		permissions: { pull: true, push: false, admin: false },
	});
	const wire = (projects: ReturnType<typeof project>[], extra: Record<string, unknown> = {}) => ({
		schemaVersion: 'rinspace-editor-projects/v2', account: { id: 17, login: 'alice' },
		page: 1, pageSize: 24, hasMore: false, projects, ...extra,
	});

	it('rejects a default catalog leaking shared tags but allows global search results', async () => {
		const request = jest.fn(async (path) => response(wire([project(9000, 'tags')],
			String(path).includes('&q=') ? {query:'global title'} : {}))) as jest.MockedFunction<typeof fetch>;
		const catalog = new RinspaceProjectCatalog(enabledRuntime(),request);
		await expect(catalog.listPage({page:1,pageSize:24},new AbortController().signal)).rejects.toThrow('scope or ordering');
		await expect(catalog.listPage({page:1,pageSize:24,query:'global title'},new AbortController().signal))
			.resolves.toEqual(expect.objectContaining({projects:[expect.objectContaining({repositoryLabel:'tags/9000'})]}));
		expect(request).toHaveBeenLastCalledWith('/rinspace/api/editor/v1/projects?page=1&limit=24&q=global%20title',expect.anything());
	});

	it.each(['rinspace-editor-projects/v1','rinspace-editor-projects/v2'])('fails closed for old schema or missing query echo (%s)', async (schemaVersion) => {
		const request = jest.fn(async () => response(wire([],{schemaVersion}))) as jest.MockedFunction<typeof fetch>;
		const catalog = new RinspaceProjectCatalog(enabledRuntime(),request);
		await expect(catalog.listPage({page:1,pageSize:24,query:'unloaded title'},new AbortController().signal)).rejects.toThrow('catalog is invalid');
	});

	it('rechecks Native identity and retries only the metadata GET after access expiry', async () => {
		const queue = [response({},401),response({status:'authenticated',csrfToken:'proof',user:{id:'rin-17',sessionEpoch:1,identityVersion:1},currentSession:{sid:'sid-17',version:1}}),response(wire([]))];
		const request = jest.fn(async () => queue.shift()!) as jest.MockedFunction<typeof fetch>;
		const catalog = new RinspaceProjectCatalog(enabledRuntime(),request);
		await expect(catalog.listPage({page:1,pageSize:24},new AbortController().signal)).resolves.toEqual(expect.objectContaining({status:'authenticated'}));
		expect(request.mock.calls.map(([path])=>path)).toEqual(['/rinspace/api/editor/v1/projects?page=1&limit=24','/api/identity/v1/session','/rinspace/api/editor/v1/projects?page=1&limit=24']);
	});

	it('treats an unauthenticated Editor BFF response as anonymous', async () => {
		const request = jest.fn(async(path) => response(path === '/api/identity/v1/session' ? {status:'anonymous'} : {},path === '/api/identity/v1/session' ? 200 : 401)) as jest.MockedFunction<typeof fetch>;
		const catalog = new RinspaceProjectCatalog(enabledRuntime(),request);
		await expect(catalog.listPage({page:1,pageSize:24},new AbortController().signal)).resolves.toEqual({status:'anonymous',projects:[]});
		expect(request).toHaveBeenCalledTimes(2);
	});

	it('uses the returned cursor and requests metadata exactly once per page', async () => {
		const request = jest.fn(async (path) => response(String(path).includes('before_id=73')
			? wire([project(41)],{page:2})
			: wire([project(99),project(73)],{hasMore:true,nextCursor:'73'}))) as jest.MockedFunction<typeof fetch>;
		const catalog = new RinspaceProjectCatalog(enabledRuntime(),request);
		const first = await catalog.listPage({page:1,pageSize:24},new AbortController().signal);
		if(first.status!=='authenticated') throw new Error('expected account catalog');
		const second = await catalog.listPage({page:2,pageSize:24,cursor:first.nextCursor},new AbortController().signal);
		expect(second).toEqual(expect.objectContaining({projects:[expect.objectContaining({repositoryLabel:'b/41'})],hasMore:false}));
		expect(request.mock.calls.map(([path])=>path)).toEqual(['/rinspace/api/editor/v1/projects?page=1&limit=24','/rinspace/api/editor/v1/projects?page=2&limit=24&before_id=73']);
		expect(JSON.stringify(request.mock.calls)).not.toMatch(/archive|git-upload-pack|authorization|token/i);
	});

	it.each([undefined,'0','01','-1','9223372036854775808'])('rejects missing or invalid continuation before requesting (%s)',async(cursor) => {
		const request=jest.fn() as jest.MockedFunction<typeof fetch>;
		const catalog=new RinspaceProjectCatalog(enabledRuntime(),request);
		await expect(catalog.listPage({page:2,pageSize:24,...(cursor===undefined?{}:{cursor})},new AbortController().signal)).rejects.toThrow('Invalid project catalog page');
		expect(request).not.toHaveBeenCalled();
	});

	it.each([
		{hasMore:true}, {hasMore:false,nextCursor:'40'}, {hasMore:true,nextCursor:'50'},
		{hasMore:true,nextCursor:'51'}, {hasMore:true,nextCursor:'01'},
	])('rejects missing, contradictory or stuck next cursor (%j)',async(extra) => {
		const request=jest.fn(async()=>response(wire([project(49)],{page:2,...extra}))) as jest.MockedFunction<typeof fetch>;
		const catalog=new RinspaceProjectCatalog(enabledRuntime(),request);
		await expect(catalog.listPage({page:2,pageSize:24,cursor:'50'},new AbortController().signal)).rejects.toThrow('catalog is invalid');
	});

	it.each([{projects:[]}, {projects:[project(49)]}])('rejects a cursor that silently skips missing rows (%j)', async({projects}) => {
		const request=jest.fn(async()=>response(wire(projects,{hasMore:true,nextCursor:'40'}))) as jest.MockedFunction<typeof fetch>;
		const catalog=new RinspaceProjectCatalog(enabledRuntime(),request);
		await expect(catalog.listPage({page:1,pageSize:24},new AbortController().signal)).rejects.toThrow('cursor does not match its final row');
	});

	it('rejects a non-readable project rather than hiding a malformed upstream page',async() => {
		const repository={...project(41),permissions:{pull:false,push:false,admin:false}};
		const request=jest.fn(async()=>response(wire([repository]))) as jest.MockedFunction<typeof fetch>;
		await expect(new RinspaceProjectCatalog(enabledRuntime(),request).listPage({page:1,pageSize:24},new AbortController().signal)).rejects.toThrow('scope or ordering');
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
