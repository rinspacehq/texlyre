// SPDX-License-Identifier: AGPL-3.0-or-later
import { deleteDB } from 'idb';
import { deserialize, serialize } from 'node:v8';
import { fileHandlerService } from '@src/services/FileHandlerService';
import { fileStoreService } from '@src/services/FileStoreService';
import { DirectoryTarget } from '@src/services/WriteTargetService';
import type { FileNode } from '@src/types/files';

jest.mock('@src/i18n', () => ({ t: (key: string) => key }));

const projectId = 'synthetic-local-deletion';
type Entry = { kind: 'directory' } | { kind: 'file'; content: string | ArrayBuffer };
const node = (path: string, type: 'file' | 'directory' = 'file', content = '保留的草稿'): FileNode => ({
	id: path, name: path.split('/').pop() ?? path, path, type,
	content: type === 'file' ? content : undefined, lastModified: 7,
});

/** Models the native removeEntry contract, including non-empty directories. */
function directory(initial: Array<[string, Entry]>, onRemove?: (path: string) => Promise<void>) {
	const entries = new Map(initial);
	const calls: Array<{ path: string; recursive: boolean }> = [];
	const handle = (parent: string): FileSystemDirectoryHandle => ({
		kind: 'directory', name: parent.split('/').pop() ?? 'synthetic',
		getDirectoryHandle: async (name: string) => {
			const child = `${parent}/${name}`;
			if (entries.get(child)?.kind !== 'directory') throw new DOMException('Missing directory', 'NotFoundError');
			return handle(child);
		},
		removeEntry: async (name: string, options?: { recursive?: boolean }) => {
			const path = `${parent}/${name}`;
			calls.push({ path, recursive: options?.recursive === true });
			await onRemove?.(path);
			const entry = entries.get(path);
			if (!entry) throw new DOMException('Missing entry', 'NotFoundError');
			const children = [...entries.keys()].filter((child) => child.startsWith(`${path}/`));
			if (entry.kind === 'directory' && children.length > 0 && !options?.recursive) {
				throw new DOMException('Directory is not empty', 'InvalidModificationError');
			}
			for (const child of children) entries.delete(child);
			entries.delete(path);
		},
	} as unknown as FileSystemDirectoryHandle);
	return { entries, calls, adapter: new DirectoryTarget(handle('')) };
}

async function seed(files: FileNode[]) {
	const db = fileStoreService.db;
	if (!db) throw new Error('Test storage was not initialized');
	for (const file of files) await db.put('files', file);
	return db;
}

