// src/services/FileHandlerService.ts
import { t } from '@/i18n';
import { createNamedLogger } from '@/logging';
import type { FileNode } from '../types/files';
import { mergeAnnotatedSources } from '../utils/annotationMergeUtils';
import { stripAnnotationTagsWithSpans } from '../utils/annotationTagUtils';
import { stripAnnotations, hasAnnotations } from '../utils/fileCommentUtils';
import { isBinaryFile } from '../utils/fileUtils';
import { getStartupIntent } from '../workspace/RuntimeStartup';
import { copyLocalWriteContent, getLocalWritePathIssue, LocalDiskChangedError, matchesLocalWriteContent } from '../workspace/LocalWritePolicy';
import type { DiskWriteEntry, DiskWriteReason, DiskWriteReport, DiskWriteStatus } from '../workspace/DiskWriteResults';
import { mergeResolutionService } from './MergeResolutionService';
import { ensurePermission } from './DiskHandleStore';
import { fileStoreService } from './FileStoreService';
import type { DirectoryTarget } from './WriteTargetService';

const moduleLog = createNamedLogger('FileHandlerService');
const WORKSPACE_CLEAN_PREFIX = 'texlyre-workspace-clean-annotations:';
const exclusiveWriteOptions: FileSystemCreateWritableOptions & { mode: 'exclusive' } = { keepExistingData: false, mode: 'exclusive' };

export interface LaunchedFile {
	name: string;
	type: string;
	buffer: ArrayBuffer;
	handle: FileSystemFileHandle;
}

export type DiskPullResult =
	| 'applied'
	| 'merged'
	| 'unchanged'
	| 'conflict'
	| 'unavailable';

export interface DiskSyncSummary {
	applied: string[];
	merged: string[];
	conflicted: string[];
	droppedAnnotations: number;
	appliedPaths?: string[];
	mergedPaths?: string[];
	conflictedPaths?: string[];
	annotationDrops?: Array<{ path: string; count: number }>;
}

interface PullOptions {
	knownModified?: number;
	promptOnAnnotationLoss?: boolean;
	onAnnotationsDropped?: (count: number) => void;
}

interface DiskTarget {
	stat(): Promise<number | null>;
	read(isBinary: boolean): Promise<string | ArrayBuffer>;
	write(content: string | ArrayBuffer, expected?: string | ArrayBuffer | null): Promise<void>;
	remove?(): Promise<void>;
}

type LaunchListener = (files: LaunchedFile[]) => void;

interface SyncBaseline {
	disk: number;
	local: number;
}

const decodeText = (content?: string | ArrayBuffer): string | null => {
	if (typeof content === 'string') return content;
	if (content && typeof content === 'object' && 'byteLength' in content) {
		return new TextDecoder().decode(content as ArrayBuffer);
	}
	return null;
};

const handleTarget = (handle: FileSystemFileHandle): DiskTarget => ({
	async stat() {
		if (!(await ensurePermission(handle, 'read', false))) return null;
		return (await handle.getFile()).lastModified;
	},
	async read(isBinary) {
		const file = await handle.getFile();
		return isBinary ? file.arrayBuffer() : file.text();
	},
	async write(content, expected) {
		if (!(await ensurePermission(handle, 'readwrite', false))) {
			throw new Error('Write permission was not granted');
		}
		const writable = await handle.createWritable(expected === undefined ? undefined : exclusiveWriteOptions);
		try {
			if (expected !== undefined) {
				const current = await (await handle.getFile()).arrayBuffer();
				if (expected === null || !matchesLocalWriteContent(current, expected)) throw new LocalDiskChangedError();
			}
			await writable.write(content);
			if (expected !== undefined) {
				const current = await (await handle.getFile()).arrayBuffer();
				if (expected === null || !matchesLocalWriteContent(current, expected)) throw new LocalDiskChangedError();
			}
			await writable.close();
		} catch (error) {
			// Abort is best-effort cleanup; never replace the original write/close failure.
			await writable.abort().catch(() => undefined);
			throw error;
		}
	},
});

const workspaceTarget = (
	adapter: DirectoryTarget,
	path: string,
): DiskTarget => ({
	async stat() {
		return (await adapter.stat(path))?.lastModified ?? null;
	},
	read() {
		return adapter.readFile(path);
	},
	write(content, expected) {
		return expected === undefined ? adapter.writeFile(path, content) : adapter.writeFile(path, content, expected);
	},
	remove() {
		return adapter.deleteEntry(path);
	},
});

