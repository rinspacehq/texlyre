// SPDX-License-Identifier: AGPL-3.0-or-later
import { webcrypto } from 'node:crypto';
import type { AgentModelEvent } from '@rinspacehq/cline-embed';

import { RinspaceAgentModel } from '@extras/agents/rinspace/RinspaceAgentModel';
import { loadRinspaceSession } from '@extras/workspace/rinspace/RinspaceSession';

jest.mock('@extras/workspace/rinspace/RinspaceSession', () => ({
	loadRinspaceSession: jest.fn(),
}));

const response = (
	body: string,
	status = 200,
	contentLength: string | null = null,
): Response =>
	({
		ok: status >= 200 && status < 300,
		status,
		headers: { get: jest.fn(() => contentLength) },
		text: jest.fn(async () => body),
	}) as unknown as Response;

const collect = async (model: RinspaceAgentModel, signal?: AbortSignal) => {
	const events: AgentModelEvent[] = [];
	for await (const event of model.stream({ messages: [], tools: [], signal })) {
		events.push(event);
	}
	return events;
};

beforeEach(() => {
	jest.clearAllMocks();
	jest.mocked(crypto.subtle.digest).mockImplementation(
		webcrypto.subtle.digest.bind(webcrypto.subtle),
	);
	jest.mocked(loadRinspaceSession).mockResolvedValue({
		status: 'authenticated',
		csrfToken: 'csrf-proof',
		user: { id: 'actor-1', sessionEpoch: 1, identityVersion: 1 },
		currentSession: { sid: 'session-1', version: 1 },
	});
	global.fetch = jest.fn();
});

