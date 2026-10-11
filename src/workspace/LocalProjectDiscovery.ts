// SPDX-License-Identifier: AGPL-3.0-or-later
// Filename-only discovery: no source reads, writes, compilation or networking.
export type LocalProjectFormat = 'latex' | 'typst' | 'markdown';
export type LocalProjectKind = LocalProjectFormat | 'files';

export interface LocalDirectoryEntry {
	readonly name: string;
	readonly isDirectory: boolean;
}

export type LocalDirectoryReader = (path: string) => AsyncIterable<LocalDirectoryEntry>;

export interface LocalProjectDiscovery {
	readonly fileCount: number;
	readonly entryPoints: Readonly<Record<LocalProjectFormat, readonly string[]>>;
	// Mixed formats require a user choice; unknown/empty folders stay files-only.
	readonly suggestedKind: LocalProjectKind | null;
}

export interface LocalDiscoveryOptions {
	readonly signal?: AbortSignal;
	readonly maxEntries?: number;
	readonly maxDepth?: number;
}

const protectedNames = new Set(['.git', '.svn', 'node_modules', '.texlyre', '.ds_store']);

export function isIgnoredLocalEntry(name: string): boolean {
	return protectedNames.has(name.toLowerCase());
}

export function isIgnoredLocalPath(path: string): boolean {
	return path.split('/').some(isIgnoredLocalEntry);
}

function validateName(name: string): void {
	if (!name || name === '.' || name === '..' || name.includes('/') || name.includes('\\') ||
		Array.from(name).some((character) => character.charCodeAt(0) <= 0x1f)) {
		throw new Error('Invalid local directory entry');
	}
}

function formatForName(name: string): LocalProjectFormat | null {
	const separator = name.lastIndexOf('.');
	if (separator <= 0) return null;
	const extension = name.slice(separator + 1).toLowerCase();
	if (['tex', 'latex', 'ltx'].includes(extension)) return 'latex';
	if (['typ', 'typst'].includes(extension)) return 'typst';
	if (['md', 'markdown', 'mdown'].includes(extension)) return 'markdown';
	return null;
}

function compareEntries(left: string, right: string): number {
	const score = (path: string): number => {
		const name = path.slice(path.lastIndexOf('/') + 1).toLowerCase();
		const stem = name.slice(0, name.lastIndexOf('.'));
		const preferred = ['main', 'index', 'readme'].indexOf(stem);
		return (path.split('/').length - 2) * 4 + (preferred === -1 ? 3 : preferred);
	};
	return score(left) - score(right) || (left < right ? -1 : left > right ? 1 : 0);
}

export async function discoverLocalProject(
	readDirectory: LocalDirectoryReader,
	options: LocalDiscoveryOptions = {},
): Promise<LocalProjectDiscovery> {
	const { signal, maxEntries = 10_000, maxDepth = 64 } = options;
	if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 ||
		!Number.isSafeInteger(maxDepth) || maxDepth < 1) {
		throw new Error('Invalid local folder scan limits');
	}
	const entryPoints: Record<LocalProjectFormat, string[]> = { latex: [], typst: [], markdown: [] };
	let seen = 0;
	let fileCount = 0;
	const walk = async (path: string, depth: number): Promise<void> => {
		signal?.throwIfAborted();
		for await (const entry of readDirectory(path)) {
			signal?.throwIfAborted();
			if (++seen > maxEntries) throw new Error('Local folder scan entry limit exceeded');
			validateName(entry.name);
			if (seen % 128 === 0) {
				// Yield to input/paint even when a test/cache supplies entries immediately.
				await new Promise<void>((resolve) => setTimeout(resolve, 0));
				signal?.throwIfAborted();
			}
			if (isIgnoredLocalEntry(entry.name)) continue;
			const entryPath = `${path}/${entry.name}`;
			if (entry.isDirectory) {
				if (depth >= maxDepth) throw new Error('Local folder scan depth limit exceeded');
				await walk(entryPath, depth + 1);
			} else {
				fileCount++;
				const format = formatForName(entry.name);
				if (format) entryPoints[format].push(entryPath);
			}
		}
	};
	await walk('', 0);
	signal?.throwIfAborted();
	const formats = (Object.keys(entryPoints) as LocalProjectFormat[])
		.filter((format) => entryPoints[format].length > 0);
	for (const entries of Object.values(entryPoints)) entries.sort(compareEntries);
	return Object.freeze({
		fileCount,
		entryPoints: Object.freeze({
			latex: Object.freeze(entryPoints.latex),
			typst: Object.freeze(entryPoints.typst),
			markdown: Object.freeze(entryPoints.markdown),
		}),
		suggestedKind: formats.length === 1 ? formats[0] : formats.length === 0 ? 'files' : null,
	});
}

export function selectLocalProject(
	discovery: LocalProjectDiscovery,
	kind: LocalProjectKind,
	mainFile?: string,
): { type: LocalProjectKind; group: string; compilerId?: string; mainFile?: string } {
	if (!['latex', 'typst', 'markdown', 'files'].includes(kind)) {
		throw new Error('Choose a local project format');
	}
	const entries = kind === 'files' ? [] : discovery.entryPoints[kind];
	if ((entries.length > 0 && !mainFile) || (mainFile && !entries.includes(mainFile))) {
		throw new Error('Choose an entry file from the selected folder');
	}
	if (mainFile) {
		if (!mainFile.startsWith('/')) throw new Error('Invalid local entry path');
		for (const name of mainFile.slice(1).split('/')) {
			validateName(name);
			if (isIgnoredLocalEntry(name)) throw new Error('Protected local entry path');
		}
	}
	return {
		type: kind,
		group: kind === 'latex' ? 'tex' : kind,
		...(kind === 'latex' || kind === 'typst' ? { compilerId: `internal:${kind}` } : {}),
		...(mainFile ? { mainFile } : {}),
	};
}
