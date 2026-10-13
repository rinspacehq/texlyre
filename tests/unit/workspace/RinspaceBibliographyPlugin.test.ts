// SPDX-License-Identifier: AGPL-3.0-or-later
import { createRinspaceBibliographyPlugin } from '@src/plugins/bibliography/rinspace/RinspaceBibliographyPlugin';

const response = (body: unknown, status = 200): Response =>
	({
		ok: status >= 200 && status < 300,
		status,
		json: async () => body,
	}) as Response;

describe('Rinspace bibliography plugin', () => {
	it('searches the existing Tag citation API and emits the canonical refs.bib entry', async () => {
		const request = jest.fn(async () =>
			response({
				items: [
					{
						target_type: 'tag',
						target_id: '42',
						target_slug_name: '范畴论',
						target_display_name: '范畴论 {入门}',
						resolved: true,
					},
				],
			}),
		);
		const plugin = createRinspaceBibliographyPlugin(
			() => true,
			request,
			() => new Date(2026, 9, 13),
		);

		const entries = await plugin.getBibliographyEntries(' 范畴论 ', [], 99);
		expect(entries).toEqual([
			expect.objectContaining({
				key: 'tags/42',
				entryType: 'misc',
				remoteId: 'tag:42',
				fields: expect.objectContaining({
					title: '范畴论 \\{入门\\}',
					note: 'Rinspace tag wiki, accessed 2026-10-13',
					url: 'https://rinspace.com/tags/42/%E8%8C%83%E7%95%B4%E8%AE%BA',
				}),
				rawEntry: expect.stringContaining('@misc{tags/42,'),
			}),
		]);
		expect(entries[0]?.rawEntry).toContain(
			'url = {https://rinspace.com/tags/42/%E8%8C%83%E7%95%B4%E8%AE%BA}',
		);
		expect(entries[0]?.rawEntry).not.toContain('howpublished');
		expect(request).toHaveBeenCalledWith(
			'/api/wiki/citations/search?q=%E8%8C%83%E7%95%B4%E8%AE%BA&types=tag&limit=24',
			expect.objectContaining({
				credentials: 'include',
				cache: 'no-store',
				headers: { Accept: 'application/json' },
			}),
		);
		expect(JSON.stringify(request.mock.calls)).not.toMatch(/authorization|token/i);
	});

	it('rejects work before a request when the Rinspace plugin is disabled', async () => {
		const request = jest.fn();
		const plugin = createRinspaceBibliographyPlugin(() => false, request);

		expect(plugin.isEnabled()).toBe(false);
		expect(plugin.getConnectionStatus()).toBe('disconnected');
		await expect(plugin.getBibliographyEntries('tag')).rejects.toThrow(
			'Rinspace integration is disabled',
		);
		expect(request).not.toHaveBeenCalled();
	});

	it('keeps only resolved numeric Tag identities and deduplicates canonical keys', async () => {
		const plugin = createRinspaceBibliographyPlugin(
			() => true,
			async () =>
				response({
					items: [
						{ targetType: 'tag', targetId: '7', resolved: true, label: 'Seven' },
						{ targetType: 'tag', targetId: '7', resolved: true, label: 'Duplicate' },
						{ targetType: 'tag', targetId: 'slug', resolved: true },
						{ targetType: 'book', targetId: '8', resolved: true },
						{ targetType: 'tag', targetId: '9', resolved: false },
					],
				}),
		);

		await expect(plugin.getBibliographyEntries('7')).resolves.toEqual([
			expect.objectContaining({ key: 'tags/7', remoteId: 'tag:7' }),
		]);
	});
});
