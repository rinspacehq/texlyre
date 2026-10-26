// SPDX-License-Identifier: AGPL-3.0-or-later
import type { GitRemoteProvider } from '../types/gitRemote';

/** Generic extension contracts. Product wire schemas are versioned separately. */
export interface WorkspaceBinding {
	readonly repositoryId: string;
	/** Stable display coordinate; servers must still re-resolve it for access. */
	readonly repositoryFullName?: string;
	readonly branchBindingId: string;
	readonly ref: string;
	readonly workspaceId: string;
	readonly generation: number;
	readonly baseCommit: string;
	readonly objectFormat: 'sha1' | 'sha256';
}

export interface HostIdentity {
	readonly actorId: string;
	readonly permissionEpoch: string;
}

export type WorkspaceCapability = 'read-source' | 'read-draft' | 'write-source' | 'review' | 'push' | 'manage';

export type HostContext =
	| { readonly mode: 'local-unbound' }
	| {
		readonly mode: 'managed';
		readonly identity: HostIdentity;
		readonly binding: WorkspaceBinding;
		readonly capabilities: readonly WorkspaceCapability[];
	};

export interface HostAdapter {
	open(intent: Readonly<Record<string, string>>, signal: AbortSignal): Promise<HostContext>;
	getCurrentContext?(): HostContext | null;
	onContextInvalidated(listener: () => void): () => void;
}

export interface WorkspaceCatalogProject {
	readonly id: string;
	readonly name: string;
	readonly description: string;
	readonly repositoryLabel: string;
	readonly contentType: string;
	readonly defaultRef: string;
	readonly updatedAt?: number;
	readonly private: boolean;
	readonly access: 'owner' | 'collaborator';
	readonly openIntent: Readonly<Record<string, string>>;
}

export type WorkspaceCatalogPage =
	| { readonly status: 'anonymous'; readonly projects: readonly [] }
	| {
		readonly status: 'authenticated';
		readonly accountLabel: string;
		readonly projects: readonly WorkspaceCatalogProject[];
		readonly page: number;
		readonly hasMore: boolean;
		readonly nextCursor?: string;
	};

/** Optional remote metadata listing. Opening still goes through HostAdapter. */
export interface WorkspaceAccountIdentity {
	readonly actorId: string;
	readonly displayName: string;
	readonly avatarUrl?: string;
}

export interface WorkspaceProjectCatalog {
	isEnabled(): boolean;
	/** Presentation only; never changes local ownership or supplies credentials. */
	getAccount?(signal: AbortSignal): Promise<WorkspaceAccountIdentity | null>;
	subscribe(listener: () => void): () => void;
	listPage(
		request: { readonly page: number; readonly pageSize: number; readonly query?: string; readonly cursor?: string },
		signal: AbortSignal,
	): Promise<WorkspaceCatalogPage>;
}

export interface GitHttpRequest {
	readonly url: string;
	readonly method: 'GET' | 'POST';
	readonly headers: Readonly<Record<string, string>>;
	readonly body?: AsyncIterable<Uint8Array>;
	readonly signal: AbortSignal;
}

export interface GitHttpResponse {
	readonly url: string;
	readonly statusCode: number;
	readonly statusMessage: string;
	readonly headers: Readonly<Record<string, string>>;
	readonly body: AsyncIterable<Uint8Array>;
}

/** Native credentials remain in the requester's memory; no secret-key fields. */
export type GitTransport =
	| { readonly kind: 'api-history'; readonly provider: GitRemoteProvider }
	| {
		readonly kind: 'native-http';
		readonly binding: WorkspaceBinding;
		request(input: GitHttpRequest): Promise<GitHttpResponse>;
	};

export interface CollaborationSession {
	readonly binding: WorkspaceBinding;
	readonly role: 'reader' | 'reviewer' | 'writer';
	resolveDocument(fileId: string): string;
	sendUpdate(documentId: string, bytes: Uint8Array, signal: AbortSignal): Promise<void>;
	close(): Promise<void>;
}

