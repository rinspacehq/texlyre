import { t } from '@/i18n';
import { isQuotaExceededError, StorageQuotaError } from '../../services/QuotaService';

export function editorSaveFailureMessage(error: unknown): string {
	if (error instanceof StorageQuotaError) return error.message;
	if (isQuotaExceededError(error))
		return t('Not enough browser storage to save these files');
	return t('The file was not saved in browser storage');
}
