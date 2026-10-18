import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

import type { GitRemoteConfig } from '../types/gitRemote';

const LEGACY_PREFIX = 'texlyre-git-remote:';

interface RemoteDatabase extends DBSchema {
	remotes: { key: string; value: GitRemoteConfig | null };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);

function isRemoteConfig(value: unknown): value is GitRemoteConfig {
	if (!isRecord(value)) return false;
	if (!['providerId', 'repositoryId', 'repositoryLabel', 'branch'].every(
		key => typeof value[key] === 'string' && value[key] !== '',
	)) return false;
	if (!['history', 'backup-project', 'backup-global'].includes(String(value.credentialSource))) return false;
	if (value.providerName !== undefined && typeof value.providerName !== 'string') return false;
	for (const flag of ['managed', 'readOnly']) {
		if (value[flag] !== undefined && typeof value[flag] !== 'boolean') return false;
	}
	if (value.syncBase !== undefined && (!isRecord(value.syncBase) ||
		typeof value.syncBase.localOid !== 'string' || typeof value.syncBase.remoteOid !== 'string')) return false;
	if (value.apiConfiguration !== undefined && (!isRecord(value.apiConfiguration) ||
		typeof value.apiConfiguration.endpoint !== 'string' ||
		typeof value.apiConfiguration.requestTimeout !== 'number')) return false;
	if (value.credentialRef !== undefined && (!isRecord(value.credentialRef) ||
		typeof value.credentialRef.pluginId !== 'string' || typeof value.credentialRef.secretKey !== 'string' ||
		!['project', 'global'].includes(String(value.credentialRef.scope)))) return false;
	return true;
}

function legacyConfig(projectId: string): GitRemoteConfig | undefined {
	try {
		const raw = localStorage.getItem(`${LEGACY_PREFIX}${projectId}`);
		if (!raw) return undefined;
		const value: unknown = JSON.parse(raw);
		return isRemoteConfig(value) ? value : undefined;
	} catch {
		// Legacy Web Storage may be disabled. It is never the durable write path.
		return undefined;
	}
}

export class GitRemoteConfigStore {
	private readonly cache = new Map<string, GitRemoteConfig | undefined>();
	private database: Promise<IDBPDatabase<RemoteDatabase>> | undefined;
	private tail: Promise<void> = Promise.resolve();

	constructor(private readonly databaseName = 'texlyre-git-remotes') {}

	private db(): Promise<IDBPDatabase<RemoteDatabase>> {
		this.database ??= openDB<RemoteDatabase>(this.databaseName, 1, {
			upgrade(db) { db.createObjectStore('remotes'); },
		});
		return this.database;
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const result = this.tail.then(operation);
		// The initiating caller receives the rejection; later writes can retry.
		this.tail = result.then(() => undefined, () => undefined);
		return result;
	}

	getCached(projectId: string): GitRemoteConfig | undefined {
		const config = this.cache.has(projectId)
			? this.cache.get(projectId) : legacyConfig(projectId);
		return config ? structuredClone(config) : undefined;
	}

	load(projectId: string): Promise<GitRemoteConfig | undefined> {
		return this.enqueue(async () => {
			const db = await this.db();
			const persisted = await db.get('remotes', projectId);
			const config = persisted === undefined ? legacyConfig(projectId) : persisted ?? undefined;
			if (config && persisted === undefined) await db.put('remotes', config, projectId);
			this.cache.set(projectId, config);
			return config ? structuredClone(config) : undefined;
		});
	}

	save(projectId: string, config: GitRemoteConfig | undefined): Promise<void> {
		return this.enqueue(async () => {
			const db = await this.db();
			const tx = db.transaction('remotes', 'readwrite');
			// A durable disconnect must not resurrect a read-only legacy record.
			await Promise.all([tx.store.put(config ?? null, projectId), tx.done]);
			this.cache.set(projectId, config ? structuredClone(config) : undefined);
		});
	}
}
