// SPDX-License-Identifier: AGPL-3.0-or-later
import { deleteDB } from 'idb';

import { FileStoreService } from '@src/services/FileStoreService';
import { fileHandlerService } from '@src/services/FileHandlerService';
import { quotaService } from '@src/services/QuotaService';
import type { FileNode } from '@src/types/files';

jest.mock('@src/services/FileHandlerService', () => ({
	fileHandlerService: {
		mirrorFiles: jest.fn(async () => ({ entries: [{ reason: 'not-linked' }] })),
		removeFromDisk: jest.fn(async () => undefined),
	},
}));

const projectId = 'conditional-agent-structure';
let first: FileStoreService;
let second: FileStoreService;

const textFile = (
	id: string,
	path: string,
	content: string,
	extra: Partial<FileNode> = {},
): FileNode => ({
	id,
	name: path.split('/').at(-1) ?? path,
	path,
	type: 'file',
	content,
	size: new TextEncoder().encode(content).byteLength,
	lastModified: 1,
	isDeleted: false,
	isBinary: false,
	mimeType: 'text/plain',
	...extra,
});

beforeEach(async () => {
	jest.clearAllMocks();
	jest.spyOn(quotaService, 'ensureSpace').mockResolvedValue();
	first = new FileStoreService();
	second = new FileStoreService();
	first.setProjectId(projectId);
	second.setProjectId(projectId);
	await first.initialize();
	await second.initialize();
});

afterEach(async () => {
	await first.cleanup();
	await second.cleanup();
	jest.restoreAllMocks();
	await deleteDB(`texlyre-project-${projectId}`);
});

test('atomically creates nested text paths without overwriting a competing writer', async () => {
	const results = await Promise.all([
		first.createTextFileIfAbsent(textFile('agent-a', '/chapters/new.tex', 'Agent A')),
		second.createTextFileIfAbsent(textFile('agent-b', '/chapters/new.tex', 'Agent B')),
	]);
	expect(results.map((result) => result.status).sort()).toEqual(['conflict', 'created']);

	const stored = await first.getFileByPath('/chapters/new.tex');
	expect(['Agent A', 'Agent B']).toContain(stored?.content);
	expect((await first.getFileByPath('/chapters'))?.type).toBe('directory');
	expect(
		(await first.getAllFiles(false)).filter((file) => file.path === '/chapters/new.tex'),
	).toHaveLength(1);
});

test('moves one unchanged linked text file with a stable ID and nested parent transaction', async () => {
	const source = textFile('main', '/main.tex', '正文 $x^2$', {
		documentId: 'document-main',
	});
	await first.db?.put('files', source);

	await expect(
		second.moveTextFileIfUnchanged(
			'main',
			'/main.tex',
			'正文 $x^2$',
			'/parts/renamed.typ',
		),
	).resolves.toMatchObject({
		status: 'updated',
		file: {
			id: 'main',
			path: '/parts/renamed.typ',
			name: 'renamed.typ',
			documentId: 'document-main',
			content: '正文 $x^2$',
		},
	});
	expect(await first.getFileByPath('/main.tex')).toBeUndefined();
	expect((await first.getFileByPath('/parts'))?.type).toBe('directory');
});

test('rejects move and delete after a concurrent content or target-path change', async () => {
	const source = textFile('main', '/main.tex', 'baseline');
	await first.db?.put('files', source);
	await first.updateFileContent('main', 'new user content');

	await expect(
		second.moveTextFileIfUnchanged('main', '/main.tex', 'baseline', '/renamed.tex'),
	).resolves.toEqual({ status: 'conflict' });
	await expect(
		second.deleteTextFileIfUnchanged('main', '/main.tex', 'baseline'),
	).resolves.toEqual({ status: 'conflict' });
	expect(await first.getFileByPath('/main.tex')).toMatchObject({
		content: 'new user content',
		isDeleted: false,
	});

	await first.db?.put('files', textFile('target', '/renamed.tex', 'target'));
	await expect(
		second.moveTextFileIfUnchanged(
			'main',
			'/main.tex',
			'new user content',
			'/renamed.tex',
		),
	).resolves.toEqual({ status: 'conflict' });
	expect((await first.getFileByPath('/renamed.tex'))?.content).toBe('target');
});

test('keeps a recoverable tombstone and conditionally restores it', async () => {
	const source = textFile('main', '/main.tex', 'recover me', {
		documentId: 'document-main',
	});
	await first.db?.put('files', source);
	await expect(
		second.deleteTextFileIfUnchanged('main', '/main.tex', 'recover me'),
	).resolves.toMatchObject({ status: 'updated', file: { isDeleted: true } });
	expect(await first.getFile('main')).toMatchObject({
		isDeleted: true,
		content: 'recover me',
		documentId: 'document-main',
	});

	await expect(
		first.restoreTextFileIfDeleted('main', '/main.tex', 'recover me'),
	).resolves.toMatchObject({ status: 'updated', file: { isDeleted: false } });
	expect(await second.getFileByPath('/main.tex')).toMatchObject({ content: 'recover me' });
});

test('rolls the browser tombstone back when a native deletion fails', async () => {
	const source = textFile('main', '/main.tex', 'do not lose');
	await first.db?.put('files', source);
	jest.mocked(fileHandlerService.removeFromDisk).mockRejectedValueOnce(
		new DOMException('permission revoked', 'NotAllowedError'),
	);

	await expect(
		second.deleteTextFileIfUnchanged('main', '/main.tex', 'do not lose'),
	).rejects.toThrow('permission revoked');
	expect(await first.getFile('main')).toMatchObject({
		isDeleted: false,
		content: 'do not lose',
	});
});
