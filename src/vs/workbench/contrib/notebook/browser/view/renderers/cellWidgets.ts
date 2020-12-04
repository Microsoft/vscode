/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { CodiconLabel } from 'vs/base/browser/ui/codicons/codiconLabel';
import { WorkbenchActionExecutedClassification, WorkbenchActionExecutedEvent } from 'vs/base/common/actions';
import { stripCodicons } from 'vs/base/common/codicons';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { Emitter, Event } from 'vs/base/common/event';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { isWindows } from 'vs/base/common/platform';
import { extUri } from 'vs/base/common/resources';
import { ElementSizeObserver } from 'vs/editor/browser/config/elementSizeObserver';
import { IDimension } from 'vs/editor/common/editorCommon';
import { IModeService } from 'vs/editor/common/services/modeService';
import { localize } from 'vs/nls';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ChangeCellLanguageAction, INotebookCellActionContext } from 'vs/workbench/contrib/notebook/browser/contrib/coreActions';
import { ICellViewModel, INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { BaseCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/baseCellViewModel';
import { INotebookCellStatusBarService } from 'vs/workbench/contrib/notebook/common/notebookCellStatusBarService';
import { CellKind, CellStatusbarAlignment, INotebookCellStatusBarEntry } from 'vs/workbench/contrib/notebook/common/notebookCommon';


const $ = DOM.$;

export interface IClickTarget {
	type: ClickTargetType;
	event: MouseEvent;
}

export const enum ClickTargetType {
	Container = 0,
	CellStatus = 1,
	ContributedTextItem = 2,
	ContributedCommandItem = 3
}

export class CellEditorStatusBar extends Disposable {
	readonly cellStatusMessageContainer: HTMLElement;
	readonly cellRunStatusContainer: HTMLElement;
	readonly statusBarContainer: HTMLElement;
	readonly languageStatusBarItem: CellLanguageStatusBarItem;
	readonly durationContainer: HTMLElement;

	private readonly leftContributedItemsContainer: HTMLElement;
	private readonly rightContributedItemsContainer: HTMLElement;
	private readonly itemsDisposable: DisposableStore;

	private currentContext: INotebookCellActionContext | undefined;
	protected readonly _onDidClick: Emitter<IClickTarget> = this._register(new Emitter<IClickTarget>());
	readonly onDidClick: Event<IClickTarget> = this._onDidClick.event;

	constructor(
		container: HTMLElement,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@INotebookCellStatusBarService private readonly notebookCellStatusBarService: INotebookCellStatusBarService
	) {
		super();
		this.statusBarContainer = DOM.append(container, $('.cell-statusbar-container'));
		const leftItemsContainer = DOM.append(this.statusBarContainer, $('.cell-status-left'));
		const rightItemsContainer = DOM.append(this.statusBarContainer, $('.cell-status-right'));
		this.cellRunStatusContainer = DOM.append(leftItemsContainer, $('.cell-run-status'));
		this.durationContainer = DOM.append(leftItemsContainer, $('.cell-run-duration'));
		this.cellStatusMessageContainer = DOM.append(leftItemsContainer, $('.cell-status-message'));
		this.leftContributedItemsContainer = DOM.append(leftItemsContainer, $('.cell-contributed-items.cell-contributed-items-left'));
		this.rightContributedItemsContainer = DOM.append(rightItemsContainer, $('.cell-contributed-items.cell-contributed-items-right'));
		this.languageStatusBarItem = instantiationService.createInstance(CellLanguageStatusBarItem, rightItemsContainer);

		this.itemsDisposable = this._register(new DisposableStore());
		this._register(this.notebookCellStatusBarService.onDidChangeEntriesForCell(e => {
			if (this.currentContext && extUri.isEqual(e, this.currentContext.cell.uri)) {
				this.updateStatusBarItems();
			}
		}));

		this._register(DOM.addDisposableListener(this.statusBarContainer, DOM.EventType.CLICK, e => {
			if (e.target === leftItemsContainer || e.target === rightItemsContainer || e.target === this.statusBarContainer) {
				// hit on empty space
				this._onDidClick.fire({
					type: ClickTargetType.Container,
					event: e
				});
			} else if (e.target && (
				this.cellStatusMessageContainer.contains(e.target as Node)
				|| this.cellRunStatusContainer.contains(e.target as Node)
				|| this.durationContainer.contains(e.target as Node)
			)) {
				this._onDidClick.fire({
					type: ClickTargetType.CellStatus,
					event: e
				});
			} else {
				if ((e.target as HTMLElement).classList.contains('cell-status-item-has-command')) {
					this._onDidClick.fire({
						type: ClickTargetType.ContributedCommandItem,
						event: e
					});
				} else {
					// text
					this._onDidClick.fire({
						type: ClickTargetType.ContributedTextItem,
						event: e
					});
				}
			}
		}));
	}

	update(context: INotebookCellActionContext) {
		this.currentContext = context;
		this.languageStatusBarItem.update(context.cell, context.notebookEditor);
		this.updateStatusBarItems();
	}

	layout(width: number): void {
		this.statusBarContainer.style.width = `${width}px`;
	}

	private updateStatusBarItems() {
		if (!this.currentContext) {
			return;
		}

		DOM.clearNode(this.leftContributedItemsContainer);
		DOM.clearNode(this.rightContributedItemsContainer);
		this.itemsDisposable.clear();

		const items = this.notebookCellStatusBarService.getEntries(this.currentContext.cell.uri);
		items.sort((itemA, itemB) => {
			return (itemB.priority ?? 0) - (itemA.priority ?? 0);
		});
		items.forEach(item => {
			const itemView = this.itemsDisposable.add(this.instantiationService.createInstance(CellStatusBarItem, this.currentContext!, item));
			if (item.alignment === CellStatusbarAlignment.LEFT) {
				this.leftContributedItemsContainer.appendChild(itemView.container);
			} else {
				this.rightContributedItemsContainer.appendChild(itemView.container);
			}
		});
	}
}

class CellStatusBarItem extends Disposable {

	readonly container = $('.cell-status-item');

	constructor(
		private readonly _context: INotebookCellActionContext,
		private readonly _itemModel: INotebookCellStatusBarEntry,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ICommandService private readonly commandService: ICommandService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super();
		new CodiconLabel(this.container).text = this._itemModel.text;

		if (this._itemModel.opacity) {
			this.container.style.opacity = this._itemModel.opacity;
		}

		let ariaLabel: string;
		let role: string | undefined;
		if (this._itemModel.accessibilityInformation) {
			ariaLabel = this._itemModel.accessibilityInformation.label;
			role = this._itemModel.accessibilityInformation.role;
		} else {
			ariaLabel = this._itemModel.text ? stripCodicons(this._itemModel.text).trim() : '';
		}

		if (ariaLabel) {
			this.container.setAttribute('aria-label', ariaLabel);
		}

		if (role) {
			this.container.setAttribute('role', role);
		}

		this.container.title = this._itemModel.tooltip ?? '';

		if (this._itemModel.command) {
			this.container.classList.add('cell-status-item-has-command');
			this.container.tabIndex = 0;

			this._register(DOM.addDisposableListener(this.container, DOM.EventType.CLICK, _e => {
				this.executeCommand();
			}));
			this._register(DOM.addDisposableListener(this.container, DOM.EventType.KEY_UP, e => {
				const event = new StandardKeyboardEvent(e);
				if (event.equals(KeyCode.Space) || event.equals(KeyCode.Enter)) {
					this.executeCommand();
				}
			}));
		}
	}

	private async executeCommand(): Promise<void> {
		const command = this._itemModel.command;
		if (!command) {
			return;
		}

		const id = typeof command === 'string' ? command : command.id;
		const args = typeof command === 'string' ? [] : command.arguments ?? [];

		args.unshift(this._context);

		this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id, from: 'cell status bar' });
		try {
			await this.commandService.executeCommand(id, ...args);
		} catch (error) {
			this.notificationService.error(toErrorMessage(error));
		}
	}
}

