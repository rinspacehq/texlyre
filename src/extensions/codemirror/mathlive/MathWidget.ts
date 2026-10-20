// src/extensions/codemirror/mathlive/MathWidget.ts
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';
import { WidgetType } from '@codemirror/view';
import type { EditorView } from '@codemirror/view';
import { MathfieldElement } from 'mathlive';

import { t } from '@/i18n';
import { EditIcon } from '../../../components/common/Icons';
import type { MathRegion } from './MathDetector';
import { SymbolSearchPanel } from './SymbolSearchPanel';

const renderIcon = (IconComponent: typeof EditIcon, props = {}) => {
	return renderToStaticMarkup(createElement(IconComponent, props));
};

export class MathPreviewWidget extends WidgetType {
	constructor(
		private region: MathRegion,
		private onEdit: () => void,
	) {
		super();
	}

	eq(other: MathPreviewWidget): boolean {
		return (
			this.region.replaceFrom === other.region.replaceFrom &&
			this.region.replaceTo === other.region.replaceTo &&
			this.region.content === other.region.content
		);
	}

	toDOM(): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.className = `cm-math-preview-overlay cm-math-${this.region.type}`;

		const mf = new MathfieldElement();
		mf.readOnly = true;
		mf.className = 'cm-math-preview-field';

		wrapper.appendChild(mf);

		const maxWidth = Math.min(600, window.innerWidth - 32);
		wrapper.style.maxWidth = `${maxWidth}px`;

		// MathLive only exposes menuItems while mounted. A deferred timer can
		// outlive a preview that was removed during ordinary cursor movement.
		mf.addEventListener('mount', () => {
			if (!mf.isConnected) return;
			mf.value = this.region.previewLatex ?? this.region.content;
			mf.menuItems = [];
		}, { once: true });

		const editBtn = document.createElement('button');
		editBtn.innerHTML = renderIcon(EditIcon, {});
		editBtn.className = 'cm-math-edit-btn';
		editBtn.title = t('Edit equation');

		editBtn.addEventListener('click', (e) => {
			e.preventDefault();
			e.stopPropagation();
			this.onEdit();
		});

		wrapper.appendChild(editBtn);

		return wrapper;
	}

	ignoreEvent(event: Event): boolean {
		return event.type === 'mousedown' || event.type === 'click';
	}
}

export class MathEditWidget extends WidgetType {
	private mathfield: MathfieldElement | null = null;

	constructor(
		private region: MathRegion,
		private view: EditorView,
		private onSave: (content: string) => void,
		private onCancel: () => void,
	) {
		super();
	}

	eq(_other: MathEditWidget): boolean {
		return false;
	}

	toDOM(): HTMLElement {
		const wrapper = document.createElement('div');
		wrapper.className = 'cm-math-editor-overlay';

		const mathfield = new MathfieldElement();
		const focusAtCreation = document.activeElement;
		mathfield.readOnly = false;
		mathfield.className = 'cm-math-editor-field';

		const buttonContainer = document.createElement('div');
		buttonContainer.className = 'cm-math-editor-buttons';

		const symbolBtn = document.createElement('button');
		symbolBtn.textContent = t('Symbols');
		symbolBtn.className =
			'cm-math-editor-btn cm-math-editor-btn-symbols button';

		const saveBtn = document.createElement('button');
		saveBtn.textContent = t('Save');
		saveBtn.className =
			'cm-math-editor-btn cm-math-editor-btn-save button primary';

		const cancelBtn = document.createElement('button');
		cancelBtn.textContent = t('Cancel');
		cancelBtn.className = 'cm-math-editor-btn cm-math-editor-btn-cancel button';

		let symbolPanel: SymbolSearchPanel | null = null;

		symbolBtn.addEventListener('click', () => {
			if (symbolPanel) {
				symbolPanel.destroy();
				symbolPanel = null;
				symbolBtn.classList.remove('active');
				return;
			}

			symbolPanel = new SymbolSearchPanel(
				this.region.fileType as 'latex' | 'typst',
				(command: string) => {
					mathfield.executeCommand(['insert', command]);
					mathfield.focus();
				},
			);
			symbolBtn.classList.add('active');
			wrapper.appendChild(symbolPanel.getElement());
		});

		saveBtn.addEventListener('click', () => {
			this.onSave(mathfield.value);
		});

		cancelBtn.addEventListener('click', () => {
			this.onCancel();
		});

		mathfield.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Escape') {
				e.preventDefault();
				e.stopPropagation();
				this.onCancel();
			}
		});

		buttonContainer.appendChild(symbolBtn);
		buttonContainer.appendChild(cancelBtn);
		buttonContainer.appendChild(saveBtn);

		wrapper.appendChild(mathfield);
		wrapper.appendChild(buttonContainer);
		this.mathfield = mathfield;

		mathfield.addEventListener('mount', () => {
			if (!mathfield.isConnected || this.mathfield !== mathfield) return;
			mathfield.value = this.region.content;
			const focused = document.activeElement;
			// Do not steal focus if the user already moved to a different input.
			if (focused === focusAtCreation || focused === document.body ||
				(focused !== null && wrapper.contains(focused))) mathfield.focus();
		}, { once: true });

		return wrapper;
	}

	destroy(): void {
		if (this.mathfield) {
			this.mathfield = null;
		}
	}

	ignoreEvent(): boolean {
		return true;
	}
}
