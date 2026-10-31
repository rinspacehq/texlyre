import type React from 'react';
import { type ReactNode, useCallback, useMemo, useRef, useState } from 'react';

import {
	AuxiliarySidebarContext,
	type AuxiliaryPanelRegistration,
	type AuxiliarySidebarContextValue,
} from './AuxiliarySidebarState';

export const AuxiliarySidebarProvider: React.FC<{
	children: ReactNode;
}> = ({ children }) => {
	const registrationsRef = useRef(
		new Map<string, AuxiliaryPanelRegistration>(),
	);
	const targetsRef = useRef(new Map<string, HTMLDivElement>());
	const activePanelRef = useRef<string | null>(null);
	const [panels, setPanels] = useState<AuxiliaryPanelRegistration[]>([]);
	const [activePanelId, setActivePanelId] = useState<string | null>(null);
	const [lastActivePanelId, setLastActivePanelId] = useState<string | null>(
		null,
	);
	const [targetVersion, setTargetVersion] = useState(0);

	const refreshPanels = useCallback(() => {
		setPanels(
			[...registrationsRef.current.values()].sort(
				(left, right) => left.order - right.order,
			),
		);
	}, []);

	const setActive = useCallback((id: string | null) => {
		activePanelRef.current = id;
		setActivePanelId(id);
		if (id) setLastActivePanelId(id);
	}, []);

	const registerPanel = useCallback(
		(panel: AuxiliaryPanelRegistration) => {
			registrationsRef.current.set(panel.id, panel);
			refreshPanels();

			return () => {
				registrationsRef.current.delete(panel.id);
				targetsRef.current.delete(panel.id);
				if (activePanelRef.current === panel.id) setActive(null);
				refreshPanels();
			};
		},
		[refreshPanels, setActive],
	);

	const activatePanel = useCallback(
		(id: string) => {
			const next = registrationsRef.current.get(id);
			if (!next) return;

			const previousId = activePanelRef.current;
			if (previousId === id) return;
			if (previousId) {
				registrationsRef.current.get(previousId)?.onOpenChange(false);
			}
			setActive(id);
			next.onOpenChange(true);
		},
		[setActive],
	);

	const closePanel = useCallback(() => {
		const currentId = activePanelRef.current;
		if (!currentId) return;
		setActive(null);
		registrationsRef.current.get(currentId)?.onOpenChange(false);
	}, [setActive]);

	const syncPanelOpen = useCallback(
		(id: string, open: boolean) => {
			if (open) {
				const previousId = activePanelRef.current;
				if (previousId === id) return;
				if (previousId) {
					registrationsRef.current.get(previousId)?.onOpenChange(false);
				}
				setActive(id);
				return;
			}

			if (activePanelRef.current === id) setActive(null);
		},
		[setActive],
	);

	const panelTarget = useCallback(
		(id: string) => targetsRef.current.get(id) ?? null,
		[],
	);

	const setPanelTarget = useCallback(
		(id: string, target: HTMLDivElement | null) => {
			const previous = targetsRef.current.get(id) ?? null;
			if (previous === target) return;
			if (target) targetsRef.current.set(id, target);
			else targetsRef.current.delete(id);
			setTargetVersion((version) => version + 1);
		},
		[],
	);

	const value = useMemo<AuxiliarySidebarContextValue>(
		() => ({
			panels,
			activePanelId,
			lastActivePanelId,
			targetVersion,
			registerPanel,
			activatePanel,
			closePanel,
			syncPanelOpen,
			panelTarget,
			setPanelTarget,
		}),
		[
			panels,
			activePanelId,
			lastActivePanelId,
			targetVersion,
			registerPanel,
			activatePanel,
			closePanel,
			syncPanelOpen,
			panelTarget,
			setPanelTarget,
		],
	);

	return (
		<AuxiliarySidebarContext.Provider value={value}>
			{children}
		</AuxiliarySidebarContext.Provider>
	);
};
