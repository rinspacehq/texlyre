// SPDX-License-Identifier: AGPL-3.0-or-later
import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ProjectImportModal from '@src/components/project/ProjectImportModal';
import { authService } from '@src/services/AuthService';
import { workspaceService } from '@src/services/WorkspaceService';
import type { LocalProjectDiscovery } from '@src/workspace/LocalProjectDiscovery';
import { selectLocalProject } from '@src/workspace/LocalProjectDiscovery';

jest.mock('@src/i18n', () => ({ t: (key: string) => key }));
jest.mock('@src/services/AuthService', () => ({ authService: { createProject: jest.fn() } }));
jest.mock('@src/services/WorkspaceService', () => ({ workspaceService: {
	isSupported: jest.fn(), pickFolder: jest.fn(), inspectFolder: jest.fn(),
	validateFolderSelection: jest.fn(), link: jest.fn(),
} }));
jest.mock('@src/services/ProjectImportService', () => ({ projectImportService: {} }));
jest.mock('@src/components/project/TemplateImportModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@src/components/project/UrlImportModal', () => ({ __esModule: true, default: () => null }));
jest.mock('@src/components/project/YjsLinkImportModal', () => ({ __esModule: true, default: () => null }));

const handle = { name: '中文项目' } as FileSystemDirectoryHandle;
const discovery: LocalProjectDiscovery = {
	fileCount: 4, suggestedKind: null,
	entryPoints: { latex: ['/main.tex', '/章节/内容.tex'], typst: ['/main.typ'], markdown: ['/README.md'] },
};
const docUrl = 'yjs:12345678-1234-4234-9234-123456789abc';