class FileHandlerService {
	private listeners: LaunchListener[] = [];
	private pending: LaunchedFile[] = [];
	private baselines = new Map<string, SyncBaseline>();
	private diskContents = new Map<string, { path: string; content: string | ArrayBuffer | null }>();
	private permissionPendingProjectId: string | null = null;
	private permissionPendingContents = new Map<string, { path: string; content: string | ArrayBuffer | null }>();
	private suppressed = new Set<string>();
	private linkedIds = new Set<string>();
	private launchLinkedIds = new Set<string>();
	private workspace: DirectoryTarget | null = null;
	private workspaceProjectId: string | null = null;
	private targetGeneration = 0;
	private writeSequence = 0;
	private writeQueue: Promise<void> = Promise.resolve();
	private writeEntries = new Map<string, DiskWriteEntry>();
	private writeStatusCache: DiskWriteStatus | null = null;
	private writeListeners = new Set<(report: DiskWriteReport) => void>();
	private writeStatusListeners = new Set<(status: DiskWriteStatus) => void>();
	private isMirroringSuppressed = false;
	private isInitialized = false;

	isSupported(): boolean {
		return typeof window !== 'undefined' && 'launchQueue' in window;
	}

	attachWorkspace(adapter: DirectoryTarget, projectId = fileStoreService.getCurrentProjectId()): void {
		this.workspace = adapter;
		this.workspaceProjectId = projectId || null;
		this.diskContents.clear();
		if (this.permissionPendingProjectId === this.workspaceProjectId) {
			this.diskContents = this.permissionPendingContents;
		}
		this.permissionPendingProjectId = null;
		this.permissionPendingContents = new Map();
		this.resetWriteStatus();
	}

	/** Retain the first browser version edited while folder permission is absent. */
	markWorkspacePermissionPending(projectId: string): void {
		if (this.permissionPendingProjectId === projectId) return;
		this.permissionPendingProjectId = projectId;
		this.permissionPendingContents.clear();
	}

	hasWorkspacePermissionPending(projectId: string): boolean {
		return this.permissionPendingProjectId === projectId;
	}

	async restorePermissionPendingOriginals(projectId: string): Promise<void> {
		const records = await fileStoreService.getLocalWriteBaselines(projectId);
		if (records.length === 0) return;
		this.permissionPendingProjectId = projectId;
		this.permissionPendingContents = new Map(
			records.map((record) => [
				record.fileId,
				{
					path: record.path,
					content:
						record.content instanceof ArrayBuffer
							? record.content.slice(0)
							: record.content,
				},
			]),
		);
	}

	rememberPermissionPendingOriginal(file: Pick<FileNode, 'id' | 'path'>, content: string | ArrayBuffer | null | undefined): void {
		const intent = getStartupIntent();
		if (intent.mode !== 'local-unbound' || !intent.persistentProfile ||
			this.permissionPendingProjectId !== fileStoreService.getCurrentProjectId() ||
			this.permissionPendingContents.has(file.id) || content === undefined) return;
		this.permissionPendingContents.set(file.id, {
			path: file.path,
			content: content === null ? null : copyLocalWriteContent(content),
		});
	}

	detachWorkspace(): void {
		this.workspace = null;
		this.workspaceProjectId = null;
		this.resetWriteStatus();
		this.baselines.clear();
		this.diskContents.clear();
		this.permissionPendingProjectId = null;
		this.permissionPendingContents.clear();
		this.linkedIds.clear();
		this.launchLinkedIds.clear();
	}

	hasWorkspace(): boolean {
		return this.workspace !== null;
	}

	registerLink(fileId: string): void {
		this.linkedIds.add(fileId);
	}

	registerLaunchLink(fileId: string): void {
		this.linkedIds.add(fileId);
		this.launchLinkedIds.add(fileId);
	}

	setLaunchLinks(fileIds: string[]): void {
		this.launchLinkedIds = new Set(fileIds);
	}

	getLaunchLinkedIds(): string[] {
		return [...this.launchLinkedIds];
	}

	unregisterLink(fileId: string): void {
		this.linkedIds.delete(fileId);
		this.launchLinkedIds.delete(fileId);
		this.baselines.delete(fileId);
		this.diskContents.delete(fileId);
	}

	/** A directory import or explicit conflict choice has observed these disk bytes. */
	rememberDiskContent(file: Pick<FileNode, 'id' | 'path' | 'lastModified'>, content: string | ArrayBuffer | null): void {
		if (!this.workspace) return;
		this.diskContents.set(file.id, { path: file.path, content: content === null ? null : copyLocalWriteContent(content) });
		this.rememberDiskMetadata(file);
	}

