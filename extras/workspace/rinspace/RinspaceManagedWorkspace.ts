// SPDX-License-Identifier: AGPL-3.0-or-later
import JSZip from 'jszip';
import { nanoid } from 'nanoid';
import { IndexeddbPersistence } from 'y-indexeddb';
import * as Y from 'yjs';

import type { HostContext } from '@/workspace/contracts';
import type { FileNode } from '@/types/files';
import type { Project } from '@/types/projects';
import { authService } from '@/services/AuthService';
import { gitService } from '@/services/GitService';
import { gitSyncService } from '@/services/GitSyncService';
import {
	fileStorageEventEmitter,
	fileStoreService,
} from '@/services/FileStoreService';
import { getMimeType, isBinaryFile } from '@/utils/fileUtils';
import { replaceHash } from '@/utils/urlUtils';
import { managedLocalProfileScope } from '@/workspace/LocalProfile';

import { invalidManagedBuild, parseRinspaceManifest } from './RinspaceManifest';
import {
	loadRinspaceSession,
	type RinspaceNativeSession,
} from './RinspaceSession';

const MAX_ARCHIVE_BYTES = 64 * 1024 * 1024;
const MAX_EXPANDED_BYTES = 256 * 1024 * 1024;
const MAX_FILE_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 10_000;

const SAFE_COORDINATE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
const EDITOR_PROJECT_SCHEMA = 'rinspace-editor-projects/v1';

export interface RinspaceManagedIntent {
	owner: string;
	repository: string;
	ref?: string;
}

interface GiteaUser {
	id: number;
	login: string;
	fullName?: string;
}

interface GiteaRepository {
	id: number;
	name: string;
	fullName: string;
	defaultBranch: string;
	objectFormat: 'sha1' | 'sha256';
	permissions: {
		admin: boolean;
		push: boolean;
		pull: boolean;
	};
}

interface ResolvedProjectWire {
	schemaVersion: string;
	account: GiteaUser;
	project: GiteaRepository;
	ref: string;
	remoteHead: string;
	commitIdentity?: { name: string; email: string };
}

export interface RinspaceResolvedWorkspace {
	identity: RinspaceNativeSession;
	giteaUser: GiteaUser;
	repository: GiteaRepository;
	ref: string;
	remoteHead: string;
	objectFormat: 'sha1' | 'sha256';
	commitIdentity?: { name: string; email: string };
}

export interface RinspaceMaterializedWorkspace {
	workspaceId: string;
	profileScope: string;
	baseCommit: string;
	generation: number;
}

export type RinspaceWorkspaceState =
	| { status: 'disabled' | 'idle' }
	| { status: 'connecting' }
	| {
			status: 'connected';
			context: Extract<HostContext, { mode: 'managed' }>;
			remoteHead: string;
			giteaLogin: string;
	  }
	| { status: 'error'; message: string };

interface RuntimeDependencies {
	fetch: typeof fetch;
	materialize: (
		workspace: RinspaceResolvedWorkspace,
		signal: AbortSignal,
		fetcher: typeof fetch,
	) => Promise<RinspaceMaterializedWorkspace>;
	watchManifest?: (
		workspace: RinspaceResolvedWorkspace,
		materialized: RinspaceMaterializedWorkspace,
	) => () => void;
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`${label} is unavailable`);
	}
	return value.trim();
}

async function responseJSON<T>(response: Response, label: string): Promise<T> {
	if (!response.ok) {
		if (response.status === 401) throw new Error('Rinspace sign-in is required');
		if (response.status === 403 || response.status === 404) {
			throw new Error('Repository access is not permitted');
		}
		throw new Error(`${label} failed (${response.status})`);
	}
	return response.json() as Promise<T>;
}

function apiPath(...parts: string[]): string {
	return parts.map((part) => encodeURIComponent(part)).join('/');
}

function normalizeIntent(raw: Readonly<Record<string, string>>): RinspaceManagedIntent {
	const owner = requireString(raw.owner, 'Repository owner');
	const repository = requireString(raw.repository, 'Repository name');
	if (!SAFE_COORDINATE.test(owner) || !SAFE_COORDINATE.test(repository)) {
		throw new Error('Repository coordinate is invalid');
	}
	const ref = raw.ref?.trim();
	if (ref && (ref.length > 255 || ref.startsWith('/') || ref.endsWith('/') || ref.includes('..'))) {
		throw new Error('Repository ref is invalid');
	}
	return { owner, repository, ref: ref || undefined };
}

