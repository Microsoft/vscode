/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as arrays from 'vs/base/common/arrays';
import { escapeRegExpCharacters, isFalsyOrWhitespace } from 'vs/base/common/strings';
import { isArray, withUndefinedAsNull, isUndefinedOrNull } from 'vs/base/common/types';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { ConfigurationTarget, IConfigurationValue } from 'vs/platform/configuration/common/configuration';
import { SettingsTarget } from 'vs/workbench/contrib/preferences/browser/preferencesWidgets';
import { ITOCEntry, knownAcronyms, knownTermMappings, tocData } from 'vs/workbench/contrib/preferences/browser/settingsLayout';
import { MODIFIED_SETTING_TAG, REQUIRE_TRUSTED_WORKSPACE_SETTING_TAG } from 'vs/workbench/contrib/preferences/common/preferences';
import { IExtensionSetting, ISearchResult, ISetting, SettingValueType } from 'vs/workbench/services/preferences/common/preferences';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { FOLDER_SCOPES, WORKSPACE_SCOPES, REMOTE_MACHINE_SCOPES, LOCAL_MACHINE_SCOPES, IWorkbenchConfigurationService } from 'vs/workbench/services/configuration/common/configuration';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter } from 'vs/base/common/event';

export const ONLINE_SERVICES_SETTING_TAG = 'usesOnlineServices';

export interface ISettingsEditorViewState {
	settingsTarget: SettingsTarget;
	tagFilters?: Set<string>;
	extensionFilters?: Set<string>;
	featureFilters?: Set<string>;
	idFilters?: Set<string>;
	filterToCategory?: SettingsTreeGroupElement;
}

export abstract class SettingsTreeElement extends Disposable {
	id: string;
	parent?: SettingsTreeGroupElement;

	private _tabbable = false;
	protected readonly _onDidChangeTabbable = new Emitter<void>();
	readonly onDidChangeTabbable = this._onDidChangeTabbable.event;

	constructor(_id: string) {
		super();
		this.id = _id;
	}

	get tabbable(): boolean {
		return this._tabbable;
	}

	set tabbable(value: boolean) {
		this._tabbable = value;
		this._onDidChangeTabbable.fire();
	}
}

export type SettingsTreeGroupChild = (SettingsTreeGroupElement | SettingsTreeSettingElement | SettingsTreeNewExtensionsElement);

export class SettingsTreeGroupElement extends SettingsTreeElement {
	count?: number;
	label: string;
	level: number;
	isFirstGroup: boolean;

	private _childSettingKeys: Set<string> = new Set();
	private _children: SettingsTreeGroupChild[] = [];

	get children(): SettingsTreeGroupChild[] {
		return this._children;
	}

	set children(newChildren: SettingsTreeGroupChild[]) {
		this._children = newChildren;

		this._childSettingKeys = new Set();
		this._children.forEach(child => {
			if (child instanceof SettingsTreeSettingElement) {
				this._childSettingKeys.add(child.setting.key);
			}
		});
	}

	constructor(_id: string, count: number | undefined, label: string, level: number, isFirstGroup: boolean) {
		super(_id);

		this.count = count;
		this.label = label;
		this.level = level;
		this.isFirstGroup = isFirstGroup;
	}

	/**
	 * Returns whether this group contains the given child key (to a depth of 1 only)
	 */
	containsSetting(key: string): boolean {
		return this._childSettingKeys.has(key);
	}
}

export class SettingsTreeNewExtensionsElement extends SettingsTreeElement {
	constructor(_id: string, public readonly extensionIds: string[]) {
		super(_id);
	}
}

export class SettingsTreeSettingElement extends SettingsTreeElement {
	private static readonly MAX_DESC_LINES = 20;

	setting: ISetting;

	private _displayCategory: string | null = null;
	private _displayLabel: string | null = null;

	/**
	 * scopeValue || defaultValue, for rendering convenience.
	 */
	value: any;

	/**
	 * The value in the current settings scope.
	 */
	scopeValue: any;

