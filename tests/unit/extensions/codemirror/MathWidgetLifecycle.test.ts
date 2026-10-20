// SPDX-License-Identifier: AGPL-3.0-or-later
import { EditorView } from '@codemirror/view';
import { MathEditWidget, MathPreviewWidget } from '@src/extensions/codemirror/mathlive/MathWidget';
import type { MathRegion } from '@src/extensions/codemirror/mathlive/MathDetector';

const mockFocus = jest.fn();
const mockMenu = jest.fn();
jest.mock('@src/i18n', () => ({ t: (key: string) => key }));
jest.mock('@src/extensions/codemirror/mathlive/SymbolSearchPanel', () => ({ SymbolSearchPanel: jest.fn() }));
jest.mock('mathlive', () => {
	class MountedMathfield extends HTMLElement {
		readOnly = false;
		constructor() { super(); }
		get value() { return this.getAttribute('data-value') ?? ''; }
		set value(value: string) { this.setAttribute('data-value', value); }
		set menuItems(value: unknown[]) {
			if (!this.isConnected) throw new Error('Mathfield not mounted');
			mockMenu(value);
		}
		focus() { mockFocus(); }
	}
	customElements.define('test-mathfield-lifecycle', MountedMathfield);
	return { MathfieldElement: MountedMathfield };
});

const region: MathRegion = {
	from: 0, to: 3, replaceFrom: 0, replaceTo: 3,
	type: 'inline', fileType: 'latex', content: 'x', rawContent: 'x',
	contentStart: 1, contentEnd: 2, leadingWS: '', trailingWS: '',
	delimiterStart: '$', delimiterEnd: '$', previewLatex: 'x',
};
const views: EditorView[] = [];
function view() {
	const parent = document.createElement('div');
	document.body.appendChild(parent);
	const editor = new EditorView({ parent });
	views.push(editor);
	return editor;
}
beforeEach(() => { jest.useFakeTimers(); jest.clearAllMocks(); });
afterEach(() => {
	for (const editor of views.splice(0)) editor.destroy();
	document.body.replaceChildren();
	jest.clearAllTimers();
	jest.useRealTimers();
});

it('does not configure a preview after its overlay was removed before deferred initialization', () => {
	const widget = new MathPreviewWidget(region, jest.fn());
	const dom = widget.toDOM();
	document.body.appendChild(dom);
	dom.remove();
	expect(() => jest.advanceTimersByTime(0)).not.toThrow();
	expect(mockMenu).not.toHaveBeenCalled();
});

it('configures the preview in the documented MathLive mount lifecycle', () => {
	const dom = new MathPreviewWidget(region, jest.fn()).toDOM();
	document.body.appendChild(dom);
	dom.querySelector('.cm-math-preview-field')?.dispatchEvent(new Event('mount'));
	expect(mockMenu).toHaveBeenCalledWith([]);
});

it('does not initialize or focus a removed equation editor', () => {
	const dom = new MathEditWidget(region, view(), jest.fn(), jest.fn()).toDOM();
	document.body.appendChild(dom);
	dom.remove();
	jest.advanceTimersByTime(0);
	expect(mockFocus).not.toHaveBeenCalled();
});

it('does not steal focus if the user moved to another input before mount', () => {
	const editor = view();
	editor.focus();
	const dom = new MathEditWidget(region, editor, jest.fn(), jest.fn()).toDOM();
	document.body.appendChild(dom);
	const other = document.createElement('input');
	document.body.appendChild(other);
	other.focus();
	dom.querySelector('.cm-math-editor-field')?.dispatchEvent(new Event('mount'));
	jest.advanceTimersByTime(0);
	expect(mockFocus).not.toHaveBeenCalled();
	expect(document.activeElement).toBe(other);
});

it('initializes and focuses the live equation editor after mount', () => {
	const editor = view();
	editor.focus();
	const dom = new MathEditWidget(region, editor, jest.fn(), jest.fn()).toDOM();
	document.body.appendChild(dom);
	const field = dom.querySelector('.cm-math-editor-field');
	field?.dispatchEvent(new Event('mount'));
	expect(field).toHaveAttribute('data-value', 'x');
	expect(mockFocus).toHaveBeenCalledTimes(1);
});
