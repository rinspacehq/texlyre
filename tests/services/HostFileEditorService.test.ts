// SPDX-License-Identifier: AGPL-3.0-or-later
import { history, redo, undo } from '@codemirror/commands';
import { EditorState } from '@codemirror/state';
import { EditorView } from 'codemirror';

import { HostDocumentEditOrigin } from '@src/services/DocumentTextEdits';
import {
	hostFileEditOrigin,
	HostFileEditorService,
} from '@src/services/HostFileEditorService';

test('applies one identified host transaction with isolated undo and redo', () => {
	const parent = document.createElement('div');
	document.body.append(parent);
	const seenOrigins: HostDocumentEditOrigin[] = [];
	const view = new EditorView({
		parent,
		state: EditorState.create({
			doc: '中文 source $x^2$',
			extensions: [
				history(),
				EditorView.updateListener.of((update) => {
					for (const transaction of update.transactions) {
						const origin = transaction.annotation(hostFileEditOrigin);
						if (origin) seenOrigins.push(origin);
					}
				}),
			],
		}),
	});
	const service = new HostFileEditorService();
	const unregister = service.register('project-1', 'file-1', view);
	const origin = new HostDocumentEditOrigin('test-host', 'operation-1');

	expect(service.read('project-1', 'file-1')).toBe('中文 source $x^2$');
	expect(service.apply(
		'project-1',
		'file-1',
		'中文 source $x^2$',
		[{ from: 3, to: 9, insert: '琳修改' }],
		origin,
	)).toEqual({ status: 'updated', content: '中文 琳修改 $x^2$' });
	expect(seenOrigins).toEqual([origin]);
	expect(view.state.doc.toString()).toBe('中文 琳修改 $x^2$');
	view.dispatch({
		changes: {
			from: view.state.doc.length,
			insert: ' 继续输入',
		},
		userEvent: 'input.type.compose.start',
	});
	expect(view.state.doc.toString()).toBe('中文 琳修改 $x^2$ 继续输入');
	expect(undo(view)).toBe(true);
	expect(view.state.doc.toString()).toBe('中文 琳修改 $x^2$');
	expect(undo(view)).toBe(true);
	expect(view.state.doc.toString()).toBe('中文 source $x^2$');
	expect(redo(view)).toBe(true);
	expect(view.state.doc.toString()).toBe('中文 琳修改 $x^2$');
	expect(redo(view)).toBe(true);
	expect(view.state.doc.toString()).toBe('中文 琳修改 $x^2$ 继续输入');

	expect(service.apply(
		'project-1',
		'file-1',
		'stale source',
		[{ from: 0, to: 0, insert: '不应写入' }],
		new HostDocumentEditOrigin('test-host', 'operation-2'),
	)).toEqual({
		status: 'conflict',
		actualContent: '中文 琳修改 $x^2$ 继续输入',
	});
	expect(view.state.doc.toString()).toBe('中文 琳修改 $x^2$ 继续输入');

	unregister();
	expect(service.read('project-1', 'file-1')).toBeUndefined();
	expect(service.apply(
		'project-1',
		'file-1',
		'中文 琳修改 $x^2$ 继续输入',
		[{ from: 0, to: 0, insert: '关闭后' }],
		new HostDocumentEditOrigin('test-host', 'operation-3'),
	)).toEqual({ status: 'not-open' });
	view.destroy();
	parent.remove();
});


test('keeps continued typing before an external insertion at the caret', () => {
	const parent = document.createElement('div');
	document.body.append(parent);
	const initial = '// HUMAN 中文';
	const inserted = '\n\nAgent paragraph\n// AGENT';
	const view = new EditorView({ parent, state: EditorState.create({
		doc: initial, selection: { anchor: initial.length }, extensions: [history()],
	}) });
	const service = new HostFileEditorService();
	const unregister = service.register('project', 'file', view);
	try {
		expect(service.apply('project', 'file', initial,
			[{ from: initial.length, to: initial.length, insert: inserted }],
			new HostDocumentEditOrigin('test-host', 'caret-boundary'),
		)).toEqual({ status: 'updated', content: initial + inserted });
		expect(view.state.selection.main.head).toBe(initial.length);
		view.dispatch(view.state.replaceSelection('123'));
		expect(view.state.doc.toString()).toBe(initial + '123' + inserted);
	} finally {
		unregister(); view.destroy(); parent.remove();
	}
});
