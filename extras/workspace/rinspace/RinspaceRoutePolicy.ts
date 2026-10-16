// SPDX-License-Identifier: AGPL-3.0-or-later
/** Explicit/offline local mode never initiates Rinspace account requests. */
export function isRinspaceAccountRoute(search: string, origin: string): boolean {
	if (origin !== 'https://rinspace.com') return false;
	const modes = new URLSearchParams(search).getAll('mode');
	return modes.length === 0 || (modes.length === 1 && modes[0] === 'managed');
}