	rememberDiskMetadata(file: Pick<FileNode, 'id' | 'lastModified'>): void {
		if (this.workspace) this.baselines.set(file.id, { disk: file.lastModified, local: file.lastModified });
	}

	resetLinks(fileIds: string[]): void {
		this.linkedIds = new Set(fileIds);
	}

	getLinkedIds(): string[] {
		return [...this.linkedIds];
	}

	isLinked(file: FileNode): boolean {
		return this.resolveTarget(file) !== null;
	}

	initialize(): void {
		if (this.isInitialized || !this.isSupported()) return;
		this.isInitialized = true;

		window.launchQueue?.setConsumer((params) => {
			void this.consume(params);
		});
	}

	addLaunchListener(listener: LaunchListener): () => void {
		this.listeners.push(listener);

		if (this.pending.length > 0) {
			const buffered = this.pending;
			this.pending = [];
			listener(buffered);
		}

		return () => {
			this.listeners = this.listeners.filter((l) => l !== listener);
		};
	}

	async ensureWritable(handle: FileSystemFileHandle): Promise<boolean> {
		return ensurePermission(handle, 'readwrite');
	}

	async mergeWithView(
		file: FileNode,
		incoming: string,
	): Promise<string | null> {
		const local = decodeText(file.content) ?? '';
		const localStripped = stripAnnotationTagsWithSpans(local);
		const incomingStripped = stripAnnotationTagsWithSpans(incoming);

		const resolutions = await mergeResolutionService.resolveConflicts(
			[
				{
					path: file.path,
					isBinary: isBinaryFile(file.path),
					baseContent: undefined,
					localContent: incoming,
					remoteContent: local,
					localViewContent: incomingStripped.content,
					remoteViewContent: localStripped.content,
					localAnnotationSpans: incomingStripped.spans,
					annotationSpans: localStripped.spans,
				},
			],
			{ keepLocal: t('Keep Folder'), keepRemote: t('Keep TeXlyre') },
		);

		const resolution = resolutions?.get(file.path);
		if (!resolution || resolution.action === 'keep-remote') return null;

		return resolution.action === 'merged' &&
			typeof resolution.content === 'string'
			? resolution.content
			: incoming;
	}

	async writeBack(
		file: FileNode,
		content: string | ArrayBuffer,
	): Promise<boolean> {
		return (await this.writeBackResult(file, content)).outcome === 'written';
	}

	async writeBackResult(file: FileNode, content: string | ArrayBuffer): Promise<DiskWriteEntry> {
		const original = file.content === undefined ? undefined : new Map([[file.id, copyLocalWriteContent(file.content)]]);
		const report = await this.mirrorFiles([{ ...file, content }], original);
		return report.entries[0];
	}

	getWriteStatus(): DiskWriteStatus {
		const projectId = this.workspaceProjectId ?? this.getActiveProjectId();
		if (this.writeStatusCache?.projectId === projectId && this.writeStatusCache.targetGeneration === this.targetGeneration) return this.writeStatusCache;
		this.writeStatusCache = Object.freeze({
			projectId,
			targetGeneration: this.targetGeneration,
			entries: Object.freeze([...this.writeEntries.values()]),
		});
		return this.writeStatusCache;
	}

	addWriteListener(listener: (report: DiskWriteReport) => void): () => void {
		this.writeListeners.add(listener);
		return () => { this.writeListeners.delete(listener); };
	}

	addWriteStatusListener(listener: (status: DiskWriteStatus) => void): () => void {
		this.writeStatusListeners.add(listener);
		return () => { this.writeStatusListeners.delete(listener); };
	}

