// SPDX-License-Identifier: AGPL-3.0-or-later
import { nanoid } from 'nanoid';
import {
	createTool,
	type AgentBeforeToolContext,
	type AgentBeforeToolResult,
	type AgentTool,
	type AgentToolContext,
	type ToolPolicy,
} from '@rinspacehq/cline-embed';

import { parseLatexLog } from '../../loggers/latex_visualizer/parser';
import { parseTypstLog } from '../../loggers/typst_visualizer/parser';
import { collabService } from '@/services/CollabService';
import {
	applyDocumentTextEdits,
	HostDocumentEditOrigin,
	type DocumentTextEdit,
} from '@/services/DocumentTextEdits';
import { fileStoreService } from '@/services/FileStoreService';
import { gitService } from '@/services/GitService';
import type {
	GitPushPreview,
	GitPushSummary,
} from '@/services/GitSyncService';
import { SearchService } from '@/services/SearchService';
import type { Document } from '@/types/documents';
import {
	getMimeType,
	isBinaryFile,
	isTemporaryFile,
	validateFileName,
} from '@/utils/fileUtils';

const LIMITS = {
	list: 200,
	readFiles: 16,
	fileBytes: 512 * 1024,
	readBytes: 768 * 1024,
	indexFiles: 2000,
	searchMatches: 100,
	diagnostics: 100,
	gitChanges: 100,
	comparisonBytes: 32 * 1024,
	patchEdits: 64,
	compileLogBytes: 128 * 1024,
	compileIntervalMs: 1500,
	outputBytes: 1024 * 1024,
} as const;

const generatedSuffixes = [
	'.aux',
	'.bbl',
	'.bcf',
	'.fdb_latexmk',
	'.fls',
	'.log',
	'.out',
	'.run.xml',
	'.synctex',
	'.synctex.gz',
	'.toc',
];

export interface RinspaceAgentDiagnosticSource {
	id: 'latex' | 'typst' | 'markdown' | 'external';
	status: 'idle' | 'running' | 'success' | 'error';
	error: string | null;
	log: string;
}

export interface RinspaceAgentCompileResult {
	compilerId: string;
	mainFile: string;
	status: 'success' | 'error';
	error: string | null;
	log: string;
	outputBytes?: number;
}

export interface RinspaceAgentToolHost {
	projectId: string;
	runId: string;
	isActive: () => boolean;
	getDocuments: () => readonly Document[];
	getDiagnostics: () => readonly RinspaceAgentDiagnosticSource[];
	renameLinkedDocument: (
		documentId: string,
		expectedPath: string,
		path: string,
		origin: unknown,
	) => boolean;
	deleteLinkedDocument: (
		documentId: string,
		expectedPath: string,
		origin: unknown,
	) => boolean;
	compileProject: () => Promise<RinspaceAgentCompileResult>;
	createGitCommit: (message: string) => Promise<string>;
	prepareGitPush: () => Promise<GitPushPreview>;
	pushGitCommits: (preview: GitPushPreview) => Promise<GitPushSummary>;
}

export interface RinspaceAgentToolSet {
	tools: readonly AgentTool[];
	policies: Readonly<Record<string, Readonly<ToolPolicy>>>;
	beforeTool: (
		context: AgentBeforeToolContext,
	) => Promise<AgentBeforeToolResult | undefined>;
}

interface ToolError {
	ok: false;
	error: {
		code: 'invalid_input' | 'workspace_changed' | 'path_forbidden' | 'not_found' | 'not_text' | 'limit_exceeded' | 'conflict' | 'busy';
		message: string;
		limit?: number;
		actual?: number;
		retry?: Record<string, unknown>;
	};
}

interface TextRecord {
	fileId: string;
	path: string;
	content: string;
	storedContent: string;
	contentSha256: string;
	bytes: number;
	totalLines: number;
	documentId?: string;
}

const agentSearchService = new SearchService();

interface ToolDependencies {
	files: Pick<typeof fileStoreService, 'getCurrentProjectId' | 'getAllFiles' | 'getFile' | 'getFileByPath' | 'updateFileContentIfUnchanged' | 'createTextFileIfAbsent' | 'moveTextFileIfUnchanged' | 'deleteTextFileIfUnchanged' | 'restoreTextFileIfDeleted'>;
	collab: Pick<typeof collabService, 'readDocumentContent' | 'updateDocumentContent'>;
	search: Pick<SearchService, 'search'>;
	git: Pick<typeof gitService, 'isInitialized' | 'getCurrentBranch' | 'getHeadOid' | 'getWorktreeBaseOid' | 'getChanges' | 'getWorktreeChanges' | 'compareFile'>;
}

const dependencies: ToolDependencies = {
	files: fileStoreService,
	collab: collabService,
	search: agentSearchService,
	git: gitService,
};

