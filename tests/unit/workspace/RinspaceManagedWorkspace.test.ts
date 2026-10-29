// SPDX-License-Identifier: AGPL-3.0-or-later
import { File as NodeFile } from 'node:buffer';
import { createHash } from 'node:crypto';
import JSZip from 'jszip';

import {
	prepareRinspaceRepositoryArchive,
	resolveRinspaceWorkspace,
	RinspaceManagedWorkspaceRuntime,
} from '@extras/workspace/rinspace/RinspaceManagedWorkspace';

const commit = 'a'.repeat(40);

function jsonResponse(body: unknown, status = 200): Response {
	return {
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
		blob: async () => new Blob(),
	} as Response;
}

function responses(options: {
	actor?: string;
	ref?: string;
	permissions?: { pull?: boolean; push?: boolean; admin?: boolean };
	repositoryStatus?: number;
	verifiedEmail?: boolean;
	sharedTag?: boolean;
	private?: boolean;
	archived?: boolean;
} = {}): Response[] {
	const permissions = options.permissions ?? {
		pull: true,
		push: true,
		admin: false,
	};
	const result = [
		jsonResponse({
			status: 'authenticated',
			csrfToken: 'csrf-proof',
			user: {
				id: options.actor ?? 'rin-user-1',
				sessionEpoch: 7,
				identityVersion: 11,
			},
			currentSession: { sid: 'session-1', version: 13 },
		}),
		jsonResponse(
			{
				schemaVersion: 'rinspace-editor-projects/v1',
				account: {
					id: options.actor === 'rin-user-2' ? 18 : 17,
					login: options.actor === 'rin-user-2' ? 'bob' : 'alice',
					fullName: options.actor === 'rin-user-2' ? 'Bob' : 'Alice',
				},
				project: {
					id: 73,
					name: '42',
					fullName: options.sharedTag ? 'tags/42' : 'a/42',
					...(options.sharedTag ? { private: options.private ?? false, archived: options.archived ?? false, rinspaceContentType: 'tag-wiki' } : {}),
					defaultBranch: 'main',
					objectFormat: 'sha1',
					permissions,
				},
				ref: options.ref ?? 'main',
				remoteHead: commit,
				...((permissions.push || permissions.admin) && options.verifiedEmail !== false
					? {
						commitIdentity: {
							name: options.actor === 'rin-user-2' ? 'Bob' : 'Alice',
							email: options.actor === 'rin-user-2'
								? 'bob@example.test'
								: 'alice@example.test',
						},
					}
					: {}),
			},
			options.repositoryStatus ?? 200,
		),
	];
	return result;
}

function queuedFetch(queue: Response[]): jest.MockedFunction<typeof fetch> {
	return jest.fn(async () => {
		const response = queue.shift();
		if (!response) throw new Error('unexpected request');
		return response;
	}) as jest.MockedFunction<typeof fetch>;
}

