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
import { useTypst } from '@/hooks/useTypst';
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
	const { data: project } = useCollab<DocumentList>();
	const latex = useLaTeX();
	const typst = useTypst();
	const external = useExternalTypesetter();
	const [collapsed, setCollapsed] = useState(false);
	const [prompt, setPrompt] = useState('');
	const [config, setConfig] = useState<RinspaceAgentConfig | null>(null);
	const [controller, setController] = useState<RinspaceAgentController | null>(null);
	const [view, setView] = useState<RinspaceAgentViewState | null>(null);
	const [error, setError] = useState('');
	const mounted = useRef(true);
	const toolState = useRef<{
		documents: DocumentList['documents'];
		diagnostics: RinspaceAgentDiagnosticSource[];
	}>({ documents: [], diagnostics: [] });
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
		],
		[
			external.compileError,
			external.compileLog,
			external.isCompiling,
			external.logIndicator,
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
		toolState.current = {
			documents: project?.documents ?? [],
			diagnostics,
		};
	}, [diagnostics, project?.documents]);
	const toolHost = useMemo<Omit<RinspaceAgentToolHost, 'runId'>>(
		() => ({
			projectId,
			isActive: () => mounted.current,
			getDocuments: () => toolState.current.documents,
			getDiagnostics: () => toolState.current.diagnostics,
		}),
		[projectId],
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