function failure(
	code: ToolError['error']['code'],
	message: string,
	extra: Omit<ToolError['error'], 'code' | 'message'> = {},
): ToolError {
	return { ok: false, error: { code, message, ...extra } };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedInteger(
	value: unknown,
	fallback: number,
	minimum: number,
	maximum: number,
): number | null {
	if (value === undefined) return fallback;
	return Number.isSafeInteger(value) && Number(value) >= minimum && Number(value) <= maximum
		? Number(value)
		: null;
}

const byteLength = (value: string) => new TextEncoder().encode(value).byteLength;

function boundedText(value: string, limit: number): {
	text: string;
	bytes: number;
	truncated: boolean;
} {
	const encoded = new TextEncoder().encode(value);
	if (encoded.byteLength <= limit) {
		return { text: value, bytes: encoded.byteLength, truncated: false };
	}
	const text = new TextDecoder('utf-8', { fatal: false })
		.decode(encoded.subarray(0, limit))
		.replace(/\uFFFD$/, '');
	return { text, bytes: encoded.byteLength, truncated: true };
}

async function sha256(value: string | ArrayBuffer): Promise<string> {
	const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : new Uint8Array(value);
	const digest = await crypto.subtle.digest('SHA-256', bytes);
	return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

const isControlCharacter = (character: string): boolean => {
	const code = character.charCodeAt(0);
	return code <= 31 || code === 127;
};

export function normalizeAgentProjectPath(value: unknown): string | ToolError {
	if (typeof value !== 'string' || !value || byteLength(value) > 1024) {
		return failure('invalid_input', 'A project-relative path of at most 1024 bytes is required');
	}
	if (value.startsWith('/') || value.includes('\\') || /^[A-Za-z]:/.test(value) || Array.from(value).some(isControlCharacter)) {
		return failure('path_forbidden', 'Absolute, platform and control-character paths are forbidden');
	}
	const parts = value.split('/');
	if (parts.some((part) => !part || part === '.' || part === '..')) {
		return failure('path_forbidden', 'Path traversal and empty segments are forbidden');
	}
	return parts.join('/');
}

const relativePath = (path: string) => path.replace(/^\/+/, '');

function pathIsPrivate(path: string): boolean {
	const storePath = `/${path}`;
	const lower = path.toLowerCase();
	const base = lower.split('/').at(-1) ?? '';
	return (
		isTemporaryFile(storePath) ||
		base === '.ds_store' ||
		generatedSuffixes.some((suffix) => base.endsWith(suffix)) ||
		lower
			.split('/')
			.some((part) =>
				['.cache', '.git', '.svn', '.texlyre', 'node_modules'].includes(part),
			)
	);
}

function writablePathError(path: string): ToolError | null {
	const invalid = path
		.split('/')
		.find((part) => part !== part.trim() || !validateFileName(part).valid);
	return invalid
		? failure(
			'path_forbidden',
			`Agent write target contains an invalid file name segment: ${invalid}`,
		)
		: null;
}

function activeError(host: RinspaceAgentToolHost, context?: AgentToolContext): ToolError | null {
	if (
		!host.isActive() ||
		dependencies.files.getCurrentProjectId() !== host.projectId ||
		(context?.sessionId !== undefined && context.sessionId !== host.runId) ||
		(context?.conversationId !== undefined && context.conversationId !== host.runId)
	) {
		return failure('workspace_changed', 'The task no longer owns the active managed project; start a new task');
	}
	return null;
}

function decodeText(content: string | ArrayBuffer): string | ToolError {
	if (typeof content === 'string') return content;
	try {
		return new TextDecoder('utf-8', { fatal: true }).decode(content);
	} catch {
		return failure('not_text', 'File bytes are not valid UTF-8 text');
	}
}

async function readText(path: string, host: RinspaceAgentToolHost): Promise<TextRecord | ToolError> {
	const inactive = activeError(host);
	if (inactive) return inactive;
	if (pathIsPrivate(path)) return failure('path_forbidden', `Private metadata or cache path is forbidden: ${path}`);
	const metadata = await dependencies.files.getFileByPath(`/${path}`, false);
	const changedAfterMetadata = activeError(host);
	if (changedAfterMetadata) return changedAfterMetadata;
	if (!metadata || metadata.type !== 'file') return failure('not_found', `Project file does not exist: ${path}`);
	if (metadata.isBinary || isBinaryFile(metadata.path)) return failure('not_text', `Binary file is not readable: ${path}`);
	const stored = await dependencies.files.getFile(metadata.id);
	const changedAfterContent = activeError(host);
	if (changedAfterContent) return changedAfterContent;
	if (!stored || stored.content === undefined) return failure('not_found', `File content is unavailable: ${path}`);
	const storedContent = decodeText(stored.content);
	if (typeof storedContent !== 'string') return storedContent;
	const live = metadata.documentId
		? await dependencies.collab.readDocumentContent(host.projectId, metadata.documentId)
		: undefined;
	const changedAfterLiveRead = activeError(host);
	if (changedAfterLiveRead) return changedAfterLiveRead;
	const decoded = live ?? storedContent;
	const bytes = byteLength(decoded);
	if (bytes > LIMITS.fileBytes) {
		return failure('limit_exceeded', `File exceeds the Agent text limit: ${path}`, {
			limit: LIMITS.fileBytes,
			actual: bytes,
			retry: { action: 'exclude_file', path },
		});
	}
	return {
		fileId: metadata.id,
		path,
		content: decoded,
		storedContent,
		contentSha256: await sha256(decoded),
		bytes,
		totalLines: decoded.split('\n').length,
		documentId: metadata.documentId,
	};
}

async function synchronizeStoredText(
	record: TextRecord,
	host: RinspaceAgentToolHost,
): Promise<string | ToolError> {
	if (record.storedContent === record.content) return record.content;
	const synchronized = await dependencies.files.updateFileContentIfUnchanged(
		record.fileId,
		record.storedContent,
		record.content,
	);
	const changed = activeError(host);
	if (changed) return changed;
	if (synchronized.status === 'updated') return record.content;

	const latest = await dependencies.files.getFile(record.fileId);
	const changedAfterRead = activeError(host);
	if (changedAfterRead) return changedAfterRead;
	const latestContent = latest?.content === undefined
		? null
		: decodeText(latest.content);
	if (latestContent === record.content) return record.content;
	return failure(
		'conflict',
		`Stored content changed before the file structure update: ${record.path}`,
		{ retry: { action: 'read_project_files', path: record.path } },
	);
}

function bound<T extends object>(value: T, retry: Record<string, unknown>): T | ToolError {
	const actual = byteLength(JSON.stringify(value));
	return actual <= LIMITS.outputBytes
		? value
		: failure('limit_exceeded', 'Tool output exceeds the response limit', {
			limit: LIMITS.outputBytes,
			actual,
			retry,
		});
}

function listTool(host: RinspaceAgentToolHost): AgentTool {
	return createTool({
		name: 'list_project_files',
		description: 'List bounded metadata from the active project FileStore.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			properties: {
				path: { type: 'string', maxLength: 1024 },
				offset: { type: 'integer', minimum: 0 },
				limit: { type: 'integer', minimum: 1, maximum: LIMITS.list },
			},
		},
		executionMode: 'parallel',
		retryable: false,
		execute: async (input: unknown, context) => {
			const inactive = activeError(host, context);
			if (inactive) return inactive;
			if (!isRecord(input)) return failure('invalid_input', 'Input must be an object');
			const offset = boundedInteger(input.offset, 0, 0, Number.MAX_SAFE_INTEGER);
			const limit = boundedInteger(input.limit, 100, 1, LIMITS.list);
			if (offset === null || limit === null) return failure('invalid_input', 'Invalid offset or limit');
			let prefix = '';
			if (input.path !== undefined && input.path !== '') {
				const normalized = normalizeAgentProjectPath(input.path);
				if (typeof normalized !== 'string') return normalized;
				if (pathIsPrivate(normalized)) return failure('path_forbidden', `Private path is forbidden: ${normalized}`);
				prefix = normalized;
			}
			const visible = (await dependencies.files.getAllFiles(false, false, false))
				.map((node) => ({ node, path: relativePath(node.path) }))
				.filter(({ path }) => path && !pathIsPrivate(path))
				.filter(({ path }) => !prefix || path === prefix || path.startsWith(`${prefix}/`))
				.sort((left, right) => left.path.localeCompare(right.path));
			const changed = activeError(host);
			if (changed) return changed;
			const entries = visible.slice(offset, offset + limit).map(({ node, path }) => ({
				fileId: node.id,
				path,
				type: node.type,
				size: node.size ?? null,
				lastModified: node.lastModified,
			}));
			return bound({
				ok: true,
				projectId: host.projectId,
				entries,
				total: visible.length,
				nextOffset: offset + entries.length < visible.length ? offset + entries.length : null,
			}, { path: prefix || undefined, offset, limit: Math.max(1, Math.floor(limit / 2)) });
		},
	});
}

