// SPDX-License-Identifier: AGPL-3.0-or-later
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import EditorTabs from '@src/components/editor/EditorTabs';
import type { EditorTab } from '@src/types/editorTabs';

const mockSwitch = jest.fn();
const mockTabs: EditorTab[] = [
	{ id: 'main', title: 'main.tex', type: 'file', fileId: 'main', filePath: '/main.tex', lastAccessed: 1, editorState: {} },
	{ id: 'intro', title: 'intro.tex', type: 'file', fileId: 'intro', filePath: '/intro.tex', lastAccessed: 1, editorState: {} },
];
jest.mock('@src/i18n', () => ({ t: (key: string) => key }));
jest.mock('@src/hooks/useEditorTabs', () => ({ useEditorTabs: () => ({
	tabs: mockTabs, activeTabId: 'main', switchToTab: mockSwitch,
	closeTab: jest.fn(), updateTabEditorState: jest.fn(), reorderTabs: jest.fn(),
	closeOtherTabs: jest.fn(), closeTabsToLeft: jest.fn(), closeTabsToRight: jest.fn(),
}) }));
jest.mock('@src/hooks/useHeaderVisibility', () => ({ useHeaderVisibility: () => ({ headerVisible: true, setHeaderVisible: jest.fn() }) }));
jest.mock('@src/hooks/useWheelScroll', () => ({ useWheelScroll: (ref: { current: HTMLDivElement | null }) => (element: HTMLDivElement | null) => { ref.current = element; } }));
jest.mock('@src/plugins/PluginRegistry', () => ({ pluginRegistry: { getViewerForFile: () => undefined } }));

beforeEach(() => {
	jest.clearAllMocks();
	HTMLElement.prototype.scrollIntoView = jest.fn();
});

it('does not change the active header while the current draft is still being saved', async () => {
	let done!: (value: boolean) => void;
	const opening = new Promise<boolean>(resolve => { done = resolve; });
	const navigate = jest.fn(() => opening);
	render(<EditorTabs onTabSwitch={navigate} />);
	fireEvent.click(screen.getByRole('tab', { name: /intro\.tex/ }));
	expect(navigate).toHaveBeenCalledWith('intro');
	expect(mockSwitch).not.toHaveBeenCalled();
	await act(async () => { done(true); await opening; });
	expect(mockSwitch).toHaveBeenCalledWith('intro');
});

it('preserves the active header when navigation rejects an unsaved draft', async () => {
	const navigate = jest.fn(async () => false);
	render(<EditorTabs onTabSwitch={navigate} />);
	fireEvent.click(screen.getByRole('tab', { name: /intro\.tex/ }));
	await waitFor(() => expect(navigate).toHaveBeenCalledWith('intro'));
	expect(mockSwitch).not.toHaveBeenCalled();
});

it('keeps standalone tabs functional when no external navigation callback exists', async () => {
	render(<EditorTabs />);
	fireEvent.click(screen.getByRole('tab', { name: /intro\.tex/ }));
	await waitFor(() => expect(mockSwitch).toHaveBeenCalledWith('intro'));
});
