/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import { StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { BreadcrumbsItem, BreadcrumbsWidget, IBreadcrumbsItemEvent } from 'vs/base/browser/ui/breadcrumbs/breadcrumbsWidget';
import { IconLabel } from 'vs/base/browser/ui/iconLabel/iconLabel';
import { tail } from 'vs/base/common/arrays';
import { timeout } from 'vs/base/common/async';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { combinedDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { isEqual } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import 'vs/css!./media/breadcrumbscontrol';
import { ICodeEditor, isCodeEditor, isDiffEditor } from 'vs/editor/browser/editorBrowser';
import { Range } from 'vs/editor/common/core/range';
import { ICodeEditorViewState, ScrollType } from 'vs/editor/common/editorCommon';
import { SymbolKinds } from 'vs/editor/common/modes';
import { OutlineElement, OutlineGroup, OutlineModel, TreeElement } from 'vs/editor/contrib/documentSymbols/outlineModel';
import { localize } from 'vs/nls';
import { MenuId, MenuRegistry } from 'vs/platform/actions/common/actions';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { FileKind, IFileService, IFileStat } from 'vs/platform/files/common/files';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IListService, WorkbenchListFocusContextKey } from 'vs/platform/list/browser/listService';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { ColorIdentifier, ColorFunction } from 'vs/platform/theme/common/colorRegistry';
import { attachBreadcrumbsStyler } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ResourceLabel } from 'vs/workbench/browser/labels';
import { BreadcrumbsConfig, IBreadcrumbsService } from 'vs/workbench/browser/parts/editor/breadcrumbs';
import { BreadcrumbElement, EditorBreadcrumbsModel, FileElement } from 'vs/workbench/browser/parts/editor/breadcrumbsModel';
import { BreadcrumbsPicker, createBreadcrumbsPicker } from 'vs/workbench/browser/parts/editor/breadcrumbsPicker';
import { SideBySideEditorInput, IEditorPartOptions } from 'vs/workbench/common/editor';
import { ACTIVE_GROUP, ACTIVE_GROUP_TYPE, IEditorService, SIDE_GROUP, SIDE_GROUP_TYPE } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { IEditorGroupView } from 'vs/workbench/browser/parts/editor/editor';
import { onDidChangeZoomLevel } from 'vs/base/browser/browser';
import { withNullAsUndefined, withUndefinedAsNull } from 'vs/base/common/types';
import { ILabelService } from 'vs/platform/label/common/label';
import { ITextResourceConfigurationService } from 'vs/editor/common/services/textResourceConfigurationService';
import { TextEditorSelectionRevealType } from 'vs/platform/editor/common/editor';

class Item extends BreadcrumbsItem {

	private readonly _disposables = new DisposableStore();

	constructor(
		readonly element: BreadcrumbElement,
		readonly options: IBreadcrumbsControlOptions,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();
	}

	dispose(): void {
		this._disposables.dispose();
	}

	equals(other: BreadcrumbsItem): boolean {
		if (!(other instanceof Item)) {
			return false;
		}
		if (this.element instanceof FileElement && other.element instanceof FileElement) {
			return (isEqual(this.element.uri, other.element.uri, false) &&
				this.options.showFileIcons === other.options.showFileIcons &&
				this.options.showSymbolIcons === other.options.showSymbolIcons);
		}
		if (this.element instanceof TreeElement && other.element instanceof TreeElement) {
			return this.element.id === other.element.id;
		}
		return false;
	}

	render(container: HTMLElement): void {
		if (this.element instanceof FileElement) {
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

		} else if (this.element instanceof OutlineModel) {
			// has outline element but not in one
			let label = document.createElement('div');
			label.innerHTML = '&hellip;';
			label.className = 'hint-more';
			container.appendChild(label);

		} else if (this.element instanceof OutlineGroup) {
			// provider
			let label = new IconLabel(container);
			label.setLabel(this.element.label);
			this._disposables.add(label);

		} else if (this.element instanceof OutlineElement) {
			// symbol
			if (this.options.showSymbolIcons) {
				let icon = document.createElement('div');
				icon.className = SymbolKinds.toCssClassName(this.element.symbol.kind);
				container.appendChild(icon);
				container.classList.add('shows-symbol-icon');
			}
			let label = new IconLabel(container);
			let title = this.element.symbol.name.replace(/\r|\n|\r\n/g, '\u23CE');
			label.setLabel(title);
			this._disposables.add(label);
		}
	}
}

