/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { BreadcrumbsItem, BreadcrumbsWidget, IBreadcrumbsItemEvent } from 'vs/base/browser/ui/breadcrumbs/breadcrumbsWidget';
import { tail } from 'vs/base/common/arrays';
import { timeout } from 'vs/base/common/async';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { combinedDisposable, DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { extUri } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import 'vs/css!./media/breadcrumbscontrol';
import { localize } from 'vs/nls';
import { MenuId, MenuRegistry } from 'vs/platform/actions/common/actions';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { FileKind, IFileService, IFileStat } from 'vs/platform/files/common/files';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IListService, WorkbenchDataTree, WorkbenchListFocusContextKey } from 'vs/platform/list/browser/listService';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { ColorIdentifier, ColorTransform } from 'vs/platform/theme/common/colorRegistry';
import { attachBreadcrumbsStyler } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { ResourceLabel } from 'vs/workbench/browser/labels';
import { BreadcrumbsConfig, IBreadcrumbsService } from 'vs/workbench/browser/parts/editor/breadcrumbs';
import { BreadcrumbsModel, FileElement, OutlineElement2 } from 'vs/workbench/browser/parts/editor/breadcrumbsModel';
import { BreadcrumbsFilePicker, BreadcrumbsOutlinePicker, BreadcrumbsPicker } from 'vs/workbench/browser/parts/editor/breadcrumbsPicker';
import { IEditorPartOptions, EditorResourceAccessor, SideBySideEditor } from 'vs/workbench/common/editor';
import { ACTIVE_GROUP, ACTIVE_GROUP_TYPE, IEditorService, SIDE_GROUP, SIDE_GROUP_TYPE } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IEditorGroupView } from 'vs/workbench/browser/parts/editor/editor';
import { onDidChangeZoomLevel } from 'vs/base/browser/browser';
import { ILabelService } from 'vs/platform/label/common/label';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { ITreeNode } from 'vs/base/browser/ui/tree/tree';
import { IOutline } from 'vs/workbench/services/outline/browser/outline';

class OutlineItem extends BreadcrumbsItem {

	private readonly _disposables = new DisposableStore();

	constructor(
		readonly model: BreadcrumbsModel,
		readonly element: OutlineElement2,
		readonly options: IBreadcrumbsControlOptions
	) {
		super();
	}

	override dispose(): void {
		this._disposables.dispose();
	}

	equals(other: BreadcrumbsItem): boolean {
		if (!(other instanceof OutlineItem)) {
			return false;
		}
		return this.element === other.element &&
			this.options.showFileIcons === other.options.showFileIcons &&
			this.options.showSymbolIcons === other.options.showSymbolIcons;
	}

	render(container: HTMLElement): void {
		const { element, outline } = this.element;

		if (element === outline) {
			const element = dom.$('span', undefined, '…');
			container.appendChild(element);
			return;
		}

		const templateId = outline.config.delegate.getTemplateId(element);
		const renderer = outline.config.renderers.find(renderer => renderer.templateId === templateId);
		if (!renderer) {
			container.innerText = '<<NO RENDERER>>';
			return;
		}

		const template = renderer.renderTemplate(container);
		renderer.renderElement(<ITreeNode<any, any>>{
			element,
			children: [],
			depth: 0,
			visibleChildrenCount: 0,
			visibleChildIndex: 0,
			collapsible: false,
			collapsed: false,
			visible: true,
			filterData: undefined
		}, 0, template, undefined);

		this._disposables.add(toDisposable(() => { renderer.disposeTemplate(template); }));
	}

}

class FileItem extends BreadcrumbsItem {

	private readonly _disposables = new DisposableStore();

	constructor(
		readonly model: BreadcrumbsModel,
		readonly element: FileElement,
		readonly options: IBreadcrumbsControlOptions,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();
	}

	override dispose(): void {
		this._disposables.dispose();
	}

	equals(other: BreadcrumbsItem): boolean {
		if (!(other instanceof FileItem)) {
			return false;
		}
		return (extUri.isEqual(this.element.uri, other.element.uri) &&
			this.options.showFileIcons === other.options.showFileIcons &&
			this.options.showSymbolIcons === other.options.showSymbolIcons);

	}

