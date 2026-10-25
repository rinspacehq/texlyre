// SPDX-License-Identifier: AGPL-3.0-or-later
import {
	loadRinspaceAgentConfig,
	loadRinspaceAgentRun,
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
			status: 'waiting_for_user',
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
		id: 'run-1',
		projectId: 'project-1',
		status: 'waiting_for_user',
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
			status: 'ready',
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
			status: 'ready',
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
			status: 'ready',
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

test('does not treat a failed recovery response as a resumable run', async () => {
	(fetch as jest.Mock).mockResolvedValue(response({}, 401));
	await expect(loadRinspaceAgentRun('run-1', 'project-1')).rejects.toThrow(
		'Agent run recovery failed (401)',
	);
});
