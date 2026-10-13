// SPDX-License-Identifier: AGPL-3.0-or-later
import { deleteDB, unwrap } from 'idb';
import { webcrypto } from 'node:crypto';
import { deserialize, serialize } from 'node:v8';
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { AuthService } from '@src/services/AuthService';
import type { User } from '@src/types/auth';
import type { Project } from '@src/types/projects';
import { cleanupProjectDatabases } from '@src/utils/dbDeleteUtils';
import { diskBackupService } from '@src/services/DiskBackupService';

jest.mock('@src/i18n', () => ({ t: (key: string) => key }));
jest.mock('@src/services/DiskBackupService', () => ({ diskBackupService: { synchronize: jest.fn() } }));
jest.mock('@src/utils/dbDeleteUtils', () => ({ cleanupProjectDatabases: jest.fn() }));

const guest = (id: string, expiresAt: number): User => ({
	id, username: 'Guest User', passwordHash: 'old-hash', createdAt: 1,
	isGuest: true, sessionId: `guest-session-${id}`, expiresAt,
});
const project: Project = {
	id: 'synthetic-project', ownerId: 'guest-owner', name: '中文项目', description: '',
	type: 'latex', docUrl: 'yjs:synthetic-project', createdAt: 1, updatedAt: 2, tags: [], isFavorite: false,
};

