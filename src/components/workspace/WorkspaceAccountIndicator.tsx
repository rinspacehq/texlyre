// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState, type ReactNode } from 'react';
import { pluginRegistry } from '../../plugins/PluginRegistry';
import { t } from '../../i18n';
import type { WorkspaceAccountIdentity } from '../../workspace/contracts';
import { UserIcon } from '../common/Icons';

/** Verified host identity can label the existing menu without changing its ownership. */
export default function WorkspaceAccountIndicator({
	fallback = null,
}: {
	fallback?: ReactNode;
}) {
	const catalog = pluginRegistry.getWorkspaceExtensions().catalog;
	const [account, setAccount] = useState<WorkspaceAccountIdentity | null>(null);
	const [unavailable, setUnavailable] = useState(false);
	const [resolved, setResolved] = useState(false);
	const [imageFailed, setImageFailed] = useState(false);
	useEffect(() => {
		if (!catalog?.getAccount) return;
		let request: AbortController | undefined;
		const refresh = () => {
			request?.abort();
			const controller = new AbortController();
			request = controller;
			setUnavailable(false);
			if (!catalog.isEnabled()) return;
			void catalog
				.getAccount?.(controller.signal)
				.then((value) => {
					if (!controller.signal.aborted) {
						setAccount(value);
						setImageFailed(false);
						setResolved(true);
					}
				})
				.catch(() => {
					if (!controller.signal.aborted) {
						setUnavailable(true);
						setResolved(true);
					}
				});
		};
		const visible = () => {
			if (document.visibilityState === 'visible') refresh();
		};
		const storage = (event: StorageEvent) => {
			if (
				event.key?.startsWith('rinspace-') &&
				event.key !== 'rinspace-theme-v2'
			) {
				catalog.invalidate?.();
				refresh();
			}
		};
		const unsubscribe = catalog.subscribe(refresh);
		refresh();
		window.addEventListener('focus', refresh);
		window.addEventListener('storage', storage);
		document.addEventListener('visibilitychange', visible);
		return () => {
			request?.abort();
			unsubscribe();
			window.removeEventListener('focus', refresh);
			window.removeEventListener('storage', storage);
			document.removeEventListener('visibilitychange', visible);
		};
	}, [catalog]);
	if (!catalog?.getAccount || !catalog.isEnabled()) return <>{fallback}</>;
	if (account)
		return (
			<span
				className='workspace-account-identity'
				data-role='workspace-account'
				data-stale={unavailable || undefined}
				title={
					unavailable
						? t('Rinspace account temporarily unavailable')
						: 'Rinspace'
				}
				role='status'
				aria-label={account.displayName}
			>
				{account.avatarUrl && !imageFailed ? (
					<img
						src={account.avatarUrl}
						alt=''
						referrerPolicy='no-referrer'
						onError={() => setImageFailed(true)}
					/>
				) : (
					<UserIcon />
				)}
				<span>{account.displayName}</span>
			</span>
		);
	if (unavailable)
		return (
			<span
				data-role='workspace-account-error'
				title={t('Rinspace account unavailable')}
			>
				<UserIcon />!
			</span>
		);
	if (!resolved)
		return (
			<span data-role='workspace-account-loading' aria-busy='true'>
				<UserIcon />
				<span>{t('Loading account...')}</span>
			</span>
		);
	return (
		<span data-role='workspace-account-anonymous'>
			<UserIcon />
			<span>{t('Sign in')}</span>
		</span>
	);
}
