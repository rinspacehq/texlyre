// SPDX-License-Identifier: AGPL-3.0-or-later
import type { WorkspaceExtensions } from '@/workspace/contracts';

const storageKey = 'rinspace-language-preference-v1';

function matchLanguage(value: string): 'zh' | 'en' | undefined {
	try {
		const locale = new Intl.Locale(value.replaceAll('_', '-'));
		if (locale.language === 'en') return 'en';
		if (locale.language === 'zh' && locale.maximize().script === 'Hans') return 'zh';
	} catch {
		// Ignore malformed language tags, just as the host's locale resolver does.
	}
	return undefined;
}

export function resolveRinspaceLanguage(raw: string, browserLanguages: readonly string[]): string {
	let preference: unknown;
	try {
		const parsed: unknown = JSON.parse(raw);
		preference = typeof parsed === 'object' && parsed !== null && 'preference' in parsed
			? parsed.preference : parsed;
	} catch {
		preference = 'system';
	}
	if (typeof preference === 'string' && preference.trim() && preference.trim() !== 'system') {
		let canonical: string | undefined;
		try {
			canonical = Intl.getCanonicalLocales(preference.trim().replaceAll('_', '-'))[0];
		} catch {
			// Invalid preferences mean system mode in the main-site contract.
		}
		if (canonical) return matchLanguage(canonical) ?? 'en';
	}
	if (browserLanguages.length === 0) return 'zh';
	return browserLanguages.map(matchLanguage).find(Boolean) ?? 'en';
}

export const rinspaceLocale: NonNullable<WorkspaceExtensions['locale']> = {
	getLanguage(browserLanguages) {
		if (window.location.origin !== 'https://rinspace.com') return undefined;
		let raw: string | null;
		try {
			raw = localStorage.getItem(storageKey);
		} catch {
			return undefined;
		}
		return resolveRinspaceLanguage(raw ?? '"system"', browserLanguages);
	},
	subscribe(listener) {
		const onStorage = (event: StorageEvent) => {
			if (event.storageArea === localStorage && (event.key === storageKey || event.key === null)) listener();
		};
		window.addEventListener('storage', onStorage);
		return () => window.removeEventListener('storage', onStorage);
	},
};
