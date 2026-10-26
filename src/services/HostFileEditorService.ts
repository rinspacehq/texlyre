// SPDX-License-Identifier: AGPL-3.0-or-later
import { isolateHistory } from '@codemirror/commands';
import { Annotation, Transaction } from '@codemirror/state';
import type { EditorView } from 'codemirror';

import {
	applyDocumentTextEdits,
	type DocumentTextEdit,
	type HostDocumentEditOrigin,
} from './DocumentTextEdits';

export type HostFileEditResult =
	| { readonly status: 'not-open' }
	| { readonly status: 'conflict'; readonly actualContent: string }
	| { readonly status: 'updated'; readonly content: string };

export const hostFileEditOrigin = Annotation.define<HostDocumentEditOrigin>();

export interface HostFileEditorAdapter {
	read(): string;
	apply(
		edits: readonly DocumentTextEdit[],
		origin: HostDocumentEditOrigin,
	): string;
}

export class HostFileEditorService {
	private readonly editors = new Map<string, HostFileEditorAdapter>();

	private static key(projectId: string, fileId: string): string {
		return JSON.stringify([projectId, fileId]);
	}

	register(projectId: string, fileId: string, view: EditorView): () => void {
		return this.registerAdapter(projectId, fileId, {
			read: () => view.state.doc.toString(),
			apply: (edits, origin) => {
				view.dispatch({
					changes: edits.map((edit) => ({
						from: edit.from,
						to: edit.to,
						insert: edit.insert,
					})),
					annotations: [
						isolateHistory.of('full'),
						Transaction.userEvent.of('input.host'),
						hostFileEditOrigin.of(origin),
					],
				});
				return view.state.doc.toString();
			},
		});
	}

	registerAdapter(
		projectId: string,
		fileId: string,
		adapter: HostFileEditorAdapter,
	): () => void {
		const key = HostFileEditorService.key(projectId, fileId);
		this.editors.set(key, adapter);
		return () => {
			if (this.editors.get(key) === adapter) this.editors.delete(key);
		};
	}

	read(projectId: string, fileId: string): string | undefined {
		return this.editors
			.get(HostFileEditorService.key(projectId, fileId))
			?.read();
	}

	apply(
		projectId: string,
		fileId: string,
		expectedContent: string,
		edits: readonly DocumentTextEdit[],
		origin: HostDocumentEditOrigin,
	): HostFileEditResult {
		const editor = this.editors.get(
			HostFileEditorService.key(projectId, fileId),
		);
		if (!editor) return { status: 'not-open' };
		const currentContent = editor.read();
		if (currentContent !== expectedContent) {
			return { status: 'conflict', actualContent: currentContent };
		}
		const content = applyDocumentTextEdits(currentContent, edits);
		if (editor.apply(edits, origin) !== content) {
			throw new Error(
				'The open file editor did not apply the complete host edit',
			);
		}
		return { status: 'updated', content };
	}
}

export const hostFileEditorService = new HostFileEditorService();
