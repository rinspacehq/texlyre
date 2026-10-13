// SPDX-License-Identifier: AGPL-3.0-or-later
export type StartupIntent =
	| { mode: 'local-unbound'; persistentProfile: boolean }
	| { mode: 'managed' }
	| { mode: 'invalid' };

export function resolveStartupIntent(search: string, persistentProfile: boolean): StartupIntent {
	const modes = new URLSearchParams(search).getAll('mode');
	if (modes.length > 1) return { mode: 'invalid' };
	if (modes[0] === 'managed') return { mode: 'managed' };
	if (modes.length && modes[0] !== 'local' && modes[0] !== 'local-unbound') return { mode: 'invalid' };
	return { mode: 'local-unbound', persistentProfile };
}

/** Restored settings/keys alone are not consent to join a room on this route. */
export function allowsAutomaticConnections(intent: StartupIntent): boolean {
	return intent.mode === 'local-unbound' && !intent.persistentProfile;
}

/** A local user may explicitly enable peer transfer; managed repositories need host ACL first. */
export function allowsExplicitPeerConnections(intent: StartupIntent): boolean {
	return intent.mode === 'local-unbound';
}
