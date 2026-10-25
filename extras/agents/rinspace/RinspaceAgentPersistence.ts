// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AgentMessage } from '@rinspacehq/cline-embed';

const MAX_BYTES = 256 * 1024;

export interface PersistedRinspaceAgentState {
	runId: string;
	messages: readonly AgentMessage[];
	savedAt: number;
}

function key(actorId: string, projectId: string): string {
	return `rinspace-agent:${actorId}:${projectId}`;
}

export function loadAgentState(
	actorId: string,
	projectId: string,
): PersistedRinspaceAgentState | null {
	try {
		const raw = sessionStorage.getItem(key(actorId, projectId));
		if (!raw || new TextEncoder().encode(raw).byteLength > MAX_BYTES) return null;
		const value = JSON.parse(raw) as PersistedRinspaceAgentState;
		if (!value.runId?.trim() || !Array.isArray(value.messages)) return null;
		return value;
	} catch {
		return null;
	}
}

export function saveAgentState(
	actorId: string,
	projectId: string,
	state: PersistedRinspaceAgentState,
): void {
	const raw = JSON.stringify(state);
	if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) return;
	try {
		sessionStorage.setItem(key(actorId, projectId), raw);
	} catch {
		// Persistence is optional; never evict project data for Agent history.
	}
}

export function clearAgentState(actorId: string, projectId: string): void {
	sessionStorage.removeItem(key(actorId, projectId));
}
