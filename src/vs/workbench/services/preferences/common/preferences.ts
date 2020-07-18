/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IStringDictionary } from 'vs/base/common/collections';
import { Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { IRange } from 'vs/editor/common/core/range';
import { IJSONSchemaMap, IJSONSchema } from 'vs/base/common/jsonSchema';
import { ITextModel } from 'vs/editor/common/model';
import { localize } from 'vs/nls';
import { ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { ConfigurationScope, IConfigurationExtensionInfo } from 'vs/platform/configuration/common/configurationRegistry';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { EditorOptions, IEditorPane } from 'vs/workbench/common/editor';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { Settings2EditorModel } from 'vs/workbench/services/preferences/common/preferencesModels';

export enum SettingValueType {
	Null = 'null',
	Enum = 'enum',
	String = 'string',
	Integer = 'integer',
	Number = 'number',
	Boolean = 'boolean',
	ArrayOfString = 'array-of-string',
	Exclude = 'exclude',
	Complex = 'complex',
	NullableInteger = 'nullable-integer',
	NullableNumber = 'nullable-number',
	Object = 'object'
}

export interface ISettingsGroup {
	id: string;
	range: IRange;
	title: string;
	titleRange: IRange;
	sections: ISettingsSection[];
	contributedByExtension: boolean;
}

export interface ISettingsSection {
	titleRange?: IRange;
	title?: string;
	settings: ISetting[];
}

export interface ISetting {
	range: IRange;
	key: string;
	keyRange: IRange;
	value: any;
	valueRange: IRange;
	description: string[];
	descriptionIsMarkdown?: boolean;
	descriptionRanges: IRange[];
	overrides?: ISetting[];
	overrideOf?: ISetting;
	deprecationMessage?: string;
	deprecationMessageIsMarkdown?: boolean;

	scope?: ConfigurationScope;
	type?: string | string[];
	arrayItemType?: string;
	objectProperties?: IJSONSchemaMap,
	objectPatternProperties?: IJSONSchemaMap,
	objectAdditionalProperties?: boolean | IJSONSchema,
	enum?: string[];
	enumDescriptions?: string[];
	enumDescriptionsAreMarkdown?: boolean;
	tags?: string[];
	disallowSyncIgnore?: boolean;
	extensionInfo?: IConfigurationExtensionInfo;
	validator?: (value: any) => string | null;
}

export interface IExtensionSetting extends ISetting {
	extensionName?: string;
	extensionPublisher?: string;
}

export interface ISearchResult {
	filterMatches: ISettingMatch[];
	exactMatch?: boolean;
	metadata?: IFilterMetadata;
}

export interface ISearchResultGroup {
	id: string;
	label: string;
	result: ISearchResult;
	order: number;
}

export interface IFilterResult {
	query?: string;
	filteredGroups: ISettingsGroup[];
	allGroups: ISettingsGroup[];
	matches: IRange[];
	metadata?: IStringDictionary<IFilterMetadata>;
	exactMatch?: boolean;
}

export interface ISettingMatch {
	setting: ISetting;
	matches: IRange[] | null;
	score: number;
}

export interface IScoredResults {
	[key: string]: IRemoteSetting;
}

export interface IRemoteSetting {
	score: number;
	key: string;
	id: string;
	defaultValue: string;
	description: string;
	packageId: string;
	extensionName?: string;
	extensionPublisher?: string;
}

export interface IFilterMetadata {
	requestUrl: string;
	requestBody: string;
	timestamp: number;
	duration: number;
	scoredResults: IScoredResults;

	/** The number of requests made, since requests are split by number of filters */
	requestCount?: number;

	/** The name of the server that actually served the request */
	context: string;
}

export interface IPreferencesEditorModel<T> {
	uri?: URI;
	getPreference(key: string): T | undefined;
	dispose(): void;
}

export type IGroupFilter = (group: ISettingsGroup) => boolean | null;
export type ISettingMatcher = (setting: ISetting, group: ISettingsGroup) => { matches: IRange[], score: number } | null;

export interface ISettingsEditorModel extends IPreferencesEditorModel<ISetting> {
	readonly onDidChangeGroups: Event<void>;
	settingsGroups: ISettingsGroup[];
	filterSettings(filter: string, groupFilter: IGroupFilter, settingMatcher: ISettingMatcher): ISettingMatch[];
	findValueMatches(filter: string, setting: ISetting): IRange[];
	updateResultGroup(id: string, resultGroup: ISearchResultGroup | undefined): IFilterResult | undefined;
}

export interface ISettingsEditorOptions extends IEditorOptions {
	target?: ConfigurationTarget;
	folderUri?: URI;
	query?: string;
	editSetting?: string;
}

/**
 * TODO Why do we need this class?
 */
export class SettingsEditorOptions extends EditorOptions implements ISettingsEditorOptions {

	target?: ConfigurationTarget;
	folderUri?: URI;
	query?: string;
	editSetting?: string;

	static create(settings: ISettingsEditorOptions): SettingsEditorOptions {
		const options = new SettingsEditorOptions();
		options.overwrite(settings);

		options.target = settings.target;
		options.folderUri = settings.folderUri;
		options.query = settings.query;
		options.editSetting = settings.editSetting;

		return options;
	}
}

export interface IKeybindingsEditorModel<T> extends IPreferencesEditorModel<T> {
}

export const IPreferencesService = createDecorator<IPreferencesService>('preferencesService');

export interface IPreferencesService {
	readonly _serviceBrand: undefined;

	userSettingsResource: URI;
	workspaceSettingsResource: URI | null;
	getFolderSettingsResource(resource: URI): URI | null;

	resolveModel(uri: URI): Promise<ITextModel | null>;
	createPreferencesEditorModel<T>(uri: URI): Promise<IPreferencesEditorModel<T> | null>;
	createSettings2EditorModel(): Settings2EditorModel; // TODO

	openRawDefaultSettings(): Promise<IEditorPane | undefined>;
	openSettings(jsonEditor: boolean | undefined, query: string | undefined): Promise<IEditorPane | undefined>;
	openGlobalSettings(jsonEditor?: boolean, options?: ISettingsEditorOptions, group?: IEditorGroup): Promise<IEditorPane | undefined>;
	openRemoteSettings(): Promise<IEditorPane | undefined>;
	openWorkspaceSettings(jsonEditor?: boolean, options?: ISettingsEditorOptions, group?: IEditorGroup): Promise<IEditorPane | undefined>;
	openFolderSettings(folder: URI, jsonEditor?: boolean, options?: ISettingsEditorOptions, group?: IEditorGroup): Promise<IEditorPane | undefined>;
	switchSettings(target: ConfigurationTarget, resource: URI, jsonEditor?: boolean): Promise<void>;
	openGlobalKeybindingSettings(textual: boolean): Promise<void>;
	openDefaultKeybindingsFile(): Promise<IEditorPane | undefined>;
	getEditableSettingsURI(configurationTarget: ConfigurationTarget, resource?: URI): Promise<URI | null>;
}

export function getSettingsTargetName(target: ConfigurationTarget, resource: URI, workspaceContextService: IWorkspaceContextService): string {
	switch (target) {
		case ConfigurationTarget.USER:
		case ConfigurationTarget.USER_LOCAL:
			return localize('userSettingsTarget', "User Settings");
		case ConfigurationTarget.WORKSPACE:
			return localize('workspaceSettingsTarget', "Workspace Settings");
		case ConfigurationTarget.WORKSPACE_FOLDER:
			const folder = workspaceContextService.getWorkspaceFolder(resource);
			return folder ? folder.name : '';
	}
	return '';
}

export const FOLDER_SETTINGS_PATH = '.vscode/settings.json';
export const DEFAULT_SETTINGS_EDITOR_SETTING = 'workbench.settings.openDefaultSettings';
export const USE_SPLIT_JSON_SETTING = 'workbench.settings.useSplitJSON';