function validateCommit(commit: string, objectFormat: 'sha1' | 'sha256'): string {
	const normalized = commit.toLowerCase();
	const length = objectFormat === 'sha256' ? 64 : 40;
	if (!new RegExp(`^[0-9a-f]{${length}}$`).test(normalized)) {
		throw new Error('Repository branch returned an invalid commit');
	}
	return normalized;
}

export async function resolveRinspaceWorkspace(
	rawIntent: Readonly<Record<string, string>>,
	signal: AbortSignal,
	fetcher: typeof fetch = fetch,
): Promise<RinspaceResolvedWorkspace> {
	const intent = normalizeIntent(rawIntent);
	const request = (input: RequestInfo | URL, init: RequestInit = {}) => {
		if (signal.aborted) {
			return Promise.reject(
				signal.reason ?? new DOMException('Workspace request aborted', 'AbortError'),
			);
		}
		return fetcher(input, {
			credentials: 'include',
			cache: 'no-store',
			...init,
			signal,
		});
	};

	const session = await loadRinspaceSession(fetcher, signal);
	const coordinate = apiPath(intent.owner, intent.repository);
	const refQuery = intent.ref ? `?ref=${encodeURIComponent(intent.ref)}` : '';
	const resolved = await responseJSON<ResolvedProjectWire>(
		await request(`/rinspace/api/editor/v1/projects/${coordinate}${refQuery}`, {
			headers: { Accept: 'application/json' },
		}),
		'Rinspace project check',
	);
	if (resolved.schemaVersion !== EDITOR_PROJECT_SCHEMA) {
		throw new Error('Rinspace project response is invalid');
	}
	const giteaUser = resolved.account;
	const repository = resolved.project;
	if (!Number.isSafeInteger(giteaUser?.id) || giteaUser.id < 1) {
		throw new Error('Current Gitea identity is invalid');
	}
	requireString(giteaUser.login, 'Current Gitea identity');
	if (!Number.isSafeInteger(repository.id) || repository.id < 1) {
		throw new Error('Repository identity is invalid');
	}
	const repositoryName = requireString(repository.name, 'Repository name');
	const repositoryFullName = requireString(
		repository.fullName,
		'Repository coordinate',
	);
	if (
		repositoryFullName.toLowerCase() !==
		`${intent.owner}/${intent.repository}`.toLowerCase()
	) {
		throw new Error('Repository coordinate did not match the requested project');
	}
	if (repositoryName.toLowerCase() !== intent.repository.toLowerCase()) {
		throw new Error('Repository name did not match the requested project');
	}
	const permissions = repository.permissions;
	if (!permissions.pull && !permissions.push && !permissions.admin) {
		throw new Error('Repository access is not permitted');
	}

	const ref = intent.ref ?? requireString(repository.defaultBranch, 'Default branch');
	if (resolved.ref !== ref) {
		throw new Error('Repository branch did not match the requested ref');
	}
	const objectFormat = repository.objectFormat;
	if (objectFormat !== 'sha1' && objectFormat !== 'sha256') {
		throw new Error('Repository object format is invalid');
	}
	const remoteHead = validateCommit(
		requireString(resolved.remoteHead, 'Branch commit'),
		objectFormat,
	);
	let commitIdentity: RinspaceResolvedWorkspace['commitIdentity'];
	if (
		(permissions.push || permissions.admin) &&
		resolved.commitIdentity?.name?.trim() &&
		resolved.commitIdentity.email?.trim()
	) {
		commitIdentity = {
			name: resolved.commitIdentity.name.trim(),
			email: resolved.commitIdentity.email.trim(),
		};
	}

	return {
		identity: session,
		giteaUser,
		repository,
		ref,
		remoteHead,
		objectFormat,
		commitIdentity,
	};
}

async function sha256Hex(value: string): Promise<string> {
	const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest))
		.map((byte) => byte.toString(16).padStart(2, '0'))
		.join('');
}