describe('local folder import component', () => {
	const callbacks = { onClose: jest.fn(), onProjectsImported: jest.fn(), onOpenProject: jest.fn() };
	beforeEach(() => {
		jest.clearAllMocks();
		jest.mocked(workspaceService.isSupported).mockReturnValue(true);
		jest.mocked(workspaceService.pickFolder).mockResolvedValue(handle);
		jest.mocked(workspaceService.inspectFolder).mockResolvedValue(discovery);
		jest.mocked(workspaceService.validateFolderSelection).mockImplementation(async (_handle, found, kind, mainFile) =>
			selectLocalProject(found, kind, mainFile));
		jest.mocked(authService.createProject).mockImplementation(async (input) => ({
			...input, id: docUrl.slice(4), docUrl, ownerId: 'local-fixture', createdAt: 1, updatedAt: 1,
		}));
		jest.mocked(workspaceService.link).mockResolvedValue(undefined);
	});
	const startReview = async () => {
		const user = userEvent.setup();
		render(<ProjectImportModal isOpen {...callbacks} />);
		await user.click(screen.getByRole('button', { name: /From a Folder on This Device/ }));
		await screen.findByLabelText('Local project format');
		return user;
	};
	it('does not create or link a project before the mixed-format review is confirmed', async () => {
		await startReview();
		expect(authService.createProject).not.toHaveBeenCalled();
		expect(workspaceService.link).not.toHaveBeenCalled();
		expect(screen.getByRole('button', { name: 'Open Local Folder' })).toBeDisabled();
	});
	it.each(['latex', 'typst', 'markdown'] as const)('opens the selected %s entry through the host callback without adding a compile trigger', async (kind) => {
		const user = await startReview();
		await user.selectOptions(screen.getByLabelText('Local project format'), kind);
		const entry = kind === 'latex' ? '/章节/内容.tex' : discovery.entryPoints[kind][0];
		await user.selectOptions(screen.getByLabelText('Entry file'), entry);
		await user.click(screen.getByRole('button', { name: 'Open Local Folder' }));
		await waitFor(() => expect(callbacks.onOpenProject).toHaveBeenCalledWith(`${docUrl}&file:${encodeURIComponent(entry)}`));
		expect(authService.createProject).toHaveBeenCalledWith(expect.objectContaining({
			type: kind, mainFile: entry, lastOpenedFilePath: entry,
		}));
		const input = jest.mocked(authService.createProject).mock.calls[0][0];
		expect(input.compilerId).toBe(kind === 'markdown' ? undefined : `internal:${kind}`);
		expect(callbacks.onClose).toHaveBeenCalledTimes(1);
	});
	it('keeps an unknown folder files-only without requiring a manifest or compiler', async () => {
		jest.mocked(workspaceService.inspectFolder).mockResolvedValue({
			fileCount: 1, suggestedKind: 'files', entryPoints: { latex: [], typst: [], markdown: [] },
		});
		const user = await startReview();
		await user.click(screen.getByRole('button', { name: 'Open Local Folder' }));
		await waitFor(() => expect(callbacks.onOpenProject).toHaveBeenCalledWith(docUrl));
		expect(jest.mocked(authService.createProject).mock.calls[0][0].type).toBe('files');
	});
	it('cancels the folder review without creating or linking anything', async () => {
		const user = await startReview();
		await user.click(screen.getByRole('button', { name: 'Close modal' }));
		expect(callbacks.onClose).toHaveBeenCalledTimes(1);
		expect(authService.createProject).not.toHaveBeenCalled();
		expect(workspaceService.link).not.toHaveBeenCalled();
	});
	it('does not treat a cancelled picker as an error or create a project', async () => {
		jest.mocked(workspaceService.pickFolder).mockRejectedValue(new DOMException('Cancelled', 'AbortError'));
		const user = userEvent.setup();
		render(<ProjectImportModal isOpen {...callbacks} />);
		await user.click(screen.getByRole('button', { name: /From a Folder on This Device/ }));
		await waitFor(() => expect(screen.queryByText('Scanning for projects...')).not.toBeInTheDocument());
		expect(screen.queryByRole('alert')).not.toBeInTheDocument();
		expect(authService.createProject).not.toHaveBeenCalled();
	});
	it('shows denied permission before creation and preserves the selected review for retry', async () => {
		jest.mocked(workspaceService.validateFolderSelection).mockRejectedValue(new Error('Write access denied'));
		const user = await startReview();
		await user.selectOptions(screen.getByLabelText('Local project format'), 'typst');
		await user.click(screen.getByRole('button', { name: 'Open Local Folder' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('Write access denied');
		expect(authService.createProject).not.toHaveBeenCalled();
		expect(screen.getByLabelText('Entry file')).toHaveValue('/main.typ');
	});
	it('reuses the recovery project when linking fails instead of creating duplicates on retry', async () => {
		jest.mocked(workspaceService.link).mockRejectedValueOnce(new Error('Handle store failed'));
		const user = await startReview();
		await user.selectOptions(screen.getByLabelText('Local project format'), 'typst');
		await user.click(screen.getByRole('button', { name: 'Open Local Folder' }));
		expect(await screen.findByRole('alert')).toHaveTextContent('Handle store failed');
		expect(callbacks.onOpenProject).not.toHaveBeenCalled();
		expect(screen.getByLabelText('Local project format')).toBeDisabled();
		await user.click(screen.getByRole('button', { name: 'Open Local Folder' }));
		await waitFor(() => expect(callbacks.onOpenProject).toHaveBeenCalledTimes(1));
		expect(authService.createProject).toHaveBeenCalledTimes(1);
	});
	it('aborts a pending scan on close and ignores its late result', async () => {
		let resolveScan: ((value: LocalProjectDiscovery) => void) | undefined;
		jest.mocked(workspaceService.inspectFolder).mockImplementation(() => new Promise((resolve) => { resolveScan = resolve; }));
		const user = userEvent.setup();
		render(<ProjectImportModal isOpen {...callbacks} />);
		await user.click(screen.getByRole('button', { name: /From a Folder on This Device/ }));
		await waitFor(() => expect(workspaceService.inspectFolder).toHaveBeenCalled());
		const signal = jest.mocked(workspaceService.inspectFolder).mock.calls[0][1];
		await user.click(screen.getByRole('button', { name: 'Close modal' }));
		expect(signal?.aborted).toBe(true);
		await act(async () => resolveScan?.(discovery));
		expect(screen.queryByLabelText('Local project format')).not.toBeInTheDocument();
		expect(authService.createProject).not.toHaveBeenCalled();
	});
	it('explains the unsupported API without claiming downloads save back to the original folder', () => {
		jest.mocked(workspaceService.isSupported).mockReturnValue(false);
		render(<ProjectImportModal isOpen {...callbacks} />);
		expect(screen.queryByRole('button', { name: /From a Folder on This Device/ })).not.toBeInTheDocument();
		expect(screen.getByText(/downloads do not update the original folder/)).toBeInTheDocument();
	});
});
