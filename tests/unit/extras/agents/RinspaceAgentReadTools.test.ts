// SPDX-License-Identifier: AGPL-3.0-or-later
import { createHash, webcrypto } from 'node:crypto';

import type { AgentTool } from '@rinspacehq/cline-embed';

const mainFile = {
	id: 'file-main',
	name: 'main.tex',
	path: '/main.tex',
	type: 'file' as const,
	documentId: 'document-main',
	content: 'stale content',
	lastModified: 1,
	size: 13,
};
const binaryFile = {
	id: 'file-image',
	name: 'figure.png',
	path: '/figure.png',
	type: 'file' as const,
	content: new ArrayBuffer(4),
	lastModified: 1,
	size: 4,
	isBinary: true,
};
const privateFile = {
	id: 'file-git',
	name: 'config',
	path: '/.git/config',
	type: 'file' as const,
	content: 'secret metadata',
	lastModified: 1,
	size: 15,
};
const plainFile = {
	id: 'file-plain',
	name: 'notes.md',
	path: '/notes.md',
	type: 'file' as const,
	content: 'plain text',
	lastModified: 1,
	size: 10,
};

const mockFiles = {
	getCurrentProjectId: jest.fn(() => 'project-1'),
	getAllFiles: jest.fn(async () => [mainFile, binaryFile, privateFile, plainFile]),
	getFile: jest.fn(async (id: string) =>
		[mainFile, binaryFile, privateFile, plainFile].find((file) => file.id === id),
	),
	getFileByPath: jest.fn(async (path: string) =>
		[mainFile, binaryFile, privateFile, plainFile].find((file) => file.path === path),
	),
	updateFileContentIfUnchanged: jest.fn(async () => ({ status: 'updated', file: mainFile })),
	createTextFileIfAbsent: jest.fn(async (file: typeof mainFile) => ({
		status: 'created',
		file,
	})),
	moveTextFileIfUnchanged: jest.fn(async (
		_id: string,
		_expectedPath: string,
		_expectedContent: string,
		targetPath: string,
	) => ({
		status: 'updated',
		file: { ...mainFile, path: targetPath, name: targetPath.split('/').at(-1) },
	})),
	deleteTextFileIfUnchanged: jest.fn(async () => ({
		status: 'updated',
		file: { ...mainFile, isDeleted: true },
	})),
	restoreTextFileIfDeleted: jest.fn(async () => ({
		status: 'updated',
		file: mainFile,
	})),
};
const mockSearch = jest.fn(async () => [{ fileId: mainFile.id }]);
let liveMainContent = 'Hello 琳\nalpha beta';
const mockUpdateDocumentContent = jest.fn(async (
	_projectId: string,
	_documentId: string,
	updater: (content: string) => string,
) => {
	const next = updater(liveMainContent);
	liveMainContent = next;
	return next;
});
const mockGit = {
	isInitialized: jest.fn(async () => false),
	getCurrentBranch: jest.fn(async () => 'main'),
	getHeadOid: jest.fn(async () => null),
	getWorktreeBaseOid: jest.fn(async () => null),
	getChanges: jest.fn(async (): Promise<Array<{
		path: string;
		type: 'added' | 'modified' | 'deleted';
	}>> => []),
	getWorktreeChanges: jest.fn(async (): Promise<Array<{
		path: string;
		type: 'added' | 'modified' | 'deleted';
	}>> => []),
	compareFile: jest.fn(async () => null),
};
const mockCreateGitCommit = jest.fn(async () => 'commit-agent');
const mockCompileProject = jest.fn(async () => ({
	compilerId: 'internal:latex',
	mainFile: '/main.tex',
	status: 'success' as const,
	error: null,
	log: 'Compilation succeeded',
	outputBytes: 2048,
}));
const pushPreview = {
	providerId: 'rinspace-gitea',
	providerName: 'Rinspace Gitea',
	repositoryId: 'owner/repo',
	repositoryLabel: 'owner/repo',
	localBranch: 'main',
	remoteBranch: 'main',
	localHead: 'commit-agent',
	remoteHead: 'remote-base',
	commits: [{ oid: 'commit-agent', subject: 'Agent edit' }],
};
const mockPrepareGitPush = jest.fn(async () => pushPreview);
const mockPushGitCommits = jest.fn(async () => ({
	providerName: 'Rinspace Gitea',
	repositoryLabel: 'owner/repo',
	localBranch: 'main',
	remoteBranch: 'main',
	previousLocalOid: 'commit-agent',
	canonicalOid: 'commit-agent',
	pushedCommits: 1,
}));

