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
	storeFile: jest.fn(async (file: { id: string }) => file.id),
	createDirectoryPath: jest.fn(async () => undefined),
	batchMoveFiles: jest.fn(async () => ['file-renamed']),
	deleteFile: jest.fn(async () => undefined),
};
const mockSearch = jest.fn(async () => [{ fileId: mainFile.id }]);
const mockUpdateDocumentContent = jest.fn(async (
	_projectId: string,
	_documentId: string,
	updater: (content: string) => string,
) => updater('Hello 琳\nalpha beta'));
const mockGit = {
	isInitialized: jest.fn(async () => false),
	getCurrentBranch: jest.fn(async () => 'main'),
	getHeadOid: jest.fn(async () => null),
	getWorktreeBaseOid: jest.fn(async () => null),
	getChanges: jest.fn(async () => []),
	getWorktreeChanges: jest.fn(async () => []),
	compareFile: jest.fn(async () => null),
};

jest.mock('@/services/FileStoreService', () => ({ fileStoreService: mockFiles }));
jest.mock('@/services/CollabService', () => ({
	collabService: { updateDocumentContent: mockUpdateDocumentContent },
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
		{ id: 'document-main', name: 'main.tex', content: 'Hello 琳\nalpha beta' },
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
	mockFiles.getCurrentProjectId.mockReturnValue('project-1');
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
		'apply_project_patch',
		'create_project_file',
		'rename_project_file',
		'delete_project_file',
	]);
	expect(Object.values(toolSet.policies)).toEqual(
		expect.arrayContaining([
			expect.objectContaining({ enabled: true, autoApprove: true }),
		]),
	);
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

	for (const path of ['figure.png', '.git/config']) {
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
	expect(mockFiles.createDirectoryPath).toHaveBeenCalledWith('/chapters/new.tex');
	expect(mockFiles.storeFile).toHaveBeenCalledWith(
		expect.objectContaining({ path: '/chapters/new.tex', isBinary: false }),
		{ showConflictDialog: false },
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
	expect(mockFiles.batchMoveFiles).toHaveBeenCalledWith(
		[{ fileId: 'file-main', targetPath: '/renamed.tex' }],
		{ showConflictDialog: false },
	);

	const deleted = (await tool('delete_project_file').execute(
		{ path: 'main.tex', expectedSha256: baseline },
		{ ...context, toolCallId: 'delete-1' },
	)) as Record<string, unknown>;
	expect(deleted).toMatchObject({ ok: true, path: 'main.tex' });
	expect(mockFiles.deleteFile).toHaveBeenCalledWith('file-main', {
		showDeleteDialog: false,
		hardDelete: false,
		allowLinkedFileDelete: true,
	});
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