describe('Rinspace managed workspace', () => {
	beforeEach(() => {
		window.history.replaceState(null, '', '/editor/');
		jest.mocked(crypto.subtle.digest).mockImplementation(async (_algorithm, data) => {
			const bytes = data instanceof ArrayBuffer
				? new Uint8Array(data)
				: new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
			const digest = createHash('sha256').update(bytes).digest();
			return digest.buffer.slice(
				digest.byteOffset,
				digest.byteOffset + digest.byteLength,
			) as ArrayBuffer;
		});
	});

	it('uses only Native identity and the token-hiding Editor BFF', async () => {
		const request = queuedFetch(responses());
		const resolved = await resolveRinspaceWorkspace(
			{ owner: 'a', repository: '42', ref: 'main' },
			new AbortController().signal,
			request,
		);
		expect(resolved.identity.user.id).toBe('rin-user-1');
		expect(resolved.giteaUser.login).toBe('alice');
		expect(resolved.remoteHead).toBe(commit);
		expect(request.mock.calls.map(([url]) => url)).toEqual([
			'/api/identity/v1/session',
			'/rinspace/api/editor/v1/projects/a/42?ref=main',
		]);
		for (const [, init] of request.mock.calls) {
			expect(init?.credentials).toBe('include');
			expect(JSON.stringify(init)).not.toMatch(/token|authorization/i);
		}
	});

	it('derives writer capabilities from the actual repository ACL', async () => {
		const materialize = jest.fn(async () => ({
			workspaceId: 'workspace-1',
			profileScope: 'scope-1',
			baseCommit: commit,
			generation: 1,
		}));
		const runtime = new RinspaceManagedWorkspaceRuntime(
			{ fetch: queuedFetch(responses()), materialize },
			true,
		);
		const context = await runtime.open(
			{ owner: 'a', repository: '42', ref: 'main' },
			new AbortController().signal,
		);
		expect(context.capabilities).toEqual([
			'read-source',
			'read-draft',
			'write-source',
			'review',
			'push',
		]);
		expect(context.binding).toEqual(
			expect.objectContaining({
				repositoryId: '73',
				ref: 'refs/heads/main',
				baseCommit: commit,
				workspaceId: 'workspace-1',
			}),
		);
		expect(materialize).toHaveBeenCalledTimes(1);
		expect(window.location.search).toBe('?mode=managed&owner=a&repository=42&ref=main');
		runtime.close();
		expect(window.location.search).toBe('');
		expect(runtime.getCurrentContext()).toBeNull();
	});

	it('requests a real shared tag repository write grant only when explicitly opening it', async () => {
		const fetcher = queuedFetch([
			...responses({ sharedTag: true, permissions: { pull: true, push: false, admin: false } }),
			responses({ sharedTag: true })[1],
		]);
		const resolved = await resolveRinspaceWorkspace({owner:'tags',repository:'42'}, new AbortController().signal, fetcher);
		expect(resolved.repository.permissions.push).toBe(true);
		expect(resolved.commitIdentity?.email).toBe('alice@example.test');
		expect(fetcher).toHaveBeenLastCalledWith('/rinspace/api/editor/v1/projects/tags/42/write-access', expect.objectContaining({method:'POST',credentials:'include',headers:expect.objectContaining({'X-Rinspace-CSRF':'csrf-proof'})}));
	});

	it.each(['wrong actor', 'wrong repository', 'no write readback'])('rejects a shared tag grant with %s without retrying', async (failure) => {
		const fetcher = queuedFetch([
			...responses({ sharedTag:true, permissions:{pull:true,push:false,admin:false} }),
			responses({ sharedTag:failure!=='wrong repository',actor:failure==='wrong actor'?'rin-user-2':undefined,permissions:{pull:true,push:failure!=='no write readback',admin:false} })[1],
		]);
		await expect(resolveRinspaceWorkspace({owner:'tags',repository:'42'},new AbortController().signal,fetcher)).rejects.toThrow('write permission was not confirmed');
		expect(fetcher).toHaveBeenCalledTimes(3);
	});

	it.each([{private:true},{archived:true}])('does not request write grants for a restricted tag %p', async (restriction) => {
		const fetcher=queuedFetch(responses({sharedTag:true,...restriction,permissions:{pull:true,push:false,admin:false}}));
		const resolved=await resolveRinspaceWorkspace({owner:'tags',repository:'42'},new AbortController().signal,fetcher);
		expect(resolved.repository.permissions.push).toBe(false);
		expect(fetcher).toHaveBeenCalledTimes(2);
	});

	it('opens a read-only collaborator without granting push', async () => {
		const runtime = new RinspaceManagedWorkspaceRuntime(
			{
				fetch: queuedFetch(
					responses({ permissions: { pull: true, push: false, admin: false } }),
				),
				materialize: async () => ({
					workspaceId: 'workspace-reader',
					profileScope: 'scope-reader',
					baseCommit: commit,
					generation: 1,
				}),
			},
			true,
		);
		const context = await runtime.open(
			{ owner: 'a', repository: '42' },
			new AbortController().signal,
		);
		expect(context.capabilities).toEqual([
			'read-source',
			'read-draft',
			'review',
		]);
	});

	it('does not grant Push when Gitea has no verified attribution email', async () => {
		const runtime = new RinspaceManagedWorkspaceRuntime(
			{
				fetch: queuedFetch(responses({ verifiedEmail: false })),
				materialize: async () => ({
					workspaceId: 'workspace-unverified',
					profileScope: 'scope-unverified',
					baseCommit: commit,
					generation: 1,
				}),
			},
			true,
		);
		const context = await runtime.open(
			{ owner: 'a', repository: '42' },
			new AbortController().signal,
		);
		expect(context.capabilities).toEqual([
			'read-source',
			'read-draft',
			'review',
		]);
	});

	it('rejects a repository hidden from the current user', async () => {
		const runtime = new RinspaceManagedWorkspaceRuntime(
			{
				fetch: queuedFetch(responses({ repositoryStatus: 404 })),
				materialize: jest.fn(),
			},
			true,
		);
		await expect(
			runtime.open(
				{ owner: 'a', repository: '42', ref: 'main' },
				new AbortController().signal,
			),
		).rejects.toThrow('not permitted');
		expect(runtime.getState()).toEqual({
			status: 'error',
			message: 'Repository access is not permitted',
		});
	});

	it('makes no platform request while disabled', async () => {
		const request = jest.fn() as jest.MockedFunction<typeof fetch>;
		const runtime = new RinspaceManagedWorkspaceRuntime(
			{ fetch: request, materialize: jest.fn() },
			false,
		);
		await expect(
			runtime.open(
				{ owner: 'a', repository: '42', ref: 'main' },
				new AbortController().signal,
			),
		).rejects.toThrow('disabled');
		expect(request).not.toHaveBeenCalled();
	});

	it('aborts in-flight work and ignores late results after disable', async () => {
		let release!: (response: Response) => void;
		const request = jest.fn(
			() => new Promise<Response>((resolve) => {
				release = resolve;
			}),
		) as jest.MockedFunction<typeof fetch>;
		const materialize = jest.fn();
		const runtime = new RinspaceManagedWorkspaceRuntime(
			{ fetch: request, materialize },
			true,
		);
		const invalidated = jest.fn();
		runtime.onContextInvalidated(invalidated);
		const pending = runtime.open(
			{ owner: 'a', repository: '42', ref: 'main' },
			new AbortController().signal,
		);
		runtime.setEnabled(false);
		release(responses()[0]);
		await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
		expect(materialize).not.toHaveBeenCalled();
		expect(runtime.getState()).toEqual({ status: 'disabled' });
		expect(invalidated).toHaveBeenCalledTimes(1);
	});

	it.each(['', '&file:%2Fsections%2Fintro.tex', 'yjs:550e8400-e29b-41d4-a716-446655440001&file:%2Fother.tex'])('restores the bound project route on cached reopen from %s without refetching or resetting files', async hash => {
		const workspaceId = '550e8400-e29b-41d4-a716-446655440000';
		const request = queuedFetch(responses());
		const materialize = jest.fn(async () => ({ workspaceId, profileScope: 'scope-1', baseCommit: commit, generation: 1 }));
		const runtime = new RinspaceManagedWorkspaceRuntime({ fetch: request, materialize }, true);
		const intent = { owner: 'a', repository: '42', ref: 'main' };
		const first = await runtime.open(intent, new AbortController().signal);
		window.history.replaceState(null, '', `/editor/${hash ? `#${hash}` : ''}`);
		sessionStorage.removeItem('currentProjectId');
		const second = await runtime.open(intent, new AbortController().signal);
		expect(second).toBe(first);
		expect(window.location.hash).toBe(`#yjs:${workspaceId}`);
		expect(sessionStorage.getItem('currentProjectId')).toBe(workspaceId);
		expect(request).toHaveBeenCalledTimes(2);
		expect(materialize).toHaveBeenCalledTimes(1);
	});

	it('keeps a matching project route including file, document and compile fragments on cached reopen', async () => {
		const workspaceId = '550e8400-e29b-41d4-a716-446655440000';
		const materialize = jest.fn(async () => ({ workspaceId, profileScope: 'scope-1', baseCommit: commit, generation: 1 }));
		const runtime = new RinspaceManagedWorkspaceRuntime({ fetch: queuedFetch(responses()), materialize }, true);
		const intent = { owner: 'a', repository: '42', ref: 'main' };
		await runtime.open(intent, new AbortController().signal);
		const hash = `#yjs:${workspaceId}&doc:draft-1&file:%2Fsections%2Fintro.tex&compile:latex`;
		window.history.replaceState(null, '', `/editor/${hash}`);
		await runtime.open(intent, new AbortController().signal);
		expect(window.location.hash).toBe(hash);
		expect(materialize).toHaveBeenCalledTimes(1);
	});

	it('starts a fresh connection when a remounted caller replaces an aborted one', async () => {
		const firstController = new AbortController();
		const request = queuedFetch([responses()[0], ...responses()]);
		const materialize = jest.fn(async () => ({
			workspaceId: 'workspace-remounted',
			profileScope: 'scope-remounted',
			baseCommit: commit,
			generation: 1,
		}));
		const runtime = new RinspaceManagedWorkspaceRuntime(
			{ fetch: request, materialize },
			true,
		);
		const first = runtime.open(
			{ owner: 'a', repository: '42', ref: 'main' },
			firstController.signal,
		);
		firstController.abort();
		const second = runtime.open(
			{ owner: 'a', repository: '42', ref: 'main' },
			new AbortController().signal,
		);
		await expect(first).rejects.toMatchObject({ name: 'AbortError' });
		await expect(second).resolves.toEqual(
			expect.objectContaining({
				identity: expect.objectContaining({ actorId: 'rin-user-1' }),
				binding: expect.objectContaining({ workspaceId: 'workspace-remounted' }),
			}),
		);
		expect(materialize).toHaveBeenCalledTimes(1);
	});

	it('revalidates identity after re-enable and does not reuse the old actor', async () => {
		const request = queuedFetch([
			...responses({ actor: 'rin-user-1' }),
			...responses({ actor: 'rin-user-2' }),
		]);
		const materialize = jest.fn(async (resolved) => ({
			workspaceId: `workspace-${resolved.identity.user.id}`,
			profileScope: `scope-${resolved.identity.user.id}`,
			baseCommit: commit,
			generation: 1,
		}));
		const runtime = new RinspaceManagedWorkspaceRuntime(
			{ fetch: request, materialize },
			true,
		);
		const first = await runtime.open(
			{ owner: 'a', repository: '42', ref: 'main' },
			new AbortController().signal,
		);
		runtime.setEnabled(false);
		runtime.setEnabled(true);
		const second = await runtime.open(
			{ owner: 'a', repository: '42', ref: 'main' },
			new AbortController().signal,
		);
		expect(first.identity.actorId).toBe('rin-user-1');
		expect(second.identity.actorId).toBe('rin-user-2');
		expect(first.binding.workspaceId).not.toBe(second.binding.workspaceId);
		expect(materialize).toHaveBeenCalledTimes(2);
	});

	it('keeps the repository branch binding stable across actors and isolates other refs', async () => {
		const first = await new RinspaceManagedWorkspaceRuntime(
			{
				fetch: queuedFetch(responses({ actor: 'rin-user-1', ref: 'main' })),
				materialize: async () => ({
					workspaceId: 'workspace-rin-user-1-main',
					profileScope: 'scope-rin-user-1',
					baseCommit: commit,
					generation: 1,
				}),
			},
			true,
		).open(
			{ owner: 'a', repository: '42', ref: 'main' },
			new AbortController().signal,
		);
		const second = await new RinspaceManagedWorkspaceRuntime(
			{
				fetch: queuedFetch(responses({ actor: 'rin-user-2', ref: 'main' })),
				materialize: async () => ({
					workspaceId: 'workspace-rin-user-2-main',
					profileScope: 'scope-rin-user-2',
					baseCommit: commit,
					generation: 1,
				}),
			},
			true,
		).open(
			{ owner: 'a', repository: '42', ref: 'main' },
			new AbortController().signal,
		);
		const feature = await new RinspaceManagedWorkspaceRuntime(
			{
				fetch: queuedFetch(responses({ actor: 'rin-user-2', ref: 'feature' })),
				materialize: async () => ({
					workspaceId: 'workspace-rin-user-2-feature',
					profileScope: 'scope-rin-user-2',
					baseCommit: commit,
					generation: 1,
				}),
			},
			true,
		).open(
			{ owner: 'a', repository: '42', ref: 'feature' },
			new AbortController().signal,
		);

		expect(first.binding.branchBindingId).toBe(second.binding.branchBindingId);
		expect(first.binding.workspaceId).not.toBe(second.binding.workspaceId);
		expect(feature.binding.branchBindingId).not.toBe(first.binding.branchBindingId);
		expect(feature.binding.ref).toBe('refs/heads/feature');
	});

	it('unbinds its manifest watcher when the plugin is disabled', async () => {
		const stop = jest.fn();
		const watchManifest = jest.fn(() => stop);
		const runtime = new RinspaceManagedWorkspaceRuntime(
			{
				fetch: queuedFetch(responses()),
				materialize: async () => ({
					workspaceId: 'workspace-watch', profileScope: 'scope-watch',
					baseCommit: commit, generation: 1,
				}),
				watchManifest,
			},
			true,
		);
		await runtime.open(
			{ owner: 'a', repository: '42', ref: 'main' },
			new AbortController().signal,
		);
		expect(watchManifest).toHaveBeenCalledTimes(1);
		runtime.setEnabled(false);
		expect(stop).toHaveBeenCalledTimes(1);
	});
});

describe('Rinspace repository archive', () => {
	async function archive(setup: (zip: JSZip) => void): Promise<File> {
		const zip = new JSZip();
		setup(zip);
		const bytes = await zip.generateAsync({ type: 'uint8array' });
		return new NodeFile([bytes], 'repository.zip', {
			type: 'application/zip',
		}) as unknown as File;
	}

	it('strips only the Gitea archive root and keeps mixed binary source bytes', async () => {
		const files = await prepareRinspaceRepositoryArchive(
			await archive((zip) => {
				zip.file('42/main.tex', '中文');
				zip.file('42/chapters/main.typ', '= Typst');
				zip.file('42/assets/pixel.png', new Uint8Array([0, 255, 4]));
			}),
		);
		expect(files.map((file) => file.path)).toEqual(
			expect.arrayContaining([
				'/main.tex',
				'/chapters/main.typ',
				'/assets/pixel.png',
			]),
		);
		const image = files.find((file) => file.path === '/assets/pixel.png');
		expect(image?.isBinary).toBe(true);
		expect(Array.from(new Uint8Array(image?.content as ArrayBuffer))).toEqual([
			0, 255, 4,
		]);
	});

	it('rejects traversal instead of importing outside the repository root', async () => {
		await expect(
			prepareRinspaceRepositoryArchive(
				await archive((zip) => {
					zip.file('42/main.tex', 'safe');
					zip.file('../outside.tex', 'unsafe');
				}),
			),
		).rejects.toThrow('unsafe path');
	});
});
