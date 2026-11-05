// SPDX-License-Identifier: AGPL-3.0-or-later
import type React from 'react';
import { useRef, useState } from 'react';

import { t } from '@/i18n';

import { coverCropRect, coverOutput, MAX_COVER_OUTPUT_BYTES, MAX_COVER_PIXELS } from './RinspaceCoverCropGeometry';
import type { ProjectKind } from './RinspaceProjectCreation';

interface Props {
	imageURL: string;
	kind: ProjectKind;
	onCancel: () => void;
	onUpload: (cropped: File) => Promise<void>;
}

const RinspaceCoverCrop: React.FC<Props> = ({ imageURL, kind, onCancel, onUpload }) => {
	const imageRef = useRef<HTMLImageElement>(null);
	const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
	const [zoom, setZoom] = useState(1);
	const [horizontal, setHorizontal] = useState(50);
	const [vertical, setVertical] = useState(50);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const output = coverOutput(kind);
	const validImage = dimensions.width > 0 && dimensions.height > 0 &&
		dimensions.width * dimensions.height <= MAX_COVER_PIXELS;
	const crop = validImage
		? coverCropRect(dimensions.width, dimensions.height, output.aspect, zoom, horizontal, vertical)
		: null;
	const confirm = async () => {
		const image = imageRef.current;
		if (!image || !crop || busy) return;
		setBusy(true); setError('');
		try {
			const canvas = document.createElement('canvas');
			canvas.width = output.width; canvas.height = output.height;
			const context = canvas.getContext('2d');
			if (!context) throw new Error(t('Cover crop is unavailable in this browser.'));
			context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, output.width, output.height);
			const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
			if (!blob || blob.size === 0 || blob.size > MAX_COVER_OUTPUT_BYTES) {
				throw new Error(t('The cropped cover is too large. Choose another image.'));
			}
			await onUpload(new File([blob], `rinspace-${kind}-cover.jpg`, { type: 'image/jpeg' }));
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : t('Cover upload failed'));
		} finally {
			setBusy(false);
		}
	};
	return <section className='rinspace-cover-crop' aria-labelledby='rinspace-cover-crop-title'>
		<h3 id='rinspace-cover-crop-title'>{t('Crop project cover')}</h3>
		<p className='ui-meta'>{kind === 'article' ? '16:9 · 1600×900' : '2:3 · 900×1350'} · {t('The preview matches the uploaded crop.')}</p>
		{imageURL && <div className='rinspace-cover-crop-preview' data-kind={kind} style={{ aspectRatio: String(output.aspect) }} role='img' aria-label={t('Cover crop preview')}>
			<img ref={imageRef} src={imageURL} alt='' onLoad={(event) => {
				const { naturalWidth, naturalHeight } = event.currentTarget;
				setDimensions({ width: naturalWidth, height: naturalHeight });
				if (!naturalWidth || !naturalHeight || naturalWidth * naturalHeight > MAX_COVER_PIXELS) setError(t('This image is too large to crop in the browser.'));
			}} onError={() => setError(t('This image could not be opened.'))} style={crop ? {
				width: `${dimensions.width / crop.width * 100}%`,
				height: `${dimensions.height / crop.height * 100}%`,
				left: `${-crop.x / crop.width * 100}%`,
				top: `${-crop.y / crop.height * 100}%`,
			} : undefined} />
		</div>}
		<div className='rinspace-cover-crop-controls'>
			<label>{t('Zoom')}<input type='range' min='1' max='3' step='0.05' value={zoom} disabled={busy || !validImage} onChange={(event) => setZoom(Number(event.target.value))} /></label>
			<label>{t('Horizontal position')}<input type='range' min='0' max='100' value={horizontal} disabled={busy || !validImage} onChange={(event) => setHorizontal(Number(event.target.value))} /></label>
			<label>{t('Vertical position')}<input type='range' min='0' max='100' value={vertical} disabled={busy || !validImage} onChange={(event) => setVertical(Number(event.target.value))} /></label>
		</div>
		{error && <p className='ui-message' data-tone='error' role='alert'>{error}</p>}
		<div className='ui-toolbar-actions'>
			<button type='button' className='button secondary' disabled={busy} onClick={onCancel}>{t('Cancel crop')}</button>
			<button type='button' className='button primary' disabled={busy || !validImage} onClick={() => void confirm()}>{busy ? t('Uploading cover...') : t('Crop and upload cover')}</button>
		</div>
	</section>;
};

export default RinspaceCoverCrop;
