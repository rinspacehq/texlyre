// SPDX-License-Identifier: AGPL-3.0-or-later
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
	AgentApprovalCard,
	AgentMessageList,
	type AgentMessageView,
} from '@rinspacehq/cline-embed/ui';
import '@rinspacehq/cline-embed/styles.css';

import type { AgentPanelProps } from '@/plugins/PluginInterface';
import { ChevronDownIcon, ChevronUpIcon } from '@/components/common/Icons';
import { useCollab } from '@/hooks/useCollab';
import { useExternalTypesetter } from '@/hooks/useExternalTypesetter';
import { useLaTeX } from '@/hooks/useLaTeX';
import { useSecrets } from '@/hooks/useSecrets';
import { useSettings } from '@/hooks/useSettings';
import { useTypst } from '@/hooks/useTypst';
import { collabService } from '@/services/CollabService';
import { fileStoreService } from '@/services/FileStoreService';
import { gitService } from '@/services/GitService';
import { gitSyncService } from '@/services/GitSyncService';
import { typesetterRegistryService } from '@/services/TypesetterRegistryService';
import type { DocumentList } from '@/types/documents';
import {
	RinspaceAgentController,
	loadRinspaceAgentConfig,
	type RinspaceAgentConfig,
	type RinspaceAgentViewState,
} from './RinspaceAgentRuntime';
import { clearAgentState, saveAgentState } from './RinspaceAgentPersistence';
import { rinspaceAgentTheme } from './RinspaceAgentTheme';
import type {
	RinspaceAgentDiagnosticSource,
	RinspaceAgentCompileResult,
	RinspaceAgentToolHost,
} from './RinspaceAgentTools';
import './styles.css';

function messageText(message: RinspaceAgentViewState['snapshot']['messages'][number]): string {
	return message.content
		.map((part) => {
			if (part.type === 'text' || part.type === 'reasoning') return part.text;
			if (part.type === 'tool-call') return `调用工具：${part.toolName}`;
			if (part.type === 'tool-result') return `${part.toolName} 已完成`;
			return '';
		})
		.filter(Boolean)
		.join('\n');
}

