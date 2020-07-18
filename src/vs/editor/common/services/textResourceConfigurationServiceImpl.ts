/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IPosition, Position } from 'vs/editor/common/core/position';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ITextResourceConfigurationService, ITextResourceConfigurationChangeEvent } from 'vs/editor/common/services/textResourceConfigurationService';
import { IConfigurationService, ConfigurationTarget, IConfigurationValue, IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';

export class TextResourceConfigurationService extends Disposable implements ITextResourceConfigurationService {

	public _serviceBrand: undefined;

	private readonly _onDidChangeConfiguration: Emitter<ITextResourceConfigurationChangeEvent> = this._register(new Emitter<ITextResourceConfigurationChangeEvent>());
	public readonly onDidChangeConfiguration: Event<ITextResourceConfigurationChangeEvent> = this._onDidChangeConfiguration.event;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService,
	) {
		super();
		this._register(this.configurationService.onDidChangeConfiguration(e => this._onDidChangeConfiguration.fire(this.toResourceConfigurationChangeEvent(e))));
	}

	getValue<T>(resource: URI | undefined, section?: string): T;
	getValue<T>(resource: URI | undefined, at?: IPosition, section?: string): T;
	getValue<T>(resource: URI | undefined, arg2?: any, arg3?: any): T {
		if (typeof arg3 === 'string') {
			return this._getValue(resource, Position.isIPosition(arg2) ? arg2 : null, arg3);
		}
		return this._getValue(resource, null, typeof arg2 === 'string' ? arg2 : undefined);
	}

	updateValue(resource: URI, key: string, value: any, configurationTarget?: ConfigurationTarget): Promise<void> {
		const language = this.getLanguage(resource, null);
		const configurationValue = this.configurationService.inspect(key, { resource, overrideIdentifier: language });
		if (configurationTarget === undefined) {
			configurationTarget = this.deriveConfigurationTarget(configurationValue, language);
		}
		switch (configurationTarget) {
			case ConfigurationTarget.MEMORY:
				return this._updateValue(key, value, configurationTarget, configurationValue.memory?.override, resource, language);
			case ConfigurationTarget.WORKSPACE_FOLDER:
				return this._updateValue(key, value, configurationTarget, configurationValue.workspaceFolder?.override, resource, language);
			case ConfigurationTarget.WORKSPACE:
				return this._updateValue(key, value, configurationTarget, configurationValue.workspace?.override, resource, language);
			case ConfigurationTarget.USER_REMOTE:
				return this._updateValue(key, value, configurationTarget, configurationValue.userRemote?.override, resource, language);
			default:
				return this._updateValue(key, value, configurationTarget, configurationValue.userLocal?.override, resource, language);
		}
	}

	private _updateValue(key: string, value: any, configurationTarget: ConfigurationTarget, overriddenValue: any | undefined, resource: URI, language: string | null): Promise<void> {
		if (language && overriddenValue !== undefined) {
			return this.configurationService.updateValue(key, value, { resource, overrideIdentifier: language }, configurationTarget);
		} else {
			return this.configurationService.updateValue(key, value, { resource }, configurationTarget);
		}
	}

	private deriveConfigurationTarget(configurationValue: IConfigurationValue<any>, language: string | null): ConfigurationTarget {
		if (language) {
			if (configurationValue.memory?.override !== undefined) {
				return ConfigurationTarget.MEMORY;
			}
			if (configurationValue.workspaceFolder?.override !== undefined) {
				return ConfigurationTarget.WORKSPACE_FOLDER;
			}
			if (configurationValue.workspace?.override !== undefined) {
				return ConfigurationTarget.WORKSPACE;
			}
			if (configurationValue.userRemote?.override !== undefined) {
				return ConfigurationTarget.USER_REMOTE;
			}
			if (configurationValue.userLocal?.override !== undefined) {
				return ConfigurationTarget.USER_LOCAL;
			}
		}
		if (configurationValue.memory?.value !== undefined) {
			return ConfigurationTarget.MEMORY;
		}
		if (configurationValue.workspaceFolder?.value !== undefined) {
			return ConfigurationTarget.WORKSPACE_FOLDER;
		}
		if (configurationValue.workspace?.value !== undefined) {
			return ConfigurationTarget.WORKSPACE;
		}
		if (configurationValue.userRemote?.value !== undefined) {
			return ConfigurationTarget.USER_REMOTE;
		}
		return ConfigurationTarget.USER_LOCAL;
	}

	private _getValue<T>(resource: URI | undefined, position: IPosition | null, section: string | undefined): T {
		const language = resource ? this.getLanguage(resource, position) : undefined;
		if (typeof section === 'undefined') {
			return this.configurationService.getValue<T>({ resource, overrideIdentifier: language });
		}
		return this.configurationService.getValue<T>(section, { resource, overrideIdentifier: language });
	}

	private getLanguage(resource: URI, position: IPosition | null): string | null {
		const model = this.modelService.getModel(resource);
		if (model) {
			return position ? this.modeService.getLanguageIdentifier(model.getLanguageIdAtPosition(position.lineNumber, position.column))!.language : model.getLanguageIdentifier().language;
		}
		return this.modeService.getModeIdByFilepathOrFirstLine(resource);
	}

	private toResourceConfigurationChangeEvent(configurationChangeEvent: IConfigurationChangeEvent): ITextResourceConfigurationChangeEvent {
		return {
			affectedKeys: configurationChangeEvent.affectedKeys,
			affectsConfiguration: (resource: URI, configuration: string) => {
				const overrideIdentifier = this.getLanguage(resource, null);
				return configurationChangeEvent.affectsConfiguration(configuration, { resource, overrideIdentifier });
			}
		};
	}
}