jest.mock('@/services/FileStoreService', () => ({ fileStoreService: mockFiles }));
jest.mock('@/services/CollabService', () => ({
	collabService: {
		readDocumentContent: jest.fn(async () => liveMainContent),
		updateDocumentContent: mockUpdateDocumentContent,
	},
}));
jest.mock('@/services/SearchService', () => ({
	SearchService: jest.fn().mockImplementation(() => ({ search: mockSearch })),
}));
jest.mock('@/services/GitService', () => ({ gitService: mockGit }));
jest.mock('@rinspacehq/cline-embed', () => ({
	createTool: (definition: unknown) => definition,
}));

import {
	createRinspaceAgentTools,
	normalizeAgentProjectPath,
	type RinspaceAgentToolHost,
} from '@extras/agents/rinspace/RinspaceAgentTools';

interface SuccessResponse {
	ok: true;
	files?: Array<{ path: string; content: string; contentSha256: string }>;
	results?: Array<{ path: string; matches: Array<{ line: number }> }>;
	sources?: Array<{ id: string; diagnostics: Array<{ path?: string }> }>;
}

interface ErrorResponse {
	ok: false;
	error: { code: string };
}

const host: RinspaceAgentToolHost = {
	projectId: 'project-1',
	runId: 'run-1',
	isActive: () => true,
	getDocuments: () => [
		{ id: 'document-main', name: 'main.tex', content: liveMainContent },
	],
	getDiagnostics: () => [
		{
			id: 'latex',
			status: 'error',
			error: 'Compilation failed',
			log: '! LaTeX Error: Broken input.\nl.2 alpha beta',
		},
	],
	renameLinkedDocument: () => true,
	deleteLinkedDocument: () => true,
	compileProject: mockCompileProject,
	createGitCommit: mockCreateGitCommit,
	prepareGitPush: mockPrepareGitPush,
	pushGitCommits: mockPushGitCommits,
};

const context = {
	agentId: 'agent-1',
	iteration: 1,
	sessionId: host.runId,
	conversationId: host.runId,
};

function tool(name: string): AgentTool {
	const found = createRinspaceAgentTools(host).tools.find((candidate) => candidate.name === name);
	if (!found) throw new Error(`Missing tool ${name}`);
	return found;
}

beforeAll(() => {
	Object.defineProperty(globalThis, 'crypto', {
		configurable: true,
		value: webcrypto,
	});
});

beforeEach(() => {
	jest.clearAllMocks();
	liveMainContent = 'Hello 琳\nalpha beta';
	mockFiles.getCurrentProjectId.mockReturnValue('project-1');
	mockGit.isInitialized.mockResolvedValue(false);
	mockGit.getChanges.mockResolvedValue([]);
	mockGit.getWorktreeChanges.mockResolvedValue([]);
});

test('normalizes only project-relative paths and closes the automatic tool set', () => {
	expect(normalizeAgentProjectPath('chapters/一.tex')).toBe('chapters/一.tex');
	for (const path of ['../other/main.tex', '/etc/passwd', 'C:\\secret', 'a//b']) {
		expect(normalizeAgentProjectPath(path)).toMatchObject({
			ok: false,
			error: { code: 'path_forbidden' },
		});
	}
	const toolSet = createRinspaceAgentTools(host);
	expect(toolSet.tools.map((item) => item.name)).toEqual([
		'list_project_files',
		'read_project_files',
		'search_project',
		'read_compile_diagnostics',
		'git_status',
		'compile_project',
		'apply_project_patch',
		'create_project_file',
		'rename_project_file',
		'delete_project_file',
		'create_git_commit',
		'push_git_commits',
	]);
	expect(toolSet.policies.create_git_commit).toEqual({ enabled: true, autoApprove: true });
	expect(toolSet.policies.push_git_commits).toEqual({ enabled: true, autoApprove: false });
});

test('runs the configured compiler automatically and rate limits repeated calls', async () => {
	const compile = tool('compile_project');
	const first = await compile.execute({}, context);
	expect(first).toMatchObject({
		ok: true,
		compilerId: 'internal:latex',
		mainFile: '/main.tex',
		status: 'success',
		log: 'Compilation succeeded',
		logTruncated: false,
	});
	expect(mockCompileProject).toHaveBeenCalledTimes(1);

	const sameToolSet = createRinspaceAgentTools(host);
	const sameCompile = sameToolSet.tools.find((item) => item.name === 'compile_project');
	if (!sameCompile) throw new Error('Missing compile_project');
	await sameCompile.execute({}, context);
	const limited = await sameCompile.execute({}, context);
	expect(limited).toMatchObject({ ok: false, error: { code: 'busy' } });
});

