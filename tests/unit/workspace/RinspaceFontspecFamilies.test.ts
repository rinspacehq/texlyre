import { hasReviewedFontspecRuntime, reviewedFontspecFamilies, reviewedFontspecFamilyFiles } from '../../../extras/workspace/rinspace/RinspaceFontspecFamilies';
import type { FileNode } from '../../../src/types/files';

test('resolves actual family names to exact reviewed files without substituting fonts', () => {
	const configs = reviewedFontspecFamilyFiles([]);
	expect(configs).toHaveLength(reviewedFontspecFamilies.length);
	expect(reviewedFontspecFamilies.length).toBe(60);
	expect(reviewedFontspecFamilies.filter(family=>family.kind==='cjk')).toHaveLength(14);
	expect(configs.find(file => file.path === 'LibertinusSerif.fontspec')?.content).toContain('BoldItalicFont=LibertinusSerif-BoldItalic');
	expect(configs.every(file => file.excludeFromSync)).toBe(true);
	expect(configs.map(file => file.content).join('\n')).not.toMatch(/SimSun|Times New Roman|Microsoft/);
});

test('expanded families use their real styles and distinct GB/Big5 fonts', () => {
	const configs = reviewedFontspecFamilyFiles([]);
	expect(new Set(configs.map(file => file.path)).size).toBe(configs.length);
	expect(configs.find(file => file.path === 'LXGWWenKaiGBLite.fontspec')?.content).toBe('\\defaultfontfeatures[LXGW WenKai GB Lite]{Extension=.ttf,UprightFont=LXGWWenKaiGBLite-Regular}\n');
	expect(configs.find(file => file.path === 'ARPLKaitiMGB.fontspec')?.content).toContain('UprightFont=gkai00mp');
	expect(configs.find(file => file.path === 'ARPLKaitiMBig5.fontspec')?.content).toContain('UprightFont=bkai00mp');
	expect(configs.find(file => file.path === 'SourceCodePro.fontspec')?.content).toContain('ItalicFont=SourceCodePro-RegularIt,BoldItalicFont=SourceCodePro-BoldIt');
	expect(configs.find(file => file.path === 'FiraMono.fontspec')?.content).toContain('ItalicFont=FiraMono-Oblique');
});

test('preserves author-owned fontspec configuration and never mutates input', () => {
	const author: FileNode = { id:'author',name:'LibertinusSerif.fontspec',path:'/LibertinusSerif.fontspec',type:'file',content:'Author settings',lastModified:1 };
	const files = Object.freeze([Object.freeze(author)]);
	expect(reviewedFontspecFamilyFiles(files).some(file => file.name === author.name)).toBe(false);
	expect(reviewedFontspecFamilyFiles([{...author,path:'/fonts/LibertinusSerif.fontspec'}]).some(file=>file.name===author.name)).toBe(false);
	expect(author.content).toBe('Author settings');
});

test('does not change standalone or arbitrary compiler endpoints', () => {
	expect(hasReviewedFontspecRuntime('/editor/texlive/2026')).toBe(true);
	expect(hasReviewedFontspecRuntime('https://rinspace.com/editor/texlive/2026/')).toBe(true);
	for (const endpoint of ['', 'https://example.org/editor/texlive/2026','/editor/texlive/2027']) expect(hasReviewedFontspecRuntime(endpoint)).toBe(false);
});
