// SPDX-License-Identifier: AGPL-3.0-or-later
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import RinspaceAgentPanel from '@extras/agents/rinspace/RinspaceAgentPanel';
import type { HostContext } from '@src/workspace/contracts';

const mockCreate = jest.fn();
const mockLoadConfig = jest.fn();
const mockLoadState = jest.fn();

jest.mock('@rinspacehq/cline-embed/ui', () => ({
	AgentApprovalCard: () => <div data-testid='approval' />,
	AgentMessageList: () => <div data-testid='messages' />,
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
		restore: jest.fn(),
	},
	loadRinspaceAgentConfig: (...args: unknown[]) => mockLoadConfig(...args),
	loadRinspaceAgentRun: jest.fn(),
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
