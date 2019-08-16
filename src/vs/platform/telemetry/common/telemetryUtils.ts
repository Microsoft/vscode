/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from 'vs/base/common/lifecycle';
import { IConfigurationService, ConfigurationTarget, ConfigurationTargetToString } from 'vs/platform/configuration/common/configuration';
import { IKeybindingService, KeybindingSource } from 'vs/platform/keybinding/common/keybinding';
import { ITelemetryService, ITelemetryInfo, ITelemetryData } from 'vs/platform/telemetry/common/telemetry';
import { ILogService } from 'vs/platform/log/common/log';
import { ClassifiedEvent, StrictPropertyCheck, GDPRClassification } from 'vs/platform/telemetry/common/gdprTypings';
import { safeStringify } from 'vs/base/common/objects';
import { isObject } from 'vs/base/common/types';

export const NullTelemetryService = new class implements ITelemetryService {
	_serviceBrand: undefined;
	publicLog(eventName: string, data?: ITelemetryData) {
		return Promise.resolve(undefined);
	}
	publicLog2<E extends ClassifiedEvent<T> = never, T extends GDPRClassification<T> = never>(eventName: string, data?: StrictPropertyCheck<T, E>) {
		return this.publicLog(eventName, data as ITelemetryData);
	}
	setEnabled() { }
	isOptedIn: true;
	getTelemetryInfo(): Promise<ITelemetryInfo> {
		return Promise.resolve({
			instanceId: 'someValue.instanceId',
			sessionId: 'someValue.sessionId',
			machineId: 'someValue.machineId'
		});
	}
};

export interface ITelemetryAppender {
	log(eventName: string, data: any): void;
	flush(): Promise<any>;
}

export function combinedAppender(...appenders: ITelemetryAppender[]): ITelemetryAppender {
	return {
		log: (e, d) => appenders.forEach(a => a.log(e, d)),
		flush: () => Promise.all(appenders.map(a => a.flush()))
	};
}

export const NullAppender: ITelemetryAppender = { log: () => null, flush: () => Promise.resolve(null) };


export class LogAppender implements ITelemetryAppender {

	private commonPropertiesRegex = /^sessionID$|^version$|^timestamp$|^commitHash$|^common\./;
	constructor(@ILogService private readonly _logService: ILogService) { }

	flush(): Promise<any> {
		return Promise.resolve(undefined);
	}

	log(eventName: string, data: any): void {
		const strippedData: { [key: string]: any } = {};
		Object.keys(data).forEach(key => {
			if (!this.commonPropertiesRegex.test(key)) {
				strippedData[key] = data[key];
			}
		});
		this._logService.trace(`telemetry/${eventName}`, strippedData);
	}
}

/* __GDPR__FRAGMENT__
	"URIDescriptor" : {
		"mimeType" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"scheme": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"ext": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"path": { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
	}
*/
export interface URIDescriptor {
	mimeType?: string;
	scheme?: string;
	ext?: string;
	path?: string;
}

/**
 * Only add settings that cannot contain any personal/private information of users (PII).
 */
