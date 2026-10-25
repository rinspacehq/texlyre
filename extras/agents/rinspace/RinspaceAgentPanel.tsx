// SPDX-License-Identifier: AGPL-3.0-or-later
import type React from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
	AgentApprovalCard,
	AgentDiffFile,
	AgentMessageList,
	AgentToolView,
	type AgentMessageView,
	type ToolActivityStatus,
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
	loadRinspaceAgentRun,
	type RinspaceAgentConfig,
	type RinspaceAgentViewState,
} from './RinspaceAgentRuntime';
import {
	clearAgentState,
	loadAgentState,
	saveAgentState,
	settledAgentMessages,
} from './RinspaceAgentPersistence';
import { rinspaceAgentTheme } from './RinspaceAgentTheme';
import type {
	RinspaceAgentDiagnosticSource,
	RinspaceAgentCompileResult,
	RinspaceAgentToolHost,
} from './RinspaceAgentTools';
import './styles.css';

type AgentMessage = RinspaceAgentViewState['snapshot']['messages'][number];
type AgentMessagePart = AgentMessage['content'][number];

const TOOL_LABELS: Readonly<Record<string, string>> = {
	list_project_files: '列出项目文件',
	read_project_files: '读取项目文件',
	search_project: '搜索项目',
	read_compile_diagnostics: '读取编译诊断',
	git_status: '检查 Git 状态',
	compile_project: '编译项目',
	apply_project_patch: '修改项目文件',
	create_project_file: '新建项目文件',
	rename_project_file: '重命名项目文件',
	delete_project_file: '删除项目文件',
	create_git_commit: '创建 Git 提交',
	push_git_commits: 'Push Git 提交',
};

const TOOL_DETAIL_LIMIT = 12_000;

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function boundedJson(value: unknown): string {
	let text: string;
	try {
		text = JSON.stringify(value, null, 2) ?? String(value);
	} catch {
		text = '[无法显示工具详情]';
	}
	return text.length > TOOL_DETAIL_LIMIT
		? `${text.slice(0, TOOL_DETAIL_LIMIT)}\n…（详情已截断）`
		: text;
}

function changedLineCounts(before: string, after: string): {
	additions: number;
	deletions: number;
} {
	const beforeLines = before ? before.split('\n') : [];
	const afterLines = after ? after.split('\n') : [];
	let prefix = 0;
	while (
		prefix < beforeLines.length &&
		prefix < afterLines.length &&
		beforeLines[prefix] === afterLines[prefix]
	) {
		prefix += 1;
	}
	let suffix = 0;
	while (
		suffix < beforeLines.length - prefix &&
		suffix < afterLines.length - prefix &&
		beforeLines[beforeLines.length - suffix - 1] ===
			afterLines[afterLines.length - suffix - 1]
	) {
		suffix += 1;
	}
	return {
		additions: afterLines.length - prefix - suffix,
		deletions: beforeLines.length - prefix - suffix,
	};
}

function ToolDiffs({ output }: { output: unknown }) {
	if (!isRecord(output) || !Array.isArray(output.comparisons)) return null;
	const comparisons = output.comparisons.filter(
		(comparison): comparison is Record<string, unknown> =>
			isRecord(comparison) &&
			typeof comparison.path === 'string' &&
			typeof comparison.before === 'string' &&
			typeof comparison.after === 'string',
	);
	if (comparisons.length === 0) return null;
	return (
		<div className='rinspace-agent-diffs' aria-label='项目文件差异'>
			{comparisons.map((comparison) => {
				const path = comparison.path as string;
				const before = comparison.before as string;
				const after = comparison.after as string;
				const counts = changedLineCounts(before, after);
				return (
					<AgentDiffFile
						key={path}
						path={path}
						additions={counts.additions}
						deletions={counts.deletions}
						onCopyPath={() => void navigator.clipboard?.writeText(path)}
					>
						<div className='rinspace-agent-diff-columns'>
							<div>
								<strong>修改前</strong>
								<pre>{before}</pre>
							</div>
							<div>
								<strong>修改后</strong>
								<pre>{after}</pre>
							</div>
						</div>
					</AgentDiffFile>
				);
			})}
		</div>
	);
}

function toolStatus(
	part: Extract<AgentMessagePart, { type: 'tool-call' }>,
	resultById: ReadonlyMap<string, Extract<AgentMessagePart, { type: 'tool-result' }>>,
	pendingToolCalls: ReadonlySet<string>,
): ToolActivityStatus {
	const result = resultById.get(part.toolCallId);
	if (result) return result.isError ? 'error' : 'success';
	return pendingToolCalls.has(part.toolCallId) ? 'pending' : 'running';
}

