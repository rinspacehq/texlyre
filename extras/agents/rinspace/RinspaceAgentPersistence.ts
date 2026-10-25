// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AgentMessage, AgentUsage } from '@rinspacehq/cline-embed';

const MAX_BYTES = 256 * 1024;
const VERSION = 1;

export const emptyAgentUsage = (): AgentUsage => ({
	inputTokens: 0,
	outputTokens: 0,
	cacheReadTokens: 0,
	cacheWriteTokens: 0,
});

export interface PersistedRinspaceAgentState {
	version: typeof VERSION;
	runId: string;
	messages: readonly AgentMessage[];
	usage: AgentUsage;
	savedAt: number;
}

function key(actorId: string, projectId: string): string {
	return `rinspace-agent:${encodeURIComponent(actorId)}:${encodeURIComponent(projectId)}`;
}

function isUsage(value: unknown): value is AgentUsage {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const usage = value as Record<string, unknown>;
	for (const field of [
		'inputTokens',
		'outputTokens',
		'cacheReadTokens',
		'cacheWriteTokens',
	]) {
		if (!Number.isSafeInteger(usage[field]) || Number(usage[field]) < 0) {
			return false;
		}
	}
	return (
		usage.totalCost === undefined ||
		(typeof usage.totalCost === 'number' &&
			Number.isFinite(usage.totalCost) &&
			usage.totalCost >= 0)
	);
}

function isMessage(value: unknown): value is AgentMessage {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
	const message = value as Record<string, unknown>;
	return (
		typeof message.id === 'string' &&
		['user', 'assistant', 'tool'].includes(String(message.role)) &&
		Array.isArray(message.content) &&
		typeof message.createdAt === 'number' &&
		Number.isFinite(message.createdAt)
	);
}

export function settledAgentMessages(
	messages: readonly AgentMessage[],
	pendingToolCalls: readonly string[],
): AgentMessage[] {
	const completed = new Set<string>();
	for (const message of messages) {
		for (const part of message.content) {
			if (part.type === 'tool-result') completed.add(part.toolCallId);
		}
	}
	const pending = new Set(pendingToolCalls);
	return messages
		.map((message) => ({
			...message,
			content: message.content.filter(
				(part) =>
					part.type !== 'tool-call' ||
					(!pending.has(part.toolCallId) && completed.has(part.toolCallId)),
			),
		}))
		.filter((message) => message.content.length > 0);
}

export function loadAgentState(
	actorId: string,
	projectId: string,
): PersistedRinspaceAgentState | null {
	try {
		const raw = sessionStorage.getItem(key(actorId, projectId));
		if (!raw || new TextEncoder().encode(raw).byteLength > MAX_BYTES) return null;
		const value = JSON.parse(raw) as Partial<PersistedRinspaceAgentState>;
		if (
			!value.runId?.trim() ||
			!Array.isArray(value.messages) ||
			!value.messages.every(isMessage) ||
			(typeof value.savedAt !== 'number' || !Number.isFinite(value.savedAt))
		) {
			return null;
		}
		const usage = value.usage ?? emptyAgentUsage();
		if (!isUsage(usage)) return null;
		return {
			version: VERSION,
			runId: value.runId,
			messages: settledAgentMessages(value.messages, []),
			usage,
			savedAt: value.savedAt,
		};
	} catch {
		return null;
	}
}

export function saveAgentState(
	actorId: string,
	projectId: string,
	state: PersistedRinspaceAgentState,
): void {
	try {
		const raw = JSON.stringify({ ...state, version: VERSION });
		if (new TextEncoder().encode(raw).byteLength > MAX_BYTES) return;
		sessionStorage.setItem(key(actorId, projectId), raw);
	} catch {
		// Persistence is optional. Cyclic tool output and storage quota failures must
		// never interrupt the editor or evict unrelated project data.
	}
}

export function clearAgentState(actorId: string, projectId: string): void {
	try {
		sessionStorage.removeItem(key(actorId, projectId));
	} catch {
		// Clearing optional recovery data must not interrupt the new task action.
	}
}
