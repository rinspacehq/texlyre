// SPDX-License-Identifier: AGPL-3.0-or-later
import { copyPdfBytesForWorker } from '@src/plugins/viewers/pdf/PdfWorkerInput';

describe('PDF worker input ownership', () => {
	it('keeps the file-store buffer intact when PDF.js transfers its worker copy', () => {
		const stored = new Uint8Array([37, 80, 68, 70]).buffer;
		const worker = copyPdfBytesForWorker(stored);
		expect(worker.buffer).not.toBe(stored);
		expect(stored.byteLength).toBe(4);
		expect(Array.from(new Uint8Array(stored))).toEqual([37, 80, 68, 70]);
	});
});
