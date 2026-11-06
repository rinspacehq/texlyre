// SPDX-License-Identifier: AGPL-3.0-or-later
import { readFileSync } from 'node:fs';

const sourceFiles = [
	'extras/workspace/rinspace/RinspaceCoverCrop.tsx',
	'extras/workspace/rinspace/RinspaceCoverField.tsx',
	'extras/workspace/rinspace/RinspaceProjectCreate.tsx',
	'extras/workspace/rinspace/RinspaceProjectCreation.ts',
	'extras/workspace/rinspace/RinspaceProjectEdit.tsx',
	'extras/workspace/rinspace/RinspaceProjectHomeContent.tsx',
	'extras/workspace/rinspace/RinspaceProjectHomeSidebar.tsx',
	'src/components/project/WorkspaceProjectList.tsx',
	'src/components/workspace/WorkspaceAccountIndicator.tsx',
] as const;

function literalTranslationKeys(): string[] {
	const keys = new Set<string>();
	for (const file of sourceFiles) {
		const source = readFileSync(file, 'utf8');
		for (const match of source.matchAll(/\bt\(\s*['"]([^'"]+)['"]/g)) {
			keys.add(match[1]);
		}
	}
	return [...keys].sort();
}

it.each(['en', 'zh-CN'])('covers Project Home translation keys in %s', (locale) => {
	const catalog = JSON.parse(
		readFileSync(`translations/locales/${locale}.json`, 'utf8'),
	) as Record<string, string>;
	const missing = literalTranslationKeys().filter((key) => !(key in catalog));
	expect(missing).toEqual([]);
});
