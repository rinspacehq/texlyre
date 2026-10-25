// SPDX-License-Identifier: AGPL-3.0-or-later
import { loadRinspaceAgentRun } from '@extras/agents/rinspace/RinspaceAgentRuntime';

const response = (body: unknown, status = 200) =>
	({
		ok: status >= 200 && status < 300,
		status,
		json: jest.fn(async () => body),
	}) as unknown as Response;

beforeEach(() => {
	global.fetch = jest.fn();
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
});

test('does not treat a failed recovery response as a resumable run', async () => {
	(fetch as jest.Mock).mockResolvedValue(response({}, 401));
	await expect(loadRinspaceAgentRun('run-1', 'project-1')).rejects.toThrow(
		'Agent run recovery failed (401)',
	);
});
