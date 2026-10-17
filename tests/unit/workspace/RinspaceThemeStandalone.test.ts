// SPDX-License-Identifier: AGPL-3.0-or-later
import { rinspaceTheme } from '@extras/workspace/rinspace/RinspaceTheme';

test('standalone origins do not read, write or subscribe to host preferences', () => {
	const read = jest.spyOn(Storage.prototype, 'getItem');
	const write = jest.spyOn(Storage.prototype, 'setItem');
	const listener = jest.fn();
	expect(rinspaceTheme.getPreference()).toBeUndefined();
	rinspaceTheme.setPreference('dark');
	const stop = rinspaceTheme.subscribe(listener);
	window.dispatchEvent(new Event('focus'));
	stop();
	expect(listener).not.toHaveBeenCalled();
	expect(read).not.toHaveBeenCalled();
	expect(write).not.toHaveBeenCalled();
	jest.restoreAllMocks();
});