	render(container: HTMLElement): void {
		// file/folder
		let label = this._instantiationService.createInstance(ResourceLabel, container, {});
		label.element.setFile(this.element.uri, {
			hidePath: true,
			hideIcon: this.element.kind === FileKind.FOLDER || !this.options.showFileIcons,
			fileKind: this.element.kind,
			fileDecorations: { colors: this.options.showDecorationColors, badges: false },
		});
		container.classList.add(FileKind[this.element.kind].toLowerCase());
		this._disposables.add(label);
	}
}

export interface IBreadcrumbsControlOptions {
	showFileIcons: boolean;
	showSymbolIcons: boolean;
	showDecorationColors: boolean;
	breadcrumbsBackground: ColorIdentifier | ColorTransform;
	showPlaceholder: boolean;
}

export class BreadcrumbsControl {

	static readonly HEIGHT = 22;

	private static readonly SCROLLBAR_SIZES = {
		default: 3,
		large: 8
	};

	static readonly Payload_Reveal = {};
	static readonly Payload_RevealAside = {};
	static readonly Payload_Pick = {};

	static readonly CK_BreadcrumbsPossible = new RawContextKey('breadcrumbsPossible', false, localize('breadcrumbsPossible', "Whether the editor can show breadcrumbs"));
	static readonly CK_BreadcrumbsVisible = new RawContextKey('breadcrumbsVisible', false, localize('breadcrumbsVisible', "Whether breadcrumbs are currently visible"));
	static readonly CK_BreadcrumbsActive = new RawContextKey('breadcrumbsActive', false, localize('breadcrumbsActive', "Whether breadcrumbs have focus"));

	private readonly _ckBreadcrumbsPossible: IContextKey<boolean>;
	private readonly _ckBreadcrumbsVisible: IContextKey<boolean>;
	private readonly _ckBreadcrumbsActive: IContextKey<boolean>;

	private readonly _cfUseQuickPick: BreadcrumbsConfig<boolean>;
	private readonly _cfShowIcons: BreadcrumbsConfig<boolean>;
	private readonly _cfTitleScrollbarSizing: BreadcrumbsConfig<IEditorPartOptions['titleScrollbarSizing']>;

	readonly domNode: HTMLDivElement;
	private readonly _widget: BreadcrumbsWidget;

	private readonly _disposables = new DisposableStore();
	private readonly _breadcrumbsDisposables = new DisposableStore();
	private _breadcrumbsPickerShowing = false;
	private _breadcrumbsPickerIgnoreOnceItem: BreadcrumbsItem | undefined;

	constructor(
		container: HTMLElement,
		private readonly _options: IBreadcrumbsControlOptions,
		private readonly _editorGroup: IEditorGroupView,
		@IContextKeyService private readonly _contextKeyService: IContextKeyService,
		@IContextViewService private readonly _contextViewService: IContextViewService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IThemeService private readonly _themeService: IThemeService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@IFileService private readonly _fileService: IFileService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@IEditorService private readonly _editorService: IEditorService,
		@ILabelService private readonly _labelService: ILabelService,
		@IConfigurationService configurationService: IConfigurationService,
		@IBreadcrumbsService breadcrumbsService: IBreadcrumbsService,
	) {
		this.domNode = document.createElement('div');
		this.domNode.classList.add('breadcrumbs-control');
		dom.append(container, this.domNode);

		this._cfUseQuickPick = BreadcrumbsConfig.UseQuickPick.bindTo(configurationService);
		this._cfShowIcons = BreadcrumbsConfig.Icons.bindTo(configurationService);
		this._cfTitleScrollbarSizing = BreadcrumbsConfig.TitleScrollbarSizing.bindTo(configurationService);

		const sizing = this._cfTitleScrollbarSizing.getValue() ?? 'default';
		this._widget = new BreadcrumbsWidget(this.domNode, BreadcrumbsControl.SCROLLBAR_SIZES[sizing]);
		this._widget.onDidSelectItem(this._onSelectEvent, this, this._disposables);
		this._widget.onDidFocusItem(this._onFocusEvent, this, this._disposables);
		this._widget.onDidChangeFocus(this._updateCkBreadcrumbsActive, this, this._disposables);
		this._disposables.add(attachBreadcrumbsStyler(this._widget, this._themeService, { breadcrumbsBackground: _options.breadcrumbsBackground }));

		this._ckBreadcrumbsPossible = BreadcrumbsControl.CK_BreadcrumbsPossible.bindTo(this._contextKeyService);
		this._ckBreadcrumbsVisible = BreadcrumbsControl.CK_BreadcrumbsVisible.bindTo(this._contextKeyService);
		this._ckBreadcrumbsActive = BreadcrumbsControl.CK_BreadcrumbsActive.bindTo(this._contextKeyService);

		this._disposables.add(breadcrumbsService.register(this._editorGroup.id, this._widget));
		this.hide();
	}

