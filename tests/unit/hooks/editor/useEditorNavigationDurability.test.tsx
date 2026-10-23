// SPDX-License-Identifier: AGPL-3.0-or-later
import { act, renderHook, waitFor } from '@testing-library/react';
import { useEditorNavigation } from '@src/hooks/editor/useEditorNavigation';
import type { FileNode } from '@src/types/files';

const mockFiles: FileNode[] = [
	{ id: 'main', name: 'main.tex', path: '/main.tex', type: 'file', lastModified: 1 },
	{ id: 'intro', name: 'intro.tex', path: '/intro.tex', type: 'file', lastModified: 1 },
	{ id: 'empty', name: 'empty.tex', path: '/empty.tex', type: 'file', lastModified: 1 },
];
const mockGetFile = jest.fn<Promise<FileNode | undefined>, [string]>();
const mockGetContent = jest.fn<Promise<string | ArrayBuffer | undefined>, [string]>();
const mockFlush = jest.fn<Promise<void[]>, []>();
const mockOpenTab = jest.fn();
const mockNotify = jest.fn();
const mockSelectDocument = jest.fn();
const mockProject = jest.fn(() => 'a6430000-0000-4000-8000-000000000001');
const mockGetProject = jest.fn().mockResolvedValue(null);
const mockUpdateProject = jest.fn().mockResolvedValue(undefined);
const mockOutput = jest.fn();
const mockTabs = [
	{ id: 'tab-intro', type: 'file', fileId: 'intro', title: 'intro.tex' },
	{ id: 'tab-main', type: 'file', fileId: 'main', title: 'main.tex' },
];

jest.mock('@src/i18n', () => ({ t: (key: string) => key }));
jest.mock('@src/hooks/useFileTree', () => ({
	useFileTree: () => {
		const React = jest.requireActual<typeof import('react')>('react');
		const [selectedFileId, selectFile] = React.useState<string | null>(null);
		return { selectedFileId, selectFile, fileTree: mockFiles, getFile: mockGetFile, getFileContent: mockGetContent };
	},
}));
jest.mock('@src/hooks/useAuth', () => ({ useAuth: () => ({ getProjectById: mockGetProject, updateProject: mockUpdateProject }) }));
jest.mock('@src/hooks/useEditorTabs', () => ({ useEditorTabs: () => ({ openTab: mockOpenTab, tabs: mockTabs }) }));
jest.mock('@src/plugins/PluginRegistry', () => ({ pluginRegistry: { getViewerForFile: () => undefined } }));
jest.mock('@src/services/AutoSaveService', () => ({ autoSaveService: { flushPendingSaves: () => mockFlush() } }));
jest.mock('@src/services/NotificationService', () => ({ notificationService: { showError: (...args: unknown[]) => mockNotify(...args) } }));
jest.mock('@src/services/FileStoreService', () => ({
	fileStoreService: {
		initialize: async () => {}, getAllFiles: async () => mockFiles,
		getCurrentProjectId: () => mockProject(),
		getFileByPath: async (path: string) => mockFiles.find(file => file.path === path),
	},
}));
jest.mock('@src/utils/editorNavigator', () => ({ gotoEditor: jest.fn() }));

const setup = () => renderHook(() => useEditorNavigation({
	documents: [{ id: 'doc-1', name: 'Linked document', content: 'stored document' }],
	selectedDocId: null, onSelectDocument: mockSelectDocument,
	onUpdateContent: jest.fn(), content: '', docUrl: 'yjs:a6430000-0000-4000-8000-000000000001',
	setOutputForFileName: mockOutput,
}));
const deferred = <T,>() => {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>(done => { resolve = done; });
	return { promise, resolve };
};

beforeEach(() => {
	jest.clearAllMocks();
	window.history.replaceState(null, '', '/editor/#yjs:a6430000-0000-4000-8000-000000000001&file:%2Fmain.tex');
	mockFlush.mockResolvedValue([]);
	mockProject.mockReturnValue('a6430000-0000-4000-8000-000000000001');
	mockGetFile.mockImplementation(async id => mockFiles.find(file => file.id === id));
	mockGetContent.mockImplementation(async id => id === 'empty' ? '' : id + ' stored 中文 $x^2$');
});

it('does not read or replace a file until the previous draft is durably saved', async () => {
	const pending = deferred<void[]>();
	mockFlush.mockReturnValue(pending.promise);
	const { result } = setup();
	await waitFor(() => expect(result.current.bootstrapResolved).toBe(true));
	let opening!: Promise<unknown>;
	await act(async () => { opening = result.current.handleUserFileSelect('intro'); await Promise.resolve(); });
	expect(mockGetContent).not.toHaveBeenCalled();
	expect(mockOpenTab).not.toHaveBeenCalled();
	await act(async () => { pending.resolve([]); await opening; });
	expect(result.current.loadedFile?.fileId).toBe('intro');
	expect(mockGetContent).toHaveBeenCalledWith('intro');
});

it('keeps the current file and route when storage fails instead of hiding the draft', async () => {
	const { result } = setup();
	await waitFor(() => expect(result.current.bootstrapResolved).toBe(true));
	await act(async () => { await result.current.handleUserFileSelect('main'); });
	const route = window.location.hash;
	mockFlush.mockRejectedValue(new Error('quota exceeded'));
	await act(async () => { await result.current.handleUserFileSelect('intro'); });
	expect(result.current.loadedFile?.fileId).toBe('main');
	expect(window.location.hash).toBe(route);
	expect(mockNotify).toHaveBeenCalled();
});

