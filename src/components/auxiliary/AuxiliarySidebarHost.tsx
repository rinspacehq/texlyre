import type React from 'react';
import { useCallback } from 'react';

import { t } from '@/i18n';
import { useAuxiliarySidebar } from '../../hooks/useAuxiliarySidebar';
import { CloseIcon } from '../common/Icons';
import ResizablePanel from '../common/ResizablePanel';

interface AuxiliarySidebarHostProps {
	width: number;
	onResize(width: number): void;
}

const AuxiliaryPanelSlot: React.FC<{
	id: string;
	label: string;
	selected: boolean;
	onTarget(id: string, target: HTMLDivElement | null): void;
}> = ({ id, label, selected, onTarget }) => {
	const setTarget = useCallback(
		(target: HTMLDivElement | null) => onTarget(id, target),
		[id, onTarget],
	);

	return (
		<div
			id={`auxiliary-panel-${id}`}
			ref={setTarget}
			className='auxiliary-panel-slot'
			role='tabpanel'
			aria-label={label}
			hidden={!selected}
		/>
	);
};

const AuxiliarySidebarHost: React.FC<AuxiliarySidebarHostProps> = ({
	width,
	onResize,
}) => {
	const { panels, activePanelId, activatePanel, closePanel, setPanelTarget } =
		useAuxiliarySidebar();

	if (panels.length === 0) return null;

	return (
		<aside
			className='auxiliary-sidebar'
			data-expanded={activePanelId ? 'true' : 'false'}
			aria-label={t('Tools')}
		>
			<div
				className='auxiliary-activity-rail'
				role='tablist'
				aria-label={t('Tools')}
				aria-orientation='vertical'
			>
				{panels.map((panel) => {
					const Icon = panel.icon;
					const selected = panel.id === activePanelId;
					return (
						<button
							key={panel.id}
							type='button'
							role='tab'
							className='ui-icon-button auxiliary-activity-tab'
							data-variant='ghost'
							aria-selected={selected}
							aria-controls={`auxiliary-panel-${panel.id}`}
							aria-label={panel.label}
							title={panel.label}
							onClick={() =>
								selected ? closePanel() : activatePanel(panel.id)
							}
						>
							<Icon />
						</button>
					);
				})}
				{activePanelId && (
					<button
						type='button'
						className='ui-icon-button auxiliary-close-button'
						data-variant='ghost'
						aria-label={t('Close')}
						title={t('Close')}
						onClick={closePanel}
					>
						<CloseIcon />
					</button>
				)}
			</div>

			<ResizablePanel
				direction='horizontal'
				alignment='start'
				width={width}
				minWidth={280}
				maxWidth={600}
				maintainAlignment={true}
				collapsed={!activePanelId}
				collapsible={false}
				onResize={onResize}
				className='auxiliary-sidebar-content'
			>
				{panels.map((panel) => {
					const selected = panel.id === activePanelId;
					return (
						<AuxiliaryPanelSlot
							key={panel.id}
							id={panel.id}
							label={panel.label}
							selected={selected}
							onTarget={setPanelTarget}
						/>
					);
				})}
			</ResizablePanel>
		</aside>
	);
};

export default AuxiliarySidebarHost;
