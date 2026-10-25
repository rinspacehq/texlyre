// SPDX-License-Identifier: AGPL-3.0-or-later
import type {
	AgentMessage,
	AgentModel,
	AgentModelEvent,
	AgentModelFinishReason,
	AgentModelRequest,
} from '@rinspacehq/cline-embed';

import { loadRinspaceSession } from '../../workspace/rinspace/RinspaceSession';

const TURN_LIMIT = 1024 * 1024;
const RESPONSE_LIMIT = 1024 * 1024;
const MAX_TOOL_CALLS = 64;
const MAX_TOOL_CALL_ID = 128;
const MAX_TOOL_NAME = 128;
const finishReasons = new Set<AgentModelFinishReason>([
	'stop',
	'tool-calls',
	'max-tokens',
	'content-filter',
	'aborted',
	'error',
]);

interface RinspaceTurnUsage {
	inputTokens?: number;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
}

interface RinspaceTurnResponse {
	text?: string;
	toolCalls?: Array<{
		id: string;
		name: string;
		input: unknown;
	}>;
	finishReason?: AgentModelFinishReason;
	requestId?: string;
	usage?: RinspaceTurnUsage;
}

type ValidatedRinspaceTurnResponse = RinspaceTurnResponse & {
	finishReason: AgentModelFinishReason;
	requestId: string;
	usage: Required<RinspaceTurnUsage>;
};

function projectMessage(message: AgentMessage): {
	role: AgentMessage['role'];
	content: Array<Record<string, unknown>>;
} {
	return {
		role: message.role,
		content: message.content.map((part) => {
			switch (part.type) {
				case 'text':
					return { type: part.type, text: part.text };
				case 'tool-call':
					return {
						type: part.type,
						toolCallId: part.toolCallId,
						toolName: part.toolName,
						input: part.input,
					};
				case 'tool-result':
					return {
						type: part.type,
						toolCallId: part.toolCallId,
						toolName: part.toolName,
						output: part.output,
						...(part.isError ? { isError: true } : {}),
					};
				default:
					throw new Error('Unsupported Agent message content');
			}
		}),
	};
}

function requireResponse(value: unknown): ValidatedRinspaceTurnResponse {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Agent response is invalid');
	}
	const response = value as RinspaceTurnResponse;
	if (response.text !== undefined && typeof response.text !== 'string') {
		throw new Error('Agent response text is invalid');
	}
	if (response.toolCalls !== undefined && !Array.isArray(response.toolCalls)) {
		throw new Error('Agent response tools are invalid');
	}
	if ((response.toolCalls?.length ?? 0) > MAX_TOOL_CALLS) {
		throw new Error('Agent response has too many tool calls');
	}
	const toolCallIds = new Set<string>();
	for (const call of response.toolCalls ?? []) {
		if (
			!call ||
			typeof call !== 'object' ||
			typeof call.id !== 'string' ||
			!call.id.trim() ||
			call.id.length > MAX_TOOL_CALL_ID ||
			typeof call.name !== 'string' ||
			!call.name.trim() ||
			call.name.length > MAX_TOOL_NAME ||
			toolCallIds.has(call.id)
		) {
			throw new Error('Agent tool call is invalid');
		}
		toolCallIds.add(call.id);
	}
	if (
		typeof response.finishReason !== 'string' ||
		!finishReasons.has(response.finishReason)
	) {
		throw new Error('Agent finish reason is invalid');
	}
	if (
		typeof response.requestId !== 'string' ||
		!response.requestId.trim() ||
		response.requestId.length > 256
	) {
		throw new Error('Agent request ID is invalid');
	}
	if (!response.usage || typeof response.usage !== 'object' || Array.isArray(response.usage)) {
		throw new Error('Agent usage is invalid');
	}
	for (const field of [
		'inputTokens',
		'outputTokens',
		'cacheReadTokens',
		'cacheWriteTokens',
	] as const) {
		const count = response.usage[field];
		if (count === undefined || !Number.isSafeInteger(count) || count < 0) {
			throw new Error('Agent usage is invalid');
		}
	}
	return response as ValidatedRinspaceTurnResponse;
}

async function readBoundedResponse(result: Response): Promise<unknown> {
	const declaredLength = result.headers.get('Content-Length');
	if (declaredLength !== null) {
		const bytes = Number(declaredLength);
		if (Number.isFinite(bytes) && bytes > RESPONSE_LIMIT) {
			throw new Error('Agent response exceeds the browser limit');
		}
	}
	const raw = await result.text();
	if (new TextEncoder().encode(raw).byteLength > RESPONSE_LIMIT) {
		throw new Error('Agent response exceeds the browser limit');
	}
	try {
		return JSON.parse(raw) as unknown;
	} catch {
		throw new Error('Agent response is not valid JSON');
	}
}

export class RinspaceAgentModel implements AgentModel {
	constructor(private readonly runId: string) {}

	async *stream(request: AgentModelRequest): AsyncIterable<AgentModelEvent> {
		const session = await loadRinspaceSession(fetch, request.signal);
		const body = JSON.stringify({
			operationKey: crypto.randomUUID(),
			systemPrompt: request.systemPrompt,
			messages: request.messages.map(projectMessage),
			tools: request.tools,
		});
		if (new TextEncoder().encode(body).byteLength > TURN_LIMIT) {
			throw new Error('Agent turn exceeds the browser request limit');
		}
		const result = await fetch(
			`/rinspace/api/editor/v1/agent/runs/${encodeURIComponent(this.runId)}/turns`,
			{
				method: 'POST',
				credentials: 'include',
				cache: 'no-store',
				signal: request.signal,
				headers: {
					Accept: 'application/json',
					'Content-Type': 'application/json',
					'X-Rinspace-CSRF': session.csrfToken,
				},
				body,
			},
		);
		if (!result.ok) throw new Error(`Agent turn failed (${result.status})`);
		const response = requireResponse(await readBoundedResponse(result));
		if (response.text) yield { type: 'text-delta', text: response.text };
		for (const call of response.toolCalls ?? []) {
			yield {
				type: 'tool-call-delta',
				toolCallId: call.id,
				toolName: call.name,
				input: call.input,
			};
		}
		yield { type: 'usage', usage: response.usage };
		yield {
			type: 'finish',
			reason: response.finishReason,
			requestId: response.requestId,
		};
	}
}
