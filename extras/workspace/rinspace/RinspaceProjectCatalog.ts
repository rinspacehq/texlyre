// SPDX-License-Identifier: AGPL-3.0-or-later
import type {
	WorkspaceCatalogPage,
	WorkspaceCatalogProject,
	WorkspaceProjectCatalog,
	WorkspaceAccountIdentity,
} from '@/workspace/contracts';

import type { RinspaceManagedWorkspaceRuntime } from './RinspaceManagedWorkspace';
import { loadRinspaceAccount } from './RinspaceAccount';
import {
	loadRinspaceSession,
	RinspaceSignInRequiredError,
} from './RinspaceSession';

const SAFE_COORDINATE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const CATALOG_SCHEMA = 'rinspace-editor-projects/v2';

function validCursor(value: unknown): value is string {
	return typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value) && BigInt(value) <= 9223372036854775807n;
}

interface CatalogAccount {
	id: number;
	login: string;
}

interface ProjectWire {
	id: number;
	name: string;
	fullName: string;
	description: string;
	private: boolean;
	archived: boolean;
	defaultBranch: string;
	objectFormat: 'sha1' | 'sha256';
	updatedAt?: string;
	rinspaceTitle?: string;
	rinspaceContentType?: string;
	rinspaceProjectionVersion?: number;
	access: 'owner' | 'collaborator';
	permissions: { pull: boolean; push: boolean; admin: boolean };
}

interface CatalogWire {
	schemaVersion: string;
	account: CatalogAccount;
	projects: ProjectWire[];
	page: number;
	pageSize: number;
	hasMore: boolean;
	query?: string;
	nextCursor?: string;
}

function requestOptions(
	signal: AbortSignal,
	init: RequestInit = {},
): RequestInit {
	return {
		credentials: 'include',
		cache: 'no-store',
		headers: { Accept: 'application/json', ...init.headers },
		...init,
		signal,
	};
}

async function responseJSON<T>(response: Response, label: string): Promise<T> {
	if (!response.ok) {
		throw new Error(
			response.status === 401
				? 'Rinspace sign-in is required'
				: `${label} failed (${response.status})`,
		);
	}
	return response.json() as Promise<T>;
}

function catalogProject(
	repository: ProjectWire,
): WorkspaceCatalogProject | null {
	if (!repository || typeof repository.fullName !== 'string') return null;
	const parts = repository.fullName.split('/');
	const contentType = repository.rinspaceContentType?.trim() || 'repository';
	if (
		!Number.isSafeInteger(repository.id) ||
		repository.id < 1 ||
		parts.length !== 2 ||
		!SAFE_COORDINATE.test(parts[0]) ||
		!SAFE_COORDINATE.test(parts[1]) ||
		!repository.permissions?.pull ||
		!['owner', 'collaborator'].includes(repository.access)
	) {
		return null;
	}
	const defaultRef = repository.defaultBranch?.trim();
	if (!defaultRef) return null;
	const updatedAt = repository.updatedAt
		? Date.parse(repository.updatedAt)
		: Number.NaN;
	return {
		id: String(repository.id),
		name: repository.rinspaceTitle?.trim() || repository.fullName,
		description: repository.description?.trim() || '',
		repositoryLabel: repository.fullName,
		contentType,
		defaultRef,
		...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
		private: repository.private,
		access: repository.access,
		openIntent: {
			mode: 'managed',
			owner: parts[0],
			repository: parts[1],
			ref: defaultRef,
		},
	};
}

export class RinspaceProjectCatalog implements WorkspaceProjectCatalog {
	private readonly controllers = new Set<AbortController>();
	private readonly listeners = new Set<() => void>();
	private readonly unsubscribeRuntime: () => void;
	private accountActor: string | null | undefined;

	constructor(
		private readonly runtime: RinspaceManagedWorkspaceRuntime,
		private readonly fetcher: typeof fetch = (input, init) =>
			globalThis.fetch(input, init),
	) {
		let enabled = runtime.isEnabled();
		this.unsubscribeRuntime = runtime.subscribe(() => {
			const next = runtime.isEnabled();
			if (next === enabled) return;
			enabled = next;
			if (!next) { this.abortAll(); this.accountActor = undefined; }
			for (const listener of this.listeners) listener();
		});
	}

	isEnabled(): boolean {
		return this.runtime.isEnabled();
	}

	async getAccount(signal: AbortSignal): Promise<WorkspaceAccountIdentity | null> {
		if (!this.isEnabled()) return null;
		try {
			const account = await loadRinspaceAccount(this.fetcher, signal);
			signal.throwIfAborted();
			this.updateAccountActor(account.actorId);
			return account;
		} catch (error) {
			if (error instanceof RinspaceSignInRequiredError && !signal.aborted) {
				this.updateAccountActor(null);
				return null;
			}
			throw error;
		}
	}