function MessageContent({
	message,
	pendingToolCalls,
	resultById,
}: {
	message: AgentMessage;
	pendingToolCalls: ReadonlySet<string>;
	resultById: ReadonlyMap<
		string,
		Extract<AgentMessagePart, { type: 'tool-result' }>
	>;
}) {
	return (
		<div className='rinspace-agent-message-parts'>
			{message.content.map((part, index) => {
				if (part.type === 'text' || part.type === 'reasoning') {
					return <p key={`${part.type}-${index}`}>{part.text}</p>;
				}
				if (part.type === 'tool-call') {
					return (
						<AgentToolView
							key={`call-${part.toolCallId}`}
							label={TOOL_LABELS[part.toolName] ?? part.toolName}
							status={toolStatus(part, resultById, pendingToolCalls)}
						>
							<pre>{boundedJson(part.input)}</pre>
						</AgentToolView>
					);
				}
				if (part.type === 'tool-result') {
					return (
						<AgentToolView
							key={`result-${part.toolCallId}`}
							label={`${TOOL_LABELS[part.toolName] ?? part.toolName}${part.isError ? '失败' : '完成'}`}
							status={part.isError ? 'error' : 'success'}
						>
							<ToolDiffs output={part.output} />
							<pre>{boundedJson(part.output)}</pre>
						</AgentToolView>
					);
				}
				if (part.type === 'file') {
					return <pre key={`file-${index}`}>{part.path}\n{part.content}</pre>;
				}
				return null;
			})}
		</div>
	);
}

