import type { IDBPDatabase } from 'idb';

import { FileStoreService } from '@src/services/FileStoreService';
import { fileHandlerService } from '@src/services/FileHandlerService';
import { quotaService, StorageQuotaError } from '@src/services/QuotaService';
import type { FileNode } from '@src/types/files';

jest.mock('@src/services/FileHandlerService', () => ({
	fileHandlerService: {
		hasWorkspacePermissionPending: jest.fn(() => false),
		rememberPermissionPendingOriginal: jest.fn(),
		mirrorFiles: jest.fn(async () => ({ entries: [{ reason: 'not-linked' }] })),
	},
}));

const originalFile = (): FileNode => ({
	id: 'main',
	name: 'main.tex',
	path: '/main.tex',
	type: 'file',
	content: 'English $x^2$',
	size: 13,
	lastModified: 1,
	mimeType: 'text/plain',
	isBinary: false,
});

const storeWithPut = (put: jest.Mock) => {
	const store = new FileStoreService();
	store.setProjectId('quota-test');
	store.db = {
		get: jest.fn(async () => originalFile()),
		put,
	} as unknown as IDBPDatabase;
	return store;
};

beforeEach(() => jest.clearAllMocks());
afterEach(() => jest.restoreAllMocks());

test('an existing text file can be overwritten when a coarse quota estimate says full', async () => {
	const put = jest.fn(async () => undefined);
	const store = storeWithPut(put);
	const estimate = jest.spyOn(quotaService, 'ensureSpace')
		.mockRejectedValue(new StorageQuotaError(13));

	await expect(store.updateFileContent('main', 'English $y^2$')).resolves.toMatchObject({
		id: 'main',
		content: 'English $y^2$',
	});
	expect(put).toHaveBeenCalledTimes(1);
	expect(estimate).not.toHaveBeenCalled();
});

test('a quota exception from the database write remains a failed save', async () => {
	const quota = new DOMException('Browser storage full', 'QuotaExceededError');
	const put = jest.fn(async () => { throw quota; });
	const store = storeWithPut(put);

	await expect(store.updateFileContent('main', 'English $y^2$'))
		.rejects.toMatchObject({ cause: quota });
	expect(fileHandlerService.mirrorFiles).not.toHaveBeenCalled();
});

test('a project switch during the read cannot redirect a file save into another database', async () => {
	let finishRead: (file: FileNode) => void = () => {};
	const read = new Promise<FileNode>((resolve) => { finishRead = resolve; });
	const firstPut = jest.fn(async () => undefined);
	const otherPut = jest.fn(async () => undefined);
	const store = new FileStoreService();
	store.setProjectId('first');
	store.db = { get: jest.fn(() => read), put: firstPut } as unknown as IDBPDatabase;
	const saving = store.updateFileContent('main', 'English $y^2$');
	store.setProjectId('other');
	store.db = { put: otherPut } as unknown as IDBPDatabase;
	finishRead(originalFile());

	await expect(saving).rejects.toThrow();
	expect(firstPut).not.toHaveBeenCalled();
	expect(otherPut).not.toHaveBeenCalled();
});

test('a closed project connection cannot report a skipped write as saved', async () => {
	let finishRead: (file: FileNode) => void = () => {};
	const read = new Promise<FileNode>((resolve) => { finishRead = resolve; });
	const store = new FileStoreService();
	store.setProjectId('first');
	store.db = { get: jest.fn(() => read), put: jest.fn() } as unknown as IDBPDatabase;
	const saving = store.updateFileContent('main', 'English $y^2$');
	store.db = null;
	finishRead(originalFile());

	await expect(saving).rejects.toThrow();
	expect(fileHandlerService.mirrorFiles).not.toHaveBeenCalled();
});

test('a conditional content update never overwrites a newer browser value', async () => {
	const projectId = `conditional-update-${Date.now()}`;
	const userStore = new FileStoreService();
	const agentStore = new FileStoreService();
	userStore.setProjectId(projectId);
	agentStore.setProjectId(projectId);
	await userStore.initialize();
	await agentStore.initialize();
	await userStore.db?.put('files', originalFile());

	await userStore.updateFileContent('main', '用户并发输入 $z^2$');
	await expect(
		agentStore.updateFileContentIfUnchanged(
			'main',
			'English $x^2$',
			'Agent stale value',
		),
	).resolves.toEqual({ status: 'conflict' });
	expect((await agentStore.getFile('main'))?.content).toBe('用户并发输入 $z^2$');

	await expect(
		agentStore.updateFileContentIfUnchanged(
			'main',
			'用户并发输入 $z^2$',
			'Agent fresh value $\\alpha$',
		),
	).resolves.toMatchObject({
		status: 'updated',
		file: { content: 'Agent fresh value $\\alpha$' },
	});
	userStore.cleanup();
	agentStore.cleanup();
});
