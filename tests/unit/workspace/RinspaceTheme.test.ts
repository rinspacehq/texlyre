/**
 * @jest-environment-options {"url":"https://rinspace.com/editor/"}
 */
// SPDX-License-Identifier: AGPL-3.0-or-later
import { rinspaceTheme } from '@extras/workspace/rinspace/RinspaceTheme';

beforeEach(() => { localStorage.clear(); jest.restoreAllMocks(); });

test('standard preference wins over legacy and legacy migrates only if needed', () => {
	expect(rinspaceTheme.getPreference()).toBe('system');
	localStorage.setItem('rinspace-inner-color-scheme', 'dark');
	expect(rinspaceTheme.getPreference()).toBe('dark');
	expect(localStorage.getItem('rinspace-theme-v2')).toBe('dark');
	localStorage.setItem('rinspace-theme-v2', 'system');
	expect(rinspaceTheme.getPreference()).toBe('system');
});

test('uses events instead of polling, and removes all listeners', () => {
	const listener = jest.fn();
	const stop = rinspaceTheme.subscribe(listener);
	rinspaceTheme.setPreference('dark');
	expect(listener).toHaveBeenCalledTimes(1);
	expect(localStorage.getItem('rinspace-theme-v2')).toBe('dark');
	window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated' }));
	expect(listener).toHaveBeenCalledTimes(1);
	window.dispatchEvent(new StorageEvent('storage', { key: 'rinspace-theme-v2' }));
	window.dispatchEvent(new Event('focus'));
	window.dispatchEvent(new Event('pageshow'));
	expect(listener).toHaveBeenCalledTimes(4);
	stop();
	window.dispatchEvent(new Event('focus'));
	expect(listener).toHaveBeenCalledTimes(4);
});

test('falls back to memory when persistence is blocked', () => {
	jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new DOMException('Full', 'QuotaExceededError'); });
	rinspaceTheme.setPreference('light');
	expect(rinspaceTheme.getPreference()).toBe('light');
});
