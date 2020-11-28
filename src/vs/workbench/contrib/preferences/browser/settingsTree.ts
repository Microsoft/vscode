/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BrowserFeatures } from 'vs/base/browser/canIUse';
import * as DOM from 'vs/base/browser/dom';
import { renderMarkdown } from 'vs/base/browser/markdownRenderer';
import { IMouseEvent } from 'vs/base/browser/mouseEvent';
import { alert as ariaAlert } from 'vs/base/browser/ui/aria/aria';
import { Button } from 'vs/base/browser/ui/button/button';
import { Checkbox } from 'vs/base/browser/ui/checkbox/checkbox';
import { InputBox } from 'vs/base/browser/ui/inputbox/inputBox';
import { CachedListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { DefaultStyleController, IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { ISelectOptionItem, SelectBox } from 'vs/base/browser/ui/selectBox/selectBox';
import { ToolBar } from 'vs/base/browser/ui/toolbar/toolbar';
import { IObjectTreeOptions } from 'vs/base/browser/ui/tree/objectTree';
import { ObjectTreeModel } from 'vs/base/browser/ui/tree/objectTreeModel';
import { ITreeFilter, ITreeModel, ITreeNode, ITreeRenderer, TreeFilterResult, TreeVisibility } from 'vs/base/browser/ui/tree/tree';
import { Action, IAction, Separator } from 'vs/base/common/actions';
import * as arrays from 'vs/base/common/arrays';
import { Color, RGBA } from 'vs/base/common/color';
import { onUnexpectedError } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Disposable, DisposableStore, dispose } from 'vs/base/common/lifecycle';
import { isIOS } from 'vs/base/common/platform';
import { escapeRegExpCharacters } from 'vs/base/common/strings';
import { isArray, isDefined, isUndefinedOrNull } from 'vs/base/common/types';
import { localize } from 'vs/nls';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ConfigurationTarget, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextMenuService, IContextViewService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { editorBackground, errorForeground, focusBorder, foreground, inputValidationErrorBackground, inputValidationErrorBorder, inputValidationErrorForeground } from 'vs/platform/theme/common/colorRegistry';
import { attachButtonStyler, attachInputBoxStyler, attachSelectBoxStyler, attachStyler } from 'vs/platform/theme/common/styler';
import { ICssStyleCollector, IColorTheme, IThemeService, registerThemingParticipant, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { getIgnoredSettings } from 'vs/platform/userDataSync/common/settingsMerge';
import { ITOCEntry } from 'vs/workbench/contrib/preferences/browser/settingsLayout';
import { ISettingsEditorViewState, settingKeyToDisplayFormat, SettingsTreeElement, SettingsTreeGroupChild, SettingsTreeGroupElement, SettingsTreeNewExtensionsElement, SettingsTreeSettingElement } from 'vs/workbench/contrib/preferences/browser/settingsTreeModels';
import { ExcludeSettingWidget, ISettingListChangeEvent, IListDataItem, ListSettingWidget, settingsNumberInputBackground, settingsNumberInputBorder, settingsNumberInputForeground, settingsSelectBackground, settingsSelectBorder, settingsSelectForeground, settingsSelectListBorder, settingsTextInputBackground, settingsTextInputBorder, settingsTextInputForeground, ObjectSettingWidget, IObjectDataItem, IObjectEnumOption, ObjectValue, IObjectValueSuggester, IObjectKeySuggester, focusedRowBackground, focusedRowBorder, settingsHeaderForeground, rowHoverBackground } from 'vs/workbench/contrib/preferences/browser/settingsWidgets';
import { SETTINGS_EDITOR_COMMAND_SHOW_CONTEXT_MENU } from 'vs/workbench/contrib/preferences/common/preferences';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { ISetting, ISettingsGroup, SettingValueType } from 'vs/workbench/services/preferences/common/preferences';
import { getDefaultIgnoredSettings, IUserDataAutoSyncEnablementService } from 'vs/platform/userDataSync/common/userDataSync';
import { getInvalidTypeError } from 'vs/workbench/services/preferences/common/preferencesValidation';
import { Codicon } from 'vs/base/common/codicons';
import { CodiconLabel } from 'vs/base/browser/ui/codicons/codiconLabel';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { IList } from 'vs/base/browser/ui/tree/indexTreeModel';
import { IListService, WorkbenchObjectTree } from 'vs/platform/list/browser/listService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { ILogService } from 'vs/platform/log/common/log';
import { settingsMoreActionIcon } from 'vs/workbench/contrib/preferences/browser/preferencesIcons';

const $ = DOM.$;

function getExcludeDisplayValue(element: SettingsTreeSettingElement): IListDataItem[] {
	const data = element.isConfigured ?
		{ ...element.defaultValue, ...element.scopeValue } :
		element.defaultValue;

	return Object.keys(data)
		.filter(key => !!data[key])
		.map(key => {
			const value = data[key];
			const sibling = typeof value === 'boolean' ? undefined : value.when;

			return {
				id: key,
				value: key,
				sibling
			};
		});
}

function areAllPropertiesDefined(properties: string[], itemsToDisplay: IObjectDataItem[]): boolean {
	const staticProperties = new Set(properties);
	itemsToDisplay.forEach(({ key }) => staticProperties.delete(key.data));
	return staticProperties.size === 0;
}

function getEnumOptionsFromSchema(schema: IJSONSchema): IObjectEnumOption[] {
	const enumDescriptions = schema.enumDescriptions ?? [];

	return (schema.enum ?? []).map((value, idx) => {
		const description = idx < enumDescriptions.length
			? enumDescriptions[idx]
			: undefined;

		return { value, description };
	});
}

function getObjectValueType(schema: IJSONSchema): ObjectValue['type'] {
	if (schema.type === 'boolean') {
		return 'boolean';
	} else if (schema.type === 'string' && isDefined(schema.enum) && schema.enum.length > 0) {
		return 'enum';
	} else {
		return 'string';
	}
}

function getObjectDisplayValue(element: SettingsTreeSettingElement): IObjectDataItem[] {
	const elementDefaultValue: Record<string, unknown> = typeof element.defaultValue === 'object'
		? element.defaultValue ?? {}
		: {};

	const elementScopeValue: Record<string, unknown> = typeof element.scopeValue === 'object'
		? element.scopeValue ?? {}
		: {};

	const data = element.isConfigured ?
		{ ...elementDefaultValue, ...elementScopeValue } :
		elementDefaultValue;

	const { objectProperties, objectPatternProperties, objectAdditionalProperties } = element.setting;
	const patternsAndSchemas = Object
		.entries(objectPatternProperties ?? {})
		.map(([pattern, schema]) => ({
			pattern: new RegExp(pattern),
			schema
		}));

	const additionalValueEnums = getEnumOptionsFromSchema(
		typeof objectAdditionalProperties === 'boolean'
			? {}
			: objectAdditionalProperties ?? {}
	);

	const wellDefinedKeyEnumOptions = Object.entries(objectProperties ?? {}).map(
		([key, schema]) => ({ value: key, description: schema.description })
	);

	return Object.keys(data).map(key => {
		if (isDefined(objectProperties) && key in objectProperties) {
			const defaultValue = elementDefaultValue[key];
			const valueEnumOptions = getEnumOptionsFromSchema(objectProperties[key]);

			return {
				key: {
					type: 'enum',
					data: key,
					options: wellDefinedKeyEnumOptions,
				},
				value: {
					type: getObjectValueType(objectProperties[key]),
					data: data[key],
					options: valueEnumOptions,
				},
				removable: isUndefinedOrNull(defaultValue),
			} as IObjectDataItem;
		}

		const schema = patternsAndSchemas.find(({ pattern }) => pattern.test(key))?.schema;

		if (schema) {
			const valueEnumOptions = getEnumOptionsFromSchema(schema);
			return {
				key: { type: 'string', data: key },
				value: {
					type: getObjectValueType(schema),
					data: data[key],
					options: valueEnumOptions,
				},
				removable: true,
			} as IObjectDataItem;
		}

		return {
			key: { type: 'string', data: key },
			value: {
				type: typeof objectAdditionalProperties === 'object' ? getObjectValueType(objectAdditionalProperties) : 'string',
				data: data[key],
				options: additionalValueEnums,
			},
			removable: true,
		} as IObjectDataItem;
	});
}

function createObjectKeySuggester(element: SettingsTreeSettingElement): IObjectKeySuggester {
	const { objectProperties } = element.setting;
	const allStaticKeys = Object.keys(objectProperties ?? {});

	return keys => {
		const existingKeys = new Set(keys);
		const enumOptions: IObjectEnumOption[] = [];

		allStaticKeys.forEach(staticKey => {
			if (!existingKeys.has(staticKey)) {
				enumOptions.push({ value: staticKey, description: objectProperties![staticKey].description });
			}
		});

		return enumOptions.length > 0
			? { type: 'enum', data: enumOptions[0].value, options: enumOptions }
			: undefined;
	};
}

function createObjectValueSuggester(element: SettingsTreeSettingElement): IObjectValueSuggester {
	const { objectProperties, objectPatternProperties, objectAdditionalProperties } = element.setting;

	const patternsAndSchemas = Object
		.entries(objectPatternProperties ?? {})
		.map(([pattern, schema]) => ({
			pattern: new RegExp(pattern),
			schema
		}));

	return (key: string) => {
		let suggestedSchema: IJSONSchema | undefined;

		if (isDefined(objectProperties) && key in objectProperties) {
			suggestedSchema = objectProperties[key];
		}

		const patternSchema = suggestedSchema ?? patternsAndSchemas.find(({ pattern }) => pattern.test(key))?.schema;

		if (isDefined(patternSchema)) {
			suggestedSchema = patternSchema;
		} else if (isDefined(objectAdditionalProperties) && typeof objectAdditionalProperties === 'object') {
			suggestedSchema = objectAdditionalProperties;
		}

		if (isDefined(suggestedSchema)) {
			const type = getObjectValueType(suggestedSchema);

			if (type === 'boolean') {
				return { type, data: suggestedSchema.default ?? true };
			} else if (type === 'enum') {
				const options = getEnumOptionsFromSchema(suggestedSchema);
				return { type, data: suggestedSchema.default ?? options[0].value, options };
			} else {
				return { type, data: suggestedSchema.default ?? '' };
			}
		}

		return;
	};
}

function getListDisplayValue(element: SettingsTreeSettingElement): IListDataItem[] {
	if (!element.value || !isArray(element.value)) {
		return [];
	}

	return element.value.map((key: string) => {
		return {
			value: key
		};
	});
}

export function resolveSettingsTree(tocData: ITOCEntry<string>, coreSettingsGroups: ISettingsGroup[], logService: ILogService): { tree: ITOCEntry<ISetting>, leftoverSettings: Set<ISetting> } {
	const allSettings = getFlatSettings(coreSettingsGroups);
	return {
		tree: _resolveSettingsTree(tocData, allSettings, logService),
		leftoverSettings: allSettings
	};
}

export function resolveExtensionsSettings(groups: ISettingsGroup[]): ITOCEntry<ISetting> {
	const settingsGroupToEntry = (group: ISettingsGroup) => {
		const flatSettings = arrays.flatten(
			group.sections.map(section => section.settings));

		return {
			id: group.id,
			label: group.title,
			settings: flatSettings
		};
	};

	const extGroups = groups
		.sort((a, b) => a.title.localeCompare(b.title))
		.map(g => settingsGroupToEntry(g));

	return {
		id: 'extensions',
		label: localize('extensions', "Extensions"),
		children: extGroups
	};
}

function _resolveSettingsTree(tocData: ITOCEntry<string>, allSettings: Set<ISetting>, logService: ILogService): ITOCEntry<ISetting> {
	let children: ITOCEntry<ISetting>[] | undefined;
	if (tocData.children) {
		children = tocData.children
			.map(child => _resolveSettingsTree(child, allSettings, logService))
			.filter(child => (child.children && child.children.length) || (child.settings && child.settings.length));
	}

	let settings: ISetting[] | undefined;
	if (tocData.settings) {
		settings = arrays.flatten(tocData.settings.map(pattern => getMatchingSettings(allSettings, pattern, logService)));
	}

	if (!children && !settings) {
		throw new Error(`TOC node has no child groups or settings: ${tocData.id}`);
	}

	return {
		id: tocData.id,
		label: tocData.label,
		children,
		settings
	};
}

function getMatchingSettings(allSettings: Set<ISetting>, pattern: string, logService: ILogService): ISetting[] {
	const result: ISetting[] = [];

	allSettings.forEach(s => {
		if (settingMatches(s, pattern)) {
			result.push(s);
			allSettings.delete(s);
		}
	});

	if (!result.length) {
		logService.warn(`Settings pattern "${pattern}" doesn't match any settings`);
	}

	return result.sort((a, b) => a.key.localeCompare(b.key));
}

const settingPatternCache = new Map<string, RegExp>();

export function createSettingMatchRegExp(pattern: string): RegExp {
	pattern = escapeRegExpCharacters(pattern)
		.replace(/\\\*/g, '.*');

	return new RegExp(`^${pattern}$`, 'i');
}

function settingMatches(s: ISetting, pattern: string): boolean {
	let regExp = settingPatternCache.get(pattern);
	if (!regExp) {
		regExp = createSettingMatchRegExp(pattern);
		settingPatternCache.set(pattern, regExp);
	}

	return regExp.test(s.key);
}

function getFlatSettings(settingsGroups: ISettingsGroup[]) {
	const result: Set<ISetting> = new Set();

	for (const group of settingsGroups) {
		for (const section of group.sections) {
			for (const s of section.settings) {
				if (!s.overrides || !s.overrides.length) {
					result.add(s);
				}
			}
		}
	}

	return result;
}

interface IDisposableTemplate {
	toDispose: DisposableStore;
}

interface ISettingItemTemplate<T = any> extends IDisposableTemplate {
	onChange?: (value: T) => void;

	context?: SettingsTreeSettingElement;
	containerElement: HTMLElement;
	categoryElement: HTMLElement;
	labelElement: HTMLElement;
	descriptionElement: HTMLElement;
	controlElement: HTMLElement;
	deprecationWarningElement: HTMLElement;
	otherOverridesElement: HTMLElement;
	syncIgnoredElement: HTMLElement;
	toolbar: ToolBar;
	elementDisposables: DisposableStore;
}

interface ISettingBoolItemTemplate extends ISettingItemTemplate<boolean> {
	checkbox: Checkbox;
}

interface ISettingTextItemTemplate extends ISettingItemTemplate<string> {
	inputBox: InputBox;
	validationErrorMessageElement: HTMLElement;
}

type ISettingNumberItemTemplate = ISettingTextItemTemplate;

interface ISettingEnumItemTemplate extends ISettingItemTemplate<number> {
	selectBox: SelectBox;
	enumDescriptionElement: HTMLElement;
}

interface ISettingComplexItemTemplate extends ISettingItemTemplate<void> {
	button: Button;
	validationErrorMessageElement: HTMLElement;
}

interface ISettingListItemTemplate extends ISettingItemTemplate<string[] | undefined> {
	listWidget: ListSettingWidget;
	validationErrorMessageElement: HTMLElement;
}

interface ISettingExcludeItemTemplate extends ISettingItemTemplate<void> {
	excludeWidget: ListSettingWidget;
}

interface ISettingObjectItemTemplate extends ISettingItemTemplate<void> {
	objectWidget: ObjectSettingWidget;
}

interface ISettingNewExtensionsTemplate extends IDisposableTemplate {
	button: Button;
	context?: SettingsTreeNewExtensionsElement;
}

interface IGroupTitleTemplate extends IDisposableTemplate {
	context?: SettingsTreeGroupElement;
	parent: HTMLElement;
}

const SETTINGS_TEXT_TEMPLATE_ID = 'settings.text.template';
const SETTINGS_NUMBER_TEMPLATE_ID = 'settings.number.template';
const SETTINGS_ENUM_TEMPLATE_ID = 'settings.enum.template';
const SETTINGS_BOOL_TEMPLATE_ID = 'settings.bool.template';
const SETTINGS_ARRAY_TEMPLATE_ID = 'settings.array.template';
const SETTINGS_EXCLUDE_TEMPLATE_ID = 'settings.exclude.template';
const SETTINGS_OBJECT_TEMPLATE_ID = 'settings.object.template';
const SETTINGS_COMPLEX_TEMPLATE_ID = 'settings.complex.template';
const SETTINGS_NEW_EXTENSIONS_TEMPLATE_ID = 'settings.newExtensions.template';
const SETTINGS_ELEMENT_TEMPLATE_ID = 'settings.group.template';

export interface ISettingChangeEvent {
	key: string;
	value: any; // undefined => reset/unconfigure
	type: SettingValueType | SettingValueType[];
}

export interface ISettingLinkClickEvent {
	source: SettingsTreeSettingElement;
	targetKey: string;
}

export interface ISettingOverrideClickEvent {
	scope: string;
	targetKey: string;
}

function removeChildrenFromTabOrder(node: Element): void {
	const focusableElements = node.querySelectorAll(`
		[tabindex="0"],
		input:not([tabindex="-1"]),
		select:not([tabindex="-1"]),
		textarea:not([tabindex="-1"]),
		a:not([tabindex="-1"]),
		button:not([tabindex="-1"]),
		area:not([tabindex="-1"])
	`);

	focusableElements.forEach(element => {
		element.setAttribute(AbstractSettingRenderer.ELEMENT_FOCUSABLE_ATTR, 'true');
		element.setAttribute('tabindex', '-1');
	});
}

function addChildrenToTabOrder(node: Element): void {
	const focusableElements = node.querySelectorAll(
		`[${AbstractSettingRenderer.ELEMENT_FOCUSABLE_ATTR}="true"]`
	);

	focusableElements.forEach(element => {
		element.removeAttribute(AbstractSettingRenderer.ELEMENT_FOCUSABLE_ATTR);
		element.setAttribute('tabindex', '0');
	});
}

export abstract class AbstractSettingRenderer extends Disposable implements ITreeRenderer<SettingsTreeElement, never, any> {
	/** To override */
	abstract get templateId(): string;

	static readonly CONTROL_CLASS = 'setting-control-focus-target';
	static readonly CONTROL_SELECTOR = '.' + AbstractSettingRenderer.CONTROL_CLASS;
	static readonly CONTENTS_CLASS = 'setting-item-contents';
	static readonly CONTENTS_SELECTOR = '.' + AbstractSettingRenderer.CONTENTS_CLASS;
	static readonly ALL_ROWS_SELECTOR = '.monaco-list-row';

	static readonly SETTING_KEY_ATTR = 'data-key';
	static readonly SETTING_ID_ATTR = 'data-id';
	static readonly ELEMENT_FOCUSABLE_ATTR = 'data-focusable';

	private readonly _onDidClickOverrideElement = this._register(new Emitter<ISettingOverrideClickEvent>());
	readonly onDidClickOverrideElement: Event<ISettingOverrideClickEvent> = this._onDidClickOverrideElement.event;

	protected readonly _onDidChangeSetting = this._register(new Emitter<ISettingChangeEvent>());
	readonly onDidChangeSetting: Event<ISettingChangeEvent> = this._onDidChangeSetting.event;

	protected readonly _onDidOpenSettings = this._register(new Emitter<string>());
	readonly onDidOpenSettings: Event<string> = this._onDidOpenSettings.event;

	private readonly _onDidClickSettingLink = this._register(new Emitter<ISettingLinkClickEvent>());
	readonly onDidClickSettingLink: Event<ISettingLinkClickEvent> = this._onDidClickSettingLink.event;

	private readonly _onDidFocusSetting = this._register(new Emitter<SettingsTreeSettingElement>());
	readonly onDidFocusSetting: Event<SettingsTreeSettingElement> = this._onDidFocusSetting.event;

	private ignoredSettings: string[];
	private readonly _onDidChangeIgnoredSettings = this._register(new Emitter<void>());
	readonly onDidChangeIgnoredSettings: Event<void> = this._onDidChangeIgnoredSettings.event;

	constructor(
		private readonly settingActions: IAction[],
		private readonly disposableActionFactory: (setting: ISetting) => IAction[],
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

		this.ignoredSettings = getIgnoredSettings(getDefaultIgnoredSettings(), this._configService);
		this._register(this._configService.onDidChangeConfiguration(e => {
			if (e.affectedKeys.includes('settingsSync.ignoredSettings')) {
				this.ignoredSettings = getIgnoredSettings(getDefaultIgnoredSettings(), this._configService);
				this._onDidChangeIgnoredSettings.fire();
			}
		}));
	}

	renderTemplate(container: HTMLElement): any {
		throw new Error('to override');
	}

	renderElement(element: ITreeNode<SettingsTreeSettingElement, never>, index: number, templateData: any): void {
		throw new Error('to override');
	}

	protected createSyncIgnoredElement(container: HTMLElement): HTMLElement {
		const syncIgnoredElement = DOM.append(container, $('span.setting-item-ignored'));
		const syncIgnoredLabel = new CodiconLabel(syncIgnoredElement);
		syncIgnoredLabel.text = `($(sync-ignored) ${localize('extensionSyncIgnoredLabel', 'Sync: Ignored')})`;

		return syncIgnoredElement;
	}

	protected renderCommonTemplate(tree: any, _container: HTMLElement, typeClass: string): ISettingItemTemplate {
		_container.classList.add('setting-item');
		_container.classList.add('setting-item-' + typeClass);

		const container = DOM.append(_container, $(AbstractSettingRenderer.CONTENTS_SELECTOR));
		container.classList.add('settings-row-inner-container');
		const titleElement = DOM.append(container, $('.setting-item-title'));
		const labelCategoryContainer = DOM.append(titleElement, $('.setting-item-cat-label-container'));
		const categoryElement = DOM.append(labelCategoryContainer, $('span.setting-item-category'));
		const labelElement = DOM.append(labelCategoryContainer, $('span.setting-item-label'));
		const otherOverridesElement = DOM.append(titleElement, $('span.setting-item-overrides'));
		const syncIgnoredElement = this.createSyncIgnoredElement(titleElement);

		const descriptionElement = DOM.append(container, $('.setting-item-description'));
		const modifiedIndicatorElement = DOM.append(container, $('.setting-item-modified-indicator'));
		modifiedIndicatorElement.title = localize('modified', "Modified");

		const valueElement = DOM.append(container, $('.setting-item-value'));
		const controlElement = DOM.append(valueElement, $('div.setting-item-control'));

		const deprecationWarningElement = DOM.append(container, $('.setting-item-deprecation-message'));

		const toDispose = new DisposableStore();

		const toolbarContainer = DOM.append(container, $('.setting-toolbar-container'));
		const toolbar = this.renderSettingToolbar(toolbarContainer);

		const template: ISettingItemTemplate = {
			toDispose,
			elementDisposables: new DisposableStore(),

			containerElement: container,
			categoryElement,
			labelElement,
			descriptionElement,
			controlElement,
			deprecationWarningElement,
			otherOverridesElement,
			syncIgnoredElement,
			toolbar
		};

		// Prevent clicks from being handled by list
		toDispose.add(DOM.addDisposableListener(controlElement, DOM.EventType.MOUSE_DOWN, e => e.stopPropagation()));

		toDispose.add(DOM.addDisposableListener(titleElement, DOM.EventType.MOUSE_ENTER, e => container.classList.add('mouseover')));
		toDispose.add(DOM.addDisposableListener(titleElement, DOM.EventType.MOUSE_LEAVE, e => container.classList.remove('mouseover')));

		return template;
	}

	protected addSettingElementFocusHandler(template: ISettingItemTemplate): void {
		const focusTracker = DOM.trackFocus(template.containerElement);
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

	protected renderSettingToolbar(container: HTMLElement): ToolBar {
		const toggleMenuKeybinding = this._keybindingService.lookupKeybinding(SETTINGS_EDITOR_COMMAND_SHOW_CONTEXT_MENU);
		let toggleMenuTitle = localize('settingsContextMenuTitle', "More Actions... ");
		if (toggleMenuKeybinding) {
			toggleMenuTitle += ` (${toggleMenuKeybinding && toggleMenuKeybinding.getLabel()})`;
		}

		const toolbar = new ToolBar(container, this._contextMenuService, {
			toggleMenuTitle,
			renderDropdownAsChildElement: true,
			moreIcon: ThemeIcon.asCSSIcon(settingsMoreActionIcon) // change icon from ellipsis to gear
		});
		return toolbar;
	}

	protected renderSettingElement(node: ITreeNode<SettingsTreeSettingElement, never>, index: number, template: ISettingItemTemplate | ISettingBoolItemTemplate): void {
		const element = node.element;
		template.context = element;
		template.toolbar.context = element;
		const actions = this.disposableActionFactory(element.setting);
		actions.forEach(a => template.elementDisposables?.add(a));
		template.toolbar.setActions([], [...this.settingActions, ...actions]);

		const setting = element.setting;

		template.containerElement.classList.toggle('is-configured', element.isConfigured);
		template.containerElement.setAttribute(AbstractSettingRenderer.SETTING_KEY_ATTR, element.setting.key);
		template.containerElement.setAttribute(AbstractSettingRenderer.SETTING_ID_ATTR, element.id);

		const titleTooltip = setting.key + (element.isConfigured ? ' - Modified' : '');
		template.categoryElement.textContent = element.displayCategory && (element.displayCategory + ': ');
		template.categoryElement.title = titleTooltip;

		template.labelElement.textContent = element.displayLabel;
		template.labelElement.title = titleTooltip;

		template.descriptionElement.innerText = '';
		if (element.setting.descriptionIsMarkdown) {
			const disposables = new DisposableStore();
			template.toDispose.add(disposables);
			const renderedDescription = this.renderSettingMarkdown(element, element.description, disposables);
			template.descriptionElement.appendChild(renderedDescription);
		} else {
			template.descriptionElement.innerText = element.description;
		}

		template.otherOverridesElement.innerText = '';
		template.otherOverridesElement.style.display = 'none';
		if (element.overriddenScopeList.length) {
			template.otherOverridesElement.style.display = 'inline';

			const otherOverridesLabel = element.isConfigured ?
				localize('alsoConfiguredIn', "Also modified in") :
				localize('configuredIn', "Modified in");

			DOM.append(template.otherOverridesElement, $('span', undefined, `(${otherOverridesLabel}: `));

			for (let i = 0; i < element.overriddenScopeList.length; i++) {
				const view = DOM.append(template.otherOverridesElement, $('a.modified-scope', undefined, element.overriddenScopeList[i]));

				if (i !== element.overriddenScopeList.length - 1) {
					DOM.append(template.otherOverridesElement, $('span', undefined, ', '));
				} else {
					DOM.append(template.otherOverridesElement, $('span', undefined, ')'));
				}

				template.elementDisposables.add(
					DOM.addStandardDisposableListener(view, DOM.EventType.CLICK, (e: IMouseEvent) => {
						this._onDidClickOverrideElement.fire({
							targetKey: element.setting.key,
							scope: element.overriddenScopeList[i]
						});
						e.preventDefault();
						e.stopPropagation();
					}));
			}
		}

		const onChange = (value: any) => this._onDidChangeSetting.fire({ key: element.setting.key, value, type: template.context!.valueType });
		const deprecationText = element.setting.deprecationMessage || '';
		if (deprecationText && element.setting.deprecationMessageIsMarkdown) {
			const disposables = new DisposableStore();
			template.elementDisposables.add(disposables);
			template.deprecationWarningElement.innerText = '';
			template.deprecationWarningElement.appendChild(this.renderSettingMarkdown(element, element.setting.deprecationMessage!, template.elementDisposables));
		} else {
			template.deprecationWarningElement.innerText = deprecationText;
		}
		template.containerElement.classList.toggle('is-deprecated', !!deprecationText);

		this.renderValue(element, <ISettingItemTemplate>template, onChange);

		const update = () => {
			template.syncIgnoredElement.style.display = this.ignoredSettings.includes(element.setting.key) ? 'inline' : 'none';
		};
		update();
		template.elementDisposables.add(this.onDidChangeIgnoredSettings(() => {
			update();
		}));

		this.updateSettingTabbable(element, template);
		template.elementDisposables.add(element.onDidChangeTabbable(() => {
			this.updateSettingTabbable(element, template);
		}));
	}

	private updateSettingTabbable(element: SettingsTreeSettingElement, template: ISettingItemTemplate | ISettingBoolItemTemplate): void {
		if (element.tabbable) {
			addChildrenToTabOrder(template.containerElement);
		} else {
			removeChildrenFromTabOrder(template.containerElement);
		}
	}

	private renderSettingMarkdown(element: SettingsTreeSettingElement, text: string, disposeables: DisposableStore): HTMLElement {
		// Rewrite `#editor.fontSize#` to link format
		text = fixSettingLinks(text);

		const renderedMarkdown = renderMarkdown({ value: text, isTrusted: true }, {
			actionHandler: {
				callback: (content: string) => {
					if (content.startsWith('#')) {
						const e: ISettingLinkClickEvent = {
							source: element,
							targetKey: content.substr(1)
						};
						this._onDidClickSettingLink.fire(e);
					} else {
						this._openerService.open(content).catch(onUnexpectedError);
					}
				},
				disposeables
			}
		});

		renderedMarkdown.classList.add('setting-item-markdown');
		cleanRenderedMarkdown(renderedMarkdown);
		return renderedMarkdown;
	}

	protected abstract renderValue(dataElement: SettingsTreeSettingElement, template: ISettingItemTemplate, onChange: (value: any) => void): void;

	disposeTemplate(template: IDisposableTemplate): void {
		dispose(template.toDispose);
	}

	disposeElement(_element: ITreeNode<SettingsTreeElement>, _index: number, template: IDisposableTemplate, _height: number | undefined): void {
		if ((template as ISettingItemTemplate).elementDisposables) {
			(template as ISettingItemTemplate).elementDisposables.clear();
		}
	}
}

export class SettingGroupRenderer implements ITreeRenderer<SettingsTreeGroupElement, never, IGroupTitleTemplate> {
	templateId = SETTINGS_ELEMENT_TEMPLATE_ID;

	renderTemplate(container: HTMLElement): IGroupTitleTemplate {
		container.classList.add('group-title');

		const template: IGroupTitleTemplate = {
			parent: container,
			toDispose: new DisposableStore()
		};

		return template;
	}

	renderElement(element: ITreeNode<SettingsTreeGroupElement, never>, index: number, templateData: IGroupTitleTemplate): void {
		templateData.parent.innerText = '';
		const labelElement = DOM.append(templateData.parent, $('div.settings-group-title-label.settings-row-inner-container'));
		labelElement.classList.add(`settings-group-level-${element.element.level}`);
		labelElement.textContent = element.element.label;

		if (element.element.isFirstGroup) {
			labelElement.classList.add('settings-group-first');
		}
	}

	disposeTemplate(templateData: IGroupTitleTemplate): void {
	}
}

export class SettingNewExtensionsRenderer implements ITreeRenderer<SettingsTreeNewExtensionsElement, never, ISettingNewExtensionsTemplate> {
	templateId = SETTINGS_NEW_EXTENSIONS_TEMPLATE_ID;

	constructor(
		@IThemeService private readonly _themeService: IThemeService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
	}

	renderTemplate(container: HTMLElement): ISettingNewExtensionsTemplate {
		const toDispose = new DisposableStore();

		container.classList.add('setting-item-new-extensions');

		const button = new Button(container, { title: true, buttonBackground: undefined, buttonHoverBackground: undefined });
		toDispose.add(button);
		toDispose.add(button.onDidClick(() => {
			if (template.context) {
				this._commandService.executeCommand('workbench.extensions.action.showExtensionsWithIds', template.context.extensionIds);
			}
		}));
		button.label = localize('newExtensionsButtonLabel', "Show matching extensions");
		button.element.classList.add('settings-new-extensions-button');
		toDispose.add(attachButtonStyler(button, this._themeService));

		const template: ISettingNewExtensionsTemplate = {
			button,
			toDispose
		};

		return template;
	}

	renderElement(element: ITreeNode<SettingsTreeNewExtensionsElement, never>, index: number, templateData: ISettingNewExtensionsTemplate): void {
		templateData.context = element.element;
	}

	disposeTemplate(template: IDisposableTemplate): void {
		dispose(template.toDispose);
	}
}

export class SettingComplexRenderer extends AbstractSettingRenderer implements ITreeRenderer<SettingsTreeSettingElement, never, ISettingComplexItemTemplate> {
	private static readonly EDIT_IN_JSON_LABEL = localize('editInSettingsJson', "Edit in settings.json");

	templateId = SETTINGS_COMPLEX_TEMPLATE_ID;

	renderTemplate(container: HTMLElement): ISettingComplexItemTemplate {
		const common = this.renderCommonTemplate(null, container, 'complex');

		const openSettingsButton = new Button(common.controlElement, { title: true, buttonBackground: undefined, buttonHoverBackground: undefined });
		common.toDispose.add(openSettingsButton);
		common.toDispose.add(openSettingsButton.onDidClick(() => template.onChange!()));
		openSettingsButton.label = SettingComplexRenderer.EDIT_IN_JSON_LABEL;
		openSettingsButton.element.classList.add('edit-in-settings-button');
		openSettingsButton.element.classList.add(AbstractSettingRenderer.CONTROL_CLASS);

		common.toDispose.add(attachButtonStyler(openSettingsButton, this._themeService, {
			buttonBackground: Color.transparent.toString(),
			buttonHoverBackground: Color.transparent.toString(),
			buttonForeground: 'foreground'
		}));

		const validationErrorMessageElement = $('.setting-item-validation-message');
		common.containerElement.appendChild(validationErrorMessageElement);

		const template: ISettingComplexItemTemplate = {
			...common,
			button: openSettingsButton,
			validationErrorMessageElement
		};

		this.addSettingElementFocusHandler(template);

		return template;
	}

	renderElement(element: ITreeNode<SettingsTreeSettingElement, never>, index: number, templateData: ISettingComplexItemTemplate): void {
		super.renderSettingElement(element, index, templateData);
	}

	protected renderValue(dataElement: SettingsTreeSettingElement, template: ISettingComplexItemTemplate, onChange: (value: string) => void): void {
		template.onChange = () => this._onDidOpenSettings.fire(dataElement.setting.key);
		this.renderValidations(dataElement, template);

		template.button.element.setAttribute('aria-label', `${SettingComplexRenderer.EDIT_IN_JSON_LABEL}: ${dataElement.setting.key}`);
	}

	private renderValidations(dataElement: SettingsTreeSettingElement, template: ISettingComplexItemTemplate) {
		const errMsg = dataElement.isConfigured && getInvalidTypeError(dataElement.value, dataElement.setting.type);
		if (errMsg) {
			template.containerElement.classList.add('invalid-input');
			template.validationErrorMessageElement.innerText = errMsg;
			return;
		}

		template.containerElement.classList.remove('invalid-input');
	}
}

export class SettingArrayRenderer extends AbstractSettingRenderer implements ITreeRenderer<SettingsTreeSettingElement, never, ISettingListItemTemplate> {
	templateId = SETTINGS_ARRAY_TEMPLATE_ID;

	renderTemplate(container: HTMLElement): ISettingListItemTemplate {
		const common = this.renderCommonTemplate(null, container, 'list');
		const descriptionElement = common.containerElement.querySelector('.setting-item-description')!;
		const validationErrorMessageElement = $('.setting-item-validation-message');
		descriptionElement.after(validationErrorMessageElement);

		const listWidget = this._instantiationService.createInstance(ListSettingWidget, common.controlElement);
		listWidget.domNode.classList.add(AbstractSettingRenderer.CONTROL_CLASS);
		common.toDispose.add(listWidget);

		const template: ISettingListItemTemplate = {
			...common,
			listWidget,
			validationErrorMessageElement
		};

		this.addSettingElementFocusHandler(template);

		common.toDispose.add(
			listWidget.onDidChangeList(e => {
				const newList = this.computeNewList(template, e);
				this.onDidChangeList(template, newList);
				if (newList !== null && template.onChange) {
					template.onChange(newList);
				}
			})
		);

		return template;
	}

	private onDidChangeList(template: ISettingListItemTemplate, newList: string[] | undefined | null): void {
		if (!template.context || newList === null) {
			return;
		}

		this._onDidChangeSetting.fire({
			key: template.context.setting.key,
			value: newList,
			type: template.context.valueType
		});
	}

	private computeNewList(template: ISettingListItemTemplate, e: ISettingListChangeEvent<IListDataItem>): string[] | undefined | null {
		if (template.context) {
			let newValue: string[] = [];
			if (isArray(template.context.scopeValue)) {
				newValue = [...template.context.scopeValue];
			} else if (isArray(template.context.value)) {
				newValue = [...template.context.value];
			}

			if (e.targetIndex !== undefined) {
				// Delete value
				if (!e.item?.value && e.originalItem.value && e.targetIndex > -1) {
					newValue.splice(e.targetIndex, 1);
				}
				// Update value
				else if (e.item?.value && e.originalItem.value) {
					if (e.targetIndex > -1) {
						newValue[e.targetIndex] = e.item.value;
					}
					// For some reason, we are updating and cannot find original value
					// Just append the value in this case
					else {
						newValue.push(e.item.value);
					}
				}
				// Add value
				else if (e.item?.value && !e.originalItem.value && e.targetIndex >= newValue.length) {
					newValue.push(e.item.value);
				}
			}
			if (
				template.context.defaultValue &&
				isArray(template.context.defaultValue) &&
				template.context.defaultValue.length === newValue.length &&
				template.context.defaultValue.join() === newValue.join()
			) {
				return undefined;
			}

			return newValue;
		}

		return undefined;
	}

	renderElement(element: ITreeNode<SettingsTreeSettingElement, never>, index: number, templateData: ISettingListItemTemplate): void {
		super.renderSettingElement(element, index, templateData);
	}

	protected renderValue(dataElement: SettingsTreeSettingElement, template: ISettingListItemTemplate, onChange: (value: string[] | undefined) => void): void {
		const value = getListDisplayValue(dataElement);
		template.listWidget.setValue(value);
		template.context = dataElement;

		template.onChange = (v) => {
			onChange(v);
			renderArrayValidations(dataElement, template, v, false);
		};

		renderArrayValidations(dataElement, template, value.map(v => v.value), true);
	}
}

export class SettingObjectRenderer extends AbstractSettingRenderer implements ITreeRenderer<SettingsTreeSettingElement, never, ISettingObjectItemTemplate> {
	templateId = SETTINGS_OBJECT_TEMPLATE_ID;

	renderTemplate(container: HTMLElement): ISettingObjectItemTemplate {
		const common = this.renderCommonTemplate(null, container, 'list');

		const objectWidget = this._instantiationService.createInstance(ObjectSettingWidget, common.controlElement);
		objectWidget.domNode.classList.add(AbstractSettingRenderer.CONTROL_CLASS);
		common.toDispose.add(objectWidget);

		const template: ISettingObjectItemTemplate = {
			...common,
			objectWidget: objectWidget,
		};

		this.addSettingElementFocusHandler(template);

		common.toDispose.add(objectWidget.onDidChangeList(e => this.onDidChangeObject(template, e)));

		return template;
	}

	private onDidChangeObject(template: ISettingObjectItemTemplate, e: ISettingListChangeEvent<IObjectDataItem>): void {
		if (template.context) {
			const defaultValue: Record<string, unknown> = typeof template.context.defaultValue === 'object'
				? template.context.defaultValue ?? {}
				: {};

			const scopeValue: Record<string, unknown> = typeof template.context.scopeValue === 'object'
				? template.context.scopeValue ?? {}
				: {};

			const newValue: Record<string, unknown> = {};
			const newItems: IObjectDataItem[] = [];

			template.objectWidget.items.forEach((item, idx) => {
				// Item was updated
				if (isDefined(e.item) && e.targetIndex === idx) {
					newValue[e.item.key.data] = e.item.value.data;
					newItems.push(e.item);
				}
				// All remaining items, but skip the one that we just updated
				else if (isUndefinedOrNull(e.item) || e.item.key.data !== item.key.data) {
					newValue[item.key.data] = item.value.data;
					newItems.push(item);
				}
			});

			// Item was deleted
			if (isUndefinedOrNull(e.item)) {
				delete newValue[e.originalItem.key.data];

				const itemToDelete = newItems.findIndex(item => item.key.data === e.originalItem.key.data);
				const defaultItemValue = defaultValue[e.originalItem.key.data] as string | boolean;

				// Item does not have a default
				if (isUndefinedOrNull(defaultValue[e.originalItem.key.data]) && itemToDelete > -1) {
					newItems.splice(itemToDelete, 1);
				} else if (itemToDelete > -1) {
					newItems[itemToDelete].value.data = defaultItemValue;
				}
			}
			// New item was added
			else if (template.objectWidget.isItemNew(e.originalItem) && e.item.key.data !== '') {
				newValue[e.item.key.data] = e.item.value.data;
				newItems.push(e.item);
			}

			Object.entries(newValue).forEach(([key, value]) => {
				// value from the scope has changed back to the default
				if (scopeValue[key] !== value && defaultValue[key] === value) {
					delete newValue[key];
				}
			});

			this._onDidChangeSetting.fire({
				key: template.context.setting.key,
				value: Object.keys(newValue).length === 0 ? undefined : newValue,
				type: template.context.valueType
			});

			template.objectWidget.setValue(newItems);
		}
	}

	renderElement(element: ITreeNode<SettingsTreeSettingElement, never>, index: number, templateData: ISettingObjectItemTemplate): void {
		super.renderSettingElement(element, index, templateData);
	}

	protected renderValue(dataElement: SettingsTreeSettingElement, template: ISettingObjectItemTemplate, onChange: (value: string) => void): void {
		const items = getObjectDisplayValue(dataElement);
		const { key, objectProperties, objectPatternProperties, objectAdditionalProperties } = dataElement.setting;

		template.objectWidget.setValue(items, {
			settingKey: key,
			showAddButton: objectAdditionalProperties === false
				? (
					!areAllPropertiesDefined(Object.keys(objectProperties ?? {}), items) ||
					isDefined(objectPatternProperties)
				)
				: true,
			keySuggester: createObjectKeySuggester(dataElement),
			valueSuggester: createObjectValueSuggester(dataElement),
		});

		template.context = dataElement;
	}
}

export class SettingExcludeRenderer extends AbstractSettingRenderer implements ITreeRenderer<SettingsTreeSettingElement, never, ISettingExcludeItemTemplate> {
	templateId = SETTINGS_EXCLUDE_TEMPLATE_ID;

	renderTemplate(container: HTMLElement): ISettingExcludeItemTemplate {
		const common = this.renderCommonTemplate(null, container, 'list');

		const excludeWidget = this._instantiationService.createInstance(ExcludeSettingWidget, common.controlElement);
		excludeWidget.domNode.classList.add(AbstractSettingRenderer.CONTROL_CLASS);
		common.toDispose.add(excludeWidget);

		const template: ISettingExcludeItemTemplate = {
			...common,
			excludeWidget
		};

		this.addSettingElementFocusHandler(template);

		common.toDispose.add(excludeWidget.onDidChangeList(e => this.onDidChangeExclude(template, e)));

		return template;
	}

	private onDidChangeExclude(template: ISettingExcludeItemTemplate, e: ISettingListChangeEvent<IListDataItem>): void {
		if (template.context) {
			const newValue = { ...template.context.scopeValue };

			// first delete the existing entry, if present
			if (e.originalItem.value) {
				if (e.originalItem.value in template.context.defaultValue) {
					// delete a default by overriding it
					newValue[e.originalItem.value] = false;
				} else {
					delete newValue[e.originalItem.value];
				}
			}

			// then add the new or updated entry, if present
			if (e.item?.value) {
				if (e.item.value in template.context.defaultValue && !e.item.sibling) {
					// add a default by deleting its override
					delete newValue[e.item.value];
				} else {
					newValue[e.item.value] = e.item.sibling ? { when: e.item.sibling } : true;
				}
			}

			function sortKeys<T extends object>(obj: T) {
				const sortedKeys = Object.keys(obj)
					.sort((a, b) => a.localeCompare(b)) as Array<keyof T>;

				const retVal: Partial<T> = {};
				for (const key of sortedKeys) {
					retVal[key] = obj[key];
				}
				return retVal;
			}

			this._onDidChangeSetting.fire({
				key: template.context.setting.key,
				value: Object.keys(newValue).length === 0 ? undefined : sortKeys(newValue),
				type: template.context.valueType
			});
		}
	}

	renderElement(element: ITreeNode<SettingsTreeSettingElement, never>, index: number, templateData: ISettingExcludeItemTemplate): void {
		super.renderSettingElement(element, index, templateData);
	}

	protected renderValue(dataElement: SettingsTreeSettingElement, template: ISettingExcludeItemTemplate, onChange: (value: string) => void): void {
		const value = getExcludeDisplayValue(dataElement);
		template.excludeWidget.setValue(value);
		template.context = dataElement;
	}
}

export class SettingTextRenderer extends AbstractSettingRenderer implements ITreeRenderer<SettingsTreeSettingElement, never, ISettingTextItemTemplate> {
	templateId = SETTINGS_TEXT_TEMPLATE_ID;

	renderTemplate(_container: HTMLElement): ISettingTextItemTemplate {
		const common = this.renderCommonTemplate(null, _container, 'text');
		const validationErrorMessageElement = DOM.append(common.containerElement, $('.setting-item-validation-message'));

		const inputBox = new InputBox(common.controlElement, this._contextViewService);
		common.toDispose.add(inputBox);
		common.toDispose.add(attachInputBoxStyler(inputBox, this._themeService, {
			inputBackground: settingsTextInputBackground,
			inputForeground: settingsTextInputForeground,
			inputBorder: settingsTextInputBorder
		}));
		common.toDispose.add(
			inputBox.onDidChange(e => {
				if (template.onChange) {
					template.onChange(e);
				}
			}));
		common.toDispose.add(inputBox);
		inputBox.inputElement.classList.add(AbstractSettingRenderer.CONTROL_CLASS);
		inputBox.inputElement.tabIndex = 0;

		// TODO@9at8: listWidget filters out all key events from input boxes, so we need to come up with a better way
		// Disable ArrowUp and ArrowDown behaviour in favor of list navigation
		common.toDispose.add(DOM.addStandardDisposableListener(inputBox.inputElement, DOM.EventType.KEY_DOWN, e => {
			if (e.equals(KeyCode.UpArrow) || e.equals(KeyCode.DownArrow)) {
				e.preventDefault();
			}
		}));

		const template: ISettingTextItemTemplate = {
			...common,
			inputBox,
			validationErrorMessageElement
		};

		this.addSettingElementFocusHandler(template);

		return template;
	}

	renderElement(element: ITreeNode<SettingsTreeSettingElement, never>, index: number, templateData: ISettingTextItemTemplate): void {
		super.renderSettingElement(element, index, templateData);
	}

	protected renderValue(dataElement: SettingsTreeSettingElement, template: ISettingTextItemTemplate, onChange: (value: string) => void): void {
		template.onChange = undefined;
		template.inputBox.value = dataElement.value;
		template.onChange = value => {
			if (!renderValidations(dataElement, template, false)) {
				onChange(value);
			}
		};

		renderValidations(dataElement, template, true);
	}
}

export class SettingEnumRenderer extends AbstractSettingRenderer implements ITreeRenderer<SettingsTreeSettingElement, never, ISettingEnumItemTemplate> {
	templateId = SETTINGS_ENUM_TEMPLATE_ID;

	renderTemplate(container: HTMLElement): ISettingEnumItemTemplate {
		const common = this.renderCommonTemplate(null, container, 'enum');

		const selectBox = new SelectBox([], 0, this._contextViewService, undefined, {
			useCustomDrawn: !(isIOS && BrowserFeatures.pointerEvents)
		});

		common.toDispose.add(selectBox);
		common.toDispose.add(attachSelectBoxStyler(selectBox, this._themeService, {
			selectBackground: settingsSelectBackground,
			selectForeground: settingsSelectForeground,
			selectBorder: settingsSelectBorder,
			selectListBorder: settingsSelectListBorder
		}));
		selectBox.render(common.controlElement);
		const selectElement = common.controlElement.querySelector('select');
		if (selectElement) {
			selectElement.classList.add(AbstractSettingRenderer.CONTROL_CLASS);
			selectElement.tabIndex = 0;
		}

		common.toDispose.add(
			selectBox.onDidSelect(e => {
				if (template.onChange) {
					template.onChange(e.index);
				}
			}));

		const enumDescriptionElement = common.containerElement.insertBefore($('.setting-item-enumDescription'), common.descriptionElement.nextSibling);

		const template: ISettingEnumItemTemplate = {
			...common,
			selectBox,
			enumDescriptionElement
		};

		this.addSettingElementFocusHandler(template);

		return template;
	}

	renderElement(element: ITreeNode<SettingsTreeSettingElement, never>, index: number, templateData: ISettingEnumItemTemplate): void {
		super.renderSettingElement(element, index, templateData);
	}

	protected renderValue(dataElement: SettingsTreeSettingElement, template: ISettingEnumItemTemplate, onChange: (value: string) => void): void {
		const enumItemLabels = dataElement.setting.enumItemLabels;
		const enumDescriptions = dataElement.setting.enumDescriptions;
		const enumDescriptionsAreMarkdown = dataElement.setting.enumDescriptionsAreMarkdown;

		const disposables = new DisposableStore();
		template.toDispose.add(disposables);

		const displayOptions = dataElement.setting.enum!
			.map(String)
			.map(escapeInvisibleChars)
			.map((data, index) => {
				const description = (enumDescriptions && enumDescriptions[index] && (enumDescriptionsAreMarkdown ? fixSettingLinks(enumDescriptions[index], false) : enumDescriptions[index]));
				return <ISelectOptionItem>{
					text: enumItemLabels && enumItemLabels[index] ? enumItemLabels[index] : data,
					detail: enumItemLabels && enumItemLabels[index] ? data : '',
					description,
					descriptionIsMarkdown: enumDescriptionsAreMarkdown,
					descriptionMarkdownActionHandler: {
						callback: (content) => {
							this._openerService.open(content).catch(onUnexpectedError);
						},
						disposeables: disposables
					},
					decoratorRight: (data === dataElement.defaultValue ? localize('settings.Default', "default") : '')
				};
			});

		template.selectBox.setOptions(displayOptions);

		let idx = dataElement.setting.enum!.indexOf(dataElement.value);
		if (idx === -1) {
			idx = dataElement.setting.enum!.indexOf(dataElement.defaultValue);
			if (idx === -1) {
				idx = 0;
			}
		}

		template.onChange = undefined;
		template.selectBox.select(idx);
		template.onChange = idx => onChange(dataElement.setting.enum![idx]);

		template.enumDescriptionElement.innerText = '';
	}
}

export class SettingNumberRenderer extends AbstractSettingRenderer implements ITreeRenderer<SettingsTreeSettingElement, never, ISettingNumberItemTemplate> {
	templateId = SETTINGS_NUMBER_TEMPLATE_ID;

	renderTemplate(_container: HTMLElement): ISettingNumberItemTemplate {
		const common = super.renderCommonTemplate(null, _container, 'number');
		const validationErrorMessageElement = DOM.append(common.containerElement, $('.setting-item-validation-message'));

		const inputBox = new InputBox(common.controlElement, this._contextViewService, { type: 'number' });
		common.toDispose.add(inputBox);
		common.toDispose.add(attachInputBoxStyler(inputBox, this._themeService, {
			inputBackground: settingsNumberInputBackground,
			inputForeground: settingsNumberInputForeground,
			inputBorder: settingsNumberInputBorder
		}));
		common.toDispose.add(
			inputBox.onDidChange(e => {
				if (template.onChange) {
					template.onChange(e);
				}
			}));
		common.toDispose.add(inputBox);
		inputBox.inputElement.classList.add(AbstractSettingRenderer.CONTROL_CLASS);
		inputBox.inputElement.tabIndex = 0;

		const template: ISettingNumberItemTemplate = {
			...common,
			inputBox,
			validationErrorMessageElement
		};

		this.addSettingElementFocusHandler(template);

		return template;
	}

	renderElement(element: ITreeNode<SettingsTreeSettingElement, never>, index: number, templateData: ISettingNumberItemTemplate): void {
		super.renderSettingElement(element, index, templateData);
	}

	protected renderValue(dataElement: SettingsTreeSettingElement, template: ISettingNumberItemTemplate, onChange: (value: number | null) => void): void {
		const numParseFn = (dataElement.valueType === 'integer' || dataElement.valueType === 'nullable-integer')
			? parseInt : parseFloat;

		const nullNumParseFn = (dataElement.valueType === 'nullable-integer' || dataElement.valueType === 'nullable-number')
			? ((v: string) => v === '' ? null : numParseFn(v)) : numParseFn;

		template.onChange = undefined;
		template.inputBox.value = dataElement.value;
		template.onChange = value => {
			if (!renderValidations(dataElement, template, false)) {
				onChange(nullNumParseFn(value));
			}
		};

		renderValidations(dataElement, template, true);
	}
}

export class SettingBoolRenderer extends AbstractSettingRenderer implements ITreeRenderer<SettingsTreeSettingElement, never, ISettingBoolItemTemplate> {
	templateId = SETTINGS_BOOL_TEMPLATE_ID;

	renderTemplate(_container: HTMLElement): ISettingBoolItemTemplate {
		_container.classList.add('setting-item');
		_container.classList.add('setting-item-bool');

		const container = DOM.append(_container, $(AbstractSettingRenderer.CONTENTS_SELECTOR));
		container.classList.add('settings-row-inner-container');

		const titleElement = DOM.append(container, $('.setting-item-title'));
		const categoryElement = DOM.append(titleElement, $('span.setting-item-category'));
		const labelElement = DOM.append(titleElement, $('span.setting-item-label'));
		const otherOverridesElement = DOM.append(titleElement, $('span.setting-item-overrides'));
		const syncIgnoredElement = this.createSyncIgnoredElement(titleElement);

		const descriptionAndValueElement = DOM.append(container, $('.setting-item-value-description'));
		const controlElement = DOM.append(descriptionAndValueElement, $('.setting-item-bool-control'));
		const descriptionElement = DOM.append(descriptionAndValueElement, $('.setting-item-description'));
		const modifiedIndicatorElement = DOM.append(container, $('.setting-item-modified-indicator'));
		modifiedIndicatorElement.title = localize('modified', "Modified");


		const deprecationWarningElement = DOM.append(container, $('.setting-item-deprecation-message'));

		const toDispose = new DisposableStore();
		const checkbox = new Checkbox({ icon: Codicon.check, actionClassName: 'setting-value-checkbox', isChecked: true, title: '', inputActiveOptionBorder: undefined });
		controlElement.appendChild(checkbox.domNode);
		toDispose.add(checkbox);
		toDispose.add(checkbox.onChange(() => {
			template.onChange!(checkbox.checked);
		}));

		// Need to listen for mouse clicks on description and toggle checkbox - use target ID for safety
		// Also have to ignore embedded links - too buried to stop propagation
		toDispose.add(DOM.addDisposableListener(descriptionElement, DOM.EventType.MOUSE_DOWN, (e) => {
			const targetElement = <HTMLElement>e.target;

			// Toggle target checkbox
			if (targetElement.tagName.toLowerCase() !== 'a') {
				template.checkbox.checked = !template.checkbox.checked;
				template.onChange!(checkbox.checked);
			}
			DOM.EventHelper.stop(e);
		}));


		checkbox.domNode.classList.add(AbstractSettingRenderer.CONTROL_CLASS);
		const toolbarContainer = DOM.append(container, $('.setting-toolbar-container'));
		const toolbar = this.renderSettingToolbar(toolbarContainer);
		toDispose.add(toolbar);

		const template: ISettingBoolItemTemplate = {
			toDispose,
			elementDisposables: new DisposableStore(),

			containerElement: container,
			categoryElement,
			labelElement,
			controlElement,
			checkbox,
			descriptionElement,
			deprecationWarningElement,
			otherOverridesElement,
			syncIgnoredElement,
			toolbar
		};

		this.addSettingElementFocusHandler(template);

		// Prevent clicks from being handled by list
		toDispose.add(DOM.addDisposableListener(controlElement, 'mousedown', (e: IMouseEvent) => e.stopPropagation()));
		toDispose.add(DOM.addDisposableListener(titleElement, DOM.EventType.MOUSE_ENTER, e => container.classList.add('mouseover')));
		toDispose.add(DOM.addDisposableListener(titleElement, DOM.EventType.MOUSE_LEAVE, e => container.classList.remove('mouseover')));

		return template;
	}

	renderElement(element: ITreeNode<SettingsTreeSettingElement, never>, index: number, templateData: ISettingBoolItemTemplate): void {
		super.renderSettingElement(element, index, templateData);
	}

	protected renderValue(dataElement: SettingsTreeSettingElement, template: ISettingBoolItemTemplate, onChange: (value: boolean) => void): void {
		template.onChange = undefined;
		template.checkbox.checked = dataElement.value;
		template.onChange = onChange;
	}
}

export class SettingTreeRenderers {
	readonly onDidClickOverrideElement: Event<ISettingOverrideClickEvent>;

	private readonly _onDidChangeSetting = new Emitter<ISettingChangeEvent>();
	readonly onDidChangeSetting: Event<ISettingChangeEvent>;

	readonly onDidOpenSettings: Event<string>;

	readonly onDidClickSettingLink: Event<ISettingLinkClickEvent>;

	readonly onDidFocusSetting: Event<SettingsTreeSettingElement>;

	readonly allRenderers: ITreeRenderer<SettingsTreeElement, never, any>[];

	private readonly settingActions: IAction[];

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IContextMenuService private readonly _contextMenuService: IContextMenuService,
		@IContextViewService private readonly _contextViewService: IContextViewService,
		@IUserDataAutoSyncEnablementService private readonly _userDataAutoSyncEnablementService: IUserDataAutoSyncEnablementService,
	) {
		this.settingActions = [
			new Action('settings.resetSetting', localize('resetSettingLabel', "Reset Setting"), undefined, undefined, (context: SettingsTreeSettingElement) => {
				if (context) {
					this._onDidChangeSetting.fire({ key: context.setting.key, value: undefined, type: context.setting.type as SettingValueType });
				}

				return Promise.resolve(null);
			}),
			new Separator(),
			this._instantiationService.createInstance(CopySettingIdAction),
			this._instantiationService.createInstance(CopySettingAsJSONAction),
		];

		const actionFactory = (setting: ISetting) => this.getActionsForSetting(setting);
		const settingRenderers = [
			this._instantiationService.createInstance(SettingBoolRenderer, this.settingActions, actionFactory),
			this._instantiationService.createInstance(SettingNumberRenderer, this.settingActions, actionFactory),
			this._instantiationService.createInstance(SettingArrayRenderer, this.settingActions, actionFactory),
			this._instantiationService.createInstance(SettingComplexRenderer, this.settingActions, actionFactory),
			this._instantiationService.createInstance(SettingTextRenderer, this.settingActions, actionFactory),
			this._instantiationService.createInstance(SettingExcludeRenderer, this.settingActions, actionFactory),
			this._instantiationService.createInstance(SettingEnumRenderer, this.settingActions, actionFactory),
			this._instantiationService.createInstance(SettingObjectRenderer, this.settingActions, actionFactory),
		];

		this.onDidClickOverrideElement = Event.any(...settingRenderers.map(r => r.onDidClickOverrideElement));
		this.onDidChangeSetting = Event.any(
			...settingRenderers.map(r => r.onDidChangeSetting),
			this._onDidChangeSetting.event
		);
		this.onDidOpenSettings = Event.any(...settingRenderers.map(r => r.onDidOpenSettings));
		this.onDidClickSettingLink = Event.any(...settingRenderers.map(r => r.onDidClickSettingLink));
		this.onDidFocusSetting = Event.any(...settingRenderers.map(r => r.onDidFocusSetting));

		this.allRenderers = [
			...settingRenderers,
			this._instantiationService.createInstance(SettingGroupRenderer),
			this._instantiationService.createInstance(SettingNewExtensionsRenderer),
		];
	}

	private getActionsForSetting(setting: ISetting): IAction[] {
		const enableSync = this._userDataAutoSyncEnablementService.isEnabled();
		return enableSync && !setting.disallowSyncIgnore ?
			[
				new Separator(),
				this._instantiationService.createInstance(SyncSettingAction, setting)
			] :
			[];
	}

	cancelSuggesters() {
		this._contextViewService.hideContextView();
	}

	showContextMenu(element: SettingsTreeSettingElement, settingDOMElement: HTMLElement): void {
		const toolbarElement = settingDOMElement.querySelector('.monaco-toolbar');
		if (toolbarElement) {
			this._contextMenuService.showContextMenu({
				getActions: () => this.settingActions,
				getAnchor: () => <HTMLElement>toolbarElement,
				getActionsContext: () => element
			});
		}
	}

	getSettingDOMElementForDOMElement(domElement: HTMLElement): HTMLElement | null {
		const parent = DOM.findParentWithClass(domElement, AbstractSettingRenderer.CONTENTS_CLASS);
		if (parent) {
			return parent;
		}

		return null;
	}

	getDOMElementsForSettingKey(treeContainer: HTMLElement, key: string): NodeListOf<HTMLElement> {
		return treeContainer.querySelectorAll(`[${AbstractSettingRenderer.SETTING_KEY_ATTR}="${key}"]`);
	}

	getKeyForDOMElementInSetting(element: HTMLElement): string | null {
		const settingElement = this.getSettingDOMElementForDOMElement(element);
		return settingElement && settingElement.getAttribute(AbstractSettingRenderer.SETTING_KEY_ATTR);
	}

	getIdForDOMElementInSetting(element: HTMLElement): string | null {
		const settingElement = this.getSettingDOMElementForDOMElement(element);
		return settingElement && settingElement.getAttribute(AbstractSettingRenderer.SETTING_ID_ATTR);
	}
}

/**
 * Validate and render any error message. Returns true if the value is invalid.
 */
function renderValidations(dataElement: SettingsTreeSettingElement, template: ISettingTextItemTemplate, calledOnStartup: boolean): boolean {
	if (dataElement.setting.validator) {
		const errMsg = dataElement.setting.validator(template.inputBox.value);
		if (errMsg) {
			template.containerElement.classList.add('invalid-input');
			template.validationErrorMessageElement.innerText = errMsg;
			const validationError = localize('validationError', "Validation Error.");
			template.inputBox.inputElement.parentElement!.setAttribute('aria-label', [validationError, errMsg].join(' '));
			if (!calledOnStartup) { ariaAlert(validationError + ' ' + errMsg); }
			return true;
		} else {
			template.inputBox.inputElement.parentElement!.removeAttribute('aria-label');
		}
	}
	template.containerElement.classList.remove('invalid-input');
	return false;
}

function renderArrayValidations(
	dataElement: SettingsTreeSettingElement,
	template: ISettingListItemTemplate,
	value: string[] | undefined,
	calledOnStartup: boolean
) {
	template.containerElement.classList.add('invalid-input');
	if (dataElement.setting.validator) {
		const errMsg = dataElement.setting.validator(value);
		if (errMsg && errMsg !== '') {
			template.containerElement.classList.add('invalid-input');
			template.validationErrorMessageElement.innerText = errMsg;
			const validationError = localize('validationError', "Validation Error.");
			template.containerElement.setAttribute('aria-label', [dataElement.setting.key, validationError, errMsg].join(' '));
			if (!calledOnStartup) { ariaAlert(validationError + ' ' + errMsg); }
			return;
		} else {
			template.containerElement.setAttribute('aria-label', dataElement.setting.key);
			template.containerElement.classList.remove('invalid-input');
		}
	}
}

function cleanRenderedMarkdown(element: Node): void {
	for (let i = 0; i < element.childNodes.length; i++) {
		const child = element.childNodes.item(i);

		const tagName = (<Element>child).tagName && (<Element>child).tagName.toLowerCase();
		if (tagName === 'img') {
			element.removeChild(child);
		} else {
			cleanRenderedMarkdown(child);
		}
	}
}

function fixSettingLinks(text: string, linkify = true): string {
	return text.replace(/`#([^#]*)#`/g, (match, settingKey) => {
		const targetDisplayFormat = settingKeyToDisplayFormat(settingKey);
		const targetName = `${targetDisplayFormat.category}: ${targetDisplayFormat.label}`;
		return linkify ?
			`[${targetName}](#${settingKey})` :
			`"${targetName}"`;
	});
}

function escapeInvisibleChars(enumValue: string): string {
	return enumValue && enumValue
		.replace(/\n/g, '\\n')
		.replace(/\r/g, '\\r');
}

export class SettingsTreeFilter implements ITreeFilter<SettingsTreeElement> {
	constructor(
		private viewState: ISettingsEditorViewState,
		@IWorkbenchEnvironmentService private environmentService: IWorkbenchEnvironmentService,
	) { }

	filter(element: SettingsTreeElement, parentVisibility: TreeVisibility): TreeFilterResult<void> {
		// Filter during search
		if (this.viewState.filterToCategory && element instanceof SettingsTreeSettingElement) {
			if (!this.settingContainedInGroup(element.setting, this.viewState.filterToCategory)) {
				return false;
			}
		}

		// Non-user scope selected
		if (element instanceof SettingsTreeSettingElement && this.viewState.settingsTarget !== ConfigurationTarget.USER_LOCAL) {
			const isRemote = !!this.environmentService.remoteAuthority;
			if (!element.matchesScope(this.viewState.settingsTarget, isRemote)) {
				return false;
			}
		}

		// @modified or tag
		if (element instanceof SettingsTreeSettingElement && this.viewState.tagFilters) {
			if (!element.matchesAllTags(this.viewState.tagFilters)) {
				return false;
			}
		}

		// Group with no visible children
		if (element instanceof SettingsTreeGroupElement) {
			if (typeof element.count === 'number') {
				return element.count > 0;
			}

			return TreeVisibility.Recurse;
		}

		// Filtered "new extensions" button
		if (element instanceof SettingsTreeNewExtensionsElement) {
			if ((this.viewState.tagFilters && this.viewState.tagFilters.size) || this.viewState.filterToCategory) {
				return false;
			}
		}

		return true;
	}

	private settingContainedInGroup(setting: ISetting, group: SettingsTreeGroupElement): boolean {
		return group.children.some(child => {
			if (child instanceof SettingsTreeGroupElement) {
				return this.settingContainedInGroup(setting, child);
			} else if (child instanceof SettingsTreeSettingElement) {
				return child.setting.key === setting.key;
			} else {
				return false;
			}
		});
	}
}

class SettingsTreeDelegate extends CachedListVirtualDelegate<SettingsTreeGroupChild> {

	getTemplateId(element: SettingsTreeGroupElement | SettingsTreeSettingElement | SettingsTreeNewExtensionsElement): string {
		if (element instanceof SettingsTreeGroupElement) {
			return SETTINGS_ELEMENT_TEMPLATE_ID;
		}

		if (element instanceof SettingsTreeSettingElement) {
			const invalidTypeError = element.isConfigured && getInvalidTypeError(element.value, element.setting.type);
			if (invalidTypeError) {
				return SETTINGS_COMPLEX_TEMPLATE_ID;
			}

			if (element.valueType === SettingValueType.Boolean) {
				return SETTINGS_BOOL_TEMPLATE_ID;
			}

			if (element.valueType === SettingValueType.Integer || element.valueType === SettingValueType.Number || element.valueType === SettingValueType.NullableInteger || element.valueType === SettingValueType.NullableNumber) {
				return SETTINGS_NUMBER_TEMPLATE_ID;
			}

			if (element.valueType === SettingValueType.String) {
				return SETTINGS_TEXT_TEMPLATE_ID;
			}

			if (element.valueType === SettingValueType.Enum) {
				return SETTINGS_ENUM_TEMPLATE_ID;
			}

			if (element.valueType === SettingValueType.ArrayOfString) {
				return SETTINGS_ARRAY_TEMPLATE_ID;
			}

			if (element.valueType === SettingValueType.Exclude) {
				return SETTINGS_EXCLUDE_TEMPLATE_ID;
			}

			if (element.valueType === SettingValueType.Object) {
				return SETTINGS_OBJECT_TEMPLATE_ID;
			}

			return SETTINGS_COMPLEX_TEMPLATE_ID;
		}

		if (element instanceof SettingsTreeNewExtensionsElement) {
			return SETTINGS_NEW_EXTENSIONS_TEMPLATE_ID;
		}

		throw new Error('unknown element type: ' + element);
	}

	hasDynamicHeight(element: SettingsTreeGroupElement | SettingsTreeSettingElement | SettingsTreeNewExtensionsElement): boolean {
		return !(element instanceof SettingsTreeGroupElement);
	}

	protected estimateHeight(element: SettingsTreeGroupChild): number {
		if (element instanceof SettingsTreeGroupElement) {
			return 42;
		}

		return element instanceof SettingsTreeSettingElement && element.valueType === SettingValueType.Boolean ? 78 : 104;
	}
}

class NonCollapsibleObjectTreeModel<T> extends ObjectTreeModel<T> {
	isCollapsible(element: T): boolean {
		return false;
	}

	setCollapsed(element: T, collapsed?: boolean, recursive?: boolean): boolean {
		return false;
	}
}

class SettingsTreeAccessibilityProvider implements IListAccessibilityProvider<SettingsTreeElement> {
	getAriaLabel(element: SettingsTreeElement) {
		if (element instanceof SettingsTreeSettingElement) {
			const modifiedText = element.isConfigured ? localize('settings.Modified', 'Modified.') : '';

			const otherOverridesStart = element.isConfigured ?
				localize('alsoConfiguredIn', "Also modified in") :
				localize('configuredIn', "Modified in");
			const otherOverridesList = element.overriddenScopeList.join(', ');
			const otherOverridesLabel = element.overriddenScopeList.length ? `${otherOverridesStart} ${otherOverridesList}. ` : '';

			const descriptionWithoutSettingLinks = fixSettingLinks(element.description, false);
			return `${element.displayCategory} ${element.displayLabel}. ${descriptionWithoutSettingLinks}. ${modifiedText} ${otherOverridesLabel}`;
		} else {
			return element.id;
		}
	}

	getWidgetAriaLabel() {
		return localize('settings', "Settings");
	}
}

export class SettingsTree extends WorkbenchObjectTree<SettingsTreeElement> {
	constructor(
		container: HTMLElement,
		viewState: ISettingsEditorViewState,
		renderers: ITreeRenderer<any, void, any>[],
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super('SettingsTree', container,
			new SettingsTreeDelegate(),
			renderers,
			{
				horizontalScrolling: false,
				supportDynamicHeights: true,
				identityProvider: {
					getId(e) {
						return e.id;
					}
				},
				accessibilityProvider: new SettingsTreeAccessibilityProvider(),
				styleController: id => new DefaultStyleController(DOM.createStyleSheet(container), id),
				filter: instantiationService.createInstance(SettingsTreeFilter, viewState),
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
				collector.addRule(`.settings-editor > .settings-body > .settings-tree-container .setting-item-contents .setting-item-description { color: ${fgWithOpacity}; }`);
				collector.addRule(`.settings-editor > .settings-body .settings-toc-container .monaco-list-row:not(.selected) { color: ${fgWithOpacity}; }`);

				// Hack for subpixel antialiasing
				collector.addRule(`.settings-editor > .settings-body > .settings-tree-container .setting-item-contents .setting-item-title .setting-item-overrides,
					.settings-editor > .settings-body > .settings-tree-container .setting-item-contents .setting-item-title .setting-item-ignored { color: ${fgWithOpacity}; }`);
			}

			const errorColor = theme.getColor(errorForeground);
			if (errorColor) {
				collector.addRule(`.settings-editor > .settings-body > .settings-tree-container .setting-item-contents .setting-item-deprecation-message { color: ${errorColor}; }`);
			}

			const invalidInputBackground = theme.getColor(inputValidationErrorBackground);
			if (invalidInputBackground) {
				collector.addRule(`.settings-editor > .settings-body > .settings-tree-container .setting-item-contents .setting-item-validation-message { background-color: ${invalidInputBackground}; }`);
			}

			const invalidInputForeground = theme.getColor(inputValidationErrorForeground);
			if (invalidInputForeground) {
				collector.addRule(`.settings-editor > .settings-body > .settings-tree-container .setting-item-contents .setting-item-validation-message { color: ${invalidInputForeground}; }`);
			}

			const invalidInputBorder = theme.getColor(inputValidationErrorBorder);
			if (invalidInputBorder) {
				collector.addRule(`.settings-editor > .settings-body > .settings-tree-container .setting-item-contents .setting-item-validation-message { border-style:solid; border-width: 1px; border-color: ${invalidInputBorder}; }`);
				collector.addRule(`.settings-editor > .settings-body > .settings-tree-container .setting-item.invalid-input .setting-item-control .monaco-inputbox.idle { outline-width: 0; border-style:solid; border-width: 1px; border-color: ${invalidInputBorder}; }`);
			}

			const focusedRowBackgroundColor = theme.getColor(focusedRowBackground);
			if (focusedRowBackgroundColor) {
				collector.addRule(`.settings-editor > .settings-body > .settings-tree-container .monaco-list-row.focused .settings-row-inner-container { background-color: ${focusedRowBackgroundColor}; }`);
			}

			const rowHoverBackgroundColor = theme.getColor(rowHoverBackground);
			if (rowHoverBackgroundColor) {
				collector.addRule(`.settings-editor > .settings-body > .settings-tree-container .monaco-list-row:not(.focused) .settings-row-inner-container:hover { background-color: ${rowHoverBackgroundColor}; }`);
			}

			const focusedRowBorderColor = theme.getColor(focusedRowBorder);
			if (focusedRowBorderColor) {
				collector.addRule(`.settings-editor > .settings-body > .settings-tree-container .monaco-list:focus-within .monaco-list-row.focused .setting-item-contents::before,
					.settings-editor > .settings-body > .settings-tree-container .monaco-list:focus-within .monaco-list-row.focused .setting-item-contents::after { border-top: 1px solid ${focusedRowBorderColor} }`);
				collector.addRule(`.settings-editor > .settings-body > .settings-tree-container .monaco-list:focus-within .monaco-list-row.focused .settings-group-title-label::before,
					.settings-editor > .settings-body > .settings-tree-container .monaco-list:focus-within .monaco-list-row.focused .settings-group-title-label::after { border-top: 1px solid ${focusedRowBorderColor} }`);
			}

			const headerForegroundColor = theme.getColor(settingsHeaderForeground);
			if (headerForegroundColor) {
				collector.addRule(`.settings-editor > .settings-body > .settings-tree-container .settings-group-title-label { color: ${headerForegroundColor}; }`);
				collector.addRule(`.settings-editor > .settings-body > .settings-tree-container .setting-item-label { color: ${headerForegroundColor}; }`);
			}

			const focusBorderColor = theme.getColor(focusBorder);
			if (focusBorderColor) {
				collector.addRule(`.settings-editor > .settings-body > .settings-tree-container .setting-item-contents .setting-item-markdown a:focus { outline-color: ${focusBorderColor} }`);
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

	protected createModel(user: string, view: IList<ITreeNode<SettingsTreeGroupChild>>, options: IObjectTreeOptions<SettingsTreeGroupChild>): ITreeModel<SettingsTreeGroupChild | null, void, SettingsTreeGroupChild | null> {
		return new NonCollapsibleObjectTreeModel<SettingsTreeGroupChild>(user, view, options);
	}
}

class CopySettingIdAction extends Action {
	static readonly ID = 'settings.copySettingId';
	static readonly LABEL = localize('copySettingIdLabel', "Copy Setting ID");

	constructor(
		@IClipboardService private readonly clipboardService: IClipboardService
	) {
		super(CopySettingIdAction.ID, CopySettingIdAction.LABEL);
	}

	async run(context: SettingsTreeSettingElement): Promise<void> {
		if (context) {
			await this.clipboardService.writeText(context.setting.key);
		}

		return Promise.resolve(undefined);
	}
}

class CopySettingAsJSONAction extends Action {
	static readonly ID = 'settings.copySettingAsJSON';
	static readonly LABEL = localize('copySettingAsJSONLabel', "Copy Setting as JSON");

	constructor(
		@IClipboardService private readonly clipboardService: IClipboardService
	) {
		super(CopySettingAsJSONAction.ID, CopySettingAsJSONAction.LABEL);
	}

	async run(context: SettingsTreeSettingElement): Promise<void> {
		if (context) {
			const jsonResult = `"${context.setting.key}": ${JSON.stringify(context.value, undefined, '  ')}`;
			await this.clipboardService.writeText(jsonResult);
		}

		return Promise.resolve(undefined);
	}
}

class SyncSettingAction extends Action {
	static readonly ID = 'settings.stopSyncingSetting';
	static readonly LABEL = localize('stopSyncingSetting', "Sync This Setting");

	constructor(
		private readonly setting: ISetting,
		@IConfigurationService private readonly configService: IConfigurationService,
	) {
		super(SyncSettingAction.ID, SyncSettingAction.LABEL);
		this._register(Event.filter(configService.onDidChangeConfiguration, e => e.affectsConfiguration('settingsSync.ignoredSettings'))(() => this.update()));
		this.update();
	}

	async update() {
		const ignoredSettings = getIgnoredSettings(getDefaultIgnoredSettings(), this.configService);
		this.checked = !ignoredSettings.includes(this.setting.key);
	}

	async run(): Promise<void> {
		// first remove the current setting completely from ignored settings
		let currentValue = [...this.configService.getValue<string[]>('settingsSync.ignoredSettings')];
		currentValue = currentValue.filter(v => v !== this.setting.key && v !== `-${this.setting.key}`);

		const defaultIgnoredSettings = getDefaultIgnoredSettings();
		const isDefaultIgnored = defaultIgnoredSettings.includes(this.setting.key);
		const askedToSync = !this.checked;

		// If asked to sync, then add only if it is ignored by default
		if (askedToSync && isDefaultIgnored) {
			currentValue.push(`-${this.setting.key}`);
		}

		// If asked not to sync, then add only if it is not ignored by default
		if (!askedToSync && !isDefaultIgnored) {
			currentValue.push(this.setting.key);
		}

		this.configService.updateValue('settingsSync.ignoredSettings', currentValue.length ? currentValue : undefined, ConfigurationTarget.USER);

		return Promise.resolve(undefined);
	}

}