function readTool(host: RinspaceAgentToolHost): AgentTool {
	return createTool({
		name: 'read_project_files',
		description: 'Read bounded UTF-8 files from the current FileStore/Y.Text view with SHA-256 baselines.',
		inputSchema: {
			type: 'object', additionalProperties: false, required: ['files'],
			properties: {
				files: {
					type: 'array', minItems: 1, maxItems: LIMITS.readFiles,
					items: {
						type: 'object', additionalProperties: false, required: ['path'],
						properties: {
							path: { type: 'string', maxLength: 1024 },
							startLine: { type: 'integer', minimum: 1 },
							endLine: { type: 'integer', minimum: 1 },
						},
					},
				},
			},
		},
		executionMode: 'parallel',
		retryable: false,
		execute: async (input: unknown, context) => {
			const inactive = activeError(host, context);
			if (inactive) return inactive;
			if (!isRecord(input) || !Array.isArray(input.files) || input.files.length < 1 || input.files.length > LIMITS.readFiles) {
				return failure('invalid_input', `files must contain 1-${LIMITS.readFiles} requests`);
			}
			const requests = input.files;
			const files = [];
			let returnedBytes = 0;
			for (const request of requests) {
				if (!isRecord(request)) return failure('invalid_input', 'Every file request must be an object');
				const path = normalizeAgentProjectPath(request.path);
				if (typeof path !== 'string') return path;
				const startLine = boundedInteger(request.startLine, 1, 1, Number.MAX_SAFE_INTEGER);
				const requestedEnd = request.endLine === undefined
					? undefined
					: boundedInteger(request.endLine, 1, 1, Number.MAX_SAFE_INTEGER);
				if (startLine === null || requestedEnd === null || (requestedEnd !== undefined && requestedEnd < startLine)) {
					return failure('invalid_input', `Invalid line range for ${path}`);
				}
				const record = await readText(path, host);
				if (!('content' in record)) return record;
				const lines = record.content.split('\n');
				const endLine = Math.min(requestedEnd ?? lines.length, lines.length);
				const content = lines.slice(startLine - 1, endLine).join('\n');
				returnedBytes += byteLength(content);
				if (returnedBytes > LIMITS.readBytes) {
					return failure('limit_exceeded', 'Combined read exceeds the response limit', {
						limit: LIMITS.readBytes,
						actual: returnedBytes,
						retry: { files: [{ path, startLine, endLine: Math.max(startLine, Math.floor(endLine / 2)) }] },
					});
				}
				files.push({
					fileId: record.fileId,
					path,
					contentSha256: record.contentSha256,
					bytes: record.bytes,
					totalLines: record.totalLines,
					startLine,
					endLine,
					content,
				});
			}
			return bound({ ok: true, projectId: host.projectId, files }, { files: requests.slice(0, 1) });
		},
	});
}

function textPositionOffset(
	content: string,
	lineValue: unknown,
	columnValue: unknown,
): number | null {
	if (
		!Number.isSafeInteger(lineValue) ||
		!Number.isSafeInteger(columnValue) ||
		Number(lineValue) < 1 ||
		Number(columnValue) < 1
	) {
		return null;
	}
	const line = Number(lineValue);
	const column = Number(columnValue);
	let currentLine = 1;
	let start = 0;
	while (currentLine < line) {
		const newline = content.indexOf('\n', start);
		if (newline < 0) return null;
		start = newline + 1;
		currentLine += 1;
	}
	const newline = content.indexOf('\n', start);
	const rawEnd = newline < 0 ? content.length : newline;
	const end = rawEnd > start && content[rawEnd - 1] === '\r' ? rawEnd - 1 : rawEnd;
	return column - 1 <= end - start ? start + column - 1 : null;
}

