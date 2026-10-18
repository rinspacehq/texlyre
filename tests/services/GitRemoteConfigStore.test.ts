import type { GitRemoteConfig } from '../../src/types/gitRemote';
import { GitRemoteConfigStore } from '../../src/services/GitRemoteConfigStore';

const legacyKey = 'texlyre-git-remote:project-1';
const config: GitRemoteConfig = {
	providerId: 'test-provider', repositoryId: 'owner/book', repositoryLabel: 'Book',
	branch: 'main', credentialSource: 'history', managed: true, readOnly: false,
	syncBase: { localOid: 'imported-local', remoteOid: 'imported-remote' },
};
let index = 0;
let databaseName: string;
let store: GitRemoteConfigStore;
beforeEach(() => {
	localStorage.clear();
	databaseName = `git-remote-store-test-${++index}`;
	store = new GitRemoteConfigStore(databaseName);
});
afterEach(() => jest.restoreAllMocks());

test('migrates an existing remote durably without deleting the legacy record', async () => {
	localStorage.setItem(legacyKey, JSON.stringify(config));
	expect(store.getCached('project-1')).toEqual(config);
	await expect(store.load('project-1')).resolves.toEqual(config);
	expect(localStorage.getItem(legacyKey)).toBe(JSON.stringify(config));
	localStorage.removeItem(legacyKey);
	await expect(new GitRemoteConfigStore(databaseName).load('project-1')).resolves.toEqual(config);
});

test('saves and restores while all Web Storage writes exceed their quota', async () => {
	localStorage.setItem('draft-to-preserve', 'unsaved draft');
	const writes = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
		throw new DOMException('Web Storage is full', 'QuotaExceededError');
	});
	await expect(store.save('project-1', config)).resolves.toBeUndefined();
	await expect(new GitRemoteConfigStore(databaseName).load('project-1')).resolves.toEqual(config);
	expect(writes).not.toHaveBeenCalled();
	expect(localStorage.getItem('draft-to-preserve')).toBe('unsaved draft');
});

test('a restarted store prefers the pushed sync base over the old import record', async () => {
	localStorage.setItem(legacyKey, JSON.stringify(config));
	await store.load('project-1');
	const advanced = { ...config, syncBase: { localOid: 'pushed-local', remoteOid: 'pushed-remote' } };
	await store.save('project-1', advanced);
	await expect(new GitRemoteConfigStore(databaseName).load('project-1')).resolves.toEqual(advanced);
	expect(localStorage.getItem(legacyKey)).toBe(JSON.stringify(config));
});

test('a durable disconnect cannot resurrect an old localStorage remote', async () => {
	localStorage.setItem(legacyKey, JSON.stringify(config));
	await store.load('project-1');
	await store.save('project-1', undefined);
	expect(store.getCached('project-1')).toBeUndefined();
	await expect(new GitRemoteConfigStore(databaseName).load('project-1')).resolves.toBeUndefined();
	expect(localStorage.getItem(legacyKey)).not.toBeNull();
});

test('a failed IndexedDB write is explicit and leaves the previous baseline intact', async () => {
	await store.save('project-1', config);
	const write = jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
		throw new DOMException('IndexedDB is full', 'QuotaExceededError');
	});
	await expect(store.save('project-1', { ...config, branch: 'other' })).rejects.toThrow('IndexedDB is full');
	expect(store.getCached('project-1')).toEqual(config);
	write.mockRestore();
	await expect(new GitRemoteConfigStore(databaseName).load('project-1')).resolves.toEqual(config);
});

test('a failed legacy migration retains the readable original and can be retried', async () => {
	localStorage.setItem(legacyKey, JSON.stringify(config));
	const write = jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(() => {
		throw new Error('durable migration rejected');
	});
	await expect(store.load('project-1')).rejects.toThrow('durable migration rejected');
	expect(localStorage.getItem(legacyKey)).toBe(JSON.stringify(config));
	write.mockRestore();
	await expect(store.load('project-1')).resolves.toEqual(config);
});

test('a transaction abort cannot replace a committed baseline', async () => {
	await store.save('project-1', config);
	const originalPut = IDBObjectStore.prototype.put;
	const write = jest.spyOn(IDBObjectStore.prototype, 'put').mockImplementation(function (
		this: IDBObjectStore,
		value: unknown,
		key?: IDBValidKey,
	) {
		const request = originalPut.call(this, value, key);
		this.transaction.abort();
		return request;
	});
	await expect(store.save('project-1', { ...config, branch: 'aborted' })).rejects.toThrow();
	expect(store.getCached('project-1')).toEqual(config);
	write.mockRestore();
	await expect(new GitRemoteConfigStore(databaseName).load('project-1')).resolves.toEqual(config);
});

test('serializes baseline writes and subsequent reads', async () => {
	const advanced = { ...config, syncBase: { localOid: 'new-local', remoteOid: 'new-remote' } };
	const first = store.save('project-1', config);
	const second = store.save('project-1', advanced);
	const read = store.load('project-1');
	await Promise.all([first, second]);
	await expect(read).resolves.toEqual(advanced);
});

test('does not restore malformed legacy configuration', async () => {
	localStorage.setItem(legacyKey, '{not json');
	await expect(store.load('project-1')).resolves.toBeUndefined();
	localStorage.setItem(legacyKey, JSON.stringify({ providerId: 'missing repository' }));
	await expect(store.load('project-1')).resolves.toBeUndefined();
});
