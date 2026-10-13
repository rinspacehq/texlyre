// src/components/project/ProjectImportModal.tsx
import type React from 'react';
import { useEffect, useRef, useState } from 'react';

import { t } from '@/i18n';
import {
	type ImportOptions,
	type ImportableProject,
	projectImportService,
} from '../../services/ProjectImportService';
import { authService } from '../../services/AuthService';
import { workspaceService } from '../../services/WorkspaceService';
import type { Project, TemplateProject } from '../../types/projects';
import { ARCHIVE_ACCEPT, isArchiveFile } from '../../utils/archiveUtils';
import { formatDate } from '../../utils/dateUtils';
import { type LocalZipProject, isTeXlyreBackupZip, prepareLocalZipProject } from '../../workspace/LocalZipImport';
import {
	UrlIcon,
	ShareIcon,
	ImportIcon,
	FolderOpenIcon,
	TemplatesIcon,
	ZipFileIcon,
} from '../common/Icons';
import Modal from '../common/Modal';
import TemplateImportModal from './TemplateImportModal';
import UrlImportModal from './UrlImportModal';
import YjsLinkImportModal from './YjsLinkImportModal';

interface ProjectImportModalProps {
	isOpen: boolean;
	onClose: () => void;
	onProjectsImported: () => void;
	onOpenProject: (docUrl: string) => void;
}

