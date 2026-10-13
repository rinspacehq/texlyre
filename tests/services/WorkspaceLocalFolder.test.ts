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

const folder = {
	name: '中文混合目录', kind: 'directory',
	getDirectoryHandle: jest.fn(), getFileHandle: jest.fn(),
	entries: jest.fn(), removeEntry: jest.fn(),
} as unknown as FileSystemDirectoryHandle;

describe('local folder permission without language discovery', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.mocked(ensurePermission).mockResolvedValue(true);
	});
	afterEach(() => jest.restoreAllMocks());
	it('checks permission without scanning filenames, reading source, writing or creating a project', async () => {
		const create = jest.spyOn(authService, 'createProject');
		const store = jest.spyOn(fileStoreService, 'batchStoreFiles');
		await workspaceService.checkFolderAccess(folder);
		expect(ensurePermission).toHaveBeenCalledWith(folder, 'readwrite');
		expect(folder.getDirectoryHandle).not.toHaveBeenCalled();
		expect(folder.getFileHandle).not.toHaveBeenCalled();
		expect(folder.removeEntry).not.toHaveBeenCalled();
		expect(create).not.toHaveBeenCalled();
		expect(store).not.toHaveBeenCalled();
	});
	it('rejects denied permission before project creation', async () => {
		jest.mocked(ensurePermission).mockResolvedValueOnce(false);
		await expect(workspaceService.checkFolderAccess(folder)).rejects.toThrow('Write access');
		expect(folder.getFileHandle).not.toHaveBeenCalled();
	});
	it('rejects cancellation before requesting permission', async () => {
		const controller = new AbortController();
		controller.abort();
		await expect(workspaceService.checkFolderAccess(folder, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
		expect(ensurePermission).not.toHaveBeenCalled();
	});
	it('rejects a late permission result after cancellation', async () => {
		const controller = new AbortController();
		jest.mocked(ensurePermission).mockImplementationOnce(async () => {
			controller.abort();
			return true;
		});
		await expect(workspaceService.checkFolderAccess(folder, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
	});
});