it('does not discard an intentionally empty file', async () => {
	const { result } = setup();
	await waitFor(() => expect(result.current.bootstrapResolved).toBe(true));
	await act(async () => { await result.current.handleUserFileSelect('empty'); });
	expect(result.current.loadedFile).toEqual({ fileId: 'empty', content: '' });
});

it('opens main.tex as text when imported metadata has a stale binary flag', async () => {
	mockGetFile.mockImplementation(async id => id === 'main'
		? { ...mockFiles[0], isBinary: true }
		: mockFiles.find(file => file.id === id));
	const { result } = setup();
	await waitFor(() => expect(result.current.bootstrapResolved).toBe(true));
	await act(async () => { await result.current.handleUserFileSelect('main'); });
	expect(result.current.loadedFile?.fileId).toBe('main');
	expect(result.current.isBinaryFile).toBe(false);
});

it('keeps a main.tex file with NUL bytes out of the text editor', async () => {
	mockGetContent.mockImplementation(async id => id === 'main'
		? new Uint8Array([65, 0, 66]).buffer
		: 'other text');
	const { result } = setup();
	await waitFor(() => expect(result.current.bootstrapResolved).toBe(true));
	await act(async () => { await result.current.handleUserFileSelect('main'); });
	expect(result.current.isBinaryFile).toBe(true);
});

it('ignores an older asynchronous file read after a newer tab has opened', async () => {
	const slow = deferred<string>();
	mockGetContent.mockImplementation(async id => id === 'intro' ? slow.promise : 'main newest content');
	const { result } = setup();
	await waitFor(() => expect(result.current.bootstrapResolved).toBe(true));
	let older!: Promise<unknown>;
	await act(async () => { older = result.current.handleTabSwitch('tab-intro'); await Promise.resolve(); });
	await waitFor(() => expect(mockGetContent).toHaveBeenCalledWith('intro'));
	await act(async () => { await result.current.handleTabSwitch('tab-main'); });
	await act(async () => { slow.resolve('intro stale content'); await older; });
	expect(result.current.loadedFile?.fileId).toBe('main');
	expect(window.location.hash).toContain('file:%2Fmain.tex');
});

it('does not replace a document until the current file draft has finished saving', async () => {
	const pending = deferred<void[]>();
	mockFlush.mockReturnValue(pending.promise);
	const { result } = setup();
	await waitFor(() => expect(result.current.bootstrapResolved).toBe(true));
	let opening!: Promise<unknown>;
	await act(async () => { opening = Promise.resolve(result.current.handleDocumentSelect('doc-1')); await Promise.resolve(); });
	expect(mockSelectDocument).not.toHaveBeenCalled();
	await act(async () => { pending.resolve([]); await opening; });
	expect(mockSelectDocument).toHaveBeenCalledWith('doc-1');
});

it('does not apply an old navigation after the active project changes', async () => {
	const pending = deferred<void[]>();
	mockFlush.mockReturnValue(pending.promise);
	const { result } = setup();
	await waitFor(() => expect(result.current.bootstrapResolved).toBe(true));
	let opening!: Promise<unknown>;
	await act(async () => { opening = result.current.handleUserFileSelect('intro'); await Promise.resolve(); });
	mockProject.mockReturnValue('a6430000-0000-4000-8000-000000000002');
	await act(async () => { pending.resolve([]); await opening; });
	expect(result.current.loadedFile).toBeNull();
	expect(mockOpenTab).not.toHaveBeenCalled();
});

it('keeps the latest tab intent when an older file metadata read finishes late', async () => {
	const slow = deferred<FileNode | undefined>();
	mockGetFile.mockImplementation(async id => id === 'intro' ? slow.promise : mockFiles.find(file => file.id === id));
	const { result } = setup();
	await waitFor(() => expect(result.current.bootstrapResolved).toBe(true));
	let older!: Promise<unknown>;
	await act(async () => { older = result.current.handleTabSwitch('tab-intro'); await Promise.resolve(); });
	await act(async () => { await result.current.handleTabSwitch('tab-main'); });
	await act(async () => { slow.resolve(mockFiles[1]); await older; });
	expect(result.current.loadedFile?.fileId).toBe('main');
	expect(window.location.hash).toContain('file:%2Fmain.tex');
});

it('captures the project before waiting for file metadata, not only before reading content', async () => {
	const slow = deferred<FileNode | undefined>();
	mockGetFile.mockReturnValue(slow.promise);
	const { result } = setup();
	await waitFor(() => expect(result.current.bootstrapResolved).toBe(true));
	let opening!: Promise<unknown>;
	await act(async () => { opening = result.current.handleUserFileSelect('intro'); await Promise.resolve(); });
	mockProject.mockReturnValue('a6430000-0000-4000-8000-000000000002');
	await act(async () => { slow.resolve(mockFiles[1]); await opening; });
	expect(result.current.loadedFile).toBeNull();
	expect(mockOpenTab).not.toHaveBeenCalled();
});
