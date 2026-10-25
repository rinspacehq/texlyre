// SPDX-License-Identifier: AGPL-3.0-or-later
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import * as Y from 'yjs';

import { createYjsEditorBindingExtensions } from '@src/hooks/editor/yjsBinding';
import { HostDocumentEditOrigin } from '@src/services/DocumentTextEdits';

let view: EditorView;
let doc: Y.Doc;
let undo: Y.UndoManager;
let cleanupBinding: () => void;

afterEach(() => {
	view?.destroy();
	cleanupBinding?.();
	undo?.destroy();
	doc?.destroy();
	document.body.replaceChildren();
});

test('keeps a long IME composition and cursor stable across one Agent Yjs transaction', () => {
	const repeated = '连续中文输入与 $x^2+y^2=z^2$ '.repeat(160);
	const initial = `标题\n${repeated}\n尾部旧内容`;
	doc = new Y.Doc();
	const text = doc.getText('codemirror');
	text.insert(0, initial);
	undo = new Y.UndoManager(text, {
		trackedOrigins: new Set([null, HostDocumentEditOrigin]),
	});
	const isolateAgentEdit = (transaction: Y.Transaction) => {
		if (transaction.origin instanceof HostDocumentEditOrigin) undo.stopCapturing();
	};
	doc.on('beforeTransaction', isolateAgentEdit);
	doc.on('afterTransaction', isolateAgentEdit);
	const binding = createYjsEditorBindingExtensions(text, null, undo);
	cleanupBinding = () => {
		doc.off('beforeTransaction', isolateAgentEdit);
		doc.off('afterTransaction', isolateAgentEdit);
		binding.cleanup();
	};
	view = new EditorView({
		parent: document.body,
		state: EditorState.create({
			doc: initial,
			extensions: binding.extensions,
		}),
	});

	const compositionAt = initial.indexOf('\n尾部旧内容');
	view.dispatch({ selection: { anchor: compositionAt } });
	view.contentDOM.dispatchEvent(
		new CompositionEvent('compositionstart', { bubbles: true }),
	);
	view.dispatch({
		changes: { from: compositionAt, insert: '输入法候选' },
		userEvent: 'input.type.compose',
	});
	const cursorAfterComposition = compositionAt + '输入法候选'.length;
	expect(view.state.selection.main.head).toBe(cursorAfterComposition);

	const beforeAgent = text.toString();
	const suffixAt = beforeAgent.indexOf('尾部旧内容');
	doc.transact(() => {
		text.delete(suffixAt, '尾部旧内容'.length);
		text.insert(suffixAt, '尾部由琳修改 $\\alpha+\\beta$');
	}, new HostDocumentEditOrigin('rinspace-agent', 'agent-composition-test'));

	expect(view.compositionStarted).toBe(true);
	expect(view.state.selection.main.head).toBe(cursorAfterComposition);
	view.dispatch({
		changes: { from: cursorAfterComposition, insert: '继续输入' },
		userEvent: 'input.type.compose',
	});
	view.contentDOM.dispatchEvent(
		new CompositionEvent('compositionend', { bubbles: true }),
	);

	const finalContent = text.toString();
	expect(view.state.doc.toString()).toBe(finalContent);
	expect(finalContent).toContain('输入法候选继续输入');
	expect(finalContent).toContain('尾部由琳修改 $\\alpha+\\beta$');
	expect(finalContent).toContain(repeated);
});
