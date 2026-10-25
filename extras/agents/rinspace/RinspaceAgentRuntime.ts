// SPDX-License-Identifier: AGPL-3.0-or-later
import {
	AgentRuntime,
	type AgentMessage,
	type AgentRuntimeStateSnapshot,
	type ToolApprovalRequest,
	type ToolApprovalResult,
} from '@rinspacehq/cline-embed';

import type { HostContext } from '@/workspace/contracts';
import { loadRinspaceSession } from '../../workspace/rinspace/RinspaceSession';
import { RinspaceAgentModel } from './RinspaceAgentModel';
import { createRinspaceAgentTools } from './RinspaceAgentTools';

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

type Listener = (state: RinspaceAgentViewState) => void;

function validateConfig(value: unknown): RinspaceAgentConfig {
	if (!value || typeof value !== 'object') throw new Error('Agent config is invalid');
	const config = value as RinspaceAgentConfig;
	if (
		typeof config.enabled !== 'boolean' ||
		!config.model?.trim() ||
		!Number.isSafeInteger(config.maxIterations) ||
		!Number.isSafeInteger(config.maxOutputTokens) ||
		!Number.isFinite(config.maxGoodness)
	) {
		throw new Error('Agent config is invalid');
	}
	return config;
}

export async function loadRinspaceAgentConfig(signal?: AbortSignal): Promise<RinspaceAgentConfig> {
	const response = await fetch('/rinspace/api/editor/v1/agent/config', {
		credentials: 'include',
		cache: 'no-store',
		headers: { Accept: 'application/json' },
		signal,
	});
	if (!response.ok) throw new Error(`Agent config failed (${response.status})`);
	return validateConfig(await response.json());
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
	if (!response.ok) throw new Error(`Agent run creation failed (${response.status})`);
	const value = (await response.json()) as { id?: unknown };
	if (typeof value.id !== 'string' || !value.id.trim()) {
		throw new Error('Agent run response is invalid');
	}
	return value.id;
}

export class RinspaceAgentController {
	private readonly listeners = new Set<Listener>();
	private pendingApproval: ToolApprovalRequest | null = null;
	private resolveApproval: ((result: ToolApprovalResult) => void) | null = null;

	private constructor(
		readonly runId: string,
		readonly config: RinspaceAgentConfig,
		private readonly runtime: AgentRuntime,
	) {
		this.runtime.subscribe(() => this.emit());
	}

	static async create(
		context: Extract<HostContext, { mode: 'managed' }>,
		projectId: string,
		config: RinspaceAgentConfig,
		initialMessages: readonly AgentMessage[] = [],
		signal?: AbortSignal,
	): Promise<RinspaceAgentController> {
		const runId = await createRun(context, projectId, config, signal);
		const toolSet = createRinspaceAgentTools();
		let controller: RinspaceAgentController | undefined;
		const runtime = new AgentRuntime({
			model: new RinspaceAgentModel(runId),
			initialMessages,
			sessionId: runId,
			conversationId: runId,
			maxIterations: config.maxIterations,
			tools: toolSet.tools,
			toolPolicies: toolSet.policies,
			messageModelInfo: { id: config.model, provider: 'rinspace' },
			requestToolApproval: (request) =>
				controller?.requestApproval(request) ?? {
					approved: false,
					reason: 'Agent approval host is not ready',
				},
		});
		controller = new RinspaceAgentController(runId, config, runtime);
		return controller;
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
	}

	respondToApproval(approved: boolean): void {
		this.resolveApproval?.({
			approved,
			reason: approved ? undefined : 'Push rejected by the user',
		});
		this.clearApproval();
	}

	private requestApproval(request: ToolApprovalRequest): Promise<ToolApprovalResult> {
		if (request.toolName !== 'push_git_commits') {
			return Promise.resolve({ approved: false, reason: 'Only Push can request approval' });
		}
		this.resolveApproval?.({ approved: false, reason: 'Approval request replaced' });
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
		return { snapshot: this.runtime.snapshot(), pendingApproval: this.pendingApproval };
	}

	private emit(): void {
		const state = this.viewState();
		for (const listener of this.listeners) listener(state);
	}
}
