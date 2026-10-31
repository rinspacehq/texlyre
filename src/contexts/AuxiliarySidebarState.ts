import type React from 'react';
import { createContext } from 'react';

export interface AuxiliaryPanelRegistration {
	id: string;
	label: string;
	icon: React.ComponentType;
	order: number;
	onOpenChange(open: boolean): void;
}

export interface AuxiliarySidebarContextValue {
	panels: AuxiliaryPanelRegistration[];
	activePanelId: string | null;
	lastActivePanelId: string | null;
	targetVersion: number;
	registerPanel(panel: AuxiliaryPanelRegistration): () => void;
	activatePanel(id: string): void;
	closePanel(): void;
	syncPanelOpen(id: string, open: boolean): void;
	panelTarget(id: string): HTMLDivElement | null;
	setPanelTarget(id: string, target: HTMLDivElement | null): void;
}

export const AuxiliarySidebarContext =
	createContext<AuxiliarySidebarContextValue | null>(null);
