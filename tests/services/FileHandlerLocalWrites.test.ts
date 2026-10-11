// SPDX-License-Identifier: AGPL-3.0-or-later
import { deleteDB } from 'idb';
import { deserialize, serialize } from 'node:v8';
import { fileHandlerService } from '@src/services/FileHandlerService';
import { fileStoreService } from '@src/services/FileStoreService';
import { DirectoryTarget } from '@src/services/WriteTargetService';
import type { FileNode } from '@src/types/files';

jest.mock('@src/i18n', () => ({ t: (key: string) => key }));

const projectId = 'synthetic-local-write';
const annotation = "Intro `<### comment id: c1, user: a, time: 1, content64: 'aGk=', responses: [], resolved: false ###>`text`</### comment id: c1 ###>`";
const file = (path = '/main.typ', content: string | ArrayBuffer = '中文源码'): FileNode => ({
	id: path, name: path.split('/').pop() ?? path, path, type: 'file', content, lastModified: 7,
});
const deferred = () => {
	let resolve: () => void = () => undefined;
	const promise = new Promise<void>((done) => { resolve = done; });
	return { promise, resolve };
};

/** Synthetic handles execute the real DirectoryTarget write/close/abort implementation. */
function directory(onClose?: (path: string) => Promise<void>) {
	const bytes = new Map<string, string | ArrayBuffer>();
	const handles = new Map<string, ReturnType<typeof makeFile>>();
	const makeFile = (path: string) => {
		let pending: string | ArrayBuffer = '';
		const write = jest.fn(async (content: string | ArrayBuffer) => { pending = content; });
		const close = jest.fn(async () => {
			await onClose?.(path);
			bytes.set(path, pending);
		});
		const abort = jest.fn().mockResolvedValue(undefined);
		return {
			kind: 'file' as const, name: path.split('/').pop(), write, close, abort,
			queryPermission: jest.fn().mockResolvedValue('granted'),
			requestPermission: jest.fn().mockResolvedValue('granted'),
			createWritable: jest.fn().mockResolvedValue({ write, close, abort }),
			getFile: jest.fn(async () => {
				const content = bytes.get(path) ?? '';
				return {
					lastModified: 100, size: typeof content === 'string' ? new TextEncoder().encode(content).byteLength : content.byteLength,
					text: async () => typeof content === 'string' ? content : new TextDecoder().decode(content),
					arrayBuffer: async () => typeof content === 'string' ? new TextEncoder().encode(content).buffer : content,
				};
			}),
		};
	};
	const makeDirectory = (path: string): FileSystemDirectoryHandle => ({
		kind: 'directory', name: path.split('/').pop() ?? 'synthetic-folder',
		getDirectoryHandle: jest.fn(async (name: string) => makeDirectory(`${path}/${name}`)),
		getFileHandle: jest.fn(async (name: string) => {
			const key = `${path}/${name}`;
			if (!handles.has(key)) handles.set(key, makeFile(key));
			return handles.get(key);
		}),
	} as unknown as FileSystemDirectoryHandle);
	const root = makeDirectory('');
	return { root, adapter: new DirectoryTarget(root), handles, bytes };
}