const configurationValueWhitelist = [
	'editor.fontFamily',
	'editor.fontWeight',
	'editor.fontSize',
	'editor.lineHeight',
	'editor.letterSpacing',
	'editor.lineNumbers',
	'editor.rulers',
	'editor.wordSeparators',
	'editor.tabSize',
	'editor.indentSize',
	'editor.insertSpaces',
	'editor.detectIndentation',
	'editor.roundedSelection',
	'editor.scrollBeyondLastLine',
	'editor.minimap.enabled',
	'editor.minimap.side',
	'editor.minimap.renderCharacters',
	'editor.minimap.maxColumn',
	'editor.find.seedSearchStringFromSelection',
	'editor.find.autoFindInSelection',
	'editor.wordWrap',
	'editor.wordWrapColumn',
	'editor.wrappingIndent',
	'editor.mouseWheelScrollSensitivity',
	'editor.multiCursorModifier',
	'editor.quickSuggestions',
	'editor.quickSuggestionsDelay',
	'editor.parameterHints.enabled',
	'editor.parameterHints.cycle',
	'editor.autoClosingBrackets',
	'editor.autoClosingComments',
	'editor.autoClosingQuotes',
	'editor.autoSurround',
	'editor.autoIndent',
	'editor.formatOnType',
	'editor.formatOnPaste',
	'editor.suggestOnTriggerCharacters',
	'editor.acceptSuggestionOnEnter',
	'editor.acceptSuggestionOnCommitCharacter',
	'editor.snippetSuggestions',
	'editor.emptySelectionClipboard',
	'editor.wordBasedSuggestions',
	'editor.suggestSelection',
	'editor.suggestFontSize',
	'editor.suggestLineHeight',
	'editor.tabCompletion',
	'editor.selectionHighlight',
	'editor.occurrencesHighlight',
	'editor.overviewRulerLanes',
	'editor.overviewRulerBorder',
	'editor.cursorBlinking',
	'editor.cursorSmoothCaretAnimation',
	'editor.cursorStyle',
	'editor.mouseWheelZoom',
	'editor.fontLigatures',
	'editor.hideCursorInOverviewRuler',
	'editor.renderWhitespace',
	'editor.renderControlCharacters',
	'editor.renderIndentGuides',
	'editor.renderLineHighlight',
	'editor.codeLens',
	'editor.folding',
	'editor.showFoldingControls',
	'editor.matchBrackets',
	'editor.glyphMargin',
	'editor.useTabStops',
	'editor.trimAutoWhitespace',
	'editor.stablePeek',
	'editor.dragAndDrop',
	'editor.formatOnSave',
	'editor.colorDecorators',

	'breadcrumbs.enabled',
	'breadcrumbs.filePath',
	'breadcrumbs.symbolPath',
	'breadcrumbs.symbolSortOrder',
	'breadcrumbs.useQuickPick',
	'explorer.openEditors.visible',
	'extensions.autoUpdate',
	'files.associations',
	'files.autoGuessEncoding',
	'files.autoSave',
	'files.autoSaveDelay',
	'files.encoding',
	'files.eol',
	'files.hotExit',
	'files.trimTrailingWhitespace',
	'git.confirmSync',
	'git.enabled',
	'http.proxyStrictSSL',
	'javascript.validate.enable',
	'php.builtInCompletions.enable',
	'php.validate.enable',
	'php.validate.run',
	'terminal.integrated.fontFamily',
	'window.openFilesInNewWindow',
	'window.restoreWindows',
	'window.nativeFullScreen',
	'window.zoomLevel',
	'workbench.editor.enablePreview',
	'workbench.editor.enablePreviewFromQuickOpen',
	'workbench.editor.showTabs',
	'workbench.editor.highlightModifiedTabs',
	'workbench.sideBar.location',
	'workbench.startupEditor',
	'workbench.statusBar.visible',
	'workbench.welcome.enabled',
];

export function configurationTelemetry(telemetryService: ITelemetryService, configurationService: IConfigurationService): IDisposable {
	return configurationService.onDidChangeConfiguration(event => {
		if (event.source !== ConfigurationTarget.DEFAULT) {
			type UpdateConfigurationClassification = {
				configurationSource: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
				configurationKeys: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
			};
			type UpdateConfigurationEvent = {
				configurationSource: string;
				configurationKeys: string[];
			};
			telemetryService.publicLog2<UpdateConfigurationEvent, UpdateConfigurationClassification>('updateConfiguration', {
				configurationSource: ConfigurationTargetToString(event.source),
				configurationKeys: flattenKeys(event.sourceConfig)
			});
			type UpdateConfigurationValuesClassification = {
				configurationSource: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
				configurationValues: { classification: 'CustomerContent', purpose: 'FeatureInsight' };
			};
			type UpdateConfigurationValuesEvent = {
				configurationSource: string;
				configurationValues: { [key: string]: any }[];
			};
			telemetryService.publicLog2<UpdateConfigurationValuesEvent, UpdateConfigurationValuesClassification>('updateConfigurationValues', {
				configurationSource: ConfigurationTargetToString(event.source),
				configurationValues: flattenValues(event.sourceConfig, configurationValueWhitelist)
			});
		}
	});
}

