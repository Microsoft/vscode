/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { IPosition } from 'vs/editor/common/core/position';
import { ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const ITextResourceConfigurationService = createDecorator<ITextResourceConfigurationService>('textResourceConfigurationService');

export interface ITextResourceConfigurationChangeEvent {

	/**
	 * All affected keys. Also includes language overrides and keys changed under language overrides.
	 */
	readonly affectedKeys: string[];

	/**
	 * Returns `true` if the given section has changed for the given resource.
	 *
	 * Example: To check if the configuration section has changed for a given resource use `e.affectsConfiguration(resource, section)`.
	 *
	 * @param resource Resource for which the configuration has to be checked.
	 * @param section Section of the configuration
	 */
	affectsConfiguration(resource: URI, section: string): boolean;
}

export interface ITextResourceConfigurationService {

	readonly _serviceBrand: undefined;

	/**
	 * Event that fires when the configuration changes.
	 */
	onDidChangeConfiguration: Event<ITextResourceConfigurationChangeEvent>;

	/**
	 * Fetches the value of the section for the given resource by applying language overrides.
	 * Value can be of native type or an object keyed off the section name.
	 *
	 * @param resource - Resource for which the configuration has to be fetched.
	 * @param position - Position in the resource for which configuration has to be fetched.
	 * @param section - Section of the configuraion.
	 *
	 */
	getValue<T>(resource: URI | undefined, section?: string): T;
	getValue<T>(resource: URI | undefined, position?: IPosition, section?: string): T;

	/**
	 * Update the configuration value for the given resource at the effective location.
	 *
	 * - If configurationTarget is not specified, target will be derived by checking where the configuration is defined.
	 * - If the language overrides for the give resource contains the configuration, then it is updated.
	 *
	 * @param resource Resource for which the configuration has to be updated
	 * @param key Configuration key
	 * @param value Configuration value
	 * @param configurationTarget Optional target into which the configuration has to be updated.
	 * If not specified, target will be derived by checking where the configuration is defined.
	 */
	updateValue(resource: URI, key: string, value: any, configurationTarget?: ConfigurationTarget): Promise<void>;

}

export const ITextResourcePropertiesService = createDecorator<ITextResourcePropertiesService>('textResourcePropertiesService');

export interface ITextResourcePropertiesService {

	readonly _serviceBrand: undefined;

	/**
	 * Returns the End of Line characters for the given resource
	 */
	getEOL(resource: URI, language?: string): string;
}