function textContent(content: string | ArrayBuffer | null | undefined): string {
	if (typeof content === 'string') return content;
	if (content instanceof ArrayBuffer) {
		return new TextDecoder('utf-8', { fatal: true }).decode(content);
	}
	throw new Error('rinspace.yaml has no readable text content');
}

async function persistManagedBuild(
	workspaceId: string,
	state: Project['managedBuild'],
): Promise<void> {
	if (!state) return;
	const project = await authService.getProjectById(workspaceId);
	if (!project) throw new Error('Managed browser project is unavailable');
	const mainFile = state.status === 'valid' ? `/${state.entry}` : undefined;
	await authService.updateProject({ ...project, mainFile, managedBuild: state });

	const ydoc = new Y.Doc();
	const persistence = new IndexeddbPersistence(
		`texlyre-project-${workspaceId}-yjs_metadata`,
		ydoc,
	);
	try {
		await persistence.whenSynced;
		ydoc.transact(() => {
			const data = ydoc.getMap('data');
			const metadata = (data.get('projectMetadata') ?? {}) as Record<string, unknown>;
			data.set('projectMetadata', {
				...metadata,
				type: 'files',
				group: 'files',
				mainFile,
				managedBuild: state,
			});
		});
	} finally {
		await persistence.destroy();
		ydoc.destroy();
	}
	document.dispatchEvent(new CustomEvent('workspace-preview-configuration', {
		detail: { workspaceId, managedBuild: state },
	}));
}

async function refreshManagedBuild(
	workspaceId: string,
	owner: string,
	repository: string,
) {
	if (fileStoreService.getCurrentProjectId() !== workspaceId) return;
	const files = await fileStoreService.getAllFiles(false, false, true);
	const manifest = files.find(
		(file) => file.type === 'file' && file.path === '/rinspace.yaml',
	);
	const paths = new Set(
		files.filter((file) => file.type === 'file').map((file) => file.path),
	);
	let state = invalidManagedBuild('rinspace.yaml is missing from the repository root');
	if (manifest) {
		try {
			state = parseRinspaceManifest(
				textContent(manifest.content),
				owner,
				repository,
				paths,
			);
		} catch (error) {
			state = invalidManagedBuild(
				error instanceof Error ? error.message : 'rinspace.yaml is not readable UTF-8',
			);
		}
	}
	await persistManagedBuild(workspaceId, state);
	return state;
}

function watchManagedManifest(
	workspace: RinspaceResolvedWorkspace,
	materialized: RinspaceMaterializedWorkspace,
): () => void {
	let timer: ReturnType<typeof setTimeout> | undefined;
	let closed = false;
	const refresh = () => {
		if (closed) return;
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			if (closed) return;
			void refreshManagedBuild(
				materialized.workspaceId,
				workspace.repository.fullName.split('/')[0],
				workspace.repository.name,
			).catch(() => {});
		}, 100);
	};
	const unsubscribe = fileStorageEventEmitter.onChange((change) => {
		if (change.kind === 'structure' || change.filePath === '/rinspace.yaml') refresh();
	});
	return () => {
		closed = true;
		if (timer) clearTimeout(timer);
		unsubscribe();
	};
}

function workspaceUuid(digest: string): string {
	const value = `${digest.slice(0, 12)}4${digest.slice(13, 16)}8${digest.slice(17, 32)}`;
	return [
		value.slice(0, 8),
		value.slice(8, 12),
		value.slice(12, 16),
		value.slice(16, 20),
		value.slice(20, 32),
	].join('-');
}

function safeArchivePath(raw: string): string {
	const slashes = raw.replace(/\\/g, '/');
	if (slashes.startsWith('/') || /^[A-Za-z]:/.test(slashes)) {
		throw new Error('Repository archive contains an unsafe path');
	}
	const parts = slashes.split('/').filter((part) => part && part !== '.');
	if (
		parts.includes('..') ||
		parts.some((part) =>
			Array.from(part).some((character) => character.charCodeAt(0) <= 0x1f),
		)
	) {
		throw new Error('Repository archive contains an unsafe path');
	}
	return parts.join('/');
}

