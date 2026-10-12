// SPDX-License-Identifier: AGPL-3.0-or-later
import JSZip from 'jszip';
import { nanoid } from 'nanoid';

import type { FileNode } from '../types/files';
import { getMimeType, isBinaryFile } from '../utils/fileUtils';
import { getLocalWritePathIssue } from './LocalWritePolicy';

const MAX_ARCHIVE_BYTES = 32 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
const MAX_FILE_BYTES = 16 * 1024 * 1024;
const MAX_ENTRIES = 2000;

export interface LocalZipProject {
	name: string;
	files: FileNode[];
	fileCount: number;
	skippedProtectedCount: number;
}

/** Inspect the ZIP directory before the existing backup scanner expands every entry. */
export async function isTeXlyreBackupZip(file: File): Promise<boolean> {
	const zip = await JSZip.loadAsync(new Uint8Array(await file.arrayBuffer()));
	return zip.file('manifest.json') !== null;
}

function safePath(raw: string): string {
	const slashes = raw.replace(/\\/g, '/');
	if (slashes.startsWith('/') || /^[A-Za-z]:/.test(slashes) ||
		Array.from(slashes).some((character) => character.charCodeAt(0) <= 0x1f)) {
		throw new Error('Archive contains an unsafe path');
	}
	const parts = slashes.split('/').filter((part) => part && part !== '.');
	if (parts.includes('..')) throw new Error('Archive contains an unsafe path');
	return parts.join('/');
}

function readBoundedFile(entry: JSZip.JSZipObject, remaining: number): Promise<ArrayBuffer> {
	return new Promise((resolve, reject) => {
		const chunks: Uint8Array[] = [];
		let size = 0;
		// JSZip implements internalStream, but omits it from JSZipObject's public type.
		const stream = (entry as JSZip.JSZipObject & {
			internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
		}).internalStream('uint8array');
		stream.on('data', (chunk: Uint8Array) => {
			size += chunk.byteLength;
			if (size > MAX_FILE_BYTES || size > remaining) {
				stream.pause();
				reject(new Error('Archive expands beyond the local import limit'));
				return;
			}
			chunks.push(chunk);
		});
		stream.on('error', reject);
		stream.on('end', () => {
			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			resolve(bytes.buffer);
		});
		stream.resume();
	});
}

/** A ZIP without a TeXlyre backup manifest becomes a browser-only file project. */
export async function prepareLocalZipProject(file: File): Promise<LocalZipProject> {
	if (!file.name.toLowerCase().endsWith('.zip')) {
		throw new Error('Only ZIP files can be opened as ordinary local projects');
	}
	if (file.size > MAX_ARCHIVE_BYTES) throw new Error('ZIP exceeds the 32 MiB local import limit');
	const zip = await JSZip.loadAsync(new Uint8Array(await file.arrayBuffer()));
	const entries = Object.values(zip.files);
	if (entries.length > MAX_ENTRIES) throw new Error('ZIP has too many entries for local import');
	if (zip.file('manifest.json')) {
		throw new Error('This TeXlyre backup could not be validated; it was not imported as ordinary files');
	}

	const files: FileNode[] = [];
	const seenFiles = new Set<string>();
	const seenDirectories = new Set<string>();
	let expandedBytes = 0;
	let skippedProtectedCount = 0;
	const timestamp = Date.now();
	const addDirectory = (path: string) => {
		if (seenFiles.has(path)) throw new Error('ZIP contains a file/directory path collision');
		if (seenDirectories.has(path)) return;
		seenDirectories.add(path);
		files.push({ id: nanoid(), name: path.split('/').pop() ?? path, path: `/${path}`, type: 'directory', lastModified: timestamp });
	};

	for (const entry of entries) {
		const path = safePath(entry.unsafeOriginalName ?? entry.name);
		if (!path) continue;
		const issue = getLocalWritePathIssue(`/${path}`);
		if (issue === 'protected-path') { skippedProtectedCount++; continue; }
		if (issue) throw new Error('ZIP contains an unsafe path');
		const unixMode = typeof entry.unixPermissions === 'number' ? entry.unixPermissions & 0o170000 : 0;
		if (unixMode === 0o120000) throw new Error('ZIP links cannot be imported as ordinary files');
		const parts = path.split('/');
		const directoryDepth = entry.dir ? parts.length : parts.length - 1;
		for (let index = 1; index <= directoryDepth; index++) addDirectory(parts.slice(0, index).join('/'));
		if (entry.dir) continue;
		if (seenFiles.has(path) || seenDirectories.has(path)) throw new Error('ZIP contains duplicate or colliding paths');
		seenFiles.add(path);
		const content = await readBoundedFile(entry, MAX_EXPANDED_BYTES - expandedBytes);
		expandedBytes += content.byteLength;
		files.push({
			id: nanoid(), name: parts[parts.length - 1], path: `/${path}`, type: 'file',
			content, size: content.byteLength, isBinary: isBinaryFile(path), mimeType: getMimeType(path),
			lastModified: timestamp,
		});
	}
	const fileCount = seenFiles.size;
	if (fileCount === 0) throw new Error('ZIP contains no importable files');
	return { name: file.name.replace(/\.zip$/i, ''), files, fileCount, skippedProtectedCount };
}