describe('local folder deletion and browser recovery', () => {
	beforeEach(async () => {
		localStorage.clear();
		fileHandlerService.detachWorkspace();
		fileStoreService.setProjectId(projectId);
		jest.spyOn(globalThis, 'structuredClone').mockImplementation(<T,>(value: T): T => deserialize(serialize(value)));
		await fileStoreService.initialize(`yjs:${projectId}`);
	});
	afterEach(async () => {
		fileHandlerService.detachWorkspace();
		await fileStoreService.cleanup();
		jest.restoreAllMocks();
		await deleteDB(`texlyre-project-${projectId}`);
	});

	it('never recursively removes ignored Git data or a newly added unrelated file', async () => {
		const disk = directory([
			['/章节', { kind: 'directory' }],
			['/章节/intro.tex', { kind: 'file', content: 'known' }],
			['/章节/.git', { kind: 'directory' }],
			['/章节/.git/config', { kind: 'file', content: 'protected' }],
			['/章节/unrelated.dat', { kind: 'file', content: 'not imported' }],
		]);
		fileHandlerService.attachWorkspace(disk.adapter, projectId);
		await expect(fileHandlerService.removeFromDisk([node('/章节', 'directory'), node('/章节/intro.tex')])).rejects.toBeInstanceOf(AggregateError);
		expect(disk.entries.get('/章节/.git/config')).toEqual({ kind: 'file', content: 'protected' });
		expect(disk.entries.get('/章节/unrelated.dat')).toEqual({ kind: 'file', content: 'not imported' });
		expect(disk.entries.has('/章节/intro.tex')).toBe(false);
		expect(disk.calls.every((call) => !call.recursive)).toBe(true);
	});

	it('removes only listed children, deepest first, and then their empty parents', async () => {
		const disk = directory([
			['/章节', { kind: 'directory' }],
			['/章节/小节', { kind: 'directory' }],
			['/章节/小节/intro.tex', { kind: 'file', content: 'known' }],
		]);
		fileHandlerService.attachWorkspace(disk.adapter, projectId);
		await fileHandlerService.removeFromDisk([node('/章节', 'directory'), node('/章节/小节', 'directory'), node('/章节/小节/intro.tex')]);
		expect(disk.calls).toEqual([
			{ path: '/章节/小节/intro.tex', recursive: false },
			{ path: '/章节/小节', recursive: false },
			{ path: '/章节', recursive: false },
		]);
		expect(disk.entries.size).toBe(0);
	});

	it('retains the original browser bytes on permission failure, including hard delete', async () => {
		const binary = Uint8Array.of(0, 255, 128, 13, 10).buffer;
		const source = { ...node('/asset.dat'), content: binary, isBinary: true };
		const db = await seed([source]);
		const failure = new DOMException('Synthetic revoked permission', 'NotAllowedError');
		const disk = directory([['/asset.dat', { kind: 'file', content: binary }]], async () => { throw failure; });
		fileHandlerService.attachWorkspace(disk.adapter, projectId);
		for (const hardDelete of [false, true]) {
			await expect(fileStoreService.deleteFile(source.id, { showDeleteDialog: false, hardDelete })).rejects.toBeInstanceOf(AggregateError);
			const stored: FileNode = await db.get('files', source.id);
			expect(stored.isDeleted).not.toBe(true);
			expect(new Uint8Array(stored.content as ArrayBuffer)).toEqual(new Uint8Array(binary));
		}
		expect(disk.entries.has('/asset.dat')).toBe(true);
	});

	it('keeps all browser drafts after a partial disk failure and can retry missing paths', async () => {
		const files = [node('/first.tex'), node('/second.tex')];
		const db = await seed(files);
		let denied = true;
		const disk = directory(files.map((file) => [file.path, { kind: 'file', content: 'disk' }] as [string, Entry]), async (path) => {
			if (denied && path === '/second.tex') throw new DOMException('Synthetic denial', 'NotAllowedError');
		});
		fileHandlerService.attachWorkspace(disk.adapter, projectId);
		await expect(fileStoreService.batchDeleteFiles(files.map((file) => file.id), { showDeleteDialog: false })).rejects.toBeInstanceOf(AggregateError);
		for (const file of files) expect(await db.get('files', file.id)).toMatchObject({ content: '保留的草稿', lastModified: 7 });
		expect(disk.entries.has('/first.tex')).toBe(false);
		expect(disk.entries.has('/second.tex')).toBe(true);
		denied = false;
		await fileStoreService.batchDeleteFiles(files.map((file) => file.id), { showDeleteDialog: false });
		for (const file of files) expect(await db.get('files', file.id)).toMatchObject({ isDeleted: true, content: undefined });
		expect(disk.entries.size).toBe(0);
	});

	it('does not continue an old removal in a newly attached folder', async () => {
		const files = [node('/first.tex'), node('/next.tex')];
		let release: () => void = () => undefined;
		let entered: () => void = () => undefined;
		const started = new Promise<void>((resolve) => { entered = resolve; });
		const gate = new Promise<void>((resolve) => { release = resolve; });
		const initial = files.map((file) => [file.path, { kind: 'file', content: 'original' }] as [string, Entry]);
		const oldDisk = directory(initial, async () => { entered(); await gate; });
		const newDisk = directory(initial);
		fileHandlerService.attachWorkspace(oldDisk.adapter, projectId);
		const pending = fileHandlerService.removeFromDisk(files);
		const rejected = expect(pending).rejects.toBeInstanceOf(AggregateError);
		await started;
		fileHandlerService.attachWorkspace(newDisk.adapter, projectId);
		release();
		await rejected;
		expect(oldDisk.entries.has('/first.tex')).toBe(false);
		expect(oldDisk.entries.has('/next.tex')).toBe(true);
		expect(newDisk.calls).toEqual([]);
		expect(newDisk.entries.size).toBe(2);
	});

	it.each([false, true])('aborts all browser deletion requests if a later request throws (hard=%s)', async (hardDelete) => {
		const files = [node('/first.tex'), node('/second.tex')];
		const db = await seed(files);
		if (hardDelete) {
			const original = IDBObjectStore.prototype.delete;
			jest.spyOn(IDBObjectStore.prototype, 'delete').mockImplementation(function (this: IDBObjectStore, key: IDBValidKey | IDBKeyRange) {
				if (key === '/second.tex') throw new DOMException('Synthetic second request failure', 'DataError');
				return original.call(this, key);
			});
		} else {
			const original = IDBObjectStore.prototype.put;
			jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
				if (value && typeof value === 'object' && 'path' in value && value.path === '/second.tex') {
					throw new DOMException('Synthetic second request failure', 'DataCloneError');
				}
				return original.call(this, value, key);
			});
		}
		await expect(fileStoreService.batchDeleteFiles(files.map((file) => file.id), { showDeleteDialog: false, hardDelete })).rejects.toMatchObject({ name: hardDelete ? 'DataError' : 'DataCloneError' });
		for (const file of files) expect(await db.get('files', file.id)).toEqual(file);
	});

	it.each([false, true])('does not clear the browser row when a folder changes during the last removal (batch=%s)', async (batch) => {
		const source = node('/main.tex');
		const db = await seed([source]);
		const newDisk = directory([['/main.tex', { kind: 'file', content: 'new folder bytes' }]]);
		const oldDisk = directory([['/main.tex', { kind: 'file', content: 'old folder bytes' }]], async () => {
			fileHandlerService.attachWorkspace(newDisk.adapter, projectId);
		});
		fileHandlerService.attachWorkspace(oldDisk.adapter, projectId);
		const action = batch ? fileStoreService.batchDeleteFiles([source.id], { showDeleteDialog: false }) : fileStoreService.deleteFile(source.id, { showDeleteDialog: false });
		await expect(action).rejects.toBeInstanceOf(AggregateError);
		expect(await db.get('files', source.id)).toEqual(source);
		expect(oldDisk.entries.has('/main.tex')).toBe(false);
		expect(newDisk.entries.get('/main.tex')).toEqual({ kind: 'file', content: 'new folder bytes' });
		expect(newDisk.calls).toEqual([]);
	});

	it('retains the old browser row if the project changes during an accepted removal', async () => {
		const source = node('/main.tex');
		const db = await seed([source]);
		const disk = directory([['/main.tex', { kind: 'file', content: 'disk' }]], async () => { fileStoreService.setProjectId('other-project'); });
		fileHandlerService.attachWorkspace(disk.adapter, projectId);
		await expect(fileStoreService.deleteFile(source.id, { showDeleteDialog: false })).rejects.toThrow('Project changed during deletion');
		expect(await db.get('files', source.id)).toMatchObject({ content: '保留的草稿', lastModified: 7 });
		expect(disk.entries.has('/main.tex')).toBe(false);
	});

	it('keeps direct protected and traversing paths out of disk removal', async () => {
		const disk = directory([['/.git', { kind: 'directory' }], ['/.git/config', { kind: 'file', content: 'protected' }]]);
		fileHandlerService.attachWorkspace(disk.adapter, projectId);
		await fileHandlerService.removeFromDisk([node('/.git/config'), node('/../unsafe.tex')]);
		expect(disk.calls).toEqual([]);
		expect(disk.entries.size).toBe(2);
	});
});
