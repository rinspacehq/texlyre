// SPDX-License-Identifier: AGPL-3.0-or-later

const protectedNames = new Set(['.git', '.svn', 'node_modules', '.texlyre', '.ds_store']);

export function isIgnoredLocalEntry(name: string): boolean {
	return protectedNames.has(name.toLowerCase());
}

export function isIgnoredLocalPath(path: string): boolean {
	return path.split('/').some(isIgnoredLocalEntry);
}

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

/** Compare the actual bytes, including for text files with non-ASCII content. */
export function matchesLocalWriteContent(actual: ArrayBuffer, expected: string | ArrayBuffer): boolean {
	const previous = typeof expected === 'string' ? new TextEncoder().encode(expected) : new Uint8Array(expected);
	const current = new Uint8Array(actual);
	return current.length === previous.length && current.every((byte, index) => byte === previous[index]);
}

export class LocalDiskChangedError extends Error {
	constructor() {
		super('The folder file changed outside TeXlyre. The browser draft was retained.');
		this.name = 'LocalDiskChangedError';
	}
}