export class CellLanguageStatusBarItem extends Disposable {
	private readonly labelElement: HTMLElement;

	private cell: ICellViewModel | undefined;
	private editor: INotebookEditor | undefined;

	private cellDisposables: DisposableStore;

	constructor(
		readonly container: HTMLElement,
		@IModeService private readonly modeService: IModeService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
		this.labelElement = DOM.append(container, $('.cell-language-picker.cell-status-item'));
		this.labelElement.tabIndex = 0;
		this.labelElement.classList.add('cell-status-item-has-command');

		this._register(DOM.addDisposableListener(this.labelElement, DOM.EventType.CLICK, () => {
			this.run();
		}));
		this._register(DOM.addDisposableListener(this.labelElement, DOM.EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Space) || event.equals(KeyCode.Enter)) {
				this.run();
			}
		}));
		this._register(this.cellDisposables = new DisposableStore());
	}

	private run() {
		this.instantiationService.invokeFunction(accessor => {
			if (!this.editor || !this.editor.hasModel() || !this.cell) {
				return;
			}
			new ChangeCellLanguageAction().run(accessor, { notebookEditor: this.editor, cell: this.cell });
		});
	}

	update(cell: ICellViewModel, editor: INotebookEditor): void {
		this.cellDisposables.clear();
		this.cell = cell;
		this.editor = editor;

		this.render();
		this.cellDisposables.add(this.cell.model.onDidChangeLanguage(() => this.render()));
	}

	private render(): void {
		const modeId = this.cell?.cellKind === CellKind.Markdown ? 'markdown' : this.modeService.getModeIdForLanguageName(this.cell!.language) || this.cell!.language;
		this.labelElement.textContent = this.modeService.getLanguageName(modeId) || this.modeService.getLanguageName('plaintext');
		this.labelElement.title = localize('notebook.cell.status.language', "Select Cell Language Mode");
	}
}

