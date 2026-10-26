// SPDX-License-Identifier: AGPL-3.0-or-later
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';

import RinspaceAgentPanel from '@extras/agents/rinspace/RinspaceAgentPanel';
import { clearAgentState } from '@extras/agents/rinspace/RinspaceAgentPersistence';
import type { HostContext } from '@src/workspace/contracts';

const mockCreate = jest.fn();
const mockLoadConfig = jest.fn();
const mockLoadRun = jest.fn();
const mockLoadState = jest.fn();
const mockRestore = jest.fn();

jest.mock('@rinspacehq/cline-embed/ui', () => ({
	AgentApprovalCard: () => <div data-testid='approval' />,
	AgentDiffFile: ({
		path,
		additions,
		deletions,
		children,
	}: {
		path: string;
		additions: number;
		deletions: number;
		children: ReactNode;
	}) => (
		<div data-testid='diff-file' data-path={path} data-additions={additions} data-deletions={deletions}>
			{children}
		</div>
	),
	AgentMessageList: ({
		messages,
	}: {
		messages: Array<{ id: string; content: ReactNode }>;
	}) => (
		<div data-testid='messages'>
			{messages.map((message) => <div key={message.id}>{message.content}</div>)}
		</div>
	),
	AgentToolView: ({
		label,
		status,
		children,
	}: {
		label: ReactNode;
		status: string;
		children: ReactNode;
	}) => <div data-testid='tool-card' data-status={status}>{label}{children}</div>,
}));

jest.mock('@src/components/common/Icons', () => ({
	ChevronDownIcon: () => <span />,
	ChevronUpIcon: () => <span />,
}));

jest.mock('@src/hooks/useCollab', () => ({
	useCollab: () => ({
		data: { documents: [], projectMetadata: { type: 'latex', mainFile: 'main.tex' } },
		changeData: jest.fn(),
	}),
}));

const mockCompiler = {
	isCompiling: false,
	compileError: null,
	logIndicator: 'idle',
	compileLog: '',
	compiledPdf: null,
	compiledCanvas: null,
	compiledOutput: null,
	compileDocument: jest.fn(),
};

jest.mock('@src/hooks/useLaTeX', () => ({ useLaTeX: () => mockCompiler }));
jest.mock('@src/hooks/useTypst', () => ({ useTypst: () => mockCompiler }));
jest.mock('@src/hooks/useExternalTypesetter', () => ({
	useExternalTypesetter: () => mockCompiler,
}));
jest.mock('@src/hooks/useSecrets', () => ({ useSecrets: () => ({}) }));
jest.mock('@src/hooks/useSettings', () => ({
	useSettings: () => ({ getSetting: jest.fn() }),
}));

jest.mock('@src/services/CollabService', () => ({
	collabService: { readDocumentContent: jest.fn() },
}));
jest.mock('@src/services/FileStoreService', () => ({
	fileStoreService: { getFileByPath: jest.fn() },
}));
jest.mock('@src/services/GitService', () => ({
	gitService: { commit: jest.fn() },
}));
jest.mock('@src/services/GitSyncService', () => ({
	gitSyncService: { preparePush: jest.fn(), push: jest.fn() },
}));
jest.mock('@src/services/TypesetterRegistryService', () => ({
	typesetterRegistryService: { get: jest.fn(), resolve: jest.fn() },
}));

jest.mock('@extras/agents/rinspace/RinspaceAgentPersistence', () => ({
	clearAgentState: jest.fn(),
	loadAgentState: (...args: unknown[]) => mockLoadState(...args),
	saveAgentState: jest.fn(),
	settledAgentMessages: (messages: unknown) => messages,
}));

jest.mock('@extras/agents/rinspace/RinspaceAgentRuntime', () => ({
	RinspaceAgentController: {
		create: (...args: unknown[]) => mockCreate(...args),
		restore: (...args: unknown[]) => mockRestore(...args),
	},
	isRinspaceAgentRunResumable: (status: string) =>
		status === 'ACTIVE' || status === 'RECOVERY_REQUIRED',
	reconcileRinspaceAgentMessages: (messages: unknown) => messages,
	loadRinspaceAgentConfig: (...args: unknown[]) => mockLoadConfig(...args),
	loadRinspaceAgentRun: (...args: unknown[]) => mockLoadRun(...args),
}));

jest.mock('@extras/agents/rinspace/RinspaceAgentTheme', () => ({
	rinspaceAgentTheme: {},
}));

