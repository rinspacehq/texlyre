// SPDX-License-Identifier: AGPL-3.0-or-later
import type {
	WorkspaceCatalogPage,
	WorkspaceCatalogProject,
	WorkspaceProjectCatalog,
} from '@/workspace/contracts';

import type { RinspaceManagedWorkspaceRuntime } from './RinspaceManagedWorkspace';

const CONTENT_TYPES = new Set(['article', 'book', 'pdf', 'tag-wiki']);
const SAFE_COORDINATE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

interface NativeSession {
	status?: unknown;
}

interface GiteaUser {
	id: number;
	login: string;
}

interface RepositoryWire {
	id: number;
	name: string;
	// Gitea public API wire names are intentionally preserved.
	// eslint-disable-next-line @typescript-eslint/naming-convention
	full_name: string;
	description?: string;
	private: boolean;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	default_branch: string;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	updated_at?: string;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	rinspace_title?: string;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	rinspace_content_type?: string;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	rinspace_projection_version?: number;
	// eslint-disable-next-line @typescript-eslint/naming-convention
	rinspace_content_owner_ids?: number[];
	permissions?: { pull?: boolean; push?: boolean; admin?: boolean };
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
	repository: RepositoryWire,
	account: GiteaUser,
): WorkspaceCatalogProject | null {
	const parts = repository.full_name.split('/');
	const contentType = repository.rinspace_content_type?.trim() ?? '';
	if (
		!Number.isSafeInteger(repository.id) ||
		repository.id < 1 ||
		parts.length !== 2 ||
		!SAFE_COORDINATE.test(parts[0]) ||
		!SAFE_COORDINATE.test(parts[1]) ||
		!CONTENT_TYPES.has(contentType) ||
		!Number.isSafeInteger(repository.rinspace_projection_version) ||
		(repository.rinspace_projection_version ?? 0) < 1 ||
		(!repository.permissions?.pull &&
			!repository.permissions?.push &&
			!repository.permissions?.admin)
	) {
		return null;
	}
	const defaultRef = repository.default_branch?.trim();
	if (!defaultRef) return null;
	const updatedAt = repository.updated_at
		? Date.parse(repository.updated_at)
		: Number.NaN;
	return {
		id: String(repository.id),
		name: repository.rinspace_title?.trim() || repository.full_name,
		description: repository.description?.trim() || '',
		repositoryLabel: repository.full_name,
		contentType,
		defaultRef,
		...(Number.isFinite(updatedAt) ? { updatedAt } : {}),
		private: repository.private,
		access: repository.rinspace_content_owner_ids?.includes(account.id)
			? 'owner'
			: 'collaborator',
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
		request: { readonly page: number; readonly pageSize: number },
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
			const sessionResponse = await this.fetcher(
				'/api/identity/v1/session',
				requestOptions(controller.signal),
			);
			if (sessionResponse.status === 401) {
				return { status: 'anonymous', projects: [] };
			}
			const session = await responseJSON<NativeSession>(
				sessionResponse,
				'Rinspace identity check',
			);
			if (session.status !== 'authenticated') {
				return { status: 'anonymous', projects: [] };
			}

			const sso = await this.fetcher(
				'/rinspace/api/gitea/sso',
				requestOptions(controller.signal, { method: 'POST' }),
			);
			if (!sso.ok) {
				if (sso.status === 401) return { status: 'anonymous', projects: [] };
				throw new Error(`Gitea session binding failed (${sso.status})`);
			}

			const account = await responseJSON<GiteaUser>(
				await this.fetcher(
					'/repos/api/v1/user',
					requestOptions(controller.signal),
				),
				'Gitea identity check',
			);
			if (
				!Number.isSafeInteger(account.id) ||
				account.id < 1 ||
				!account.login?.trim()
			) {
				throw new Error('Gitea identity is invalid');
			}

			const repositories = await responseJSON<RepositoryWire[]>(
				await this.fetcher(
					`/repos/api/v1/user/repos?page=${request.page}&limit=${request.pageSize}`,
					requestOptions(controller.signal),
				),
				'Rinspace project catalog',
			);
			if (!Array.isArray(repositories)) {
				throw new Error('Rinspace project catalog is invalid');
			}
			return {
				status: 'authenticated',
				accountLabel: account.login.trim(),
				projects: repositories
					.map((repository) => catalogProject(repository, account))
					.filter(
						(project): project is WorkspaceCatalogProject => project !== null,
					),
				page: request.page,
				hasMore: repositories.length === request.pageSize,
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
