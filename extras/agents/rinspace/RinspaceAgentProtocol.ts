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
