// SPDX-License-Identifier: AGPL-3.0-or-later

/** PDF.js transfers this buffer to its worker, so it must never alias file storage. */
export function copyPdfBytesForWorker(content: ArrayBuffer): Uint8Array {
	return new Uint8Array(content.slice(0));
}
