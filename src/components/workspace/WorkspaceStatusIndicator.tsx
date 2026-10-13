// src/components/common/WorkspaceStatusIndicator.tsx
import type React from 'react';
import { useEffect, useState, useSyncExternalStore } from 'react';

import { t } from '@/i18n';
import { useDiskWriteStatus } from '../../hooks/useDiskWriteStatus';
import {
	workspaceService,
} from '../../services/WorkspaceService';
import { FolderOpenIcon } from '../common/Icons';
import GitRemoteStatusIndicator from '../history/GitRemoteStatusIndicator';
import WorkspaceModal from './WorkspaceModal';

const subscribeWorkspace = (notify: () => void) => workspaceService.addStatusListener(notify);
const getWorkspaceSnapshot = () => workspaceService.getStatus();

const WorkspaceStatusIndicator: React.FC = () => {
	const status = useSyncExternalStore(subscribeWorkspace, getWorkspaceSnapshot);
	const [showModal, setShowModal] = useState(false);
	const writes = useDiskWriteStatus();

	useEffect(() => {
		const handleShowModal = () => setShowModal(true);

		document.addEventListener('show-workspace-modal', handleShowModal);
		return () =>
			document.removeEventListener('show-workspace-modal', handleShowModal);
	}, []);

	const activeWrites = writes.projectId === status.projectId ? writes.entries : [];
	const failed = activeWrites.filter((entry) => entry.outcome === 'failed').length;
	const pending = activeWrites.filter((entry) => entry.outcome === 'writing').length;
	const tooltip = failed > 0
		? t('{count} folder writes failed. Click to review.', { count: failed })
		: pending > 0 ? t('Writing {count} paths to the folder', { count: pending })
		: status.needsPermission
		? t('Folder access is not granted. Click to reconnect.')
		: t('Mirroring {count} files with {name}', {
				count: status.fileCount,
				name: status.directoryName ?? '',
			});

	return (
		<>
			{status.projectId ? (
				<>
					<button
						type='button'
						className='ui-badge'
						data-variant='label'
						data-tone={status.needsPermission || failed > 0 ? 'danger' : undefined}
						data-truncate='true'
						title={tooltip}
						onClick={() => setShowModal(true)}
					>
						<FolderOpenIcon />
						<span>{status.directoryName ?? t('Folder')}</span>
					</button>

					<WorkspaceModal
						isOpen={showModal}
						onClose={() => setShowModal(false)}
						status={status}
					/>
				</>
			) : null}
			<GitRemoteStatusIndicator />
		</>
	);
};

export default WorkspaceStatusIndicator;