	async pullIfChanged(
		file: FileNode,
		apply: (content: string | ArrayBuffer) => Promise<void>,
		options: PullOptions = {},
	): Promise<DiskPullResult> {
		const target = this.resolveTarget(file);
		if (!target) return 'unavailable';

		try {
			const lastModified = options.knownModified ?? (await target.stat());
			if (lastModified === null) return 'unavailable';

			const baseline = this.baselines.get(file.id) ?? {
				disk: lastModified,
				local: file.lastModified,
			};

			if (lastModified <= baseline.disk) {
				this.baselines.set(file.id, baseline);
				return 'unchanged';
			}
			if (file.lastModified > baseline.local) return 'conflict';

			const isBinary = Boolean(file.isBinary);
			const incoming = await target.read(isBinary);
			let content = incoming;
			let merged = false;
			const localText = isBinary ? null : decodeText(file.content);

			if (
				this.shouldCleanTarget(file) &&
				typeof incoming === 'string' &&
				localText !== null &&
				(hasAnnotations(localText) || hasAnnotations(incoming))
			) {
				const result = mergeAnnotatedSources([localText, incoming], incoming);
				merged = true;

				if (result.dropped > 0 && options.promptOnAnnotationLoss) {
					const reviewed = await this.mergeWithView(file, incoming);
					if (reviewed === null) return 'conflict';
					content = reviewed;
				} else {
					content = result.content;
					if (result.dropped > 0) {
						options.onAnnotationsDropped?.(result.dropped);
					}
				}
			}

			this.suppressed.add(file.id);
			try {
				await apply(content);
			} finally {
				this.suppressed.delete(file.id);
			}

			if (merged && this.workspace) this.rememberDiskContent(file, incoming);
			this.baselines.set(file.id, { disk: lastModified, local: Date.now() });

			if (merged) {
				await this.writeBack({ ...file, lastModified: Date.now() }, content);
				return 'merged';
			}

			return 'applied';
		} catch (error) {
			moduleLog.error(`Failed to read ${file.path} from disk:`, error);
			return 'unavailable';
		}
	}

	async syncFromDisk(
		files: FileNode[],
		apply: (file: FileNode, content: string | ArrayBuffer) => Promise<void>,
		knownModified?: Map<string, number>,
	): Promise<DiskSyncSummary> {
		const summary: DiskSyncSummary = {
			applied: [],
			merged: [],
			conflicted: [],
			droppedAnnotations: 0,
			appliedPaths: [],
			mergedPaths: [],
			conflictedPaths: [],
			annotationDrops: [],
		};

		for (const file of files) {
			const result = await this.pullIfChanged(
				file,
				(content) => apply(file, content),
				{
					knownModified: knownModified?.get(file.path),
					promptOnAnnotationLoss: true,
					onAnnotationsDropped: (count) => {
						summary.droppedAnnotations += count;
						summary.annotationDrops?.push({ path: file.path, count });
					},
				},
			);

			if (result === 'applied') {
				summary.applied.push(file.name);
				summary.appliedPaths?.push(file.path);
			} else if (result === 'merged') {
				summary.merged.push(file.name);
				summary.mergedPaths?.push(file.path);
			} else if (result === 'conflict') {
				summary.conflicted.push(file.name);
				summary.conflictedPaths?.push(file.path);
			} else if (result === 'unavailable' && !this.workspace) {
				this.unregisterLink(file.id);
			}
		}

		return summary;
	}

