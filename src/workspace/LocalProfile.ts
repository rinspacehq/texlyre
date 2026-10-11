// SPDX-License-Identifier: AGPL-3.0-or-later
import type { User } from '../types/auth';

/** Browser ownership only: not a platform identity or an authentication token. */
export function preserveGuestAsLocalProfile(user: User): User {
	if (!user.isGuest) return user;
	const { isGuest: _guest, expiresAt: _expiry, sessionId: _session, ...preserved } = user;
	return { ...preserved, passwordHash: '', isLocalProfile: true };
}

export function createLocalProfile(id: string, now: number): User {
	return {
		id,
		username: 'Local workspace',
		passwordHash: '',
		isLocalProfile: true,
		createdAt: now,
		lastLogin: now,
	};
}
