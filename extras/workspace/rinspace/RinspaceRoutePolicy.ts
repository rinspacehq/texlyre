// SPDX-License-Identifier: AGPL-3.0-or-later
/** Explicit/offline local mode never initiates Rinspace account requests. */
export function isRinspaceAccountRoute(search: string, origin: string): boolean {
	if (origin !== 'https://rinspace.com') return false;
	const modes = new URLSearchParams(search).getAll('mode');
	return modes.length === 0 || (modes.length === 1 && modes[0] === 'managed');
}

export function replaceRinspaceManagedRoute(intent: {
	owner: string;
	repository: string;
	ref: string;
}): void {
	const url = new URL(window.location.href);
	url.searchParams.set('mode', 'managed');
	url.searchParams.set('owner', intent.owner);
	url.searchParams.set('repository', intent.repository);
	url.searchParams.set('ref', intent.ref);
	window.history.replaceState(null, '', url);
}

export function clearRinspaceManagedRoute(): void {
	const url = new URL(window.location.href);
	for (const key of ['mode', 'owner', 'repository', 'ref']) {
		url.searchParams.delete(key);
	}
	window.history.replaceState(null, '', url);
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
