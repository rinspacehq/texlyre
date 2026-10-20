// SPDX-License-Identifier: AGPL-3.0-or-later
import { EditorSelection, Text } from '@codemirror/state';
import { EditorDraftService } from '@src/services/EditorDraftService';

const main = { projectId: 'project-one', fileId: 'main' };
const text = (value: string) => Text.of(value.split('\n'));

it('retains a manual draft, selection and undo snapshot across file switches without a write', () => {
	const cache = new EditorDraftService(new EventTarget());
	cache.open(main, 'stored', false);
	const selection = EditorSelection.single(8);
	cache.record(main, text('中文 draft $x^2$'), selection, { done: ['undo token'] });
	cache.open({ ...main, fileId: 'intro' }, 'intro', false);
	const { draft } = cache.open(main, 'stored', false);
	expect(draft.document.toString()).toBe('中文 draft $x^2$');
	expect(draft.selection).toBe(selection);
	expect(draft.history).toEqual({ done: ['undo token'] });
	expect(draft.dirty).toBe(true);
});

it('does not reset a saved live view from an unchanged old content prop', () => {
	const cache = new EditorDraftService(new EventTarget());
	cache.open(main, 'initial', false);
	cache.record(main, text('already saved newer draft'), EditorSelection.single(5));
	cache.markSaved(main, 'already saved newer draft');
	const { draft } = cache.open(main, 'initial', true);
	expect(draft.document.toString()).toBe('already saved newer draft');
	expect(draft.selection.main.head).toBe(5);
	expect(draft.dirty).toBe(false);
});

it('loads genuinely newer storage instead of reviving a clean obsolete snapshot', () => {
	const cache = new EditorDraftService(new EventTarget());
	cache.open(main, 'original', false);
	cache.record(main, text('original'), EditorSelection.single(3), { oldHistory: true });
	const { draft, sourceConflict } = cache.open(main, 'remote replacement', false);
	expect(draft.document.toString()).toBe('remote replacement');
	expect(draft.history).toBeUndefined();
	expect(draft.dirty).toBe(false);
	expect(sourceConflict).toBe(false);
});

it('retains and reports an unsaved draft when its loaded source changes externally', () => {
	const cache = new EditorDraftService(new EventTarget());
	cache.open(main, 'original', false);
	cache.record(main, text('local unsaved 中文'), EditorSelection.single(2));
	const { draft, sourceConflict } = cache.open(main, 'remote replacement', false);
	expect(draft.document.toString()).toBe('local unsaved 中文');
	expect(draft.savedDocument.toString()).toBe('remote replacement');
	expect(draft.dirty).toBe(true);
	expect(sourceConflict).toBe(true);
});

it('never applies a same-numbered file draft to another project', () => {
	const cache = new EditorDraftService(new EventTarget());
	cache.open(main, 'original', false);
	cache.record(main, text('private project-one draft'), EditorSelection.single(2));
	const { draft } = cache.open({ ...main, projectId: 'project-two' }, 'other project', false);
	expect(draft.document.toString()).toBe('other project');
	expect(draft.dirty).toBe(false);
});

it('does not mark newer input clean when an older save completes', () => {
	const cache = new EditorDraftService(new EventTarget());
	cache.open(main, 'original', false);
	cache.record(main, text('older snapshot'), EditorSelection.single(2));
	cache.record(main, text('newer input'), EditorSelection.single(3));
	cache.markSaved(main, 'older snapshot');
	expect(cache.peek(main)?.dirty).toBe(true);
	expect(cache.peek(main)?.document.toString()).toBe('newer input');
	cache.markSaved(main, 'newer input');
	expect(cache.peek(main)?.dirty).toBe(false);
});

it('warns before leaving with an unsaved draft, including an inactive file', () => {
	const target = new EventTarget();
	const cache = new EditorDraftService(target);
	cache.open(main, 'original', false);
	cache.record(main, text('unsaved'), EditorSelection.single(2));
	cache.open({ ...main, fileId: 'intro' }, 'intro', false);
	const dirty = new Event('beforeunload', { cancelable: true });
	target.dispatchEvent(dirty);
	expect(dirty.defaultPrevented).toBe(true);
	cache.markSaved(main, 'unsaved');
	const clean = new Event('beforeunload', { cancelable: true });
	target.dispatchEvent(clean);
	expect(clean.defaultPrevented).toBe(false);
});

it('does not mark a selection-only update dirty', () => {
	const cache = new EditorDraftService(new EventTarget());
	cache.open(main, 'original', false);
	cache.record(main, text('original'), EditorSelection.single(3));
	expect(cache.hasUnsavedChanges()).toBe(false);
});

it('bounds clean history without evicting any unsaved draft', () => {
	const cache = new EditorDraftService(new EventTarget());
	cache.open(main, 'original', false);
	cache.record(main, text('unsaved'), EditorSelection.single(2));
	for (let index = 0; index < 40; index++) cache.open({ ...main, fileId: 'clean-' + index }, 'clean', false);
	expect(cache.peek({ ...main, fileId: 'clean-0' })).toBeUndefined();
	expect(cache.peek(main)?.document.toString()).toBe('unsaved');
	expect(cache.peek(main)?.dirty).toBe(true);
});
