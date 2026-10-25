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
const finishReasons = new Set<AgentModelFinishReason>([
	'unknown',
	'stop',
	'tool-calls',
	'max-tokens',
	'content-filter',
	'aborted',
	'error',
]);

interface RinspaceTurnResponse {
	text?: string;
	toolCalls?: Array<{
		id: string;
		name: string;
		input: unknown;
	}>;
	finishReason?: AgentModelFinishReason;
	requestId?: string;
	usage?: {
		inputTokens?: number;
		outputTokens?: number;
		cacheReadTokens?: number;
		cacheWriteTokens?: number;
	};
}

function projectMessage(message: AgentMessage): AgentMessage {
	return {
		...message,
		content: message.content.map((part) => {
			if (part.type === 'image' || part.type === 'media') {
				throw new Error('Binary Agent message content is not supported');
			}
			return part;
		}),
	};
}

function requireResponse(value: unknown): RinspaceTurnResponse {
	if (!value || typeof value !== 'object') throw new Error('Agent response is invalid');
	const response = value as RinspaceTurnResponse;
	if (response.text !== undefined && typeof response.text !== 'string') {
		throw new Error('Agent response text is invalid');
	}
	if (response.toolCalls !== undefined && !Array.isArray(response.toolCalls)) {
		throw new Error('Agent response tools are invalid');
	}
	return response;
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
		const response = requireResponse(await result.json());
		if (response.text) yield { type: 'text-delta', text: response.text };
		for (const call of response.toolCalls ?? []) {
			if (!call?.id?.trim() || !call.name?.trim()) {
				throw new Error('Agent tool call is invalid');
			}
			yield {
				type: 'tool-call-delta',
				toolCallId: call.id,
				toolName: call.name,
				input: call.input,
			};
		}
		if (response.usage) yield { type: 'usage', usage: response.usage };
		const finishReason = finishReasons.has(response.finishReason ?? 'unknown')
			? (response.finishReason ?? 'unknown')
			: 'unknown';
		yield {
			type: 'finish',
			reason: finishReason,
			requestId: response.requestId,
		};
	}
}
