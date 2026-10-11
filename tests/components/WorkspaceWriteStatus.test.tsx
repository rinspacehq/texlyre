// SPDX-License-Identifier: AGPL-3.0-or-later
import { act, render, screen, waitFor } from '@testing-library/react';
import WorkspaceStatusIndicator from '@src/components/workspace/WorkspaceStatusIndicator';
import WorkspaceModal from '@src/components/workspace/WorkspaceModal';
import { fileHandlerService } from '@src/services/FileHandlerService';
import { workspaceService, type WorkspaceStatus } from '@src/services/WorkspaceService';
import type { DiskWriteEntry, DiskWriteStatus } from '@src/workspace/DiskWriteResults';

jest.mock('@src/i18n', () => ({ t: (key: string, options?: Record<string, unknown>) =>
	key.replace(/\{(\w+)\}/g, (_match: string, name: string) => String(options?.[name] ?? `{${name}}`)),
}));
jest.mock('@src/services/FileHandlerService', () => ({ fileHandlerService: {
	getWriteStatus: jest.fn(), addWriteStatusListener: jest.fn(), getWorkspaceCleanAnnotations: jest.fn().mockReturnValue(false),
} }));
jest.mock('@src/services/WorkspaceService', () => ({ workspaceService: { getStatus: jest.fn(), addStatusListener: jest.fn() } }));
jest.mock('@src/services/GitFileSystemService', () => ({ gitFileSystemService: {} }));
jest.mock('@src/services/WorkspaceActivityService', () => ({ workspaceActivityService: {
	list: jest.fn().mockResolvedValue([]), addListener: jest.fn(() => () => undefined),
} }));
jest.mock('@src/components/history/GitRemoteStatusIndicator', () => ({ __esModule: true, default: () => null }));

const status: WorkspaceStatus = { isConnected: true, needsPermission: false, projectId: 'local-ui', directoryName: '中文项目', fileCount: 2, lastSyncedAt: null };
const entry = (outcome: DiskWriteEntry['outcome'], path = '/main.typ'): DiskWriteEntry => ({
	fileId: path, path, type: 'file', lastModified: 7, sequence: 1, outcome,
	...(outcome === 'failed' ? { reason: 'write-failed' as const } : {}),
});
const writes = (entries: DiskWriteEntry[], projectId = 'local-ui'): DiskWriteStatus => ({ projectId, targetGeneration: 2, entries });

describe('folder write state in existing workspace controls', () => {
	beforeEach(() => {
		jest.clearAllMocks();
		jest.mocked(workspaceService.getStatus).mockReturnValue(status);
		jest.mocked(workspaceService.addStatusListener).mockReturnValue(() => undefined);
		jest.mocked(fileHandlerService.getWriteStatus).mockReturnValue(writes([]));
		jest.mocked(fileHandlerService.addWriteStatusListener).mockReturnValue(() => undefined);
	});
	it('marks failed writes as danger and reacts to newer pending input', () => {
		render(<WorkspaceStatusIndicator />);
		jest.mocked(fileHandlerService.getWriteStatus).mockReturnValue(writes([entry('failed')]));
		act(() => { for (const [notify] of jest.mocked(fileHandlerService.addWriteStatusListener).mock.calls) notify(fileHandlerService.getWriteStatus()); });
		const badge = screen.getByRole('button', { name: '中文项目' });
		expect(badge).toHaveAttribute('data-tone', 'danger');
		expect(badge).toHaveAttribute('title', '1 folder writes failed. Click to review.');
		jest.mocked(fileHandlerService.getWriteStatus).mockReturnValue(writes([entry('writing')]));
		act(() => { for (const [notify] of jest.mocked(fileHandlerService.addWriteStatusListener).mock.calls) notify(fileHandlerService.getWriteStatus()); });
		expect(badge).toHaveAttribute('title', 'Writing 1 paths to the folder');
	});
	it('lists partial failures separately from completed writes without claiming a project-wide save', async () => {
		jest.mocked(fileHandlerService.getWriteStatus).mockReturnValue(writes([entry('written'), entry('failed', '/资源/asset.dat')]));
		render(<WorkspaceModal isOpen status={status} onClose={jest.fn()} />);
		expect(screen.getByRole('alert')).toHaveTextContent('/资源/asset.dat');
		expect(screen.getByText(/Completed 1 individual folder writes/)).toHaveTextContent('not a project-wide save confirmation');
		expect(screen.getByRole('checkbox')).not.toBeChecked();
		await waitFor(() => expect(screen.getByText('No activity recorded yet')).toBeInTheDocument());
	});
	it('never attributes another project write failure to the current folder', () => {
		jest.mocked(fileHandlerService.getWriteStatus).mockReturnValue(writes([entry('failed')], 'other-project'));
		render(<WorkspaceStatusIndicator />);
		expect(screen.getByRole('button', { name: '中文项目' })).not.toHaveAttribute('data-tone', 'danger');
	});
	it('updates the existing annotation preference from its external store without an effect rehydration', async () => {
		render(<WorkspaceModal isOpen status={status} onClose={jest.fn()} />);
		expect(screen.getByRole('checkbox')).not.toBeChecked();
		jest.mocked(fileHandlerService.getWorkspaceCleanAnnotations).mockReturnValue(true);
		act(() => document.dispatchEvent(new Event('workspace-annotation-preference-changed')));
		expect(screen.getByRole('checkbox')).toBeChecked();
		await waitFor(() => expect(screen.getByText('No activity recorded yet')).toBeInTheDocument());
		jest.mocked(fileHandlerService.getWorkspaceCleanAnnotations).mockReturnValue(false);
	});
});