	async mirrorFiles(files: FileNode[], originalContents?: ReadonlyMap<string, string | ArrayBuffer | null>): Promise<DiskWriteReport> {
		const sequence = ++this.writeSequence;
		const generation = this.targetGeneration;
		const storeProjectId = this.getActiveProjectId();
		const projectId = storeProjectId || this.workspaceProjectId;
		const adapter = this.workspace;
		const pathCounts = new Map<string, number>();
		for (const file of files) pathCounts.set(file.path, (pathCounts.get(file.path) ?? 0) + 1);
		// Capture every path, target and byte buffer before the first await.
		const jobs = files.map((source) => {
			const file = { ...source, content: source.content === undefined ? undefined : copyLocalWriteContent(source.content) };
			const entry = { fileId: file.id, path: file.path, type: file.type, lastModified: file.lastModified, sequence };
			const pathIssue = getLocalWritePathIssue(file.path);
			let reason: DiskWriteReason | undefined = pathIssue ?? undefined;
			if (!reason && (pathCounts.get(file.path) ?? 0) > 1) reason = 'duplicate-path';
			if (!reason && adapter && storeProjectId && this.workspaceProjectId !== storeProjectId) reason = 'target-changed';
			if (!reason && file.isDeleted) reason = 'deleted';
			if (!reason && (this.isMirroringSuppressed || this.suppressed.has(file.id))) reason = 'suppressed';
			const target = !reason && file.type === 'file' ? this.resolveTarget(file) : null;
			if (!reason && !(file.type === 'directory' ? adapter : target)) reason = 'not-linked';
			if (!reason && file.type === 'file' && file.content === undefined) reason = 'missing-content';
			const content = file.content === undefined ? undefined : this.shouldCleanTarget(file)
				? stripAnnotations(file.content) : file.content;
			const outcome = reason === 'invalid-path' || reason === 'duplicate-path' || reason === 'target-changed' || reason === 'missing-content' ? 'failed' : reason ? 'skipped' : 'writing';
			const initial: DiskWriteEntry = Object.freeze({ ...entry, outcome, ...(reason ? { reason } : {}) });
			const original = originalContents?.get(file.id);
			const expectedOriginal = original === undefined ? undefined : original === null ? null :
				this.shouldCleanTarget(file) ? stripAnnotations(original) : original;
			return { file, entry, target, content, original: expectedOriginal === undefined ? undefined : expectedOriginal === null ? null : copyLocalWriteContent(expectedOriginal), initial };
		});
		for (const job of jobs) this.recordWriteEntry(job.initial, generation, projectId);
		this.notifyWriteStatus();

		const action = async (): Promise<DiskWriteReport> => {
			const entries: DiskWriteEntry[] = [];
			for (const job of jobs) {
				let result = job.initial;
				if (result.outcome === 'writing') {
					const activeProjectId = this.getActiveProjectId();
					if (generation !== this.targetGeneration || projectId !== (this.workspaceProjectId ?? activeProjectId) || (activeProjectId && activeProjectId !== projectId)) {
						result = Object.freeze({ ...job.entry, outcome: 'failed', reason: 'target-changed' });
					} else {
						try {
							if (job.file.type === 'directory' && adapter) {
								await adapter.createDirectory(job.file.path);
							} else if (job.target && job.content !== undefined) {
								const intent = getStartupIntent();
								const persistentLocal = intent.mode === 'local-unbound' && intent.persistentProfile;
								const remembered = this.diskContents.get(job.file.id);
								const expected = persistentLocal
									? remembered?.path === job.file.path ? remembered.content : job.original ?? null
									: undefined;
								await job.target.write(job.content, expected);
								// Metadata failure after close is not a failed write, nor a verified baseline.
								let disk: number | null = null;
								let baselineError: unknown;
								try { disk = await job.target.stat(); } catch (error) { baselineError = error; }
								if (generation === this.targetGeneration && (!this.getActiveProjectId() || this.getActiveProjectId() === projectId)) {
									if (adapter) this.diskContents.set(job.file.id, { path: job.file.path, content: copyLocalWriteContent(job.content) });
									if (disk !== null) this.baselines.set(job.file.id, { disk, local: job.file.lastModified });
									this.linkedIds.add(job.file.id);
								}
								result = Object.freeze({ ...job.entry, outcome: 'written', baselineAvailable: disk !== null, ...(baselineError ? { baselineError } : {}) });
							}
							if (job.file.type === 'directory') result = Object.freeze({ ...job.entry, outcome: 'written' });
						} catch (error) {
							result = Object.freeze({ ...job.entry, outcome: 'failed', reason: error instanceof LocalDiskChangedError ? 'disk-changed' : 'write-failed', error });
							moduleLog.error('Disk write failed; the operation result retains the cause');
						}
						this.recordWriteEntry(result, generation, projectId);
						this.notifyWriteStatus();
					}
				}
				entries.push(result);
			}
			const report: DiskWriteReport = Object.freeze({ projectId, targetGeneration: generation, sequence, entries: Object.freeze(entries) });
			for (const listener of this.writeListeners) {
				try { listener(report); } catch { moduleLog.warn('Disk write observer failed'); }
			}
			return report;
		};
		const pending = this.writeQueue.then(action, action);
		this.writeQueue = pending.then(() => undefined, () => undefined);
		return pending;
	}

	private recordWriteEntry(entry: DiskWriteEntry, generation: number, projectId: string | null): void {
		if (generation !== this.targetGeneration || projectId !== (this.workspaceProjectId ?? this.getActiveProjectId())) return;
		if (entry.outcome === 'skipped') return;
		const previous = this.writeEntries.get(entry.path);
		// An older completion must not clear the dirty/pending state of newer input.
		if (!previous || previous.sequence <= entry.sequence) {
			this.writeEntries.set(entry.path, entry);
			this.writeStatusCache = null;
		}
	}

	private getActiveProjectId(): string | null {
		// FileStore uses an empty string before initialization; scope reports use null.
		return fileStoreService.getCurrentProjectId() || null;
	}

	private resetWriteStatus(): void {
		this.targetGeneration++;
		this.writeEntries.clear();
		this.writeStatusCache = null;
		this.notifyWriteStatus();
	}

	private notifyWriteStatus(): void {
		const status = this.getWriteStatus();
		for (const listener of this.writeStatusListeners) {
			try { listener(status); } catch { moduleLog.warn('Disk write status observer failed'); }
		}
	}

