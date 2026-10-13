import {
	createLocalTypstFontLoader,
	loadTypstFonts,
} from '@src/extensions/typst.ts/TypstRendererRuntime';

describe('Typst fixed runtime assets', () => {
	it('loads the compiler font set only from the application origin', async () => {
		const fontBytes = new Uint8Array([0, 1, 2, 3]);
		const request = jest
			.fn()
			.mockResolvedValueOnce({
				ok: true,
				json: async () => ['LocalFont.otf'],
			})
			.mockResolvedValueOnce({
				ok: true,
				arrayBuffer: async () => fontBytes.buffer,
			});
		global.fetch = request as typeof fetch;

		const fonts = await loadTypstFonts();
		const loader = await createLocalTypstFontLoader();

		expect(fonts).toHaveLength(1);
		expect(fonts[0]).toEqual(fontBytes);
		expect(request.mock.calls.map(([url]) => url)).toEqual([
			'/editor/assets/fonts/fonts.json',
			'/editor/assets/fonts/LocalFont.otf',
		]);
		expect((loader as any)._kind).toBe('fontLoader');
		expect((loader as any)._preloadRemoteFontOptions).toEqual({
			assets: false,
		});
		expect(JSON.stringify(request.mock.calls)).not.toContain('jsdelivr');
	});
});
