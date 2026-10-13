// SPDX-License-Identifier: AGPL-3.0-or-later
import type { User } from '../types/auth';

/** Browser ownership only: not a platform identity or an authentication token. */
export function preserveGuestAsLocalProfile(user: User): User {
	if (!user.isGuest) return user;
	const { isGuest: _guest, expiresAt: _expiry, sessionId: _session, ...preserved } = user;
	return {
		...preserved,
		passwordHash: '',
		isLocalProfile: true,
		localProfileScope: preserved.localProfileScope ?? 'standalone',
	};
}

export function createLocalProfile(
	id: string,
	now: number,
	localProfileScope = 'standalone',
): User {
	return {
		id,
		username:
			localProfileScope === 'standalone'
				? 'Local workspace'
				: `Rinspace workspace ${id.slice(-8)}`,
		passwordHash: '',
		isLocalProfile: true,
		localProfileScope,
		createdAt: now,
		lastLogin: now,
	};
}

/** Stable local partition key. The platform UID itself is never persisted here. */
export async function managedLocalProfileScope(actorId: string): Promise<string> {
	const normalized = actorId.trim();
	if (!normalized) throw new Error('Managed actor identity is required');
	const digest = await crypto.subtle.digest(
		'SHA-256',
		new TextEncoder().encode(`rinspace-managed-profile\0${normalized}`),
	);
	const key = Array.from(new Uint8Array(digest))
		.map((value) => value.toString(16).padStart(2, '0'))
		.join('');
	return `rinspace:${key}`;
}
