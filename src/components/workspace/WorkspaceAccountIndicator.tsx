// SPDX-License-Identifier: AGPL-3.0-or-later
import { useEffect, useState } from 'react';
import { pluginRegistry } from '../../plugins/PluginRegistry';
import type { WorkspaceAccountIdentity } from '../../workspace/contracts';
import { UserIcon } from '../common/Icons';

/** Platform display stays separate from the browser-local account dropdown. */
export default function WorkspaceAccountIndicator() {
	const catalog = pluginRegistry.getWorkspaceExtensions().catalog;
	const [account, setAccount] = useState<WorkspaceAccountIdentity | null>(null);
	const [unavailable, setUnavailable] = useState(false);
	const [imageFailed, setImageFailed] = useState(false);
	useEffect(() => {
		if (!catalog?.getAccount) return;
		let request: AbortController | undefined;
		const refresh = () => {
			request?.abort();
			const controller = new AbortController();
			request = controller;
			setAccount(null);
			setUnavailable(false);
			if (!catalog.isEnabled()) return;
			void catalog.getAccount?.(controller.signal).then(value => {
				if (!controller.signal.aborted) { setAccount(value); setImageFailed(false); }
			}).catch(() => {
				if (!controller.signal.aborted) setUnavailable(true);
			});
		};
		const visible = () => { if (document.visibilityState === 'visible') refresh(); };
		const storage = (event: StorageEvent) => { if (event.key?.startsWith('rinspace-')) refresh(); };
		const unsubscribe = catalog.subscribe(refresh);
		refresh();
		window.addEventListener('focus', refresh);
		window.addEventListener('storage', storage);
		document.addEventListener('visibilitychange', visible);
		return () => {
			request?.abort(); unsubscribe();
			window.removeEventListener('focus', refresh);
			window.removeEventListener('storage', storage);
			document.removeEventListener('visibilitychange', visible);
		};
	}, [catalog]);
	if (unavailable) return <span data-role='workspace-account-error' title='Rinspace account unavailable'><UserIcon />!</span>;
	if (!account) return null;
	return <span className='workspace-account-identity' data-role='workspace-account' title='Rinspace' aria-label={account.displayName}>
		{account.avatarUrl && !imageFailed ? <img src={account.avatarUrl} alt='' referrerPolicy='no-referrer' onError={() => setImageFailed(true)} /> : <UserIcon />}
		<span>{account.displayName}</span>
	</span>;
}
