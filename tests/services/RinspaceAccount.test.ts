// SPDX-License-Identifier: AGPL-3.0-or-later
import { loadRinspaceAccount } from '@extras/workspace/rinspace/RinspaceAccount';
import { loadRinspaceSession } from '@extras/workspace/rinspace/RinspaceSession';

jest.mock('@extras/workspace/rinspace/RinspaceSession', () => ({ loadRinspaceSession: jest.fn() }));

const session = { status: 'authenticated' as const, csrfToken: 'synthetic', user: { id: 'native-1', sessionEpoch: 1, identityVersion: 1 }, currentSession: { sid: 'synthetic-session', version: 1 } };
const signal = new AbortController().signal;
function fetcher(profile: unknown, status = 200) {
	return jest.fn<ReturnType<typeof fetch>, Parameters<typeof fetch>>().mockResolvedValue({ ok: status === 200, status, json: async () => profile } as Response);
}

beforeEach(() => { jest.mocked(loadRinspaceSession).mockResolvedValue(session); });

test('uses the real Native profile and does not return session credentials', async () => {
	const request = fetcher({ uid: 'native-1', nickname: '真实昵称', avatarDataUrl: 'https://cdn.example/avatar.png' });
	expect(await loadRinspaceAccount(request, signal)).toEqual({ actorId: 'native-1', displayName: '真实昵称', avatarUrl: 'https://cdn.example/avatar.png' });
	expect(request).toHaveBeenCalledWith('/api/profile', expect.objectContaining({ credentials: 'include', cache: 'no-store', signal }));
});

test('rejects a profile for another identity and a missing nickname', async () => {
	await expect(loadRinspaceAccount(fetcher({ uid: 'native-2', nickname: 'Other' }), signal)).rejects.toThrow('does not match');
	await expect(loadRinspaceAccount(fetcher({ uid: 'native-1', nickname: '' }), signal)).rejects.toThrow('does not match');
});

test.each(['javascript:alert(1)', '//other.example/a', 'data:image/svg+xml;base64,PHN2Zz4=', 'http://insecure.example/a', 'https://user:password@example.com/a'])('rejects unsafe avatar %s without inventing an identity', async avatarDataUrl => {
	expect(await loadRinspaceAccount(fetcher({ uid: 'native-1', nickname: 'Native', avatarDataUrl }), signal)).toEqual({ actorId: 'native-1', displayName: 'Native' });
});

test.each(['/api/file/avatar.png', 'data:image/png;base64,YQ=='])('retains supported avatar %s', async avatarDataUrl => {
	expect((await loadRinspaceAccount(fetcher({ uid: 'native-1', nickname: 'Native', avatarDataUrl }), signal)).avatarUrl).toBe(avatarDataUrl);
});

test('does not disguise profile service failures as anonymous or local login', async () => {
	await expect(loadRinspaceAccount(fetcher({}, 503), signal)).rejects.toThrow('(503)');
});