async function readBoundedZipEntry(
	entry: JSZip.JSZipObject,
	remaining: number,
): Promise<ArrayBuffer> {
	return new Promise((resolve, reject) => {
		const chunks: Uint8Array[] = [];
		let size = 0;
		const stream = (entry as JSZip.JSZipObject & {
			internalStream(type: 'uint8array'): JSZip.JSZipStreamHelper<Uint8Array>;
		}).internalStream('uint8array');
		stream.on('data', (chunk: Uint8Array) => {
			size += chunk.byteLength;
			if (size > MAX_FILE_BYTES || size > remaining) {
				stream.pause();
				reject(new Error('Repository archive expands beyond the browser import limit'));
				return;
			}
			chunks.push(chunk);
		});
		stream.on('error', reject);
		stream.on('end', () => {
			const bytes = new Uint8Array(size);
			let offset = 0;
			for (const chunk of chunks) {
				bytes.set(chunk, offset);
				offset += chunk.byteLength;
			}
			resolve(bytes.buffer);
		});
		stream.resume();
	});
}

export async function prepareRinspaceRepositoryArchive(file: File): Promise<FileNode[]> {
	if (file.size > MAX_ARCHIVE_BYTES) {
		throw new Error('Repository archive exceeds the 64 MiB browser import limit');
	}
	const zip = await JSZip.loadAsync(new Uint8Array(await file.arrayBuffer()));
	const entries = Object.values(zip.files);
	if (entries.length > MAX_ENTRIES) {
		throw new Error('Repository archive has too many entries for browser import');
	}
	const paths = entries.map((entry) => safeArchivePath(entry.unsafeOriginalName ?? entry.name));
	const firstSegments = new Set(paths.filter(Boolean).map((path) => path.split('/')[0]));
	if (firstSegments.size !== 1) {
		throw new Error('Repository archive does not have one project root');
	}
	const root = `${Array.from(firstSegments)[0]}/`;
	const files: FileNode[] = [];
	const kinds = new Map<string, 'file' | 'directory'>();
	const addDirectory = (path: string, name: string) => {
		const existing = kinds.get(path);
		if (existing === 'file') {
			throw new Error('Repository archive contains a file/directory collision');
		}
		if (existing === 'directory') return;
		kinds.set(path, 'directory');
		files.push({
			id: nanoid(),
			name,
			path,
			type: 'directory',
			lastModified: Date.now(),
		});
	};
	let expanded = 0;
	for (let index = 0; index < entries.length; index++) {
		const entry = entries[index];
		const archivedPath = paths[index];
		if (!archivedPath || archivedPath === root.slice(0, -1)) continue;
		if (!archivedPath.startsWith(root)) {
			throw new Error('Repository archive entry escaped its project root');
		}
		const relative = archivedPath.slice(root.length);
		if (!relative) continue;
		const unixMode =
			typeof entry.unixPermissions === 'number'
				? entry.unixPermissions & 0o170000
				: 0;
		if (unixMode === 0o120000) {
			throw new Error('Repository links require native Git and were not imported');
		}
		const path = `/${relative}`;
		const parts = relative.split('/');
		for (let depth = 1; depth < parts.length; depth++) {
			addDirectory(`/${parts.slice(0, depth).join('/')}`, parts[depth - 1]);
		}
		if (entry.dir) {
			addDirectory(path, parts.at(-1) ?? relative);
			continue;
		}
		if (kinds.has(path)) throw new Error('Repository archive contains duplicate paths');
		kinds.set(path, 'file');
		const content = await readBoundedZipEntry(entry, MAX_EXPANDED_BYTES - expanded);
		expanded += content.byteLength;
		files.push({
			id: nanoid(),
			name: parts.at(-1) ?? relative,
			path,
			type: 'file',
			content,
			size: content.byteLength,
			isBinary: isBinaryFile(relative),
			mimeType: getMimeType(relative),
			lastModified: Date.now(),
		});
	}
	if (!files.some((entry) => entry.type === 'file')) {
		throw new Error('Repository archive contains no files');
	}
	return files;
}

const browserSessionSecrets = {
	getSecret: async () => null,
};