const context: Extract<HostContext, { mode: 'managed' }> = {
	mode: 'managed',
	identity: { actorId: 'actor-1', permissionEpoch: 'epoch-1' },
	binding: {
		repositoryId: 'repo-1',
		branchBindingId: 'branch-1',
		ref: 'refs/heads/main',
		workspaceId: 'workspace-1',
		generation: 1,
		baseCommit: 'a'.repeat(40),
		objectFormat: 'sha1',
	},
	capabilities: ['read-source', 'write-source'],
};

beforeEach(() => {
	jest.clearAllMocks();
	mockLoadState.mockReturnValue(null);
	mockLoadRun.mockResolvedValue({ billing: null });
	mockLoadConfig.mockResolvedValue({
		enabled: true,
		model: 'deepseek-test',
		maxIterations: 8,
		maxOutputTokens: 4096,
		maxGoodness: 100,
	});
});

test('single-flights run creation and rejects a controller returned after Stop', async () => {
	let resolveCreate: ((controller: unknown) => void) | undefined;
	mockCreate.mockImplementation(
		() => new Promise((resolve) => {
			resolveCreate = resolve;
		}),
	);
	const lateController = {
		runId: 'run-late',
		run: jest.fn(),
		abort: jest.fn(),
		subscribe: jest.fn(() => jest.fn()),
	};
	render(
		<RinspaceAgentPanel context={context} projectId='project-1' />,
	);
	const composer = screen.getByPlaceholderText('让琳阅读、修改、编译或提交当前项目…');
	await waitFor(() => expect(composer).toBeEnabled());
	fireEvent.change(composer, { target: { value: '继续修改' } });
	const send = screen.getByRole('button', { name: '发送' });
	fireEvent.click(send);
	fireEvent.click(send);

	expect(mockCreate).toHaveBeenCalledTimes(1);
	const signal = mockCreate.mock.calls[0]?.[5] as AbortSignal;
	expect(signal.aborted).toBe(false);
	fireEvent.click(screen.getByRole('button', { name: '停止' }));
	expect(signal.aborted).toBe(true);

	await act(async () => {
		resolveCreate?.(lateController);
		await Promise.resolve();
	});
	expect(lateController.abort).toHaveBeenCalledTimes(1);
	expect(lateController.run).not.toHaveBeenCalled();
});

test('aborts pending run creation when the ownership-scoped panel unmounts', async () => {
	let resolveCreate: ((controller: unknown) => void) | undefined;
	mockCreate.mockImplementation(
		() => new Promise((resolve) => {
			resolveCreate = resolve;
		}),
	);
	const lateController = {
		runId: 'run-after-unmount',
		run: jest.fn(),
		abort: jest.fn(),
		subscribe: jest.fn(() => jest.fn()),
	};
	const { unmount } = render(
		<RinspaceAgentPanel context={context} projectId='project-1' />,
	);
	const composer = screen.getByPlaceholderText('让琳阅读、修改、编译或提交当前项目…');
	await waitFor(() => expect(composer).toBeEnabled());
	fireEvent.change(composer, { target: { value: '继续修改' } });
	fireEvent.click(screen.getByRole('button', { name: '发送' }));
	const signal = mockCreate.mock.calls[0]?.[5] as AbortSignal;

	unmount();
	expect(signal.aborted).toBe(true);
	await act(async () => {
		resolveCreate?.(lateController);
		await Promise.resolve();
	});
	expect(lateController.abort).toHaveBeenCalledTimes(1);
	expect(lateController.run).not.toHaveBeenCalled();
});

test('detaches on page unload without aborting the durable run', async () => {
	const controller = {
		runId: 'run-refresh',
		run: jest.fn(async () => undefined),
		abort: jest.fn(),
		detach: jest.fn(),
		subscribe: jest.fn(() => jest.fn()),
	};
	mockCreate.mockResolvedValue(controller);
	const { unmount } = render(
		<RinspaceAgentPanel context={context} projectId='project-1' />,
	);
	const composer = screen.getByPlaceholderText('让琳阅读、修改、编译或提交当前项目…');
	await waitFor(() => expect(composer).toBeEnabled());
	fireEvent.change(composer, { target: { value: '刷新后继续' } });
	fireEvent.click(screen.getByRole('button', { name: '发送' }));
	await waitFor(() => expect(controller.run).toHaveBeenCalled());

	fireEvent(window, new Event('pagehide'));
	unmount();

	expect(controller.detach).toHaveBeenCalledTimes(1);
	expect(controller.abort).not.toHaveBeenCalled();
});

