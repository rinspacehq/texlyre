// SPDX-License-Identifier: AGPL-3.0-or-later
import { deleteDB, unwrap } from 'idb';
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
	it('refuses a managed intent instead of creating a local owner', async () => {
		window.history.replaceState(null, '', '/?mode=managed&type=article&id=123');
		await expect(service.initialize()).rejects.toThrow('workspace mode');
		expect(service.getCurrentUser()).toBeNull();
		expect(localStorage.getItem('texlyre-current-user')).toBeNull();
	});
	it('does not resume automatic backup from restored settings', async () => {
		await service.initialize();
		localStorage.setItem('texlyre-auto-sync', 'true');
		await service.createProject({ name: 'Synthetic local', description: '', type: 'latex',
			docUrl: 'yjs:synthetic-local', tags: [], isFavorite: false });
		expect(diskBackupService.synchronize).not.toHaveBeenCalled();
	});
	it.each(['latex', 'typst', 'markdown'] as const)('persists a selected local %s entry in the project row and reopened Yjs metadata', async (type) => {
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
