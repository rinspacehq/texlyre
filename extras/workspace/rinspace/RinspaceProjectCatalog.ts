// SPDX-License-Identifier: AGPL-3.0-or-later
import type {
	WorkspaceCatalogPage,
	WorkspaceCatalogProject,
	WorkspaceProjectCatalog,
} from '@/workspace/contracts';

import type { RinspaceManagedWorkspaceRuntime } from './RinspaceManagedWorkspace';
import {
	loadRinspaceSession,
	RinspaceSignInRequiredError,
} from './RinspaceSession';

const SAFE_COORDINATE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const CATALOG_SCHEMA = 'rinspace-editor-projects/v1';

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

	constructor(
		private readonly runtime: RinspaceManagedWorkspaceRuntime,
		private readonly fetcher: typeof fetch = (input, init) =>
			globalThis.fetch(input, init),
	) {
		this.unsubscribeRuntime = runtime.subscribe(() => {
			if (!runtime.isEnabled()) this.abortAll();
			for (const listener of this.listeners) listener();
		});
	}

	isEnabled(): boolean {
		return this.runtime.isEnabled();
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
			request.pageSize > 100
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
			const path = `/rinspace/api/editor/v1/projects?page=${request.page}&limit=${request.pageSize}${query ? `&q=${encodeURIComponent(query)}` : ''}`;
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
				(query !== '' && catalog.query !== query) ||
				!Number.isSafeInteger(account.id) ||
				account.id < 1 ||
				!account.login?.trim() ||
				!Array.isArray(catalog.projects)
			) {
				throw new Error('Rinspace project catalog is invalid');
			}
			return {
				status: 'authenticated',
				accountLabel: account.login.trim(),
				projects: catalog.projects
					.filter(
						(repository) =>
							query !== '' ||
							(!repository.fullName.toLowerCase().startsWith('tags/') &&
								repository.rinspaceContentType !== 'tag-wiki'),
					)
					.map((repository) => catalogProject(repository))
					.filter(
						(project): project is WorkspaceCatalogProject => project !== null,
					),
				page: request.page,
				hasMore: Boolean(catalog.hasMore),
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
