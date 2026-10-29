// SPDX-License-Identifier: AGPL-3.0-or-later
import {
	clearRinspaceManagedRoute,
	isRinspaceAccountRoute,
	replaceRinspaceManagedRoute,
	rinspaceProjectActivationHash,
} from '@extras/workspace/rinspace/RinspaceRoutePolicy';
import { RinspaceManagedWorkspaceRuntime } from '@extras/workspace/rinspace/RinspaceManagedWorkspace';
import { RinspaceProjectCatalog } from '@extras/workspace/rinspace/RinspaceProjectCatalog';

test.each(['?mode=local', '?mode=local-unbound', '?mode=managed&mode=local', '?mode=unknown'])('local or invalid %s cannot enable account requests', async search => {
	const request = jest.fn();
	const runtime = new RinspaceManagedWorkspaceRuntime({ fetch: request, materialize: jest.fn() }, true, () => isRinspaceAccountRoute(search, 'https://rinspace.com'));
	runtime.setEnabled(true); // Restored settings cannot override the route boundary.
	const catalog = new RinspaceProjectCatalog(runtime, request);
	expect(await catalog.listPage({ page: 1, pageSize: 24 }, new AbortController().signal)).toEqual({ status: 'anonymous', projects: [] });
	expect(await catalog.getAccount(new AbortController().signal)).toBeNull();
	await expect(runtime.open({ mode: 'managed', owner: 'a', repository: '42' }, new AbortController().signal)).rejects.toThrow('disabled');
	expect(request).not.toHaveBeenCalled();
});

test('offline/local origins do not discover the platform account', () => {
	for (const origin of ['http://localhost:5173', 'null', 'https://example.com']) expect(isRinspaceAccountRoute('', origin)).toBe(false);
	expect(isRinspaceAccountRoute('', 'https://rinspace.com')).toBe(true);
	expect(isRinspaceAccountRoute('?mode=managed', 'https://rinspace.com')).toBe(true);
});

describe('managed project activation', () => {
	const projectId = '550e8400-e29b-41d4-a716-446655440000';
	const fallback = `yjs:${projectId}&file:%2Fmain.tex`;

	test.each([
		`#yjs:${projectId}&file:%2Fsections%2Fintro.tex`,
		`#yjs:${projectId}&file:%2F%E7%AB%A0%E8%8A%82.tex`,
		`#yjs:${projectId}&file:%2Fsections%2Fintro.tex&compile:main.tex`,
		`#yjs:${projectId}&doc:linked-document&file:%2Fsections%2Fintro.tex`,
	])('keeps the same project file on reload: %s', hash => {
		expect(rinspaceProjectActivationHash(hash, projectId, '/main.tex')).toBe(hash.slice(1));
	});

	test.each(['', '#', `#yjs:${projectId}`, `#yjs:${projectId}&file:`, '#yjs:550e8400-e29b-41d4-a716-446655440001&file:%2Fother.tex', '#&file:%2Fsections%2Fintro.tex'])('uses the entry when no same-project file was requested: %s', hash => {
		expect(rinspaceProjectActivationHash(hash, projectId, '/main.tex')).toBe(fallback);
	});
});

test('persists a refresh-safe managed launch and clears it when leaving', () => {
	window.history.replaceState(null, '', '/editor/?source=catalog#yjs:project-1');
	replaceRinspaceManagedRoute({ owner: 'a', repository: '42', ref: 'main' });
	expect(window.location.search).toBe('?source=catalog&mode=managed&owner=a&repository=42&ref=main');
	expect(window.location.hash).toBe('#yjs:project-1');

	clearRinspaceManagedRoute();
	expect(window.location.search).toBe('?source=catalog');
	expect(window.location.hash).toBe('#yjs:project-1');
});
