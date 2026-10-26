// extras/viewers/milkdown/MilkdownViewer.tsx
import type React from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Editor } from '@milkdown/kit/core';
import '@milkdown/crepe/theme/common/style.css';
import 'katex/dist/katex.min.css';

import { t } from '@/i18n';
import {
	DownloadIcon,
	SaveIcon,
	CopyIcon,
	ToolbarShowIcon,
	EditingViewIcon,
} from '@/components/common/Icons';
import {
	PluginControlGroup,
	PluginHeader,
} from '@/components/common/PluginHeader';
import { usePluginFileInfo } from '@/hooks/usePluginFileInfo';
import { useSettings } from '@/hooks/useSettings';
import { useProperties } from '@/hooks/useProperties';
import type { ViewerProps } from '@/plugins/PluginInterface';
import { autoSaveKey, autoSaveService } from '@/services/AutoSaveService';
import { fileStoreService } from '@/services/FileStoreService';
import { hostFileEditorService } from '@/services/HostFileEditorService';
import { formatFileSize } from '@/utils/fileUtils';
import { copyCleanTextToClipboard } from '@/utils/clipboardUtils';
import type { HighlightTheme } from '@/types/editor';
import MilkdownEditor from './MilkdownEditor';
import MilkdownTextPane from './MilkdownTextPane';
import { createImageResolver } from './imageResolver';
import { createMilkdownPasteHandler } from './toolbar/pasteUpload';
import { getEnabledMilkdownPluginIds } from './settings';
import { PLUGIN_NAME, PLUGIN_VERSION } from './MilkdownViewerPlugin';
import { applyMarkdownHostEdits, readMarkdown } from './milkdownSetup';
import './styles.css';
import { createNamedLogger } from '@/logging';
const moduleLog = createNamedLogger('MilkdownViewer');

const MAX_SAFE_MARKDOWN_BYTES = 20 * 1024 * 1024;

const decodeContent = (content: string | ArrayBuffer): string =>
	content instanceof ArrayBuffer
		? new TextDecoder('utf-8', { fatal: false }).decode(content)
		: content;

const looksBinary = (content: ArrayBuffer): boolean => {
	const bytes = new Uint8Array(content, 0, Math.min(content.byteLength, 4096));
	if (!bytes.length) return false;

	let suspicious = 0;

	for (const byte of bytes) {
		const isText =
			byte === 9 ||
			byte === 10 ||
			byte === 13 ||
			(byte >= 32 && byte <= 126) ||
			byte >= 128;

		if (!isText || byte === 0) suspicious += 1;
	}

	return suspicious / bytes.length > 0.1;
};

const isProbablyStaleLargeContent = (content: string | ArrayBuffer): boolean =>
	content instanceof ArrayBuffer &&
	(content.byteLength > MAX_SAFE_MARKDOWN_BYTES || looksBinary(content));