	/**
	 * The default value
	 */
	defaultValue?: any;

	/**
	 * Whether the setting is configured in the selected scope.
	 */
	isConfigured = false;

	/**
	 * Whether the setting requires trusted target
	 */
	isUntrusted = false;

	tags?: Set<string>;
	overriddenScopeList: string[] = [];
	description!: string;
	valueType!: SettingValueType;

	constructor(setting: ISetting, parent: SettingsTreeGroupElement, inspectResult: IInspectResult, isWorkspaceTrusted: boolean) {
		super(sanitizeId(parent.id + '_' + setting.key));
		this.setting = setting;
		this.parent = parent;

		this.update(inspectResult, isWorkspaceTrusted);
	}

	get displayCategory(): string {
		if (!this._displayCategory) {
			this.initLabel();
		}

		return this._displayCategory!;
	}

	get displayLabel(): string {
		if (!this._displayLabel) {
			this.initLabel();
		}

		return this._displayLabel!;
	}

	private initLabel(): void {
		const displayKeyFormat = settingKeyToDisplayFormat(this.setting.key, this.parent!.id);
		this._displayLabel = displayKeyFormat.label;
		this._displayCategory = displayKeyFormat.category;
	}

	update(inspectResult: IInspectResult, isWorkspaceTrusted: boolean): void {
		const { isConfigured, inspected, targetSelector } = inspectResult;

		switch (targetSelector) {
			case 'workspaceFolderValue':
			case 'workspaceValue':
				this.isUntrusted = !!this.setting.restricted && !isWorkspaceTrusted;
				break;
		}

		const displayValue = isConfigured ? inspected[targetSelector] : inspected.defaultValue;
		const overriddenScopeList: string[] = [];
		if (targetSelector !== 'workspaceValue' && typeof inspected.workspaceValue !== 'undefined') {
			overriddenScopeList.push(localize('workspace', "Workspace"));
		}

		if (targetSelector !== 'userRemoteValue' && typeof inspected.userRemoteValue !== 'undefined') {
			overriddenScopeList.push(localize('remote', "Remote"));
		}

		if (targetSelector !== 'userLocalValue' && typeof inspected.userLocalValue !== 'undefined') {
			overriddenScopeList.push(localize('user', "User"));
		}

		this.value = displayValue;
		this.scopeValue = isConfigured && inspected[targetSelector];
		this.defaultValue = inspected.defaultValue;

		this.isConfigured = isConfigured;
		if (isConfigured || this.setting.tags || this.tags || this.setting.restricted) {
			// Don't create an empty Set for all 1000 settings, only if needed
			this.tags = new Set<string>();
			if (isConfigured) {
				this.tags.add(MODIFIED_SETTING_TAG);
			}

			if (this.setting.tags) {
				this.setting.tags.forEach(tag => this.tags!.add(tag));
			}

			if (this.setting.restricted) {
				this.tags.add(REQUIRE_TRUSTED_WORKSPACE_SETTING_TAG);
			}
		}

		this.overriddenScopeList = overriddenScopeList;
		if (this.setting.description.length > SettingsTreeSettingElement.MAX_DESC_LINES) {
			const truncatedDescLines = this.setting.description.slice(0, SettingsTreeSettingElement.MAX_DESC_LINES);
			truncatedDescLines.push('[...]');
			this.description = truncatedDescLines.join('\n');
		} else {
			this.description = this.setting.description.join('\n');
		}

		if (this.setting.enum && (!this.setting.type || settingTypeEnumRenderable(this.setting.type))) {
			this.valueType = SettingValueType.Enum;
		} else if (this.setting.type === 'string') {
			this.valueType = SettingValueType.String;
		} else if (isExcludeSetting(this.setting)) {
			this.valueType = SettingValueType.Exclude;
		} else if (this.setting.type === 'integer') {
			this.valueType = SettingValueType.Integer;
		} else if (this.setting.type === 'number') {
			this.valueType = SettingValueType.Number;
		} else if (this.setting.type === 'boolean') {
			this.valueType = SettingValueType.Boolean;
		} else if (this.setting.type === 'array' && this.setting.arrayItemType === 'string') {
			this.valueType = SettingValueType.ArrayOfString;
		} else if (isArray(this.setting.type) && this.setting.type.indexOf(SettingValueType.Null) > -1 && this.setting.type.length === 2) {
			if (this.setting.type.indexOf(SettingValueType.Integer) > -1) {
				this.valueType = SettingValueType.NullableInteger;
			} else if (this.setting.type.indexOf(SettingValueType.Number) > -1) {
				this.valueType = SettingValueType.NullableNumber;
			} else {
				this.valueType = SettingValueType.Complex;
			}
		} else if (isObjectSetting(this.setting)) {
			this.valueType = SettingValueType.Object;
		} else {
			this.valueType = SettingValueType.Complex;
		}
	}

