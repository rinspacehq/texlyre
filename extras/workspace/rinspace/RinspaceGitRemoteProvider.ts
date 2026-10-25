// SPDX-License-Identifier: AGPL-3.0-or-later
import type {
	GitRemoteBranch,
	GitRemoteCommitObject,
	GitRemoteProvider,
	GitRemoteRepository,
} from '@/types/gitRemote';

import { ensureRinspaceGitSession } from './RinspaceSession';

const API_ROOT = '/rinspace/api/editor/v1/projects';
const EDITOR_PROJECT_SCHEMA = 'rinspace-editor-projects/v1';
const CATALOG_SCHEMA = 'rinspace-editor-projects/v2';
const SAFE_COORDINATE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

interface RepositoryWire {
	fullName: string;
	private: boolean;
	defaultBranch: string;
}

interface CatalogWire {
	schemaVersion: string;
	projects: RepositoryWire[];
	hasMore: boolean;
	nextCursor?: string;
}

interface ResolvedProjectWire {
	schemaVersion: string;
	remoteHead: string;
}

interface BranchWire {
	name: string;
	commit: string;
	protected: boolean;
}

interface BranchPageWire {
	schemaVersion: string;
	branches: BranchWire[];
}

function repositoryParts(repositoryId: string): [string, string] {
	const parts = repositoryId.split('/');
	if (
		parts.length !== 2 ||
		!SAFE_COORDINATE.test(parts[0]) ||
		!SAFE_COORDINATE.test(parts[1])
	) {
		throw new Error('Rinspace repository coordinate is invalid');
	}
	return [parts[0], parts[1]];
}

const segment = (value: string) => encodeURIComponent(value);

async function request<T>(endpoint = '', options: RequestInit = {}): Promise<T> {
	const response = await fetch(`${API_ROOT}${endpoint}`, {
		credentials: 'include',
		cache: 'no-store',
		headers: { Accept: 'application/json', ...options.headers },
		...options,
	});
	if (!response.ok) {
		const error = new Error(
			response.status === 401
				? 'Rinspace sign-in is required'
				: response.status === 403 || response.status === 404
					? 'Repository access is not permitted'
					: `Rinspace project request failed (${response.status})`,
		) as Error & { status?: number };
		error.status = response.status;
		throw error;
	}
	return response.json() as Promise<T>;
}

function requireSchema(value: { schemaVersion?: string }, expected = EDITOR_PROJECT_SCHEMA): void {
	if (value.schemaVersion !== expected) {
		throw new Error('Rinspace project response is invalid');
	}
}

async function getHead(repositoryId: string, branch: string): Promise<string | null> {
	const [owner, repository] = repositoryParts(repositoryId);
	try {
		// Refresh the HttpOnly Smart HTTP session immediately before Git transport
		// uses it. Repository metadata still comes from the token-hiding Editor BFF.
		await ensureRinspaceGitSession();
		const result = await request<ResolvedProjectWire>(
			`/${segment(owner)}/${segment(repository)}?ref=${segment(branch)}`,
		);
		requireSchema(result);
		return result.remoteHead;
	} catch (error) {
		if ((error as { status?: number }).status === 404) return null;
		throw error;
	}
}

function smartOnly(): never {
	throw new Error('Rinspace repositories require the native Smart HTTP transport');
}

const unavailableCommit = async (): Promise<GitRemoteCommitObject> => smartOnly();

export function createRinspaceGitRemoteProvider(
	isEnabled: () => boolean = () => true,
): GitRemoteProvider {
	return {
		id: 'rinspace-gitea-session',
		displayName: 'Rinspace Gitea',
		historyPluginId: 'rinspace-workspace',
		historyTokenSecretKey: 'unused-browser-session',
		backupPluginId: 'rinspace-workspace',
		backupTokenSecretKey: 'unused-browser-session',
		usesBrowserSession: true,
		hiddenFromPicker: true,
		isEnabled,
		repositoryLinks: (repositoryId, branch) => {
			const [owner, repository] = repositoryParts(repositoryId);
			const links = [
				{
					label: 'Open branch in Gitea',
					href: `/repos/${segment(owner)}/${segment(repository)}/src/branch/${segment(branch)}`,
				},
			];
			if (!/^\d+$/.test(owner)) return links;
			const contentPath =
				repository === 'a'
					? `/a/${owner}`
					: repository === 'b' || repository === 'pdf'
						? `/books/${owner}`
						: repository === 'tags'
							? `/tags/${owner}`
							: undefined;
			if (contentPath) {
				links.push({ label: 'Open publication page', href: contentPath });
			}
			return links;
		},
		smartHttp: {
			repositoryUrl: (repositoryId) => {
				const [owner, repository] = repositoryParts(repositoryId);
				const path = `/repos/${segment(owner)}/${segment(repository)}.git`;
				return typeof window === 'undefined' ? path : new URL(path, window.location.origin).href;
			},
		},
		testConnection: async () => {
			try {
				// A managed project has already been resolved and authorized before
				// GitSyncService binds its fixed remote. Testing that remote must only
				// establish the browser's Gitea Smart HTTP session; coupling it to the
				// independent project catalog makes a catalog/session race prevent an
				// otherwise valid direct project open.
				await ensureRinspaceGitSession();
				return true;
			} catch {
				return false;
			}
		},
		listRepositories: async (): Promise<GitRemoteRepository[]> => {
			const repositories: GitRemoteRepository[] = [];
			const seen = new Set<string>();
			let cursor: string | undefined;
			do {
				const query = new URLSearchParams({ limit: '50' });
				if (cursor) query.set('before_id', cursor);
				const result = await request<CatalogWire>(`?${query}`);
				requireSchema(result, CATALOG_SCHEMA);
				if (!Array.isArray(result.projects) || typeof result.hasMore !== 'boolean') {
					throw new Error('Rinspace catalog response is invalid');
				}
				for (const repository of result.projects) {
					repositoryParts(repository.fullName);
					if (seen.has(repository.fullName)) throw new Error('Rinspace catalog contains duplicate repositories');
					seen.add(repository.fullName);
					repositories.push({ id: repository.fullName, label: repository.fullName, private: repository.private, defaultBranch: repository.defaultBranch });
				}
				if (!result.hasMore) break;
				const next = result.nextCursor;
				if (!next || !/^[1-9][0-9]{0,18}$/.test(next) || BigInt(next) > 9223372036854775807n || (cursor && BigInt(next) >= BigInt(cursor))) {
					throw new Error('Rinspace catalog cursor is invalid');
				}
				cursor = next;
			} while (cursor);
			return repositories;
		},
		listBranches: async (_token, repositoryId): Promise<GitRemoteBranch[]> => {
			const [owner, repository] = repositoryParts(repositoryId);
			const result = await request<BranchPageWire>(
				`/${segment(owner)}/${segment(repository)}/branches?page=1&limit=100`,
			);
			requireSchema(result);
			return result.branches.map((branch) => ({
				name: branch.name,
				protected: branch.protected,
			}));
		},
		historyTransport: {
			preservesCommitOids: true,
			supportsMergeCommits: true,
			getHead: (_token, repositoryId, branch) => getHead(repositoryId, branch),
			getCommit: unavailableCommit,
			getTree: async () => smartOnly(),
			getBlob: async () => smartOnly(),
			createCommit: async () => smartOnly(),
		},
	};
}
