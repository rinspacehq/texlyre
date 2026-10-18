// SPDX-License-Identifier: AGPL-3.0-or-later
import { prepareManagedGit, type RinspaceResolvedWorkspace } from '@extras/workspace/rinspace/RinspaceManagedWorkspace';
import { gitService } from '@src/services/GitService';
import { gitSyncService } from '@src/services/GitSyncService';
import type { GitRemoteConfig } from '@src/types/gitRemote';
import type { Project } from '@src/types/projects';

const imported = 'a'.repeat(40), pushed = 'b'.repeat(40), pending = 'c'.repeat(40);
const project = { id: 'managed-project', managedBinding: { baseCommit: imported } } as Project;
const workspace = { repository: { fullName: 'a/42', permissions: { push: true, admin: false } }, ref: 'main', commitIdentity: { name: 'Writer', email: 'writer@example.test' } } as RinspaceResolvedWorkspace;
const config: GitRemoteConfig = { providerId: 'rinspace-gitea-session', repositoryId: 'a/42', repositoryLabel: 'a/42', branch: 'main', credentialSource: 'history', managed: true, syncBase: { localOid: pushed, remoteOid: pushed } };

beforeEach(() => {
	jest.spyOn(gitService, 'setManagedCommitIdentity').mockImplementation(() => {});
	jest.spyOn(gitService, 'isInitialized').mockResolvedValue(true);
	jest.spyOn(gitService, 'getHeadOid').mockResolvedValue(pending);
	jest.spyOn(gitSyncService, 'loadConfig').mockResolvedValue(config);
	jest.spyOn(gitSyncService, 'bindBrowserSessionRemote').mockResolvedValue();
	jest.spyOn(gitSyncService, 'fetchForMerge');
});
afterEach(() => jest.restoreAllMocks());

test('reopen preserves the successfully pushed base instead of seeding the initial import again', async () => {
	await prepareManagedGit(workspace, project, true, new AbortController().signal);
	expect(gitSyncService.bindBrowserSessionRemote).toHaveBeenCalledWith(project.id, expect.objectContaining({ repositoryId: 'a/42', branch: 'main', readOnly: false }), undefined);
	expect(gitSyncService.fetchForMerge).not.toHaveBeenCalled();
});

test('reopen does not replace a mapped sync base with a pending local HEAD or the observed remote HEAD', async () => {
	jest.mocked(gitSyncService.loadConfig).mockResolvedValue({ ...config, syncBase: { localOid: pushed, remoteOid: 'd'.repeat(40) } });
	await prepareManagedGit({ ...workspace, remoteHead: 'e'.repeat(40) }, project, true, new AbortController().signal);
	expect(gitSyncService.bindBrowserSessionRemote).toHaveBeenLastCalledWith(project.id, expect.anything(), undefined);
	expect(gitSyncService.fetchForMerge).not.toHaveBeenCalled();
});

test.each([undefined, { ...config, syncBase: undefined }, { ...config, managed: false }, { ...config, providerId: 'another-provider' }, { ...config, repositoryId: 'a/other' }, { ...config, branch: 'other' }])('seeds only the original baseline when no matching saved managed base exists: %p', async existing => {
	jest.mocked(gitSyncService.loadConfig).mockResolvedValue(existing);
	await prepareManagedGit(workspace, project, true, new AbortController().signal);
	expect(gitSyncService.bindBrowserSessionRemote).toHaveBeenLastCalledWith(project.id, expect.anything(), { localOid: imported, remoteOid: imported });
	expect(gitSyncService.fetchForMerge).not.toHaveBeenCalled();
});

test('updates current read-only permissions while retaining the same managed sync base', async () => {
	await prepareManagedGit({ ...workspace, repository: { ...workspace.repository, permissions: { pull: true, push: false, admin: false } } }, project, true, new AbortController().signal);
	expect(gitSyncService.bindBrowserSessionRemote).toHaveBeenLastCalledWith(project.id, expect.objectContaining({ readOnly: true }), undefined);
});
