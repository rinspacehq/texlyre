// SPDX-License-Identifier: AGPL-3.0-or-later
import { act, renderHook } from '@testing-library/react';
import { useDiskFiles } from '@src/hooks/useDiskFiles';
import { fileHandlerService } from '@src/services/FileHandlerService';
import { notificationService } from '@src/services/NotificationService';
import type { DiskWriteReport } from '@src/workspace/DiskWriteResults';

jest.mock('@src/i18n', () => ({ t: (key: string) => key }));
jest.mock('@src/services/FileHandlerService', () => ({ fileHandlerService: {
	initialize: jest.fn(), addLaunchListener: jest.fn(() => () => undefined),
	addWriteListener: jest.fn(() => () => undefined), getWriteStatus: jest.fn(() => ({ targetGeneration: 2 })),
	isSupported: jest.fn(() => false), hasWorkspace: jest.fn(() => false), getLinkedIds: jest.fn(() => []),
} }));
jest.mock('@src/services/WorkspaceService', () => ({ workspaceService: { restore: jest.fn().mockResolvedValue(false), deactivate: jest.fn() } }));
jest.mock('@src/services/FileStoreService', () => ({ fileStoreService: { initialize: jest.fn().mockResolvedValue(undefined) } }));
jest.mock('@src/services/NotificationService', () => ({ notificationService: { showError: jest.fn() } }));

const report = (outcome: 'failed' | 'written', projectId = 'local-notify', targetGeneration = 2): DiskWriteReport => ({
	projectId, targetGeneration, sequence: 1,
	entries: [{ fileId: 'file', path: '/main.typ', type: 'file', lastModified: 7, sequence: 1, outcome }],
});

describe('disk failure notifications at the actual app hook', () => {
	beforeEach(() => jest.clearAllMocks());
	it('warns on a current project write failure without claiming browser durability or disk success', () => {
		renderHook(() => useDiskFiles('yjs:local-notify'));
		const notify = jest.mocked(fileHandlerService.addWriteListener).mock.calls[0][0];
		act(() => notify(report('failed')));
		expect(notificationService.showError).toHaveBeenCalledWith(expect.stringContaining('Browser data has not been rolled back'));
		expect(notificationService.showError).toHaveBeenCalledWith(expect.not.stringContaining('{count}'));
	});
	it('does not show an error for successful writes or obsolete target/project results', () => {
		renderHook(() => useDiskFiles('yjs:local-notify'));
		const notify = jest.mocked(fileHandlerService.addWriteListener).mock.calls[0][0];
		act(() => {
			notify(report('written'));
			notify(report('failed', 'another-project'));
			notify(report('failed', 'local-notify', 1));
		});
		expect(notificationService.showError).not.toHaveBeenCalled();
	});
	it('explains an external folder edit while retaining the browser draft', () => {
		renderHook(() => useDiskFiles('yjs:local-notify'));
		const notify = jest.mocked(fileHandlerService.addWriteListener).mock.calls[0][0];
		act(() => notify({ ...report('failed'), entries: [{ ...report('failed').entries[0], reason: 'disk-changed' }] }));
		expect(notificationService.showError).toHaveBeenCalledWith(expect.stringContaining('browser draft was retained'));
	});
});
