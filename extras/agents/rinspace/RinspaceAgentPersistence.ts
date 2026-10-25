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
	if (
		usage.reasoningTokenCount !== undefined &&
		(!Number.isSafeInteger(usage.reasoningTokenCount) ||
			Number(usage.reasoningTokenCount) < 0)
	) {
		return false;
	}
	return (
		usage.totalCost === undefined ||
		(typeof usage.totalCost === 'number' &&
			Number.isFinite(usage.totalCost) &&
			usage.totalCost >= 0)
	);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function isIdentifier(value: unknown, maximum: number): value is string {
	return typeof value === 'string' && value.trim().length > 0 && value.length <= maximum;
}

function isMessagePart(
	value: unknown,
	role: AgentMessage['role'],
): value is AgentMessage['content'][number] {
	if (!isRecord(value) || typeof value.type !== 'string') return false;
	switch (value.type) {
		case 'text':
			return role !== 'tool' && typeof value.text === 'string';
		case 'tool-call':
			return (
				role === 'assistant' &&
				isIdentifier(value.toolCallId, 128) &&
				isIdentifier(value.toolName, 128) &&
				(value.execution === undefined ||
					value.execution === 'client' ||
					value.execution === 'provider')
			);
		case 'tool-result':
			return (
				role === 'tool' &&
				isIdentifier(value.toolCallId, 128) &&
				isIdentifier(value.toolName, 128) &&
				(value.isError === undefined || typeof value.isError === 'boolean') &&
				(value.execution === undefined ||
					value.execution === 'client' ||
					value.execution === 'provider')
			);
		default:
			return false;
	}
}

function isMessage(value: unknown): value is AgentMessage {
	if (!isRecord(value)) return false;
	const role = value.role;
	if (!['user', 'assistant', 'tool'].includes(String(role))) return false;
	return (
		isIdentifier(value.id, 256) &&
		Array.isArray(value.content) &&
		value.content.length > 0 &&
		value.content.every((part) =>
			isMessagePart(part, role as AgentMessage['role']),
		) &&
		typeof value.createdAt === 'number' &&
		Number.isFinite(value.createdAt)
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
			(value.version !== undefined && value.version !== VERSION) ||
			!value.runId?.trim() ||
			value.runId.length > 256 ||
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