	matchesAllTags(tagFilters?: Set<string>): boolean {
		if (!tagFilters || !tagFilters.size) {
			return true;
		}

		if (this.tags) {
			let hasFilteredTag = true;
			tagFilters.forEach(tag => {
				hasFilteredTag = hasFilteredTag && this.tags!.has(tag);
			});
			return hasFilteredTag;
		} else {
			return false;
		}
	}

	matchesScope(scope: SettingsTarget, isRemote: boolean): boolean {
		const configTarget = URI.isUri(scope) ? ConfigurationTarget.WORKSPACE_FOLDER : scope;

		if (!this.setting.scope) {
			return true;
		}

		if (configTarget === ConfigurationTarget.WORKSPACE_FOLDER) {
			return FOLDER_SCOPES.indexOf(this.setting.scope) !== -1;
		}

		if (configTarget === ConfigurationTarget.WORKSPACE) {
			return WORKSPACE_SCOPES.indexOf(this.setting.scope) !== -1;
		}

		if (configTarget === ConfigurationTarget.USER_REMOTE) {
			return REMOTE_MACHINE_SCOPES.indexOf(this.setting.scope) !== -1;
		}

		if (configTarget === ConfigurationTarget.USER_LOCAL && isRemote) {
			return LOCAL_MACHINE_SCOPES.indexOf(this.setting.scope) !== -1;
		}

		return true;
	}

	matchesAnyExtension(extensionFilters?: Set<string>): boolean {
		if (!extensionFilters || !extensionFilters.size) {
			return true;
		}

		if (!this.setting.extensionInfo) {
			return false;
		}

		return Array.from(extensionFilters).some(extensionId => extensionId.toLowerCase() === this.setting.extensionInfo!.id.toLowerCase());
	}

	matchesAnyFeature(featureFilters?: Set<string>): boolean {
		if (!featureFilters || !featureFilters.size) {
			return true;
		}

		const features = tocData.children!.find(child => child.id === 'features');

		return Array.from(featureFilters).some(filter => {
			if (features && features.children) {
				const feature = features.children.find(feature => 'features/' + filter === feature.id);
				if (feature) {
					const patterns = feature.settings?.map(setting => createSettingMatchRegExp(setting));
					return patterns && !this.setting.extensionInfo && patterns.some(pattern => pattern.test(this.setting.key.toLowerCase()));
				} else {
					return false;
				}
			} else {
				return false;
			}
		});
	}

	matchesAnyId(idFilters?: Set<string>): boolean {
		if (!idFilters || !idFilters.size) {
			return true;
		}
		return idFilters.has(this.setting.key);
	}
}


function createSettingMatchRegExp(pattern: string): RegExp {
	pattern = escapeRegExpCharacters(pattern)
		.replace(/\\\*/g, '.*');

	return new RegExp(`^${pattern}$`, 'i');
}

export class SettingsTreeModel {
	protected _root!: SettingsTreeGroupElement;
	private _treeElementsBySettingName = new Map<string, SettingsTreeSettingElement[]>();
	private _tocRoot!: ITOCEntry<ISetting>;

