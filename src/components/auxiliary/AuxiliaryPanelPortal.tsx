import type React from 'react';
import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';

import { useAuxiliarySidebar } from '../../hooks/useAuxiliarySidebar';

interface AuxiliaryPanelPortalProps {
	id: string;
	label: string;
	icon: React.ComponentType;
	order: number;
	open: boolean;
	onOpenChange(open: boolean): void;
	children: React.ReactNode;
}

const AuxiliaryPanelPortal: React.FC<AuxiliaryPanelPortalProps> = ({
	id,
	label,
	icon,
	order,
	open,
	onOpenChange,
	children,
}) => {
	const { registerPanel, syncPanelOpen, panelTarget, activePanelId } =
		useAuxiliarySidebar();
	const onOpenChangeRef = useRef(onOpenChange);
	useEffect(() => {
		onOpenChangeRef.current = onOpenChange;
	}, [onOpenChange]);

	useEffect(
		() =>
			registerPanel({
				id,
				label,
				icon,
				order,
				onOpenChange: (nextOpen) => onOpenChangeRef.current(nextOpen),
			}),
		[id, label, icon, order, registerPanel],
	);

	useEffect(() => {
		syncPanelOpen(id, open);
	}, [id, open, syncPanelOpen]);

	const target = panelTarget(id);
	if (!target) return null;

	return createPortal(
		<div
			className='auxiliary-panel-portal'
			data-panel-id={id}
			data-active={activePanelId === id ? 'true' : 'false'}
		>
			{children}
		</div>,
		target,
	);
};

export default AuxiliaryPanelPortal;
