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

export class RinspaceSignInRequiredError extends Error {
	constructor() {
		super('Rinspace sign-in is required');
	}
}

const refreshKey = 'rinspace-refresh-request-id';
const leaseKey = 'rinspace-refresh-lease';

interface SessionEnvelope {
	status?: string;
	csrfToken?: string;
}

async function sessionEnvelope(
	fetcher: typeof fetch,
	signal?: AbortSignal,
): Promise<SessionEnvelope> {
	const response = await fetcher('/api/identity/v1/session', {
		credentials: 'include',
		cache: 'no-store',
		headers: { Accept: 'application/json' },
		...(signal ? { signal } : {}),
	});
	if (response.status === 401) throw new RinspaceSignInRequiredError();
	if (!response.ok)
		throw new Error(`Rinspace identity check failed (${response.status})`);
	return response.json();
}

function authenticated(envelope: SessionEnvelope): RinspaceNativeSession {
	if (envelope.status === 'anonymous' || envelope.status === 'revoked')
		throw new RinspaceSignInRequiredError();
	return validateRinspaceSession(envelope as RinspaceNativeSession);
}

async function refreshSession(
	fetcher: typeof fetch,
	signal?: AbortSignal,
): Promise<RinspaceNativeSession> {
	// Share the main site's lock, idempotency key and device identity. Re-read
	// inside the lock so another tab's successful rotation is never replayed.
	const run = async () => {
		signal?.throwIfAborted();
		if (localStorage.getItem('rinspace-logout-pending'))
			throw new RinspaceSignInRequiredError();
		const before = await sessionEnvelope(fetcher);
		signal?.throwIfAborted();
		if (before.status === 'authenticated') {
			const session = authenticated(before);
			localStorage.removeItem(refreshKey);
			sessionStorage.removeItem(refreshKey);
			return session;
		}
		if (before.status !== 'restoring' || !before.csrfToken)
			return authenticated(before);
		const requestId =
			localStorage.getItem(refreshKey) ||
			sessionStorage.getItem(refreshKey) ||
			`refresh-${crypto.randomUUID()}`;
		localStorage.setItem(refreshKey, requestId);
		sessionStorage.removeItem(refreshKey);
		const deviceId =
			localStorage.getItem('rinspace-device-id') ||
			sessionStorage.getItem('rinspace-device-id-fallback') ||
			`browser-${crypto.randomUUID()}`;
		localStorage.setItem('rinspace-device-id', deviceId);
		const response = await fetcher('/api/identity/v1/session/refresh', {
			method: 'POST',
			credentials: 'include',
			cache: 'no-store',
			signal: AbortSignal.timeout(8000),
			headers: {
				'Content-Type': 'application/json',
				'X-Rinspace-CSRF': before.csrfToken,
				'x-device-id': deviceId,
			},
			body: JSON.stringify({ requestId }),
		});
		if (!response.ok && response.status !== 409)
			throw new Error(`Rinspace session refresh failed (${response.status})`);
		const session = authenticated(await sessionEnvelope(fetcher));
		localStorage.removeItem(refreshKey);
		sessionStorage.removeItem(refreshKey);
		return session;
	};
	if (navigator.locks)
		return navigator.locks.request(
			'rinspace-identity-refresh',
			{ mode: 'exclusive', ...(signal ? { signal } : {}) },
			run,
		);
	// Match the host's fallback lease; never rotate while its lease is active.
	const owner = `tab-${crypto.randomUUID()}`;
	const deadline = Date.now() + 12000;
	for (;;) {
		signal?.throwIfAborted();
		let lease: { expiresAt?: number } = {};
		try {
			lease = JSON.parse(localStorage.getItem(leaseKey) || '{}');
		} catch {
			/* expired/invalid lease */
		}
		if (!lease.expiresAt || lease.expiresAt <= Date.now()) break;
		if (Date.now() >= deadline)
			throw new Error('Rinspace session refresh is busy');
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	localStorage.setItem(
		leaseKey,
		JSON.stringify({ owner, expiresAt: Date.now() + 12000 }),
	);
	try {
		return await run();
	} finally {
		if (localStorage.getItem(leaseKey)?.includes(owner))
			localStorage.removeItem(leaseKey);
	}
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
	if (localStorage.getItem('rinspace-logout-pending'))
		throw new RinspaceSignInRequiredError();
	const envelope = await sessionEnvelope(fetcher, signal);
	signal?.throwIfAborted();
	const pendingRefresh =
		localStorage.getItem(refreshKey) || sessionStorage.getItem(refreshKey);
	if (
		envelope.status !== 'restoring' &&
		!(envelope.status === 'authenticated' && pendingRefresh)
	)
		return authenticated(envelope);
	// Once rotation starts, let its bounded request complete; an aborted caller
	// must not interrupt credential rotation or discard its idempotency proof.
	const session = await refreshSession(fetcher, signal);
	signal?.throwIfAborted();
	return session;
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
		if (response.status === 401)
			throw new Error('Rinspace sign-in is required');
		throw new Error(`Gitea session binding failed (${response.status})`);
	}
	// Native SSO binds the identity, but Gitea's web session cookie is only
	// established under /repos/. Do this safe GET before the first Smart HTTP
	// advertisement, not by retrying a potentially accepted receive-pack POST.
	const bootstrapOptions: RequestInit = {
		credentials: 'include',
		cache: 'no-store',
		...(signal ? { signal } : {}),
	};
	let bootstrap = await fetcher('/repos/', bootstrapOptions);
	if (bootstrap.status === 401) {
		// Gitea can issue/regenerate its HttpOnly session cookie while rejecting
		// the first request through the Native credential gate. Complete that
		// cookie round trip once, using only a safe GET. Never retry Git writes.
		bootstrap = await fetcher('/repos/', bootstrapOptions);
	}
	if (!bootstrap.ok)
		throw new Error(
			`Gitea web session initialization failed (${bootstrap.status})`,
		);
	return session;
}