describe('persistent-local disk write results', () => {
	beforeEach(() => {
		localStorage.clear();
		window.history.replaceState(null, '', '/');
		fileStoreService.setProjectId(projectId);
		fileHandlerService.detachWorkspace();
	});
	afterEach(async () => {
		fileHandlerService.detachWorkspace();
		fileStoreService.cleanup();
		jest.restoreAllMocks();
		await deleteDB(`texlyre-project-${projectId}`);
	});

	it('preserves exact annotations by default, with explicit cleaning still available', async () => {
		const disk = directory();
		fileHandlerService.attachWorkspace(disk.adapter, projectId);
		expect(fileHandlerService.getWorkspaceCleanAnnotations(projectId)).toBe(false);
		await fileHandlerService.writeBack(file(), annotation);
		expect(await disk.adapter.readFile('/main.typ')).toBe(annotation);
		fileHandlerService.setWorkspaceCleanAnnotations(projectId, true);
		await fileHandlerService.writeBack(file(), annotation);
		expect(await disk.adapter.readFile('/main.typ')).not.toContain('### comment');
	});
	it('also preserves source annotations for directly launched files', async () => {
		const disk = directory();
		const handle = await disk.root.getFileHandle('main.tex');
		await fileHandlerService.writeBack({ ...file('/main.tex'), launchHandle: handle }, annotation);
		expect(disk.bytes.get('/main.tex')).toBe(annotation);
	});
	it('returns partial results and keeps the original close error instead of false success', async () => {
		const failure = new DOMException('Synthetic disk full', 'QuotaExceededError');
		const disk = directory(async (path) => { if (path === '/bad.typ') throw failure; });
		fileHandlerService.attachWorkspace(disk.adapter, projectId);
		const report = await fileHandlerService.mirrorFiles([file('/ok.typ'), file('/bad.typ'), file('/later.typ')]);
		expect(report.entries.map((entry) => entry.outcome)).toEqual(['written', 'failed', 'written']);
		expect(report.entries[1]).toMatchObject({ reason: 'write-failed', error: failure, lastModified: 7 });
		expect(disk.handles.get('/bad.typ')?.abort).toHaveBeenCalledTimes(1);
		expect(disk.bytes.has('/bad.typ')).toBe(false);
		expect(report.projectId).toBe(projectId);
		expect(Object.isFrozen(report.entries)).toBe(true);
	});
	it('reports denied launch permission without prompting or creating a writable stream', async () => {
		const disk = directory();
		const handle = await disk.root.getFileHandle('main.tex');
		const fixture = disk.handles.get('/main.tex');
		fixture?.queryPermission.mockResolvedValue('denied');
		const result = await fileHandlerService.writeBackResult({ ...file('/main.tex'), launchHandle: handle }, 'source');
		expect(result.outcome).toBe('failed');
		expect(fixture?.createWritable).not.toHaveBeenCalled();
		expect(fixture?.requestPermission).not.toHaveBeenCalled();
	});
	it('never writes protected or traversing paths, while preserving Git attributes and prefix names', async () => {
		const disk = directory();
		fileHandlerService.attachWorkspace(disk.adapter, projectId);
		const paths = ['/.git/config', '/章节/.git', '/node_modules/a', '/.texlyre/x', '/../bad.typ', '/.gitignore', '/.gitattributes', '/node_modules-not-dependencies/readme.md'];
		const report = await fileHandlerService.mirrorFiles(paths.map((path) => file(path)));
		expect(report.entries.map((entry) => entry.outcome)).toEqual(['skipped', 'skipped', 'skipped', 'skipped', 'failed', 'written', 'written', 'written']);
		expect([...disk.bytes.keys()]).toEqual(paths.slice(5));
	});
	it('rejects duplicate output paths rather than silently choosing one source', async () => {
		const disk = directory(); fileHandlerService.attachWorkspace(disk.adapter, projectId);
		const report = await fileHandlerService.mirrorFiles([file('/main.typ', 'first'), file('/main.typ', 'second')]);
		expect(report.entries.map((entry) => entry.reason)).toEqual(['duplicate-path', 'duplicate-path']);
		expect(disk.bytes.size).toBe(0);
	});
	it('copies every binary before awaits and does not replace a newer pending state with an older completion', async () => {
		const entered = deferred(); const release = deferred(); const nextEntered = deferred(); const releaseNext = deferred();
		let calls = 0;
		const disk = directory(async () => {
			if (++calls === 1) { entered.resolve(); await release.promise; }
			else { nextEntered.resolve(); await releaseNext.promise; }
		});
		fileHandlerService.attachWorkspace(disk.adapter, projectId);
		const binary = Uint8Array.of(0, 255, 128, 13, 10);
		const input = file('/asset.dat', binary.buffer);
		const first = fileHandlerService.mirrorFiles([input]);
		await entered.promise;
		binary.fill(1); input.path = '/changed.dat'; input.lastModified = 999;
		const second = fileHandlerService.mirrorFiles([{ ...file('/asset.dat', 'newer'), lastModified: 8 }]);
		release.resolve();
		const oldReport = await first;
		await nextEntered.promise;
		try {
			expect(oldReport.entries[0]).toMatchObject({ path: '/asset.dat', lastModified: 7, outcome: 'written' });
			expect(new Uint8Array(disk.bytes.get('/asset.dat') as ArrayBuffer)).toEqual(Uint8Array.of(0, 255, 128, 13, 10));
			expect(fileHandlerService.getWriteStatus().entries[0]).toMatchObject({ lastModified: 8, outcome: 'writing' });
		} finally { releaseNext.resolve(); await second; }
		expect(fileHandlerService.getWriteStatus().entries[0]).toMatchObject({ lastModified: 8, outcome: 'written' });
		expect(disk.bytes.has('/changed.dat')).toBe(false);
	});
	it('cancels unexecuted old-target work without writing to a newly attached folder', async () => {
		const entered = deferred(); const release = deferred();
		const oldDisk = directory(async () => { entered.resolve(); await release.promise; });
		const newDisk = directory();
		fileHandlerService.attachWorkspace(oldDisk.adapter, projectId);
		const pending = fileHandlerService.mirrorFiles([file('/first.typ'), file('/not-started.typ')]);
		await entered.promise;
		fileHandlerService.attachWorkspace(newDisk.adapter, 'other-project');
		release.resolve();
		const report = await pending;
		expect(report.entries.map((entry) => entry.outcome)).toEqual(['written', 'failed']);
		expect(report.entries[1].reason).toBe('target-changed');
		expect(newDisk.bytes.size).toBe(0);
		expect(oldDisk.bytes.has('/not-started.typ')).toBe(false);
		expect(fileHandlerService.getWriteStatus().entries).toEqual([]);
	});
	it('does not write a newly initialized project through a stale attached directory', async () => {
		const disk = directory(); fileHandlerService.attachWorkspace(disk.adapter, projectId);
		fileStoreService.setProjectId('new-project');
		const report = await fileHandlerService.mirrorFiles([file()]);
		expect(report.projectId).toBe('new-project');
		expect(report.entries[0]).toMatchObject({ outcome: 'failed', reason: 'target-changed' });
		expect(disk.bytes.size).toBe(0);
	});
	it('does not report a directory creation failure or a suppressed mirror as written', async () => {
		const disk = directory();
		jest.spyOn(disk.adapter, 'createDirectory').mockRejectedValue(new Error('Synthetic denied directory'));
		fileHandlerService.attachWorkspace(disk.adapter, projectId);
		const node: FileNode = { ...file('/chapter'), type: 'directory', content: undefined };
		const report = await fileHandlerService.mirrorFiles([node]);
		expect(report.entries[0].outcome).toBe('failed');
		const suppressed = await fileHandlerService.withoutMirroring(() => fileHandlerService.mirrorFiles([file()]));
		expect(suppressed.entries[0]).toMatchObject({ outcome: 'skipped', reason: 'suppressed' });
		expect(disk.bytes.size).toBe(0);
	});
	it('distinguishes completed close from an unavailable metadata baseline', async () => {
		const disk = directory();
		jest.spyOn(disk.adapter, 'stat').mockRejectedValue(new Error('Synthetic metadata denied'));
		fileHandlerService.attachWorkspace(disk.adapter, projectId);
		const result = await fileHandlerService.writeBackResult(file(), 'source');
		expect(result).toMatchObject({ outcome: 'written', baselineAvailable: false });
	});
	it('does not allow failing observers to turn an actual write into a reported failure', async () => {
		const disk = directory(); fileHandlerService.attachWorkspace(disk.adapter, projectId);
		const remove = fileHandlerService.addWriteListener(() => { throw new Error('Synthetic observer failure'); });
		try { expect(await fileHandlerService.writeBack(file(), 'source')).toBe(true); } finally { remove(); }
	});
	it('keeps the actual FileStore transaction and raw binary available after a disk failure', async () => {
		// The inherited global JSON structuredClone shim cannot preserve binary IDB rows.
		jest.spyOn(globalThis, 'structuredClone').mockImplementation(<T,>(value: T): T => deserialize(serialize(value)));
		await fileStoreService.initialize(`yjs:${projectId}`);
		const disk = directory(async (path) => { if (path === '/asset.dat') throw new Error('Synthetic close failure'); });
		fileHandlerService.attachWorkspace(disk.adapter, projectId);
		const binary = Uint8Array.of(0, 255, 128, 13, 10);
		const notifications: string[] = [];
		const remove = fileHandlerService.addWriteListener((report) => notifications.push(...report.entries.filter((entry) => entry.outcome === 'failed').map((entry) => entry.path)));
		try {
			await fileStoreService.batchStoreFiles([file('/main.typ', annotation), file('/asset.dat', binary.buffer)], { showConflictDialog: false, preserveTimestamp: true });
			fileStoreService.cleanup();
			await fileStoreService.initialize(`yjs:${projectId}`);
			expect((await fileStoreService.getFile('/main.typ'))?.content).toBe(annotation);
			expect(new Uint8Array((await fileStoreService.getFile('/asset.dat'))?.content as ArrayBuffer)).toEqual(binary);
			expect(notifications).toEqual(['/asset.dat']);
		} finally { remove(); }
	});
});
