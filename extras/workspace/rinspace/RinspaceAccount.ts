// SPDX-License-Identifier: AGPL-3.0-or-later
import type { WorkspaceAccountIdentity } from '@/workspace/contracts';
import { loadRinspaceSession } from './RinspaceSession';

function avatarURL(value: unknown): string | undefined {
	if (typeof value !== 'string' || value.length > 1024 * 1024) return undefined;
	if (/^data:image\/(?:png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(value)) return value;
	if (value.startsWith('/') && !value.startsWith('//') && !/[\\\r\n]/.test(value)) return value;
	try {
		const url = new URL(value);
		return url.protocol === 'https:' && !url.username && !url.password ? url.href : undefined;
	} catch {
		return undefined;
	}
}

export async function loadRinspaceAccount(fetcher: typeof fetch, signal: AbortSignal): Promise<WorkspaceAccountIdentity> {
	const session = await loadRinspaceSession(fetcher, signal);
	const response = await fetcher('/api/profile', { credentials: 'include', cache: 'no-store', headers: { Accept: 'application/json' }, signal });
	if (!response.ok) throw new Error(`Rinspace profile check failed (${response.status})`);
	const value: unknown = await response.json();
	if (!value || typeof value !== 'object' || !('uid' in value) || value.uid !== session.user.id ||
		!('nickname' in value) || typeof value.nickname !== 'string' || !value.nickname.trim()) {
		throw new Error('Current Rinspace profile does not match the signed-in identity');
	}
	const avatar = avatarURL('avatarDataUrl' in value ? value.avatarDataUrl : undefined);
	return { actorId: session.user.id, displayName: value.nickname.trim(), ...(avatar ? { avatarUrl: avatar } : {}) };
}
