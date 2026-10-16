// src/contexts/LocaleContext.tsx
import i18next from 'i18next';
import type React from 'react';
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from 'react';

import { useSettings } from '../hooks/useSettings';
import languagesConfig from '../../translations/locales.config.json';
import { getRinspaceApplicationTitle } from '../utils/applicationTitle';
import { getStartupInterfaceLanguage, resolveInterfaceLanguage } from '../utils/interfaceLanguage';
import { pluginRegistry } from '../plugins/PluginRegistry';
import { LocaleContext, type Locale } from './localeContextValue';

interface LocaleProviderProps {
	children: ReactNode;
}

export const LanguageProvider: React.FC<LocaleProviderProps> = ({
	children,
}) => {
	const { getSetting } = useSettings();
	const [currentLanguage, setCurrentLanguage] = useState<Locale | null>(() =>
		languagesConfig.languages.find(language => language.code === getStartupInterfaceLanguage()) as Locale | undefined ?? null,
	);
	const [isRTL, setIsRTL] = useState(false);
	const availableLanguages = useMemo(
		() => (languagesConfig.languages as Locale[]) || [],
		[],
	);
	const lastAppliedLanguageRef = useRef<string | null>(null);

	const applyDirection = useCallback((direction: 'ltr' | 'rtl') => {
		document.documentElement.setAttribute('dir', direction);
		localStorage.setItem('text-direction', direction);
		setIsRTL(direction === 'rtl');
	}, []);

	const changeLanguage = useCallback(
		async (languageCode: string) => {
			const resolved = resolveInterfaceLanguage(languageCode);
			const language = availableLanguages.find(
				(lang) => lang.code === resolved,
			);
			if (!language) return;

			await i18next.changeLanguage(resolved);
			document.documentElement.lang = resolved;
			document.title = getRinspaceApplicationTitle(resolved);
			setCurrentLanguage(language);

			window.dispatchEvent(
				new CustomEvent('language-changed', {
					detail: { languageCode: resolved },
				}),
			);
		},
		[availableLanguages],
	);

	const languageCode = (getSetting('language')?.value as string) || getStartupInterfaceLanguage();
	const directionValue =
		(getSetting('text-direction')?.value as string) || 'auto';

	useEffect(() => {
		if (languageCode !== 'system') return;
		const refresh = () => { void changeLanguage('system'); };
		window.addEventListener('languagechange', refresh);
		const unsubscribe = pluginRegistry.getWorkspaceExtensions().locale?.subscribe(refresh);
		return () => {
			window.removeEventListener('languagechange', refresh);
			unsubscribe?.();
		};
	}, [languageCode, changeLanguage]);

	useEffect(() => {
		if (!languageCode) return;
		if (lastAppliedLanguageRef.current === languageCode) return;

		lastAppliedLanguageRef.current = languageCode;
		changeLanguage(languageCode);
	}, [languageCode, changeLanguage]);

	useEffect(() => {
		if (!currentLanguage) return;

		requestAnimationFrame(() => {
			if (directionValue === 'auto') {
				applyDirection(currentLanguage.direction);
			} else {
				applyDirection(directionValue as 'ltr' | 'rtl');
			}
		});
	}, [currentLanguage, directionValue, applyDirection]);

	return (
		<LocaleContext.Provider
			value={{ currentLanguage, availableLanguages, changeLanguage, isRTL }}
		>
			{children}
		</LocaleContext.Provider>
	);
};