export interface CollaborationAdapter {
	join(context: Extract<HostContext, { mode: 'managed' }>, signal: AbortSignal): Promise<CollaborationSession>;
}

export type SnapshotClock =
	| { readonly kind: 'local'; readonly revision: number }
	| { readonly kind: 'checkpoint'; readonly cutSeq: number };

export interface SnapshotFile {
	readonly path: string;
	readonly mode: '100644' | '100755' | '120000';
	readonly byteLength: number;
	readonly sha256: string;
}

export interface SourceSnapshot {
	readonly id: string;
	readonly binding: WorkspaceBinding | null;
	readonly clock: SnapshotClock;
	readonly projectionVersion: string;
	readonly files: readonly SnapshotFile[];
	/** Always a defensive copy, never a mutable view onto captured bytes. */
	readFile(path: string): Uint8Array;
}

export interface SourceSnapshotProvider {
	capture(context: HostContext, signal: AbortSignal): Promise<SourceSnapshot>;
}

export interface LocalDurableAck {
	readonly kind: 'local';
	readonly snapshotId: string;
	readonly revision: number;
}

export interface RemoteDurableAck {
	readonly kind: 'remote';
	readonly snapshotId: string;
	readonly workspaceId: string;
	readonly generation: number;
	readonly cutSeq: number;
	readonly sha256: string;
}

export interface RecoveryAdapter {
	saveLocal(snapshot: SourceSnapshot, signal: AbortSignal): Promise<LocalDurableAck>;
	saveRemote(snapshot: SourceSnapshot, signal: AbortSignal): Promise<RemoteDurableAck>;
	exportRecovery(context: HostContext, signal: AbortSignal): Promise<Blob>;
	importRecovery(bytes: Blob, context: HostContext, signal: AbortSignal): Promise<void>;
}

export type WorkspaceOperation =
	| { readonly state: 'pending' | 'unknown'; readonly operationId: string }
	| { readonly state: 'succeeded'; readonly operationId: string; readonly commit?: string }
	| { readonly state: 'failed'; readonly operationId: string; readonly code: string };

export interface WorkspaceAction {
	readonly id: string;
	readonly label: string;
	readonly requires: readonly WorkspaceCapability[];
	invoke(context: HostContext, signal: AbortSignal): Promise<WorkspaceOperation>;
}

export interface WorkspaceActions {
	list(context: HostContext): readonly WorkspaceAction[];
	query(operationId: string, context: HostContext, signal: AbortSignal): Promise<WorkspaceOperation>;
}

export interface AssetPwaConfiguration {
	readonly basePath: string;
	readonly cachePrefix: string;
	readonly manifestSha256: string;
	readonly assets: readonly {
		readonly path: string;
		readonly sha256: string;
		readonly byteLength: number;
		readonly license: string;
	}[];
	canActivateUpdate(): Promise<boolean>;
}

export interface WorkspaceExtensions {
	/** Optional host UI preference; unrelated to identity, projects or layout. */
	readonly theme?: {
		getPreference(): 'light' | 'dark' | 'system' | undefined;
		setPreference(preference: 'light' | 'dark' | 'system'): void;
		subscribe(listener: () => void): () => void;
	};
	/** Optional UI preference only; never supplies identity or credentials. */
	readonly locale?: {
		getLanguage(browserLanguages: readonly string[]): string | undefined;
		subscribe(listener: () => void): () => void;
	};
	readonly host?: HostAdapter;
	readonly catalog?: WorkspaceProjectCatalog;
	readonly git?: GitTransport;
	readonly collaboration?: CollaborationAdapter;
	readonly snapshots?: SourceSnapshotProvider;
	readonly recovery?: RecoveryAdapter;
	readonly actions?: WorkspaceActions;
	readonly assets?: AssetPwaConfiguration;
}

export interface WorkspaceExtensionPlugin {
	readonly id: string;
	readonly name: string;
	readonly version: string;
	readonly type: 'workspace';
	readonly contractVersion: 1;
	readonly extensions: WorkspaceExtensions;
}
