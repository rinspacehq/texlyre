// SPDX-License-Identifier: AGPL-3.0-or-later
import {
	loadRinspaceAgentConfig,
	loadRinspaceAgentRun,
	reconcileRinspaceAgentMessages,
	RINSPACE_AGENT_SYSTEM_PROMPT,
} from '@extras/agents/rinspace/RinspaceAgentRuntime';

jest.mock('@rinspacehq/cline-embed', () => ({
	AgentRuntime: jest.fn(),
	createTool: jest.fn(),
}));

const response = (body: unknown, status = 200) =>
	({
		ok: status >= 200 && status < 300,
		status,
		json: jest.fn(async () => body),
	}) as unknown as Response;

beforeEach(() => {
	global.fetch = jest.fn();
});

test('uses a nonempty project-only prompt with the closed execution boundary', () => {
	expect(RINSPACE_AGENT_SYSTEM_PROMPT).toContain('当前 TeXlyre 项目');
	expect(RINSPACE_AGENT_SYSTEM_PROMPT).toContain('push_git_commits');
	expect(RINSPACE_AGENT_SYSTEM_PROMPT).toContain('不得请求或推断 Shell');
	expect(RINSPACE_AGENT_SYSTEM_PROMPT).not.toMatch(/DeepSeek|API key|token/i);
});

test('recovers authoritative usage only for the exact run and project', async () => {
	const signal = new AbortController().signal;
	(fetch as jest.Mock).mockResolvedValue(
		response({
			id: 'run-1',
			projectId: 'project-1',
			status: 'ACTIVE',
			usage: {
				inputTokens: 120,
				outputTokens: 30,
				cacheReadTokens: 10,
				cacheWriteTokens: 0,
				totalCost: 0.2,
			},
		}),
	);

	await expect(loadRinspaceAgentRun('run-1', 'project-1', signal)).resolves.toEqual({
		billing: null,
		id: 'run-1',
		projectId: 'project-1',
		status: 'ACTIVE',
		confirmedTurns: [],
		usage: {
			inputTokens: 120,
			outputTokens: 30,
			cacheReadTokens: 10,
			cacheWriteTokens: 0,
			totalCost: 0.2,
		},
	});
	expect(fetch).toHaveBeenCalledWith(
		'/rinspace/api/editor/v1/agent/runs/run-1',
		expect.objectContaining({
			credentials: 'include',
			cache: 'no-store',
			signal,
		}),
	);
});

