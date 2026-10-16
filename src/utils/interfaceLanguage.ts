// SPDX-License-Identifier: AGPL-3.0-or-later
import { pluginRegistry } from '../plugins/PluginRegistry';
import languagesConfig from '../../translations/locales.config.json';

function matchLanguage(value: unknown): string | undefined {
	if (typeof value !== 'string') return undefined;
	if (languagesConfig.languages.some(language => language.code === value)) return value;
	try {
		const locale = new Intl.Locale(value.replaceAll('_', '-'));
		if (locale.language === 'zh' && locale.maximize().script !== 'Hans') return undefined;
		return languagesConfig.languages.find(language => language.code === locale.language)?.code;
	} catch {
		return undefined;
	}
}

export function getBrowserLanguages(): readonly string[] {
	return navigator.languages?.length ? navigator.languages : navigator.language ? [navigator.language] : [];
}

export function resolveInterfaceLanguage(preference: unknown): string {
	if (preference !== undefined && preference !== 'system') {
		return matchLanguage(preference) ?? 'en';
	}
	const languages = getBrowserLanguages();
	const host = pluginRegistry.getWorkspaceExtensions().locale?.getLanguage(languages);
	if (host !== undefined) return matchLanguage(host) ?? 'en';
	return languages.map(matchLanguage).find(Boolean) ?? 'en';
}

export function getStartupInterfaceLanguage(): string {
	let preference: unknown;
	try {
		const userId = localStorage.getItem('texlyre-current-user');
		const stored = localStorage.getItem(userId ? `texlyre-user-${userId}-settings` : 'texlyre-settings');
		const parsed: unknown = stored ? JSON.parse(stored) : undefined;
		if (typeof parsed === 'object' && parsed !== null && 'language' in parsed) preference = parsed.language;
	} catch {
		// Unavailable/malformed saved preferences must not prevent opening local data.
	}
	return resolveInterfaceLanguage(preference);
}
