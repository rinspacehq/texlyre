// src/extensions/codemirror/BurstDeferLanguage.ts
import type { StateEffect } from '@codemirror/state';
import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';

export function createBurstDeferredLanguage(
	detach: () => StateEffect<unknown>[],
	reattach: () => StateEffect<unknown>[],
): Extension {
	const plugin = ViewPlugin.fromClass(class {
		private deferred = false;
		private detachQueued = false;
		private destroyed = false;
		private lastChangeAt = 0;
		private reattachTimer: ReturnType<typeof setTimeout> | null = null;

		constructor(private readonly view: EditorView) {}

		private composing(): boolean {
			// compositionStarted covers the interval before the first preedit
			// update, when CodeMirror's narrower `composing` flag is still false.
			return this.view.compositionStarted || this.view.composing;
		}

		compositionStarted(): void {
			if (this.reattachTimer) clearTimeout(this.reattachTimer);
			this.reattachTimer = null;
		}

		compositionEnded(): void {
			if (this.deferred) this.scheduleReattach();
		}

		private scheduleReattach(): void {
			if (this.reattachTimer) clearTimeout(this.reattachTimer);
			this.reattachTimer = setTimeout(() => {
				this.reattachTimer = null;
				if (this.destroyed || !this.view.dom.isConnected || this.composing()) return;
				this.deferred = false;
				this.view.dispatch({ effects: reattach() });
			}, 150);
		}

		update(update: ViewUpdate): void {
			if (!update.docChanged) return;
			const now = Date.now();
			const isBurst = now - this.lastChangeAt < 100;
			this.lastChangeAt = now;
			if (this.composing()) return;

			if (isBurst && !this.deferred && !this.detachQueued) {
				this.detachQueued = true;
				queueMicrotask(() => {
					this.detachQueued = false;
					if (this.destroyed || !this.view.dom.isConnected || this.composing()) return;
					this.deferred = true;
					this.view.dispatch({ effects: detach() });
					this.scheduleReattach();
				});
			}
			if (this.deferred) this.scheduleReattach();
		}

		destroy(): void {
			this.destroyed = true;
			if (this.reattachTimer) clearTimeout(this.reattachTimer);
			this.reattachTimer = null;
		}
	});

	return [plugin, EditorView.domEventHandlers({
		compositionstart(_event, view) { view.plugin(plugin)?.compositionStarted(); },
		compositionend(_event, view) { view.plugin(plugin)?.compositionEnded(); },
	})];
}
