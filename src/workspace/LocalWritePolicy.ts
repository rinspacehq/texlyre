// SPDX-License-Identifier: AGPL-3.0-or-later
import { isIgnoredLocalPath } from './LocalProjectDiscovery';

export type LocalWritePathIssue = 'invalid-path' | 'protected-path';

/** TeXlyre paths may have one virtual-root slash, never an OS path or traversal. */
export function getLocalWritePathIssue(path: string): LocalWritePathIssue | null {
	const relative = path.startsWith('/') ? path.slice(1) : path;
	if (!relative || /^[A-Za-z]:/.test(relative) || relative.includes('\\') ||
		Array.from(relative).some((character) => character.charCodeAt(0) <= 0x1f) ||
		relative.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
		return 'invalid-path';
	}
	return isIgnoredLocalPath(relative) ? 'protected-path' : null;
}

/** Copy bytes synchronously before a queued write can observe later mutations. */
export function copyLocalWriteContent(content: string | ArrayBuffer): string | ArrayBuffer {
	return typeof content === 'string' ? content : content.slice(0);
}
