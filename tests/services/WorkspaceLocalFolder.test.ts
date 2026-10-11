// SPDX-License-Identifier: AGPL-3.0-or-later
import { workspaceService } from '@src/services/WorkspaceService';
import { ensurePermission } from '@src/services/DiskHandleStore';
import { fileStoreService } from '@src/services/FileStoreService';
import { authService } from '@src/services/AuthService';

jest.mock('@src/i18n', () => ({ t: (key: string) => key }));
jest.mock('@src/services/DiskHandleStore', () => ({
	...jest.requireActual('@src/services/DiskHandleStore'),
	ensurePermission: jest.fn().mockResolvedValue(true),
}));

interface DirectoryFixture extends FileSystemDirectoryHandle {
	entries(): AsyncIterable<[string, FileSystemHandle]>;
}

function folder(name: string, children: FileSystemHandle[]): DirectoryFixture {
	return {
		name, kind: 'directory',
		entries: async function* () { for (const child of children) yield [child.name, child]; },
		getDirectoryHandle: jest.fn(async (childName: string) => {
			const child = children.find((entry) => entry.name === childName && entry.kind === 'directory');
			if (!child) throw new DOMException('Missing directory', 'NotFoundError');
			return child;
		}),
		getFileHandle: jest.fn(async (childName: string) => {
			const child = children.find((entry) => entry.name === childName && entry.kind === 'file');
			if (!child) throw new DOMException('Missing entry', 'NotFoundError');
			return child;
		}),
	} as unknown as DirectoryFixture;
}
function file(name: string): FileSystemFileHandle {
	return { name, kind: 'file', getFile: jest.fn(), createWritable: jest.fn() } as unknown as FileSystemFileHandle;
}

describe('filename-only local folder review', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.mocked(ensurePermission).mockResolvedValue(true);
	});
	afterEach(() => jest.restoreAllMocks());
	it('uses relative paths, skips protected folders and never reads source or creates projects', async () => {
		const entry = file('文档.typ');
		const chapter = folder('章节', [entry]);
		const git = folder('.git', [file('secret.tex')]);
		const root = folder('中文文件夹', [chapter, git, file('image.png')]);
		const create = jest.spyOn(authService, 'createProject');
		const store = jest.spyOn(fileStoreService, 'batchStoreFiles');
		const discovery = await workspaceService.inspectFolder(root);
		expect(discovery.entryPoints.typst).toEqual(['/章节/文档.typ']);
		expect(discovery.fileCount).toBe(2);
		expect(ensurePermission).toHaveBeenCalledWith(root, 'read', false);
		expect(root.getDirectoryHandle).not.toHaveBeenCalledWith('.git');
		expect(entry.getFile).not.toHaveBeenCalled();
		expect(entry.createWritable).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
		expect(store).not.toHaveBeenCalled();
		const selection = await workspaceService.validateFolderSelection(root, discovery, 'typst', '/章节/文档.typ');
		expect(selection.compilerId).toBe('internal:typst');
		expect(chapter.getFileHandle).toHaveBeenCalledWith('文档.typ');
		expect(entry.getFile).not.toHaveBeenCalled();
	});
	it('rejects denied read/write permission without constructing a project', async () => {
		const root = folder('paper', [file('main.tex')]);
		jest.mocked(ensurePermission).mockResolvedValueOnce(false);
		await expect(workspaceService.inspectFolder(root)).rejects.toThrow('Read access');
		const discovery = await workspaceService.inspectFolder(root);
		jest.mocked(ensurePermission).mockResolvedValueOnce(false);
		await expect(workspaceService.validateFolderSelection(root, discovery, 'latex', '/main.tex')).rejects.toThrow('Write access');
		expect(root.getFileHandle).not.toHaveBeenCalled();
	});
	it('checks entry existence again before project creation and does not hide stale handles', async () => {
		const children = [file('main.tex')];
		const root = folder('paper', children);
		const discovery = await workspaceService.inspectFolder(root);
		children.splice(0);
		await expect(workspaceService.validateFolderSelection(root, discovery, 'latex', '/main.tex')).rejects.toMatchObject({ name: 'NotFoundError' });
	});
	it('fails an aborted discovery rather than returning partial candidates', async () => {
		const root = folder('paper', [file('main.tex')]);
		const controller = new AbortController(); controller.abort();
		await expect(workspaceService.inspectFolder(root, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
	});
});
