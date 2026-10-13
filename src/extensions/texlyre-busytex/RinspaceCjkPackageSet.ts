import type { TexliveRemoteFile } from 'texlyre-busytex';

import review from '../../../config/rinspace/texlive-cjk.review.json';
import type { FileNode } from '../../types/files';

export const RINSPACE_BUSY_TEXLIVE_ASSET_SET = review.assetSet;
export const RINSPACE_BUSY_TEXLIVE_DIGEST = review.inventorySha256;
export const RINSPACE_BUSY_TEXLIVE_ASSET_ROOT =
	`${__BASE_PATH__}/assets/${RINSPACE_BUSY_TEXLIVE_ASSET_SET}/${RINSPACE_BUSY_TEXLIVE_DIGEST}`;

const CJK_ENTRY_PATTERN =
	/\\(?:documentclass|usepackage|RequirePackage)(?:\s*\[[^\]]*\])?\s*\{[^}]*(?:ctex(?:art|book|rep)?|xeCJK|CJKfntef|zhnumber)[^}]*\}/i;
const TEX_SOURCE_PATTERN = /\.(?:cls|ltx|sty|tex)$/i;

type AssetResponse = Pick<Response, 'arrayBuffer' | 'ok' | 'status'>;
export type AssetRequest = (
	input: string,
	init: RequestInit,
) => Promise<AssetResponse>;
export type AssetDigest = (buffer: ArrayBuffer) => Promise<ArrayBuffer>;

const sha256Digest: AssetDigest = (buffer) =>
	crypto.subtle.digest('SHA-256', buffer);

function toHex(bytes: ArrayBuffer): string {
	return Array.from(new Uint8Array(bytes), (byte) =>
		byte.toString(16).padStart(2, '0'),
	).join('');
}

function fileBytes(file: TexliveRemoteFile): Uint8Array {
	return typeof file.content === 'string'
		? new TextEncoder().encode(file.content)
		: file.content;
}

async function matchesEntry(
	file: TexliveRemoteFile,
	entry: (typeof review.entries)[number],
	digest: AssetDigest,
): Promise<boolean> {
	const bytes = fileBytes(file);
	if (bytes.byteLength !== entry.size) return false;
	const buffer = bytes.buffer.slice(
		bytes.byteOffset,
		bytes.byteOffset + bytes.byteLength,
	) as ArrayBuffer;
	return toHex(await digest(buffer)) === entry.sha256;
}

function sourceText(file: FileNode): string {
	if (!TEX_SOURCE_PATTERN.test(file.path) || file.content === undefined) return '';
	if (typeof file.content === 'string') return file.content;
	const bytes =
		file.content instanceof ArrayBuffer
			? new Uint8Array(file.content)
			: (file.content as Uint8Array);
	return new TextDecoder().decode(bytes);
}

export function needsRinspaceCjkPackageSet(files: FileNode[]): boolean {
	return files.some((file) => CJK_ENTRY_PATTERN.test(sourceText(file)));
}

export async function hasRinspaceCjkPackageSet(
	files: TexliveRemoteFile[],
	digest: AssetDigest = sha256Digest,
): Promise<boolean> {
	const byKey = new Map(
		files.map((file) => [`${file.format ?? ''}/${file.name}`, file]),
	);
	return (
		await Promise.all(
			review.entries.map(async (entry) => {
				const [format, name] = entry.path.split('/', 2);
				const file = byKey.get(`${Number.parseInt(format, 10)}/${name}`);
				return file ? matchesEntry(file, entry, digest) : false;
			}),
		)
	).every(Boolean);
}

export async function loadRinspaceCjkPackageSet(
	request: AssetRequest = fetch,
	digest: AssetDigest = sha256Digest,
): Promise<TexliveRemoteFile[]> {
	const entries = await Promise.all(
		review.entries.map(async (entry) => {
			const response = await request(
				`${RINSPACE_BUSY_TEXLIVE_ASSET_ROOT}/${entry.path}`,
				{
					cache: 'force-cache',
					credentials: 'same-origin',
					redirect: 'error',
					referrerPolicy: 'no-referrer',
					signal: AbortSignal.timeout(120_000),
				},
			);
			if (!response.ok) {
				throw new Error(
					`Fixed CJK runtime asset ${entry.path} returned HTTP ${response.status}`,
				);
			}
			const buffer = await response.arrayBuffer();
			if (buffer.byteLength !== entry.size) {
				throw new Error(`Fixed CJK runtime asset ${entry.path} has the wrong size`);
			}
			const [format, name] = entry.path.split('/', 2);
			const file = {
				name,
				format: Number.parseInt(format, 10),
				content: new Uint8Array(buffer),
			};
			if (!(await matchesEntry(file, entry, digest))) {
				throw new Error(`Fixed CJK runtime asset ${entry.path} failed integrity`);
			}
			return file;
		}),
	);
	return entries;
}
