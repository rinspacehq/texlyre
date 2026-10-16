// SPDX-License-Identifier: AGPL-3.0-or-later
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { LanguageProvider } from '@src/contexts/LocaleContext';
import { useLanguage } from '@src/hooks/useLanguage';
import SettingsLanguage from '@src/components/settings/SettingsLanguage';
import type { Setting } from '@src/contexts/SettingsContext';
import i18next from 'i18next';

let mockPreference = 'system';
let mockHostLanguage = 'zh';
let mockRefresh: (() => void) | undefined;
const mockUnsubscribe = jest.fn();
jest.mock('@src/hooks/useSettings', () => ({ useSettings: () => ({ getSetting: (id: string) => id === 'language' ? { value: mockPreference } : undefined }) }));
jest.mock('@src/plugins/PluginRegistry', () => ({ pluginRegistry: { getWorkspaceExtensions: () => ({ locale: { getLanguage: () => mockHostLanguage, subscribe: (listener: () => void) => { mockRefresh = listener; return mockUnsubscribe; } } }) } }));
jest.spyOn(i18next, 'changeLanguage');

const setting: Setting = { id: 'language', category: 'Appearance', type: 'language-select', label: 'Interface language', defaultValue: 'system', value: 'system' };
function Consumer() {
	const { currentLanguage } = useLanguage();
	return <><output>{currentLanguage?.code}</output><SettingsLanguage setting={{ ...setting, value: mockPreference }} onLocalUpdate={value => { mockPreference = String(value); }} /></>;
}
beforeEach(() => { jest.clearAllMocks(); mockPreference = 'system'; mockHostLanguage = 'zh'; mockRefresh = undefined; });

test('automatic changes follow the host and keep localized title, picker can return to System', async () => {
	const { unmount } = render(<LanguageProvider><Consumer /></LanguageProvider>);
	await waitFor(() => expect(document.documentElement.lang).toBe('zh'));
	expect(document.title).toBe('芥子环在线编辑器');
	mockHostLanguage = 'en';
	mockRefresh?.();
	await waitFor(() => expect(document.documentElement.lang).toBe('en'));
	expect(document.title).toBe('Rinspace Online Editor');
	fireEvent.click(screen.getByRole('button', { name: /System/ }));
	expect(screen.getByRole('option', { name: 'System' })).toHaveAttribute('aria-selected', 'true');
	fireEvent.click(screen.getByRole('option', { name: /简体中文/ }));
	await waitFor(() => expect(document.documentElement.lang).toBe('zh'));
	expect(mockPreference).toBe('zh');
	fireEvent.click(screen.getByRole('button', { name: /简体中文/ }));
	fireEvent.click(screen.getByRole('option', { name: /System|系统/ }));
	await waitFor(() => expect(document.documentElement.lang).toBe('en'));
	expect(mockPreference).toBe('system');
	unmount();
	expect(mockUnsubscribe).toHaveBeenCalled();
});

test('an explicit saved language does not subscribe to or follow host changes', async () => {
	mockPreference = 'de';
	render(<LanguageProvider><Consumer /></LanguageProvider>);
	await waitFor(() => expect(i18next.changeLanguage).toHaveBeenCalledWith('de'));
	expect(document.documentElement.lang).toBe('de');
	expect(mockRefresh).toBeUndefined();
});
