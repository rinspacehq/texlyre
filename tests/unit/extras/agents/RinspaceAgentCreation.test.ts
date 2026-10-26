// SPDX-License-Identifier: AGPL-3.0-or-later
import { RinspaceAgentController } from '@extras/agents/rinspace/RinspaceAgentRuntime';
import { gitSyncService } from '@/services/GitSyncService';
import type { HostContext } from '@/workspace/contracts';
import type { RinspaceAgentToolHost } from '@extras/agents/rinspace/RinspaceAgentTools';

jest.mock('@/services/GitSyncService', () => ({ gitSyncService: { loadConfig: jest.fn() } }));
jest.mock('@extras/workspace/rinspace/RinspaceSession', () => ({
 loadRinspaceSession: jest.fn(async () => ({ csrfToken: 'synthetic-csrf' })),
}));
jest.mock('@rinspacehq/cline-embed', () => ({ AgentRuntime: jest.fn(() => ({ subscribe: jest.fn() })) }));
jest.mock('@extras/agents/rinspace/RinspaceAgentTools', () => ({
 createRinspaceAgentTools: jest.fn(() => ({ tools: [], policies: {} })),
}));
jest.mock('@extras/agents/rinspace/RinspaceAgentModel', () => ({ RinspaceAgentModel: jest.fn() }));

const context: Extract<HostContext, { mode: 'managed' }> = {
 mode: 'managed', identity: { actorId: 'actor-1', permissionEpoch: 'epoch-1' },
 binding: { repositoryId: '42', repositoryFullName: 'a/42', branchBindingId: 'branch-1',
  ref: 'refs/heads/main', workspaceId: 'workspace-1', generation: 1, baseCommit: 'a'.repeat(40), objectFormat: 'sha1' },
 capabilities: ['read-source', 'write-source'],
};
const config = { enabled: true, model: 'synthetic-model', maxIterations: 24, maxOutputTokens: 1024, maxGoodness: 1000 };
const host = { isActive: () => true } as Omit<RinspaceAgentToolHost, 'runId'>;
const remote = () => ({ managed: true, providerId: 'rinspace-gitea-session', repositoryId: 'a/42',
 branch: 'main', syncBase: { localOid: 'b'.repeat(40), remoteOid: 'b'.repeat(40) } });
beforeEach(() => {
 jest.clearAllMocks();
 (gitSyncService.loadConfig as jest.Mock).mockResolvedValue(remote());
 global.fetch = jest.fn(async () => ({ ok: true, json: async () => ({ id: 'run-1' }) })) as jest.Mock;
});

test('creates successive tasks from the durable synchronized base without changing the import context', async () => {
 await RinspaceAgentController.create(context, 'workspace-1', config, host);
 expect(JSON.parse((fetch as jest.Mock).mock.calls[0][1].body).binding).toEqual({ ...context.binding, baseCommit: 'b'.repeat(40) });
 (gitSyncService.loadConfig as jest.Mock).mockResolvedValue({ ...remote(), syncBase: { localOid: 'c'.repeat(40), remoteOid: 'c'.repeat(40) } });
 await RinspaceAgentController.create(context, 'workspace-1', config, host);
 expect(JSON.parse((fetch as jest.Mock).mock.calls[1][1].body).binding.baseCommit).toBe('c'.repeat(40));
 expect(context.binding.baseCommit).toBe('a'.repeat(40));
 expect(gitSyncService.loadConfig).toHaveBeenNthCalledWith(2, 'workspace-1');
});

test.each([
 undefined,
 { ...remote(), managed: false },
 { ...remote(), providerId: 'other-provider' },
 { ...remote(), repositoryId: 'a/another-project' },
 { ...remote(), branch: 'another-branch' },
 { ...remote(), syncBase: undefined },
 { ...remote(), syncBase: { localOid: 'b'.repeat(40), remoteOid: 'not-a-commit' } },
 { ...remote(), syncBase: { localOid: 'b'.repeat(40), remoteOid: 'c'.repeat(40) } },
])('refuses unverified or foreign synchronization state before creating a task: %j', async value => {
 (gitSyncService.loadConfig as jest.Mock).mockResolvedValue(value);
 await expect(RinspaceAgentController.create(context, 'workspace-1', config, host)).rejects.toThrow(/synchroniz|binding/i);
 expect(fetch).not.toHaveBeenCalled();
});

test('refuses a different workspace without reading its remote configuration', async () => {
 await expect(RinspaceAgentController.create(context, 'other-workspace', config, host)).rejects.toThrow(/workspace|binding/i);
 expect(gitSyncService.loadConfig).not.toHaveBeenCalled();
 expect(fetch).not.toHaveBeenCalled();
});

test('does not create a task when cancelled while reading the synchronization base', async () => {
 const controller = new AbortController();
 (gitSyncService.loadConfig as jest.Mock).mockImplementation(async () => { controller.abort(); return remote(); });
 await expect(RinspaceAgentController.create(context, 'workspace-1', config, host, [], controller.signal)).rejects.toThrow();
 expect(fetch).not.toHaveBeenCalled();
});
