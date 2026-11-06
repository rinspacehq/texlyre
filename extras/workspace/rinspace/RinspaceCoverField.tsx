// SPDX-License-Identifier: AGPL-3.0-or-later
import type React from 'react';
import { useEffect, useRef, useState } from 'react';
import { t } from '@/i18n';
import RinspaceCoverCrop from './RinspaceCoverCrop';
import { MAX_COVER_INPUT_BYTES } from './RinspaceCoverCropGeometry';
import { uploadProjectCover, type ProjectKind } from './RinspaceProjectCreation';

interface Props { actorId: string; disabled?: boolean; kind: ProjectKind; value: string; onChange(value: string): void; onBusyChange?(busy: boolean): void; }
const accepted = ['image/png', 'image/jpeg', 'image/webp'];

const RinspaceCoverField: React.FC<Props> = ({ actorId, disabled = false, kind, value, onChange, onBusyChange }) => {
	const inputRef = useRef<HTMLInputElement>(null);
	const objectURL = useRef('');
	const [pending, setPending] = useState('');
	const [dragging, setDragging] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	useEffect(() => () => { if (objectURL.current) URL.revokeObjectURL(objectURL.current); }, []);
	const choose = (file?: File) => {
		if (!file) return;
		if (!accepted.includes(file.type) || file.size === 0 || file.size > MAX_COVER_INPUT_BYTES) { setError(t('Choose a PNG, JPEG or WebP image under 20 MiB.')); return; }
		if (objectURL.current) URL.revokeObjectURL(objectURL.current);
		objectURL.current = URL.createObjectURL(file); setPending(objectURL.current); setError('');
	};
	const closePending = () => { if (objectURL.current) URL.revokeObjectURL(objectURL.current); objectURL.current = ''; setPending(''); };
	const setWorking = (next: boolean) => { setBusy(next); onBusyChange?.(next); };
	return <div className='ui-stack rinspace-cover-field' data-gap='sm' onPaste={(event) => { const file = [...event.clipboardData.files].find((entry) => accepted.includes(entry.type)); if (file) { event.preventDefault(); choose(file); } }}>
		{!pending && <button type='button' className='rinspace-cover-dropzone' data-dragging={dragging ? 'true' : 'false'} disabled={disabled || busy} onClick={() => inputRef.current?.click()} onDragEnter={(event) => { event.preventDefault(); setDragging(true); }} onDragOver={(event) => event.preventDefault()} onDragLeave={() => setDragging(false)} onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files[0]); }}><strong>{value ? t('Replace cover image') : t('Add a cover image')}</strong><span>{t('Click, drop, or paste PNG, JPEG, or WebP (max 20 MiB)')}</span></button>}
		<input ref={inputRef} className='rinspace-cover-file-input' type='file' tabIndex={-1} aria-label={t('Cover image (optional)')} accept={accepted.join(',')} onChange={(event) => { choose(event.target.files?.[0]); event.target.value = ''; }} />
		{value && !pending && <div className='rinspace-cover-current'><img src={value} alt={t('Current project cover')} /><div className='ui-toolbar' data-justify='between'><span className='ui-meta'>{t('Current cover')}</span><button type='button' className='button secondary' disabled={disabled || busy} onClick={() => onChange('')}>{t('Remove cover')}</button></div></div>}
		{pending && <RinspaceCoverCrop imageURL={pending} kind={kind} onCancel={closePending} onUpload={async (cropped) => { const controller = new AbortController(); setWorking(true); setError(''); try { onChange(await uploadProjectCover(cropped, controller.signal, actorId)); closePending(); } catch (cause) { setError(cause instanceof Error ? cause.message : t('Cover upload failed')); } finally { setWorking(false); } }} />}
		{error && <p className='ui-message' data-tone='error' role='alert'>{error}</p>}
	</div>;
};

export default RinspaceCoverField;
