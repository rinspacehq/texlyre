// SPDX-License-Identifier: AGPL-3.0-or-later
import {
	AgentRuntime,
	type AgentMessage,
	type AgentRuntimeStateSnapshot,
	type AgentUsage,
	type ToolApprovalRequest,
	type ToolApprovalResult,
} from '@rinspacehq/cline-embed';

import type { HostContext } from '@/workspace/contracts';
import { loadRinspaceSession } from '../../workspace/rinspace/RinspaceSession';
import { RinspaceAgentModel } from './RinspaceAgentModel';
import {
	createRinspaceAgentTools,
	type RinspaceAgentToolHost,
} from './RinspaceAgentTools';

export interface RinspaceAgentConfig {
	enabled: boolean;
	model: string;
	maxIterations: number;
	maxOutputTokens: number;
	maxGoodness: number;
}

export interface RinspaceAgentViewState {
	snapshot: AgentRuntimeStateSnapshot;
	pendingApproval: ToolApprovalRequest | null;
}

export interface RinspaceAgentRunProjection {
	id: string;
	projectId: string;
	status: string;
	usage: AgentUsage;
}

type Listener = (state: RinspaceAgentViewState) => void;

export const RINSPACE_AGENT_SYSTEM_PROMPT = `你是 Rinspace 写作工作台中的工程助手「琳」。只处理当前 TeXlyre 项目，并且只使用宿主提供的工具。
先读取当前项目事实再修改；写入遇到基线冲突时必须重新读取，不得覆盖用户或协作者的新内容。不得请求或推断 Shell、任意网络、凭据、其他项目存储或未声明能力。
编译、Git 提交和文件操作必须通过对应工具完成。Push 必须使用 push_git_commits，由宿主逐次取得用户确认；不得建议强推、删除远端分支或改写已推历史。
不要声称执行了尚未由工具结果确认的操作。任务完成时用简洁文字说明结果、未完成项和需要用户决定的事项。`;

function validateConfig(value: unknown): RinspaceAgentConfig {
	if (!value || typeof value !== 'object')
		throw new Error('Agent config is invalid');
	const config = value as RinspaceAgentConfig;
	if (
		typeof config.enabled !== 'boolean' ||
		!config.model?.trim() ||
		!Number.isSafeInteger(config.maxIterations) ||
		config.maxIterations < 0 ||
		config.maxIterations > 128 ||
		!Number.isSafeInteger(config.maxOutputTokens) ||
		config.maxOutputTokens < 0 ||
		config.maxOutputTokens > 4096 ||
		!Number.isSafeInteger(config.maxGoodness) ||
		config.maxGoodness < 0 ||
		config.maxGoodness > 1_000_000_000_000 ||
		(config.enabled &&
			(config.maxIterations === 0 ||
				config.maxOutputTokens === 0 ||
				config.maxGoodness === 0))
	) {
		throw new Error('Agent config is invalid');
	}
	return config;
}

function validateUsage(value: unknown): AgentUsage {
	if (!value || typeof value !== 'object' || Array.isArray(value)) {
		throw new Error('Agent run usage is invalid');
	}
	const usage = value as Record<string, unknown>;
	for (const field of [
		'inputTokens',
		'outputTokens',
		'cacheReadTokens',
		'cacheWriteTokens',
	]) {
		if (!Number.isSafeInteger(usage[field]) || Number(usage[field]) < 0) {
			throw new Error('Agent run usage is invalid');
		}
	}
	if (
		usage.reasoningTokenCount !== undefined &&
		(!Number.isSafeInteger(usage.reasoningTokenCount) ||
			Number(usage.reasoningTokenCount) < 0)
	) {
		throw new Error('Agent run usage is invalid');
	}
	if (
		usage.totalCost !== undefined &&
		(typeof usage.totalCost !== 'number' ||
			!Number.isFinite(usage.totalCost) ||
			usage.totalCost < 0)
	) {
		throw new Error('Agent run usage is invalid');
	}
	return usage as unknown as AgentUsage;
}

