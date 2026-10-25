// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AgentTool, ToolPolicy } from '@rinspacehq/cline-embed';

export interface RinspaceAgentToolSet {
	tools: readonly AgentTool[];
	policies: Readonly<Record<string, Readonly<ToolPolicy>>>;
}

/** Tool implementations are added as audited TeXlyre service bridges. */
export function createRinspaceAgentTools(): RinspaceAgentToolSet {
	return { tools: [], policies: {} };
}