const MilkdownViewer: React.FC<ViewerProps> = ({
	content,
	fileName,
	fileId,
}) => {
	const { getSetting } = useSettings();
	const { getProperty, setProperty, registerProperty } = useProperties();
	const fileInfo = usePluginFileInfo(fileId, fileName);

	const [markdown, setMarkdown] = useState('');
	const [viewMode, setViewMode] = useState<'visual' | 'text'>(() => {
		const saved = getProperty('milkdown-default-view', { scope: 'global' });
		return saved === 'text' ? 'text' : 'visual';
	});
	const [showToolbar, setShowToolbar] = useState(() => {
		const saved = getProperty('toolbar-visible', { scope: 'global' });
		return typeof saved === 'boolean' ? saved : true;
	});
	const [isSaving, setIsSaving] = useState(false);
	const [isLoadingContent, setIsLoadingContent] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const markdownRef = useRef('');
	const milkdownEditorRef = useRef<Editor | null>(null);
	const getTextContentRef = useRef<() => string>(() => '');
	const filePathRef = useRef(fileInfo.filePath || `/${fileName}`);
	const propertiesRegistered = useRef(false);
	const unregisterHostEditorRef = useRef<(() => void) | null>(null);

	const autoSaveEnabled =
		(getSetting('editor-auto-save-enable')?.value as boolean) ?? false;
	const autoSaveDelay =
		(getSetting('editor-auto-save-delay')?.value as number) ?? 2000;

	const autoSaveRef = useRef<(() => void) | null>(null);

	const enabledPluginIds = useMemo(
		() => getEnabledMilkdownPluginIds(getSetting),
		[getSetting],
	);

	const textDirection =
		(getSetting('milkdown-text-direction')?.value as 'auto' | 'ltr' | 'rtl') ??
		'auto';
	const highlightTheme =
		(getSetting('editor-theme-highlights')?.value as HighlightTheme) ?? 'auto';

	/* biome-ignore lint/correctness/useExhaustiveDependencies: One-time registration guarded by ref. */
	useEffect(() => {
		if (propertiesRegistered.current) return;
		propertiesRegistered.current = true;

		// const currentProjectId = sessionStorage.getItem('currentProjectId');

		registerProperty({
			id: 'milkdown-default-view',
			category: 'Viewers',
			subcategory: 'Markdown Editor',
			defaultValue: 'visual',
		});
		// registerProperty({
		// 	id: 'milkdown-toolbar-visible',
		// 	category: 'Viewers',
		// 	subcategory: 'Markdown Editor',
		// 	defaultValue: true,
		// });
	}, [registerProperty]);

	useEffect(() => {
		filePathRef.current = fileInfo.filePath || `/${fileName}`;
	}, [fileInfo.filePath, fileName]);

	const currentFilePath = fileInfo.filePath || `/${fileName}`;
	const imageResolver = useMemo(
		() => createImageResolver(() => currentFilePath),
		[currentFilePath],
	);

	const milkdownPlugins = useMemo(
		() =>
			enabledPluginIds.has('image-resolver') ? [imageResolver.plugin] : [],
		[imageResolver, enabledPluginIds],
	);

	const handlePaste = useMemo(
		() => createMilkdownPasteHandler(fileId),
		[fileId],
	);

	const handleMilkdownReady = useCallback(
		(editor: Editor) => {
			milkdownEditorRef.current = editor;
			unregisterHostEditorRef.current?.();
			unregisterHostEditorRef.current = null;
			const projectId = fileStoreService.getCurrentProjectId();
			if (!projectId || !fileId) return;

			unregisterHostEditorRef.current = hostFileEditorService.registerAdapter(
				projectId,
				fileId,
				{
					read: () => {
						let current = '';
						editor.action((ctx) => {
							current = readMarkdown(ctx);
						});
						return current;
					},
					apply: (edits, origin) => {
						let updated = '';
						editor.action((ctx) => {
							updated = applyMarkdownHostEdits(ctx, edits, origin);
						});
						return updated;
					},
				},
			);
		},
		[fileId],
	);

	useEffect(() => {
		if (viewMode === 'visual') return;
		milkdownEditorRef.current = null;
		unregisterHostEditorRef.current?.();
		unregisterHostEditorRef.current = null;
	}, [viewMode]);

	useEffect(
		() => () => {
			milkdownEditorRef.current = null;
			unregisterHostEditorRef.current?.();
			unregisterHostEditorRef.current = null;
		},
		[fileId],
	);

	useEffect(() => {
		return () => imageResolver.dispose();
	}, [imageResolver]);

	/* eslint-disable react-hooks/set-state-in-effect -- FileStore bytes are an external source; the mounted editor must synchronize replacements and loading state. */
	useEffect(() => {
		if (isProbablyStaleLargeContent(content)) {
			setIsLoadingContent(true);
			return;
		}

		const text = decodeContent(content);

		setMarkdown(text);
		markdownRef.current = text;
		setIsLoadingContent(false);
		setError(null);
	}, [content]);
	/* eslint-enable react-hooks/set-state-in-effect */

	const handleChange = useCallback((md: string) => {
		setMarkdown(md);
		markdownRef.current = md;
	}, []);

	const getCurrentContent = useCallback(() => {
		if (viewMode === 'text') {
			return getTextContentRef.current() || markdownRef.current;
		}
		const editor = milkdownEditorRef.current;
		if (!editor) return markdownRef.current;
		let current = markdownRef.current;
		editor.action((ctx) => {
			current = readMarkdown(ctx);
		});
		return current;
	}, [viewMode]);

	const switchView = (next: 'visual' | 'text') => {
		if (next === viewMode) return;

		if (viewMode === 'text') {
			const current = getTextContentRef.current();

			if (current) {
				setMarkdown(current);
				markdownRef.current = current;
			}
		}

		setViewMode(next);
		setProperty('milkdown-default-view', next, {
			scope: 'global',
		});
	};

	const toggleToolbar = () => {
		const next = !showToolbar;
		setShowToolbar(next);
		setProperty('toolbar-visible', next, {
			scope: 'global',
		});
	};

	const handleSave = useCallback(async () => {
		if (!fileId) return;

		setIsSaving(true);
		setError(null);

		try {
			const bytes = new TextEncoder().encode(getCurrentContent()).buffer;
			await fileStoreService.updateFileContent(fileId, bytes);
		} catch (err) {
			moduleLog.error('Error saving Markdown file:', err);

			setError(
				t('Failed to save file: {error}', {
					error: err instanceof Error ? err.message : t('Unknown error'),
				}),
			);
		} finally {
			setIsSaving(false);
		}
	}, [fileId, getCurrentContent]);

	const handleExport = () => {
		const url = URL.createObjectURL(
			new Blob([getCurrentContent()], {
				type: 'text/markdown;charset=utf-8',
			}),
		);

		const a = document.createElement('a');
		a.href = url;
		a.download = `${fileName.replace(/\.(md|markdown)$/i, '')}.md`;

		document.body.appendChild(a);
		a.click();
		document.body.removeChild(a);

		URL.revokeObjectURL(url);
	};

	useEffect(() => {
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.ctrlKey && event.key === 's' && viewMode === 'visual') {
				event.preventDefault();
				handleSave();
			}
		};

		document.addEventListener('keydown', handleKeyDown);

		return () => document.removeEventListener('keydown', handleKeyDown);
	}, [viewMode, handleSave]);

	useEffect(() => {
		if (!fileId) return;

		const saveFileId = fileId;
		const projectId = fileStoreService.getCurrentProjectId();
		if (!projectId) return;
		const saveKey = autoSaveKey(projectId, saveFileId);

		autoSaveRef.current = autoSaveService.createAutoSaver(
			saveKey,
			() => getCurrentContent(),
			{
				enabled: autoSaveEnabled,
				delay: autoSaveDelay,
				onSave: async (_saveKey, content) => {
					const bytes = new TextEncoder().encode(content).buffer;
					await fileStoreService.updateFileContent(saveFileId, bytes);
				},
				isCurrent: (content) => getCurrentContent() === content,
				onError: (error) => moduleLog.error('Auto-save failed:', error),
			},
		);

		return () => {
			autoSaveService.clearAutoSaver(saveKey);
			autoSaveRef.current = null;
		};
	}, [fileId, autoSaveEnabled, autoSaveDelay, getCurrentContent]);

	/* biome-ignore lint/correctness/useExhaustiveDependencies: markdown is the change trigger and not read in body. */
	useEffect(() => {
		autoSaveRef.current?.();
	}, [markdown]);

	const tooltipInfo = [
		t('MIME Type: {mimeType}', {
			mimeType: fileInfo.mimeType || 'text/markdown',
		}),
		t('Size: {size}', {
			size: formatFileSize(fileInfo.fileSize),
		}),
	];

	const headerControls = (
		<>
			<PluginControlGroup>
				<button
					type='button'
					className={showToolbar ? 'active' : ''}
					onClick={toggleToolbar}
					title={showToolbar ? t('Hide Toolbar') : t('Show Toolbar')}
				>
					<ToolbarShowIcon />
				</button>
				<button
					type='button'
					className={viewMode === 'text' ? 'active' : ''}
					onClick={() => switchView(viewMode === 'visual' ? 'text' : 'visual')}
					title={t('Switch to {viewMode}', {
						viewMode: viewMode === 'visual' ? t('Text View') : t('Visual View'),
					})}
				>
					<EditingViewIcon />
				</button>
			</PluginControlGroup>

			<PluginControlGroup>
				{fileId && (
					<button
						type='button'
						onClick={() => {
							if (viewMode === 'text') {
								document.dispatchEvent(
									new CustomEvent('trigger-save', {
										detail: { fileId, isFile: true },
									}),
								);
							} else {
								handleSave();
							}
						}}
						title={t('Save File (Ctrl+S)')}
						disabled={isSaving || isLoadingContent}
					>
						<SaveIcon />
					</button>
				)}
				<button
					type='button'
					onClick={() => copyCleanTextToClipboard(getCurrentContent())}
					title={t('Copy Text')}
					disabled={isLoadingContent}
				>
					<CopyIcon />
				</button>

				<button
					type='button'
					onClick={handleExport}
					title={t('Download Markdown')}
					disabled={isLoadingContent}
				>
					<DownloadIcon />
				</button>
			</PluginControlGroup>
		</>
	);

	return (
		<div className='ui-viewer' data-surface='secondary'>
			<PluginHeader
				fileName={fileInfo.fileName}
				filePath={fileInfo.filePath}
				pluginName={PLUGIN_NAME}
				pluginVersion={PLUGIN_VERSION}
				tooltipInfo={tooltipInfo}
				controls={headerControls}
			/>

			<div className='ui-viewer-content' data-layout='fill'>
				{error && (
					<div className='ui-message' data-tone='error' data-spacing='inset'>
						{error}
					</div>
				)}

				{isLoadingContent ? (
					<div className='ui-message' data-spacing='inset'>
						{t('Loading Markdown…')}
					</div>
				) : viewMode === 'visual' ? (
					<div className='milkdown-visual-pane'>
						<MilkdownEditor
							key={`visual-${fileId ?? fileName}-${highlightTheme}`}
							markdown={markdown}
							onReady={handleMilkdownReady}
							editable={true}
							onChange={handleChange}
							plugins={milkdownPlugins}
							syncExternalChanges={true}
							showToolbar={showToolbar}
							enabledPlugins={enabledPluginIds}
							onPaste={handlePaste}
							getCurrentFilePath={() => filePathRef.current}
							textDirection={textDirection}
							highlightTheme={highlightTheme}
						/>
					</div>
				) : (
					<MilkdownTextPane
						key={`text-${fileId ?? fileName}`}
						docUrl='milkdown-viewer'
						documentId={`${fileName}-markdown-editor`}
						isDocumentSelected={true}
						markdown={markdown}
						onChange={handleChange}
						fileName={fileName}
						fileId={fileId}
						isEditingFile={true}
						showToolbar={showToolbar}
						registerView={(getContent) => {
							getTextContentRef.current = getContent;
						}}
					/>
				)}
			</div>
		</div>
	);
};

export default MilkdownViewer;