	dispose(): void {
		this._disposables.dispose();
		this._breadcrumbsDisposables.dispose();
		this._ckBreadcrumbsPossible.reset();
		this._ckBreadcrumbsVisible.reset();
		this._ckBreadcrumbsActive.reset();
		this._cfUseQuickPick.dispose();
		this._cfShowIcons.dispose();
		this._widget.dispose();
		this.domNode.remove();
	}

	layout(dim: dom.Dimension | undefined): void {
		this._widget.layout(dim);
	}

	isHidden(): boolean {
		return this.domNode.classList.contains('hidden');
	}

	hide(): void {
		this._breadcrumbsDisposables.clear();
		this._ckBreadcrumbsVisible.set(false);
		this.domNode.classList.toggle('hidden', true);
	}

	update(): boolean {
		this._breadcrumbsDisposables.clear();

		// honor diff editors and such
		const uri = EditorResourceAccessor.getCanonicalUri(this._editorGroup.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
		const wasHidden = this.isHidden();

		if (!uri || !this._fileService.canHandleResource(uri)) {
			// cleanup and return when there is no input or when
			// we cannot handle this input
			this._ckBreadcrumbsPossible.set(false);
			if (!wasHidden) {
				this.hide();
				return true;
			} else {
				return false;
			}
		}

		// display uri which can be derived from certain inputs
		const fileInfoUri = EditorResourceAccessor.getOriginalUri(this._editorGroup.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });

		this.domNode.classList.toggle('hidden', false);
		this._ckBreadcrumbsVisible.set(true);
		this._ckBreadcrumbsPossible.set(true);

		const model = this._instantiationService.createInstance(BreadcrumbsModel,
			fileInfoUri ?? uri,
			this._editorGroup.activeEditorPane
		);

		this.domNode.classList.toggle('relative-path', model.isRelative());
		this.domNode.classList.toggle('backslash-path', this._labelService.getSeparator(uri.scheme, uri.authority) === '\\');

		const updateBreadcrumbs = () => {
			const showIcons = this._cfShowIcons.getValue();
			const options: IBreadcrumbsControlOptions = {
				...this._options,
				showFileIcons: this._options.showFileIcons && showIcons,
				showSymbolIcons: this._options.showSymbolIcons && showIcons
			};
			const items = model.getElements().map(element => element instanceof FileElement ? new FileItem(model, element, options, this._instantiationService) : new OutlineItem(model, element, options));
			if (items.length === 0) {
				this._widget.setEnabled(false);
				this._widget.setItems([new class extends BreadcrumbsItem {
					render(container: HTMLElement): void {
						container.innerText = localize('empty', "no elements");
					}
					equals(other: BreadcrumbsItem): boolean {
						return other === this;
					}
				}]);
			} else {
				this._widget.setEnabled(true);
				this._widget.setItems(items);
				this._widget.reveal(items[items.length - 1]);
			}
		};
		const listener = model.onDidUpdate(updateBreadcrumbs);
		const configListener = this._cfShowIcons.onDidChange(updateBreadcrumbs);
		updateBreadcrumbs();
		this._breadcrumbsDisposables.clear();
		this._breadcrumbsDisposables.add(model);
		this._breadcrumbsDisposables.add(listener);
		this._breadcrumbsDisposables.add(configListener);
		this._breadcrumbsDisposables.add(toDisposable(() => this._widget.setItems([])));

		const updateScrollbarSizing = () => {
			const sizing = this._cfTitleScrollbarSizing.getValue() ?? 'default';
			this._widget.setHorizontalScrollbarSize(BreadcrumbsControl.SCROLLBAR_SIZES[sizing]);
		};
		updateScrollbarSizing();
		const updateScrollbarSizeListener = this._cfTitleScrollbarSizing.onDidChange(updateScrollbarSizing);
		this._breadcrumbsDisposables.add(updateScrollbarSizeListener);

		// close picker on hide/update
		this._breadcrumbsDisposables.add({
			dispose: () => {
				if (this._breadcrumbsPickerShowing) {
					this._contextViewService.hideContextView({ source: this });
				}
			}
		});

		return wasHidden !== this.isHidden();
	}

