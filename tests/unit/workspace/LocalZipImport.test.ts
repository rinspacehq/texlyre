// SPDX-License-Identifier: AGPL-3.0-or-later
import { File as NodeFile } from 'node:buffer';
import JSZip from 'jszip';

import { isTeXlyreBackupZip, prepareLocalZipProject } from '@src/workspace/LocalZipImport';

async function archive(setup: (zip: JSZip) => void, name = '文稿.zip'): Promise<File> {
	const zip = new JSZip();
	setup(zip);
	const bytes = await zip.generateAsync({ type: 'uint8array' });
	return new NodeFile([bytes], name, { type: 'application/zip' }) as unknown as File;
}

describe('ordinary local ZIP import', () => {
	it('keeps mixed document paths and binary bytes without choosing a project language', async () => {
		const file = await archive((zip) => {
			zip.file('main.tex', '中文 LaTeX');
			zip.file('chapters/正文.typ', '中文 Typst');
			zip.file('notes.md', '# Markdown');
			zip.file('references.bib', '@book{a,title={中文}}');
			zip.file('images/asset.png', new Uint8Array([0, 255, 7]));
		});
		expect(await isTeXlyreBackupZip(file)).toBe(false);
		const prepared = await prepareLocalZipProject(file);
		expect(prepared.name).toBe('文稿');
		expect(prepared.fileCount).toBe(5);
		expect(prepared.files.map((entry) => entry.path)).toEqual(expect.arrayContaining([
			'/main.tex', '/chapters', '/chapters/正文.typ', '/notes.md', '/references.bib', '/images', '/images/asset.png',
		]));
		const image = prepared.files.find((entry) => entry.path === '/images/asset.png');
		expect(image?.isBinary).toBe(true);
		expect(Array.from(new Uint8Array(image?.content as ArrayBuffer))).toEqual([0, 255, 7]);
	});

	it('does not import protected Git and dependency entries', async () => {
		const prepared = await prepareLocalZipProject(await archive((zip) => {
			zip.file('.git/config', 'private metadata');
			zip.file('node_modules/pkg/index.js', 'dependency');
			zip.file('.gitignore', 'node_modules');
		}));
		expect(prepared.files.map((entry) => entry.path)).toEqual(['/.gitignore']);
		expect(prepared.skippedProtectedCount).toBeGreaterThan(0);
	});

	it('rejects a malformed TeXlyre backup rather than silently treating it as loose files', async () => {
		const file = await archive((zip) => {
			zip.file('manifest.json', '{}');
			zip.file('main.tex', 'draft');
		});
		expect(await isTeXlyreBackupZip(file)).toBe(true);
		await expect(prepareLocalZipProject(file)).rejects.toThrow('TeXlyre backup');
	});

	it('rejects a file whose path collides with a directory', async () => {
		await expect(prepareLocalZipProject(await archive((zip) => {
			zip.file('chapter', 'file');
			zip.file('chapter/page.md', 'text');
		}))).rejects.toThrow('collision');
	});

	it('rejects traversal before a ZIP library sanitizes the entry name', async () => {
		await expect(prepareLocalZipProject(await archive((zip) => {
			zip.file('../outside.tex', 'not inside');
			zip.file('main.tex', 'draft');
		}))).rejects.toThrow('unsafe path');
	});

	it('rejects an expanded ZIP entry above the per-file bound', async () => {
		await expect(prepareLocalZipProject(await archive((zip) => {
			zip.file('large.txt', 'x'.repeat(16 * 1024 * 1024 + 1));
		}))).rejects.toThrow('local import limit');
	});
});