function addUsage(base: AgentUsage, current: AgentUsage): AgentUsage {
	return {
		inputTokens: base.inputTokens + current.inputTokens,
		outputTokens: base.outputTokens + current.outputTokens,
		cacheReadTokens: base.cacheReadTokens + current.cacheReadTokens,
		cacheWriteTokens: base.cacheWriteTokens + current.cacheWriteTokens,
		...(base.reasoningTokenCount !== undefined ||
		current.reasoningTokenCount !== undefined
			? {
					reasoningTokenCount:
						(base.reasoningTokenCount ?? 0) +
						(current.reasoningTokenCount ?? 0),
				}
			: {}),
		...(base.totalCost !== undefined || current.totalCost !== undefined
			? { totalCost: (base.totalCost ?? 0) + (current.totalCost ?? 0) }
			: {}),
	};
}

export async function loadRinspaceAgentConfig(
	signal?: AbortSignal,
): Promise<RinspaceAgentConfig> {
	const response = await fetch('/rinspace/api/editor/v1/agent/config', {
		credentials: 'include',
		cache: 'no-store',
		headers: { Accept: 'application/json' },
		signal,
	});
	if (!response.ok) throw new Error(`Agent config failed (${response.status})`);
	return validateConfig(await response.json());
}

export async function loadRinspaceAgentRun(
	runId: string,
	projectId: string,
	signal?: AbortSignal,
): Promise<RinspaceAgentRunProjection> {
	const response = await fetch(
		`/rinspace/api/editor/v1/agent/runs/${encodeURIComponent(runId)}`,
		{
			credentials: 'include',
			cache: 'no-store',
			headers: { Accept: 'application/json' },
			signal,
		},
	);
	if (!response.ok)
		throw new Error(`Agent run recovery failed (${response.status})`);
	const value = (await response.json()) as Record<string, unknown>;
	if (
		value.id !== runId ||
		value.projectId !== projectId ||
		typeof value.status !== 'string'
	) {
		throw new Error('Agent run recovery response is invalid');
	}
	return {
		id: runId,
		projectId,
		status: value.status,
		usage: validateUsage(value.usage),
	};
}

async function createRun(
	context: Extract<HostContext, { mode: 'managed' }>,
	projectId: string,
	config: RinspaceAgentConfig,
	signal?: AbortSignal,
): Promise<string> {
	const session = await loadRinspaceSession(fetch, signal);
	const response = await fetch('/rinspace/api/editor/v1/agent/runs', {
		method: 'POST',
		credentials: 'include',
		cache: 'no-store',
		signal,
		headers: {
			Accept: 'application/json',
			'Content-Type': 'application/json',
			'X-Rinspace-CSRF': session.csrfToken,
		},
		body: JSON.stringify({
			requestId: crypto.randomUUID(),
			projectId,
			binding: context.binding,
			model: config.model,
			maxGoodness: config.maxGoodness,
		}),
	});
	if (!response.ok)
		throw new Error(`Agent run creation failed (${response.status})`);
	const value = (await response.json()) as { id?: unknown };
	if (typeof value.id !== 'string' || !value.id.trim()) {
		throw new Error('Agent run response is invalid');
	}
	return value.id;
}

async function abortRun(runId: string): Promise<void> {
	const session = await loadRinspaceSession(fetch);
	const response = await fetch(
		`/rinspace/api/editor/v1/agent/runs/${encodeURIComponent(runId)}/abort`,
		{
			method: 'POST',
			credentials: 'include',
			cache: 'no-store',
			headers: {
				Accept: 'application/json',
				'X-Rinspace-CSRF': session.csrfToken,
			},
		},
	);
	if (!response.ok) throw new Error(`Agent abort failed (${response.status})`);
}

export class RinspaceAgentController {
	private readonly listeners = new Set<Listener>();
	private pendingApproval: ToolApprovalRequest | null = null;
	private resolveApproval: ((result: ToolApprovalResult) => void) | null = null;

	private constructor(
		readonly runId: string,
		readonly config: RinspaceAgentConfig,
		private readonly runtime: AgentRuntime,
		private readonly restoredUsage: AgentUsage,
	) {
		this.runtime.subscribe(() => this.emit());
	}

