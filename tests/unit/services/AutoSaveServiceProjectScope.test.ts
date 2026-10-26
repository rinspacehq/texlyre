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

it('drops a queued snapshot after the editor advances to newer content', async () => {
	const saves = new AutoSaveService();
	const persist = jest.fn().mockResolvedValue(undefined);
	let current = '旧快照';
	const trigger = saves.createAutoSaver(
		autoSaveKey('project-a', 'main.md'),
		() => current,
		{
			enabled: true,
			delay: 60_000,
			onSave: persist,
			isCurrent: (content) => content === current,
		},
	);

	trigger();
	current = '琳修改后的新内容 $x^2$';
	await expect(saves.flushPendingSaves('project-a')).resolves.toEqual([
		undefined,
	]);
	expect(persist).not.toHaveBeenCalled();

	trigger();
	await expect(saves.flushPendingSaves('project-a')).resolves.toEqual([
		undefined,
	]);
	expect(persist).toHaveBeenCalledWith(
		autoSaveKey('project-a', 'main.md'),
		'琳修改后的新内容 $x^2$',
	);
});
