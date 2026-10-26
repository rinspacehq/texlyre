// SPDX-License-Identifier: AGPL-3.0-or-later
export const RINSPACE_AGENT_MAX_TOOL_CALLS = 32;

export const RINSPACE_AGENT_TOOL_NAMES = [
	'list_project_files',
	'read_project_files',
	'search_project',
	'read_compile_diagnostics',
	'git_status',
	'compile_project',
	'apply_project_patch',
	'create_project_file',
	'rename_project_file',
	'delete_project_file',
	'create_git_commit',
	'push_git_commits',
] as const;

export type RinspaceAgentToolName = (typeof RINSPACE_AGENT_TOOL_NAMES)[number];

const toolNames = new Set<string>(RINSPACE_AGENT_TOOL_NAMES);

export function isRinspaceAgentToolName(
	value: unknown,
): value is RinspaceAgentToolName {
	return typeof value === 'string' && toolNames.has(value);
}

export function isRinspaceAgentCallId(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		value.length > 0 &&
		value.length <= 128 &&
		/^[A-Za-z0-9._-]+$/.test(value)
	);
}

export function isRinspaceAgentJSONObject(
	value: unknown,
): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

export async function createRinspaceAgentOperationKey(
	runId: string,
	request: unknown,
): Promise<string> {
	const encoded = new TextEncoder().encode(
		JSON.stringify({ domain: 'rinspace-agent-turn-v1', runId, request }),
	);
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encoded));
	const uuid = digest.slice(0, 16);
	// RFC 9562 version 8 is reserved for application-defined deterministic UUIDs.
	uuid[6] = (uuid[6] & 0x0f) | 0x80;
	uuid[8] = (uuid[8] & 0x3f) | 0x80;
	const hex = Array.from(uuid, (value) =>
		value.toString(16).padStart(2, '0'),
	).join('');
	return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