function patchTool(host: RinspaceAgentToolHost): AgentTool {
	return createTool({
		name: 'apply_project_patch',
		description: 'Apply bounded text edits to one current-project file using a required SHA-256 baseline and one host transaction.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['path', 'expectedSha256', 'edits'],
			properties: {
				path: { type: 'string', minLength: 1, maxLength: 1024 },
				expectedSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
				edits: {
					type: 'array',
					minItems: 1,
					maxItems: LIMITS.patchEdits,
					items: {
						type: 'object',
						additionalProperties: false,
						required: ['startLine', 'startColumn', 'endLine', 'endColumn', 'replacement'],
						properties: {
							startLine: { type: 'integer', minimum: 1 },
							startColumn: { type: 'integer', minimum: 1 },
							endLine: { type: 'integer', minimum: 1 },
							endColumn: { type: 'integer', minimum: 1 },
							replacement: { type: 'string', maxLength: LIMITS.fileBytes },
						},
					},
				},
			},
		},
		executionMode: 'sequential',
		retryable: false,
		execute: async (input: unknown, context) => {
			const inactive = activeError(host, context);
			if (inactive) return inactive;
			if (
				!isRecord(input) ||
				typeof input.expectedSha256 !== 'string' ||
				!/^[0-9a-f]{64}$/.test(input.expectedSha256) ||
				!Array.isArray(input.edits) ||
				input.edits.length < 1 ||
				input.edits.length > LIMITS.patchEdits
			) {
				return failure('invalid_input', 'A path, lowercase SHA-256 baseline and bounded edits are required');
			}
			const path = normalizeAgentProjectPath(input.path);
			if (typeof path !== 'string') return path;
			const record = await readText(path, host);
			if (!('content' in record)) return record;
			if (record.contentSha256 !== input.expectedSha256) {
				return failure('conflict', 'File content changed after the Agent read it; read the file again before editing', {
					retry: { action: 'read_project_files', path, actualSha256: record.contentSha256 },
				});
			}
			const edits: DocumentTextEdit[] = [];
			for (const candidate of input.edits) {
				if (!isRecord(candidate) || typeof candidate.replacement !== 'string') {
					return failure('invalid_input', 'Every text edit requires positions and replacement text');
				}
				const from = textPositionOffset(record.content, candidate.startLine, candidate.startColumn);
				const to = textPositionOffset(record.content, candidate.endLine, candidate.endColumn);
				if (from === null || to === null || to < from) {
					return failure('invalid_input', `Invalid text range for ${path}`);
				}
				edits.push({ from, to, insert: candidate.replacement });
			}
			let nextContent: string;
			try {
				nextContent = applyDocumentTextEdits(record.content, edits);
			} catch (reason) {
				return failure('invalid_input', reason instanceof Error ? reason.message : 'Invalid text edits');
			}
			const nextBytes = byteLength(nextContent);
			if (nextBytes > LIMITS.fileBytes) {
				return failure('limit_exceeded', 'Patched file exceeds the Agent text limit', {
					limit: LIMITS.fileBytes,
					actual: nextBytes,
					retry: { action: 'apply_smaller_patch', path },
				});
			}
			const changed = activeError(host, context);
			if (changed) return changed;
			const origin = new HostDocumentEditOrigin(
				'rinspace-agent',
				`${host.runId}:${context.toolCallId}`,
			);
			if (record.documentId) {
				let baselineChanged = false;
				try {
					await dependencies.collab.updateDocumentContent(
						host.projectId,
						record.documentId,
						(currentContent) => {
							if (currentContent !== record.content) {
								baselineChanged = true;
								throw new Error('Agent edit baseline changed');
							}
							return nextContent;
						},
						{ edits, origin },
					);
				} catch (reason) {
					if (!baselineChanged) throw reason;
					return failure('conflict', 'Collaborative content changed before the patch transaction; read it again', {
						retry: { action: 'read_project_files', path },
					});
				}
				const current = await readText(path, host);
				if (!('content' in current)) return current;
				if (current.content !== nextContent) {
					return failure('conflict', 'Collaborative content changed after the Agent transaction; read it again', {
						retry: { action: 'read_project_files', path, actualSha256: current.contentSha256 },
					});
				}
				const persisted = await dependencies.files.updateFileContentIfUnchanged(
					record.fileId,
					record.storedContent,
					nextContent,
				);
				if (persisted.status !== 'updated') {
					const latest = await dependencies.files.getFile(record.fileId);
					const latestContent = latest?.content === undefined
						? null
						: decodeText(latest.content);
					if (latestContent !== nextContent) {
						return failure('conflict', 'Browser persistence changed after the Agent transaction; read it again', {
							retry: { action: 'read_project_files', path },
						});
					}
				}
			} else {
				const update = await dependencies.files.updateFileContentIfUnchanged(
					record.fileId,
					record.content,
					nextContent,
				);
				if (update.status !== 'updated') {
					return failure('conflict', 'Stored file content changed before the patch write; read it again', {
						retry: { action: 'read_project_files', path },
					});
				}
			}
			return bound({
				ok: true,
				projectId: host.projectId,
				fileId: record.fileId,
				path,
				beforeSha256: record.contentSha256,
				afterSha256: await sha256(nextContent),
				bytes: nextBytes,
				transactionOrigin: origin.operationId,
			}, { action: 'read_project_files', path });
		},
	});
}

function createFileTool(host: RinspaceAgentToolHost): AgentTool {
	return createTool({
		name: 'create_project_file',
		description: 'Create one bounded UTF-8 text file in the active project without overwriting an existing path.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['path', 'content'],
			properties: {
				path: { type: 'string', minLength: 1, maxLength: 1024 },
				content: { type: 'string', maxLength: LIMITS.fileBytes },
			},
		},
		executionMode: 'sequential',
		retryable: false,
		execute: async (input: unknown, context) => {
			const inactive = activeError(host, context);
			if (inactive) return inactive;
			if (!isRecord(input) || typeof input.content !== 'string') {
				return failure('invalid_input', 'A project-relative path and UTF-8 content are required');
			}
			const path = normalizeAgentProjectPath(input.path);
			if (typeof path !== 'string') return path;
			const invalidPath = writablePathError(path);
			if (invalidPath) return invalidPath;
			if (pathIsPrivate(path) || isBinaryFile(path)) {
				return failure('path_forbidden', `Private, generated or binary file path is forbidden: ${path}`);
			}
			const bytes = byteLength(input.content);
			if (bytes > LIMITS.fileBytes) {
				return failure('limit_exceeded', 'New file exceeds the Agent text limit', {
					limit: LIMITS.fileBytes,
					actual: bytes,
					retry: { action: 'create_smaller_file', path },
				});
			}
			const existing = await dependencies.files.getFileByPath(`/${path}`, true);
			const changed = activeError(host, context);
			if (changed) return changed;
			if (existing && !existing.isDeleted) {
				return failure('conflict', `A project entry already exists at ${path}`, {
					retry: { action: 'choose_another_path', path },
				});
			}
			const created = await dependencies.files.createTextFileIfAbsent({
				id: existing?.id ?? nanoid(),
				name: path.split('/').at(-1) ?? path,
				path: `/${path}`,
				type: 'file',
				content: input.content,
				isBinary: false,
				mimeType: getMimeType(path),
				lastModified: Date.now(),
			});
			if (created.status !== 'created') {
				return failure('conflict', `A project entry was created at ${path} before the Agent write`, {
					retry: { action: 'choose_another_path', path },
				});
			}
			return {
				ok: true,
				projectId: host.projectId,
				fileId: created.file.id,
				path,
				contentSha256: await sha256(input.content),
				bytes,
			};
		},
	});
}

