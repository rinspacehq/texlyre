// SPDX-License-Identifier: AGPL-3.0-or-later
import { createProject, deleteProject, invalidateProjectCreationCapability, projectCreationCapability, tagCandidates, updateProject, type ProjectCreationIntent } from '@extras/workspace/rinspace/RinspaceProjectCreation';
import { loadRinspaceSession } from '@extras/workspace/rinspace/RinspaceSession';

jest.mock('@extras/workspace/rinspace/RinspaceSession', () => ({
	loadRinspaceSession: jest.fn(),
}));

const session = loadRinspaceSession as jest.MockedFunction<typeof loadRinspaceSession>;
const originalFetch = globalThis.fetch;

const intent: ProjectCreationIntent = {
	kind: 'article', sourceFormat: 'markdown', title: 'Draft', excerpt: '', visibility: 'private',
	publicationStatus: 'draft',
	coverRef: '', tagIds: ['42'], idempotencyKey: 'stable-key-1234567890',
};

afterEach(() => {
	globalThis.fetch = originalFetch;
	invalidateProjectCreationCapability();
	jest.clearAllMocks();
});

it('shares and caches the account-scoped creation capability', async () => {
	session.mockResolvedValue({ status: 'authenticated', csrfToken: 'csrf', user: { id: 'alice', sessionEpoch: 1, identityVersion: 1 }, currentSession: { sid: 'sid', version: 1 } });
	const capability = { schemaVersion: 'rinspace-editor-project-creation/v1', enabled: true, kinds: ['article'], sourceFormats: ['latex'], maxTags: 6, defaultVisibility: 'private', tagCreationEnabled: true };
	const fetcher = jest.fn(async () => ({ ok: true, json: async () => capability }));
	globalThis.fetch = fetcher;
	const signal = new AbortController().signal;
	await expect(Promise.all([projectCreationCapability(signal, 'alice'), projectCreationCapability(signal, 'alice')])).resolves.toEqual([capability, capability]);
	await projectCreationCapability(signal, 'alice');
	expect(fetcher).toHaveBeenCalledTimes(1);
	expect(session).toHaveBeenCalledTimes(3);
});

it('blocks a project mutation after the Rinspace account changes', async () => {
	session.mockResolvedValue({ status: 'authenticated', csrfToken: 'csrf', user: { id: 'alice', sessionEpoch: 1, identityVersion: 1 }, currentSession: { sid: 'sid', version: 1 } });
	const fetcher = jest.fn();
	globalThis.fetch = fetcher;
	await expect(createProject(intent, new AbortController().signal, 'bob')).rejects.toThrow('account changed');
	expect(fetcher).not.toHaveBeenCalled();
});

it('sends a same-account creation intent with CSRF and credentials', async () => {
	session.mockResolvedValue({ status: 'authenticated', csrfToken: 'csrf', user: { id: 'alice', sessionEpoch: 1, identityVersion: 1 }, currentSession: { sid: 'sid', version: 1 } });
	const fetcher = jest.fn(async () => ({ ok: true, json: async () => ({ operationId: 'op', state: 'awaiting_source_activation' }) }));
	globalThis.fetch = fetcher;
	await createProject(intent, new AbortController().signal, 'alice');
	expect(fetcher).toHaveBeenCalledWith('/rinspace/api/editor/v1/project-creations', expect.objectContaining({
		method: 'POST', credentials: 'include', cache: 'no-store',
		headers: expect.objectContaining({ 'X-Rinspace-CSRF': 'csrf' }),
		body: JSON.stringify(intent),
	}));
});

it('rejects candidate Tag IDs that lose precision in the browser', async () => {
	session.mockResolvedValue({ status: 'authenticated', csrfToken: 'csrf', user: { id: 'alice', sessionEpoch: 1, identityVersion: 1 }, currentSession: { sid: 'sid', version: 1 } });
	globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ items: [{ id: 9007199254740992, displayName: 'Tag' }] }) }));
	await expect(tagCandidates('Tag', new AbortController().signal, 'alice')).rejects.toThrow('incompatible');
});

it('retains canonical Tag context for duplicate review', async () => {
	session.mockResolvedValue({ status: 'authenticated', csrfToken: 'csrf', user: { id: 'alice', sessionEpoch: 1, identityVersion: 1 }, currentSession: { sid: 'sid', version: 1 } });
	globalThis.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ items: [{ id: 42, displayName: 'Algebra', usageScope: 'Research notes', parentTagIds: [7] }] }) }));
	await expect(tagCandidates('Algebra', new AbortController().signal, 'alice')).resolves.toEqual([{ id: 42, displayName: 'Algebra', usageScope: 'Research notes', parentTagIds: [7] }]);
});

it('uses the authenticated management route for updates and explicit deletions', async () => {
	session.mockResolvedValue({ status: 'authenticated', csrfToken: 'csrf', user: { id: 'alice', sessionEpoch: 1, identityVersion: 1 }, currentSession: { sid: 'sid', version: 1 } });
	const fetcher = jest.fn(async () => ({ ok: true, json: async () => ({ repositoryId: '42', deleted: true }) }));
	globalThis.fetch = fetcher;
	const controller = new AbortController();
	await updateProject('42', { title: 'Updated', excerpt: '', sourceVisibility: 'open', publicationStatus: 'published', coverRef: '', tagIds: ['7'] }, controller.signal, 'alice');
	await deleteProject('42', controller.signal, 'alice');
	expect(fetcher.mock.calls[0]).toEqual(['/rinspace/api/editor/v1/project-management/42', expect.objectContaining({ method: 'PUT', headers: expect.objectContaining({ 'X-Rinspace-CSRF': 'csrf' }) })]);
	expect(fetcher.mock.calls[1]?.[1]?.body).toContain('DELETE 42');
});