test('creates local commits automatically and rewrites every Push into a fresh approval preview', async () => {
	const committed = await tool('create_git_commit').execute(
		{ message: 'Agent edit' },
		context,
	);
	expect(committed).toMatchObject({ ok: true, commitOid: 'commit-agent' });
	expect(mockCreateGitCommit).toHaveBeenCalledWith('Agent edit');

	const toolSet = createRinspaceAgentTools(host);
	const push = toolSet.tools.find((item) => item.name === 'push_git_commits');
	if (!push) throw new Error('Missing push_git_commits');
	const prepared = await toolSet.beforeTool({
		snapshot: {},
		tool: push,
		toolCall: { toolCallId: 'push-1', toolName: push.name, input: {} },
		input: {},
	} as never);
	expect(prepared).toEqual({
		input: pushPreview,
		policy: { enabled: true, autoApprove: false },
	});
	expect(mockPrepareGitPush).toHaveBeenCalledTimes(1);

	const pushed = await push.execute(prepared?.input, context);
	expect(pushed).toMatchObject({ ok: true, pushedCommits: 1 });
	expect(mockPushGitCommits).toHaveBeenCalledWith(pushPreview);
});

test('reads the live Y.Text projection with a content identity and rejects binary/private paths', async () => {
	const read = tool('read_project_files');
	const result = (await read.execute(
		{ files: [{ path: 'main.tex' }] },
		context,
	)) as SuccessResponse;
	expect(result.ok).toBe(true);
	expect(result.files?.[0]).toMatchObject({
		path: 'main.tex',
		content: 'Hello 琳\nalpha beta',
	});
	expect(result.files?.[0]?.contentSha256).toMatch(/^[0-9a-f]{64}$/);

	for (const path of [
		'figure.png',
		'.git/config',
		'vendor/dependency/.git/config',
		'vendor/dependency/.svn/entries',
	]) {
		const rejected = (await read.execute(
			{ files: [{ path }] },
			context,
		)) as ErrorResponse;
		expect(rejected.ok).toBe(false);
		expect(rejected.error.code).toMatch(/not_text|path_forbidden/);
	}
});

test('search recomputes indexed matches from the current document and returns file identity', async () => {
	const result = (await tool('search_project').execute(
		{ query: 'alpha', maxResults: 10 },
		context,
	)) as SuccessResponse;
	expect(result.ok).toBe(true);
	expect(result.results).toEqual([
		expect.objectContaining({
			path: 'main.tex',
			matches: [expect.objectContaining({ line: 2 })],
		}),
	]);
	expect(mockSearch).toHaveBeenCalledWith(
		'alpha',
		expect.objectContaining({ useRegex: false, includeContent: true }),
	);
});

test('search applies Unicode whole-word boundaries to the live document', async () => {
	const search = tool('search_project');
	const result = (await search.execute(
		{ query: '琳', wholeWord: true, maxResults: 10 },
		context,
	)) as SuccessResponse;
	expect(result.ok).toBe(true);
	expect(result.results).toEqual([
		expect.objectContaining({
			path: 'main.tex',
			matches: [expect.objectContaining({ line: 1, column: 7 })],
		}),
	]);
	expect(mockSearch).toHaveBeenLastCalledWith(
		'琳',
		expect.objectContaining({
			caseSensitive: false,
			wholeWord: false,
			useRegex: false,
		}),
	);

	liveMainContent = '琳琅满目';
	const adjacent = (await search.execute(
		{ query: '琳', wholeWord: true, maxResults: 10 },
		context,
	)) as SuccessResponse;
	expect(adjacent).toMatchObject({ ok: true, results: [] });
});

test('applies a baseline-bound patch through one host Yjs transaction', async () => {
	const before = 'Hello 琳\nalpha beta';
	const baseline = createHash('sha256').update(before).digest('hex');
	const result = (await tool('apply_project_patch').execute(
		{
			path: 'main.tex',
			expectedSha256: baseline,
			edits: [{
				startLine: 2,
				startColumn: 1,
				endLine: 2,
				endColumn: 6,
				replacement: 'gamma',
			}],
		},
		{ ...context, toolCallId: 'tool-call-1' },
	)) as Record<string, unknown>;
	expect(result).toMatchObject({
		ok: true,
		path: 'main.tex',
		beforeSha256: baseline,
		transactionOrigin: 'run-1:tool-call-1',
	});
	expect(mockUpdateDocumentContent).toHaveBeenCalledWith(
		'project-1',
		'document-main',
		expect.any(Function),
		expect.objectContaining({
			edits: [{ from: 8, to: 13, insert: 'gamma' }],
			origin: expect.objectContaining({ source: 'rinspace-agent' }),
		}),
	);
	expect(mockFiles.updateFileContentIfUnchanged).toHaveBeenCalledWith(
		'file-main',
		'stale content',
		'Hello 琳\ngamma beta',
	);
});

