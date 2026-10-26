// SPDX-License-Identifier: AGPL-3.0-or-later
import * as Y from 'yjs';

import {
	applyDocumentTextEdits,
	HostDocumentEditOrigin,
	minimalDocumentTextEdits,
} from '@src/services/DocumentTextEdits';

test('applies disjoint UTF-16 edits without replacing untouched text', () => {
	const source = 'Title 标题\nEuler: $e^{i\\pi}+1=0$\nConclusion';
	const title = source.indexOf('标题');
	const conclusion = source.indexOf('Conclusion');
	const edits = [
		{ from: title, to: title + '标题'.length, insert: '琳的标题' },
		{ from: conclusion, to: conclusion + 'Conclusion'.length, insert: '结论' },
	];
	expect(applyDocumentTextEdits(source, edits)).toBe(
		'Title 琳的标题\nEuler: $e^{i\\pi}+1=0$\n结论',
	);
});

test('rejects overlapping, duplicate, out-of-range and fractional edits', () => {
	for (const edits of [
		[
			{ from: 0, to: 2, insert: '' },
			{ from: 1, to: 3, insert: '' },
		],
		[
			{ from: 1, to: 1, insert: 'a' },
			{ from: 1, to: 1, insert: 'b' },
		],
		[{ from: -1, to: 0, insert: '' }],
		[{ from: 0.5, to: 1, insert: '' }],
		[{ from: 0, to: 99, insert: '' }],
	]) {
		expect(() => applyDocumentTextEdits('abc', edits)).toThrow(
			'ordered, disjoint and in bounds',
		);
	}
});

test('derives a minimal edit and isolates a host transaction as one undo item', () => {
	const before = 'alpha 中间 omega';
	const after = 'alpha 数学 $x^2$ omega';
	const edits = minimalDocumentTextEdits(before, after);
	expect(edits).toHaveLength(1);
	expect(applyDocumentTextEdits(before, edits)).toBe(after);

	const doc = new Y.Doc();
	const text = doc.getText('codemirror');
	text.insert(0, before);
	const undo = new Y.UndoManager(text, {
		trackedOrigins: new Set([null, HostDocumentEditOrigin]),
	});
	const isolate = (transaction: Y.Transaction) => {
		if (transaction.origin instanceof HostDocumentEditOrigin) undo.stopCapturing();
	};
	doc.on('beforeTransaction', isolate);
	doc.on('afterTransaction', isolate);

	doc.transact(() => {
		for (const edit of [...edits].reverse()) {
			text.delete(edit.from, edit.to - edit.from);
			text.insert(edit.from, edit.insert);
		}
	}, new HostDocumentEditOrigin('test-host', 'operation-1'));
	text.insert(text.length, '!');
	expect(text.toString()).toBe(`${after}!`);

	undo.undo();
	expect(text.toString()).toBe(after);
	undo.undo();
	expect(text.toString()).toBe(before);

	doc.off('beforeTransaction', isolate);
	doc.off('afterTransaction', isolate);
	undo.destroy();
	doc.destroy();
});