	private _onFocusEvent(event: IBreadcrumbsItemEvent): void {
		if (event.item && this._breadcrumbsPickerShowing) {
			this._breadcrumbsPickerIgnoreOnceItem = undefined;
			this._widget.setSelection(event.item);
		}
	}

	private _onSelectEvent(event: IBreadcrumbsItemEvent): void {
		if (!event.item) {
			return;
		}

		if (event.item === this._breadcrumbsPickerIgnoreOnceItem) {
			this._breadcrumbsPickerIgnoreOnceItem = undefined;
			this._widget.setFocused(undefined);
			this._widget.setSelection(undefined);
			return;
		}

		const { element } = event.item as FileItem | OutlineItem;
		this._editorGroup.focus();

		type BreadcrumbSelect = { type: string };
		type BreadcrumbSelectClassification = { type: { classification: 'SystemMetaData', purpose: 'FeatureInsight' }; };
		this._telemetryService.publicLog2<BreadcrumbSelect, BreadcrumbSelectClassification>('breadcrumbs/select', { type: event.item instanceof OutlineItem ? 'symbol' : 'file' });

		const group = this._getEditorGroup(event.payload);
		if (group !== undefined) {
			// reveal the item
			this._widget.setFocused(undefined);
			this._widget.setSelection(undefined);
			this._revealInEditor(event, element, group);
			return;
		}

		if (this._cfUseQuickPick.getValue()) {
			// using quick pick
			this._widget.setFocused(undefined);
			this._widget.setSelection(undefined);
			this._quickInputService.quickAccess.show(element instanceof OutlineElement2 ? '@' : '');
			return;
		}

		// show picker
		let picker: BreadcrumbsPicker;
		let pickerAnchor: { x: number; y: number };

		interface IHideData { didPick?: boolean, source?: BreadcrumbsControl }

		this._contextViewService.showContextView({
			render: (parent: HTMLElement) => {
				// Render invisible div to block mouse interaction in the rest of the UI
				const blockElement = parent.appendChild(dom.$('.context-view-block'));
				blockElement.style.position = 'fixed';
				blockElement.style.cursor = 'initial';
				blockElement.style.left = '0';
				blockElement.style.top = '0';
				blockElement.style.width = '100%';
				blockElement.style.height = '100%';
				blockElement.style.zIndex = '-1';

				const blockMouseListener = dom.addDisposableListener(blockElement, dom.EventType.MOUSE_DOWN, (e: MouseEvent) => e.stopPropagation());
				const blockMouseDisposable = toDisposable(() => blockElement.remove());

				if (event.item instanceof FileItem) {
					picker = this._instantiationService.createInstance(BreadcrumbsFilePicker, parent, event.item.model.resource);
				} else if (event.item instanceof OutlineItem) {
					picker = this._instantiationService.createInstance(BreadcrumbsOutlinePicker, parent, event.item.model.resource);
				}

				let selectListener = picker.onWillPickElement(() => this._contextViewService.hideContextView({ source: this, didPick: true }));
				let zoomListener = onDidChangeZoomLevel(() => this._contextViewService.hideContextView({ source: this }));

				let focusTracker = dom.trackFocus(parent);
				let blurListener = focusTracker.onDidBlur(() => {
					this._breadcrumbsPickerIgnoreOnceItem = this._widget.isDOMFocused() ? event.item : undefined;
					this._contextViewService.hideContextView({ source: this });
				});

				this._breadcrumbsPickerShowing = true;
				this._updateCkBreadcrumbsActive();

				return combinedDisposable(
					blockMouseListener,
					blockMouseDisposable,
					picker,
					selectListener,
					zoomListener,
					focusTracker,
					blurListener
				);
			},
			getAnchor: () => {
				if (!pickerAnchor) {
					let maxInnerWidth = window.innerWidth - 8 /*a little less the full widget*/;
					let maxHeight = Math.min(window.innerHeight * 0.7, 300);

					let pickerWidth = Math.min(maxInnerWidth, Math.max(240, maxInnerWidth / 4.17));
					let pickerArrowSize = 8;
					let pickerArrowOffset: number;

					let data = dom.getDomNodePagePosition(event.node.firstChild as HTMLElement);
					let y = data.top + data.height + pickerArrowSize;
					if (y + maxHeight >= window.innerHeight) {
						maxHeight = window.innerHeight - y - 30 /* room for shadow and status bar*/;
					}
					let x = data.left;
					if (x + pickerWidth >= maxInnerWidth) {
						x = maxInnerWidth - pickerWidth;
					}
					if (event.payload instanceof StandardMouseEvent) {
						let maxPickerArrowOffset = pickerWidth - 2 * pickerArrowSize;
						pickerArrowOffset = event.payload.posx - x;
						if (pickerArrowOffset > maxPickerArrowOffset) {
							x = Math.min(maxInnerWidth - pickerWidth, x + pickerArrowOffset - maxPickerArrowOffset);
							pickerArrowOffset = maxPickerArrowOffset;
						}
					} else {
						pickerArrowOffset = (data.left + (data.width * 0.3)) - x;
					}
					picker.show(element, maxHeight, pickerWidth, pickerArrowSize, Math.max(0, pickerArrowOffset));
					pickerAnchor = { x, y };
				}
				return pickerAnchor;
			},
			onHide: (data?: IHideData) => {
				if (!data?.didPick) {
					picker.restoreViewState();
				}
				this._breadcrumbsPickerShowing = false;
				this._updateCkBreadcrumbsActive();
				if (data?.source === this) {
					this._widget.setFocused(undefined);
					this._widget.setSelection(undefined);
				}
				picker.dispose();
			}
		});
	}