test('reconciles only confirmed text turns and never replays missing tools', () => {
	const messages = [{
		id: 'user-1',
		role: 'user' as const,
		content: [{ type: 'text' as const, text: '检查项目' }],
		createdAt: 1,
	}];
	const confirmed = {
		iteration: 1,
		operationId: '10000000-0000-8000-8000-000000000001',
		text: '检查完成',
		toolCalls: [],
		finishReason: 'stop' as const,
		requestId: 'provider-1',
		usage: {
			inputTokens: 4,
			outputTokens: 2,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
		createdAt: '2026-10-25T17:00:00Z',
	};
	const reconciled = reconcileRinspaceAgentMessages(messages, [confirmed]);
	expect(reconciled).toHaveLength(2);
	expect(reconciled[1]).toMatchObject({
		role: 'assistant',
		content: [{ type: 'text', text: '检查完成' }],
	});

	expect(() => reconcileRinspaceAgentMessages(messages, [{
		...confirmed,
		text: '',
		toolCalls: [{ id: 'call-1', name: 'git_status' }],
		finishReason: 'tool-calls',
	}])).toThrow('cannot be replayed safely');
});

test('validates confirmed server turns before reconciliation', async () => {
	const turn = {
		iteration: 1,
		operationId: '10000000-0000-8000-8000-000000000001',
		text: '',
		toolCalls: [{ id: 'call-1', name: 'git_status' }],
		finishReason: 'tool-calls',
		requestId: 'provider-1',
		usage: {
			inputTokens: 4,
			outputTokens: 2,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
		createdAt: '2026-10-25T17:00:00Z',
	};
	const run = {
		id: 'run-1',
		projectId: 'project-1',
		status: 'ACTIVE',
		usage: turn.usage,
		confirmedTurns: [turn],
	};
	(fetch as jest.Mock).mockResolvedValueOnce(response(run));
	await expect(loadRinspaceAgentRun('run-1', 'project-1')).resolves.toMatchObject({
		confirmedTurns: [{ iteration: 1, toolCalls: [{ name: 'git_status' }] }],
	});

	(fetch as jest.Mock).mockResolvedValueOnce(response({
		...run,
		confirmedTurns: [{ ...turn, toolCalls: [{ id: 'call-1', name: 'shell' }] }],
	}));
	await expect(loadRinspaceAgentRun('run-1', 'project-1')).rejects.toThrow(
		'confirmed turns are invalid',
	);
});

test('accepts only the bounded backend Agent configuration contract', async () => {
	(fetch as jest.Mock).mockResolvedValueOnce(
		response({
			enabled: true,
			model: 'managed-model',
			maxIterations: 128,
			maxOutputTokens: 4096,
			maxGoodness: 1_000_000_000_000,
		}),
	);
	await expect(loadRinspaceAgentConfig()).resolves.toMatchObject({
		enabled: true,
		maxIterations: 128,
		maxOutputTokens: 4096,
	});

	for (const invalid of [
		{
			enabled: true,
			model: '',
			maxIterations: 12,
			maxOutputTokens: 1024,
			maxGoodness: 100,
		},
		{
			enabled: true,
			model: 'managed-model',
			maxIterations: 129,
			maxOutputTokens: 1024,
			maxGoodness: 100,
		},
		{
			enabled: true,
			model: 'managed-model',
			maxIterations: 12,
			maxOutputTokens: 0,
			maxGoodness: 100,
		},
	]) {
		(fetch as jest.Mock).mockResolvedValueOnce(response(invalid));
		await expect(loadRinspaceAgentConfig()).rejects.toThrow(
			'Agent config is invalid',
		);
	}
});

test('rejects cross-project and malformed billing projections', async () => {
	(fetch as jest.Mock).mockResolvedValueOnce(
		response({
			id: 'run-1',
			projectId: 'project-other',
			status: 'ACTIVE',
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		}),
	);
	await expect(loadRinspaceAgentRun('run-1', 'project-1')).rejects.toThrow(
		'recovery response is invalid',
	);

	(fetch as jest.Mock).mockResolvedValueOnce(
		response({
			id: 'run-1',
			projectId: 'project-1',
			status: 'ACTIVE',
			usage: {
				inputTokens: -1,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		}),
	);
	await expect(loadRinspaceAgentRun('run-1', 'project-1')).rejects.toThrow(
		'usage is invalid',
	);

	(fetch as jest.Mock).mockResolvedValueOnce(
		response({
			id: 'run-1',
			projectId: 'project-1',
			status: 'ACTIVE',
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
				reasoningTokenCount: -1,
			},
		}),
	);
	await expect(loadRinspaceAgentRun('run-1', 'project-1')).rejects.toThrow(
		'usage is invalid',
	);
});

test('accepts only the exact server run-state vocabulary', async () => {
	for (const status of [
		'ACTIVE',
		'RECOVERY_REQUIRED',
		'COMPLETED',
		'ABORTED',
		'FAILED_FINAL',
	]) {
		(fetch as jest.Mock).mockResolvedValueOnce(
			response({
				id: 'run-1',
				projectId: 'project-1',
				status,
				usage: {
					inputTokens: 0,
					outputTokens: 0,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
			}),
		);
		await expect(loadRinspaceAgentRun('run-1', 'project-1')).resolves.toHaveProperty(
			'status',
			status,
		);
	}

	(fetch as jest.Mock).mockResolvedValueOnce(
		response({
			id: 'run-1',
			projectId: 'project-1',
			status: 'waiting_for_user',
			usage: {
				inputTokens: 0,
				outputTokens: 0,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		}),
	);
	await expect(loadRinspaceAgentRun('run-1', 'project-1')).rejects.toThrow(
		'recovery response is invalid',
	);
});

test('does not treat a failed recovery response as a resumable run', async () => {
	(fetch as jest.Mock).mockResolvedValue(response({}, 401));
	await expect(loadRinspaceAgentRun('run-1', 'project-1')).rejects.toThrow(
		'Agent run recovery failed (401)',
	);
});
