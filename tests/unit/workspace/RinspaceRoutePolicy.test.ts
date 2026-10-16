// SPDX-License-Identifier: AGPL-3.0-or-later
import { isRinspaceAccountRoute } from '@extras/workspace/rinspace/RinspaceRoutePolicy';
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
