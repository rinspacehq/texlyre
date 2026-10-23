import { t } from '@src/i18n';
import { editorSaveFailureMessage } from '@src/hooks/editor/editorSaveFailure';
import { StorageQuotaError } from '@src/services/QuotaService';

test('a real quota failure is distinguishable from other save failures', () => {
	const quota = new DOMException('full', 'QuotaExceededError');
	expect(editorSaveFailureMessage(new Error('write failed', { cause: quota })))
		.toBe(t('Not enough browser storage to save these files'));
	const preflight = new StorageQuotaError(1024);
	expect(editorSaveFailureMessage(preflight)).toBe(preflight.message);
	expect(editorSaveFailureMessage(new Error('other failure')))
		.toBe(t('The file was not saved in browser storage'));
});
