// SPDX-License-Identifier: AGPL-3.0-or-later
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLocalProfile, preserveGuestAsLocalProfile } from '../../src/workspace/LocalProfile.ts';
import {
	allowsAutomaticConnections,
	allowsExplicitPeerConnections,
	resolveStartupIntent,
} from '../../src/workspace/StartupPolicy.ts';

test('persistent local profile has no guest expiry, password or platform credentials', () => {
	const profile = createLocalProfile('local_browser-owner', 10);
	assert.equal(profile.isLocalProfile, true);
	assert.equal(profile.passwordHash, '');
	for (const key of ['isGuest', 'expiresAt', 'sessionId', 'token', 'binding']) assert.equal(profile[key], undefined);
});
test('guest preservation keeps ownership and settings keys while removing expiry', () => {
	const guest = { id: 'guest_browser-owner', username: 'Guest User', createdAt: 1,
		passwordHash: 'old-hash', isGuest: true, sessionId: 'old-session', expiresAt: 2, color: '#123456' };
	const profile = preserveGuestAsLocalProfile(guest);
	assert.equal(profile.id, guest.id);
	assert.equal(profile.createdAt, guest.createdAt);
	assert.equal(profile.color, guest.color);
	assert.equal(profile.isLocalProfile, true);
	assert.equal(profile.isGuest, undefined);
	assert.equal(profile.expiresAt, undefined);
	assert.equal(profile.sessionId, undefined);
	assert.equal(guest.isGuest, true);
	assert.equal(preserveGuestAsLocalProfile(profile), profile);
});
test('existing non-guest local accounts remain unchanged', () => {
	const account = { id: 'existing-browser-owner', username: 'Writer', passwordHash: 'hash', createdAt: 1 };
	assert.equal(preserveGuestAsLocalProfile(account), account);
});
test('unbound direct route is local and does not permit automatic room connections', () => {
	for (const query of ['', '?mode=local', '?mode=local-unbound']) {
		const intent = resolveStartupIntent(query, true);
		assert.deepEqual(intent, { mode: 'local-unbound', persistentProfile: true });
		assert.equal(allowsAutomaticConnections(intent), false);
	}
});
test('managed and malformed intents never silently become local', () => {
	assert.deepEqual(resolveStartupIntent('?mode=managed&type=article&id=123', true), { mode: 'managed' });
	for (const query of ['?mode=unknown', '?mode=', '?mode=managed&mode=local']) {
		const intent = resolveStartupIntent(query, true);
		assert.deepEqual(intent, { mode: 'invalid' });
		assert.equal(allowsAutomaticConnections(intent), false);
	}
	assert.equal(allowsAutomaticConnections(resolveStartupIntent('?mode=managed', false)), false);
});
test('omitting persistent-local configuration preserves upstream connection behavior', () => {
	assert.equal(allowsAutomaticConnections(resolveStartupIntent('', false)), true);
});

test('only an explicit local choice may enable peer file transfer', () => {
	assert.equal(allowsExplicitPeerConnections(resolveStartupIntent('', true)), true);
	assert.equal(allowsExplicitPeerConnections(resolveStartupIntent('', false)), true);
	assert.equal(
		allowsExplicitPeerConnections(resolveStartupIntent('?mode=managed', false)),
		false,
	);
	assert.equal(
		allowsExplicitPeerConnections(resolveStartupIntent('?mode=unknown', false)),
		false,
	);
});
