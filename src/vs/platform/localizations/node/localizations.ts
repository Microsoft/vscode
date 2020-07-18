/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as pfs from 'vs/base/node/pfs';
import { createHash } from 'crypto';
import { IExtensionManagementService, ILocalExtension, IExtensionIdentifier } from 'vs/platform/extensionManagement/common/extensionManagement';
import { Disposable } from 'vs/base/common/lifecycle';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { Queue } from 'vs/base/common/async';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { ILogService } from 'vs/platform/log/common/log';
import { isValidLocalization, ILocalizationsService } from 'vs/platform/localizations/common/localizations';
import { distinct, equals } from 'vs/base/common/arrays';
import { Event, Emitter } from 'vs/base/common/event';
import { Schemas } from 'vs/base/common/network';
import { join } from 'vs/base/common/path';

interface ILanguagePack {
	hash: string;
	extensions: {
		extensionIdentifier: IExtensionIdentifier;
		version: string;
	}[];
	translations: { [id: string]: string };
}

export class LocalizationsService extends Disposable implements ILocalizationsService {

	declare readonly _serviceBrand: undefined;

	private readonly cache: LanguagePacksCache;

	private readonly _onDidLanguagesChange: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidLanguagesChange: Event<void> = this._onDidLanguagesChange.event;

	constructor(
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IEnvironmentService environmentService: INativeEnvironmentService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.cache = this._register(new LanguagePacksCache(environmentService, logService));

		this._register(extensionManagementService.onDidInstallExtension(({ local }) => this.onDidInstallExtension(local)));
		this._register(extensionManagementService.onDidUninstallExtension(({ identifier }) => this.onDidUninstallExtension(identifier)));
	}

	getLanguageIds(): Promise<string[]> {
		return this.cache.getLanguagePacks()
			.then(languagePacks => {
				// Contributed languages are those installed via extension packs, so does not include English
				const languages = ['en', ...Object.keys(languagePacks)];
				return distinct(languages);
			});
	}

	private onDidInstallExtension(extension: ILocalExtension | undefined): void {
		if (extension && extension.manifest && extension.manifest.contributes && extension.manifest.contributes.localizations && extension.manifest.contributes.localizations.length) {
			this.logService.debug('Adding language packs from the extension', extension.identifier.id);
			this.update().then(changed => { if (changed) { this._onDidLanguagesChange.fire(); } });
		}
	}

	private onDidUninstallExtension(identifier: IExtensionIdentifier): void {
		this.cache.getLanguagePacks()
			.then(languagePacks => {
				if (Object.keys(languagePacks).some(language => languagePacks[language] && languagePacks[language].extensions.some(e => areSameExtensions(e.extensionIdentifier, identifier)))) {
					this.logService.debug('Removing language packs from the extension', identifier.id);
					this.update().then(changed => { if (changed) { this._onDidLanguagesChange.fire(); } });
				}
			});
	}

	update(): Promise<boolean> {
		return Promise.all([this.cache.getLanguagePacks(), this.extensionManagementService.getInstalled()])
			.then(([current, installed]) => this.cache.update(installed)
				.then(updated => !equals(Object.keys(current), Object.keys(updated))));
	}
}

class LanguagePacksCache extends Disposable {

	private languagePacks: { [language: string]: ILanguagePack } = {};
	private languagePacksFilePath: string;
	private languagePacksFileLimiter: Queue<any>;
	private initializedCache: boolean | undefined;

	constructor(
		@IEnvironmentService environmentService: INativeEnvironmentService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.languagePacksFilePath = join(environmentService.userDataPath, 'languagepacks.json');
		this.languagePacksFileLimiter = new Queue();
	}

	getLanguagePacks(): Promise<{ [language: string]: ILanguagePack }> {
		// if queue is not empty, fetch from disk
		if (this.languagePacksFileLimiter.size || !this.initializedCache) {
			return this.withLanguagePacks()
				.then(() => this.languagePacks);
		}
		return Promise.resolve(this.languagePacks);
	}

	update(extensions: ILocalExtension[]): Promise<{ [language: string]: ILanguagePack }> {
		return this.withLanguagePacks(languagePacks => {
			Object.keys(languagePacks).forEach(language => delete languagePacks[language]);
			this.createLanguagePacksFromExtensions(languagePacks, ...extensions);
		}).then(() => this.languagePacks);
	}

	private createLanguagePacksFromExtensions(languagePacks: { [language: string]: ILanguagePack }, ...extensions: ILocalExtension[]): void {
		for (const extension of extensions) {
			if (extension && extension.manifest && extension.manifest.contributes && extension.manifest.contributes.localizations && extension.manifest.contributes.localizations.length) {
				this.createLanguagePacksFromExtension(languagePacks, extension);
			}
		}
		Object.keys(languagePacks).forEach(languageId => this.updateHash(languagePacks[languageId]));
	}

	private createLanguagePacksFromExtension(languagePacks: { [language: string]: ILanguagePack }, extension: ILocalExtension): void {
		const extensionIdentifier = extension.identifier;
		const localizations = extension.manifest.contributes && extension.manifest.contributes.localizations ? extension.manifest.contributes.localizations : [];
		for (const localizationContribution of localizations) {
			if (extension.location.scheme === Schemas.file && isValidLocalization(localizationContribution)) {
				let languagePack = languagePacks[localizationContribution.languageId];
				if (!languagePack) {
					languagePack = { hash: '', extensions: [], translations: {} };
					languagePacks[localizationContribution.languageId] = languagePack;
				}
				let extensionInLanguagePack = languagePack.extensions.filter(e => areSameExtensions(e.extensionIdentifier, extensionIdentifier))[0];
				if (extensionInLanguagePack) {
					extensionInLanguagePack.version = extension.manifest.version;
				} else {
					languagePack.extensions.push({ extensionIdentifier, version: extension.manifest.version });
				}
				for (const translation of localizationContribution.translations) {
					languagePack.translations[translation.id] = join(extension.location.fsPath, translation.path);
				}
			}
		}
	}

	private updateHash(languagePack: ILanguagePack): void {
		if (languagePack) {
			const md5 = createHash('md5');
			for (const extension of languagePack.extensions) {
				md5.update(extension.extensionIdentifier.uuid || extension.extensionIdentifier.id).update(extension.version);
			}
			languagePack.hash = md5.digest('hex');
		}
	}

	private withLanguagePacks<T>(fn: (languagePacks: { [language: string]: ILanguagePack }) => T | null = () => null): Promise<T> {
		return this.languagePacksFileLimiter.queue(() => {
			let result: T | null = null;
			return pfs.readFile(this.languagePacksFilePath, 'utf8')
				.then(undefined, err => err.code === 'ENOENT' ? Promise.resolve('{}') : Promise.reject(err))
				.then<{ [language: string]: ILanguagePack }>(raw => { try { return JSON.parse(raw); } catch (e) { return {}; } })
				.then(languagePacks => { result = fn(languagePacks); return languagePacks; })
				.then(languagePacks => {
					for (const language of Object.keys(languagePacks)) {
						if (!languagePacks[language]) {
							delete languagePacks[language];
						}
					}
					this.languagePacks = languagePacks;
					this.initializedCache = true;
					const raw = JSON.stringify(this.languagePacks);
					this.logService.debug('Writing language packs', raw);
					return pfs.writeFile(this.languagePacksFilePath, raw);
				})
				.then(() => result, error => this.logService.error(error));
		});
	}
}
