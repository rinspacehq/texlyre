import { useContext } from 'react';

import { AuxiliarySidebarContext } from '../contexts/AuxiliarySidebarState';

export function useAuxiliarySidebar() {
	const context = useContext(AuxiliarySidebarContext);
	if (!context) {
		throw new Error(
			'useAuxiliarySidebar must be used within an AuxiliarySidebarProvider',
		);
	}
	return context;
}
