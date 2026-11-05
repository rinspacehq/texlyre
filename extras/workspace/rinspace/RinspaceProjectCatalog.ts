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
const ACCOUNT_CACHE_MS = 60_000;
const CATALOG_CACHE_MS = 120_000;

function withSignal<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
	if (signal.aborted) return Promise.reject(signal.reason);
	return new Promise<T>((resolve, reject) => {
		const abort = () => reject(signal.reason);
		signal.addEventListener('abort', abort, { once: true });
		promise
			.then(resolve, reject)
			.finally(() => signal.removeEventListener('abort', abort));
	});
}

function validCursor(value: unknown): value is string {
	return (
		typeof value === 'string' &&
		/^[1-9][0-9]{0,18}$/.test(value) &&
		BigInt(value) <= 9223372036854775807n
	);
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
	createdAt?: string;
	tags?: string[];
	rinspaceTitle?: string;
	rinspaceContentType?: string;
	rinspaceProjectionVersion?: number;
	access: 'owner' | 'collaborator';
	creationState?: 'ready' | 'preparing' | 'attention';
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
		(repository.creationState !== undefined &&
			!['ready', 'preparing', 'attention'].includes(
				repository.creationState,
			)) ||
		!['owner', 'collaborator'].includes(repository.access)
	) {
		return null;
	}
	const defaultRef = repository.defaultBranch?.trim();
	if (!defaultRef) return null;
	const updatedAt = repository.updatedAt
		? Date.parse(repository.updatedAt)
		: Number.NaN;
	const createdAt = repository.createdAt
		? Date.parse(repository.createdAt)
		: Number.NaN;
	if (
		repository.tags !== undefined &&
		(!Array.isArray(repository.tags) ||
			repository.tags.length > 24 ||
			repository.tags.some(
				(tag) => typeof tag !== 'string' || !tag.trim() || tag.length > 256,
			))
	)
		return null;
	return {
		id: String(repository.id),
		name: repository.rinspaceTitle?.trim() || repository.fullName,
		description: repository.description?.trim() || '',
		repositoryLabel: repository.fullName,
		contentType,
		defaultRef,
		...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
		...(Number.isFinite(createdAt) ? { createdAt } : {}),
		...(repository.tags
			? { tags: repository.tags.map((tag) => tag.trim()) }
			: {}),
		private: repository.private,
		access: repository.access,
		...(repository.creationState
			? { readiness: repository.creationState }
			: {}),
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
	private accountCache:
		| { value: WorkspaceAccountIdentity | null; expires: number }
		| undefined;
	private accountInFlight: Promise<WorkspaceAccountIdentity | null> | undefined;
	private readonly pageCache = new Map<
		string,
		{ value: WorkspaceCatalogPage; expires: number }
	>();
	private readonly pageInFlight = new Map<
		string,
		Promise<WorkspaceCatalogPage>
	>();

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
			if (!next) {
				this.abortAll();
				this.accountActor = undefined;
				this.invalidate();
				this.accountCache = undefined;
			}
			for (const listener of this.listeners) listener();
		});
	}

	isEnabled(): boolean {
		return this.runtime.isEnabled();
	}

	async getAccount(
		signal: AbortSignal,
	): Promise<WorkspaceAccountIdentity | null> {
		if (!this.isEnabled()) return null;
		if (this.accountCache && this.accountCache.expires > Date.now())
			return this.accountCache.value;
		if (!this.accountInFlight) {
			const controller = new AbortController();
			this.controllers.add(controller);
			this.accountInFlight = (async () => {
				try {
					const account = await loadRinspaceAccount(
						this.fetcher,
						controller.signal,
					);
					this.updateAccountActor(account.actorId);
					this.accountCache = {
						value: account,
						expires: Date.now() + ACCOUNT_CACHE_MS,
					};
					return account;
				} catch (error) {
					if (
						error instanceof RinspaceSignInRequiredError &&
						!controller.signal.aborted
					) {
						this.updateAccountActor(null);
						this.accountCache = {
							value: null,
							expires: Date.now() + ACCOUNT_CACHE_MS,
						};
						return null;
					}
					throw error;
				} finally {
					this.controllers.delete(controller);
					this.accountInFlight = undefined;
				}
			})();
		}
		return withSignal(this.accountInFlight, signal);
	}

	private updateAccountActor(actor: string | null): void {
		const changed =
			this.accountActor !== undefined && this.accountActor !== actor;
		this.accountActor = actor;
		if (changed) {
			this.invalidate();
			for (const listener of this.listeners) listener();
		}
	}

	invalidate(): void {
		this.pageCache.clear();
		this.accountCache = undefined;
	}

	prefetch(): void {
		if (!this.isEnabled()) return;
		const controller = new AbortController();
		void this.getAccount(controller.signal)
			.then((account) =>
				account
					? this.listPage({ page: 1, pageSize: 50 }, controller.signal)
					: undefined,
			)
			.catch(() => {});
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
		const query = request.query?.trim() || '';
		const key = `${this.accountActor ?? 'pending'}:${request.page}:${request.pageSize}:${query}:${request.cursor ?? ''}`;
		const cached = this.pageCache.get(key);
		if (cached && cached.expires > Date.now()) return cached.value;
		let pending = this.pageInFlight.get(key);
		if (!pending) {
			const controller = new AbortController();
			pending = this.loadPageNetwork(request, controller.signal)
				.then((value) => {
					if (value.status === 'authenticated')
						this.pageCache.set(key, {
							value,
							expires: Date.now() + CATALOG_CACHE_MS,
						});
					return value;
				})
				.finally(() => this.pageInFlight.delete(key));
			this.pageInFlight.set(key, pending);
		}
		return withSignal(pending, externalSignal);
	}

	private async loadPageNetwork(
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
				(catalog.hasMore
					? !validCursor(catalog.nextCursor)
					: catalog.nextCursor !== undefined) ||
				(catalog.nextCursor !== undefined &&
					request.cursor !== undefined &&
					BigInt(catalog.nextCursor) >= BigInt(request.cursor))
			) {
				throw new Error('Rinspace project catalog is invalid');
			}
			let previousId =
				request.cursor === undefined ? undefined : BigInt(request.cursor);
			const projects = catalog.projects.map((repository) => {
				const project = catalogProject(repository);
				const tagNamespace =
					typeof repository?.fullName === 'string' &&
					repository.fullName.toLowerCase().startsWith('tags/');
				const isTag =
					tagNamespace || repository?.rinspaceContentType === 'tag-wiki';
				if (
					!project ||
					(previousId !== undefined && BigInt(repository.id) >= previousId) ||
					(catalog.nextCursor !== undefined &&
						BigInt(repository.id) < BigInt(catalog.nextCursor)) ||
					(query === '' && isTag) ||
					(isTag &&
						(!tagNamespace || repository.private || repository.archived))
				) {
					throw new Error(
						'Rinspace project catalog scope or ordering is invalid',
					);
				}
				previousId = BigInt(repository.id);
				return project;
			});
			if (
				catalog.hasMore &&
				(projects.length === 0 ||
					catalog.nextCursor === undefined ||
					previousId !== BigInt(catalog.nextCursor))
			) {
				throw new Error(
					'Rinspace project catalog cursor does not match its final row',
				);
			}
			return {
				status: 'authenticated',
				accountLabel: account.login.trim(),
				projects,
				page: request.page,
				hasMore: catalog.hasMore,
				...(catalog.nextCursor !== undefined
					? { nextCursor: catalog.nextCursor }
					: {}),
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
