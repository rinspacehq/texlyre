// SPDX-License-Identifier: AGPL-3.0-or-later
/** Explicit/offline local mode never initiates Rinspace account requests. */
export function isRinspaceAccountRoute(search: string, origin: string): boolean {
	if (origin !== 'https://rinspace.com') return false;
	const modes = new URLSearchParams(search).getAll('mode');
	return modes.length === 0 || (modes.length === 1 && modes[0] === 'managed');
}

/** The default entry is only a fallback, not a replacement for an open file. */
export function rinspaceProjectActivationHash(
	currentHash: string,
	projectId: string,
	filePath?: string,
): string {
	const hash = currentHash.startsWith('#') ? currentHash.slice(1) : currentHash;
	const [project, ...fragments] = hash.split('&');
	if (project === `yjs:${projectId}` &&
		fragments.some(fragment => fragment.startsWith('file:') && fragment.length > 5)) {
		return hash;
	}
	return `yjs:${projectId}${filePath ? `&file:${encodeURIComponent(filePath)}` : ''}`;
}
