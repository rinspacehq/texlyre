// SPDX-License-Identifier: AGPL-3.0-or-later
import type {
	GitRemoteBranch,
	GitRemoteCommitObject,
	GitRemoteProvider,
	GitRemoteRepository,
} from '@/types/gitRemote';

const API_ROOT = '/repos/api/v1';
const SAFE_COORDINATE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

interface RepositoryWire {
	// Gitea's public REST wire name is intentionally preserved.
	// eslint-disable-next-line @typescript-eslint/naming-convention
	full_name: string;
	private: boolean;
	// Gitea's public REST wire name is intentionally preserved.
	// eslint-disable-next-line @typescript-eslint/naming-convention
	default_branch: string;
}

interface BranchWire {
	name: string;
	protected?: boolean;
	commit: { id: string };
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

async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
	const response = await fetch(`${API_ROOT}/${endpoint}`, {
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
					: `Gitea request failed (${response.status})`,
		) as Error & { status?: number };
		error.status = response.status;
		throw error;
	}
	return response.status === 204 ? (undefined as T) : response.json() as Promise<T>;
}

async function getHead(repositoryId: string, branch: string): Promise<string | null> {
	const [owner, repository] = repositoryParts(repositoryId);
	try {
		const result = await request<BranchWire>(
			`repos/${segment(owner)}/${segment(repository)}/branches/${segment(branch)}`,
		);
		return result.commit.id;
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
			await request('user');
			return true;
		} catch {
			return false;
		}
	},
	listRepositories: async (): Promise<GitRemoteRepository[]> =>
		(await request<RepositoryWire[]>('user/repos?limit=100')).map((repository) => ({
			id: repository.full_name,
			label: repository.full_name,
			private: repository.private,
			defaultBranch: repository.default_branch,
		})),
	listBranches: async (_token, repositoryId): Promise<GitRemoteBranch[]> => {
		const [owner, repository] = repositoryParts(repositoryId);
		return (await request<BranchWire[]>(
			`repos/${segment(owner)}/${segment(repository)}/branches?limit=100`,
		)).map((branch) => ({ name: branch.name, protected: branch.protected }));
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
