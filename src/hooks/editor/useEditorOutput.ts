// src/hooks/editor/useEditorOutput.ts
import { useCallback, useEffect, useMemo, useState } from 'react';

import { useAuth } from '../useAuth';
import { useSettings } from '../useSettings';
import { typesetterRegistryService } from '../../services/TypesetterRegistryService';
import type { TypesetterProvider } from '../../types/compilation';
import type { ProjectType } from '../../types/projects';

export const useEditorOutput = () => {
	const { getProjectById } = useAuth();
	const { getSetting } = useSettings();
	const [projectType, setProjectType] = useState<ProjectType>('latex');
	const [compilerId, setCompilerId] = useState<string | undefined>();
	const [activeFileName, setActiveFileName] = useState<string | undefined>();
	const [temporaryLatexExpand, setTemporaryLatexExpand] = useState(false);
	const [temporaryTypstExpand, setTemporaryTypstExpand] = useState(false);
	const [temporaryExternalExpand, setTemporaryExternalExpand] = useState(false);
	const autoExpandOutput =
		(getSetting('compilation-auto-expand-output')?.value as boolean) ?? true;

	const activeOutputProvider = useMemo(() => {
		if (!activeFileName) return undefined;
		const extension = activeFileName.split('.').pop() ?? '';
		const byExtension = typesetterRegistryService.getForExtension(
			extension,
			projectType,
		);
		const effectiveType =
			byExtension?.projectType ??
			typesetterRegistryService.getForProjectType(projectType)?.projectType ??
			projectType;
		return typesetterRegistryService.resolve(effectiveType, compilerId);
	}, [activeFileName, projectType, compilerId]);
	const showLatexOutput =
		activeOutputProvider?.id === 'internal:latex' || temporaryLatexExpand;
	const showTypstOutput =
		activeOutputProvider?.id === 'internal:typst' || temporaryTypstExpand;
	const activeExternalProvider: TypesetterProvider | null =
		activeOutputProvider && activeOutputProvider.source !== 'builtin'
			? activeOutputProvider
			: null;

	const setOutputForFileName = useCallback((name?: string) => {
		setActiveFileName(name);
	}, []);

	const handleLatexOutputExpand = useCallback(() => {
		if (!autoExpandOutput) return;
		setTemporaryLatexExpand(true);
	}, [autoExpandOutput]);

	const handleTypstOutputExpand = useCallback(() => {
		if (!autoExpandOutput) return;
		setTemporaryTypstExpand(true);
	}, [autoExpandOutput]);

	const handleExternalOutputExpand = useCallback(() => {
		if (!autoExpandOutput) return;
		setTemporaryExternalExpand(true);
	}, [autoExpandOutput]);

	const clearTemporaryLatexExpand = useCallback(() => {
		setTemporaryLatexExpand(false);
	}, []);

	const clearTemporaryTypstExpand = useCallback(() => {
		setTemporaryTypstExpand(false);
	}, []);

	const clearTemporaryExternalExpand = useCallback(() => {
		setTemporaryExternalExpand(false);
	}, []);

	useEffect(() => {
		const loadProjectType = async () => {
			const projectId = sessionStorage.getItem('currentProjectId');
			if (!projectId) return;

			const project = await getProjectById(projectId);
			if (project) {
				setProjectType(project.type || 'latex');
				setCompilerId(project.compilerId);
			}
		};

		void loadProjectType();
		document.addEventListener('project-metadata-updated', loadProjectType);
		return () =>
			document.removeEventListener('project-metadata-updated', loadProjectType);
	}, [getProjectById]);

	useEffect(() => {
		document.addEventListener('expand-latex-output', handleLatexOutputExpand);
		document.addEventListener('expand-typst-output', handleTypstOutputExpand);
		document.addEventListener(
			'expand-external-output',
			handleExternalOutputExpand,
		);

		return () => {
			document.removeEventListener(
				'expand-latex-output',
				handleLatexOutputExpand,
			);
			document.removeEventListener(
				'expand-typst-output',
				handleTypstOutputExpand,
			);
			document.removeEventListener(
				'expand-external-output',
				handleExternalOutputExpand,
			);
		};
	}, [
		handleLatexOutputExpand,
		handleTypstOutputExpand,
		handleExternalOutputExpand,
	]);

	return {
		projectType,
		showLatexOutput,
		showTypstOutput,
		activeExternalProvider,
		temporaryLatexExpand,
		temporaryTypstExpand,
		temporaryExternalExpand,
		setOutputForFileName,
		handleLatexOutputExpand,
		handleTypstOutputExpand,
		handleExternalOutputExpand,
		clearTemporaryLatexExpand,
		clearTemporaryTypstExpand,
		clearTemporaryExternalExpand,
	};
};
