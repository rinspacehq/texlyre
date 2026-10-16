// SPDX-License-Identifier: AGPL-3.0-or-later
import type { Setting } from '@/contexts/SettingsContext';
import { t } from '@/i18n';

import type { RinspaceManagedWorkspaceRuntime } from './RinspaceManagedWorkspace';

export function getRinspaceWorkspaceSettings(
	runtime: RinspaceManagedWorkspaceRuntime,
): Setting[] {
	return [
		{
			id: 'rinspace-integration-enabled',
			category: t('Rinspace'),
			type: 'checkbox',
			label: t('Connect this editor to Rinspace'),
			description: t(
				'Disabling stops Rinspace requests while keeping the local browser copy and unsaved edits.',
			),
			defaultValue: runtime.isEnabled(),
			liveUpdate: true,
			onChange: (value) => runtime.setEnabled(value === true),
		},
	];
}
