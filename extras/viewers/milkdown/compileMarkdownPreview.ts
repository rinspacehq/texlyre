// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Editor } from '@milkdown/kit/core';

import {
	configureMilkdownEditor,
	readMarkdown,
} from './milkdownSetup';

export interface MarkdownPreviewCompileResult {
	log: string;
	outputBytes: number;
}

/**
 * Parse and render one Markdown source with the same Milkdown configuration as
 * the interactive preview. The temporary root is never exposed as project UI.
 */
export async function compileMarkdownPreview(
	markdown: string,
	filePath: string,
	enabledPlugins: Set<string>,
): Promise<MarkdownPreviewCompileResult> {
	const root = document.createElement('div');
	root.setAttribute('aria-hidden', 'true');
	root.style.cssText =
		'position:fixed;inset:auto auto 100% 100%;width:1px;height:1px;overflow:hidden;pointer-events:none;';
	document.body.append(root);

	let editor: Editor | null = null;
	try {
		editor = configureMilkdownEditor({
			root,
			defaultValue: markdown,
			editable: () => false,
			onMarkdownUpdated: () => undefined,
			getCurrentFilePath: () => filePath,
			enabledPlugins,
		});
		await editor.create();

		let normalized = markdown;
		editor.action((ctx) => {
			normalized = readMarkdown(ctx);
		});
		const outputBytes = new TextEncoder().encode(normalized).byteLength;
		return {
			log: `Milkdown preview parsed ${outputBytes} UTF-8 bytes successfully.`,
			outputBytes,
		};
	} finally {
		if (editor) {
			try {
				await editor.destroy();
			} catch {
				// Preserve the parse result or original failure; this root is disposable.
			}
		}
		root.remove();
	}
}
