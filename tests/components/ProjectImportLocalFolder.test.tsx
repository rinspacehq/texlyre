// SPDX-License-Identifier: AGPL-3.0-or-later
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectImportModal from '@src/components/project/ProjectImportModal';
import { authService } from '@src/services/AuthService';
import { workspaceService } from '@src/services/WorkspaceService';

jest.mock('@src/i18n', () => ({ t: (key: string) => key }));
jest.mock('@src/services/AuthService', () => ({ authService: { createProject: jest.fn() } }));
jest.mock('@src/services/WorkspaceService', () => ({ workspaceService: {
	isSupported: jest.fn(), pickFolder: jest.fn(), checkFolderAccess: jest.fn(), link: jest.fn(),
} }));
jest.mock('@src/services/ProjectImportService', () => ({ projectImportService: {} }));
jest.mock('@src/components/project/TemplateImportModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@src/components/project/UrlImportModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@src/components/project/YjsLinkImportModal', () => ({ __esModule: true, default: () => null }));

const handle = { name: '中文项目' } as FileSystemDirectoryHandle;
const docUrl = 'yjs:12345678-1234-4234-9234-123456789abc';

describe('direct local folder import', () => {
	const callbacks = { onClose: jest.fn(), onProjectsImported: jest.fn(), onOpenProject: jest.fn() };
	beforeEach(() => {
		jest.clearAllMocks();
		jest.mocked(workspaceService.isSupported).mockReturnValue(true);
		jest.mocked(workspaceService.pickFolder).mockResolvedValue(handle);
		jest.mocked(workspaceService.checkFolderAccess).mockResolvedValue(undefined);
		jest.mocked(authService.createProject).mockImplementation(async (input) => ({
			...input, id: docUrl.slice(4), docUrl, ownerId: 'local-fixture', createdAt: 1, updatedAt: 1,
		}));
		jest.mocked(workspaceService.link).mockResolvedValue(undefined);
	});
	const startOpen = async () => {
		const user = userEvent.setup();
		render(<ProjectImportModal isOpen {...callbacks} />);
		await user.click(screen.getByRole('button', { name: /From a Folder on This Device/ }));
		return user;
	};
	it('opens the authorized directory immediately, without format, entry, scan or compile parameters', async () => {
		await startOpen();
		await waitFor(() => expect(callbacks.onOpenProject).toHaveBeenCalledWith(docUrl));
		expect(workspaceService.checkFolderAccess).toHaveBeenCalledWith(handle, expect.any(AbortSignal));
		expect(workspaceService.link).toHaveBeenCalledWith(docUrl.slice(4), handle);
		expect(authService.createProject).toHaveBeenCalledWith(expect.objectContaining({
			name: handle.name, type: 'files', group: 'files',
		}));
		const input = jest.mocked(authService.createProject).mock.calls[0][0];
		expect(input.mainFile).toBeUndefined();
		expect(input.compilerId).toBeUndefined();
		expect(input.lastOpenedFilePath).toBeUndefined();
		expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
		expect(screen.queryByLabelText('Local project format')).not.toBeInTheDocument();
		expect(screen.queryByLabelText('Entry file')).not.toBeInTheDocument();
		expect(callbacks.onProjectsImported).toHaveBeenCalledTimes(1);
		expect(callbacks.onClose).toHaveBeenCalledTimes(1);
	});
	it.each(['mixed LaTeX Typst Markdown', 'empty folder', 'images and bibliography only'])(
		'does not inspect or require a compile target for %s', async (name) => {
			const selected = { name, kind: 'directory' } as FileSystemDirectoryHandle;
			jest.mocked(workspaceService.pickFolder).mockResolvedValue(selected);
			await startOpen();
			await waitFor(() => expect(callbacks.onOpenProject).toHaveBeenCalledWith(docUrl));
			expect(workspaceService.link).toHaveBeenCalledWith(docUrl.slice(4), selected);
			expect(jest.mocked(authService.createProject).mock.calls[0][0].mainFile).toBeUndefined();
		},
	);
	it('does not treat a cancelled picker as an error or create a project', async () => {
		jest.mocked(workspaceService.pickFolder).mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
		await startOpen();
		await waitFor(() => expect(screen.queryByText('Scanning for projects...')).not.toBeInTheDocument());
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
		expect(authService.createProject).not.toHaveBeenCalled();
		expect(workspaceService.checkFolderAccess).not.toHaveBeenCalled();
	});
	it('accepts a null picker result without affecting the current project', async () => {
		jest.mocked(workspaceService.pickFolder).mockResolvedValue(null);
		await startOpen();
		await waitFor(() => expect(screen.queryByText('Scanning for projects...')).not.toBeInTheDocument());
		expect(authService.createProject).not.toHaveBeenCalled();
		expect(callbacks.onOpenProject).not.toHaveBeenCalled();
	});
	it('checks permission before creation and retries the same handle without a language review', async () => {
		jest.mocked(workspaceService.checkFolderAccess).mockRejectedValueOnce(new Error('Write access denied'));
		const user = await startOpen();
		expect(await screen.findByRole('alert')).toHaveTextContent('Write access denied');
		expect(authService.createProject).not.toHaveBeenCalled();
		expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Retry Opening Folder' }));
		await waitFor(() => expect(callbacks.onOpenProject).toHaveBeenCalledWith(docUrl));
		expect(workspaceService.pickFolder).toHaveBeenCalledTimes(1);
		expect(authService.createProject).toHaveBeenCalledTimes(1);
	});
	it('reuses the recovery project when linking fails instead of creating duplicates on retry', async () => {
		jest.mocked(workspaceService.link).mockRejectedValueOnce(new Error('Handle store failed'));
		const user = await startOpen();
		expect(await screen.findByRole('alert')).toHaveTextContent('Handle store failed');
		expect(callbacks.onOpenProject).not.toHaveBeenCalled();
		expect(screen.getByText(/The browser project was created/)).toBeInTheDocument();
		await user.click(screen.getByRole('button', { name: 'Retry Opening Folder' }));
		await waitFor(() => expect(callbacks.onOpenProject).toHaveBeenCalledTimes(1));
		expect(authService.createProject).toHaveBeenCalledTimes(1);
		expect(callbacks.onProjectsImported).toHaveBeenCalledTimes(1);
		expect(workspaceService.link).toHaveBeenCalledTimes(2);
	});
	it('does not hide an aborted storage transaction as a cancelled picker', async () => {
		jest.mocked(workspaceService.link).mockRejectedValueOnce(new DOMException('Storage transaction aborted', 'AbortError'));
		await startOpen();
		expect(await screen.findByRole('alert')).toHaveTextContent('Storage transaction aborted');
		expect(callbacks.onOpenProject).not.toHaveBeenCalled();
		expect(screen.getByText(/The browser project was created/)).toBeInTheDocument();
	});
	it('ignores a late picker after the modal is closed', async () => {
		let resolvePicker: ((value: FileSystemDirectoryHandle) => void) | undefined;
		jest.mocked(workspaceService.pickFolder).mockImplementation(() => new Promise((resolve) => { resolvePicker = resolve; }));
		const user = await startOpen();
		await user.click(screen.getByRole('button', { name: 'Close modal' }));
		await act(async () => resolvePicker?.(handle));
		expect(callbacks.onClose).toHaveBeenCalledTimes(1);
		expect(workspaceService.checkFolderAccess).not.toHaveBeenCalled();
		expect(authService.createProject).not.toHaveBeenCalled();
		expect(callbacks.onOpenProject).not.toHaveBeenCalled();
	});
	it('aborts pending permission on unmount and ignores its late result', async () => {
		let resolvePermission: (() => void) | undefined;
		jest.mocked(workspaceService.checkFolderAccess).mockImplementation(() => new Promise((resolve) => { resolvePermission = resolve; }));
		const user = userEvent.setup();
		const view = render(<ProjectImportModal isOpen {...callbacks} />);
		await user.click(screen.getByRole('button', { name: /From a Folder on This Device/ }));
		await waitFor(() => expect(workspaceService.checkFolderAccess).toHaveBeenCalled());
		const signal = jest.mocked(workspaceService.checkFolderAccess).mock.calls[0][1];
		view.unmount();
		expect(signal?.aborted).toBe(true);
		await act(async () => resolvePermission?.());
		expect(authService.createProject).not.toHaveBeenCalled();
		expect(callbacks.onOpenProject).not.toHaveBeenCalled();
	});
	it('does not open two projects on repeated clicks while permission is pending', async () => {
		let resolvePermission: (() => void) | undefined;
		jest.mocked(workspaceService.checkFolderAccess).mockImplementation(() => new Promise((resolve) => { resolvePermission = resolve; }));
		const user = userEvent.setup();
		render(<ProjectImportModal isOpen {...callbacks} />);
		await user.dblClick(screen.getByRole('button', { name: /From a Folder on This Device/ }));
		await waitFor(() => expect(workspaceService.checkFolderAccess).toHaveBeenCalledTimes(1));
		await act(async () => resolvePermission?.());
		await waitFor(() => expect(callbacks.onOpenProject).toHaveBeenCalledTimes(1));
		expect(authService.createProject).toHaveBeenCalledTimes(1);
		expect(workspaceService.pickFolder).toHaveBeenCalledTimes(1);
	});
	it('explains the unsupported API without claiming downloads save back to the original folder', () => {
		jest.mocked(workspaceService.isSupported).mockReturnValue(false);
		render(<ProjectImportModal isOpen {...callbacks} />);
		expect(screen.queryByRole('button', { name: /From a Folder on This Device/ })).not.toBeInTheDocument();
		expect(screen.getByText(/downloads do not update the original folder/)).toBeInTheDocument();
	});
});