function renameFileTool(host: RinspaceAgentToolHost): AgentTool {
	return createTool({
		name: 'rename_project_file',
		description: 'Rename one baseline-bound current-project text file without replacing an existing path.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['path', 'newPath', 'expectedSha256'],
			properties: {
				path: { type: 'string', minLength: 1, maxLength: 1024 },
				newPath: { type: 'string', minLength: 1, maxLength: 1024 },
				expectedSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
			},
		},
		executionMode: 'sequential',
		retryable: false,
		execute: async (input: unknown, context) => {
			const inactive = activeError(host, context);
			if (inactive) return inactive;
			if (!isRecord(input) || typeof input.expectedSha256 !== 'string') {
				return failure('invalid_input', 'Old path, new path and SHA-256 baseline are required');
			}
			const path = normalizeAgentProjectPath(input.path);
			if (typeof path !== 'string') return path;
			const newPath = normalizeAgentProjectPath(input.newPath);
			if (typeof newPath !== 'string') return newPath;
			const invalidNewPath = writablePathError(newPath);
			if (invalidNewPath) return invalidNewPath;
			if (path === newPath || pathIsPrivate(newPath) || isBinaryFile(newPath)) {
				return failure('path_forbidden', 'Rename target must be a distinct visible text-file path');
			}
			const record = await readText(path, host);
			if (!('content' in record)) return record;
			if (record.contentSha256 !== input.expectedSha256) {
				return failure('conflict', 'File content changed before rename; read it again', {
					retry: { action: 'read_project_files', path, actualSha256: record.contentSha256 },
				});
			}
			const existing = await dependencies.files.getFileByPath(`/${newPath}`, false);
			const changed = activeError(host, context);
			if (changed) return changed;
			if (existing) {
				return failure('conflict', `Rename target already exists: ${newPath}`, {
					retry: { action: 'choose_another_path', path: newPath },
				});
			}
			const confirmation = await readText(path, host);
			if (!('content' in confirmation)) return confirmation;
			if (confirmation.contentSha256 !== record.contentSha256) {
				return failure('conflict', 'File content changed while preparing rename; read it again', {
					retry: {
						action: 'read_project_files',
						path,
						actualSha256: confirmation.contentSha256,
					},
				});
			}
			const expectedStoredContent = await synchronizeStoredText(confirmation, host);
			if (typeof expectedStoredContent !== 'string') return expectedStoredContent;
			const moved = await dependencies.files.moveTextFileIfUnchanged(
				confirmation.fileId,
				`/${path}`,
				expectedStoredContent,
				`/${newPath}`,
			);
			if (moved.status !== 'updated') {
				return failure('conflict', 'File content, source path or target changed before rename; read the tree again', {
					retry: { action: 'read_project_files', path },
				});
			}
			const origin = new HostDocumentEditOrigin(
				'rinspace-agent',
				`${host.runId}:${context.toolCallId}`,
			);
			if (
				confirmation.documentId &&
				!host.renameLinkedDocument(confirmation.documentId, path, newPath, origin)
			) {
				const rollback = await dependencies.files.moveTextFileIfUnchanged(
					confirmation.fileId,
					`/${newPath}`,
					expectedStoredContent,
					`/${path}`,
				);
				return failure(
					'workspace_changed',
					rollback.status === 'updated'
						? 'Linked document changed during rename; the browser file rename was rolled back'
						: 'Linked document changed and the browser rename could not be rolled back; refresh the project before continuing',
				);
			}
			return {
				ok: true,
				projectId: host.projectId,
				fileId: moved.file.id,
				oldPath: path,
				path: newPath,
				contentSha256: confirmation.contentSha256,
				transactionOrigin: origin.operationId,
			};
		},
	});
}

function deleteFileTool(host: RinspaceAgentToolHost): AgentTool {
	return createTool({
		name: 'delete_project_file',
		description: 'Delete one baseline-bound current-project text file while retaining recoverable browser deletion evidence.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['path', 'expectedSha256'],
			properties: {
				path: { type: 'string', minLength: 1, maxLength: 1024 },
				expectedSha256: { type: 'string', pattern: '^[0-9a-f]{64}$' },
			},
		},
		executionMode: 'sequential',
		retryable: false,
		execute: async (input: unknown, context) => {
			const inactive = activeError(host, context);
			if (inactive) return inactive;
			if (!isRecord(input) || typeof input.expectedSha256 !== 'string') {
				return failure('invalid_input', 'A path and SHA-256 baseline are required');
			}
			const path = normalizeAgentProjectPath(input.path);
			if (typeof path !== 'string') return path;
			const record = await readText(path, host);
			if (!('content' in record)) return record;
			if (record.contentSha256 !== input.expectedSha256) {
				return failure('conflict', 'File content changed before deletion; read it again', {
					retry: { action: 'read_project_files', path, actualSha256: record.contentSha256 },
				});
			}
			const confirmation = await readText(path, host);
			if (!('content' in confirmation)) return confirmation;
			if (confirmation.contentSha256 !== record.contentSha256) {
				return failure('conflict', 'File content changed while preparing deletion; read it again', {
					retry: { action: 'read_project_files', path, actualSha256: confirmation.contentSha256 },
				});
			}
			const expectedStoredContent = await synchronizeStoredText(confirmation, host);
			if (typeof expectedStoredContent !== 'string') return expectedStoredContent;
			const deleted = await dependencies.files.deleteTextFileIfUnchanged(
				confirmation.fileId,
				`/${path}`,
				expectedStoredContent,
			);
			if (deleted.status !== 'updated') {
				return failure('conflict', 'File content or structure changed before deletion; read it again', {
					retry: { action: 'read_project_files', path },
				});
			}
			const origin = new HostDocumentEditOrigin(
				'rinspace-agent',
				`${host.runId}:${context.toolCallId}`,
			);
			if (
				confirmation.documentId &&
				!host.deleteLinkedDocument(confirmation.documentId, path, origin)
			) {
				const rollback = await dependencies.files.restoreTextFileIfDeleted(
					confirmation.fileId,
					`/${path}`,
					expectedStoredContent,
				);
				return failure(
					'workspace_changed',
					rollback.status === 'updated'
						? 'Linked document changed during deletion; the browser deletion was rolled back'
						: 'Linked document changed and the browser deletion could not be rolled back; refresh the project before continuing',
				);
			}
			return {
				ok: true,
				projectId: host.projectId,
				fileId: confirmation.fileId,
				path,
				deletedSha256: confirmation.contentSha256,
				transactionOrigin: origin.operationId,
			};
		},
	});
}

