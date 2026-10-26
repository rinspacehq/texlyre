// SPDX-License-Identifier: AGPL-3.0-or-later
import { gitSyncService } from '@/services/GitSyncService';
import type { HostContext, WorkspaceBinding } from '@/workspace/contracts';

export async function loadSynchronizedAgentBinding(
	context: Extract<HostContext, { mode: 'managed' }>,
	projectId: string,
	signal?: AbortSignal,
): Promise<WorkspaceBinding> {
	signal?.throwIfAborted();
	const binding = context.binding;
	if (
		binding.workspaceId !== projectId ||
		!binding.repositoryFullName ||
		!binding.ref.startsWith('refs/heads/')
	) {
		throw new Error('Agent workspace binding is unavailable');
	}
	const remote = await gitSyncService.loadConfig(projectId);
	signal?.throwIfAborted();
	const base = remote?.syncBase;
	const oid =
		binding.objectFormat === 'sha1'
			? /^[a-f0-9]{40}$/
			: binding.objectFormat === 'sha256'
				? /^[a-f0-9]{64}$/
				: null;
	if (
		!remote?.managed ||
		remote.providerId !== 'rinspace-gitea-session' ||
		remote.repositoryId !== binding.repositoryFullName ||
		remote.branch !== binding.ref.slice('refs/heads/'.length) ||
		!base ||
		!oid?.test(base.remoteOid) ||
		base.localOid !== base.remoteOid
	) {
		throw new Error(
			'Agent requires a verified synchronization binding for this repository and branch',
		);
	}
	// A completed Pull/Push advances this durable base. Do not adopt a moving
	// remote HEAD, an unpushed local commit, or mutate an existing task's binding.
	return { ...binding, baseCommit: base.remoteOid };
}
