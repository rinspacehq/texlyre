// SPDX-License-Identifier: AGPL-3.0-or-later
import { webcrypto } from 'node:crypto';

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

const mockFiles = {
	getCurrentProjectId: jest.fn(() => 'project-1'),
	getAllFiles: jest.fn(async () => [mainFile, binaryFile, privateFile]),
	getFile: jest.fn(async (id: string) =>
		[mainFile, binaryFile, privateFile].find((file) => file.id === id),
	),
	getFileByPath: jest.fn(async (path: string) =>
		[mainFile, binaryFile, privateFile].find((file) => file.path === path),
	),
};
const mockSearch = jest.fn(async () => [{ fileId: mainFile.id }]);
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
jest.mock('@/services/SearchService', () => ({
	SearchService: jest.fn().mockImplementation(() => ({ search: mockSearch })),
}));
jest.mock('@/services/GitService', () => ({ gitService: mockGit }));

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
	if (!globalThis.crypto?.subtle) {
		Object.defineProperty(globalThis, 'crypto', { configurable: true, value: webcrypto });
	}
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
