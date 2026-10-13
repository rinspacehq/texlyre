import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';

import type { FileNode } from '@src/types/files';
import {
	hasRinspaceCjkPackageSet,
	loadRinspaceCjkPackageSet,
	needsRinspaceCjkPackageSet,
	RINSPACE_BUSY_TEXLIVE_ASSET_ROOT,
} from '@src/extensions/texlyre-busytex/RinspaceCjkPackageSet';

const digest =
	'2bafcd705bbff2e02567be5c0b08a86054e82d2bafccddeea189a935fed24718';
const sourceRoot = path.resolve(
	process.cwd(),
	'vendor/rinspace/texlive-2026-cjk',
	digest,
);

function file(pathname: string, content: string): FileNode {
	return {
		id: pathname,
		name: pathname.split('/').pop()!,
		path: pathname,
		type: 'file',
		content,
		lastModified: 0,
		size: content.length,
		mimeType: 'text/plain',
		isBinary: false,
	};
}

async function vendoredResponse(input: string) {
	const marker = `${digest}/`;
	const relative = input.slice(input.indexOf(marker) + marker.length);
	const bytes = await readFile(path.join(sourceRoot, relative));
	return {
		ok: true,
		status: 200,
		async arrayBuffer() {
			return bytes.buffer.slice(
				bytes.byteOffset,
				bytes.byteOffset + bytes.byteLength,
			);
		},
	};
}

async function nodeSha256(buffer: ArrayBuffer): Promise<ArrayBuffer> {
	const result = createHash('sha256').update(new Uint8Array(buffer)).digest();
	return result.buffer.slice(
		result.byteOffset,
		result.byteOffset + result.byteLength,
	) as ArrayBuffer;
}

describe('Rinspace fixed BusyTeX CJK package set', () => {
	it('detects actual CJK classes and packages without treating Chinese prose as a language gate', () => {
		expect(
			needsRinspaceCjkPackageSet([
				file('/main.tex', '\\documentclass{ctexart}\\begin{document}中文\\end{document}'),
			]),
		).toBe(true);
		expect(
			needsRinspaceCjkPackageSet([
				file('/main.tex', '\\documentclass{article}\\begin{document}中文\\end{document}'),
			]),
		).toBe(false);
	});

	it('loads and verifies all 20 same-origin files', async () => {
		const request = jest.fn(vendoredResponse);
		const files = await loadRinspaceCjkPackageSet(request, nodeSha256);
		expect(files).toHaveLength(20);
		expect(files.reduce((total, entry) => total + entry.content.byteLength, 0)).toBe(
			18888796,
		);
		expect(request).toHaveBeenCalledTimes(20);
		for (const [url, init] of request.mock.calls) {
			expect(url).toMatch(new RegExp(`^${RINSPACE_BUSY_TEXLIVE_ASSET_ROOT}/`));
			expect(init.credentials).toBe('same-origin');
			expect(init.redirect).toBe('error');
		}
	});

	it('rejects a same-size response with the wrong bytes', async () => {
		const request = jest.fn(async (input: string) => {
			const response = await vendoredResponse(input);
			if (!input.endsWith('/26/ctexart.cls')) return response;
			const original = await response.arrayBuffer();
			return {
				...response,
				async arrayBuffer() {
					return new Uint8Array(original.byteLength).buffer;
				},
			};
		});
		await expect(loadRinspaceCjkPackageSet(request, nodeSha256)).rejects.toThrow(
			/ctexart\.cls failed integrity/,
		);
	});

	it('rejects a missing same-origin file explicitly', async () => {
		const request = jest.fn(async (input: string) => {
			if (!input.endsWith('/26/ctexart.cls')) return vendoredResponse(input);
			return {
				ok: false,
				status: 404,
				async arrayBuffer() {
					return new ArrayBuffer(0);
				},
			};
		});
		await expect(loadRinspaceCjkPackageSet(request, nodeSha256)).rejects.toThrow(
			/ctexart\.cls returned HTTP 404/,
		);
	});

	it('surfaces an asset timeout instead of handing partial bytes to BusyTeX', async () => {
		const timeout = new DOMException('Fixed asset request timed out', 'TimeoutError');
		const request = jest.fn(async (input: string) => {
			if (input.endsWith('/26/ctexart.cls')) throw timeout;
			return vendoredResponse(input);
		});
		await expect(loadRinspaceCjkPackageSet(request, nodeSha256)).rejects.toBe(
			timeout,
		);
	});

	it('recognizes only a complete verified persisted set', async () => {
		const files = await loadRinspaceCjkPackageSet(vendoredResponse, nodeSha256);
		await expect(hasRinspaceCjkPackageSet(files, nodeSha256)).resolves.toBe(true);
		await expect(hasRinspaceCjkPackageSet(files.slice(1), nodeSha256)).resolves.toBe(
			false,
		);
		const corrupted = files.map((entry, index) =>
			index === 0 ? { ...entry, content: new Uint8Array(entry.content.byteLength) } : entry,
		);
		await expect(hasRinspaceCjkPackageSet(corrupted, nodeSha256)).resolves.toBe(
			false,
		);
	});
});
