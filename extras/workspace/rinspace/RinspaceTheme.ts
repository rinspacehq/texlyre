// SPDX-License-Identifier: AGPL-3.0-or-later
import type { WorkspaceExtensions } from '@/workspace/contracts';

type Preference = 'light' | 'dark' | 'system';
const storageKey = 'rinspace-theme-v2';
const changedEvent = 'rinspace-theme-changed';
let sessionPreference: Preference | undefined;

export const rinspaceTheme: NonNullable<WorkspaceExtensions['theme']> = {
	getPreference() {
		if (window.location.origin !== 'https://rinspace.com') return undefined;
		if (sessionPreference) return sessionPreference;
		try {
			const stored = localStorage.getItem(storageKey);
			if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
			const legacy = localStorage.getItem('rinspace-inner-color-scheme');
			if (legacy === 'light' || legacy === 'dark') {
				try { localStorage.setItem(storageKey, legacy); } catch { sessionPreference = legacy; }
				return legacy;
			}
		} catch { /* Restricted storage still permits system mode. */ }
		return 'system';
	},
	setPreference(preference) {
		if (window.location.origin !== 'https://rinspace.com') return;
		try {
			localStorage.setItem(storageKey, preference);
			sessionPreference = undefined;
		} catch { sessionPreference = preference; }
		window.dispatchEvent(new Event(changedEvent));
	},
	subscribe(listener) {
		if (window.location.origin !== 'https://rinspace.com') return () => {};
		const onStorage = (event: StorageEvent) => {
			if (event.key !== storageKey && event.key !== null) return;
			sessionPreference = undefined;
			listener();
		};
		window.addEventListener('storage', onStorage);
		window.addEventListener('pageshow', listener);
		window.addEventListener('focus', listener);
		window.addEventListener(changedEvent, listener);
		return () => {
			window.removeEventListener('storage', onStorage);
			window.removeEventListener('pageshow', listener);
			window.removeEventListener('focus', listener);
			window.removeEventListener(changedEvent, listener);
		};
	},
};