	async removeFromDisk(files: FileNode[]): Promise<void> {
		if (this.isMirroringSuppressed) return;
		const generation = this.targetGeneration;
		const projectId = this.getActiveProjectId() || this.workspaceProjectId;
		// Bind paths and targets before awaiting; a later folder switch must not
		// redirect an already requested removal into a different directory.
		const jobs = files.map((file) => ({
			id: file.id,
			path: file.path,
			target: this.resolveTarget(file),
		})).sort((left, right) => right.path.split('/').length - left.path.split('/').length);
		const failures: Error[] = [];

		for (const job of jobs) {
			if (!job.target?.remove) continue;
			const activeProjectId = this.getActiveProjectId();
			if (generation !== this.targetGeneration ||
				projectId !== (this.workspaceProjectId ?? activeProjectId) ||
				(activeProjectId && activeProjectId !== projectId)) {
				failures.push(new Error(t('Folder or project changed before removing {path}', { path: job.path })));
				continue;
			}

			try {
				await job.target.remove();
			} catch (error) {
				if (!(error instanceof DOMException && error.name === 'NotFoundError')) {
					failures.push(new Error(t('Could not remove {path} from the folder', { path: job.path }), { cause: error }));
					continue;
				}
			}
			if (generation !== this.targetGeneration) {
				failures.push(new Error(t('Folder changed while removing {path}. The browser copy has been retained.', { path: job.path })));
				continue;
			}
			if (generation === this.targetGeneration &&
				(!this.getActiveProjectId() || this.getActiveProjectId() === projectId)) {
				this.unregisterLink(job.id);
			}
		}
		if (failures.length > 0) {
			throw new AggregateError(failures, t('Deletion could not be completed safely. Some disk entries may already have been removed; browser copies have been retained.'));
		}
	}

	async withoutMirroring<T>(action: () => Promise<T>): Promise<T> {
		this.isMirroringSuppressed = true;
		try {
			return await action();
		} finally {
			this.isMirroringSuppressed = false;
		}
	}

	getWorkspaceCleanAnnotations(
		projectId = fileStoreService.getCurrentProjectId(),
	): boolean {
		const intent = getStartupIntent();
		const defaultClean = !(intent.mode === 'local-unbound' && intent.persistentProfile);
		if (!projectId || typeof localStorage === 'undefined') return defaultClean;
		const preference = localStorage.getItem(`${WORKSPACE_CLEAN_PREFIX}${projectId}`);
		return preference === 'true' || (preference !== 'false' && defaultClean);
	}

	setWorkspaceCleanAnnotations(projectId: string, clean: boolean): void {
		if (typeof localStorage !== 'undefined') {
			localStorage.setItem(
				`${WORKSPACE_CLEAN_PREFIX}${projectId}`,
				String(clean),
			);
			document.dispatchEvent(new Event('workspace-annotation-preference-changed'));
		}
	}

	private shouldCleanTarget(file: FileNode): boolean {
		if (file.launchHandle || !this.workspace) {
			const intent = getStartupIntent();
			return !(intent.mode === 'local-unbound' && intent.persistentProfile);
		}
		return this.getWorkspaceCleanAnnotations();
	}

	shouldMirror(file: FileNode): boolean {
		if (file.type !== 'file' || file.content === undefined) return false;
		if (file.isDeleted) return false;
		if (getLocalWritePathIssue(file.path)) return false;
		if (this.workspace) return true;
		return Boolean(file.launchHandle);
	}

	private resolveTarget(file: FileNode): DiskTarget | null {
		if (getLocalWritePathIssue(file.path)) return null;
		if (file.launchHandle) return handleTarget(file.launchHandle);
		if (this.workspace) {
			return workspaceTarget(this.workspace, file.path);
		}
		return null;
	}

	private async consume(params: LaunchParams): Promise<void> {
		const launched: LaunchedFile[] = [];

		for (const handle of params.files ?? []) {
			try {
				const file = await handle.getFile();
				launched.push({
					name: file.name,
					type: file.type,
					buffer: await file.arrayBuffer(),
					handle,
				});
			} catch (error) {
				moduleLog.error(`Failed to read launched file ${handle.name}:`, error);
			}
		}

		if (launched.length === 0) return;

		if (this.listeners.length === 0) {
			this.pending = launched;
			return;
		}

		for (const listener of this.listeners) {
			listener(launched);
		}
	}
}

export const fileHandlerService = new FileHandlerService();
