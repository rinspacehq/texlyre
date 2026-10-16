// SPDX-License-Identifier: AGPL-3.0-or-later
import { createContext } from 'react';

export interface Locale {
	code: string;
	name: string;
	nativeName: string;
	direction: 'ltr' | 'rtl';
	coverage: number;
	totalKeys: number;
	translatedKeys: number;
	filePath: string;
}

interface LocaleContextType {
	currentLanguage: Locale | null;
	availableLanguages: Locale[];
	changeLanguage: (languageCode: string) => Promise<void>;
	isRTL: boolean;
}

export const LocaleContext = createContext<LocaleContextType>({
	currentLanguage: null,
	availableLanguages: [],
	changeLanguage: async () => {},
	isRTL: false,
});