test('aborts a durable run on an ordinary ownership teardown', async () => {
	const controller = {
		runId: 'run-switch',
		run: jest.fn(async () => undefined),
		abort: jest.fn(),
		detach: jest.fn(),
		subscribe: jest.fn(() => jest.fn()),
	};
	mockCreate.mockResolvedValue(controller);
	const { unmount } = render(
		<RinspaceAgentPanel context={context} projectId='project-1' />,
	);
	const composer = screen.getByPlaceholderText('让琳阅读、修改、编译或提交当前项目…');
	await waitFor(() => expect(composer).toBeEnabled());
	fireEvent.change(composer, { target: { value: '切换前任务' } });
	fireEvent.click(screen.getByRole('button', { name: '发送' }));
	await waitFor(() => expect(controller.run).toHaveBeenCalled());

	unmount();

	expect(controller.abort).toHaveBeenCalledTimes(1);
	expect(controller.detach).not.toHaveBeenCalled();
});

test('retains a terminal run for bill recovery without restoring it as writable', async () => {
	mockLoadState.mockReturnValue({
		version: 1,
		runId: 'run-finished',
		messages: [],
		usage: {
			inputTokens: 1,
			outputTokens: 1,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
		savedAt: 1,
	});
	mockLoadRun.mockResolvedValue({
		id: 'run-finished',
		projectId: 'project-1',
		status: 'ABORTED',
		billing: {
			model: 'model-1', providerPriceVersion: 'price-1', currency: 'CNY', pendingTurns: 0,
			providerCostCnyMicros: '20', goodnessChargedSg: '1', goodnessRevenueCnyMicros: '500', profitCnyMicros: '480',
			turns: [{ iteration: 1, operationId: 'operation-1', requestId: 'receipt-1', receiptSha256: 'a'.repeat(64),
				inputTokens: 7, cachedInputTokens: 2, outputTokens: 3,
				providerCostCnyMicros: '20', goodnessChargedSg: '1', goodnessRevenueCnyMicros: '500', profitCnyMicros: '480' }],
		},
		usage: {
			inputTokens: 1,
			outputTokens: 1,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
	});

	render(<RinspaceAgentPanel context={context} projectId='project-1' />);

	await waitFor(() => expect(screen.getByText('上一项琳任务已结束，请开始新任务')).toBeInTheDocument());
	expect(clearAgentState).not.toHaveBeenCalled();
	expect(screen.getByText('已结算 1 善功 · 1 回合')).toBeInTheDocument();
	expect(screen.getByText('回执 receipt-1')).toBeInTheDocument();
	expect(mockRestore).not.toHaveBeenCalled();
	expect(screen.getByText('上一项琳任务已结束，请开始新任务')).toBeInTheDocument();
});

test('single-flights recovery across repeated renders', async () => {
	mockLoadState.mockReturnValue({
		version: 1,
		runId: 'run-recovering',
		messages: [],
		usage: {
			inputTokens: 1,
			outputTokens: 1,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		},
		savedAt: 1,
	});
	let resolveRun: ((run: unknown) => void) | undefined;
	mockLoadRun.mockImplementation(
		() => new Promise((resolve) => {
			resolveRun = resolve;
		}),
	);
	const restored = {
		runId: 'run-recovering',
		run: jest.fn(),
		abort: jest.fn(),
		detach: jest.fn(),
		subscribe: jest.fn(() => jest.fn()),
	};
	mockRestore.mockReturnValue(restored);
	const { rerender } = render(
		<RinspaceAgentPanel context={context} projectId='project-1' />,
	);
	await waitFor(() => expect(mockLoadRun).toHaveBeenCalledTimes(1));

	rerender(<RinspaceAgentPanel context={{ ...context }} projectId='project-1' />);
	rerender(<RinspaceAgentPanel context={{ ...context }} projectId='project-1' />);
	expect(mockLoadRun).toHaveBeenCalledTimes(1);

	await act(async () => {
		resolveRun?.({
			id: 'run-recovering',
			projectId: 'project-1',
			status: 'ACTIVE',
			confirmedTurns: [],
			usage: {
				inputTokens: 1,
				outputTokens: 1,
				cacheReadTokens: 0,
				cacheWriteTokens: 0,
			},
		});
		await Promise.resolve();
	});
	expect(mockRestore).toHaveBeenCalledTimes(1);
});

test('does not submit Enter while an input method composition is active', async () => {
	const controller = {
		runId: 'run-ime',
		run: jest.fn(async () => undefined),
		abort: jest.fn(),
		subscribe: jest.fn(() => jest.fn()),
	};
	mockCreate.mockResolvedValue(controller);
	render(<RinspaceAgentPanel context={context} projectId='project-1' />);
	const composer = screen.getByPlaceholderText('让琳阅读、修改、编译或提交当前项目…');
	await waitFor(() => expect(composer).toBeEnabled());
	fireEvent.change(composer, { target: { value: '输入中文' } });
	fireEvent.compositionStart(composer);
	fireEvent.keyDown(composer, { key: 'Enter', keyCode: 229, isComposing: true });
	expect(mockCreate).not.toHaveBeenCalled();
	expect(composer).toHaveValue('输入中文');

	fireEvent.compositionEnd(composer);
	fireEvent.keyDown(composer, { key: 'Enter', keyCode: 13 });
	await waitFor(() => expect(controller.run).toHaveBeenCalledWith('输入中文'));
	expect(mockCreate).toHaveBeenCalledTimes(1);
});

test('renders Cline tool cards and bounded project diff cards', async () => {
	let listener: ((view: unknown) => void) | undefined;
	const controller = {
		runId: 'run-cards',
		run: jest.fn(async () => undefined),
		abort: jest.fn(),
		subscribe: jest.fn((next: (view: unknown) => void) => {
			listener = next;
			return jest.fn();
		}),
	};
	mockCreate.mockResolvedValue(controller);
	render(<RinspaceAgentPanel context={context} projectId='project-1' />);
	const composer = screen.getByPlaceholderText('让琳阅读、修改、编译或提交当前项目…');
	await waitFor(() => expect(composer).toBeEnabled());
	expect(composer.closest('.rinspace-agent')).toHaveClass('rinspace-cline-embed');
	fireEvent.change(composer, { target: { value: '检查修改' } });
	fireEvent.click(screen.getByRole('button', { name: '发送' }));
	await waitFor(() => expect(controller.subscribe).toHaveBeenCalled());

	act(() => {
		listener?.({
			pendingApproval: null,
			snapshot: {
				agentId: 'agent-1',
				status: 'completed',
				iteration: 1,
				pendingToolCalls: [],
				usage: {
					inputTokens: 8,
					outputTokens: 5,
					cacheReadTokens: 0,
					cacheWriteTokens: 0,
				},
				messages: [
					{
						id: 'assistant-call',
						role: 'assistant',
						createdAt: 1,
						content: [{
							type: 'tool-call',
							toolCallId: 'call-1',
							toolName: 'git_status',
							input: { includeComparisons: true },
						}],
					},
					{
						id: 'tool-result',
						role: 'tool',
						createdAt: 2,
						content: [{
							type: 'tool-result',
							toolCallId: 'call-1',
							toolName: 'git_status',
							output: {
								ok: true,
								comparisons: [{
									path: 'main.tex',
									before: '旧标题\n正文',
									after: '新标题\n正文',
								}],
							},
						}],
					},
				],
			},
		});
	});

	expect(screen.getAllByTestId('tool-card')).toHaveLength(2);
	expect(screen.getByText('检查 Git 状态')).toBeInTheDocument();
	expect(screen.getByText('检查 Git 状态完成')).toBeInTheDocument();
	const diff = screen.getByTestId('diff-file');
	expect(diff).toHaveAttribute('data-path', 'main.tex');
	expect(diff).toHaveAttribute('data-additions', '1');
	expect(diff).toHaveAttribute('data-deletions', '1');
	expect(diff).toHaveTextContent('旧标题');
	expect(diff).toHaveTextContent('新标题');
});

test.each([
	['连续三次工具操作失败，任务已停止。请检查错误后再继续。', '连续三次工具操作失败，任务已停止。请检查错误后再继续。'],
	['Agent runtime exceeded maxIterations (24)', '已达到本任务的最大回合数，请检查结果后开始新任务。'],
])('shows the stopped runtime reason: %s', async (lastError, expected) => {
	let listener: ((view: unknown) => void) | undefined;
	const controller = {
		runId: 'run-failed', run: jest.fn(async () => undefined), abort: jest.fn(),
		subscribe: jest.fn((next: (view: unknown) => void) => { listener = next; return jest.fn(); }),
	};
	mockCreate.mockResolvedValue(controller);
	render(<RinspaceAgentPanel context={context} projectId='project-1' />);
	const composer = screen.getByPlaceholderText('让琳阅读、修改、编译或提交当前项目…');
	await waitFor(() => expect(composer).toBeEnabled());
	fireEvent.change(composer, { target: { value: '修改项目' } });
	fireEvent.click(screen.getByRole('button', { name: '发送' }));
	await waitFor(() => expect(controller.subscribe).toHaveBeenCalled());
	act(() => listener?.({ pendingApproval: null, snapshot: {
		agentId: 'agent-1', status: 'failed', iteration: 24, pendingToolCalls: [], messages: [], lastError,
		usage: { inputTokens: 10, outputTokens: 2, cacheReadTokens: 0, cacheWriteTokens: 0 },
	} }));
	expect(await screen.findByText(expected)).toHaveAttribute('data-tone', 'error');
});
