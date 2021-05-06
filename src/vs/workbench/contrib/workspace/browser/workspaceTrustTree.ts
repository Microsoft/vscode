/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, append, EventType, $, createStyleSheet, trackFocus, addStandardDisposableListener } from 'vs/base/browser/dom';
import { DefaultStyleController, IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { IList } from 'vs/base/browser/ui/tree/indexTreeModel';
import { IObjectTreeOptions } from 'vs/base/browser/ui/tree/objectTree';
import { ITreeModel, ITreeNode, ITreeRenderer } from 'vs/base/browser/ui/tree/tree';
import { Color, RGBA } from 'vs/base/common/color';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore, dispose } from 'vs/base/common/lifecycle';
import { isArray } from 'vs/base/common/types';
import { localize } from 'vs/nls';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IListService, WorkbenchObjectTree } from 'vs/platform/list/browser/listService';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { editorBackground, errorForeground, focusBorder, foreground, inputValidationErrorBackground, inputValidationErrorBorder, inputValidationErrorForeground } from 'vs/platform/theme/common/colorRegistry';
import { IColorTheme, ICssStyleCollector, IThemeService, registerThemingParticipant, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { NonCollapsibleObjectTreeModel } from 'vs/workbench/contrib/preferences/browser/settingsTree';
import { AbstractListSettingWidget, focusedRowBackground, focusedRowBorder, ISettingListChangeEvent, settingsHeaderForeground, settingsSelectBackground, settingsTextInputBorder, settingsTextInputForeground } from 'vs/workbench/contrib/preferences/browser/settingsWidgets';
import { attachButtonStyler, attachInputBoxStyler, attachStyler } from 'vs/platform/theme/common/styler';
import { CachedListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { IAction } from 'vs/base/common/actions';
import { settingsEditIcon, settingsRemoveIcon } from 'vs/workbench/contrib/preferences/browser/preferencesIcons';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { InputBox } from 'vs/base/browser/ui/inputbox/inputBox';
import { Button } from 'vs/base/browser/ui/button/button';
import { disposableTimeout } from 'vs/base/common/async';
import { URI, UriComponents } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { ILabelService } from 'vs/platform/label/common/label';


export class WorkspaceTrustSettingsTreeEntry {
	id: string;
	displayLabel: string;
	setting: {
		key: string;
		description: string;
	};
	value: URI[];

	constructor(key: string, displayLabel: string, description: string, value: URI[]) {
		this.setting = { key, description };
		this.displayLabel = displayLabel;
		this.value = value;
		this.id = key;
	}
}

export interface IWorkspaceTrustSettingItemTemplate<T = any> {
	onChange?: (value: T, type: WorkspaceTrustSettingListItemChangeType) => void;

	toDispose: DisposableStore;
	context?: WorkspaceTrustSettingsTreeEntry;
	containerElement: HTMLElement;
	labelElement: HTMLElement;
	descriptionElement: HTMLElement;
	controlElement: HTMLElement;
	elementDisposables: DisposableStore;
}

export interface IWorkspaceTrustUriDataItem extends UriComponents { }

class WorkspaceTrustFolderSettingWidget extends AbstractListSettingWidget<IWorkspaceTrustUriDataItem> {
	constructor(
		container: HTMLElement,
		@ILabelService protected readonly labelService: ILabelService,
		@IThemeService themeService: IThemeService,
		@IContextViewService contextViewService: IContextViewService
	) {
		super(container, themeService, contextViewService);
	}

	protected getEmptyItem(): IWorkspaceTrustUriDataItem {
		return URI.file('');
	}

	protected getContainerClasses() {
		return ['workspace-trust-uri-setting-widget', 'setting-list-object-widget'];
	}

	protected getActionsForItem(item: IWorkspaceTrustUriDataItem, idx: number): IAction[] {
		return [
			{
				class: ThemeIcon.asClassName(settingsEditIcon),
				enabled: true,
				id: 'workbench.action.editListItem',
				tooltip: this.getLocalizedStrings().editActionTooltip,
				run: () => this.editSetting(idx)
			},
			{
				class: ThemeIcon.asClassName(settingsRemoveIcon),
				enabled: true,
				id: 'workbench.action.removeListItem',
				tooltip: this.getLocalizedStrings().deleteActionTooltip,
				run: () => this._onDidChangeList.fire({ originalItem: item, item: undefined, targetIndex: idx })
			}
		] as IAction[];
	}

	protected override renderHeader() {
		const header = $('.setting-list-row-header');
		const hostHeader = append(header, $('.setting-list-object-key'));
		const pathHeader = append(header, $('.setting-list-object-value'));
		const { hostHeaderText, pathHeaderText } = this.getLocalizedStrings();

		hostHeader.textContent = hostHeaderText;
		pathHeader.textContent = pathHeaderText;

		return header;
	}

	protected renderItem(item: IWorkspaceTrustUriDataItem): HTMLElement {
		const rowElement = $('.setting-list-row');
		rowElement.classList.add('setting-list-object-row');

		const hostElement = append(rowElement, $('.setting-list-object-key'));
		const pathElement = append(rowElement, $('.setting-list-object-value'));

		hostElement.textContent = item.authority ? this.labelService.getHostLabel(item.scheme, item.authority) : localize('localAuthority', "Local");
		pathElement.textContent = item.scheme === Schemas.file ? URI.revive(item).fsPath : item.path;

		return rowElement;
	}


	protected renderEdit(item: IWorkspaceTrustUriDataItem, idx: number): HTMLElement {
		const rowElement = $('.setting-list-edit-row');

		const hostElement = append(rowElement, $('.setting-list-object-key'));
		hostElement.textContent = item.authority ? this.labelService.getHostLabel(item.scheme, item.authority) : localize('localAuthority', "Local");

		const updatedItem = () => {
			if (item.scheme === Schemas.file) {
				return URI.file(pathInput.value);
			} else {
				return URI.revive(item).with({ path: pathInput.value });
			}
		};

		const onKeyDown = (e: StandardKeyboardEvent) => {
			if (e.equals(KeyCode.Enter)) {
				this.handleItemChange(item, updatedItem(), idx);
			} else if (e.equals(KeyCode.Escape)) {
				this.cancelEdit();
				e.preventDefault();
			}
			rowElement?.focus();
		};

		const pathInput = new InputBox(rowElement, this.contextViewService, {
			placeholder: this.getLocalizedStrings().inputPlaceholder
		});

		pathInput.element.classList.add('setting-list-valueInput');
		this.listDisposables.add(attachInputBoxStyler(pathInput, this.themeService, {
			inputBackground: settingsSelectBackground,
			inputForeground: settingsTextInputForeground,
			inputBorder: settingsTextInputBorder
		}));
		this.listDisposables.add(pathInput);
		pathInput.value = item.scheme === Schemas.file ? URI.revive(item).fsPath : item.path;

		this.listDisposables.add(
			addStandardDisposableListener(pathInput.inputElement, EventType.KEY_DOWN, onKeyDown)
		);

		const okButton = this._register(new Button(rowElement));
		okButton.label = localize('okButton', "OK");
		okButton.element.classList.add('setting-list-ok-button');

		this.listDisposables.add(attachButtonStyler(okButton, this.themeService));
		this.listDisposables.add(okButton.onDidClick(() => this.handleItemChange(item, updatedItem(), idx)));

		const cancelButton = this._register(new Button(rowElement));
		cancelButton.label = localize('cancelButton', "Cancel");
		cancelButton.element.classList.add('setting-list-cancel-button');

		this.listDisposables.add(attachButtonStyler(cancelButton, this.themeService));
		this.listDisposables.add(cancelButton.onDidClick(() => this.cancelEdit()));

		this.listDisposables.add(
			disposableTimeout(() => {
				pathInput.focus();
				pathInput.select();
			})
		);

		return rowElement;
	}

	protected isItemNew(item: IWorkspaceTrustUriDataItem): boolean {
		return item.path === '';
	}

	protected getLocalizedRowTitle(item: IWorkspaceTrustUriDataItem): string {
		return localize('trustedRow', "Trusted Path: {0}", this.labelService.getUriLabel(URI.from(item)));
	}

	protected getLocalizedStrings() {
		return {
			deleteActionTooltip: localize('removePath', "Remove Path"),
			editActionTooltip: localize('editPath', "Edit Path"),
			addButtonLabel: localize('addPath', "Add Path"),
			hostHeaderText: localize('hostHeaderText', "Host"),
			pathHeaderText: localize('pathHeaderText', "Path"),
			inputPlaceholder: localize('pathInputPlaceholder', "Path Item..."),
		};
	}
}

interface IWorkspaceTrustSettingListItemTemplate extends IWorkspaceTrustSettingItemTemplate<URI[] | undefined> {
	listWidget: WorkspaceTrustFolderSettingWidget;
	validationErrorMessageElement: HTMLElement;
}

export type WorkspaceTrustSettingListItemChangeType = 'added' | 'removed' | 'changed';
export interface IWorkspaceTrustSettingChangeEvent {
	key: string;
	value: URI[] | undefined; // undefined => reset/unconfigure
	type: WorkspaceTrustSettingListItemChangeType;
}


export class WorkspaceTrustSettingArrayRenderer extends Disposable implements ITreeRenderer<WorkspaceTrustSettingsTreeEntry, never, IWorkspaceTrustSettingListItemTemplate> {
	templateId = 'template.setting.array';

	static readonly CONTROL_CLASS = 'setting-control-focus-target';
	static readonly CONTROL_SELECTOR = '.' + WorkspaceTrustSettingArrayRenderer.CONTROL_CLASS;
	static readonly CONTENTS_CLASS = 'setting-item-contents';
	static readonly CONTENTS_SELECTOR = '.' + WorkspaceTrustSettingArrayRenderer.CONTENTS_CLASS;
	static readonly ALL_ROWS_SELECTOR = '.monaco-list-row';

	static readonly SETTING_KEY_ATTR = 'data-key';
	static readonly SETTING_ID_ATTR = 'data-id';
	static readonly ELEMENT_FOCUSABLE_ATTR = 'data-focusable';

	protected readonly _onDidChangeSetting = this._register(new Emitter<IWorkspaceTrustSettingChangeEvent>());
	readonly onDidChangeSetting: Event<IWorkspaceTrustSettingChangeEvent> = this._onDidChangeSetting.event;

	private readonly _onDidFocusSetting = this._register(new Emitter<WorkspaceTrustSettingsTreeEntry>());
	readonly onDidFocusSetting: Event<WorkspaceTrustSettingsTreeEntry> = this._onDidFocusSetting.event;

	private readonly _onDidChangeIgnoredSettings = this._register(new Emitter<void>());
	readonly onDidChangeIgnoredSettings: Event<void> = this._onDidChangeIgnoredSettings.event;

	constructor(
		@IThemeService protected readonly _themeService: IThemeService,
		@IContextViewService protected readonly _contextViewService: IContextViewService,
		@IOpenerService protected readonly _openerService: IOpenerService,
		@IInstantiationService protected readonly _instantiationService: IInstantiationService,
		@ICommandService protected readonly _commandService: ICommandService,
		@IContextMenuService protected readonly _contextMenuService: IContextMenuService,
		@IKeybindingService protected readonly _keybindingService: IKeybindingService,
		@IConfigurationService protected readonly _configService: IConfigurationService,
	) {
		super();
	}

	renderCommonTemplate(tree: any, _container: HTMLElement, typeClass: string): IWorkspaceTrustSettingItemTemplate {
		_container.classList.add('setting-item');
		_container.classList.add('setting-item-' + typeClass);

		const container = append(_container, $(WorkspaceTrustSettingArrayRenderer.CONTENTS_SELECTOR));
		container.classList.add('settings-row-inner-container');
		const titleElement = append(container, $('.setting-item-title'));
		const labelCategoryContainer = append(titleElement, $('.setting-item-cat-label-container'));
		const labelElement = append(labelCategoryContainer, $('span.setting-item-label'));
		const descriptionElement = append(container, $('.setting-item-description'));
		const modifiedIndicatorElement = append(container, $('.setting-item-modified-indicator'));
		modifiedIndicatorElement.title = localize('modified', "Modified");

		const valueElement = append(container, $('.setting-item-value'));
		const controlElement = append(valueElement, $('div.setting-item-control'));
		const toDispose = new DisposableStore();

		const template: IWorkspaceTrustSettingItemTemplate = {
			toDispose,
			elementDisposables: new DisposableStore(),
			containerElement: container,
			labelElement,
			descriptionElement,
			controlElement
		};

		// Prevent clicks from being handled by list
		toDispose.add(addDisposableListener(controlElement, EventType.MOUSE_DOWN, e => e.stopPropagation()));

		toDispose.add(addDisposableListener(titleElement, EventType.MOUSE_ENTER, e => container.classList.add('mouseover')));
		toDispose.add(addDisposableListener(titleElement, EventType.MOUSE_LEAVE, e => container.classList.remove('mouseover')));

		return template;
	}

	addSettingElementFocusHandler(template: IWorkspaceTrustSettingItemTemplate): void {
		const focusTracker = trackFocus(template.containerElement);
		template.toDispose.add(focusTracker);
		focusTracker.onDidBlur(() => {
			if (template.containerElement.classList.contains('focused')) {
				template.containerElement.classList.remove('focused');
			}
		});

		focusTracker.onDidFocus(() => {
			template.containerElement.classList.add('focused');

			if (template.context) {
				this._onDidFocusSetting.fire(template.context);
			}
		});
	}

	renderTemplate(container: HTMLElement): IWorkspaceTrustSettingListItemTemplate {
		const common = this.renderCommonTemplate(null, container, 'list');
		const descriptionElement = common.containerElement.querySelector('.setting-item-description')!;
		const validationErrorMessageElement = $('.setting-item-validation-message');
		descriptionElement.after(validationErrorMessageElement);

		const listWidget = this._instantiationService.createInstance(WorkspaceTrustFolderSettingWidget, common.controlElement);
		listWidget.domNode.classList.add(WorkspaceTrustSettingArrayRenderer.CONTROL_CLASS);
		common.toDispose.add(listWidget);

		const template: IWorkspaceTrustSettingListItemTemplate = {
			...common,
			listWidget,
			validationErrorMessageElement
		};

		this.addSettingElementFocusHandler(template);

		common.toDispose.add(
			listWidget.onDidChangeList(e => {
				const { list: newList, changeType } = this.computeNewList(template, e);
				if (newList !== null && template.onChange) {
					template.onChange(newList, changeType);
				}
			})
		);

		return template;
	}

	private computeNewList(template: IWorkspaceTrustSettingListItemTemplate, e: ISettingListChangeEvent<IWorkspaceTrustUriDataItem>): { list: URI[] | null, changeType: WorkspaceTrustSettingListItemChangeType } {
		if (template.context) {
			let newValue: URI[] = [];

			let changeType: WorkspaceTrustSettingListItemChangeType = 'changed';
			if (isArray(template.context.value)) {
				newValue = [...template.context.value];
			}

			if (e.targetIndex !== undefined) {
				// Delete value
				if (!e.item?.path && e.originalItem.path && e.targetIndex > -1) {
					newValue.splice(e.targetIndex, 1);
					changeType = 'removed';
				}
				// Update value
				else if (e.item?.path && e.originalItem.path) {
					if (e.targetIndex > -1) {
						newValue[e.targetIndex] = URI.revive(e.item);
						changeType = e.targetIndex < template.context.value.length ? 'changed' : 'added';
					}
					// For some reason, we are updating and cannot find original value
					// Just append the value in this case
					else {
						newValue.push(URI.revive(e.item));
						changeType = 'added';
					}
				}
				// Add value
				else if (e.item?.path && !e.originalItem.path && e.targetIndex >= newValue.length) {
					newValue.push(URI.revive(e.item));
					changeType = 'added';
				}
			}

			return { list: newValue, changeType };
		}

		return { list: null, changeType: 'changed' };
	}

	renderElement(node: ITreeNode<WorkspaceTrustSettingsTreeEntry, never>, index: number, template: IWorkspaceTrustSettingListItemTemplate): void {
		const element = node.element;
		template.context = element;

		template.containerElement.setAttribute(WorkspaceTrustSettingArrayRenderer.SETTING_KEY_ATTR, element.setting.key);
		template.containerElement.setAttribute(WorkspaceTrustSettingArrayRenderer.SETTING_ID_ATTR, element.id);

		template.labelElement.textContent = element.displayLabel;

		template.descriptionElement.innerText = element.setting.description;

		const onChange = (value: any, type: WorkspaceTrustSettingListItemChangeType) => this._onDidChangeSetting.fire({ key: element.setting.key, value, type });
		this.renderValue(element, template, onChange);
	}

	protected renderValue(dataElement: WorkspaceTrustSettingsTreeEntry, template: IWorkspaceTrustSettingListItemTemplate, onChange: (value: URI[] | undefined, type: WorkspaceTrustSettingListItemChangeType) => void): void {
		const value = getListDisplayValue(dataElement);
		template.listWidget.setValue(value);
		template.context = dataElement;

		template.onChange = (v, t) => {
			onChange(v, t);
			renderArrayValidations(dataElement, template, v, false);
		};

		renderArrayValidations(dataElement, template, value.map(v => URI.revive(v)), true);
	}

	disposeTemplate(template: IWorkspaceTrustSettingItemTemplate): void {
		dispose(template.toDispose);
	}

	disposeElement(_element: ITreeNode<WorkspaceTrustSettingsTreeEntry>, _index: number, template: IWorkspaceTrustSettingItemTemplate, _height: number | undefined): void {
		if (template.elementDisposables) {
			template.elementDisposables.clear();
		}
	}
}

export class WorkspaceTrustTree extends WorkbenchObjectTree<WorkspaceTrustSettingsTreeEntry> {
	constructor(
		container: HTMLElement,
		renderers: ITreeRenderer<any, void, any>[],
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super('WorkspaceTrustTree', container,
			new WorkspaceTrustTreeDelegate(),
			renderers,
			{
				horizontalScrolling: false,
				alwaysConsumeMouseWheel: false,
				supportDynamicHeights: true,
				identityProvider: {
					getId(e) {
						return e.id;
					}
				},
				accessibilityProvider: new WorkspaceTrustTreeAccessibilityProvider(),
				styleController: id => new DefaultStyleController(createStyleSheet(container), id),
				smoothScrolling: configurationService.getValue<boolean>('workbench.list.smoothScrolling'),
				multipleSelectionSupport: false,
			},
			contextKeyService,
			listService,
			themeService,
			configurationService,
			keybindingService,
			accessibilityService,
		);

		this.disposables.add(registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {
			const foregroundColor = theme.getColor(foreground);
			if (foregroundColor) {
				// Links appear inside other elements in markdown. CSS opacity acts like a mask. So we have to dynamically compute the description color to avoid
				// applying an opacity to the link color.
				const fgWithOpacity = new Color(new RGBA(foregroundColor.rgba.r, foregroundColor.rgba.g, foregroundColor.rgba.b, 0.9));
				collector.addRule(`.workspace-trust-editor .workspace-trust-settings .workspace-trust-settings-tree-container .setting-item-contents .setting-item-description { color: ${fgWithOpacity}; }`);
				collector.addRule(`.workspace-trust-editor .workspace-trust-settings .settings-toc-container .monaco-list-row:not(.selected) { color: ${fgWithOpacity}; }`);

				// Hack for subpixel antialiasing
				collector.addRule(`.workspace-trust-editor .workspace-trust-settings .workspace-trust-settings-tree-container .setting-item-contents .setting-item-title .setting-item-overrides,
					.workspace-trust-editor .workspace-trust-settings .workspace-trust-settings-tree-container .setting-item-contents .setting-item-title .setting-item-ignored { color: ${fgWithOpacity}; }`);
			}

			const errorColor = theme.getColor(errorForeground);
			if (errorColor) {
				collector.addRule(`.workspace-trust-editor .workspace-trust-settings .workspace-trust-settings-tree-container .setting-item-contents .setting-item-deprecation-message { color: ${errorColor}; }`);
			}

			const invalidInputBackground = theme.getColor(inputValidationErrorBackground);
			if (invalidInputBackground) {
				collector.addRule(`.workspace-trust-editor .workspace-trust-settings .workspace-trust-settings-tree-container .setting-item-contents .setting-item-validation-message { background-color: ${invalidInputBackground}; }`);
			}

			const invalidInputForeground = theme.getColor(inputValidationErrorForeground);
			if (invalidInputForeground) {
				collector.addRule(`.workspace-trust-editor .workspace-trust-settings .workspace-trust-settings-tree-container .setting-item-contents .setting-item-validation-message { color: ${invalidInputForeground}; }`);
			}

			const invalidInputBorder = theme.getColor(inputValidationErrorBorder);
			if (invalidInputBorder) {
				collector.addRule(`.workspace-trust-editor .workspace-trust-settings .workspace-trust-settings-tree-container .setting-item-contents .setting-item-validation-message { border-style:solid; border-width: 1px; border-color: ${invalidInputBorder}; }`);
				collector.addRule(`.workspace-trust-editor .workspace-trust-settings .workspace-trust-settings-tree-container .setting-item.invalid-input .setting-item-control .monaco-inputbox.idle { outline-width: 0; border-style:solid; border-width: 1px; border-color: ${invalidInputBorder}; }`);
			}

			const focusedRowBackgroundColor = theme.getColor(focusedRowBackground);
			if (focusedRowBackgroundColor) {
				collector.addRule(`.workspace-trust-editor .workspace-trust-settings .workspace-trust-settings-tree-container .monaco-list-row.focused .settings-row-inner-container { background-color: ${focusedRowBackgroundColor}; }`);
			}

			const focusedRowBorderColor = theme.getColor(focusedRowBorder);
			if (focusedRowBorderColor) {
				collector.addRule(`.workspace-trust-editor .workspace-trust-settings .workspace-trust-settings-tree-container .monaco-list:focus-within .monaco-list-row.focused .setting-item-contents::before,
					.workspace-trust-editor .workspace-trust-settings .workspace-trust-settings-tree-container .monaco-list:focus-within .monaco-list-row.focused .setting-item-contents::after { border-top: 1px solid ${focusedRowBorderColor} }`);
				collector.addRule(`.workspace-trust-editor .workspace-trust-settings .workspace-trust-settings-tree-container .monaco-list:focus-within .monaco-list-row.focused .settings-group-title-label::before,
					.workspace-trust-editor .workspace-trust-settings .workspace-trust-settings-tree-container .monaco-list:focus-within .monaco-list-row.focused .settings-group-title-label::after { border-top: 1px solid ${focusedRowBorderColor} }`);
			}

			const headerForegroundColor = theme.getColor(settingsHeaderForeground);
			if (headerForegroundColor) {
				collector.addRule(`.workspace-trust-editor .workspace-trust-settings .workspace-trust-settings-tree-container .settings-group-title-label { color: ${headerForegroundColor}; }`);
				collector.addRule(`.workspace-trust-editor .workspace-trust-settings .workspace-trust-settings-tree-container .setting-item-label { color: ${headerForegroundColor}; }`);
			}

			const focusBorderColor = theme.getColor(focusBorder);
			if (focusBorderColor) {
				collector.addRule(`.workspace-trust-editor .workspace-trust-settings .workspace-trust-settings-tree-container .setting-item-contents .setting-item-markdown a:focus { outline-color: ${focusBorderColor} }`);
			}
		}));

		this.getHTMLElement().classList.add('settings-editor-tree');

		this.disposables.add(attachStyler(themeService, {
			listBackground: editorBackground,
			listActiveSelectionBackground: editorBackground,
			listActiveSelectionForeground: foreground,
			listFocusAndSelectionBackground: editorBackground,
			listFocusAndSelectionForeground: foreground,
			listFocusBackground: editorBackground,
			listFocusForeground: foreground,
			listHoverForeground: foreground,
			listHoverBackground: editorBackground,
			listHoverOutline: editorBackground,
			listFocusOutline: editorBackground,
			listInactiveSelectionBackground: editorBackground,
			listInactiveSelectionForeground: foreground,
			listInactiveFocusBackground: editorBackground,
			listInactiveFocusOutline: editorBackground
		}, colors => {
			this.style(colors);
		}));

		this.disposables.add(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('workbench.list.smoothScrolling')) {
				this.updateOptions({
					smoothScrolling: configurationService.getValue<boolean>('workbench.list.smoothScrolling')
				});
			}
		}));
	}

	protected override createModel(user: string, view: IList<ITreeNode<WorkspaceTrustSettingsTreeEntry>>, options: IObjectTreeOptions<WorkspaceTrustSettingsTreeEntry>): ITreeModel<WorkspaceTrustSettingsTreeEntry | null, void, WorkspaceTrustSettingsTreeEntry | null> {
		return new NonCollapsibleObjectTreeModel<WorkspaceTrustSettingsTreeEntry>(user, view, options);
	}
}

