// SPDX-License-Identifier: AGPL-3.0-or-later
import type React from 'react';
import { useEffect, useState } from 'react';

import { t } from '@/i18n';
import { pluginRegistry } from '@/plugins/PluginRegistry';

interface RinspaceProjectHomeSidebarProps {
	searchQuery: string;
	onSearch: (query: string) => void;
	onCreate: () => void;
	onRefresh: () => void;
}

const RinspaceProjectHomeSidebar: React.FC<RinspaceProjectHomeSidebarProps> = ({
	searchQuery,
	onSearch,
	onCreate,
	onRefresh,
}) => {
	const catalog = pluginRegistry.getWorkspaceExtensions().catalog;
	const [accountLabel, setAccountLabel] = useState('');
	const [accountStatus, setAccountStatus] = useState<'loading' | 'signed_in' | 'anonymous' | 'error'>('loading');
	useEffect(() => {
		if (!catalog?.getAccount) return;
		const active = new AbortController();
		const load = () => {
			void catalog.getAccount?.(active.signal).then((account) => {
				if (active.signal.aborted) return;
				setAccountLabel(account?.displayName || '');
				setAccountStatus(account ? 'signed_in' : 'anonymous');
			}).catch(() => { if (!active.signal.aborted) setAccountStatus('error'); });
		};
		load();
		const unsubscribe = catalog.subscribe(load);
		return () => { active.abort(); unsubscribe(); };
	}, [catalog]);
	return (
	<div className='file-explorer' data-role='workspace-catalog-panel'>
		<div className='ui-panel-header' data-role='explorer' data-position='top'>
			<h3 className='ui-panel-title' data-size='body' data-shrink='true'>
				Rinspace
			</h3>
		</div>
		<div className='ui-stack' data-role='workspace-catalog-actions' data-padding='sm'>
			<button type='button' className='button primary' onClick={onCreate}>{t('New project')}</button>
		</div>
		<div
			className='ui-stack'
			data-role='workspace-catalog-search'
			data-gap='sm'
			data-padding='sm'
		>
			<div className='ui-search-field'>
				<input
					type='search'
					aria-label={t('Search Rinspace projects')}
					placeholder={t('Search projects...')}
					value={searchQuery}
					onChange={(event) => onSearch(event.target.value)}
					className='search-input ui-field-control ui-search-control'
				/>
				{searchQuery && (
					<button
						type='button'
						aria-label={t('Clear search')}
						className='ui-search-clear'
						onClick={() => onSearch('')}
						title={t('Clear search')}
					>
						<span aria-hidden='true'>×</span>
					</button>
				)}
			</div>
		</div>
		<div className='ui-stack' data-role='workspace-catalog-account' data-padding='sm'>
			<span className='ui-meta' role='status'>{!catalog?.getAccount ? t('Rinspace account unavailable') : accountStatus === 'signed_in' ? accountLabel || t('Signed in to Rinspace') : accountStatus === 'loading' ? t('Checking Rinspace account...') : accountStatus === 'error' ? t('Rinspace account unavailable') : t('Rinspace sign-in is required')}</span>
			<button type='button' className='button secondary' onClick={onRefresh}>{t('Refresh projects')}</button>
		</div>
	</div>
);
};

export default RinspaceProjectHomeSidebar;
