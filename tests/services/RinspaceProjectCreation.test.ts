// SPDX-License-Identifier: AGPL-3.0-or-later
import { createProject, tagCandidates, type ProjectCreationIntent } from '@extras/workspace/rinspace/RinspaceProjectCreation';
import { loadRinspaceSession } from '@extras/workspace/rinspace/RinspaceSession';

jest.mock('@extras/workspace/rinspace/RinspaceSession', () => ({
	loadRinspaceSession: jest.fn(),
}));

const session = loadRinspaceSession as jest.MockedFunction<typeof loadRinspaceSession>;
const originalFetch = globalThis.fetch;

const intent: ProjectCreationIntent = {
	kind: 'article', sourceFormat: 'markdown', title: 'Draft', excerpt: '', visibility: 'private',
	coverRef: '', tagIds: ['42'], idempotencyKey: 'stable-key-1234567890',
};

afterEach(() => {
	globalThis.fetch = originalFetch;
	jest.clearAllMocks();
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