function searchPattern(query: string, caseSensitive: boolean): RegExp {
	const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	return new RegExp(escaped, caseSensitive ? 'gu' : 'giu');
}

const unicodeWordCharacter = /[\p{L}\p{M}\p{N}\p{Pc}]/u;

function isWholeWordMatch(line: string, index: number, length: number): boolean {
	const before = Array.from(line.slice(0, index)).at(-1);
	const after = Array.from(line.slice(index + length)).at(0);
	return (
		(before === undefined || !unicodeWordCharacter.test(before)) &&
		(after === undefined || !unicodeWordCharacter.test(after))
	);
}

function searchTool(host: RinspaceAgentToolHost): AgentTool {
	return createTool({
		name: 'search_project',
		description: 'Search the current project text index with bounded literal matching.',
		inputSchema: {
			type: 'object', additionalProperties: false, required: ['query'],
			properties: {
				query: { type: 'string', minLength: 1, maxLength: 200 },
				path: { type: 'string', maxLength: 1024 },
				caseSensitive: { type: 'boolean' },
				wholeWord: { type: 'boolean' },
				maxResults: { type: 'integer', minimum: 1, maximum: LIMITS.searchMatches },
			},
		},
		executionMode: 'parallel',
		retryable: false,
		execute: async (input: unknown, context) => {
			const inactive = activeError(host, context);
			if (inactive) return inactive;
			if (!isRecord(input) || typeof input.query !== 'string' || !input.query.trim() || input.query.length > 200) {
				return failure('invalid_input', 'query must contain 1-200 characters');
			}
			const query = input.query;
			if ((input.caseSensitive !== undefined && typeof input.caseSensitive !== 'boolean') || (input.wholeWord !== undefined && typeof input.wholeWord !== 'boolean')) {
				return failure('invalid_input', 'Search flags must be booleans');
			}
			const maxResults = boundedInteger(input.maxResults, 50, 1, LIMITS.searchMatches);
			if (maxResults === null) return failure('invalid_input', 'Invalid maxResults');
			let prefix = '';
			if (input.path !== undefined && input.path !== '') {
				const normalized = normalizeAgentProjectPath(input.path);
				if (typeof normalized !== 'string') return normalized;
				if (pathIsPrivate(normalized)) return failure('path_forbidden', `Private path is forbidden: ${normalized}`);
				prefix = normalized;
			}
			const metadata = (await dependencies.files.getAllFiles(false, false, false))
				.filter((file) => file.type === 'file')
				.map((file) => ({ file, path: relativePath(file.path) }))
				.filter(({ file, path }) =>
					!file.isBinary && !isBinaryFile(path) && !pathIsPrivate(path) &&
					(!prefix || path === prefix || path.startsWith(`${prefix}/`)),
				);
			const changedAfterIndex = activeError(host);
			if (changedAfterIndex) return changedAfterIndex;
			if (metadata.length > LIMITS.indexFiles) {
				return failure('limit_exceeded', 'Project text index exceeds the searchable file limit', {
					limit: LIMITS.indexFiles,
					actual: metadata.length,
					retry: { query, path: prefix || 'narrower/directory' },
				});
			}
			const indexed = await dependencies.search.search(query, {
				// The index is only a broad candidate source. Exact case and Unicode
				// word-boundary semantics are recomputed from the current Y.Text view.
				caseSensitive: false,
				wholeWord: false,
				useRegex: false,
				includeFilenames: false,
				includeContent: true,
			});
			const changedAfterSearch = activeError(host);
			if (changedAfterSearch) return changedAfterSearch;
			const indexedIds = new Set(indexed.map((result) => result.fileId));
			const candidates = metadata.filter(({ file }) => file.documentId || indexedIds.has(file.id));
			const pattern = searchPattern(query, input.caseSensitive === true);
			const results = [];
			let matchCount = 0;
			for (const candidate of candidates) {
				const record = await readText(candidate.path, host);
				if (!('content' in record)) continue;
				const matches = [];
				for (const [lineIndex, line] of record.content.split('\n').entries()) {
					pattern.lastIndex = 0;
					let match: RegExpExecArray | null;
					while ((match = pattern.exec(line)) !== null) {
						if (
							input.wholeWord === true &&
							!isWholeWordMatch(line, match.index, match[0].length)
						) {
							continue;
						}
						matchCount += 1;
						if (matchCount > maxResults) {
							return failure('limit_exceeded', 'Search exceeds the requested result limit', {
								limit: maxResults,
								actual: matchCount,
								retry: { query, path: candidate.path, maxResults },
							});
						}
						matches.push({
							line: lineIndex + 1,
							column: match.index + 1,
							text: line.length <= 800 ? line : `${line.slice(Math.max(0, match.index - 300), match.index + 500)}…`,
						});
					}
				}
				if (matches.length) results.push({ fileId: record.fileId, path: record.path, contentSha256: record.contentSha256, matches });
			}
			return bound({ ok: true, projectId: host.projectId, query, results }, {
				query,
				path: prefix || undefined,
				maxResults: Math.max(1, Math.floor(maxResults / 2)),
			});
		},
	});
}

const cleanMessage = (value: string | null | undefined) =>
	value
		? Array.from(value)
			.filter((character) => !isControlCharacter(character) || character === '\t' || character === '\n' || character === '\r')
			.join('')
			.slice(0, 2000)
		: null;

