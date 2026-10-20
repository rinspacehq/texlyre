// SPDX-License-Identifier: AGPL-3.0-or-later
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createMathLiveExtension } from '@src/extensions/codemirror/MathLiveExtension';
import { latexTypstBidiIsolates } from '@src/extensions/codemirror/BidiExtension';

// Only the floating UI is replaced. Real MathLiveProcessor, math detection,
// CodeMirror state/view and the source editor's bidi decorations are exercised.
jest.mock('@src/extensions/codemirror/mathlive/MathWidget', () => ({
	MathPreviewWidget: jest.fn().mockImplementation((_region: unknown, onEdit: () => void) => ({
		toDOM() {
			const wrapper = document.createElement('div');
			wrapper.className = 'cm-math-preview-overlay';
			const edit = document.createElement('button');
			edit.className = 'cm-math-edit-btn';
			edit.addEventListener('click', onEdit);
			wrapper.appendChild(edit);
			return wrapper;
		},
	})),
	MathEditWidget: jest.fn().mockImplementation(() => ({
		toDOM() {
			const wrapper = document.createElement('div');
			wrapper.className = 'cm-math-editor-overlay';
			return wrapper;
		},
	})),
}));

const source = '设 $\\mathbb Q$';
let view: EditorView;
let measured: Array<() => void>;
const isolatedMath = () => [...view.contentDOM.querySelectorAll('span[style*="unicode-bidi"]')]
	.map(node => node.textContent).join('');

beforeEach(() => {
	jest.useFakeTimers();
	measured = [];
	jest.spyOn(EditorView.prototype, 'requestMeasure').mockImplementation(function (request) {
		if (request) measured.push(() => request.write?.(request.read(view), view));
	});
	jest.spyOn(EditorView.prototype, 'coordsAtPos').mockReturnValue({ left: 10, right: 20, top: 30, bottom: 40 });
	view = new EditorView({
		state: EditorState.create({ doc: source, selection: { anchor: source.length },
			extensions: [latexTypstBidiIsolates(), createMathLiveExtension('latex', 'cursor', 'en')] }),
		parent: document.body,
	});
	for (const write of measured.splice(0)) write();
	jest.advanceTimersByTime(0);
	expect(document.querySelector('.cm-math-preview-overlay')).not.toBeNull();
});

afterEach(() => {
	view?.destroy();
	jest.clearAllTimers();
	jest.restoreAllMocks();
	jest.useRealTimers();
	document.body.replaceChildren();
});

it('keeps the source math DOM isolation stable when native composition starts after a preview', () => {
	expect(isolatedMath()).toContain('$\\mathbb Q$');
	view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
	expect(view.compositionStarted).toBe(true);
	view.dispatch({ changes: { from: source.length, insert: 'w' }, userEvent: 'input.type.compose' });
	expect(view.state.doc.toString()).toBe(source + 'w');
	// Removing this span while the OS owns its adjacent composition range can
	// cancel/restart the IME and move the next replacement into existing math.
	expect(isolatedMath()).toContain('$\\mathbb Q$');
});

it('does not change source isolation while an external equation editor is open', () => {
	document.querySelector<HTMLButtonElement>('.cm-math-edit-btn')?.click();
	jest.advanceTimersByTime(51);
	expect(document.querySelector('.cm-math-editor-overlay')).not.toBeNull();
	view.dispatch({ changes: { from: source.length, insert: 'w' } });
	expect(view.state.doc.toString()).toBe(source + 'w');
	expect(isolatedMath()).toContain('$\\mathbb Q$');
});