	private _updateCkBreadcrumbsActive(): void {
		const value = this._widget.isDOMFocused() || this._breadcrumbsPickerShowing;
		this._ckBreadcrumbsActive.set(value);
	}

	private async _revealInEditor(event: IBreadcrumbsItemEvent, element: FileElement | OutlineElement2, group: SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE | undefined, pinned: boolean = false): Promise<void> {

		if (element instanceof FileElement) {
			if (element.kind === FileKind.FILE) {
				await this._editorService.openEditor({ resource: element.uri, options: { pinned } }, group);
			} else {
				// show next picker
				let items = this._widget.getItems();
				let idx = items.indexOf(event.item);
				this._widget.setFocused(items[idx + 1]);
				this._widget.setSelection(items[idx + 1], BreadcrumbsControl.Payload_Pick);
			}
		} else {
			element.outline.reveal(element, { pinned }, group === SIDE_GROUP);
		}
	}

	private _getEditorGroup(data: object): SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE | undefined {
		if (data === BreadcrumbsControl.Payload_RevealAside) {
			return SIDE_GROUP;
		} else if (data === BreadcrumbsControl.Payload_Reveal) {
			return ACTIVE_GROUP;
		} else {
			return undefined;
		}
	}
}

//#region commands

// toggle command
MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'breadcrumbs.toggle',
		title: { value: localize('cmd.toggle', "Toggle Breadcrumbs"), original: 'Toggle Breadcrumbs' },
		category: CATEGORIES.View
	}
});
MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '5_editor',
	order: 3,
	command: {
		id: 'breadcrumbs.toggle',
		title: localize('miShowBreadcrumbs', "Show &&Breadcrumbs"),
		toggled: ContextKeyExpr.equals('config.breadcrumbs.enabled', true)
	}
});
CommandsRegistry.registerCommand('breadcrumbs.toggle', accessor => {
	let config = accessor.get(IConfigurationService);
	let value = BreadcrumbsConfig.IsEnabled.bindTo(config).getValue();
	BreadcrumbsConfig.IsEnabled.bindTo(config).updateValue(!value);
});