function diagnosticsTool(host: RinspaceAgentToolHost): AgentTool {
	return createTool({
		name: 'read_compile_diagnostics',
		description: 'Read bounded diagnostics from current LaTeX, Typst and external compiler contexts.',
		inputSchema: { type: 'object', additionalProperties: false, properties: {} },
		executionMode: 'parallel',
		retryable: false,
		execute: async (_input: unknown, context) => {
			const inactive = activeError(host, context);
			if (inactive) return inactive;
			const files = (await dependencies.files.getAllFiles(false, false, false))
				.filter((file) => file.type === 'file')
				.map((file) => ({ file, path: relativePath(file.path) }))
				.filter(({ path }) => !pathIsPrivate(path));
			const changedAfterFiles = activeError(host);
			if (changedAfterFiles) return changedAfterFiles;
			const byPath = new Map(files.map((entry) => [entry.path, entry]));
			const sources = [];
			for (const source of host.getDiagnostics()) {
				const parsed = source.id === 'latex'
					? parseLatexLog(source.log)
					: source.id === 'typst'
						? parseTypstLog(source.log)
						: [...source.log.matchAll(/^(error|warning|info)(?:\[([^\]]+)\])?\s*:\s*(.+)$/gim)].map((match) => ({
							type: match[1].toLowerCase() as 'error' | 'warning' | 'info',
							file: match[2],
							message: match[3],
						}));
				if (parsed.length > LIMITS.diagnostics) {
					return failure('limit_exceeded', 'Compile diagnostics exceed the response limit', {
						limit: LIMITS.diagnostics,
						actual: parsed.length,
						retry: { action: 'fix_highest_priority_diagnostics_first', source: source.id },
					});
				}
				const projected = [];
				for (const item of parsed) {
					let identity: Record<string, unknown> = {};
					if (item.file && !item.file.startsWith('/') && !item.file.includes('\\')) {
						const path = relativePath(item.file);
						let entry = byPath.get(path);
						if (!entry) {
							const sameBase = files.filter((candidate) => candidate.path.split('/').at(-1) === path.split('/').at(-1));
							if (sameBase.length === 1) entry = sameBase[0];
						}
						if (entry) {
							const record = await readText(entry.path, host);
							if ('content' in record) identity = { fileId: record.fileId, path: record.path, contentSha256: record.contentSha256 };
						}
					}
					projected.push({
						type: item.type,
						message: cleanMessage(
							('fullMessage' in item ? item.fullMessage : undefined) || item.message,
						),
						line: 'line' in item ? (item.line ?? null) : null,
						...identity,
					});
				}
				sources.push({ id: source.id, status: source.status, error: cleanMessage(source.error), diagnostics: projected });
			}
			return bound({ ok: true, projectId: host.projectId, sources }, { action: 'request_one_compiler_source' });
		},
	});
}

async function projectComparison(
	comparison: Awaited<ReturnType<typeof gitService.compareFile>>,
): Promise<Record<string, unknown> | null> {
	if (!comparison) return null;
	const leftBytes = typeof comparison.leftContent === 'string' ? byteLength(comparison.leftContent) : comparison.leftContent.byteLength;
	const rightBytes = typeof comparison.rightContent === 'string' ? byteLength(comparison.rightContent) : comparison.rightContent.byteLength;
	const result: Record<string, unknown> = {
		path: comparison.path,
		type: comparison.type,
		isBinary: comparison.isBinary,
		leftBytes,
		rightBytes,
		leftSha256: await sha256(comparison.leftContent),
		rightSha256: await sha256(comparison.rightContent),
	};
	if (!comparison.isBinary && leftBytes + rightBytes <= LIMITS.comparisonBytes) {
		result.before = decodeText(comparison.leftContent);
		result.after = decodeText(comparison.rightContent);
	} else {
		result.contentOmitted = true;
	}
	return result;
}

function gitTool(host: RinspaceAgentToolHost): AgentTool {
	return createTool({
		name: 'git_status',
		description: 'Read current-project Git branch, HEAD, changes and bounded text comparisons.',
		inputSchema: {
			type: 'object', additionalProperties: false,
			properties: {
				path: { type: 'string', maxLength: 1024 },
				includeComparisons: { type: 'boolean' },
				maxChanges: { type: 'integer', minimum: 1, maximum: LIMITS.gitChanges },
			},
		},
		executionMode: 'parallel',
		retryable: false,
		execute: async (input: unknown, context) => {
			const inactive = activeError(host, context);
			if (inactive) return inactive;
			if (!isRecord(input) || (input.includeComparisons !== undefined && typeof input.includeComparisons !== 'boolean')) {
				return failure('invalid_input', 'Invalid Git status input');
			}
			const maxChanges = boundedInteger(input.maxChanges, 30, 1, LIMITS.gitChanges);
			if (maxChanges === null) return failure('invalid_input', 'Invalid maxChanges');
			let prefix = '';
			if (input.path !== undefined && input.path !== '') {
				const normalized = normalizeAgentProjectPath(input.path);
				if (typeof normalized !== 'string') return normalized;
				if (pathIsPrivate(normalized)) {
					return failure('path_forbidden', `Private path is forbidden: ${normalized}`);
				}
				prefix = normalized;
			}
			if (!(await dependencies.git.isInitialized(host.projectId))) {
				return { ok: true, projectId: host.projectId, initialized: false, branch: null, headOid: null, changes: [] };
			}
			const [branch, headOid, worktreeBaseOid, changes, worktreeChanges] = await Promise.all([
				dependencies.git.getCurrentBranch(host.projectId),
				dependencies.git.getHeadOid(host.projectId),
				dependencies.git.getWorktreeBaseOid(host.projectId),
				dependencies.git.getChanges(host.projectId),
				dependencies.git.getWorktreeChanges(host.projectId),
			]);
			const changed = activeError(host);
			if (changed) return changed;
			const visible = changes
				.map((change) => ({ ...change, path: relativePath(change.path) }))
				.filter((change) =>
					!pathIsPrivate(change.path) &&
					(!prefix || change.path === prefix || change.path.startsWith(`${prefix}/`)),
				);
			const visibleWorktree = worktreeChanges
				.map((change) => ({ ...change, path: relativePath(change.path) }))
				.filter((change) =>
					!pathIsPrivate(change.path) &&
					(!prefix || change.path === prefix || change.path.startsWith(`${prefix}/`)),
				);
			const visiblePaths = new Set([
				...visible.map((change) => change.path),
				...visibleWorktree.map((change) => change.path),
			]);
			if (visiblePaths.size > maxChanges) {
				return failure('limit_exceeded', 'Git changes exceed the response limit', {
					limit: maxChanges,
					actual: visiblePaths.size,
					retry: {
						path: prefix || 'narrower/directory',
						includeComparisons: false,
						maxChanges: Math.min(LIMITS.gitChanges, visiblePaths.size),
					},
				});
			}
			const comparisons = [];
			if (input.includeComparisons !== false) {
				for (const change of visible) {
					const comparison = await dependencies.git.compareFile(
						host.projectId,
						change.path,
						headOid ? { kind: 'commit', oid: headOid } : { kind: 'empty' },
						{ kind: 'worktree' },
					);
					const projected = await projectComparison(comparison);
					if (projected) comparisons.push(projected);
				}
			}
			return bound({
				ok: true,
				projectId: host.projectId,
				initialized: true,
				branch,
				headOid,
				worktreeBaseOid,
				changes: visible,
				worktreeChanges: visibleWorktree,
				comparisons,
			}, { path: prefix || undefined, includeComparisons: false, maxChanges });
		},
	});
}