test('returns a conflict without applying stale Agent edits after a collaborator update', async () => {
	mockUpdateDocumentContent.mockImplementationOnce(async (
		_projectId: string,
		_documentId: string,
		updater: (content: string) => string,
	) => updater('Hello 琳\n协作者的新内容'));
	const before = 'Hello 琳\nalpha beta';
	const baseline = createHash('sha256').update(before).digest('hex');
	const result = (await tool('apply_project_patch').execute(
		{
			path: 'main.tex',
			expectedSha256: baseline,
			edits: [{
				startLine: 2,
				startColumn: 1,
				endLine: 2,
				endColumn: 6,
				replacement: 'stale-agent-edit',
			}],
		},
		{ ...context, toolCallId: 'tool-call-conflict' },
	)) as ErrorResponse;
	expect(result).toMatchObject({
		ok: false,
		error: { code: 'conflict' },
	});
});

test('applies an unlinked-file patch through atomic FileStore baseline validation', async () => {
	const baseline = createHash('sha256').update(plainFile.content).digest('hex');
	const result = (await tool('apply_project_patch').execute(
		{
			path: 'notes.md',
			expectedSha256: baseline,
			edits: [{
				startLine: 1,
				startColumn: 1,
				endLine: 1,
				endColumn: 6,
				replacement: 'fresh',
			}],
		},
		{ ...context, toolCallId: 'tool-call-plain' },
	)) as Record<string, unknown>;
	expect(result).toMatchObject({ ok: true, path: 'notes.md' });
	expect(mockFiles.updateFileContentIfUnchanged).toHaveBeenCalledWith(
		'file-plain',
		'plain text',
		'fresh text',
	);
});

test('creates, renames and recoverably deletes only explicit project files', async () => {
	const created = (await tool('create_project_file').execute(
		{ path: 'chapters/new.tex', content: '新章节 $x^2$' },
		{ ...context, toolCallId: 'create-1' },
	)) as Record<string, unknown>;
	expect(created).toMatchObject({ ok: true, path: 'chapters/new.tex' });
	expect(mockFiles.createTextFileIfAbsent).toHaveBeenCalledWith(
		expect.objectContaining({ path: '/chapters/new.tex', isBinary: false }),
	);

	const baseline = createHash('sha256')
		.update('Hello 琳\nalpha beta')
		.digest('hex');
	const renamed = (await tool('rename_project_file').execute(
		{ path: 'main.tex', newPath: 'renamed.tex', expectedSha256: baseline },
		{ ...context, toolCallId: 'rename-1' },
	)) as Record<string, unknown>;
	expect(renamed).toMatchObject({
		ok: true,
		oldPath: 'main.tex',
		path: 'renamed.tex',
	});
	expect(mockFiles.moveTextFileIfUnchanged).toHaveBeenCalledWith(
		'file-main',
		'/main.tex',
		'Hello 琳\nalpha beta',
		'/renamed.tex',
	);

	const deleted = (await tool('delete_project_file').execute(
		{ path: 'main.tex', expectedSha256: baseline },
		{ ...context, toolCallId: 'delete-1' },
	)) as Record<string, unknown>;
	expect(deleted).toMatchObject({ ok: true, path: 'main.tex' });
	expect(mockFiles.deleteTextFileIfUnchanged).toHaveBeenCalledWith(
		'file-main',
		'/main.tex',
		'Hello 琳\nalpha beta',
	);
});

test('fails structure edits closed when live content cannot be synchronized', async () => {
	mockFiles.updateFileContentIfUnchanged.mockResolvedValueOnce({
		status: 'conflict',
		file: mainFile,
	});
	const baseline = createHash('sha256')
		.update('Hello 琳\nalpha beta')
		.digest('hex');

	await expect(tool('rename_project_file').execute(
		{ path: 'main.tex', newPath: 'renamed.tex', expectedSha256: baseline },
		{ ...context, toolCallId: 'rename-storage-conflict' },
	)).resolves.toMatchObject({
		ok: false,
		error: { code: 'conflict' },
	});
	expect(mockFiles.moveTextFileIfUnchanged).not.toHaveBeenCalled();
});