	private updateAccountActor(actor: string | null): void {
		const changed = this.accountActor !== undefined && this.accountActor !== actor;
		this.accountActor = actor;
		if (changed) for (const listener of this.listeners) listener();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	async listPage(
		request: {
			readonly page: number;
			readonly pageSize: number;
			readonly query?: string;
			readonly cursor?: string;
		},
		externalSignal: AbortSignal,
	): Promise<WorkspaceCatalogPage> {
		if (!this.runtime.isEnabled()) {
			return { status: 'anonymous', projects: [] };
		}
		if (
			!Number.isSafeInteger(request.page) ||
			request.page < 1 ||
			!Number.isSafeInteger(request.pageSize) ||
			request.pageSize < 1 ||
			request.pageSize > 50 ||
			(request.page > 1 && !validCursor(request.cursor)) ||
			(request.page === 1 && request.cursor !== undefined)
		) {
			throw new Error('Invalid project catalog page');
		}

		const controller = new AbortController();
		const abort = () => controller.abort(externalSignal.reason);
		if (externalSignal.aborted) abort();
		else externalSignal.addEventListener('abort', abort, { once: true });
		this.controllers.add(controller);

		try {
			const query = request.query?.trim() || '';
			const path = `/rinspace/api/editor/v1/projects?page=${request.page}&limit=${request.pageSize}${query ? `&q=${encodeURIComponent(query)}` : ''}${request.cursor ? `&before_id=${encodeURIComponent(request.cursor)}` : ''}`;
			let response = await this.fetcher(
				path,
				requestOptions(controller.signal),
			);
			if (response.status === 401) {
				try {
					await loadRinspaceSession(this.fetcher, controller.signal);
				} catch (error) {
					if (error instanceof RinspaceSignInRequiredError)
						return { status: 'anonymous', projects: [] };
					throw error;
				}
				response = await this.fetcher(path, requestOptions(controller.signal));
				if (response.status === 401)
					return { status: 'anonymous', projects: [] };
			}
			const catalog = await responseJSON<CatalogWire>(
				response,
				'Rinspace project catalog',
			);
			const account = catalog.account;
			if (
				catalog.schemaVersion !== CATALOG_SCHEMA ||
				catalog.page !== request.page ||
				catalog.pageSize !== request.pageSize ||
				(catalog.query || '') !== query ||
				(catalog.query !== undefined && typeof catalog.query !== 'string') ||
				!account ||
				!Number.isSafeInteger(account.id) ||
				account.id < 1 ||
				!account.login?.trim() ||
				!Array.isArray(catalog.projects) ||
				catalog.projects.length > request.pageSize ||
				typeof catalog.hasMore !== 'boolean' ||
				(catalog.hasMore ? !validCursor(catalog.nextCursor) : catalog.nextCursor !== undefined) ||
				(catalog.nextCursor !== undefined && request.cursor !== undefined && BigInt(catalog.nextCursor) >= BigInt(request.cursor))
			) {
				throw new Error('Rinspace project catalog is invalid');
			}
			let previousId = request.cursor === undefined ? undefined : BigInt(request.cursor);
			const projects = catalog.projects.map((repository) => {
				const project = catalogProject(repository);
				const tagNamespace = typeof repository?.fullName === 'string' && repository.fullName.toLowerCase().startsWith('tags/');
				const isTag = tagNamespace || repository?.rinspaceContentType === 'tag-wiki';
				if (!project || (previousId !== undefined && BigInt(repository.id) >= previousId) ||
					(catalog.nextCursor !== undefined && BigInt(repository.id) < BigInt(catalog.nextCursor)) ||
					(query === '' && isTag) || (isTag && (!tagNamespace || repository.private || repository.archived))) {
					throw new Error('Rinspace project catalog scope or ordering is invalid');
				}
				previousId = BigInt(repository.id);
				return project;
			});
			if (catalog.hasMore && (projects.length === 0 || previousId !== BigInt(catalog.nextCursor!))) {
				throw new Error('Rinspace project catalog cursor does not match its final row');
			}
			return {
				status: 'authenticated',
				accountLabel: account.login.trim(),
				projects,
				page: request.page,
				hasMore: catalog.hasMore,
				...(catalog.nextCursor !== undefined ? { nextCursor: catalog.nextCursor } : {}),
			};
		} finally {
			externalSignal.removeEventListener('abort', abort);
			this.controllers.delete(controller);
		}
	}

	dispose(): void {
		this.abortAll();
		this.unsubscribeRuntime();
		this.listeners.clear();
	}

	private abortAll(): void {
		for (const controller of this.controllers) {
			controller.abort(
				new DOMException('Rinspace integration disabled', 'AbortError'),
			);
		}
		this.controllers.clear();
	}
}