	static async create(
		context: Extract<HostContext, { mode: 'managed' }>,
		projectId: string,
		config: RinspaceAgentConfig,
		toolHost: Omit<RinspaceAgentToolHost, 'runId'>,
		initialMessages: readonly AgentMessage[] = [],
		signal?: AbortSignal,
	): Promise<RinspaceAgentController> {
		const runId = await createRun(context, projectId, config, signal);
		return this.fromRun(runId, config, toolHost, initialMessages, {
			inputTokens: 0,
			outputTokens: 0,
			cacheReadTokens: 0,
			cacheWriteTokens: 0,
		});
	}

	static restore(
		runId: string,
		config: RinspaceAgentConfig,
		toolHost: Omit<RinspaceAgentToolHost, 'runId'>,
		initialMessages: readonly AgentMessage[],
		restoredUsage: AgentUsage,
	): RinspaceAgentController {
		return this.fromRun(
			runId,
			config,
			toolHost,
			initialMessages,
			restoredUsage,
		);
	}

	private static fromRun(
		runId: string,
		config: RinspaceAgentConfig,
		toolHost: Omit<RinspaceAgentToolHost, 'runId'>,
		initialMessages: readonly AgentMessage[],
		restoredUsage: AgentUsage,
	): RinspaceAgentController {
		const toolSet = createRinspaceAgentTools({ ...toolHost, runId });
		const controllerRef: { current?: RinspaceAgentController } = {};
		const runtime = new AgentRuntime({
			model: new RinspaceAgentModel(runId),
			systemPrompt: RINSPACE_AGENT_SYSTEM_PROMPT,
			initialMessages,
			sessionId: runId,
			conversationId: runId,
			maxIterations: config.maxIterations,
			tools: toolSet.tools,
			toolPolicies: toolSet.policies,
			hooks: { beforeTool: toolSet.beforeTool },
			messageModelInfo: { id: config.model, provider: 'rinspace' },
			requestToolApproval: (request) =>
				controllerRef.current?.requestApproval(request) ?? {
					approved: false,
					reason: 'Agent approval host is not ready',
				},
		});
		controllerRef.current = new RinspaceAgentController(
			runId,
			config,
			runtime,
			restoredUsage,
		);
		return controllerRef.current;
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		listener(this.viewState());
		return () => this.listeners.delete(listener);
	}

	async run(prompt: string): Promise<void> {
		await this.runtime.run(prompt);
	}

	abort(): void {
		this.resolveApproval?.({ approved: false, reason: 'Agent task stopped' });
		this.clearApproval();
		this.runtime.abort('Agent task stopped');
		void abortRun(this.runId).catch(() => {
			// The durable run is recovered on the next read when abort delivery is unknown.
		});
	}

	respondToApproval(approved: boolean): void {
		this.resolveApproval?.({
			approved,
			reason: approved ? undefined : 'Push rejected by the user',
		});
		this.clearApproval();
	}

	private requestApproval(
		request: ToolApprovalRequest,
	): Promise<ToolApprovalResult> {
		if (request.toolName !== 'push_git_commits') {
			return Promise.resolve({
				approved: false,
				reason: 'Only Push can request approval',
			});
		}
		this.resolveApproval?.({
			approved: false,
			reason: 'Approval request replaced',
		});
		this.pendingApproval = request;
		this.emit();
		return new Promise((resolve) => {
			this.resolveApproval = resolve;
		});
	}

	private clearApproval(): void {
		this.pendingApproval = null;
		this.resolveApproval = null;
		this.emit();
	}

	private viewState(): RinspaceAgentViewState {
		const snapshot = this.runtime.snapshot();
		return {
			snapshot: {
				...snapshot,
				usage: addUsage(this.restoredUsage, snapshot.usage),
			},
			pendingApproval: this.pendingApproval,
		};
	}

	private emit(): void {
		const state = this.viewState();
		for (const listener of this.listeners) listener(state);
	}
}
