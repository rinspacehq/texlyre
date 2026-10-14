// SPDX-License-Identifier: AGPL-3.0-or-later

export interface RinspaceNativeSession {
	status: 'authenticated';
	csrfToken: string;
	user: {
		id: string;
		sessionEpoch: number;
		identityVersion: number;
	};
	currentSession: {
		sid: string;
		version: number;
	};
}

function requireString(value: unknown, label: string): string {
	if (typeof value !== 'string' || !value.trim()) {
		throw new Error(`${label} is unavailable`);
	}
	return value.trim();
}

export function validateRinspaceSession(
	value: RinspaceNativeSession,
): RinspaceNativeSession {
	if (
		value?.status !== 'authenticated' ||
		!value.user ||
		!value.currentSession ||
		!requireString(value.csrfToken, 'Rinspace session CSRF proof') ||
		!requireString(value.user.id, 'Current Rinspace identity') ||
		!requireString(value.currentSession.sid, 'Current Rinspace session') ||
		!Number.isSafeInteger(value.user.sessionEpoch) ||
		!Number.isSafeInteger(value.user.identityVersion) ||
		!Number.isSafeInteger(value.currentSession.version)
	) {
		throw new Error('Current Rinspace identity is invalid');
	}
	return value;
}

export async function loadRinspaceSession(
	fetcher: typeof fetch = fetch,
	signal?: AbortSignal,
): Promise<RinspaceNativeSession> {
	const response = await fetcher('/api/identity/v1/session', {
		credentials: 'include',
		cache: 'no-store',
		headers: { Accept: 'application/json' },
		...(signal ? { signal } : {}),
	});
	if (!response.ok) {
		if (response.status === 401) throw new Error('Rinspace sign-in is required');
		throw new Error(`Rinspace identity check failed (${response.status})`);
	}
	return validateRinspaceSession(
		(await response.json()) as RinspaceNativeSession,
	);
}

export async function ensureRinspaceGitSession(
	fetcher: typeof fetch = fetch,
	signal?: AbortSignal,
): Promise<RinspaceNativeSession> {
	const session = await loadRinspaceSession(fetcher, signal);
	const response = await fetcher('/api/gitea/sso', {
		method: 'POST',
		credentials: 'include',
		cache: 'no-store',
		headers: { 'X-Rinspace-CSRF': session.csrfToken },
		...(signal ? { signal } : {}),
	});
	if (!response.ok) {
		if (response.status === 401) throw new Error('Rinspace sign-in is required');
		throw new Error(`Gitea session binding failed (${response.status})`);
	}
	return session;
}