const RinspaceAgentPanel: React.FC<AgentPanelProps> = ({ context, projectId }) => {
	const managed = context.mode === 'managed' ? context : null;
	const actorId = managed?.identity.actorId;
	const savedState = useMemo(
		() => (actorId ? loadAgentState(actorId, projectId) : null),
		[actorId, projectId],
	);
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
	const [restoring, setRestoring] = useState(savedState !== null);
	const [starting, setStarting] = useState(false);
	const [error, setError] = useState('');
	const [markdownDiagnostic, setMarkdownDiagnostic] =
		useState<RinspaceAgentDiagnosticSource>({
			id: 'markdown',
			status: 'idle',
			error: null,
			log: '',
		});
	const mounted = useRef(true);
	const lifecycleAbort = useRef<AbortController | null>(null);
	const pendingCreateAbort = useRef<AbortController | null>(null);
	const controllerRef = useRef<RinspaceAgentController | null>(null);
	const startPending = useRef(false);
	const taskGeneration = useRef(0);
	const composing = useRef(false);
	const restoreStarted = useRef(false);
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
			renameLinkedDocument: (documentId, expectedPath, path, origin) => {
				let renamed = false;
				changeProject((current) => {
					const document = current.documents?.find((item) => item.id === documentId);
					if (!document || document.name.replace(/^\/+/, '') !== expectedPath) return;
					document.name = `/${path}`;
					renamed = true;
				}, origin);
				return renamed;
			},
			deleteLinkedDocument: (documentId, expectedPath, origin) => {
				let deleted = false;
				changeProject((current) => {
					const index = current.documents?.findIndex((item) => item.id === documentId) ?? -1;
					if (index < 0) return;
					if (current.documents[index].name.replace(/^\/+/, '') !== expectedPath) return;
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
		const lifecycle = new AbortController();
		lifecycleAbort.current = lifecycle;
		mounted.current = true;
		return () => {
			mounted.current = false;
			lifecycle.abort();
			pendingCreateAbort.current?.abort();
			pendingCreateAbort.current = null;
			controllerRef.current?.abort();
			controllerRef.current = null;
			if (lifecycleAbort.current === lifecycle) lifecycleAbort.current = null;
		};
	}, []);
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

	useEffect(() => {
		if (
			!managed ||
			!actorId ||
			!config ||
			!savedState ||
			restoreStarted.current
		) {
			return;
		}
		restoreStarted.current = true;
		const abort = new AbortController();
		let completed = false;
		void loadRinspaceAgentRun(savedState.runId, projectId, abort.signal)
			.then((run) => {
				if (abort.signal.aborted || !mounted.current) return;
				const restored = RinspaceAgentController.restore(
					run.id,
					config,
					toolHost,
					savedState.messages,
					run.usage,
				);
				if (controllerRef.current) {
					restored.abort();
					return;
				}
				controllerRef.current = restored;
				setController(restored);
				completed = true;
				setRestoring(false);
			})
			.catch((reason: unknown) => {
				if (!abort.signal.aborted) {
					setError(
						reason instanceof Error ? reason.message : '琳任务恢复失败',
					);
				}
			})
			.finally(() => {
				if (!abort.signal.aborted) setRestoring(false);
			});
		return () => {
			abort.abort();
			if (!completed) restoreStarted.current = false;
		};
	}, [actorId, config, managed, projectId, savedState, toolHost]);

	useEffect(() => controller?.subscribe(setView), [controller]);

	useEffect(() => {
		if (!actorId || !controller || !view) return;
		saveAgentState(actorId, projectId, {
			version: 1,
			runId: controller.runId,
			messages: settledAgentMessages(
				view.snapshot.messages,
				view.snapshot.pendingToolCalls,
			),
			usage: view.snapshot.usage,
			savedAt: Date.now(),
		});
	}, [actorId, controller, projectId, view]);

	const messages = useMemo<AgentMessageView[]>(() => {
		const snapshot = view?.snapshot;
		const source = snapshot?.messages ?? [];
		const resultById = new Map<
			string,
			Extract<AgentMessagePart, { type: 'tool-result' }>
		>();
		for (const message of source) {
			for (const part of message.content) {
				if (part.type === 'tool-result') resultById.set(part.toolCallId, part);
			}
		}
		const pendingToolCalls = new Set(snapshot?.pendingToolCalls ?? []);
		return source.map((message) => ({
			id: message.id,
			role: message.role === 'tool' ? 'status' : message.role,
			content: (
				<MessageContent
					message={message}
					pendingToolCalls={pendingToolCalls}
					resultById={resultById}
				/>
			),
		}));
	}, [view?.snapshot]);

	const start = async () => {
		const lifecycle = lifecycleAbort.current;
		if (
			!managed ||
			!config ||
			restoring ||
			!prompt.trim() ||
			!lifecycle ||
			lifecycle.signal.aborted ||
			startPending.current
		) {
			return;
		}
		startPending.current = true;
		const generation = taskGeneration.current;
		setError('');
		setStarting(true);
		let createAbort: AbortController | null = null;
		try {
			let active = controllerRef.current;
			if (!active) {
				createAbort = new AbortController();
				pendingCreateAbort.current = createAbort;
				const created = await RinspaceAgentController.create(
					managed,
					projectId,
					config,
					toolHost,
					[],
					createAbort.signal,
				);
				if (
					createAbort.signal.aborted ||
					lifecycle.signal.aborted ||
					!mounted.current ||
					generation !== taskGeneration.current
				) {
					created.abort();
					return;
				}
				if (controllerRef.current) {
					created.abort();
					active = controllerRef.current;
				} else {
					controllerRef.current = created;
					active = created;
					setController(created);
				}
			}
			const input = prompt.trim();
			setPrompt('');
			await active.run(input);
		} catch (reason) {
			if (
				mounted.current &&
				!lifecycle.signal.aborted &&
				generation === taskGeneration.current
			) {
				setError(reason instanceof Error ? reason.message : '琳任务失败');
			}
		} finally {
			if (createAbort && pendingCreateAbort.current === createAbort) {
				pendingCreateAbort.current = null;
			}
			startPending.current = false;
			if (
				mounted.current &&
				!lifecycle.signal.aborted &&
				generation === taskGeneration.current
			) {
				setStarting(false);
			}
		}
	};

	const stop = () => {
		taskGeneration.current += 1;
		pendingCreateAbort.current?.abort();
		pendingCreateAbort.current = null;
		controllerRef.current?.abort();
		setStarting(false);
	};

	const reset = () => {
		stop();
		controllerRef.current = null;
		setController(null);
		setView(null);
		setError('');
		if (managed) clearAgentState(managed.identity.actorId, projectId);
	};

	const running = starting || view?.snapshot.status === 'running';
	const approval = view?.pendingApproval;
	return (
		<section
			className={`rinspace-agent rinspace-cline-embed ui-panel ${collapsed ? 'collapsed' : 'expanded'}`}
			data-role='agent'
			style={rinspaceAgentTheme as React.CSSProperties}
		>
			<div className='ui-panel-header' data-role='agent'>
				<div className='ui-panel-heading'>
					<span className='ui-panel-title'>琳</span>
					<span className='ui-badge' data-variant='label'>
						{running ? '运行中' : restoring ? '恢复中' : config ? '就绪' : '连接中'}
					</span>
				</div>
				<div className='ui-toolbar-actions' data-gap='xs'>
					<button type='button' className='button secondary' onClick={reset}>
						新任务
					</button>
					{running && (
						<button type='button' className='button secondary' onClick={stop}>
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
							onCompositionStart={() => {
								composing.current = true;
							}}
							onCompositionEnd={() => {
								composing.current = false;
							}}
							onKeyDown={(event) => {
								if (
									event.key === 'Enter' &&
									!event.shiftKey &&
									!composing.current &&
									!event.nativeEvent.isComposing &&
									event.nativeEvent.keyCode !== 229
								) {
									event.preventDefault();
									void start();
								}
							}}
							placeholder='让琳阅读、修改、编译或提交当前项目…'
							disabled={!config || restoring || running}
							rows={3}
						/>
						<button type='button' className='button primary' onClick={() => void start()} disabled={!config || restoring || running || !prompt.trim()}>
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