	constructor(
		protected _viewState: ISettingsEditorViewState,
		private _isWorkspaceTrusted: boolean,
		@IWorkbenchConfigurationService private readonly _configurationService: IWorkbenchConfigurationService,
	) {
	}

	get root(): SettingsTreeGroupElement {
		return this._root;
	}

	update(newTocRoot = this._tocRoot): void {
		this._treeElementsBySettingName.clear();

		const newRoot = this.createSettingsTreeGroupElement(newTocRoot);
		if (newRoot.children[0] instanceof SettingsTreeGroupElement) {
			(<SettingsTreeGroupElement>newRoot.children[0]).isFirstGroup = true;
		}

		if (this._root) {
			this.disposeChildren(this._root.children);
			this._root.children = newRoot.children;
		} else {
			this._root = newRoot;
		}
	}

	updateWorkspaceTrust(workspaceTrusted: boolean): void {
		this._isWorkspaceTrusted = workspaceTrusted;
		this.updateRequireTrustedTargetElements();
	}

	private disposeChildren(children: SettingsTreeGroupChild[]) {
		for (let child of children) {
			this.recursiveDispose(child);
		}
	}

	private recursiveDispose(element: SettingsTreeElement) {
		if (element instanceof SettingsTreeGroupElement) {
			this.disposeChildren(element.children);
		}

		element.dispose();
	}

	getElementsByName(name: string): SettingsTreeSettingElement[] | null {
		return withUndefinedAsNull(this._treeElementsBySettingName.get(name));
	}

	updateElementsByName(name: string): void {
		if (!this._treeElementsBySettingName.has(name)) {
			return;
		}

		this.updateSettings(this._treeElementsBySettingName.get(name)!);
	}

	private updateRequireTrustedTargetElements(): void {
		this.updateSettings(arrays.flatten([...this._treeElementsBySettingName.values()]).filter(s => s.isUntrusted));
	}

	private updateSettings(settings: SettingsTreeSettingElement[]): void {
		settings.forEach(element => {
			const inspectResult = inspectSetting(element.setting.key, this._viewState.settingsTarget, this._configurationService);
			element.update(inspectResult, this._isWorkspaceTrusted);
		});
	}

	private createSettingsTreeGroupElement(tocEntry: ITOCEntry<ISetting>, parent?: SettingsTreeGroupElement): SettingsTreeGroupElement {

		const depth = parent ? this.getDepth(parent) + 1 : 0;
		const element = new SettingsTreeGroupElement(tocEntry.id, undefined, tocEntry.label, depth, false);

		const children: SettingsTreeGroupChild[] = [];
		if (tocEntry.settings) {
			const settingChildren = tocEntry.settings.map(s => this.createSettingsTreeSettingElement(s, element))
				.filter(el => el.setting.deprecationMessage ? el.isConfigured : true);
			children.push(...settingChildren);
		}

		if (tocEntry.children) {
			const groupChildren = tocEntry.children.map(child => this.createSettingsTreeGroupElement(child, element));
			children.push(...groupChildren);
		}

		element.children = children;

		return element;
	}

	private getDepth(element: SettingsTreeElement): number {
		if (element.parent) {
			return 1 + this.getDepth(element.parent);
		} else {
			return 0;
		}
	}

	private createSettingsTreeSettingElement(setting: ISetting, parent: SettingsTreeGroupElement): SettingsTreeSettingElement {
		const inspectResult = inspectSetting(setting.key, this._viewState.settingsTarget, this._configurationService);
		const element = new SettingsTreeSettingElement(setting, parent, inspectResult, this._isWorkspaceTrusted);

		const nameElements = this._treeElementsBySettingName.get(setting.key) || [];
		nameElements.push(element);
		this._treeElementsBySettingName.set(setting.key, nameElements);
		return element;
	}
}

