// src/utils/viewportUtils.ts
import { isMobileUserAgent } from './browserUtils';
import { getUserDataKey } from './userDataUtils';

const DESKTOP_VIEWPORT_WIDTH = 1200;
const MOBILE_THEME_PLUGIN_ID = 'texlyre-mobile-theme';
const GLOBAL_SETTINGS_KEY = 'texlyre-settings';
let responsiveViewportRequested = false;

function applyResponsiveViewport(): void {
	getViewportMeta().setAttribute('content', 'width=device-width, initial-scale=1.0, user-scalable=yes');
}

/** An optional host may require the actual device width for its workspace UI. */
export function requestResponsiveViewport(enabled: boolean): void {
	responsiveViewportRequested = enabled;
	if (enabled) applyResponsiveViewport();
	else applyDesktopViewport();
}

function getViewportMeta(): HTMLMetaElement {
	let meta = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
	if (!meta) {
		meta = document.createElement('meta');
		meta.setAttribute('name', 'viewport');
		document.head.appendChild(meta);
	}
	return meta;
}

function parseSettings(raw: string | null): Record<string, unknown> {
	if (!raw) return {};

	try {
		return JSON.parse(raw) as Record<string, unknown>;
	} catch {
		return {};
	}
}

function readThemePluginId(): string | null {
	const userId = localStorage.getItem('texlyre-current-user');
	const keys = userId
		? [getUserDataKey(userId, 'settings'), GLOBAL_SETTINGS_KEY]
		: [GLOBAL_SETTINGS_KEY];

	for (const key of keys) {
		const value = parseSettings(localStorage.getItem(key))['theme-plugin'];
		if (typeof value === 'string') return value;
	}

	return null;
}

export function applyDesktopViewport(): void {
	if (responsiveViewportRequested) { applyResponsiveViewport(); return; }
	const scale = window.screen.width / DESKTOP_VIEWPORT_WIDTH;
	getViewportMeta().setAttribute(
		'content',
		`width=${DESKTOP_VIEWPORT_WIDTH}, initial-scale=${scale}, user-scalable=yes`,
	);
}

export function applyMobileViewport(): void {
	if (responsiveViewportRequested) { applyResponsiveViewport(); return; }
	if (!isMobileUserAgent()) {
		applyDesktopViewport();
		return;
	}

	getViewportMeta().setAttribute(
		'content',
		'width=device-width, initial-scale=1.0, user-scalable=yes',
	);
}

export function applyStoredViewport(): void {
	const themePluginId = readThemePluginId();
	const useMobile = themePluginId
		? themePluginId === MOBILE_THEME_PLUGIN_ID
		: isMobileUserAgent();

	if (useMobile) applyMobileViewport();
}
