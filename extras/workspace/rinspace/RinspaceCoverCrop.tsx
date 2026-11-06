// SPDX-License-Identifier: AGPL-3.0-or-later
import type React from 'react';
import { useRef, useState } from 'react';

import { t } from '@/i18n';

import {
	coverCropRect,
	coverOutput,
	MAX_COVER_OUTPUT_BYTES,
	MAX_COVER_PIXELS,
} from './RinspaceCoverCropGeometry';
import type { ProjectKind } from './RinspaceProjectCreation';

interface Props {
	imageURL: string;
	kind: ProjectKind;
	onCancel: () => void;
	onUpload: (cropped: File) => Promise<void>;
}

const clamp = (value: number, minimum: number, maximum: number) =>
	Math.min(maximum, Math.max(minimum, value));

const RinspaceCoverCrop: React.FC<Props> = ({
	imageURL,
	kind,
	onCancel,
	onUpload,
}) => {
	const imageRef = useRef<HTMLImageElement>(null);
	const previewRef = useRef<HTMLButtonElement>(null);
	const dragRef = useRef<{ pointerId: number; x: number; y: number } | null>(
		null,
	);
	const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
	const [zoom, setZoom] = useState(1);
	const [focus, setFocus] = useState({ x: 50, y: 50 });
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState('');
	const output = coverOutput(kind);
	const validImage =
		dimensions.width > 0 &&
		dimensions.height > 0 &&
		dimensions.width * dimensions.height <= MAX_COVER_PIXELS;
	const crop = validImage
		? coverCropRect(
				dimensions.width,
				dimensions.height,
				output.aspect,
				zoom,
				focus.x,
				focus.y,
			)
		: null;
	const moveFocus = (deltaX: number, deltaY: number) =>
		setFocus((current) => ({
			x: clamp(current.x + deltaX, 0, 100),
			y: clamp(current.y + deltaY, 0, 100),
		}));
	const reset = () => {
		setZoom(1);
		setFocus({ x: 50, y: 50 });
	};
	const confirm = async () => {
		const image = imageRef.current;
		if (!image || !crop || busy) return;
		setBusy(true);
		setError('');
		try {
			const canvas = document.createElement('canvas');
			canvas.width = output.width;
			canvas.height = output.height;
			const context = canvas.getContext('2d');
			if (!context)
				throw new Error(t('Cover crop is unavailable in this browser.'));
			context.drawImage(
				image,
				crop.x,
				crop.y,
				crop.width,
				crop.height,
				0,
				0,
				output.width,
				output.height,
			);
			const blob = await new Promise<Blob | null>((resolve) =>
				canvas.toBlob(resolve, 'image/jpeg', 0.9),
			);
			if (!blob || blob.size === 0 || blob.size > MAX_COVER_OUTPUT_BYTES)
				throw new Error(
					t('The cropped cover is too large. Choose another image.'),
				);
			await onUpload(
				new File([blob], `rinspace-${kind}-cover.jpg`, { type: 'image/jpeg' }),
			);
		} catch (cause) {
			setError(
				cause instanceof Error ? cause.message : t('Cover upload failed'),
			);
		} finally {
			setBusy(false);
		}
	};

	return (
		<section
			className='rinspace-cover-crop'
			aria-labelledby='rinspace-cover-crop-title'
		>
			<div className='ui-toolbar' data-justify='between'>
				<div>
					<h3
						id='rinspace-cover-crop-title'
						className='ui-panel-title'
						data-size='body'
					>
						{t('Crop project cover')}
					</h3>
					<p id='rinspace-cover-crop-help' className='ui-meta'>
						{kind === 'article' ? '16:9 · 1600×900' : '2:3 · 900×1350'}
					</p>
				</div>
				<button
					type='button'
					className='button secondary'
					disabled={busy || !validImage}
					onClick={reset}
				>
					{t('Reset')}
				</button>
			</div>
			<button
				type='button'
				ref={previewRef}
				className='rinspace-cover-crop-preview'
				data-kind={kind}
				style={{ aspectRatio: String(output.aspect) }}
				aria-label={t('Cover crop preview')}
				aria-describedby='rinspace-cover-crop-help'
				onKeyDown={(event) => {
					const step = event.shiftKey ? 10 : 2;
					if (event.key === 'ArrowLeft') moveFocus(-step, 0);
					else if (event.key === 'ArrowRight') moveFocus(step, 0);
					else if (event.key === 'ArrowUp') moveFocus(0, -step);
					else if (event.key === 'ArrowDown') moveFocus(0, step);
					else if (event.key === '+' || event.key === '=')
						setZoom((value) => clamp(value + 0.05, 1, 3));
					else if (event.key === '-')
						setZoom((value) => clamp(value - 0.05, 1, 3));
					else return;
					event.preventDefault();
				}}
				onPointerDown={(event) => {
					if (!validImage || busy) return;
					event.currentTarget.setPointerCapture(event.pointerId);
					dragRef.current = {
						pointerId: event.pointerId,
						x: event.clientX,
						y: event.clientY,
					};
				}}
				onPointerMove={(event) => {
					const drag = dragRef.current;
					const preview = previewRef.current;
					if (!drag || drag.pointerId !== event.pointerId || !preview) return;
					const bounds = preview.getBoundingClientRect();
					moveFocus(
						(-(event.clientX - drag.x) / bounds.width) * 100,
						(-(event.clientY - drag.y) / bounds.height) * 100,
					);
					dragRef.current = {
						pointerId: event.pointerId,
						x: event.clientX,
						y: event.clientY,
					};
				}}
				onPointerUp={(event) => {
					if (dragRef.current?.pointerId === event.pointerId)
						dragRef.current = null;
					if (event.currentTarget.hasPointerCapture(event.pointerId))
						event.currentTarget.releasePointerCapture(event.pointerId);
				}}
			>
				<img
					ref={imageRef}
					src={imageURL}
					alt=''
					draggable={false}
					onLoad={(event) => {
						const { naturalWidth, naturalHeight } = event.currentTarget;
						setDimensions({ width: naturalWidth, height: naturalHeight });
						if (
							!naturalWidth ||
							!naturalHeight ||
							naturalWidth * naturalHeight > MAX_COVER_PIXELS
						)
							setError(t('This image is too large to crop in the browser.'));
					}}
					onError={() => setError(t('This image could not be opened.'))}
					style={
						crop
							? {
									width: `${(dimensions.width / crop.width) * 100}%`,
									height: `${(dimensions.height / crop.height) * 100}%`,
									left: `${(-crop.x / crop.width) * 100}%`,
									top: `${(-crop.y / crop.height) * 100}%`,
								}
							: undefined
					}
				/>
				<span className='rinspace-cover-crop-grid' aria-hidden='true' />
			</button>
			<label className='ui-field'>
				<span className='ui-field-label'>
					{t('Zoom')} · {zoom.toFixed(2)}×
				</span>
				<input
					type='range'
					min='1'
					max='3'
					step='0.05'
					value={zoom}
					disabled={busy || !validImage}
					onChange={(event) => setZoom(Number(event.target.value))}
				/>
			</label>
			{error && (
				<p className='ui-message' data-tone='error' role='alert'>
					{error}
				</p>
			)}
			<div className='ui-actions' data-variant='modal'>
				<button
					type='button'
					className='button secondary'
					aria-label={t('Cancel crop')}
					disabled={busy}
					onClick={onCancel}
				>
					{t('Choose another image')}
				</button>
				<button
					type='button'
					className='button primary'
					aria-label={t('Crop and upload cover')}
					disabled={busy || !validImage}
					onClick={() => void confirm()}
				>
					{busy ? t('Uploading cover...') : t('Use this crop')}
				</button>
			</div>
		</section>
	);
};

export default RinspaceCoverCrop;