interface IInspectResult {
	isConfigured: boolean;
	inspected: IConfigurationValue<unknown>;
	targetSelector: 'userLocalValue' | 'userRemoteValue' | 'workspaceValue' | 'workspaceFolderValue';
}

export function inspectSetting(key: string, target: SettingsTarget, configurationService: IWorkbenchConfigurationService): IInspectResult {
	const inspectOverrides = URI.isUri(target) ? { resource: target } : undefined;
	const inspected = configurationService.inspect(key, inspectOverrides);
	const targetSelector = target === ConfigurationTarget.USER_LOCAL ? 'userLocalValue' :
		target === ConfigurationTarget.USER_REMOTE ? 'userRemoteValue' :
			target === ConfigurationTarget.WORKSPACE ? 'workspaceValue' :
				'workspaceFolderValue';
	let isConfigured = typeof inspected[targetSelector] !== 'undefined';
	if (!isConfigured) {
		if (target === ConfigurationTarget.USER_LOCAL) {
			isConfigured = !!configurationService.restrictedSettings.userLocal?.includes(key);
		} else if (target === ConfigurationTarget.USER_REMOTE) {
			isConfigured = !!configurationService.restrictedSettings.userRemote?.includes(key);
		} else if (target === ConfigurationTarget.WORKSPACE) {
			isConfigured = !!configurationService.restrictedSettings.workspace?.includes(key);
		} else if (target instanceof URI) {
			isConfigured = !!configurationService.restrictedSettings.workspaceFolder?.get(target)?.includes(key);
		}
	}

	return { isConfigured, inspected, targetSelector };
}

function sanitizeId(id: string): string {
	return id.replace(/[\.\/]/, '_');
}