declare const ResizeObserver: any;

export interface IResizeObserver {
	startObserving: () => void;
	stopObserving: () => void;
	getWidth(): number;
	getHeight(): number;
	dispose(): void;
}

export class BrowserResizeObserver extends Disposable implements IResizeObserver {
	private readonly referenceDomElement: HTMLElement | null;

	private readonly observer: any;
	private width: number;
	private height: number;

	constructor(referenceDomElement: HTMLElement | null, dimension: IDimension | undefined, changeCallback: () => void) {
		super();

		this.referenceDomElement = referenceDomElement;
		this.width = -1;
		this.height = -1;

		this.observer = new ResizeObserver((entries: any) => {
			for (const entry of entries) {
				if (entry.target === referenceDomElement && entry.contentRect) {
					if (this.width !== entry.contentRect.width || this.height !== entry.contentRect.height) {
						this.width = entry.contentRect.width;
						this.height = entry.contentRect.height;
						DOM.scheduleAtNextAnimationFrame(() => {
							changeCallback();
						});
					}
				}
			}
		});
	}

	getWidth(): number {
		return this.width;
	}

	getHeight(): number {
		return this.height;
	}

	startObserving(): void {
		this.observer.observe(this.referenceDomElement!);
	}

	stopObserving(): void {
		this.observer.unobserve(this.referenceDomElement!);
	}

	dispose(): void {
		this.observer.disconnect();
		super.dispose();
	}
}

export function getResizesObserver(referenceDomElement: HTMLElement | null, dimension: IDimension | undefined, changeCallback: () => void): IResizeObserver {
	if (ResizeObserver) {
		return new BrowserResizeObserver(referenceDomElement, dimension, changeCallback);
	} else {
		return new ElementSizeObserver(referenceDomElement, dimension, changeCallback);
	}
}

export function getExecuteCellPlaceholder(viewCell: BaseCellViewModel) {
	return {
		alignment: CellStatusbarAlignment.LEFT,
		priority: -1,
		cellResource: viewCell.uri,
		command: undefined,
		// text: `${keybinding?.getLabel() || 'Ctrl + Enter'} to run`,
		// tooltip: `${keybinding?.getLabel() || 'Ctrl + Enter'} to run`,
		text: isWindows ? 'Ctrl + Alt + Enter' : 'Ctrl + Enter to run',
		tooltip: isWindows ? 'Ctrl + Alt + Enter' : 'Ctrl + Enter to run',
		visible: true,
		opacity: '0.7'
	};
}
