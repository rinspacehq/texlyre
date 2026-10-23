// SPDX-License-Identifier: AGPL-3.0-or-later
import { FileStoreService, fileStoreService } from '@src/services/FileStoreService';
import { ProjectDataService } from '@src/services/ProjectDataService';
import type { Project } from '@src/types/projects';

jest.mock('@src/services/AuthService', () => ({ authService: {} }));

describe('project export storage isolation', () => {
	beforeEach(() => {
		const FDBFactory = require('fake-indexeddb/lib/FDBFactory');
		global.indexedDB = new FDBFactory();
		fileStoreService.cleanup();
	});

	afterEach(() => fileStoreService.cleanup());

	it('reads another project without changing the active editor file database', async () => {
		await fileStoreService.initialize('yjs:active-project');
		await fileStoreService.db!.put('files', {
			id: 'active-main', name: 'main.tex', path: '/main.tex', type: 'file',
			content: 'active source', lastModified: 1, isBinary: false,
		});
		const other = new FileStoreService();
		await other.initialize('yjs:other-project');
		await other.db!.put('files', {
			id: 'other-main', name: 'main.tex', path: '/main.tex', type: 'file',
			content: 'other source', lastModified: 1, isBinary: false,
		});
		other.cleanup();

		const project = {
			id: 'other-project', name: 'Other', description: '', type: 'latex',
			docUrl: 'yjs:other-project', createdAt: 1, updatedAt: 1,
			ownerId: 'test', tags: [], isFavorite: false,
		} satisfies Project;
		const result = await new ProjectDataService().serializeProjectFiles(project);
		expect(result.fileContents.get('/main.tex')).toBe('other source');
		expect(fileStoreService.getCurrentProjectId()).toBe('active-project');
		expect((await fileStoreService.getFile('active-main'))?.content).toBe('active source');
	});
});
