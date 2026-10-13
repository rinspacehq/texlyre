// SPDX-License-Identifier: AGPL-3.0-or-later
export const RINSPACE_APPLICATION_TITLES = Object.freeze({
	english: 'Rinspace Online Editor',
	chinese: '芥子环在线编辑器',
});

export function getRinspaceApplicationTitle(languageCode: string): string {
	return languageCode.toLowerCase().startsWith('zh')
		? RINSPACE_APPLICATION_TITLES.chinese
		: RINSPACE_APPLICATION_TITLES.english;
}

export function isRinspaceApplicationTitle(value: string): boolean {
	return Object.values(RINSPACE_APPLICATION_TITLES).some(
		(title) => title === value,
	);
}
