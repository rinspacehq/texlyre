// SPDX-License-Identifier: AGPL-3.0-or-later
import { getStartupInterfaceLanguage, resolveInterfaceLanguage } from '@src/utils/interfaceLanguage';
import { resolveRinspaceLanguage } from '@extras/workspace/rinspace/RinspaceLocale';

const mockGetLanguage = jest.fn();
jest.mock('@src/plugins/PluginRegistry', () => ({ pluginRegistry: { getWorkspaceExtensions: () => ({ locale: { getLanguage: mockGetLanguage } }) } }));

beforeEach(() => {
	localStorage.clear();
	mockGetLanguage.mockReset();
	Object.defineProperty(navigator, 'languages', { configurable: true, value: ['de-DE', 'en-US'] });
});

test.each([
	['zh-CN', 'zh'], ['en-US', 'en'], ['de-DE', 'de'], ['zh-TW', 'en'], ['invalid!', 'en'],
])('preserves an explicit editor preference %s', (preference, expected) => {
	mockGetLanguage.mockReturnValue('zh');
	expect(resolveInterfaceLanguage(preference)).toBe(expected);
	expect(mockGetLanguage).not.toHaveBeenCalled();
});

test('automatic follows the host; standalone matches ordered browser languages', () => {
	mockGetLanguage.mockReturnValue('zh');
	expect(resolveInterfaceLanguage('system')).toBe('zh');
	expect(resolveInterfaceLanguage(undefined)).toBe('zh');
	mockGetLanguage.mockReturnValue(undefined);
	expect(resolveInterfaceLanguage('system')).toBe('de');
	Object.defineProperty(navigator, 'languages', { configurable: true, value: ['zh-TW', 'it-IT'] });
	expect(resolveInterfaceLanguage('system')).toBe('it');
});

test.each([
	['{"preference":"zh-CN"}', ['en-US'], 'zh'],
	['{"preference":"en"}', ['zh-CN'], 'en'],
	['{"preference":"system"}', ['de-DE', 'zh-CN'], 'zh'],
	['{"preference":"system"}', ['zh-TW'], 'en'],
	['{"preference":"system"}', [], 'zh'],
	['"zh_CN"', ['en'], 'zh'],
	['"de"', ['zh-CN'], 'en'],
	['broken', ['zh-CN'], 'zh'],
])('host preference %s matches main-site fallback rules', (raw, browser, expected) => {
	expect(resolveRinspaceLanguage(raw, browser)).toBe(expected);
});

test('bootstrap uses the active profile and preserves saved English rather than guessing its origin', () => {
	mockGetLanguage.mockReturnValue('zh');
	expect(getStartupInterfaceLanguage()).toBe('zh');
	localStorage.setItem('texlyre-current-user', 'writer');
	localStorage.setItem('texlyre-user-writer-settings', JSON.stringify({ language: 'en' }));
	expect(getStartupInterfaceLanguage()).toBe('en');
	localStorage.setItem('texlyre-user-writer-settings', JSON.stringify({ language: 'system' }));
	expect(getStartupInterfaceLanguage()).toBe('zh');
	localStorage.setItem('texlyre-user-writer-settings', 'broken');
	expect(getStartupInterfaceLanguage()).toBe('zh');
});
