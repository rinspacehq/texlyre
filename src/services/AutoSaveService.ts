// src/services/AutoSaveService.ts
import debounce from 'lodash/debounce';

import { createNamedLogger } from '@/logging';

const moduleLog = createNamedLogger('AutoSaveService');

interface AutoSaveOptions {
	enabled: boolean;
	delay: number;
	onSave: (fileId: string, content: string) => void | Promise<void>;
	onError?: (error: Error) => void;
}

interface SaveSnapshot {
	content: string;
	options: AutoSaveOptions;
}

interface AutoSaver {
	flush: () => void;
	dispose: () => void;
	cancelPending: () => void;
}

class AutoSaveService {
	private saveCallbacks = new Map<string, AutoSaver>();
	private writes = new Map<string, Promise<void>>();
	private failed = new Map<string, SaveSnapshot & { error: Error }>();

	private enqueue(fileId: string, snapshot: SaveSnapshot): void {
		const previous = this.writes.get(fileId) ?? Promise.resolve();
		const write = previous.then(async () => {
			try {
				await snapshot.options.onSave(fileId, snapshot.content);
				this.failed.delete(fileId);
			} catch (cause) {
				const error = cause instanceof Error ? cause : new Error('Auto-save failed', { cause });
				// Retain the exact failed draft even after its editor has unmounted.
				this.failed.set(fileId, { ...snapshot, error });
				if (snapshot.options.onError) {
					try {
						snapshot.options.onError(error);
					} catch (reportingError) {
						moduleLog.error('Auto-save error reporting failed:', reportingError);
					}
				} else {
					moduleLog.error('Auto-save failed:', error);
				}
			}
		});
		this.writes.set(fileId, write);
		void write.then(() => {
			if (this.writes.get(fileId) === write) this.writes.delete(fileId);
		});
	}

	createAutoSaver(
		fileId: string,
		getContent: () => string,
		options: AutoSaveOptions,
	): () => void {
		this.clearAutoSaver(fileId);
		if (!options.enabled) {
			return () => {};
		}

		let pending: string | undefined;
		let active = true;
		const persist = () => {
			if (pending === undefined) return;
			const content = pending;
			pending = undefined;
			this.enqueue(fileId, { content, options });
		};
		const debouncedSave = debounce(persist, options.delay, {
			maxWait: Math.max(options.delay, 5000),
		});
		this.saveCallbacks.set(fileId, {
			flush: () => {
				debouncedSave.cancel();
				persist();
			},
			dispose: () => {
				active = false;
				debouncedSave.cancel();
				persist();
			},
			cancelPending: () => {
				debouncedSave.cancel();
				pending = undefined;
			},
		});
		return () => {
			if (!active) return;
			// Capture while this view is alive. Never read a shared viewRef later:
			// it may then refer to a different file, or already be destroyed.
			pending = getContent();
			debouncedSave();
		};
	}

	clearAutoSaver(fileId: string): void {
		const callback = this.saveCallbacks.get(fileId);
		if (callback) {
			callback.dispose();
			this.saveCallbacks.delete(fileId);
		}
	}

	async saveNow(
		fileId: string,
		content: string,
		onSave: AutoSaveOptions['onSave'],
	): Promise<void> {
		// Manual saves share the auto-save queue. Otherwise a slow older auto-save
		// can complete after Ctrl+S and restore the older version over it.
		this.saveCallbacks.get(fileId)?.cancelPending();
		this.enqueue(fileId, { content, options: { enabled: true, delay: 0, onSave } });
		await this.writes.get(fileId);
		const failure = this.failed.get(fileId);
		if (failure) throw failure.error;
	}

	async flushPendingSaves(): Promise<void[]> {
		const retry = new Map(this.failed);
		for (const callback of this.saveCallbacks.values()) callback.flush();
		for (const [fileId, snapshot] of retry) {
			if (!this.writes.has(fileId)) this.enqueue(fileId, snapshot);
		}
		let count = 0;
		while (this.writes.size > 0) {
			const writes = [...this.writes.values()];
			count += writes.length;
			await Promise.all(writes);
			for (const callback of this.saveCallbacks.values()) callback.flush();
		}
		const failure = this.failed.values().next().value;
		if (failure) throw failure.error;
		return Array.from({ length: count }, () => undefined);
	}
}

export const autoSaveService = new AutoSaveService();
