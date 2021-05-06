/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { SimpleIconLabel } from 'vs/base/browser/ui/iconLabel/simpleIconLabel';
import { WorkbenchActionExecutedClassification, WorkbenchActionExecutedEvent } from 'vs/base/common/actions';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { Emitter, Event } from 'vs/base/common/event';
import { stripIcons } from 'vs/base/common/iconLabels';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Disposable, DisposableStore, dispose } from 'vs/base/common/lifecycle';
import { ElementSizeObserver } from 'vs/editor/browser/config/elementSizeObserver';
import { IDimension, isThemeColor } from 'vs/editor/common/editorCommon';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService, ThemeColor } from 'vs/platform/theme/common/themeService';
import { INotebookCellActionContext } from 'vs/workbench/contrib/notebook/browser/contrib/coreActions';
import { CodeCellLayoutInfo, MarkdownCellLayoutInfo } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CellStatusbarAlignment, INotebookCellStatusBarItem } from 'vs/workbench/contrib/notebook/common/notebookCommon';

const $ = DOM.$;

export interface IClickTarget {
	type: ClickTargetType;
	event: MouseEvent;
}

export const enum ClickTargetType {
	Container = 0,
	ContributedTextItem = 1,
	ContributedCommandItem = 2
}

export class CellEditorStatusBar extends Disposable {
	readonly statusBarContainer: HTMLElement;

	private readonly leftItemsContainer: HTMLElement;
	private readonly rightItemsContainer: HTMLElement;
	private readonly itemsDisposable: DisposableStore;

	private leftItems: CellStatusBarItem[] = [];
	private rightItems: CellStatusBarItem[] = [];
	private width: number = 0;

	private currentContext: INotebookCellActionContext | undefined;
	protected readonly _onDidClick: Emitter<IClickTarget> = this._register(new Emitter<IClickTarget>());
	readonly onDidClick: Event<IClickTarget> = this._onDidClick.event;

