// SPDX-License-Identifier: AGPL-3.0-or-later
import { AutoSaveService, autoSaveKey } from '@src/services/AutoSaveService';

it('does not retry or block another project because an older draft failed', async () => {
	const saves = new AutoSaveService();
	const persist = jest.fn().mockRejectedValueOnce(new Error('browser storage failed'))
		.mockResolvedValue(undefined);
	await expect(saves.saveNow(autoSaveKey('project-a', 'main.tex'), 'draft', persist))
		.rejects.toThrow('browser storage failed');
	await expect(saves.flushPendingSaves('project-b')).resolves.toEqual([]);
	expect(persist).toHaveBeenCalledTimes(1);
	await expect(saves.flushPendingSaves('project-a')).resolves.toEqual([undefined]);
	expect(persist).toHaveBeenCalledTimes(2);
});
