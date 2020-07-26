/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import * as mime from 'vs/base/common/mime';
import * as strings from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { LanguageId, LanguageIdentifier } from 'vs/editor/common/modes';
import { ModesRegistry } from 'vs/editor/common/modes/modesRegistry';
import { NULL_LANGUAGE_IDENTIFIER, NULL_MODE_ID } from 'vs/editor/common/modes/nullMode';
import { ILanguageExtensionPoint } from 'vs/editor/common/services/modeService';
import { Extensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { Registry } from 'vs/platform/registry/common/platform';

const hasOwnProperty = Object.prototype.hasOwnProperty;

export interface IResolvedLanguage {
	identifier: LanguageIdentifier;
	name: string | null;
	mimetypes: string[];
	aliases: string[];
	extensions: string[];
	filenames: string[];
	configurationFiles: URI[];
}

export class LanguagesRegistry extends Disposable {

	private readonly _onDidChange: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _warnOnOverwrite: boolean;

	private _nextLanguageId2: number;
	private readonly _languageIdToLanguage: string[];
	private readonly _languageToLanguageId: { [id: string]: number; };

	private _languages: { [id: string]: IResolvedLanguage; };
	private _mimeTypesMap: { [mimeType: string]: LanguageIdentifier; };
	private _nameMap: { [name: string]: LanguageIdentifier; };
	private _lowercaseNameMap: { [name: string]: LanguageIdentifier; };

	constructor(useModesRegistry = true, warnOnOverwrite = false) {
		super();

		this._warnOnOverwrite = warnOnOverwrite;

		this._nextLanguageId2 = 1;
		this._languageIdToLanguage = [];
		this._languageToLanguageId = Object.create(null);

		this._languages = {};
		this._mimeTypesMap = {};
		this._nameMap = {};
		this._lowercaseNameMap = {};

		if (useModesRegistry) {
			this._initializeFromRegistry();
			this._register(ModesRegistry.onDidChangeLanguages((m) => this._initializeFromRegistry()));
		}
	}

	private _initializeFromRegistry(): void {
		this._languages = {};
		this._mimeTypesMap = {};
		this._nameMap = {};
		this._lowercaseNameMap = {};

		const desc = ModesRegistry.getLanguages();
		this._registerLanguages(desc);
	}

	_registerLanguages(desc: ILanguageExtensionPoint[]): void {

		for (const d of desc) {
			this._registerLanguage(d);
		}

		// Rebuild fast path maps
		this._mimeTypesMap = {};
		this._nameMap = {};
		this._lowercaseNameMap = {};
		Object.keys(this._languages).forEach((langId) => {
			let language = this._languages[langId];
			if (language.name) {
				this._nameMap[language.name] = language.identifier;
			}
			language.aliases.forEach((alias) => {
				this._lowercaseNameMap[alias.toLowerCase()] = language.identifier;
			});
			language.mimetypes.forEach((mimetype) => {
				this._mimeTypesMap[mimetype] = language.identifier;
			});
		});

		Registry.as<IConfigurationRegistry>(Extensions.Configuration).registerOverrideIdentifiers(ModesRegistry.getLanguages().map(language => language.id));

		this._onDidChange.fire();
	}

	private _getLanguageId(language: string): number {
		if (this._languageToLanguageId[language]) {
			return this._languageToLanguageId[language];
		}

		const languageId = this._nextLanguageId2++;
		this._languageIdToLanguage[languageId] = language;
		this._languageToLanguageId[language] = languageId;

		return languageId;
	}

	private _registerLanguage(lang: ILanguageExtensionPoint): void {
		const langId = lang.id;

		let resolvedLanguage: IResolvedLanguage;
		if (hasOwnProperty.call(this._languages, langId)) {
			resolvedLanguage = this._languages[langId];
		} else {
			const languageId = this._getLanguageId(langId);
			resolvedLanguage = {
				identifier: new LanguageIdentifier(langId, languageId),
				name: null,
				mimetypes: [],
				aliases: [],
				extensions: [],
				filenames: [],
				configurationFiles: []
			};
			this._languages[langId] = resolvedLanguage;
		}

		this._mergeLanguage(resolvedLanguage, lang);
	}

	private _mergeLanguage(resolvedLanguage: IResolvedLanguage, lang: ILanguageExtensionPoint): void {
		const langId = lang.id;

		let primaryMime: string | null = null;

		if (Array.isArray(lang.mimetypes) && lang.mimetypes.length > 0) {
			resolvedLanguage.mimetypes.push(...lang.mimetypes);
			primaryMime = lang.mimetypes[0];
		}

		if (!primaryMime) {
			primaryMime = `text/x-${langId}`;
			resolvedLanguage.mimetypes.push(primaryMime);
		}

		if (Array.isArray(lang.extensions)) {
			if (lang.configuration) {
				// insert first as this appears to be the 'primary' language definition
				resolvedLanguage.extensions = lang.extensions.concat(resolvedLanguage.extensions);
			} else {
				resolvedLanguage.extensions = resolvedLanguage.extensions.concat(lang.extensions);
			}
			for (let extension of lang.extensions) {
				mime.registerTextMime({ id: langId, mime: primaryMime, extension: extension }, this._warnOnOverwrite);
			}
		}

		if (Array.isArray(lang.filenames)) {
			for (let filename of lang.filenames) {
				mime.registerTextMime({ id: langId, mime: primaryMime, filename: filename }, this._warnOnOverwrite);
				resolvedLanguage.filenames.push(filename);
			}
		}

		if (Array.isArray(lang.filenamePatterns)) {
			for (let filenamePattern of lang.filenamePatterns) {
				mime.registerTextMime({ id: langId, mime: primaryMime, filepattern: filenamePattern }, this._warnOnOverwrite);
			}
		}

		if (typeof lang.firstLine === 'string' && lang.firstLine.length > 0) {
			let firstLineRegexStr = lang.firstLine;
			if (firstLineRegexStr.charAt(0) !== '^') {
				firstLineRegexStr = '^' + firstLineRegexStr;
			}
			try {
				let firstLineRegex = new RegExp(firstLineRegexStr);
				if (!strings.regExpLeadsToEndlessLoop(firstLineRegex)) {
					mime.registerTextMime({ id: langId, mime: primaryMime, firstline: firstLineRegex }, this._warnOnOverwrite);
				}
			} catch (err) {
				// Most likely, the regex was bad
				onUnexpectedError(err);
			}
		}

		resolvedLanguage.aliases.push(langId);

		let langAliases: Array<string | null> | null = null;
		if (typeof lang.aliases !== 'undefined' && Array.isArray(lang.aliases)) {
			if (lang.aliases.length === 0) {
				// signal that this language should not get a name
				langAliases = [null];
			} else {
				langAliases = lang.aliases;
			}
		}

		if (langAliases !== null) {
			for (const langAlias of langAliases) {
				if (!langAlias || langAlias.length === 0) {
					continue;
				}
				resolvedLanguage.aliases.push(langAlias);
			}
		}

		let containsAliases = (langAliases !== null && langAliases.length > 0);
		if (containsAliases && langAliases![0] === null) {
			// signal that this language should not get a name
		} else {
			let bestName = (containsAliases ? langAliases![0] : null) || langId;
			if (containsAliases || !resolvedLanguage.name) {
				resolvedLanguage.name = bestName;
			}
		}

		if (lang.configuration) {
			resolvedLanguage.configurationFiles.push(lang.configuration);
		}
	}

	public isRegisteredMode(mimetypeOrModeId: string): boolean {
		// Is this a known mime type ?
		if (hasOwnProperty.call(this._mimeTypesMap, mimetypeOrModeId)) {
			return true;
		}
		// Is this a known mode id ?
		return hasOwnProperty.call(this._languages, mimetypeOrModeId);
	}

	public getRegisteredModes(): string[] {
		return Object.keys(this._languages);
	}

	public getRegisteredLanguageNames(): string[] {
		return Object.keys(this._nameMap);
	}

	public getLanguageName(modeId: string): string | null {
		if (!hasOwnProperty.call(this._languages, modeId)) {
			return null;
		}
		return this._languages[modeId].name;
	}

	public getModeIdForLanguageNameLowercase(languageNameLower: string): string | null {
		if (!hasOwnProperty.call(this._lowercaseNameMap, languageNameLower)) {
			return null;
		}
		return this._lowercaseNameMap[languageNameLower].language;
	}

	public getConfigurationFiles(modeId: string): URI[] {
		if (!hasOwnProperty.call(this._languages, modeId)) {
			return [];
		}
		return this._languages[modeId].configurationFiles || [];
	}

	public getMimeForMode(modeId: string): string | null {
		if (!hasOwnProperty.call(this._languages, modeId)) {
			return null;
		}
		const language = this._languages[modeId];
		return (language.mimetypes[0] || null);
	}

	public extractModeIds(commaSeparatedMimetypesOrCommaSeparatedIds: string | undefined): string[] {
		if (!commaSeparatedMimetypesOrCommaSeparatedIds) {
			return [];
		}

		return (
			commaSeparatedMimetypesOrCommaSeparatedIds.
				split(',').
				map((mimeTypeOrId) => mimeTypeOrId.trim()).
				map((mimeTypeOrId) => {
					if (hasOwnProperty.call(this._mimeTypesMap, mimeTypeOrId)) {
						return this._mimeTypesMap[mimeTypeOrId].language;
					}
					return mimeTypeOrId;
				}).
				filter((modeId) => {
					return hasOwnProperty.call(this._languages, modeId);
				})
		);
	}

	public getLanguageIdentifier(_modeId: string | LanguageId): LanguageIdentifier | null {
		if (_modeId === NULL_MODE_ID || _modeId === LanguageId.Null) {
			return NULL_LANGUAGE_IDENTIFIER;
		}

		let modeId: string;
		if (typeof _modeId === 'string') {
			modeId = _modeId;
		} else {
			modeId = this._languageIdToLanguage[_modeId];
			if (!modeId) {
				return null;
			}
		}

		if (!hasOwnProperty.call(this._languages, modeId)) {
			return null;
		}
		return this._languages[modeId].identifier;
	}

	public getModeIdsFromLanguageName(languageName: string): string[] {
		if (!languageName) {
			return [];
		}
		if (hasOwnProperty.call(this._nameMap, languageName)) {
			return [this._nameMap[languageName].language];
		}
		return [];
	}

	public getModeIdsFromFilepathOrFirstLine(resource: URI | null, firstLine?: string): string[] {
		if (!resource && !firstLine) {
			return [];
		}
		let mimeTypes = mime.guessMimeTypes(resource, firstLine);
		return this.extractModeIds(mimeTypes.join(','));
	}

	public getExtensions(languageName: string): string[] {
		if (!hasOwnProperty.call(this._nameMap, languageName)) {
			return [];
		}
		const languageId = this._nameMap[languageName];
		return this._languages[languageId.language].extensions;
	}

	public getFilenames(languageName: string): string[] {
		if (!hasOwnProperty.call(this._nameMap, languageName)) {
			return [];
		}
		const languageId = this._nameMap[languageName];
		return this._languages[languageId.language].filenames;
	}
}
