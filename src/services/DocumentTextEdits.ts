// SPDX-License-Identifier: AGPL-3.0-or-later
export interface DocumentTextEdit {
	readonly from: number;
	readonly to: number;
	readonly insert: string;
}

export interface DocumentUpdateOptions {
	readonly origin?: unknown;
	readonly edits?: readonly DocumentTextEdit[];
}

/** Product-neutral origin for host-initiated edits that need an isolated undo item. */
export class HostDocumentEditOrigin {
	constructor(
		readonly source: string,
		readonly operationId: string,
	) {}
}

export function applyDocumentTextEdits(
	content: string,
	edits: readonly DocumentTextEdit[],
): string {
	const ordered = [...edits].sort((left, right) =>
		left.from === right.from ? left.to - right.to : left.from - right.from,
	);
	let cursor = 0;
	let previousFrom: number | null = null;
	let output = '';
	for (const edit of ordered) {
		if (
			!Number.isSafeInteger(edit.from) ||
			!Number.isSafeInteger(edit.to) ||
			edit.from < cursor ||
			edit.from < 0 ||
			edit.to < edit.from ||
			edit.to > content.length ||
			edit.from === previousFrom
		) {
			throw new Error('Document text edits must be ordered, disjoint and in bounds');
		}
		output += content.slice(cursor, edit.from);
		output += edit.insert;
		cursor = edit.to;
		previousFrom = edit.from;
	}
	return output + content.slice(cursor);
}

export function minimalDocumentTextEdits(
	currentContent: string,
	newContent: string,
): DocumentTextEdit[] {
	if (currentContent === newContent) return [];
	let prefix = 0;
	while (
		prefix < currentContent.length &&
		prefix < newContent.length &&
		currentContent[prefix] === newContent[prefix]
	) {
		prefix += 1;
	}
	let currentSuffix = currentContent.length;
	let nextSuffix = newContent.length;
	while (
		currentSuffix > prefix &&
		nextSuffix > prefix &&
		currentContent[currentSuffix - 1] === newContent[nextSuffix - 1]
	) {
		currentSuffix -= 1;
		nextSuffix -= 1;
	}
	return [
		{
			from: prefix,
			to: currentSuffix,
			insert: newContent.slice(prefix, nextSuffix),
		},
	];
}