interface CompileGate {
	running: boolean;
	lastStartedAt: number;
}

function compileProjectTool(
	host: RinspaceAgentToolHost,
	gate: CompileGate,
): AgentTool {
	return createTool({
		name: 'compile_project',
		description: 'Run the current project configured TeXlyre compiler or Markdown preview parser and return a bounded real result.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			properties: {},
		},
		executionMode: 'sequential',
		retryable: false,
		execute: async (input: unknown, context) => {
			const inactive = activeError(host, context);
			if (inactive) return inactive;
			if (!isRecord(input)) return failure('invalid_input', 'Input must be an object');
			const now = Date.now();
			if (gate.running) {
				return failure('busy', 'A project compilation is already running', {
					retry: { retryAfterMs: LIMITS.compileIntervalMs },
				});
			}
			const elapsed = now - gate.lastStartedAt;
			if (elapsed < LIMITS.compileIntervalMs) {
				return failure('busy', 'Project compilation is rate limited', {
					retry: { retryAfterMs: LIMITS.compileIntervalMs - elapsed },
				});
			}

			gate.running = true;
			gate.lastStartedAt = now;
			try {
				const result = await host.compileProject();
				const changed = activeError(host);
				if (changed) return changed;
				const log = boundedText(result.log, LIMITS.compileLogBytes);
				return bound(
					{
						ok: true,
						projectId: host.projectId,
						...result,
						log: log.text,
						logBytes: log.bytes,
						logTruncated: log.truncated,
					},
					{ action: 'read_compile_diagnostics' },
				);
			} finally {
				gate.running = false;
			}
		},
	});
}

function createGitCommitTool(host: RinspaceAgentToolHost): AgentTool {
	return createTool({
		name: 'create_git_commit',
		description: 'Create a local Git commit from the current project persisted worktree using the confirmed managed identity.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			required: ['message'],
			properties: {
				message: { type: 'string', minLength: 1, maxLength: 500 },
			},
		},
		executionMode: 'sequential',
		retryable: false,
		execute: async (input: unknown, context) => {
			const inactive = activeError(host, context);
			if (inactive) return inactive;
			if (!isRecord(input) || typeof input.message !== 'string') {
				return failure('invalid_input', 'A commit message is required');
			}
			const message = input.message.trim();
			if (!message || byteLength(message) > 2000) {
				return failure('invalid_input', 'Commit message must contain 1 to 2000 UTF-8 bytes');
			}
			const oid = await host.createGitCommit(message);
			const changed = activeError(host);
			if (changed) return changed;
			return {
				ok: true,
				projectId: host.projectId,
				commitOid: oid,
				message,
			};
		},
	});
}

function isGitPushPreview(value: unknown): value is GitPushPreview {
	if (!isRecord(value) || !Array.isArray(value.commits)) return false;
	if (
		!['providerName', 'repositoryId', 'repositoryLabel', 'localBranch', 'remoteBranch', 'localHead']
			.every((field) => typeof value[field] === 'string') ||
		!(value.remoteHead === null || typeof value.remoteHead === 'string') ||
		value.commits.length > 200
	) {
		return false;
	}
	return value.commits.every(
		(commit) =>
			isRecord(commit) &&
			typeof commit.oid === 'string' &&
			typeof commit.subject === 'string',
	);
}

function pushGitCommitsTool(host: RinspaceAgentToolHost): AgentTool {
	return createTool({
		name: 'push_git_commits',
		description: 'Push approved local commits to the configured project repository. The host replaces all input with a fresh immutable preview before requesting approval.',
		inputSchema: {
			type: 'object',
			additionalProperties: false,
			properties: {},
		},
		executionMode: 'sequential',
		retryable: false,
		execute: async (input: unknown, context) => {
			const inactive = activeError(host, context);
			if (inactive) return inactive;
			if (!isGitPushPreview(input)) {
				return failure('invalid_input', 'Push requires a fresh host-generated approval preview');
			}
			const summary = await host.pushGitCommits(input);
			const changed = activeError(host);
			if (changed) return changed;
			return { ok: true, projectId: host.projectId, ...summary };
		},
	});
}

export function createRinspaceAgentTools(host: RinspaceAgentToolHost): RinspaceAgentToolSet {
	const compileGate: CompileGate = { running: false, lastStartedAt: 0 };
	const tools = [
		listTool(host),
		readTool(host),
		searchTool(host),
		diagnosticsTool(host),
		gitTool(host),
		compileProjectTool(host, compileGate),
		patchTool(host),
		createFileTool(host),
		renameFileTool(host),
		deleteFileTool(host),
		createGitCommitTool(host),
		pushGitCommitsTool(host),
	];
	return {
		tools,
		policies: Object.fromEntries(
			tools.map((tool) => [
				tool.name,
				{ enabled: true, autoApprove: tool.name !== 'push_git_commits' },
			]),
		),
		beforeTool: async (context) => {
			const inactive = activeError(host);
			if (inactive) return { skip: true, reason: inactive.error.message };
			if (context.tool.name !== 'push_git_commits') return undefined;
			try {
				const preview = await host.prepareGitPush();
				const changed = activeError(host);
				if (changed) return { skip: true, reason: changed.error.message };
				if (preview.commits.length === 0) {
					return { skip: true, reason: 'There are no local commits to Push' };
				}
				return {
					input: preview,
					policy: { enabled: true, autoApprove: false },
				};
			} catch (error) {
				return {
					skip: true,
					reason: error instanceof Error ? error.message : 'Push preview failed',
				};
			}
		},
	};
}