	constructor(
		container: HTMLElement,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IThemeService private readonly _themeService: IThemeService,
	) {
		super();
		this.statusBarContainer = DOM.append(container, $('.cell-statusbar-container'));
		this.statusBarContainer.tabIndex = -1;
		const leftItemsContainer = DOM.append(this.statusBarContainer, $('.cell-status-left'));
		const rightItemsContainer = DOM.append(this.statusBarContainer, $('.cell-status-right'));
		this.leftItemsContainer = DOM.append(leftItemsContainer, $('.cell-contributed-items.cell-contributed-items-left'));
		this.rightItemsContainer = DOM.append(rightItemsContainer, $('.cell-contributed-items.cell-contributed-items-right'));

		this.itemsDisposable = this._register(new DisposableStore());

		this._register(this._themeService.onDidColorThemeChange(() => this.currentContext && this.update(this.currentContext)));

		this._register(DOM.addDisposableListener(this.statusBarContainer, DOM.EventType.CLICK, e => {
			if (e.target === leftItemsContainer || e.target === rightItemsContainer || e.target === this.statusBarContainer) {
				// hit on empty space
				this._onDidClick.fire({
					type: ClickTargetType.Container,
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

	private layout(): void {
		if (!this.currentContext) {
			return;
		}

		// TODO@roblou maybe more props should be in common layoutInfo?
		const layoutInfo = this.currentContext.cell.layoutInfo as CodeCellLayoutInfo | MarkdownCellLayoutInfo;
		const width = layoutInfo.editorWidth;
		if (!width) {
			return;
		}

		this.width = width;
		this.statusBarContainer.style.width = `${width}px`;

		const maxItemWidth = this.getMaxItemWidth();
		this.leftItems.forEach(item => item.maxWidth = maxItemWidth);
		this.rightItems.forEach(item => item.maxWidth = maxItemWidth);
	}

	private getMaxItemWidth() {
		return this.width / 2;
	}

	update(context: INotebookCellActionContext) {
		this.currentContext = context;
		this.itemsDisposable.clear();

		if (!this.currentContext) {
			return;
		}

		this.itemsDisposable.add(this.currentContext.cell.onDidChangeLayout(() => this.layout()));
		this.itemsDisposable.add(this.currentContext.cell.onDidChangeCellStatusBarItems(() => this.updateRenderedItems()));
		this.itemsDisposable.add(this.currentContext.notebookEditor.onDidChangeActiveCell(() => this.updateActiveCell()));
		this.layout();
		this.updateActiveCell();
		this.updateRenderedItems();
	}

	private updateActiveCell(): void {
		const isActiveCell = this.currentContext!.notebookEditor.getActiveCell() === this.currentContext?.cell;
		this.statusBarContainer.classList.toggle('is-active-cell', isActiveCell);
	}

	private updateRenderedItems(): void {
		const items = this.currentContext!.cell.getCellStatusBarItems();
		items.sort((itemA, itemB) => {
			return (itemB.priority ?? 0) - (itemA.priority ?? 0);
		});

		const maxItemWidth = this.getMaxItemWidth();
		const newLeftItems = items.filter(item => item.alignment === CellStatusbarAlignment.Left);
		const newRightItems = items.filter(item => item.alignment === CellStatusbarAlignment.Right).reverse();

		const updateItems = (renderedItems: CellStatusBarItem[], newItems: INotebookCellStatusBarItem[], container: HTMLElement) => {
			if (renderedItems.length > newItems.length) {
				const deleted = renderedItems.splice(newItems.length, renderedItems.length - newItems.length);
				for (let deletedItem of deleted) {
					container.removeChild(deletedItem.container);
					deletedItem.dispose();
				}
			}

			newItems.forEach((newLeftItem, i) => {
				const existingItem = renderedItems[i];
				if (existingItem) {
					existingItem.updateItem(newLeftItem, maxItemWidth);
				} else {
					const item = this._instantiationService.createInstance(CellStatusBarItem, this.currentContext!, newLeftItem, maxItemWidth);
					renderedItems.push(item);
					container.appendChild(item.container);
				}
			});
		};

		updateItems(this.leftItems, newLeftItems, this.leftItemsContainer);
		updateItems(this.rightItems, newRightItems, this.rightItemsContainer);
	}

	override dispose() {
		super.dispose();
		dispose(this.leftItems);
		dispose(this.rightItems);
	}
}

class CellStatusBarItem extends Disposable {

	readonly container = $('.cell-status-item');

	set maxWidth(v: number) {
		this.container.style.maxWidth = v + 'px';
	}

	private _currentItem!: INotebookCellStatusBarItem;
	private _itemDisposables = this._register(new DisposableStore());

	constructor(
		private readonly _context: INotebookCellActionContext,
		itemModel: INotebookCellStatusBarItem,
		maxWidth: number | undefined,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ICommandService private readonly _commandService: ICommandService,
		@INotificationService private readonly _notificationService: INotificationService,
		@IThemeService private readonly _themeService: IThemeService,
	) {
		super();

		this.updateItem(itemModel, maxWidth);
	}

	updateItem(item: INotebookCellStatusBarItem, maxWidth: number | undefined) {
		this._itemDisposables.clear();

		if (!this._currentItem || this._currentItem.text !== item.text) {
			new SimpleIconLabel(this.container).text = item.text.replace(/\n/g, ' ');
		}

		const resolveColor = (color: ThemeColor | string) => {
			return isThemeColor(color) ?
				(this._themeService.getColorTheme().getColor(color.id)?.toString() || '') :
				color;
		};

		this.container.style.color = item.color ? resolveColor(item.color) : '';
		this.container.style.backgroundColor = item.backgroundColor ? resolveColor(item.backgroundColor) : '';
		this.container.style.opacity = item.opacity ? item.opacity : '';

		this.container.classList.toggle('cell-status-item-show-when-active', !!item.onlyShowWhenActive);

		if (typeof maxWidth === 'number') {
			this.maxWidth = maxWidth;
		}

		let ariaLabel: string;
		let role: string | undefined;
		if (item.accessibilityInformation) {
			ariaLabel = item.accessibilityInformation.label;
			role = item.accessibilityInformation.role;
		} else {
			ariaLabel = item.text ? stripIcons(item.text).trim() : '';
		}

		this.container.setAttribute('aria-label', ariaLabel);
		this.container.setAttribute('role', role || '');
		this.container.title = item.tooltip ?? '';

		this.container.classList.toggle('cell-status-item-has-command', !!item.command);
		if (item.command) {
			this.container.tabIndex = 0;

			this._itemDisposables.add(DOM.addDisposableListener(this.container, DOM.EventType.CLICK, _e => {
				this.executeCommand();
			}));
			this._itemDisposables.add(DOM.addDisposableListener(this.container, DOM.EventType.KEY_DOWN, e => {
				const event = new StandardKeyboardEvent(e);
				if (event.equals(KeyCode.Space) || event.equals(KeyCode.Enter)) {
					this.executeCommand();
				}
			}));
		} else {
			this.container.tabIndex = -1;
		}

		this._currentItem = item;
	}

	private async executeCommand(): Promise<void> {
		const command = this._currentItem.command;
		if (!command) {
			return;
		}

		const id = typeof command === 'string' ? command : command.id;
		const args = typeof command === 'string' ? [] : command.arguments ?? [];

		args.unshift(this._context);

		this._telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id, from: 'cell status bar' });
		try {
			await this._commandService.executeCommand(id, ...args);
		} catch (error) {
			this._notificationService.error(toErrorMessage(error));
		}
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

	override dispose(): void {
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
