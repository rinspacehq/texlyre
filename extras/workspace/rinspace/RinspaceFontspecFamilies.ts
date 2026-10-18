// SPDX-License-Identifier: AGPL-3.0-or-later
import type { FileNode } from '../../../src/types/files';

// The browser has no OS font registry. Use fontspec's documented per-family
// configuration mechanism to resolve exact reviewed TeX Live families to files.
// This is not substitution: unavailable commercial/system fonts stay errors.
type Family = {
	name: string;
	kind: 'text' | 'cjk' | 'math';
	extension: 'otf' | 'ttf';
	upright: string;
	bold?: string;
	italic?: string;
	boldItalic?: string;
};

function fourStyles(name: string, stem: string, extension: 'otf' | 'ttf' = 'otf', capitalized = false): Family {
	const styles = capitalized ? ['Regular', 'Bold', 'Italic', 'BoldItalic'] : ['regular', 'bold', 'italic', 'bolditalic'];
	return { name, kind: 'text', extension, upright: `${stem}-${styles[0]}`, bold: `${stem}-${styles[1]}`, italic: `${stem}-${styles[2]}`, boldItalic: `${stem}-${styles[3]}` };
}

// Every filename is in the existing reviewed immutable TeX Live 2026 runtime.
// Missing styles are omitted, not fabricated with a different font family.
export const reviewedFontspecFamilies: readonly Family[] = [
	{ name: 'FandolSong', kind: 'cjk', extension: 'otf', upright: 'FandolSong-Regular', bold: 'FandolSong-Bold' },
	{ name: 'FandolHei', kind: 'cjk', extension: 'otf', upright: 'FandolHei-Regular', bold: 'FandolHei-Bold' },
	{ name: 'FandolKai', kind: 'cjk', extension: 'otf', upright: 'FandolKai-Regular' },
	{ name: 'FandolFang', kind: 'cjk', extension: 'otf', upright: 'FandolFang-Regular' },
	{ name: 'LXGW WenKai GB Lite', kind: 'cjk', extension: 'ttf', upright: 'LXGWWenKaiGBLite-Regular' },
	{ name: 'LXGW Neo XiHei', kind: 'cjk', extension: 'ttf', upright: 'LXGWNeoXiHei' },
	{ name: 'LXGW Neo XiHei Screen', kind: 'cjk', extension: 'ttf', upright: 'LXGWNeoXiHeiScreen' },
	{ name: 'LXGW Neo ZhiSong', kind: 'cjk', extension: 'ttf', upright: 'LXGWNeoZhiSong' },
	{ name: 'LXGW Neo ZhiSong Screen', kind: 'cjk', extension: 'ttf', upright: 'LXGWNeoZhiSongScreen' },
	{ name: 'LXGW ZhenKai GB', kind: 'cjk', extension: 'ttf', upright: 'LXGWZhenKaiGB-Regular' },
	{ name: 'AR PL SungtiL GB', kind: 'cjk', extension: 'ttf', upright: 'gbsn00lp' },
	{ name: 'AR PL KaitiM GB', kind: 'cjk', extension: 'ttf', upright: 'gkai00mp' },
	{ name: 'AR PL Mingti2L Big5', kind: 'cjk', extension: 'ttf', upright: 'bsmi00lp' },
	{ name: 'AR PL KaitiM Big5', kind: 'cjk', extension: 'ttf', upright: 'bkai00mp' },
	fourStyles('Libertinus Serif', 'LibertinusSerif', 'otf', true),
	{ name: 'Libertinus Sans', kind: 'text', extension: 'otf', upright: 'LibertinusSans-Regular', bold: 'LibertinusSans-Bold', italic: 'LibertinusSans-Italic' },
	{ name: 'Libertinus Mono', kind: 'text', extension: 'otf', upright: 'LibertinusMono-Regular' },
	...['Adventor', 'Bonum', 'Cursor', 'Heros', 'Pagella', 'Schola', 'Termes'].map(name => fourStyles(`TeX Gyre ${name}`, `texgyre${name.toLowerCase()}`)),
	{ name: 'TeX Gyre Chorus', kind: 'text', extension: 'otf', upright: 'texgyrechorus-mediumitalic' },
	fourStyles('Latin Modern Roman', 'lmroman10'),
	{ name: 'Latin Modern Sans', kind: 'text', extension: 'otf', upright: 'lmsans10-regular', bold: 'lmsans10-bold', italic: 'lmsans10-oblique', boldItalic: 'lmsans10-boldoblique' },
	{ name: 'Latin Modern Mono', kind: 'text', extension: 'otf', upright: 'lmmono10-regular', italic: 'lmmono10-italic' },
	fourStyles('Noto Sans', 'NotoSans', 'ttf', true),
	fourStyles('Noto Serif', 'NotoSerif', 'ttf', true),
	{ name: 'Noto Sans Mono', kind: 'text', extension: 'ttf', upright: 'NotoSansMono-Regular', bold: 'NotoSansMono-Bold' },
	{ name: 'DejaVu Sans', kind: 'text', extension: 'ttf', upright: 'DejaVuSans', bold: 'DejaVuSans-Bold', italic: 'DejaVuSans-Oblique', boldItalic: 'DejaVuSans-BoldOblique' },
	{ name: 'DejaVu Serif', kind: 'text', extension: 'ttf', upright: 'DejaVuSerif', bold: 'DejaVuSerif-Bold', italic: 'DejaVuSerif-Italic', boldItalic: 'DejaVuSerif-BoldItalic' },
	{ name: 'DejaVu Sans Mono', kind: 'text', extension: 'ttf', upright: 'DejaVuSansMono', bold: 'DejaVuSansMono-Bold', italic: 'DejaVuSansMono-Oblique', boldItalic: 'DejaVuSansMono-BoldOblique' },
	{ name: 'FreeSerif', kind: 'text', extension: 'otf', upright: 'FreeSerif', bold: 'FreeSerifBold', italic: 'FreeSerifItalic', boldItalic: 'FreeSerifBoldItalic' },
	{ name: 'FreeSans', kind: 'text', extension: 'otf', upright: 'FreeSans', bold: 'FreeSansBold', italic: 'FreeSansOblique', boldItalic: 'FreeSansBoldOblique' },
	{ name: 'FreeMono', kind: 'text', extension: 'otf', upright: 'FreeMono', bold: 'FreeMonoBold', italic: 'FreeMonoOblique', boldItalic: 'FreeMonoBoldOblique' },
	fourStyles('STIX Two Text', 'STIXTwoText', 'otf', true),
	...['Sans', 'Serif', 'Code'].map(name => ({ name: `Source ${name} Pro`, kind: 'text' as const, extension: 'otf' as const,
		upright: `Source${name}Pro-Regular`, bold: `Source${name}Pro-Bold`, italic: `Source${name}Pro-RegularIt`, boldItalic: `Source${name}Pro-BoldIt` })),
	...['Serif', 'Sans', 'Mono'].map(name => fourStyles(`IBM Plex ${name}`, `IBMPlex${name}`, 'otf', true)),
	...['', ' Condensed', ' Mono', ' Serif'].map(name => fourStyles(`Roboto${name}`, `Roboto${name.replaceAll(' ', '')}`, 'otf', true)),
	fourStyles('Lato', 'Lato', 'ttf', true),
	fourStyles('Open Sans', 'OpenSans', 'ttf', true),
	fourStyles('EB Garamond', 'EBGaramond', 'otf', true),
	fourStyles('Inter', 'Inter', 'otf', true),
	fourStyles('Fira Sans', 'FiraSans', 'otf', true),
	{ name: 'Fira Mono', kind: 'text', extension: 'otf', upright: 'FiraMono-Regular', bold: 'FiraMono-Bold', italic: 'FiraMono-Oblique', boldItalic: 'FiraMono-BoldOblique' },
	fourStyles('JetBrains Mono', 'JetBrainsMono', 'otf', true),
	fourStyles('Cascadia Code', 'CascadiaCode', 'otf', true),
	...['Carlito', 'Caladea', 'Arimo', 'Tinos'].map(name => fourStyles(name, name, 'ttf', true)),
];

export function hasReviewedFontspecRuntime(endpoint: string): boolean {
	return /^(?:https:\/\/rinspace\.com)?\/editor\/texlive\/2026\/?$/.test(endpoint);
}

export function reviewedFontspecFamilyFiles(files: readonly FileNode[]): FileNode[] {
	const existing = new Set(files.map(file => file.path.split('/').at(-1)));
	return reviewedFontspecFamilies.flatMap(family => {
		const name = `${family.name.replaceAll(' ', '')}.fontspec`;
		// An author's configuration always wins. Never overwrite or rewrite it.
		if (existing.has(name)) return [];
		const features = [`Extension=.${family.extension}`, `UprightFont=${family.upright}`];
		if (family.bold) features.push(`BoldFont=${family.bold}`);
		if (family.italic) features.push(`ItalicFont=${family.italic}`);
		if (family.boldItalic) features.push(`BoldItalicFont=${family.boldItalic}`);
		const content = `\\defaultfontfeatures[${family.name}]{${features.join(',')}}\n`;
		return [{ id: `rinspace-fontspec-${name}`, name, path: name, type: 'file' as const,
			content, lastModified: 0, size: content.length, mimeType: 'text/plain', isBinary: false, excludeFromSync: true }];
	});
}