test('projects one bounded validated turn and forwards the cancellation signal', async () => {
	const controller = new AbortController();
	(fetch as jest.Mock).mockResolvedValue(
		response(
			JSON.stringify({
				text: '完成',
				toolCalls: [{ id: 'call-1', name: 'read_project_files', input: { files: [] } }],
				finishReason: 'tool-calls',
				requestId: 'receipt-1',
				usage: {
					inputTokens: 8,
					outputTokens: 3,
					cacheReadTokens: 2,
					cacheWriteTokens: 0,
				},
			}),
		),
	);

	await expect(collect(new RinspaceAgentModel('run/1'), controller.signal)).resolves.toEqual([
		{ type: 'text-delta', text: '完成' },
		{
			type: 'tool-call-delta',
			toolCallId: 'call-1',
			toolName: 'read_project_files',
			input: { files: [] },
		},
		{
			type: 'usage',
			usage: {
				inputTokens: 8,
				outputTokens: 3,
				cacheReadTokens: 2,
				cacheWriteTokens: 0,
			},
		},
		{ type: 'finish', reason: 'tool-calls', requestId: 'receipt-1' },
	]);
	expect(fetch).toHaveBeenCalledWith(
		'/rinspace/api/editor/v1/agent/runs/run%2F1/turns',
		expect.objectContaining({
			method: 'POST',
			credentials: 'include',
			signal: controller.signal,
			headers: expect.objectContaining({ 'X-Rinspace-CSRF': 'csrf-proof' }),
		}),
	);
	const body = JSON.parse((fetch as jest.Mock).mock.calls[0][1].body as string);
	expect(body.operationKey).toMatch(
		/^[a-f0-9]{8}-[a-f0-9]{4}-8[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/,
	);
});

test('reuses one operation key for an exact turn across retries and reloads', async () => {
	(fetch as jest.Mock).mockResolvedValue(
		response(
			JSON.stringify({
				text: 'done',
				finishReason: 'stop',
				requestId: 'receipt-stable',
				usage: {
					inputTokens: 1,
					outputTokens: 1,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			}),
		),
	);

	await collect(new RinspaceAgentModel('run-stable'));
	await collect(new RinspaceAgentModel('run-stable'));
	await collect(new RinspaceAgentModel('run-other'));
	const bodies = (fetch as jest.Mock).mock.calls.map((call) =>
		JSON.parse(call[1].body as string),
	);
	expect(bodies[0].operationKey).toBe(bodies[1].operationKey);
	expect(bodies[0].operationKey).not.toBe(bodies[2].operationKey);
});

const invalidResponses: Array<[string, unknown, string]> = [
	[
		'undeclared tool',
		{
			toolCalls: [{ id: 'call-1', name: 'shell', input: {} }],
			finishReason: 'tool-calls',
			requestId: 'receipt-shell',
			usage: {
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
		'Agent tool call is invalid',
	],
	[
		'non-object tool input',
		{
			toolCalls: [{ id: 'call-1', name: 'read_project_files', input: [] }],
			finishReason: 'tool-calls',
			requestId: 'receipt-array',
			usage: {
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
		'Agent tool call is invalid',
	],
	[
		'inconsistent stop reason',
		{
			toolCalls: [{ id: 'call-1', name: 'read_project_files', input: {} }],
			finishReason: 'stop',
			requestId: 'receipt-stop',
			usage: {
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
		'Agent finish reason is inconsistent',
	],
	[
		'oversized tool ID',
		{
			toolCalls: [
				{ id: `call-${'x'.repeat(124)}`, name: 'read_project_files', input: {} },
			],
			finishReason: 'tool-calls',
			requestId: 'receipt-oversized-call',
			usage: {
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
		'Agent tool call is invalid',
	],
	[
		'duplicate tool IDs',
		{
			toolCalls: [
				{ id: 'same', name: 'read_project_files', input: {} },
				{ id: 'same', name: 'git_status', input: {} },
			],
			finishReason: 'tool-calls',
			requestId: 'receipt-duplicate',
			usage: {
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
		'Agent tool call is invalid',
	],
	[
		'negative usage',
		{
			text: 'done',
			finishReason: 'stop',
			requestId: 'receipt-negative',
			usage: {
				inputTokens: -1,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
		'Agent usage is invalid',
	],
	[
		'unknown finish reason',
		{
			finishReason: 'unknown',
			requestId: 'receipt-unknown',
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		},
		'Agent finish reason is invalid',
	],
];

test.each(invalidResponses)('rejects %s before it enters the Agent runtime', async (_label, body, error) => {
	(fetch as jest.Mock).mockResolvedValue(response(JSON.stringify(body)));
	await expect(collect(new RinspaceAgentModel('run-1'))).rejects.toThrow(error);
});

test('rejects declared and actual oversized responses plus malformed JSON', async () => {
	const model = new RinspaceAgentModel('run-1');
	const declared = response('{}', 200, String(1024 * 1024 + 1));
	(fetch as jest.Mock).mockResolvedValueOnce(declared);
	await expect(collect(model)).rejects.toThrow('response exceeds the browser limit');
	expect(declared.text).not.toHaveBeenCalled();

	(fetch as jest.Mock).mockResolvedValueOnce(
		response(JSON.stringify({ text: 'x'.repeat(1024 * 1024) })),
	);
	await expect(collect(model)).rejects.toThrow('response exceeds the browser limit');

	(fetch as jest.Mock).mockResolvedValueOnce(response('{'));
	await expect(collect(model)).rejects.toThrow('response is not valid JSON');
});

test('surfaces policy failures and marks temporary failures for an idempotent retry', async () => {
	for (const [status, body, message] of [
		[401, '{"code":"UNAUTHENTICATED"}', '登录状态已失效，请重新登录。'],
		[402, '{}', '琳任务执行失败 (402)'],
		[429, '{"code":"POLICY_LIMIT"}', '当前账号已达到琳的使用限制，请稍后再试。'],
	] as const) {
		(fetch as jest.Mock).mockResolvedValueOnce(response(body, status));
		await expect(collect(new RinspaceAgentModel('run-1'))).rejects.toThrow(
			message,
		);
	}
	expect(fetch).toHaveBeenCalledTimes(3);

	(fetch as jest.Mock).mockResolvedValueOnce(response('{}', 503));
	await expect(collect(new RinspaceAgentModel('run-1'))).resolves.toEqual([
		{
			type: 'finish',
			reason: 'error',
			error: 'Agent turn is temporarily unavailable (503)',
			errorClass: 'unknown',
			errorRetryable: true,
		},
	]);

	(fetch as jest.Mock).mockRejectedValueOnce(new TypeError('offline'));
	await expect(collect(new RinspaceAgentModel('run-1'))).resolves.toEqual([
		{
			type: 'finish',
			reason: 'error',
			error: 'Agent turn network failure',
			errorClass: 'unknown',
			errorRetryable: true,
		},
	]);

	const interrupted = response('{}');
	jest.mocked(interrupted.text).mockRejectedValueOnce(new TypeError('closed'));
	(fetch as jest.Mock).mockResolvedValueOnce(interrupted);
	await expect(collect(new RinspaceAgentModel('run-1'))).resolves.toEqual([
		{
			type: 'finish',
			reason: 'error',
			error: 'Agent turn response was interrupted',
			errorClass: 'unknown',
			errorRetryable: true,
		},
	]);
	expect(fetch).toHaveBeenCalledTimes(6);
});
