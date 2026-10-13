// SPDX-License-Identifier: AGPL-3.0-or-later
import {
	getRinspaceApplicationTitle,
	isRinspaceApplicationTitle,
} from '../../../src/utils/applicationTitle';

describe('Rinspace browser title', () => {
	it('uses the Chinese product title for Chinese locales', () => {
		expect(getRinspaceApplicationTitle('zh')).toBe('芥子环在线编辑器');
		expect(getRinspaceApplicationTitle('zh-CN')).toBe('芥子环在线编辑器');
	});

	it('uses the English product title for other locales', () => {
		expect(getRinspaceApplicationTitle('en')).toBe('Rinspace Online Editor');
		expect(getRinspaceApplicationTitle('de')).toBe('Rinspace Online Editor');
	});

	it('recognizes product titles without treating them as project names', () => {
		expect(isRinspaceApplicationTitle('芥子环在线编辑器')).toBe(true);
		expect(isRinspaceApplicationTitle('Rinspace Online Editor')).toBe(true);
		expect(isRinspaceApplicationTitle('My Project')).toBe(false);
	});
});