const ProjectImportModal: React.FC<ProjectImportModalProps> = ({
	isOpen,
	onClose,
	onProjectsImported,
	onOpenProject,
}) => {
	const [importSource, setImportSource] = useState<'template' | 'zip' | 'folder' | null>(
		null,
	);
	const [availableProjects, setAvailableProjects] = useState<
		ImportableProject[]
	>([]);
	const [selectedProjects, setSelectedProjects] = useState<Set<string>>(
		new Set(),
	);
	const [isScanning, setIsScanning] = useState(false);
	const [isImporting, setIsImporting] = useState(false);
	const [conflictResolution, setConflictResolution] = useState<
		'skip' | 'overwrite' | 'create-new'
	>('create-new');
	const [makeCollaborator, setMakeCollaborator] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [selectedZipFile, setSelectedZipFile] = useState<File | null>(null);
	const [localZipProject, setLocalZipProject] = useState<LocalZipProject | null>(null);
	const [showTemplateModal, setShowTemplateModal] = useState(false);
	const [showUrlModal, setShowUrlModal] = useState(false);
	const [showYjsLinkModal, setShowYjsLinkModal] = useState(false);
	const [folder, setFolder] = useState<FileSystemDirectoryHandle | null>(null);
	const [folderProject, setFolderProject] = useState<Project | null>(null);
	const folderOperation = useRef<AbortController | null>(null);
	useEffect(() => () => { folderOperation.current?.abort(); }, [isOpen]);

	const handleFolderImport = async (retryHandle?: FileSystemDirectoryHandle) => {
		if (folderOperation.current && !folderOperation.current.signal.aborted) return;
		const controller = new AbortController();
		folderOperation.current = controller;
		let handle = retryHandle ?? null;
		setError(null);
		setIsScanning(true);
		try {
			handle ??= await workspaceService.pickFolder();
			if (!handle || controller.signal.aborted) return;
			setFolder(handle);
			setImportSource('folder');
			await workspaceService.checkFolderAccess(handle, controller.signal);
			if (controller.signal.aborted) return;
			setIsScanning(false);
			setIsImporting(true);
			const previousProject = retryHandle ? folderProject : null;
			const project = previousProject ?? await authService.createProject({
				name: handle.name,
				description: t('Local project from an authorized folder'),
				// Compatibility metadata, not a language or preview target.
				type: 'files',
				group: 'files',
				docUrl: '',
				tags: [],
				isFavorite: false,
			});
			if (controller.signal.aborted) return;
			if (!previousProject) {
				setFolderProject(project);
				onProjectsImported();
			}
			await workspaceService.link(project.id, handle);
			if (controller.signal.aborted) return;
			setFolder(null);
			setFolderProject(null);
			setImportSource(null);
			onOpenProject(project.docUrl);
			onClose();
		} catch (error) {
			if (controller.signal.aborted || (!handle && error instanceof Error && error.name === 'AbortError')) return;
			setError(
				error instanceof Error ? error.message : t('Failed to link folder'),
			);
		} finally {
			if (folderOperation.current === controller) {
				folderOperation.current = null;
				setIsScanning(false);
				setIsImporting(false);
			}
		}
	};

	const handleTemplateImport = () => {
		setShowTemplateModal(true);
	};

	const handleUrlImport = () => {
		setShowUrlModal(true);
	};

	const handleYjsLinkImport = () => {
		setShowYjsLinkModal(true);
	};

	const handleYjsLinkSelect = (yjsUrl: string) => {
		window.location.hash = yjsUrl;
		window.location.reload();
	};
	const handleUrlImportSelect = async (data: {
		name: string;
		description: string;
		type: 'latex' | 'typst';
		tags: string[];
		zipUrl: string;
	}) => {
		try {
			setIsImporting(true);
			setError(null);

			const templateUrl = `${window.location.origin}${window.location.pathname}#newProjectName:${encodeURIComponent(data.name)}&newProjectDescription:${encodeURIComponent(data.description)}&newProjectType:${encodeURIComponent(data.type)}&newProjectTags:${encodeURIComponent(data.tags.join(','))}&newProjectFiles:${encodeURIComponent(data.zipUrl)}`;

			window.location.replace(templateUrl);
			window.location.reload();
		} catch (error) {
			setError(
				error instanceof Error ? error.message : t('Failed to import from URL'),
			);
		} finally {
			setIsImporting(false);
		}
	};

	const handleTemplateSelect = async (template: TemplateProject) => {
		try {
			setIsImporting(true);
			setError(null);

			const fileSuffix = template.file
				? `&file:${encodeURIComponent(template.file)}`
				: '';
			const compileSuffix = template.compile
				? `&compile:${encodeURIComponent(template.compile)}`
				: '';
			const typeSuffix = template.type
				? `&newProjectType:${encodeURIComponent(template.type)}`
				: '';
			const templateUrl = `${window.location.origin}${window.location.pathname}#newProjectName:${encodeURIComponent(template.name)}&newProjectDescription:${encodeURIComponent(template.description)}${typeSuffix}&newProjectTags:${encodeURIComponent(template.tags.join(','))}&newProjectFiles:${encodeURIComponent(template.downloadUrl)}${fileSuffix}${compileSuffix}`;

			window.location.replace(templateUrl);
			window.location.reload();
		} catch (error) {
			setError(
				error instanceof Error ? error.message : t('Failed to import template'),
			);
		} finally {
			setIsImporting(false);
		}
	};

	const handleZipFileSelect = async (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		const file = event.target.files?.[0];
		if (!file) return;
		if (!isArchiveFile(file.name)) {
			setError(t('Unsupported archive format'));
			return;
		}

		try {
			setIsScanning(true);
			setError(null);

			setSelectedZipFile(file);
			setLocalZipProject(null);

			if (file.name.toLowerCase().endsWith('.zip') && !(await isTeXlyreBackupZip(file))) {
				setAvailableProjects([]);
				setLocalZipProject(await prepareLocalZipProject(file));
			} else {
				const projects = await projectImportService.scanZipFile(file);
				if (projects.length === 0 && file.name.toLowerCase().endsWith('.zip')) {
					throw new Error(t('This TeXlyre backup could not be validated'));
				}
				setAvailableProjects(projects);
			}
			setImportSource('zip');
			setSelectedProjects(new Set());
		} catch (error) {
			setError(
				error instanceof Error
					? error.message
					: t('Error scanning archive file'),
			);
		} finally {
			setIsScanning(false);
		}
	};

	const handleLocalZipImport = async () => {
		if (!localZipProject) return;
		setIsImporting(true);
		setError(null);
		try {
			const project = await projectImportService.importLocalZipProject(localZipProject);
			document.dispatchEvent(new CustomEvent('projects-imported'));
			onProjectsImported();
			onOpenProject(project.docUrl);
			setImportSource(null);
			setSelectedZipFile(null);
			setLocalZipProject(null);
			if (fileInputRef.current) fileInputRef.current.value = '';
			onClose();
		} catch (error) {
			setError(error instanceof Error ? error.message : t('Import failed'));
		} finally {
			setIsImporting(false);
		}
	};

	const discardLocalZip = () => {
		setLocalZipProject(null);
		setSelectedZipFile(null);
		setImportSource(null);
		if (fileInputRef.current) fileInputRef.current.value = '';
	};

	const handleProjectToggle = (projectId: string) => {
		const newSelected = new Set(selectedProjects);
		if (newSelected.has(projectId)) {
			newSelected.delete(projectId);
		} else {
			newSelected.add(projectId);
		}
		setSelectedProjects(newSelected);
	};

	const handleSelectAll = () => {
		if (selectedProjects.size === availableProjects.length) {
			setSelectedProjects(new Set());
		} else {
			setSelectedProjects(new Set(availableProjects.map((p) => p.id)));
		}
	};

	const handleImport = async () => {
		if (selectedProjects.size === 0) return;

		try {
			setIsImporting(true);
			setError(null);

			const options: ImportOptions = {
				makeCollaborator,
				conflictResolution,
			};

			if (importSource !== 'zip') {
				throw new Error(t('Invalid import source'));
			}
			if (!selectedZipFile) {
				throw new Error(t('No archive file available for import'));
			}

			const result = await projectImportService.importFromZip(
				selectedZipFile,
				Array.from(selectedProjects),
				options,
			);

			if (result.errors.length > 0) {
				setError(
					t('Import completed with errors: {errors}', {
						errors: result.errors.map((e) => e.error).join(', '),
					}),
				);
			}

			if (result.imported.length > 0) {
				document.dispatchEvent(new CustomEvent('projects-imported'));
				onProjectsImported();
				onClose();
			}
		} catch (error) {
			setError(error instanceof Error ? error.message : t('Import failed'));
		} finally {
			setIsImporting(false);
		}
	};

	const handleClose = () => {
		if (isImporting) return;
		folderOperation.current?.abort();
		setFolder(null);
		setFolderProject(null);
		setImportSource(null);
		setAvailableProjects([]);
		setSelectedProjects(new Set());
		setSelectedZipFile(null);
		setLocalZipProject(null);
		setError(null);
		setIsScanning(false);
		setIsImporting(false);
		if (fileInputRef.current) {
			fileInputRef.current.value = '';
		}
		onClose();
	};

	const getOwnershipText = (project: ImportableProject) => {
		if (project.originalOwnerId === 'current-user-id') {
			return 'Owned by you';
		}
		return makeCollaborator
			? 'Will be imported as collaborator'
			: 'Will be imported as owner';
	};

	return (
		<>
			<Modal
				isOpen={isOpen}
				onClose={handleClose}
				title={t('Import Projects')}
				icon={ImportIcon}
				size='large'
			>
				<div className='ui-stack' data-gap='md'>
					{error && (
						<div
							className='ui-message'
							role='alert'
							data-tone='error'
							style={{ marginBottom: '1rem' }}
						>
							{error}
						</div>
					)}

					{!importSource && (
						<div className='import-source-selection'>
							<h3 className='ui-section-title'>{t('Choose Import Source')}</h3>

							<div className='import-options'>
								{workspaceService.isSupported() && (
									<button
										type='button'
										className='ui-choice-card'
										onClick={() => handleFolderImport()}
										disabled={isScanning || isImporting}
										style={{
											pointerEvents:
												isScanning || isImporting ? 'none' : 'auto',
											opacity: isScanning || isImporting ? 0.5 : 1,
										}}
									>
										<FolderOpenIcon />
										<div>
											<strong>{t('From a Folder on This Device')}</strong>
											<p>
												{t(
												'Read and edit files from a folder you authorize on this device',
												)}
											</p>
										</div>
									</button>
								)}
								{!workspaceService.isSupported() && (
									<p className='ui-message' data-tone='info'>
										{t('This browser cannot save directly to a local folder. Archive import creates a browser copy; downloads do not update the original folder.')}
									</p>
								)}

								<label
									className='ui-choice-card'
									onClick={handleTemplateImport}
									style={{
										pointerEvents: isScanning || isImporting ? 'none' : 'auto',
										opacity: isScanning || isImporting ? 0.5 : 1,
									}}
								>
									<TemplatesIcon />
									<div>
										<strong>{t('From Template Gallery')}</strong>
										<p>
											{t(
												'Browse and import project templates from the community',
											)}
										</p>
									</div>
								</label>

								<label
									className='ui-choice-card'
									onClick={handleYjsLinkImport}
									style={{
										pointerEvents: isScanning || isImporting ? 'none' : 'auto',
										opacity: isScanning || isImporting ? 0.5 : 1,
									}}
								>
									<ShareIcon />
									<div>
										<strong>{t('From TeXlyre Link')}</strong>
										<p>{t('Open a shared project using its TeXlyre link')}</p>
									</div>
								</label>

								<label
									className='ui-choice-card'
									onClick={handleUrlImport}
									style={{
										pointerEvents: isScanning || isImporting ? 'none' : 'auto',
										opacity: isScanning || isImporting ? 0.5 : 1,
									}}
								>
									<UrlIcon />
									<div>
										<strong>{t('From URL')}</strong>
										<p>
											{t(
												'Import from URL: GitHub, GitLab, Codeberg repositories or archive link',
											)}
										</p>
									</div>
								</label>

								<label className='ui-choice-card'>
									<ZipFileIcon />
									<div>
										<strong>{t('From Archive File')}</strong>
										<p>
											{t(
									'Import a TeXlyre backup or open an ordinary ZIP as a browser project',
											)}
										</p>
									</div>
									<input
										ref={fileInputRef}
										type='file'
										accept={ARCHIVE_ACCEPT}
										onChange={handleZipFileSelect}
										style={{ display: 'none' }}
										disabled={isScanning || isImporting}
									/>
								</label>
							</div>

							{isScanning && (
								<div className='ui-loading-state'>
									<div className='loading-spinner' />
									<p>{t('Scanning for projects...')}</p>
								</div>
							)}
						</div>
					)}

					{importSource === 'folder' && folder && (
						<div className='ui-stack' data-gap='md'>
							<h3 className='ui-section-title'>{folder.name}</h3>
							{(isScanning || isImporting) && <p>{t('Opening...')}</p>}
							{folderProject && (
								<p className='ui-message' data-tone='info'>
									{t('The browser project was created. Folder linking is not confirmed; retry or keep this project for recovery.')}
								</p>
							)}
							<div className='ui-actions'>
								<button type='button' className='button secondary' disabled={isScanning || isImporting}
									onClick={() => { setFolder(null); setFolderProject(null); setImportSource(null); setError(null); }}>
									{t('Choose Different Source')}
								</button>
								<button type='button' className='button primary' disabled={isScanning || isImporting}
									onClick={() => handleFolderImport(folder)}>
									{isScanning || isImporting ? t('Opening...') : t('Retry Opening Folder')}
								</button>
							</div>
						</div>
					)}

					{importSource === 'zip' && availableProjects.length > 0 && (
						<div className='ui-stack' data-gap='md'>
							<div className='ui-section-header'>
								<h3 className='ui-section-title'>
									{t('Available Projects (')}
									{availableProjects.length})
								</h3>
								<button
									type='button'
									className='button secondary'
									onClick={handleSelectAll}
									disabled={isImporting}
								>
									{selectedProjects.size === availableProjects.length
										? t('Deselect All')
										: t('Select All')}
								</button>
							</div>

							<div
								className='ui-card ui-stack'
								data-surface='accent'
								data-padding='md'
								data-gap='md'
							>
								<div className='ui-field'>
									<label>{t('Conflict resolution strategy:')}</label>
									<select
										value={conflictResolution}
										onChange={(e) =>
											setConflictResolution(
												e.target.value as 'skip' | 'overwrite' | 'create-new',
											)
										}
										disabled={isImporting}
									>
										<option value='skip'>{t('Skip existing projects')}</option>
										<option value='overwrite'>
											{t('Merge and overwrite existing projects')}
										</option>
										<option value='create-new'>
											{t('Create new projects (create new URLs on conflict)')}
										</option>
									</select>
								</div>

								<div className='ui-field'>
									<label className='checkbox-control'>
										<input
											type='checkbox'
											checked={makeCollaborator}
											onChange={(e) => setMakeCollaborator(e.target.checked)}
											disabled={isImporting}
										/>
										{t('Import as collaborator (preserve original ownership)')}
									</label>
								</div>
							</div>

							<div className='ui-list' data-scroll='medium'>
								{availableProjects.map((project) => (
									<div
										key={project.id}
										className='ui-list-item'
										data-appearance='flat'
										data-align='center'
										data-padding='md'
										data-interactive='true'
										data-selected={
											selectedProjects.has(project.id) ? 'true' : undefined
										}
										onClick={() =>
											!isImporting && handleProjectToggle(project.id)
										}
									>
										<input
											type='checkbox'
											checked={selectedProjects.has(project.id)}
											onChange={() => handleProjectToggle(project.id)}
											disabled={isImporting}
										/>

										<div
											className='ui-list-content'
											data-grow='true'
											data-gap='xs'
										>
											<strong>{project.name}</strong>
											<span className='ui-note'>
												{project.description || t('No description')}
											</span>
											<div className='ui-meta' data-layout='row'>
												<span>
													{t('Last Modified: {lastModified}', {
														lastModified: formatDate(project.lastModified),
													})}
												</span>
												<span>{getOwnershipText(project)}</span>
											</div>
										</div>
									</div>
								))}
							</div>

							<div
								className='ui-actions'
								data-variant='modal'
								data-align='end'
								data-cross='stretch'
							>
								<button
									type='button'
									className='button secondary'
									onClick={handleClose}
									disabled={isImporting}
								>
									{t('Cancel')}
								</button>
								<button
									type='button'
									className='button primary'
									onClick={handleImport}
									disabled={selectedProjects.size === 0 || isImporting}
								>
									{isImporting
										? 'Importing...'
										: `Import ${selectedProjects.size} Project${selectedProjects.size === 1 ? '' : 's'}`}
								</button>
							</div>
						</div>
					)}

					{importSource === 'zip' && localZipProject && !isScanning && (
						<div className='ui-stack' data-gap='md'>
							<h3 className='ui-section-title'>{localZipProject.name}</h3>
							<p className='ui-message' data-tone='info'>
								{t('This ZIP will open as a browser copy. Editing it does not change the original ZIP or a local folder; export or download your work to keep a separate copy.')}
							</p>
							<p>{localZipProject.fileCount} {t('files ready to import')}</p>
							{localZipProject.skippedProtectedCount > 0 && <p>{localZipProject.skippedProtectedCount} {t('protected archive entries were skipped')}</p>}
							<div className='ui-actions'>
								<button type='button' className='button secondary' disabled={isImporting} onClick={discardLocalZip}>{t('Choose Different Source')}</button>
								<button type='button' className='button primary' disabled={isImporting} onClick={handleLocalZipImport}>{isImporting ? t('Importing...') : t('Open Browser Copy')}</button>
							</div>
						</div>
					)}

					{importSource === 'zip' && availableProjects.length === 0 && !localZipProject && !isScanning && (
						<div className='ui-empty-state'>
							<p>
								{t('No importable projects found in the selected archive.')}
							</p>
							<button
								type='button'
								className='button secondary'
								onClick={() => setImportSource(null)}
							>
								{t('Choose Different Source')}
							</button>
						</div>
					)}
				</div>
			</Modal>

			<TemplateImportModal
				isOpen={showTemplateModal}
				onClose={() => setShowTemplateModal(false)}
				onTemplateSelected={handleTemplateSelect}
			/>

			<UrlImportModal
				isOpen={showUrlModal}
				onClose={() => setShowUrlModal(false)}
				onUrlImport={handleUrlImportSelect}
			/>

			<YjsLinkImportModal
				isOpen={showYjsLinkModal}
				onClose={() => setShowYjsLinkModal(false)}
				onYjsLinkOpen={handleYjsLinkSelect}
			/>
		</>
	);
};

export default ProjectImportModal;
