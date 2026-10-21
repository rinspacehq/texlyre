// SPDX-License-Identifier: AGPL-3.0-or-later
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createBurstDeferredLanguage } from '@src/extensions/codemirror/BurstDeferLanguage';

let view: EditorView;
let detach: jest.Mock;
let reattach: jest.Mock;

beforeEach(() => {
	jest.useFakeTimers();
	jest.setSystemTime(1000);
	jest.spyOn(EditorView.prototype, 'requestMeasure').mockImplementation(() => {});
	detach = jest.fn(() => []);
	reattach = jest.fn(() => []);
	view = new EditorView({
		parent: document.body,
		state: EditorState.create({ doc: '设 $V$ 是一个有限维的空间',
			extensions: [createBurstDeferredLanguage(detach, reattach)] }),
	});
});

afterEach(() => {
	view.destroy();
	jest.clearAllTimers();
	jest.restoreAllMocks();
	jest.useRealTimers();
	document.body.replaceChildren();
});

function type(value: string) {
	view.dispatch({ changes: { from: view.state.doc.length, insert: value },
		userEvent: 'input.type.compose' });
}

it('does not detach syntax DOM after native composition has started', () => {
	type(' ');
	jest.advanceTimersByTime(20);
	view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
	expect(view.compositionStarted).toBe(true);
	type('w');
	jest.runAllTicks();
	expect(detach).not.toHaveBeenCalled();
	jest.advanceTimersByTime(400);
	expect(reattach).not.toHaveBeenCalled();
});

it('does not reattach syntax during an IME candidate pause after a typing burst', () => {
	type(' ');
	jest.advanceTimersByTime(20);
	type('x');
	jest.runAllTicks();
	expect(detach).toHaveBeenCalledTimes(1);
	view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
	jest.advanceTimersByTime(400);
	expect(reattach).not.toHaveBeenCalled();
	view.contentDOM.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
	jest.advanceTimersByTime(400);
	expect(reattach).toHaveBeenCalledTimes(1);
});

it('does not run a queued detach after the view has been destroyed', () => {
	type(' ');
	jest.advanceTimersByTime(20);
	type('x');
	view.destroy();
	jest.runAllTicks();
	expect(detach).not.toHaveBeenCalled();
});

it('rechecks composition when a previously queued detach is about to run', () => {
	type(' ');
	jest.advanceTimersByTime(20);
	type('x');
	view.contentDOM.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
	jest.runAllTicks();
	expect(detach).not.toHaveBeenCalled();
	jest.advanceTimersByTime(400);
	expect(reattach).not.toHaveBeenCalled();
});

it('still defers and restores syntax after an ordinary non-composing typing burst', () => {
	type(' ');
	jest.advanceTimersByTime(20);
	type('x');
	jest.runAllTicks();
	expect(detach).toHaveBeenCalledTimes(1);
	jest.advanceTimersByTime(151);
	expect(reattach).toHaveBeenCalledTimes(1);
});
