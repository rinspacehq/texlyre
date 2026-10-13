// SPDX-License-Identifier: AGPL-3.0-or-later
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { deleteDB } from 'idb';
import { FileTreeProvider } from '@src/contexts/FileTreeContext';
import { useFileTree } from '@src/hooks/useFileTree';
import { fileHandlerService } from '@src/services/FileHandlerService';
import { fileStoreService } from '@src/services/FileStoreService';
import { fileConflictPromptService } from '@src/services/FileConflictPromptService';
import { fileOperationNotificationService } from '@src/services/FileOperationNotificationService';
import type { FileNode } from '@src/types/files';

jest.mock('@src/i18n', () => ({ t: (key: string) => key }));
jest.mock('@src/hooks/useCollab', () => ({ useCollab: () => ({ data: null, changeData: jest.fn() }) }));
jest.mock('@src/hooks/useSettings', () => ({ useSettings: () => ({ getSetting: () => undefined }) }));
jest.mock('@src/services/DuplicateKeyDetectionService', () => ({ duplicateKeyDetectionService: { start: jest.fn(), stop: jest.fn() } }));
jest.mock('@src/services/FileOperationNotificationService', () => ({ fileOperationNotificationService: { showError: jest.fn() } }));

const projectId = 'synthetic-file-tree-delete';
const node = (path: string, type: 'file' | 'directory' = 'file'): FileNode => ({
	id: path, name: path.split('/').pop() ?? path, path, type,
	content: type === 'file' ? '保留相邻目录' : undefined, lastModified: 7,
});

function Controls() {
	const { batchDeleteFiles, isLoading } = useFileTree();
	return <button type='button' disabled={isLoading} onClick={() => { void batchDeleteFiles(['/a']); }}>Delete /a</button>;
}

describe('the actual file tree directory deletion action', () => {
	beforeEach(async () => {
		fileHandlerService.detachWorkspace();
		fileStoreService.setProjectId(projectId);
		await fileStoreService.initialize(`yjs:${projectId}`);
		jest.spyOn(fileConflictPromptService, 'confirmBatchDelete').mockResolvedValue('confirm');
		jest.mocked(fileOperationNotificationService.showError).mockClear();
	});
	afterEach(async () => {
		cleanup();
		await fileStoreService.cleanup();
		jest.restoreAllMocks();
		await deleteDB(`texlyre-project-${projectId}`);
	});

	it.each([false, true])('does not select /ab or its linked contents when deleting /a (linked=%s)', async (linked) => {
		const db = fileStoreService.db;
		if (!db) throw new Error('Test storage was not initialized');
		const files = [node('/a', 'directory'), node('/a/intro.tex'), node('/ab', 'directory'), { ...node('/ab/other.tex'), ...(linked ? { documentId: 'unrelated-doc' } : {}) }];
		for (const file of files) await db.put('files', file);
		render(<FileTreeProvider docUrl={`yjs:${projectId}`}><Controls /></FileTreeProvider>);
		const button = screen.getByRole('button', { name: 'Delete /a' });
		await waitFor(() => expect(button).toBeEnabled());
		fireEvent.click(button);
		await waitFor(async () => expect(await db.get('files', '/a')).toMatchObject({ isDeleted: true }));
		expect(await db.get('files', '/a/intro.tex')).toMatchObject({ isDeleted: true });
		expect(await db.get('files', '/ab')).toEqual(files[2]);
		expect(await db.get('files', '/ab/other.tex')).toEqual(files[3]);
		expect(fileOperationNotificationService.showError).not.toHaveBeenCalled();
		expect(fileConflictPromptService.confirmBatchDelete).toHaveBeenCalledWith(expect.arrayContaining([
			expect.objectContaining({ path: '/a' }), expect.objectContaining({ path: '/a/intro.tex' }),
		]));
		expect(jest.mocked(fileConflictPromptService.confirmBatchDelete).mock.calls[0][0]).toHaveLength(2);
	});
});
