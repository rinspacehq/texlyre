// SPDX-License-Identifier: AGPL-3.0-or-later
import { parseRinspaceManifest } from '@src/plugins/workspace/rinspace/RinspaceManifest';

const files = (...paths: string[]) => new Set(paths.map((path) => `/${path}`));
const manifest = (values: {
	type?: string;
	status?: string;
	entry?: string;
	format?: string;
	metadata?: string;
	extra?: string;
}) => `type: ${values.type ?? 'blog'}
status: ${values.status ?? 'draft'}
entry: ${values.entry ?? 'main.tex'}
build:
  format: ${values.format ?? 'latex'}
metadata:
${values.metadata ?? '  rinspacePostId: "42"'}
${values.extra ?? ''}`;

describe('Rinspace manifest preview contract', () => {
	it.each([
		['a', 'blog', 'main.tex', 'latex'],
		['b', 'book', 'main.typ', 'typst'],
		['a', 'blog', 'content.md', 'markdown'],
		['pdf', 'pdf', 'main.pdf', 'pdf'],
	] as const)('accepts the managed %s repository build declaration', (owner, type, entry, format) => {
		expect(parseRinspaceManifest(
			manifest({ type, entry, format }), owner, '42', files(entry),
		)).toEqual({ authority: 'rinspace.yaml', status: 'valid', format, entry });
	});

	it('accepts the current Tag identity and presentation contract', () => {
		const source = `${manifest({
			type: 'tag-wiki',
			metadata: '  rinspaceTagId: "42"\n  templateVersion: latex-article/tag-wiki@2',
		})}sourceVisibility: open
tag:
  displayName: Geometry
  usageExcerpt: Canonical geometry
  parentTags: [tags/7]
tags:
  primary: [geometry, 代数]
`;
		expect(parseRinspaceManifest(source, 'tags', '42', files('main.tex'))).toEqual(
			expect.objectContaining({ status: 'valid', format: 'latex', entry: 'main.tex' }),
		);
	});

	it.each([
		['unknown root field', manifest({ extra: 'unknown: true' }), 'not part'],
		['wrong object identity', manifest({ metadata: '  rinspacePostId: "43"' }), 'does not match'],
		['missing entry', manifest({ entry: 'missing.tex' }), 'does not exist'],
		['format mismatch', manifest({ entry: 'main.typ', format: 'latex' }), 'extension does not match'],
		['unsafe path', manifest({ entry: '../main.tex' }), 'unsafe path'],
		['unsupported status', manifest({ status: 'ready' }), 'draft or published'],
	] as const)('reports %s without guessing another language', (_name, source, message) => {
		const result = parseRinspaceManifest(source, 'a', '42', files('main.tex', 'main.typ'));
		expect(result).toEqual(expect.objectContaining({ status: 'invalid' }));
		if (result.status === 'invalid') expect(result.message).toContain(message);
	});

	it('does not allow Typst or PDF to escape their existing content-type rules', () => {
		const typstTag = parseRinspaceManifest(
			manifest({ type: 'tag-wiki', entry: 'main.typ', format: 'typst', metadata: '  rinspaceTagId: "42"\n  templateVersion: typst@1' }),
			'tags', '42', files('main.typ'),
		);
		const pdfArticle = parseRinspaceManifest(
			manifest({ entry: 'main.pdf', format: 'pdf' }), 'a', '42', files('main.pdf'),
		);
		expect(typstTag).toEqual(expect.objectContaining({ status: 'invalid' }));
		expect(pdfArticle).toEqual(expect.objectContaining({ status: 'invalid' }));
	});
});
