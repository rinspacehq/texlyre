// src/extensions/typst.ts/TypstRendererRuntime.ts
import { loadFonts } from '@myriaddreamin/typst.ts';
import { createTypstRenderer } from '@myriaddreamin/typst.ts/renderer';

export const BASE_PATH = __BASE_PATH__;

const FALLBACK_FONTS = [
	'DejaVuSansMono-Bold.ttf',
	'DejaVuSansMono-BoldOblique.ttf',
	'DejaVuSansMono-Oblique.ttf',
	'DejaVuSansMono.ttf',
	'LibertinusSerif-Bold.otf',
	'LibertinusSerif-BoldItalic.otf',
	'LibertinusSerif-Italic.otf',
	'LibertinusSerif-Regular.otf',
	'LibertinusSerif-Semibold.otf',
	'LibertinusSerif-SemiboldItalic.otf',
	'NewCM10-Bold.otf',
	'NewCM10-BoldItalic.otf',
	'NewCM10-Italic.otf',
	'NewCM10-Regular.otf',
	'NewCMMath-Bold.otf',
	'NewCMMath-Book.otf',
	'NewCMMath-Regular.otf',
];

let rendererPromise: Promise<any> | null = null;
let fontsPromise: Promise<Uint8Array[]> | null = null;

export async function loadTypstFonts(): Promise<Uint8Array[]> {
	if (fontsPromise) return fontsPromise;

	fontsPromise = (async () => {
		const baseUrl = `${BASE_PATH}/assets/fonts`;
		let names = FALLBACK_FONTS;

		try {
			const response = await fetch(`${baseUrl}/fonts.json`);
			if (response.ok) names = await response.json();
		} catch {
			// The reviewed fallback list remains the local source of truth.
		}

		const fonts = await Promise.all(
			names.map(async (name) => {
				try {
					const response = await fetch(`${baseUrl}/${name}`);
					if (!response.ok) return null;
					return new Uint8Array(await response.arrayBuffer());
				} catch {
					return null;
				}
			}),
		);

		return fonts.filter((font) => font !== null);
	})();

	return fontsPromise;
}

export async function createLocalTypstFontLoader() {
	const fonts = await loadTypstFonts();

	// typst.ts injects its jsDelivr default font set unless it sees a
	// registered font loader. Mark these same-origin bytes as the complete
	// default set so compilation never silently falls back to a remote CDN.
	return loadFonts(fonts, { assets: false });
}

export async function getTypstRenderer(): Promise<any> {
	if (rendererPromise) return rendererPromise;

	rendererPromise = (async () => {
		const renderer = createTypstRenderer();
		const fontLoader = await createLocalTypstFontLoader();

		await renderer.init({
			getModule: () =>
				`${BASE_PATH}/core/typst-ts-renderer/pkg/typst_ts_renderer_bg.wasm`,
			beforeBuild: [fontLoader],
		});

		return renderer;
	})();

	return rendererPromise;
}