export interface IBreadcrumbsControlOptions {
	showFileIcons: boolean;
	showSymbolIcons: boolean;
	showDecorationColors: boolean;
	breadcrumbsBackground: ColorIdentifier | ColorFunction;
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

	static readonly CK_BreadcrumbsPossible = new RawContextKey('breadcrumbsPossible', false);
	static readonly CK_BreadcrumbsVisible = new RawContextKey('breadcrumbsVisible', false);
	static readonly CK_BreadcrumbsActive = new RawContextKey('breadcrumbsActive', false);

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
		@IEditorService private readonly _editorService: IEditorService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@IWorkspaceContextService private readonly _workspaceService: IWorkspaceContextService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IThemeService private readonly _themeService: IThemeService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ITextResourceConfigurationService private readonly _textResourceConfigurationService: ITextResourceConfigurationService,
		@IFileService private readonly _fileService: IFileService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService,
		@ILabelService private readonly _labelService: ILabelService,
		@IBreadcrumbsService breadcrumbsService: IBreadcrumbsService,
	) {
		this.domNode = document.createElement('div');
		this.domNode.classList.add('breadcrumbs-control');
		dom.append(container, this.domNode);

		this._cfUseQuickPick = BreadcrumbsConfig.UseQuickPick.bindTo(_configurationService);
		this._cfShowIcons = BreadcrumbsConfig.Icons.bindTo(_configurationService);
		this._cfTitleScrollbarSizing = BreadcrumbsConfig.TitleScrollbarSizing.bindTo(_configurationService);

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
		let input = this._editorGroup.activeEditor;
		if (input instanceof SideBySideEditorInput) {
			input = input.master;
		}

		if (!input || !input.resource || !this._fileService.canHandleResource(input.resource!)) {
			// cleanup and return when there is no input or when
			// we cannot handle this input
			this._ckBreadcrumbsPossible.set(false);
			if (!this.isHidden()) {
				this.hide();
				return true;
			} else {
				return false;
			}
		}

		this.domNode.classList.toggle('hidden', false);
		this._ckBreadcrumbsVisible.set(true);
		this._ckBreadcrumbsPossible.set(true);

		const uri = input.resource;
		const editor = this._getActiveCodeEditor();
		const model = new EditorBreadcrumbsModel(
			uri, editor,
			this._configurationService,
			this._textResourceConfigurationService,
			this._workspaceService
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
			const items = model.getElements().map(element => new Item(element, options, this._instantiationService));
			this._widget.setItems(items);
			this._widget.reveal(items[items.length - 1]);
		};
		const listener = model.onDidUpdate(updateBreadcrumbs);
		const configListener = this._cfShowIcons.onDidChange(updateBreadcrumbs);
		updateBreadcrumbs();
		this._breadcrumbsDisposables.clear();
		this._breadcrumbsDisposables.add(model);
		this._breadcrumbsDisposables.add(listener);
		this._breadcrumbsDisposables.add(configListener);

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
					this._contextViewService.hideContextView(this);
				}
			}
		});

		return true;
	}

	private _getActiveCodeEditor(): ICodeEditor | undefined {
		if (!this._editorGroup.activeEditorPane) {
			return undefined;
		}
		let control = this._editorGroup.activeEditorPane.getControl();
		let editor: ICodeEditor | undefined;
		if (isCodeEditor(control)) {
			editor = control as ICodeEditor;
		} else if (isDiffEditor(control)) {
			editor = control.getModifiedEditor();
		}
		return editor;
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

		const { element } = event.item as Item;
		this._editorGroup.focus();

		type BreadcrumbSelectClassification = {
			type: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
		};
		this._telemetryService.publicLog2<{ type: string }, BreadcrumbSelectClassification>('breadcrumbs/select', { type: element instanceof TreeElement ? 'symbol' : 'file' });

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
			this._quickInputService.quickAccess.show(element instanceof TreeElement ? '@' : '');
			return;
		}

		// show picker
		let picker: BreadcrumbsPicker;
		let pickerAnchor: { x: number; y: number };
		let editor = this._getActiveCodeEditor();
		let editorDecorations: string[] = [];
		let editorViewState: ICodeEditorViewState | undefined;

		this._contextViewService.showContextView({
			render: (parent: HTMLElement) => {
				picker = createBreadcrumbsPicker(this._instantiationService, parent, element);
				let selectListener = picker.onDidPickElement(data => {
					if (data.target) {
						editorViewState = undefined;
					}
					this._contextViewService.hideContextView(this);

					const group = (picker.useAltAsMultipleSelectionModifier && (data.browserEvent as MouseEvent).metaKey) || (!picker.useAltAsMultipleSelectionModifier && (data.browserEvent as MouseEvent).altKey)
						? SIDE_GROUP
						: ACTIVE_GROUP;

					this._revealInEditor(event, data.target, group, (data.browserEvent as MouseEvent).button === 1);
					/* __GDPR__
						"breadcrumbs/open" : {
							"type": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
						}
					*/
					this._telemetryService.publicLog('breadcrumbs/open', { type: !data ? 'nothing' : data.target instanceof TreeElement ? 'symbol' : 'file' });
				});
				let focusListener = picker.onDidFocusElement(data => {
					if (!editor || !(data.target instanceof OutlineElement)) {
						return;
					}
					if (!editorViewState) {
						editorViewState = withNullAsUndefined(editor.saveViewState());
					}
					const { symbol } = data.target;
					editor.revealRangeInCenterIfOutsideViewport(symbol.range, ScrollType.Smooth);
					editorDecorations = editor.deltaDecorations(editorDecorations, [{
						range: symbol.range,
						options: {
							className: 'rangeHighlight',
							isWholeLine: true
						}
					}]);
				});

				let zoomListener = onDidChangeZoomLevel(() => {
					this._contextViewService.hideContextView(this);
				});

				let focusTracker = dom.trackFocus(parent);
				let blurListener = focusTracker.onDidBlur(() => {
					this._breadcrumbsPickerIgnoreOnceItem = this._widget.isDOMFocused() ? event.item : undefined;
					this._contextViewService.hideContextView(this);
				});

				this._breadcrumbsPickerShowing = true;
				this._updateCkBreadcrumbsActive();

				return combinedDisposable(
					picker,
					selectListener,
					focusListener,
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
			onHide: (data) => {
				if (editor) {
					editor.deltaDecorations(editorDecorations, []);
					if (editorViewState) {
						editor.restoreViewState(editorViewState);
					}
				}
				this._breadcrumbsPickerShowing = false;
				this._updateCkBreadcrumbsActive();
				if (data === this) {
					this._widget.setFocused(undefined);
					this._widget.setSelection(undefined);
				}
			}
		});
	}

	private _updateCkBreadcrumbsActive(): void {
		const value = this._widget.isDOMFocused() || this._breadcrumbsPickerShowing;
		this._ckBreadcrumbsActive.set(value);
	}

	private _revealInEditor(event: IBreadcrumbsItemEvent, element: BreadcrumbElement, group: SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE | undefined, pinned: boolean = false): void {
		if (element instanceof FileElement) {
			if (element.kind === FileKind.FILE) {
				// open file in any editor
				this._editorService.openEditor({ resource: element.uri, options: { pinned: pinned } }, group);
			} else {
				// show next picker
				let items = this._widget.getItems();
				let idx = items.indexOf(event.item);
				this._widget.setFocused(items[idx + 1]);
				this._widget.setSelection(items[idx + 1], BreadcrumbsControl.Payload_Pick);
			}

		} else if (element instanceof OutlineElement) {
			// open symbol in code editor
			const model = OutlineModel.get(element);
			if (model) {
				this._codeEditorService.openCodeEditor({
					resource: model.uri,
					options: {
						selection: Range.collapseToStart(element.symbol.selectionRange),
						selectionRevealType: TextEditorSelectionRevealType.CenterIfOutsideViewport
					}
				}, withUndefinedAsNull(this._getActiveCodeEditor()), group === SIDE_GROUP);
			}
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
		category: { value: localize('cmd.category', "View"), original: 'View' }
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
		const element = lists.lastFocusedList ? <OutlineElement | IFileStat>lists.lastFocusedList.getFocus()[0] : undefined;
		if (element instanceof OutlineElement) {
			const outlineElement = OutlineModel.get(element);
			if (!outlineElement) {
				return undefined;
			}

			// open symbol in editor
			return editors.openEditor({
				resource: outlineElement.uri,
				options: { selection: Range.collapseToStart(element.symbol.selectionRange) }
			}, SIDE_GROUP);

		} else if (element && URI.isUri(element.resource)) {
			// open file in editor
			return editors.openEditor({
				resource: element.resource,
			}, SIDE_GROUP);

		} else {
			// ignore
			return undefined;
		}
	}
});
//#endregion