export class WorkspaceTrustTreeModel {

	settings: WorkspaceTrustSettingsTreeEntry[] = [];

	update(trustedFolders: URI[]): void {
		this.settings = [];
		this.settings.push(new WorkspaceTrustSettingsTreeEntry(
			'trustedFolders',
			localize('trustedFolders', "Trusted Folders"),
			localize('trustedFoldersDescription', "You trust the following folders and their children: "),
			trustedFolders));
	}
}

class WorkspaceTrustTreeAccessibilityProvider implements IListAccessibilityProvider<WorkspaceTrustSettingsTreeEntry> {
	getAriaLabel(element: WorkspaceTrustSettingsTreeEntry) {
		if (element instanceof WorkspaceTrustSettingsTreeEntry) {
			return `element.displayLabel`;
		}

		return null;
	}

	getWidgetAriaLabel() {
		return localize('settings', "Workspace Trust Setting");
	}
}

class WorkspaceTrustTreeDelegate extends CachedListVirtualDelegate<WorkspaceTrustSettingsTreeEntry> {

	getTemplateId(element: WorkspaceTrustSettingsTreeEntry): string {
		return 'template.setting.array';
	}

	hasDynamicHeight(element: WorkspaceTrustSettingsTreeEntry): boolean {
		return true;
	}

	protected estimateHeight(element: WorkspaceTrustSettingsTreeEntry): number {
		return 104;
	}
}

function getListDisplayValue(element: WorkspaceTrustSettingsTreeEntry): IWorkspaceTrustUriDataItem[] {
	if (!element.value || !isArray(element.value)) {
		return [];
	}

	return element.value;
}

function renderArrayValidations(dataElement: WorkspaceTrustSettingsTreeEntry, template: IWorkspaceTrustSettingListItemTemplate, v: URI[] | undefined, arg3: boolean) {
}