async function prepareManagedGit(
	workspace: RinspaceResolvedWorkspace,
	project: Project,
	_existing: boolean,
	signal: AbortSignal,
): Promise<string> {
	const binding = project.managedBinding;
	if (!binding) throw new Error('Managed workspace binding is unavailable');
	const canPush = Boolean(
		(workspace.repository.permissions?.push || workspace.repository.permissions?.admin) &&
		workspace.commitIdentity,
	);
	gitService.setManagedCommitIdentity(project.id, workspace.commitIdentity);
	const initialized = await gitService.isInitialized(project.id);
	const localHead = initialized ? await gitService.getHeadOid(project.id) : null;
	await gitSyncService.bindBrowserSessionRemote(
		project.id,
		{
			providerId: 'rinspace-gitea-session',
			repositoryId: workspace.repository.fullName,
			repositoryLabel: workspace.repository.fullName,
			branch: workspace.ref,
			readOnly: !canPush,
		},
		localHead
			? { localOid: binding.baseCommit, remoteOid: binding.baseCommit }
			: undefined,
	);
	if (localHead) return binding.baseCommit;

	let fetched: Awaited<ReturnType<typeof gitSyncService.fetchForMerge>> = null;
	try {
		fetched = await gitSyncService.fetchForMerge(
			project.id,
			browserSessionSecrets,
			signal,
		);
		if (!fetched) throw new Error('The managed repository branch is empty');
		// A project record can outlive an interrupted first fetch (for example,
		// React StrictMode remounting the auth provider). An initialized repository
		// without a resolvable HEAD is not a usable workspace, so rebuild its
		// worktree from the immutable remote commit instead of treating it as an
		// offline draft.
		const adoptedOid = fetched.localOid;
		await gitSyncService.adoptFetched(project.id, fetched, {
			branch: workspace.ref,
			preserveWorktree: false,
		});
		const adopted = {
			...fetched,
			localOid: adoptedOid,
			remoteOid: fetched.remoteOid,
		};
		gitSyncService.markFetchedSynced(project.id, adopted);
		return adopted.remoteOid;
	} finally {
		if (fetched) {
			await gitSyncService.discardFetched(project.id, fetched.temporaryBranch);
		}
	}
}

async function materializeWorkspace(
	workspace: RinspaceResolvedWorkspace,
	signal: AbortSignal,
	_fetcher: typeof fetch,
): Promise<RinspaceMaterializedWorkspace> {
	const actorId = workspace.identity.user.id;
	const profileScope = await managedLocalProfileScope(actorId);
	const workspaceDigest = await sha256Hex(
		`${profileScope}\0${workspace.repository.id}\0${workspace.ref}`,
	);
	const workspaceId = workspaceUuid(workspaceDigest);
	await authService.initialize({ persistentLocalProfile: true });
	if (signal.aborted) throw signal.reason;

	const existing = await authService.getProjectById(workspaceId);
	if (existing) {
		const binding = existing.managedBinding;
		if (
			!binding ||
			binding.profileScope !== profileScope ||
			binding.repositoryId !== String(workspace.repository.id) ||
			binding.ref !== workspace.ref
		) {
			throw new Error('Managed workspace identity collided with another local project');
		}
		await fileStoreService.initialize(existing.docUrl);
		const nextBinding = {
			...binding,
			...(workspace.commitIdentity
				? { commitIdentity: workspace.commitIdentity }
				: {}),
		};
		const boundProject = await authService.updateProject({
			...existing,
			managedBinding: nextBinding,
		});
		await prepareManagedGit(workspace, boundProject, true, signal);
		if (signal.aborted) throw signal.reason;
		const managedBuild = await refreshManagedBuild(
			workspaceId,
			workspace.repository.fullName.split('/')[0],
			workspace.repository.name,
		);
		activateProject(
			existing,
			managedBuild?.status === 'valid' ? `/${managedBuild.entry}` : '/rinspace.yaml',
		);
		return {
			workspaceId,
			profileScope,
			baseCommit: nextBinding.baseCommit,
			generation: binding.generation,
		};
	}

	const generation = 1;
	let project = await authService.createProject({
		id: workspaceId,
		name: workspace.repository.fullName,
		description: 'Rinspace repository browser copy',
		type: 'files',
		group: 'files',
		tags: [],
		isFavorite: false,
		managedBinding: {
			profileScope,
			repositoryId: String(workspace.repository.id),
			owner: workspace.repository.fullName.split('/')[0],
			repository: workspace.repository.name,
			ref: workspace.ref,
			baseCommit: workspace.remoteHead,
			objectFormat: workspace.objectFormat,
			generation,
			...(workspace.commitIdentity
				? { commitIdentity: workspace.commitIdentity }
				: {}),
		},
	});
	await fileStoreService.initialize(project.docUrl);
	const baseCommit = await prepareManagedGit(workspace, project, false, signal);
	if (signal.aborted) throw signal.reason;
	if (project.managedBinding?.baseCommit !== baseCommit) {
		project = await authService.updateProject({
			...project,
			managedBinding: {
				...project.managedBinding!,
				baseCommit,
			},
		});
	}
	const managedBuild = await refreshManagedBuild(
		workspaceId,
		workspace.repository.fullName.split('/')[0],
		workspace.repository.name,
	);
	if (signal.aborted) throw signal.reason;
	activateProject(
		project,
		managedBuild?.status === 'valid' ? `/${managedBuild.entry}` : '/rinspace.yaml',
	);
	return {
		workspaceId,
		profileScope,
		baseCommit,
		generation,
	};
}

