// SPDX-License-Identifier: AGPL-3.0-or-later
import {
	canSelectRemoteProjectSource,
	resolveVisibleProjectSource,
} from '@/workspace/ProjectSourcePolicy';

describe('project source account policy', () => {
	it('keeps an unresolved or anonymous account on Local despite a stored Rinspace tab', () => {
		expect(resolveVisibleProjectSource(true, 'remote', 'checking')).toBe('local');
		expect(resolveVisibleProjectSource(true, 'remote', 'anonymous')).toBe('local');
		expect(canSelectRemoteProjectSource(true, 'checking')).toBe(false);
		expect(canSelectRemoteProjectSource(true, 'anonymous')).toBe(false);
	});

	it('restores the selected source only after the account is authenticated', () => {
		expect(resolveVisibleProjectSource(true, 'remote', 'authenticated')).toBe(
			'remote',
		);
		expect(resolveVisibleProjectSource(true, 'local', 'authenticated')).toBe(
			'local',
		);
	});

	it('preserves the existing error surface when account lookup is unavailable', () => {
		expect(resolveVisibleProjectSource(true, 'remote', 'unavailable')).toBe(
			'remote',
		);
	});
});
