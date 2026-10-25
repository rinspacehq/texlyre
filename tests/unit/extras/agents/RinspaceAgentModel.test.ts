// SPDX-License-Identifier: AGPL-3.0-or-later
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
	expect(body.operationKey).toBe('00000000-0000-0000-0000-000000000000');
});

const invalidResponses: Array<[string, unknown, string]> = [
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

test('surfaces auth, quota, policy and network failures without retrying the operation', async () => {
	for (const status of [401, 402, 429, 503]) {
		(fetch as jest.Mock).mockResolvedValueOnce(response('{}', status));
		await expect(collect(new RinspaceAgentModel('run-1'))).rejects.toThrow(
			`Agent turn failed (${status})`,
		);
	}
	expect(fetch).toHaveBeenCalledTimes(4);

	(fetch as jest.Mock).mockRejectedValueOnce(new TypeError('offline'));
	await expect(collect(new RinspaceAgentModel('run-1'))).rejects.toThrow('offline');
	expect(fetch).toHaveBeenCalledTimes(5);
});