test('rejects write targets that the project file UI cannot represent safely', async () => {
	for (const path of ['CON.tex', 'parts/trailing-space /chapter.tex', 'bad:name.tex']) {
		await expect(tool('create_project_file').execute(
			{ path, content: 'unsafe target' },
			{ ...context, toolCallId: `create-${path}` },
		)).resolves.toMatchObject({
			ok: false,
			error: { code: 'path_forbidden' },
		});
	}
	expect(mockFiles.createTextFileIfAbsent).not.toHaveBeenCalled();

	const baseline = createHash('sha256')
		.update('Hello 琳\nalpha beta')
		.digest('hex');
	await expect(tool('rename_project_file').execute(
		{ path: 'main.tex', newPath: 'chapters/PRN', expectedSha256: baseline },
		{ ...context, toolCallId: 'rename-invalid' },
	)).resolves.toMatchObject({
		ok: false,
		error: { code: 'path_forbidden' },
	});
	expect(mockFiles.moveTextFileIfUnchanged).not.toHaveBeenCalled();
});

test('compensates the browser structure transaction when linked metadata changed', async () => {
	const baseline = createHash('sha256')
		.update('Hello 琳\nalpha beta')
		.digest('hex');
	const changedHost: RinspaceAgentToolHost = {
		...host,
		renameLinkedDocument: () => false,
		deleteLinkedDocument: () => false,
	};
	const changedTools = createRinspaceAgentTools(changedHost).tools;
	const rename = changedTools.find((item) => item.name === 'rename_project_file');
	const remove = changedTools.find((item) => item.name === 'delete_project_file');
	if (!rename || !remove) throw new Error('Missing structure tools');

	await expect(rename.execute(
		{ path: 'main.tex', newPath: 'parts/renamed.tex', expectedSha256: baseline },
		{ ...context, toolCallId: 'rename-conflict' },
	)).resolves.toMatchObject({
		ok: false,
		error: { code: 'workspace_changed', message: expect.stringContaining('rolled back') },
	});
	expect(mockFiles.moveTextFileIfUnchanged).toHaveBeenNthCalledWith(
		2,
		'file-main',
		'/parts/renamed.tex',
		'Hello 琳\nalpha beta',
		'/main.tex',
	);

	await expect(remove.execute(
		{ path: 'main.tex', expectedSha256: baseline },
		{ ...context, toolCallId: 'delete-conflict' },
	)).resolves.toMatchObject({
		ok: false,
		error: { code: 'workspace_changed', message: expect.stringContaining('rolled back') },
	});
	expect(mockFiles.restoreTextFileIfDeleted).toHaveBeenCalledWith(
		'file-main',
		'/main.tex',
		'Hello 琳\nalpha beta',
	);
});

test('diagnostics resolve only current project files and Git status stays project-bound', async () => {
	const diagnostics = (await tool('read_compile_diagnostics').execute(
		{},
		context,
	)) as SuccessResponse;
	expect(diagnostics.sources?.[0]).toMatchObject({
		id: 'latex',
		diagnostics: [expect.objectContaining({ path: 'main.tex' })],
	});

	const git = (await tool('git_status').execute({}, context)) as Record<string, unknown>;
	expect(git).toMatchObject({ ok: true, initialized: false, projectId: 'project-1' });
});

test('Git status bounds the union of visible changes and supports path narrowing', async () => {
	mockGit.isInitialized.mockResolvedValue(true);
	mockGit.getChanges.mockResolvedValue([
		{ path: 'main.tex', type: 'modified' },
		{ path: 'chapters/一.tex', type: 'added' },
		{ path: '.git/config', type: 'modified' },
	]);
	mockGit.getWorktreeChanges.mockResolvedValue([
		{ path: 'main.tex', type: 'modified' },
		{ path: 'assets/references.bib', type: 'added' },
	]);

	const git = tool('git_status');
	await expect(git.execute(
		{ includeComparisons: false, maxChanges: 1 },
		context,
	)).resolves.toMatchObject({
		ok: false,
		error: {
			code: 'limit_exceeded',
			limit: 1,
			actual: 3,
			retry: { path: 'narrower/directory', includeComparisons: false },
		},
	});

	await expect(git.execute(
		{ path: 'chapters', includeComparisons: false, maxChanges: 1 },
		context,
	)).resolves.toMatchObject({
		ok: true,
		changes: [{ path: 'chapters/一.tex', type: 'added' }],
		worktreeChanges: [],
		comparisons: [],
	});
});

test('every tool fails closed after a project switch', async () => {
	mockFiles.getCurrentProjectId.mockReturnValue('project-2');
	for (const item of createRinspaceAgentTools(host).tools) {
		const result = (await item.execute({}, context)) as ErrorResponse;
		expect(result).toMatchObject({
			ok: false,
			error: { code: 'workspace_changed' },
		});
	}
});