export function settingKeyToDisplayFormat(key: string, groupId = ''): { category: string, label: string; } {
	const lastDotIdx = key.lastIndexOf('.');
	let category = '';
	if (lastDotIdx >= 0) {
		category = key.substr(0, lastDotIdx);
		key = key.substr(lastDotIdx + 1);
	}

	groupId = groupId.replace(/\//g, '.');
	category = trimCategoryForGroup(category, groupId);
	category = wordifyKey(category);

	const label = wordifyKey(key);
	return { category, label };
}

function wordifyKey(key: string): string {
	key = key
		.replace(/\.([a-z0-9])/g, (_, p1) => ` › ${p1.toUpperCase()}`) // Replace dot with spaced '>'
		.replace(/([a-z0-9])([A-Z])/g, '$1 $2') // Camel case to spacing, fooBar => foo Bar
		.replace(/^[a-z]/g, match => match.toUpperCase()) // Upper casing all first letters, foo => Foo
		.replace(/\b\w+\b/g, match => { // Upper casing known acronyms
			return knownAcronyms.has(match.toLowerCase()) ?
				match.toUpperCase() :
				match;
		});

	for (const [k, v] of knownTermMappings) {
		key = key.replace(new RegExp(`\\b${k}\\b`, 'gi'), v);
	}

	return key;
}

function trimCategoryForGroup(category: string, groupId: string): string {
	const doTrim = (forward: boolean) => {
		const parts = groupId.split('.');
		while (parts.length) {
			const reg = new RegExp(`^${parts.join('\\.')}(\\.|$)`, 'i');
			if (reg.test(category)) {
				return category.replace(reg, '');
			}

			if (forward) {
				parts.pop();
			} else {
				parts.shift();
			}
		}

		return null;
	};

	let trimmed = doTrim(true);
	if (trimmed === null) {
		trimmed = doTrim(false);
	}

	if (trimmed === null) {
		trimmed = category;
	}

	return trimmed;
}

export function isExcludeSetting(setting: ISetting): boolean {
	return setting.key === 'files.exclude' ||
		setting.key === 'search.exclude' ||
		setting.key === 'files.watcherExclude';
}

function isObjectRenderableSchema({ type }: IJSONSchema): boolean {
	return type === 'string' || type === 'boolean';
}

function isObjectSetting({
	type,
	objectProperties,
	objectPatternProperties,
	objectAdditionalProperties
}: ISetting): boolean {
	if (type !== 'object') {
		return false;
	}

	// object can have any shape
	if (
		isUndefinedOrNull(objectProperties) &&
		isUndefinedOrNull(objectPatternProperties) &&
		isUndefinedOrNull(objectAdditionalProperties)
	) {
		return false;
	}

	// object additional properties allow it to have any shape
	if (objectAdditionalProperties === true) {
		return false;
	}

	const schemas = [...Object.values(objectProperties ?? {}), ...Object.values(objectPatternProperties ?? {})];

	if (typeof objectAdditionalProperties === 'object') {
		schemas.push(objectAdditionalProperties);
	}

	// Flatten anyof schemas
	const flatSchemas = arrays.flatten(schemas.map((schema): IJSONSchema[] => {
		if (Array.isArray(schema.anyOf)) {
			return schema.anyOf;
		}
		return [schema];
	}));


	// This should not render boolean only objects
	return flatSchemas.every(isObjectRenderableSchema) && flatSchemas.some(({ type }) => type === 'string');
}

function settingTypeEnumRenderable(_type: string | string[]) {
	const enumRenderableSettingTypes = ['string', 'boolean', 'null', 'integer', 'number'];
	const type = isArray(_type) ? _type : [_type];
	return type.every(type => enumRenderableSettingTypes.indexOf(type) > -1);
}

export const enum SearchResultIdx {
	Local = 0,
	Remote = 1,
	NewExtensions = 2
}

export class SearchResultModel extends SettingsTreeModel {
	private rawSearchResults: ISearchResult[] | null = null;
	private cachedUniqueSearchResults: ISearchResult[] | null = null;
	private newExtensionSearchResults: ISearchResult | null = null;

	readonly id = 'searchResultModel';

	constructor(
		viewState: ISettingsEditorViewState,
		isWorkspaceTrusted: boolean,
		@IWorkbenchConfigurationService configurationService: IWorkbenchConfigurationService,
		@IWorkbenchEnvironmentService private environmentService: IWorkbenchEnvironmentService,
	) {
		super(viewState, isWorkspaceTrusted, configurationService);
		this.update({ id: 'searchResultModel', label: '' });
	}

	getUniqueResults(): ISearchResult[] {
		if (this.cachedUniqueSearchResults) {
			return this.cachedUniqueSearchResults;
		}

		if (!this.rawSearchResults) {
			return [];
		}

		const localMatchKeys = new Set();
		const localResult = this.rawSearchResults[SearchResultIdx.Local];
		if (localResult) {
			localResult.filterMatches.forEach(m => localMatchKeys.add(m.setting.key));
		}

		const remoteResult = this.rawSearchResults[SearchResultIdx.Remote];
		if (remoteResult) {
			remoteResult.filterMatches = remoteResult.filterMatches.filter(m => !localMatchKeys.has(m.setting.key));
		}

		if (remoteResult) {
			this.newExtensionSearchResults = this.rawSearchResults[SearchResultIdx.NewExtensions];
		}

		this.cachedUniqueSearchResults = [localResult, remoteResult];
		return this.cachedUniqueSearchResults;
	}

	getRawResults(): ISearchResult[] {
		return this.rawSearchResults || [];
	}

	setResult(order: SearchResultIdx, result: ISearchResult | null): void {
		this.cachedUniqueSearchResults = null;
		this.newExtensionSearchResults = null;

		this.rawSearchResults = this.rawSearchResults || [];
		if (!result) {
			delete this.rawSearchResults[order];
			return;
		}

		if (result.exactMatch) {
			this.rawSearchResults = [];
		}

		this.rawSearchResults[order] = result;
		this.updateChildren();
	}

	updateChildren(): void {
		this.update({
			id: 'searchResultModel',
			label: 'searchResultModel',
			settings: this.getFlatSettings()
		});

		// Save time, filter children in the search model instead of relying on the tree filter, which still requires heights to be calculated.
		const isRemote = !!this.environmentService.remoteAuthority;

		this.root.children = this.root.children
			.filter(child => child instanceof SettingsTreeSettingElement && child.matchesAllTags(this._viewState.tagFilters) && child.matchesScope(this._viewState.settingsTarget, isRemote) && child.matchesAnyExtension(this._viewState.extensionFilters) && child.matchesAnyId(this._viewState.idFilters) && (this.containsValidFeature() ? child.matchesAnyFeature(this._viewState.featureFilters) : true));

		if (this.newExtensionSearchResults && this.newExtensionSearchResults.filterMatches.length) {
			const resultExtensionIds = this.newExtensionSearchResults.filterMatches
				.map(result => (<IExtensionSetting>result.setting))
				.filter(setting => setting.extensionName && setting.extensionPublisher)
				.map(setting => `${setting.extensionPublisher}.${setting.extensionName}`);

			const newExtElement = new SettingsTreeNewExtensionsElement('newExtensions', arrays.distinct(resultExtensionIds));
			newExtElement.parent = this._root;
			this._root.children.push(newExtElement);
		}
	}

	private containsValidFeature(): boolean {
		if (!this._viewState.featureFilters || !this._viewState.featureFilters.size || !tocData.children) {
			return false;
		}

		const features = tocData.children.find(child => child.id === 'features');

		if (features && features.children) {
			return Array.from(this._viewState.featureFilters).some(filter => {
				return features.children?.find(feature => 'features/' + filter === feature.id);
			});
		} else {
			return false;
		}
	}

	private getFlatSettings(): ISetting[] {
		const flatSettings: ISetting[] = [];
		arrays.coalesce(this.getUniqueResults())
			.forEach(r => {
				flatSettings.push(
					...r.filterMatches.map(m => m.setting));
			});

		return flatSettings;
	}
}

export interface IParsedQuery {
	tags: string[];
	query: string;
	extensionFilters: string[];
	idFilters: string[];
	featureFilters: string[];
}

const tagRegex = /(^|\s)@tag:("([^"]*)"|[^"]\S*)/g;
const extensionRegex = /(^|\s)@ext:("([^"]*)"|[^"]\S*)?/g;
const featureRegex = /(^|\s)@feature:("([^"]*)"|[^"]\S*)?/g;
const idRegex = /(^|\s)@id:("([^"]*)"|[^"]\S*)?/g;
export function parseQuery(query: string): IParsedQuery {
	const tags: string[] = [];
	const extensions: string[] = [];
	const features: string[] = [];
	const ids: string[] = [];
	query = query.replace(tagRegex, (_, __, quotedTag, tag) => {
		tags.push(tag || quotedTag);
		return '';
	});

	query = query.replace(`@${MODIFIED_SETTING_TAG}`, () => {
		tags.push(MODIFIED_SETTING_TAG);
		return '';
	});

	query = query.replace(extensionRegex, (_, __, quotedExtensionId, extensionId) => {
		const extensionIdQuery: string = extensionId || quotedExtensionId;
		if (extensionIdQuery) {
			extensions.push(...extensionIdQuery.split(',').map(s => s.trim()).filter(s => !isFalsyOrWhitespace(s)));
		}
		return '';
	});

	query = query.replace(featureRegex, (_, __, quotedFeature, feature) => {
		const featureQuery: string = feature || quotedFeature;
		if (featureQuery) {
			features.push(...featureQuery.split(',').map(s => s.trim()).filter(s => !isFalsyOrWhitespace(s)));
		}
		return '';
	});

	query = query.replace(idRegex, (_, __, quotedId, id) => {
		const idRegex: string = id || quotedId;
		if (idRegex) {
			ids.push(...idRegex.split(',').map(s => s.trim()).filter(s => !isFalsyOrWhitespace(s)));
		}
		return '';
	});

	query = query.trim();

	return {
		tags,
		extensionFilters: extensions,
		featureFilters: features,
		idFilters: ids,
		query
	};
}
