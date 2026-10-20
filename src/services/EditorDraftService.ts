import { EditorSelection, Text } from '@codemirror/state';

export interface EditorFileIdentity {
	projectId: string;
	fileId: string;
}

export interface EditorFileDraft {
	document: Text;
	selection: EditorSelection;
	history?: unknown;
	loadedContent: string;
	savedDocument: Text;
	dirty: boolean;
}

export interface EditorDraftChange extends EditorFileIdentity {
	dirty: boolean;
}

interface DraftEntry extends EditorFileDraft, EditorFileIdentity {}

// Memory drafts are independent of periodic file saving. In manual mode no
// storage or folder write is implied by switching or reconstructing a view.
export class EditorDraftService {
	private entries = new Map<string, DraftEntry>();
	private listeners = new Set<(change: EditorDraftChange) => void>();
	private unloadRegistered = false;
	private readonly beforeUnload = (event: Event): void => {
		if (!this.hasUnsavedChanges()) return;
		event.preventDefault();
		// Only registered for beforeunload; browsers require this legacy field.
		(event as BeforeUnloadEvent).returnValue = '';
	};

	constructor(private readonly unloadTarget: EventTarget | undefined =
		typeof window === 'undefined' ? undefined : window) {}

	static key(identity: EditorFileIdentity): string {
		return JSON.stringify([identity.projectId, identity.fileId]);
	}

	peek(identity: EditorFileIdentity): Readonly<EditorFileDraft> | undefined {
		return this.entries.get(EditorDraftService.key(identity));
	}

	open(identity: EditorFileIdentity, content: string, continuingView: boolean): {
		draft: Readonly<EditorFileDraft>;
		sourceConflict: boolean;
	} {
		const key = EditorDraftService.key(identity);
		const previous = this.entries.get(key);
		const incoming = Text.of(content.split('\n'));
		const sameLoadedSource = continuingView && previous?.loadedContent === content;
		const retain = previous && (sameLoadedSource || previous.dirty || previous.document.eq(incoming));
		const sourceConflict = Boolean(previous?.dirty && previous.loadedContent !== content && !previous.document.eq(incoming));
		const entry: DraftEntry = retain ? {
			...previous,
			loadedContent: content,
			savedDocument: sameLoadedSource ? previous.savedDocument : incoming,
		} : {
			...identity, document: incoming, savedDocument: incoming,
			selection: EditorSelection.single(0), loadedContent: content, dirty: false,
		};
		entry.dirty = !entry.document.eq(entry.savedDocument);
		this.entries.delete(key);
		this.entries.set(key, entry);
		// Keep clean undo history bounded, but never evict an unsaved draft.
		let clean = [...this.entries.values()].filter(value => !value.dirty).length;
		for (const [candidate, value] of this.entries) {
			if (clean <= 32) break;
			if (candidate !== key && !value.dirty) { this.entries.delete(candidate); clean--; }
		}
		this.notify(entry);
		return { draft: entry, sourceConflict };
	}

	record(identity: EditorFileIdentity, document: Text, selection: EditorSelection, history?: unknown): void {
		const entry = this.entries.get(EditorDraftService.key(identity));
		if (!entry) return;
		entry.document = document;
		entry.selection = selection;
		if (history !== undefined) entry.history = history;
		const dirty = !document.eq(entry.savedDocument);
		if (entry.dirty !== dirty) {
			entry.dirty = dirty;
			this.notify(entry);
		}
	}

	markSaved(identity: EditorFileIdentity, content: string): void {
		const entry = this.entries.get(EditorDraftService.key(identity));
		if (!entry) return;
		entry.savedDocument = Text.of(content.split('\n'));
		const dirty = !entry.document.eq(entry.savedDocument);
		if (entry.dirty !== dirty) {
			entry.dirty = dirty;
			this.notify(entry);
		}
	}

	hasUnsavedChanges(): boolean {
		return [...this.entries.values()].some(entry => entry.dirty);
	}

	subscribe(listener: (change: EditorDraftChange) => void): () => void {
		this.listeners.add(listener);
		return () => { this.listeners.delete(listener); };
	}

	private notify(entry: DraftEntry): void {
		const dirty = this.hasUnsavedChanges();
		if (dirty !== this.unloadRegistered) {
			if (dirty) this.unloadTarget?.addEventListener('beforeunload', this.beforeUnload);
			else this.unloadTarget?.removeEventListener('beforeunload', this.beforeUnload);
			this.unloadRegistered = dirty;
		}
		for (const listener of this.listeners) listener({ projectId: entry.projectId, fileId: entry.fileId, dirty: entry.dirty });
	}
}

export const editorDraftService = new EditorDraftService();
