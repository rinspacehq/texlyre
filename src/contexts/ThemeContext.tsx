// src/contexts/ThemeContext.tsx
import type React from 'react';
import {
	type ReactNode,
	createContext,
	useCallback,
	useEffect,
	useMemo,
	useState,
} from 'react';

import { useProperties } from '../hooks/useProperties';
import { useSettings } from '../hooks/useSettings';
import type { ThemeLayout, ThemePlugin } from '../plugins/PluginInterface';
import { pluginRegistry } from '../plugins/PluginRegistry';

interface ThemeContextType {
	currentThemePlugin: ThemePlugin | null;
	currentVariant: string;
	resolvedVariant: string | null;
	currentLayout: ThemeLayout | null;
	setTheme: (pluginId: string) => void;
	setVariant: (variantId: string) => void;
	availableThemes: ThemePlugin[];
	isCurrentVariantDark: boolean;
}

export const ThemeContext = createContext<ThemeContextType>({
	currentThemePlugin: null,
	currentVariant: 'dark',
	resolvedVariant: 'dark',
	currentLayout: null,
	setTheme: () => {},
	setVariant: () => {},
	availableThemes: [],
	isCurrentVariantDark: true,
});

interface ThemeProviderProps {
	children: ReactNode;
	defaultThemeId?: string;
	defaultVariant?: string;
}

export const ThemeProvider: React.FC<ThemeProviderProps> = ({
	children,
	defaultThemeId = 'texlyre-theme',
	defaultVariant = 'dark',
}) => {
	const [availableThemes, setAvailableThemes] = useState<ThemePlugin[]>([]);
	const [systemPrefersDark, setSystemPrefersDark] = useState(
		() => window.matchMedia('(prefers-color-scheme: dark)').matches,
	);
	const { getSetting, updateSetting } = useSettings();
	const { getProperty, isReady: arePropertiesReady } = useProperties();
	const hostTheme = pluginRegistry.getWorkspaceExtensions().theme;
	const [hostPreference, setHostPreference] = useState(() => hostTheme?.getPreference());
	useEffect(() => hostTheme?.subscribe(() => setHostPreference(hostTheme.getPreference())), [hostTheme]);

	useEffect(() => {
		const themes = pluginRegistry.getThemes();
		setAvailableThemes(themes);
	}, []);

	useEffect(() => {
		const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
		const handleChange = (event: MediaQueryListEvent) => {
			setSystemPrefersDark(event.matches);
		};

		setSystemPrefersDark(mediaQuery.matches);
		mediaQuery.addEventListener('change', handleChange);
		return () => {
			mediaQuery.removeEventListener('change', handleChange);
		};
	}, []);

	const currentThemeId =
		(getSetting('theme-plugin')?.value as string) || defaultThemeId;

	const localVariant =
		(getSetting('theme-variant')?.value as string) || defaultVariant;
	// Custom palettes stay editor-only. Standard modes share the host preference.
	const currentVariant = ['light', 'dark', 'system'].includes(localVariant)
		? hostPreference ?? localVariant : localVariant;

	const currentThemePlugin = useMemo(() => {
		if (availableThemes.length === 0) return null;
		return (
			availableThemes.find((theme) => theme.id === currentThemeId) ||
			availableThemes[0] ||
			null
		);
	}, [availableThemes, currentThemeId]);

	const configuredLightVariant = getProperty('theme-toggle-light');
	const configuredDarkVariant = getProperty('theme-toggle-dark');

	const resolvedVariant = useMemo(() => {
		if (!currentThemePlugin || currentVariant !== 'system') {
			return currentVariant;
		}
		if (!arePropertiesReady) return null;

		const variants = currentThemePlugin.getThemeVariants();
		const configuredVariant = systemPrefersDark
			? configuredDarkVariant
			: configuredLightVariant;

		if (
			typeof configuredVariant === 'string' &&
			configuredVariant !== 'system' &&
			variants.some((variant) => variant.id === configuredVariant)
		) {
			return configuredVariant;
		}

		const standardFallback = systemPrefersDark ? 'dark' : 'light';
		if (variants.some((variant) => variant.id === standardFallback)) {
			return standardFallback;
		}

		const modeFallback = variants.find(
			(variant) =>
				variant.id !== 'system' && variant.isDark === systemPrefersDark,
		);
		if (modeFallback) return modeFallback.id;

		return (
			variants.find((variant) => variant.id !== 'system')?.id ?? currentVariant
		);
	}, [
		arePropertiesReady,
		configuredDarkVariant,
		configuredLightVariant,
		currentThemePlugin,
		currentVariant,
		systemPrefersDark,
	]);

	const currentLayout = useMemo(() => {
		return currentThemePlugin?.getLayout() || null;
	}, [currentThemePlugin]);

	useEffect(() => {
		if (!currentThemePlugin || !resolvedVariant) return;

		document.documentElement.removeAttribute('data-layout');
		currentThemePlugin.applyTheme(resolvedVariant);
		currentThemePlugin.applyLayout();
	}, [currentThemePlugin, resolvedVariant]);

	const setTheme = useCallback(
		(pluginId: string) => {
			updateSetting('theme-plugin', pluginId);
		},
		[updateSetting],
	);

	const setVariant = useCallback(
		(variantId: string) => {
			updateSetting('theme-variant', variantId);
			if (variantId === 'light' || variantId === 'dark' || variantId === 'system') {
				hostTheme?.setPreference(variantId);
				setHostPreference(hostTheme?.getPreference());
			}
		},
		[updateSetting, hostTheme],
	);
	const isCurrentVariantDark = useMemo(() => {
		if (!currentThemePlugin) return false;

		if (!resolvedVariant) {
			return currentVariant === 'system' ? systemPrefersDark : false;
		}

		const variant = currentThemePlugin
			.getThemeVariants()
			.find((candidate) => candidate.id === resolvedVariant);

		if (variant && variant.id !== 'system') return variant.isDark;
		return currentVariant === 'system' ? systemPrefersDark : false;
	}, [currentThemePlugin, currentVariant, resolvedVariant, systemPrefersDark]);
	return (
		<ThemeContext.Provider
			value={{
				currentThemePlugin,
				currentVariant,
				resolvedVariant,
				currentLayout,
				setTheme,
				setVariant,
				availableThemes,
				isCurrentVariantDark,
			}}
		>
			{children}
		</ThemeContext.Provider>
	);
};
