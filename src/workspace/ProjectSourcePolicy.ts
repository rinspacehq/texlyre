// SPDX-License-Identifier: AGPL-3.0-or-later

export type ProjectSource = 'remote' | 'local';
export type ProjectSourceAccountState =
	| 'checking'
	| 'authenticated'
	| 'anonymous'
	| 'unavailable';

export function canSelectRemoteProjectSource(
	hasRemoteSource: boolean,
	accountState: ProjectSourceAccountState,
): boolean {
	return (
		hasRemoteSource &&
		(accountState === 'authenticated' || accountState === 'unavailable')
	);
}

export function resolveVisibleProjectSource(
	hasRemoteSource: boolean,
	activeSource: ProjectSource,
	accountState: ProjectSourceAccountState,
): ProjectSource {
	return canSelectRemoteProjectSource(hasRemoteSource, accountState)
		? activeSource
		: 'local';
}