describe('persistent browser-local profile', () => {
	let service: AuthService;
	let peers: AuthService[];
	beforeEach(async () => {
		localStorage.clear();
		window.history.replaceState(null, '', '/');
		await deleteDB('texlyre-auth');
		service = new AuthService();
		peers = [];
		jest.clearAllMocks();
		jest.mocked(global.crypto.subtle.digest).mockImplementation(
			webcrypto.subtle.digest.bind(webcrypto.subtle),
		);
	});
	afterEach(async () => {
		service.db?.close();
		for (const peer of peers) peer.db?.close();
		jest.restoreAllMocks();
		await deleteDB('texlyre-auth');
	});
	const seed = async (users: User[]) => {
		await service.initialize({ persistentLocalProfile: false });
		for (const user of users) await service.db?.put('users', user);
	};

	it('starts without login or password hashing and restores the same profile after 48 hours', async () => {
		const hash = jest.spyOn(service, 'hashPassword');
		await service.initialize();
		const first = service.getCurrentUser();
		expect(first?.isLocalProfile).toBe(true);
		expect(first?.expiresAt).toBeUndefined();
		expect(first?.sessionId).toBeUndefined();
		expect(hash).not.toHaveBeenCalled();
		jest.spyOn(Date, 'now').mockReturnValue(Date.now() + 48 * 60 * 60 * 1000);
		const reload = new AuthService(); peers.push(reload);
		await reload.initialize();
		expect(reload.getCurrentUser()).toEqual(first);
	});
	it('preserves expired and active guest ownership before any destructive cleanup', async () => {
		await seed([guest('guest-owner', 2), guest('guest-other', Date.now() + 86400000)]);
		await service.db?.put('projects', project);
		localStorage.setItem('texlyre-current-user', 'guest-owner');
		localStorage.setItem('texlyre-user-guest-owner-settings', '{"language":"zh"}');
		await service.initialize({ persistentLocalProfile: true });
		await service.cleanupExpiredGuests();
		await service.cleanupExpiredGuest(guest('guest-owner', 2));
		expect(cleanupProjectDatabases).not.toHaveBeenCalled();
		expect(await service.db?.get('projects', project.id)).toEqual(project);
		expect(service.getCurrentUser()?.id).toBe('guest-owner');
		expect(localStorage.getItem('texlyre-user-guest-owner-settings')).toBe('{"language":"zh"}');
		for (const id of ['guest-owner', 'guest-other']) {
			const preserved = await service.db?.get('users', id);
			expect(preserved.isLocalProfile).toBe(true);
			expect(preserved.isGuest).toBeUndefined();
			expect(preserved.expiresAt).toBeUndefined();
		}
	});
	it('keeps the selected non-guest profile byte-for-byte and still protects other guests', async () => {
		const account: User = { id: 'account-owner', username: 'Existing writer', passwordHash: 'hash', createdAt: 1 };
		await seed([account, guest('guest-owner', 2)]);
		localStorage.setItem('texlyre-current-user', account.id);
		await service.initialize({ persistentLocalProfile: true });
		expect(service.getCurrentUser()).toEqual(account);
		expect(await service.db?.get('users', account.id)).toEqual(account);
		expect((await service.db?.get('users', 'guest-owner'))?.isLocalProfile).toBe(true);
	});
	it('serializes concurrent startup without generating duplicate owners', async () => {
		const second = new AuthService(); peers.push(second);
		await Promise.all([service.initialize(), service.initialize(), second.initialize()]);
		expect(await service.db?.count('users')).toBe(1);
		expect(service.getCurrentUser()?.id).toBe(second.getCurrentUser()?.id);
	});
	it('rejects browser-local profiles as password login identities', async () => {
		await service.initialize();
		const user = service.getCurrentUser();
		if (!user) throw new Error('Profile missing');
		await expect(service.login(user.username, '')).rejects.toThrow('User not found');
		expect(await service.verifyPassword(user.id, '')).toBe(false);
	});
	it('retains the profile when the upstream guest action is called in local mode', async () => {
		await service.initialize();
		const user = service.getCurrentUser();
		expect(await service.createGuestAccount()).toEqual(user);
		expect(await service.db?.count('users')).toBe(1);
	});
	it('does not acknowledge or replace the current owner when the migration transaction aborts', async () => {
		await seed([guest('guest-owner', 2)]);
		localStorage.setItem('texlyre-current-user', 'guest-owner');
		const database = service.db;
		if (!database) throw new Error('Database missing');
		// idb wraps methods in a Proxy; spy on the real backing transaction method.
		const rawDatabase = unwrap(database);
		const original = rawDatabase.transaction.bind(rawDatabase);
		jest.spyOn(rawDatabase, 'transaction').mockImplementationOnce((...args) => {
			const tx = original(...args);
			tx.abort();
			return tx;
		});
		await expect(service.initialize({ persistentLocalProfile: true })).rejects.toThrow();
		expect(localStorage.getItem('texlyre-current-user')).toBe('guest-owner');
		expect(cleanupProjectDatabases).not.toHaveBeenCalled();
		expect((await database.get('users', 'guest-owner')).isGuest).toBe(true);
	});
	it('keeps the standalone local owner on a managed deep link', async () => {
		window.history.replaceState(null, '', '/?mode=managed&type=article&id=123');
		await service.initialize({ persistentLocalProfile: true });
		expect(service.getCurrentUser()?.localProfileScope).toBe('standalone');
		expect(localStorage.getItem('texlyre-current-user')).toBe(
			service.getCurrentUser()?.id,
		);
	});
	it('partitions managed projects by verified actor and restores the same actor partition', async () => {
		window.history.replaceState(null, '', '/?mode=managed&owner=a&repository=42');
		await service.initialize({ managedActorId: 'native-actor-a' });
		const actorA = service.getCurrentUser();
		expect(actorA?.localProfileScope).toMatch(/^rinspace:[0-9a-f]{64}$/);
		expect(JSON.stringify(actorA)).not.toContain('native-actor-a');
		await service.createProject({
			name: 'Actor A source', description: '', type: 'files', group: 'files',
			docUrl: 'yjs:actor-a-source', tags: [], isFavorite: false,
		});

		const actorBService = new AuthService(); peers.push(actorBService);
		await actorBService.initialize({ managedActorId: 'native-actor-b' });
		const actorB = actorBService.getCurrentUser();
		expect(actorB?.id).not.toBe(actorA?.id);
		expect(actorB?.username).not.toBe(actorA?.username);
		expect(actorB?.localProfileScope).not.toBe(actorA?.localProfileScope);
		expect(await actorBService.getProjects()).toEqual([]);

		const actorAReload = new AuthService(); peers.push(actorAReload);
		await actorAReload.initialize({ managedActorId: 'native-actor-a' });
		expect(actorAReload.getCurrentUser()?.id).toBe(actorA?.id);
		expect((await actorAReload.getProjects()).map((entry) => entry.id)).toEqual([
			'actor-a-source',
		]);
	});
	it('does not expose a managed account partition on the standalone editor route', async () => {
		window.history.replaceState(null, '', '/?mode=managed&owner=a&repository=42');
		await service.initialize({ managedActorId: 'native-actor-a' });
		const managed = service.getCurrentUser();
		await service.createProject({
			name: 'Managed source', description: '', type: 'files', group: 'files',
			docUrl: 'yjs:managed-source', tags: [], isFavorite: false,
		});

		window.history.replaceState(null, '', '/');
		const standalone = new AuthService(); peers.push(standalone);
		await standalone.initialize();
		expect(standalone.getCurrentUser()?.id).not.toBe(managed?.id);
		expect(standalone.getCurrentUser()?.localProfileScope).toBe('standalone');
		expect(await standalone.getProjects()).toEqual([]);
	});
	it('does not resume automatic backup from restored settings', async () => {
		await service.initialize();
		localStorage.setItem('texlyre-auto-sync', 'true');
		await service.createProject({ name: 'Synthetic local', description: '', type: 'latex',
			docUrl: 'yjs:synthetic-local', tags: [], isFavorite: false });
		expect(diskBackupService.synchronize).not.toHaveBeenCalled();
	});
	it('creates a new local document at a caller-supplied valid workspace identity', async () => {
		await service.initialize();
		const id = '94528bf5-c137-48b7-87af-149fd0d42cdc';
		const created = await service.createProject({
			id, name: 'Managed source', description: '', type: 'files', group: 'files',
			tags: [], isFavorite: false,
		});
		expect(created.id).toBe(id);
		expect(created.docUrl).toBe(`yjs:${id}`);
		await expect(service.createProject({
			id, name: 'Duplicate', description: '', type: 'files', group: 'files',
			tags: [], isFavorite: false,
		})).rejects.toThrow('already exists');
	});
	it.each(['latex', 'typst', 'markdown'] as const)('persists a selected local %s entry in the project row and reopened Yjs metadata', async (type) => {
		// The inherited JSON-only clone drops Uint8Array updates used by y-indexeddb.
		// Use a byte-preserving clone for this real y-indexeddb / fake IDB fixture.
		jest.spyOn(globalThis, 'structuredClone').mockImplementation(<T,>(value: T): T => deserialize(serialize(value)) as T);
		await service.initialize();
		const mainFile = `/章节/正文.${type === 'latex' ? 'tex' : type === 'typst' ? 'typ' : 'md'}`;
		const compilerId = type === 'markdown' ? undefined : `internal:${type}`;
		const created = await service.createProject({
			name: 'Synthetic folder', description: '', type, mainFile, compilerId,
			group: type === 'latex' ? 'tex' : type, tags: [], isFavorite: false,
		});
		expect((await service.getProjectById(created.id))?.mainFile).toBe(mainFile);
		const collection = `texlyre-project-${created.id}-yjs_metadata`;
		const reopened = new Y.Doc();
		const persistence = new IndexeddbPersistence(collection, reopened);
		try {
			await persistence.whenSynced;
			expect(reopened.getMap('data').get('projectMetadata')).toEqual({
				name: 'Synthetic folder', description: '', type, group: type === 'latex' ? 'tex' : type,
				mainFile, ...(compilerId ? { compilerId } : {}),
			});
		} finally {
			await persistence.destroy();
			reopened.destroy();
			await deleteDB(collection);
		}
	});
});
