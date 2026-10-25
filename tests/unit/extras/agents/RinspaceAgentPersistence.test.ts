// SPDX-License-Identifier: AGPL-3.0-or-later
import type { AgentMessage } from '@rinspacehq/cline-embed';

import {
	clearAgentState,
	loadAgentState,
	saveAgentState,
	settledAgentMessages,
} from '@extras/agents/rinspace/RinspaceAgentPersistence';

const usage = {
	inputTokens: 10,
	outputTokens: 4,
	cacheReadTokens: 2,
	cacheWriteTokens: 1,
	totalCost: 0.03,
};

const message = (
	id: string,
	role: AgentMessage['role'],
	content: AgentMessage['content'],
): AgentMessage => ({ id, role, content, createdAt: 1 });

beforeEach(() => sessionStorage.clear());
afterEach(() => jest.restoreAllMocks());

test('persists recoverable messages and usage only within one actor and project', () => {
	const messages = [
		message('user-1', 'user', [{ type: 'text', text: '修改正文' }]),
	];
	saveAgentState('actor-a', 'project-a', {
		version: 1,
		runId: 'run-a',
		messages,
		usage,
		savedAt: 12,
	});

	expect(loadAgentState('actor-a', 'project-a')).toEqual({
		version: 1,
		runId: 'run-a',
		messages,
		usage,
		savedAt: 12,
	});
	expect(loadAgentState('actor-b', 'project-a')).toBeNull();
	expect(loadAgentState('actor-a', 'project-b')).toBeNull();

	clearAgentState('actor-a', 'project-a');
	expect(loadAgentState('actor-a', 'project-a')).toBeNull();
});

test('uses collision-safe actor and project partitions', () => {
	const first = [message('first', 'user', [{ type: 'text', text: 'first' }])];
	const second = [message('second', 'user', [{ type: 'text', text: 'second' }])];
	saveAgentState('actor:a', 'project', {
		version: 1,
		runId: 'run-first',
		messages: first,
		usage,
		savedAt: 1,
	});
	saveAgentState('actor', 'a:project', {
		version: 1,
		runId: 'run-second',
		messages: second,
		usage,
		savedAt: 2,
	});

	expect(loadAgentState('actor:a', 'project')?.runId).toBe('run-first');
	expect(loadAgentState('actor', 'a:project')?.runId).toBe('run-second');
});

test('never restores an unresolved tool call or stale Push approval', () => {
	const messages = [
		message('assistant-pending', 'assistant', [
			{ type: 'text', text: '准备推送' },
			{
				type: 'tool-call',
				toolCallId: 'push-pending',
				toolName: 'push_git_commits',
				input: { remoteHead: 'old' },
			},
		]),
		message('assistant-settled', 'assistant', [
			{
				type: 'tool-call',
				toolCallId: 'read-settled',
				toolName: 'read_project_files',
				input: { files: [{ path: 'main.tex' }] },
			},
		]),
		message('tool-settled', 'tool', [
			{
				type: 'tool-result',
				toolCallId: 'read-settled',
				toolName: 'read_project_files',
				output: { ok: true },
			},
		]),
	];

	const settled = settledAgentMessages(messages, ['push-pending']);
	expect(settled[0]?.content).toEqual([{ type: 'text', text: '准备推送' }]);
	expect(JSON.stringify(settled)).not.toContain('push-pending');
	expect(JSON.stringify(settled)).toContain('read-settled');
});