function activateProject(project: Pick<Project, 'id'>, filePath?: string): void {
	sessionStorage.setItem('currentProjectId', project.id);
	replaceHash(
		`yjs:${project.id}${filePath ? `&file:${encodeURIComponent(filePath)}` : ''}`,
	);
}

function linkAbortSignal(source: AbortSignal, target: AbortController): () => void {
	if (source.aborted) {
		target.abort(source.reason);
		return () => {};
	}
	const abort = () => target.abort(source.reason);
	source.addEventListener('abort', abort, { once: true });
	return () => source.removeEventListener('abort', abort);
}

export class RinspaceManagedWorkspaceRuntime {
	private enabled: boolean;
	private generation = 0;
	private controller: AbortController | null = null;
	private state: RinspaceWorkspaceState;
	private listeners = new Set<(state: RinspaceWorkspaceState) => void>();
	private invalidationListeners = new Set<() => void>();
	private activeIntent = '';
	private activeWorkspaceId = '';
	private inFlight: Promise<Extract<HostContext, { mode: 'managed' }>> | null = null;
	private stopManifestWatch: (() => void) | null = null;

	constructor(
		private readonly dependencies: RuntimeDependencies = {
			fetch: (input, init) => globalThis.fetch(input, init),
			materialize: materializeWorkspace,
			watchManifest: watchManagedManifest,
		},
		initiallyEnabled = false,
	) {
		this.enabled = initiallyEnabled;
		this.state = { status: initiallyEnabled ? 'idle' : 'disabled' };
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	getState(): RinspaceWorkspaceState {
		return this.state;
	}

	subscribe(listener: (state: RinspaceWorkspaceState) => void): () => void {
		this.listeners.add(listener);
		listener(this.state);
		return () => this.listeners.delete(listener);
	}

	onContextInvalidated(listener: () => void): () => void {
		this.invalidationListeners.add(listener);
		return () => this.invalidationListeners.delete(listener);
	}

	setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) return;
		this.enabled = enabled;
		if (!enabled) {
			this.invalidate({ status: 'disabled' });
			return;
		}
		this.updateState({ status: 'idle' });
		const params = Object.fromEntries(new URLSearchParams(window.location.search).entries());
		if (params.mode === 'managed') {
			void this.open(params, new AbortController().signal).catch(() => {});
		}
	}

	open(
		intent: Readonly<Record<string, string>>,
		externalSignal: AbortSignal,
	): Promise<Extract<HostContext, { mode: 'managed' }>> {
		if (!this.enabled) {
			return Promise.reject(new Error('Rinspace integration is disabled'));
		}
		const intentKey = JSON.stringify(normalizeIntent(intent));
		if (
			this.inFlight &&
			this.activeIntent === intentKey &&
			!this.controller?.signal.aborted
		) {
			return this.inFlight;
		}
		if (
			this.state.status === 'connected' &&
			this.activeIntent === intentKey
		) {
			return Promise.resolve(this.state.context);
		}
		const previousTask = this.inFlight;
		this.controller?.abort(new DOMException('Workspace connection replaced', 'AbortError'));
		if (this.activeWorkspaceId) {
			gitService.setManagedCommitIdentity(this.activeWorkspaceId, undefined);
			this.activeWorkspaceId = '';
		}
		const generation = ++this.generation;
		const controller = new AbortController();
		this.controller = controller;
		this.activeIntent = intentKey;
		const unlink = linkAbortSignal(externalSignal, controller);
		this.updateState({ status: 'connecting' });
		const connectAfterPrevious = async () => {
			if (previousTask) {
				try {
					await previousTask;
				} catch {
					// Replacement waits for the aborted materialization to release its
					// IndexedDB/Git writes before repairing or reopening the workspace.
				}
			}
			controller.signal.throwIfAborted();
			return this.connect(intent, generation, controller.signal);
		};
		const task = connectAfterPrevious()
			.catch((error: unknown) => {
				if (generation === this.generation && !controller.signal.aborted) {
					this.updateState({
						status: 'error',
						message: error instanceof Error ? error.message : 'Rinspace connection failed',
					});
				}
				throw error;
			})
			.finally(() => {
				unlink();
				if (generation === this.generation) {
					this.inFlight = null;
					this.controller = null;
				}
			});
		this.inFlight = task;
		return task;
	}

	private async connect(
		intent: Readonly<Record<string, string>>,
		generation: number,
		signal: AbortSignal,
	): Promise<Extract<HostContext, { mode: 'managed' }>> {
		const resolved = await resolveRinspaceWorkspace(intent, signal, this.dependencies.fetch);
		this.assertCurrent(generation, signal);
		const materialized = await this.dependencies.materialize(
			resolved,
			signal,
			this.dependencies.fetch,
		);
		this.assertCurrent(generation, signal);
		this.stopManifestWatch?.();
		this.stopManifestWatch =
			this.dependencies.watchManifest?.(resolved, materialized) ?? null;
		const permissions = resolved.repository.permissions ?? {};
		this.activeWorkspaceId = materialized.workspaceId;
		const capabilities: Extract<HostContext, { mode: 'managed' }>['capabilities'][number][] = [
			'read-source',
			'read-draft',
		];
		if ((permissions.push || permissions.admin) && resolved.commitIdentity) {
			capabilities.push('write-source', 'review', 'push');
		} else {
			capabilities.push('review');
		}
		if (permissions.admin) capabilities.push('manage');
		const context: Extract<HostContext, { mode: 'managed' }> = {
			mode: 'managed',
			identity: {
				actorId: resolved.identity.user.id,
				permissionEpoch: [
					resolved.identity.user.sessionEpoch,
					resolved.identity.user.identityVersion,
					resolved.identity.currentSession.version,
				].join(':'),
			},
			binding: {
				repositoryId: String(resolved.repository.id),
				branchBindingId: await sha256Hex(
					`${resolved.repository.id}\0${resolved.ref}`,
				),
				ref: `refs/heads/${resolved.ref}`,
				workspaceId: materialized.workspaceId,
				generation: materialized.generation,
				baseCommit: materialized.baseCommit,
				objectFormat: resolved.objectFormat,
			},
			capabilities,
		};
		this.assertCurrent(generation, signal);
		this.updateState({
			status: 'connected',
			context,
			remoteHead: resolved.remoteHead,
			giteaLogin: resolved.giteaUser.login,
		});
		return context;
	}

	private assertCurrent(generation: number, signal: AbortSignal): void {
		if (!this.enabled || generation !== this.generation || signal.aborted) {
			throw signal.reason ?? new DOMException('Workspace connection is stale', 'AbortError');
		}
	}

	private invalidate(next: RinspaceWorkspaceState): void {
		this.generation++;
		this.stopManifestWatch?.();
		this.stopManifestWatch = null;
		this.controller?.abort(new DOMException('Rinspace integration disabled', 'AbortError'));
		this.controller = null;
		this.inFlight = null;
		this.activeIntent = '';
		if (this.activeWorkspaceId) {
			gitService.setManagedCommitIdentity(this.activeWorkspaceId, undefined);
			this.activeWorkspaceId = '';
		}
		this.updateState(next);
		for (const listener of this.invalidationListeners) listener();
	}

	private updateState(next: RinspaceWorkspaceState): void {
		this.state = next;
		for (const listener of this.listeners) listener(next);
	}
}
