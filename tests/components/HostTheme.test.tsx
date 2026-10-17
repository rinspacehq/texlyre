// SPDX-License-Identifier: AGPL-3.0-or-later
import { act, fireEvent, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@src/contexts/ThemeContext';
import { useTheme } from '@src/hooks/useTheme';
import type { WorkspaceExtensions } from '@src/workspace/contracts';

let mockLocal = 'light';
let mockPreference: 'light' | 'dark' | 'system' | undefined = 'dark';
let mockListener = () => {};
let mockHost: WorkspaceExtensions['theme'];
const mockApply = jest.fn();
const mockWrite = jest.fn();
const mockUnsubscribe = jest.fn();
const mockUpdate = jest.fn();
jest.mock('@src/hooks/useSettings', () => ({ useSettings: () => ({ getSetting: (id: string) => id === 'theme-variant' ? { value: mockLocal } : undefined, updateSetting: mockUpdate }) }));
jest.mock('@src/hooks/useProperties', () => ({ useProperties: () => ({ getProperty: () => undefined, isReady: true }) }));
jest.mock('@src/plugins/PluginRegistry', () => ({ pluginRegistry: {
	getWorkspaceExtensions: () => ({ theme: mockHost }),
	getThemes: () => [{ id: 'test', getThemeVariants: () => [{ id: 'light', isDark: false }, { id: 'dark', isDark: true }, { id: 'nord', isDark: true }], applyTheme: mockApply, applyLayout: () => {}, getLayout: () => null }],
} }));

function Probe() {
	const theme = useTheme();
	return <><output>{theme.currentVariant}:{theme.resolvedVariant}</output><button onClick={() => theme.setVariant('light')}>Light</button><button onClick={() => theme.setVariant('system')}>System</button></>;
}

beforeEach(() => {
	const media = new EventTarget();
	Object.defineProperty(window, 'matchMedia', { configurable: true, value: (query: string) => ({
		matches: false, media: query, onchange: null,
		addEventListener: media.addEventListener.bind(media), removeEventListener: media.removeEventListener.bind(media),
		addListener: jest.fn(), removeListener: jest.fn(), dispatchEvent: media.dispatchEvent.bind(media),
	}) });
	mockLocal = 'light'; mockPreference = 'dark';
	mockWrite.mockReset(); mockUpdate.mockReset(); mockApply.mockReset(); mockUnsubscribe.mockReset();
	mockHost = { getPreference: () => mockPreference, setPreference: value => { mockPreference = value; mockWrite(value); }, subscribe: listener => { mockListener = listener; return mockUnsubscribe; } };
});

test('host standard preference wins, reacts to events and publishes explicit editor changes', () => {
	const view = render(<ThemeProvider><Probe /></ThemeProvider>);
	expect(screen.getByRole('status')).toHaveTextContent('dark:dark');
	mockPreference = 'system';
	act(() => mockListener());
	expect(screen.getByRole('status')).toHaveTextContent('system:light');
	fireEvent.click(screen.getByText('Light'));
	expect(mockWrite).toHaveBeenCalledWith('light');
	expect(mockUpdate).toHaveBeenCalledWith('theme-variant', 'light');
	expect(screen.getByRole('status')).toHaveTextContent('light:light');
	view.unmount();
	expect(mockUnsubscribe).toHaveBeenCalled();
});

test('standalone retains its saved preference without publishing host state', () => {
	mockHost = undefined; mockLocal = 'dark';
	render(<ThemeProvider><Probe /></ThemeProvider>);
	expect(screen.getByRole('status')).toHaveTextContent('dark:dark');
	fireEvent.click(screen.getByText('System'));
	expect(mockUpdate).toHaveBeenCalledWith('theme-variant', 'system');
	expect(mockWrite).not.toHaveBeenCalled();
});

test('a custom palette stays editor-only', () => {
	mockLocal = 'nord';
	render(<ThemeProvider><Probe /></ThemeProvider>);
	expect(screen.getByRole('status')).toHaveTextContent('nord:nord');
	mockPreference = 'light'; act(() => mockListener());
	expect(screen.getByRole('status')).toHaveTextContent('nord:nord');
	expect(mockWrite).not.toHaveBeenCalled();
});