export function keybindingsTelemetry(telemetryService: ITelemetryService, keybindingService: IKeybindingService): IDisposable {
	return keybindingService.onDidUpdateKeybindings(event => {
		if (event.source === KeybindingSource.User && event.keybindings) {
			type UpdateKeybindingsClassification = {
				bindings: { classification: 'CustomerContent', purpose: 'FeatureInsight' };
			};
			type UpdateKeybindingsEvents = {
				bindings: { key: string, command: string, when: string | undefined, args: boolean | undefined }[];
			};
			telemetryService.publicLog2<UpdateKeybindingsEvents, UpdateKeybindingsClassification>('updateKeybindings', {
				bindings: event.keybindings.map(binding => ({
					key: binding.key,
					command: binding.command,
					when: binding.when,
					args: binding.args ? true : undefined
				}))
			});
		}
	});
}


export interface Properties {
	[key: string]: string;
}

export interface Measurements {
	[key: string]: number;
}

export function validateTelemetryData(data?: any): { properties: Properties, measurements: Measurements } {

	const properties: Properties = Object.create(null);
	const measurements: Measurements = Object.create(null);

	const flat = Object.create(null);
	flatten(data, flat);

	for (let prop in flat) {
		// enforce property names less than 150 char, take the last 150 char
		prop = prop.length > 150 ? prop.substr(prop.length - 149) : prop;
		const value = flat[prop];

		if (typeof value === 'number') {
			measurements[prop] = value;

		} else if (typeof value === 'boolean') {
			measurements[prop] = value ? 1 : 0;

		} else if (typeof value === 'string') {
			//enforce property value to be less than 1024 char, take the first 1024 char
			properties[prop] = value.substring(0, 1023);

		} else if (typeof value !== 'undefined' && value !== null) {
			properties[prop] = value;
		}
	}

	return {
		properties,
		measurements
	};
}

export function cleanRemoteAuthority(remoteAuthority?: string): string {
	if (!remoteAuthority) {
		return 'none';
	}

	let ret = 'other';
	// Whitelisted remote authorities
	['ssh-remote', 'dev-container', 'attached-container', 'wsl'].forEach((res: string) => {
		if (remoteAuthority!.indexOf(`${res}+`) === 0) {
			ret = res;
		}
	});

	return ret;
}

function flatten(obj: any, result: { [key: string]: any }, order: number = 0, prefix?: string): void {
	if (!obj) {
		return;
	}

	for (let item of Object.getOwnPropertyNames(obj)) {
		const value = obj[item];
		const index = prefix ? prefix + item : item;

		if (Array.isArray(value)) {
			result[index] = safeStringify(value);

		} else if (value instanceof Date) {
			// TODO unsure why this is here and not in _getData
			result[index] = value.toISOString();

		} else if (isObject(value)) {
			if (order < 2) {
				flatten(value, result, order + 1, index + '.');
			} else {
				result[index] = safeStringify(value);
			}
		} else {
			result[index] = value;
		}
	}
}

function flattenKeys(value: Object | undefined): string[] {
	if (!value) {
		return [];
	}
	const result: string[] = [];
	flatKeys(result, '', value);
	return result;
}

function flatKeys(result: string[], prefix: string, value: { [key: string]: any } | undefined): void {
	if (value && typeof value === 'object' && !Array.isArray(value)) {
		Object.keys(value)
			.forEach(key => flatKeys(result, prefix ? `${prefix}.${key}` : key, value[key]));
	} else {
		result.push(prefix);
	}
}

function flattenValues(value: { [key: string]: any } | undefined, keys: string[]): { [key: string]: any }[] {
	if (!value) {
		return [];
	}

	return keys.reduce((array, key) => {
		const v = key.split('.')
			.reduce((tmp, k) => tmp && typeof tmp === 'object' ? tmp[k] : undefined, value);
		if (typeof v !== 'undefined') {
			array.push({ [key]: v });
		}
		return array;
	}, <{ [key: string]: any }[]>[]);
}