test('migrates the previous message-only state with zero usage', () => {
	sessionStorage.setItem(
		'rinspace-agent:actor-a:project-a',
		JSON.stringify({
			runId: 'legacy-run',
			messages: [message('legacy', 'user', [{ type: 'text', text: '继续' }])],
			savedAt: 2,
		}),
	);

	expect(loadAgentState('actor-a', 'project-a')).toMatchObject({
		version: 1,
		runId: 'legacy-run',
		usage: {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
	});
});

test('rejects malformed or oversized state without evicting unrelated browser data', () => {
	sessionStorage.setItem('unrelated-draft', 'keep');
	sessionStorage.setItem(
		'rinspace-agent:actor-a:project-a',
		JSON.stringify({ runId: 'run-a', messages: [], usage: { inputTokens: -1 } }),
	);
	expect(loadAgentState('actor-a', 'project-a')).toBeNull();

	saveAgentState('actor-a', 'project-b', {
		version: 1,
		runId: 'run-big',
		messages: [
			message('large', 'user', [{ type: 'text', text: 'x'.repeat(300 * 1024) }]),
		],
		usage,
		savedAt: 3,
	});
	expect(loadAgentState('actor-a', 'project-b')).toBeNull();
	expect(sessionStorage.getItem('unrelated-draft')).toBe('keep');
});

test('rejects unknown versions, malformed parts and cross-role tool content', () => {
	const storageKey = 'rinspace-agent:actor-a:project-a';
	const state = (overrides: Record<string, unknown>) => ({
		version: 1,
		runId: 'run-a',
		messages: [message('user', 'user', [{ type: 'text', text: '继续' }])],
		usage,
		savedAt: 1,
		...overrides,
	});

	for (const candidate of [
		state({ version: 2 }),
		state({ usage: { ...usage, reasoningTokenCount: -1 } }),
		state({
			messages: [message('oversized-call', 'assistant', [{
				type: 'tool-call',
				toolCallId: `call-${'x'.repeat(124)}`,
				toolName: 'read_project_files',
				input: {},
			}])],
		}),
		state({
			messages: [message('unknown-tool', 'assistant', [{
				type: 'tool-call',
				toolCallId: 'call-1',
				toolName: 'shell',
				input: {},
			}])],
		}),
		state({
			messages: [message('invalid-input', 'assistant', [{
				type: 'tool-call',
				toolCallId: 'call-1',
				toolName: 'read_project_files',
				input: [],
			}])],
		}),
		state({
			messages: [message('orphan-result', 'tool', [{
				type: 'tool-result',
				toolCallId: 'call-1',
				toolName: 'read_project_files',
				output: {},
			}])],
		}),
		state({
			messages: [
				message('call', 'assistant', [{
					type: 'tool-call',
					toolCallId: 'call-1',
					toolName: 'read_project_files',
					input: {},
				}]),
				message('mismatched-result', 'tool', [{
					type: 'tool-result',
					toolCallId: 'call-1',
					toolName: 'git_status',
					output: {},
				}]),
			],
		}),
		state({
			messages: [{
				id: 'unknown-part',
				role: 'assistant',
				createdAt: 1,
				content: [{ type: 'media', media: { url: 'https://example.invalid' } }],
			}],
		}),
		state({
			messages: [{
				id: 'wrong-role',
				role: 'user',
				createdAt: 1,
				content: [{
					type: 'tool-call',
					toolCallId: 'call-1',
					toolName: 'read_project_files',
					input: {},
				}],
			}],
		}),
		state({
			messages: [{
				id: 'invalid-result',
				role: 'tool',
				createdAt: 1,
				content: [{
					type: 'tool-result',
					toolCallId: '',
					toolName: 'read_project_files',
					output: {},
				}],
			}],
		}),
	]) {
		sessionStorage.setItem(storageKey, JSON.stringify(candidate));
		expect(loadAgentState('actor-a', 'project-a')).toBeNull();
	}
});

test('does not throw when a tool result is cyclic or browser storage fails', () => {
	const cyclic: Record<string, unknown> = {};
	cyclic.self = cyclic;
	const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
		throw new DOMException('full', 'QuotaExceededError');
	});

	expect(() =>
		saveAgentState('actor-a', 'project-a', {
			version: 1,
			runId: 'run-cyclic',
			messages: [
				message('tool', 'tool', [
					{
						type: 'tool-result',
						toolCallId: 'call-1',
						toolName: 'read_project_files',
						output: cyclic,
					},
				]),
			],
			usage,
			savedAt: 4,
		}),
	).not.toThrow();
	expect(setItem).not.toHaveBeenCalled();

	const safeState = {
		version: 1 as const,
		runId: 'run-safe',
		messages: [message('safe', 'user', [{ type: 'text' as const, text: 'safe' }])],
		usage,
		savedAt: 5,
	};
	expect(() => saveAgentState('actor-a', 'project-a', safeState)).not.toThrow();
	expect(setItem).toHaveBeenCalledTimes(1);
});