const RinspaceAgentPanel: React.FC<AgentPanelProps> = ({ context, projectId }) => {
	const managed = context.mode === 'managed' ? context : null;
	const { data: project, changeData: changeProject } = useCollab<DocumentList>();
	const latex = useLaTeX();
	const typst = useTypst();
	const external = useExternalTypesetter();
	const secrets = useSecrets();
	const { getSetting } = useSettings();
	const [collapsed, setCollapsed] = useState(false);
	const [prompt, setPrompt] = useState('');
	const [config, setConfig] = useState<RinspaceAgentConfig | null>(null);
	const [controller, setController] = useState<RinspaceAgentController | null>(null);
	const [view, setView] = useState<RinspaceAgentViewState | null>(null);
	const [error, setError] = useState('');
	const [markdownDiagnostic, setMarkdownDiagnostic] =
		useState<RinspaceAgentDiagnosticSource>({
			id: 'markdown',
			status: 'idle',
			error: null,
			log: '',
		});
	const mounted = useRef(true);
	const toolState = useRef<{
		documents: DocumentList['documents'];
		diagnostics: RinspaceAgentDiagnosticSource[];
		metadata: DocumentList['projectMetadata'];
		revision: number;
		busy: boolean;
		compileLatex: (mainFile: string) => Promise<void>;
		compileTypst: (mainFile: string) => Promise<void>;
		compileExternal: (compilerId: string, mainFile: string) => Promise<void>;
		compileMarkdown: (mainFile: string) => Promise<RinspaceAgentCompileResult>;
		outputBytes: (source: 'latex' | 'typst' | 'external') => number | undefined;
	}>({
		documents: [],
		diagnostics: [],
		metadata: undefined,
		revision: 0,
		busy: false,
		compileLatex: async () => undefined,
		compileTypst: async () => undefined,
		compileExternal: async () => undefined,
		compileMarkdown: async () => {
			throw new Error('Markdown preview is not ready');
		},
		outputBytes: () => undefined,
	});
	const diagnostics = useMemo<RinspaceAgentDiagnosticSource[]>(
		() => [
			{
				id: 'latex',
				status: latex.isCompiling
					? 'running'
					: latex.compileError || latex.logIndicator === 'error'
						? 'error'
						: latex.logIndicator === 'success'
							? 'success'
							: 'idle',
				error: latex.compileError,
				log: latex.compileLog,
			},
			{
				id: 'typst',
				status: typst.isCompiling
					? 'running'
					: typst.compileError || typst.logIndicator === 'error'
						? 'error'
						: typst.logIndicator === 'success'
							? 'success'
							: 'idle',
				error: typst.compileError,
				log: typst.compileLog,
			},
			{
				id: 'external',
				status: external.isCompiling
					? 'running'
					: external.compileError || external.logIndicator === 'error'
						? 'error'
						: external.logIndicator === 'success'
							? 'success'
							: 'idle',
				error: external.compileError,
				log: external.compileLog,
			},
			markdownDiagnostic,
		],
		[
			external.compileError,
			external.compileLog,
			external.isCompiling,
			external.logIndicator,
			markdownDiagnostic,
			latex.compileError,
			latex.compileLog,
			latex.isCompiling,
			latex.logIndicator,
			typst.compileError,
			typst.compileLog,
			typst.isCompiling,
			typst.logIndicator,
		],
	);
	useEffect(() => {
		const compileMarkdown = async (
			mainFile: string,
		): Promise<RinspaceAgentCompileResult> => {
			setMarkdownDiagnostic({
				id: 'markdown',
				status: 'running',
				error: null,
				log: '',
			});
			try {
				const file = await fileStoreService.getFileByPath(mainFile, false);
				if (!file || file.type !== 'file' || file.content === undefined) {
					throw new Error(`Markdown main file is unavailable: ${mainFile}`);
				}
				const live = file.documentId
					? await collabService.readDocumentContent(projectId, file.documentId)
					: undefined;
				const markdown =
					live ??
					(typeof file.content === 'string'
						? file.content
						: new TextDecoder('utf-8', { fatal: true }).decode(file.content));
				const [{ compileMarkdownPreview }, { getEnabledMilkdownPluginIds }] =
					await Promise.all([
						import('../../viewers/milkdown/compileMarkdownPreview'),
						import('../../viewers/milkdown/settings'),
					]);
				const result = await compileMarkdownPreview(
					markdown,
					mainFile,
					getEnabledMilkdownPluginIds(getSetting),
				);
				const compiled: RinspaceAgentCompileResult = {
					compilerId: 'milkdown-preview',
					mainFile,
					status: 'success',
					error: null,
					log: result.log,
					outputBytes: result.outputBytes,
				};
				setMarkdownDiagnostic({
					id: 'markdown',
					status: 'success',
					error: null,
					log: result.log,
				});
				return compiled;
			} catch (reason) {
				const message = reason instanceof Error ? reason.message : String(reason);
				setMarkdownDiagnostic({
					id: 'markdown',
					status: 'error',
					error: message,
					log: message,
				});
				return {
					compilerId: 'milkdown-preview',
					mainFile,
					status: 'error',
					error: message,
					log: message,
				};
			}
		};
		toolState.current = {
			documents: project?.documents ?? [],
			diagnostics,
			metadata: project?.projectMetadata,
			revision: toolState.current.revision + 1,
			busy: latex.isCompiling || typst.isCompiling || external.isCompiling,
			compileLatex: (mainFile) =>
				latex.compileDocument(
					mainFile,
					project?.projectMetadata?.latexOutputFormat,
				),
			compileTypst: (mainFile) =>
				typst.compileDocument(
					mainFile,
					project?.projectMetadata?.typstOutputFormat,
					project?.projectMetadata?.typstPdfOptions,
				),
			compileExternal: async (compilerId, mainFile) => {
				const provider = typesetterRegistryService.get(compilerId);
				if (!provider) throw new Error(`Configured compiler is unavailable: ${compilerId}`);
				await external.compileDocument(
					compilerId,
					mainFile,
					provider.outputFormats[0]?.id,
				);
			},
			compileMarkdown,
			outputBytes: (source) => {
				if (source === 'latex') {
					return latex.compiledPdf?.byteLength ?? latex.compiledCanvas?.byteLength;
				}
				if (source === 'typst') {
					return typst.compiledPdf?.byteLength ?? typst.compiledCanvas?.byteLength;
				}
				return external.compiledOutput?.byteLength;
			},
		};
	}, [
		diagnostics,
		external,
		getSetting,
		latex,
		project?.documents,
		project?.projectMetadata,
		projectId,
		typst,
	]);
	const toolHost = useMemo<Omit<RinspaceAgentToolHost, 'runId'>>(
		() => ({
			projectId,
			isActive: () => mounted.current,
			getDocuments: () => toolState.current.documents,
			getDiagnostics: () => toolState.current.diagnostics,
			compileProject: async () => {
				const initial = toolState.current;
				if (initial.busy) throw new Error('A TeXlyre compilation is already running');
				const metadata = initial.metadata;
				const managedBuild = metadata?.managedBuild;
				if (managedBuild?.status === 'invalid') {
					throw new Error(managedBuild.message);
				}
				const format =
					managedBuild?.status === 'valid'
						? managedBuild.format
						: (metadata?.type ?? 'latex');
				const configuredMain =
					managedBuild?.status === 'valid'
						? managedBuild.entry
						: metadata?.mainFile;
				if (!configuredMain) throw new Error('The project has no configured main file');
				const mainFile = configuredMain.startsWith('/')
					? configuredMain
					: `/${configuredMain}`;
				if (format === 'markdown') return initial.compileMarkdown(mainFile);
				if (format === 'pdf') {
					throw new Error('A PDF source project has no text compilation step');
				}

				const provider = managedBuild
					? typesetterRegistryService.resolve(format)
					: typesetterRegistryService.resolve(format, metadata?.compilerId);
				if (!provider) {
					throw new Error(`Configured compiler is unavailable for ${format}`);
				}
				const source: 'latex' | 'typst' | 'external' =
					provider.id === 'internal:latex'
						? 'latex'
						: provider.id === 'internal:typst'
							? 'typst'
							: 'external';
				const startRevision = initial.revision;
				if (source === 'latex') await initial.compileLatex(mainFile);
				else if (source === 'typst') await initial.compileTypst(mainFile);
				else await initial.compileExternal(provider.id, mainFile);

				let diagnostic = toolState.current.diagnostics.find(
					(item) => item.id === source,
				);
				for (let attempt = 0; attempt < 40; attempt += 1) {
					const current = toolState.current;
					diagnostic = current.diagnostics.find((item) => item.id === source);
					if (
						current.revision > startRevision &&
						diagnostic &&
						diagnostic.status !== 'running'
					) {
						break;
					}
					await new Promise((resolve) => window.setTimeout(resolve, 25));
				}
				if (!diagnostic || diagnostic.status === 'idle' || diagnostic.status === 'running') {
					throw new Error('The configured compiler did not publish a final result');
				}
				return {
					compilerId: provider.id,
					mainFile,
					status: diagnostic.status,
					error: diagnostic.error,
					log: diagnostic.log,
					outputBytes: toolState.current.outputBytes(source),
				};
			},
			renameLinkedDocument: (documentId, path, origin) => {
				let renamed = false;
				changeProject((current) => {
					const document = current.documents?.find((item) => item.id === documentId);
					if (!document) return;
					document.name = `/${path}`;
					renamed = true;
				}, origin);
				return renamed;
			},
			deleteLinkedDocument: (documentId, origin) => {
				let deleted = false;
				changeProject((current) => {
					const index = current.documents?.findIndex((item) => item.id === documentId) ?? -1;
					if (index < 0) return;
					current.documents.splice(index, 1);
					if (current.currentDocId === documentId) {
						current.currentDocId = current.documents[0]?.id ?? '';
					}
					deleted = true;
				}, origin);
				return deleted;
			},
			createGitCommit: (message) => gitService.commit(projectId, message, null),
			prepareGitPush: () => gitSyncService.preparePush(projectId, secrets),
			pushGitCommits: (preview) =>
				gitSyncService.push(projectId, secrets, preview),
		}),
		[changeProject, projectId, secrets],
	);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, [projectId]);
	useEffect(() => {
		if (!managed) return;
		const abort = new AbortController();
		void loadRinspaceAgentConfig(abort.signal)
			.then((next) => {
				if (!next.enabled) throw new Error('琳当前已停用');
				setConfig(next);
			})
			.catch((reason: unknown) => {
				if (!abort.signal.aborted) {
					setError(reason instanceof Error ? reason.message : '琳配置加载失败');
				}
			});
		return () => {
			abort.abort();
		};
	}, [managed, projectId]);

	useEffect(() => controller?.subscribe(setView), [controller]);
	useEffect(() => () => controller?.abort(), [controller]);

	useEffect(() => {
		if (!managed || !controller || !view) return;
		saveAgentState(managed.identity.actorId, projectId, {
			runId: controller.runId,
			messages: view.snapshot.messages,
			savedAt: Date.now(),
		});
	}, [controller, managed, projectId, view]);

	const messages = useMemo<AgentMessageView[]>(
		() =>
			(view?.snapshot.messages ?? []).map((message) => ({
				id: message.id,
				role: message.role === 'tool' ? 'status' : message.role,
				content: messageText(message),
			})),
		[view?.snapshot.messages],
	);

	const start = async () => {
		if (!managed || !config || !prompt.trim()) return;
		setError('');
		try {
			const active =
				controller ??
				(await RinspaceAgentController.create(
					managed,
					projectId,
					config,
					toolHost,
				));
			if (!controller) setController(active);
			const input = prompt.trim();
			setPrompt('');
			await active.run(input);
		} catch (reason) {
			setError(reason instanceof Error ? reason.message : '琳任务失败');
		}
	};

	const reset = () => {
		controller?.abort();
		setController(null);
		setView(null);
		setError('');
		if (managed) clearAgentState(managed.identity.actorId, projectId);
	};

	const running = view?.snapshot.status === 'running';
	const approval = view?.pendingApproval;
	return (
		<section
			className={`rinspace-agent ui-panel ${collapsed ? 'collapsed' : 'expanded'}`}
			data-role='agent'
			style={rinspaceAgentTheme as React.CSSProperties}
		>
			<div className='ui-panel-header' data-role='agent'>
				<div className='ui-panel-heading'>
					<span className='ui-panel-title'>琳</span>
					<span className='ui-badge' data-variant='label'>
						{running ? '运行中' : config ? '就绪' : '连接中'}
					</span>
				</div>
				<div className='ui-toolbar-actions' data-gap='xs'>
					<button type='button' className='button secondary' onClick={reset}>
						新任务
					</button>
					{running && (
						<button type='button' className='button secondary' onClick={() => controller?.abort()}>
							停止
						</button>
					)}
					<button
						type='button'
						className='ui-icon-button'
						aria-label={collapsed ? '展开琳' : '折叠琳'}
						onClick={() => setCollapsed((value) => !value)}
					>
						{collapsed ? <ChevronUpIcon /> : <ChevronDownIcon />}
					</button>
				</div>
			</div>
			{!collapsed && (
				<div className='ui-panel-content' data-role='agent'>
					<AgentMessageList empty={<p>描述你希望琳完成的写作任务。</p>} messages={messages} />
					{approval && (
						<AgentApprovalCard
							title='确认 Push'
							description='请核对仓库、分支、远端 HEAD 与待推提交。此确认仅本次有效。'
							detail={<pre>{JSON.stringify(approval.input, null, 2)}</pre>}
							onApprove={() => controller?.respondToApproval(true)}
							onReject={() => controller?.respondToApproval(false)}
						/>
					)}
					{error && <div className='ui-message' data-tone='error'>{error}</div>}
					<div className='rinspace-agent-composer ui-toolbar'>
						<textarea
							className='ui-field-control'
							value={prompt}
							onChange={(event) => setPrompt(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === 'Enter' && !event.shiftKey) {
									event.preventDefault();
									void start();
								}
							}}
							placeholder='让琳阅读、修改、编译或提交当前项目…'
							disabled={!config || running}
							rows={3}
						/>
						<button type='button' className='button primary' onClick={() => void start()} disabled={!config || running || !prompt.trim()}>
							发送
						</button>
					</div>
					<div className='rinspace-agent-usage'>
						<span>{view?.snapshot.usage.inputTokens ?? 0} 输入 token</span>
						<span>{view?.snapshot.usage.outputTokens ?? 0} 输出 token</span>
						<span>善功上限 {config?.maxGoodness ?? '—'}</span>
					</div>
				</div>
			)}
		</section>
	);
};

export default RinspaceAgentPanel;