// focus/focus-and-select
function focusAndSelectHandler(accessor: ServicesAccessor, select: boolean): void {
	// find widget and focus/select
	const groups = accessor.get(IEditorGroupsService);
	const breadcrumbs = accessor.get(IBreadcrumbsService);
	const widget = breadcrumbs.getWidget(groups.activeGroup.id);
	if (widget) {
		const item = tail(widget.getItems());
		widget.setFocused(item);
		if (select) {
			widget.setSelection(item, BreadcrumbsControl.Payload_Pick);
		}
	}
}
MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: 'breadcrumbs.focusAndSelect',
		title: { value: localize('cmd.focus', "Focus Breadcrumbs"), original: 'Focus Breadcrumbs' },
		precondition: BreadcrumbsControl.CK_BreadcrumbsVisible
	}
});
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'breadcrumbs.focusAndSelect',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_DOT,
	when: BreadcrumbsControl.CK_BreadcrumbsPossible,
	handler: accessor => focusAndSelectHandler(accessor, true)
});
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'breadcrumbs.focus',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_SEMICOLON,
	when: BreadcrumbsControl.CK_BreadcrumbsPossible,
	handler: accessor => focusAndSelectHandler(accessor, false)
});

// this commands is only enabled when breadcrumbs are
// disabled which it then enables and focuses
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'breadcrumbs.toggleToOn',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_DOT,
	when: ContextKeyExpr.not('config.breadcrumbs.enabled'),
	handler: async accessor => {
		const instant = accessor.get(IInstantiationService);
		const config = accessor.get(IConfigurationService);
		// check if enabled and iff not enable
		const isEnabled = BreadcrumbsConfig.IsEnabled.bindTo(config);
		if (!isEnabled.getValue()) {
			await isEnabled.updateValue(true);
			await timeout(50); // hacky - the widget might not be ready yet...
		}
		return instant.invokeFunction(focusAndSelectHandler, true);
	}
});

// navigation
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'breadcrumbs.focusNext',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.RightArrow,
	secondary: [KeyMod.CtrlCmd | KeyCode.RightArrow],
	mac: {
		primary: KeyCode.RightArrow,
		secondary: [KeyMod.Alt | KeyCode.RightArrow],
	},
	when: ContextKeyExpr.and(BreadcrumbsControl.CK_BreadcrumbsVisible, BreadcrumbsControl.CK_BreadcrumbsActive),
	handler(accessor) {
		const groups = accessor.get(IEditorGroupsService);
		const breadcrumbs = accessor.get(IBreadcrumbsService);
		const widget = breadcrumbs.getWidget(groups.activeGroup.id);
		if (!widget) {
			return;
		}
		widget.focusNext();
	}
});
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'breadcrumbs.focusPrevious',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.LeftArrow,
	secondary: [KeyMod.CtrlCmd | KeyCode.LeftArrow],
	mac: {
		primary: KeyCode.LeftArrow,
		secondary: [KeyMod.Alt | KeyCode.LeftArrow],
	},
	when: ContextKeyExpr.and(BreadcrumbsControl.CK_BreadcrumbsVisible, BreadcrumbsControl.CK_BreadcrumbsActive),
	handler(accessor) {
		const groups = accessor.get(IEditorGroupsService);
		const breadcrumbs = accessor.get(IBreadcrumbsService);
		const widget = breadcrumbs.getWidget(groups.activeGroup.id);
		if (!widget) {
			return;
		}
		widget.focusPrev();
	}
});
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'breadcrumbs.focusNextWithPicker',
	weight: KeybindingWeight.WorkbenchContrib + 1,
	primary: KeyMod.CtrlCmd | KeyCode.RightArrow,
	mac: {
		primary: KeyMod.Alt | KeyCode.RightArrow,
	},
	when: ContextKeyExpr.and(BreadcrumbsControl.CK_BreadcrumbsVisible, BreadcrumbsControl.CK_BreadcrumbsActive, WorkbenchListFocusContextKey),
	handler(accessor) {
		const groups = accessor.get(IEditorGroupsService);
		const breadcrumbs = accessor.get(IBreadcrumbsService);
		const widget = breadcrumbs.getWidget(groups.activeGroup.id);
		if (!widget) {
			return;
		}
		widget.focusNext();
	}
});
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'breadcrumbs.focusPreviousWithPicker',
	weight: KeybindingWeight.WorkbenchContrib + 1,
	primary: KeyMod.CtrlCmd | KeyCode.LeftArrow,
	mac: {
		primary: KeyMod.Alt | KeyCode.LeftArrow,
	},
	when: ContextKeyExpr.and(BreadcrumbsControl.CK_BreadcrumbsVisible, BreadcrumbsControl.CK_BreadcrumbsActive, WorkbenchListFocusContextKey),
	handler(accessor) {
		const groups = accessor.get(IEditorGroupsService);
		const breadcrumbs = accessor.get(IBreadcrumbsService);
		const widget = breadcrumbs.getWidget(groups.activeGroup.id);
		if (!widget) {
			return;
		}
		widget.focusPrev();
	}
});
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'breadcrumbs.selectFocused',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.Enter,
	secondary: [KeyCode.DownArrow],
	when: ContextKeyExpr.and(BreadcrumbsControl.CK_BreadcrumbsVisible, BreadcrumbsControl.CK_BreadcrumbsActive),
	handler(accessor) {
		const groups = accessor.get(IEditorGroupsService);
		const breadcrumbs = accessor.get(IBreadcrumbsService);
		const widget = breadcrumbs.getWidget(groups.activeGroup.id);
		if (!widget) {
			return;
		}
		widget.setSelection(widget.getFocused(), BreadcrumbsControl.Payload_Pick);
	}
});
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'breadcrumbs.revealFocused',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyCode.Space,
	secondary: [KeyMod.CtrlCmd | KeyCode.Enter],
	when: ContextKeyExpr.and(BreadcrumbsControl.CK_BreadcrumbsVisible, BreadcrumbsControl.CK_BreadcrumbsActive),
	handler(accessor) {
		const groups = accessor.get(IEditorGroupsService);
		const breadcrumbs = accessor.get(IBreadcrumbsService);
		const widget = breadcrumbs.getWidget(groups.activeGroup.id);
		if (!widget) {
			return;
		}
		widget.setSelection(widget.getFocused(), BreadcrumbsControl.Payload_Reveal);
	}
});
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'breadcrumbs.selectEditor',
	weight: KeybindingWeight.WorkbenchContrib + 1,
	primary: KeyCode.Escape,
	when: ContextKeyExpr.and(BreadcrumbsControl.CK_BreadcrumbsVisible, BreadcrumbsControl.CK_BreadcrumbsActive),
	handler(accessor) {
		const groups = accessor.get(IEditorGroupsService);
		const breadcrumbs = accessor.get(IBreadcrumbsService);
		const widget = breadcrumbs.getWidget(groups.activeGroup.id);
		if (!widget) {
			return;
		}
		widget.setFocused(undefined);
		widget.setSelection(undefined);
		if (groups.activeGroup.activeEditorPane) {
			groups.activeGroup.activeEditorPane.focus();
		}
	}
});
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'breadcrumbs.revealFocusedFromTreeAside',
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.Enter,
	when: ContextKeyExpr.and(BreadcrumbsControl.CK_BreadcrumbsVisible, BreadcrumbsControl.CK_BreadcrumbsActive, WorkbenchListFocusContextKey),
	handler(accessor) {
		const editors = accessor.get(IEditorService);
		const lists = accessor.get(IListService);

		const tree = lists.lastFocusedList;
		if (!(tree instanceof WorkbenchDataTree)) {
			return;
		}

		const element = <IFileStat | unknown>tree.getFocus()[0];

		if (URI.isUri((<IFileStat>element)?.resource)) {
			// IFileStat: open file in editor
			return editors.openEditor({
				resource: (<IFileStat>element).resource,
				options: { pinned: true }
			}, SIDE_GROUP);
		}

		// IOutline: check if this the outline and iff so reveal element
		const input = tree.getInput();
		if (input && typeof (<IOutline<any>>input).outlineKind === 'string') {
			return (<IOutline<any>>input).reveal(element, {
				pinned: true,
				preserveFocus: false
			}, true);
		}
	}
});
//#endregion
