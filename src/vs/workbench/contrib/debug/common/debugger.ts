/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { isObject } from 'vs/base/common/types';
import { IJSONSchema, IJSONSchemaMap, IJSONSchemaSnippet } from 'vs/base/common/jsonSchema';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { IConfig, IDebuggerContribution, IDebugAdapter, IDebugger, IDebugSession, IAdapterManager, IDebugService } from 'vs/workbench/contrib/debug/common/debug';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import * as ConfigurationResolverUtils from 'vs/workbench/services/configurationResolver/common/configurationResolverUtils';
import { ITextResourcePropertiesService } from 'vs/editor/common/services/textResourceConfigurationService';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { isDebuggerMainContribution } from 'vs/workbench/contrib/debug/common/debugUtils';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ITelemetryEndpoint } from 'vs/platform/telemetry/common/telemetry';
import { cleanRemoteAuthority } from 'vs/platform/telemetry/common/telemetryUtils';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';

export class Debugger implements IDebugger {

	private debuggerContribution: IDebuggerContribution;
	private mergedExtensionDescriptions: IExtensionDescription[] = [];
	private mainExtensionDescription: IExtensionDescription | undefined;

	constructor(
		private adapterManager: IAdapterManager,
		dbgContribution: IDebuggerContribution,
		extensionDescription: IExtensionDescription,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITextResourcePropertiesService private readonly resourcePropertiesService: ITextResourcePropertiesService,
		@IConfigurationResolverService private readonly configurationResolverService: IConfigurationResolverService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IDebugService private readonly debugService: IDebugService
	) {
		this.debuggerContribution = { type: dbgContribution.type };
		this.merge(dbgContribution, extensionDescription);
	}

	merge(otherDebuggerContribution: IDebuggerContribution, extensionDescription: IExtensionDescription): void {

		/**
		 * Copies all properties of source into destination. The optional parameter "overwrite" allows to control
		 * if existing non-structured properties on the destination should be overwritten or not. Defaults to true (overwrite).
		 */
		function mixin(destination: any, source: any, overwrite: boolean, level = 0): any {

			if (!isObject(destination)) {
				return source;
			}

			if (isObject(source)) {
				Object.keys(source).forEach(key => {
					if (key !== '__proto__') {
						if (isObject(destination[key]) && isObject(source[key])) {
							mixin(destination[key], source[key], overwrite, level + 1);
						} else {
							if (key in destination) {
								if (overwrite) {
									if (level === 0 && key === 'type') {
										// don't merge the 'type' property
									} else {
										destination[key] = source[key];
									}
								}
							} else {
								destination[key] = source[key];
							}
						}
					}
				});
			}

			return destination;
		}

		// only if not already merged
		if (this.mergedExtensionDescriptions.indexOf(extensionDescription) < 0) {

			// remember all extensions that have been merged for this debugger
			this.mergedExtensionDescriptions.push(extensionDescription);

			// merge new debugger contribution into existing contributions (and don't overwrite values in built-in extensions)
			mixin(this.debuggerContribution, otherDebuggerContribution, extensionDescription.isBuiltin);

			// remember the extension that is considered the "main" debugger contribution
			if (isDebuggerMainContribution(otherDebuggerContribution)) {
				this.mainExtensionDescription = extensionDescription;
			}
		}
	}

	createDebugAdapter(session: IDebugSession): Promise<IDebugAdapter> {
		return this.adapterManager.activateDebuggers('onDebugAdapterProtocolTracker', this.type).then(_ => {
			const da = this.adapterManager.createDebugAdapter(session);
			if (da) {
				return Promise.resolve(da);
			}
			throw new Error(nls.localize('cannot.find.da', "Cannot find debug adapter for type '{0}'.", this.type));
		});
	}

	substituteVariables(folder: IWorkspaceFolder | undefined, config: IConfig): Promise<IConfig> {
		return this.adapterManager.substituteVariables(this.type, folder, config).then(config => {
			return this.configurationResolverService.resolveWithInteractionReplace(folder, config, 'launch', this.variables, config.__configurationTarget);
		});
	}

	runInTerminal(args: DebugProtocol.RunInTerminalRequestArguments, sessionId: string): Promise<number | undefined> {
		return this.adapterManager.runInTerminal(this.type, args, sessionId);
	}

	get label(): string {
		return this.debuggerContribution.label || this.debuggerContribution.type;
	}

	get type(): string {
		return this.debuggerContribution.type;
	}

	get variables(): { [key: string]: string } | undefined {
		return this.debuggerContribution.variables;
	}

	get configurationSnippets(): IJSONSchemaSnippet[] | undefined {
		return this.debuggerContribution.configurationSnippets;
	}

	get languages(): string[] | undefined {
		return this.debuggerContribution.languages;
	}

	hasInitialConfiguration(): boolean {
		return !!this.debuggerContribution.initialConfigurations;
	}

	hasConfigurationProvider(): boolean {
		return this.debugService.getConfigurationManager().hasDebugConfigurationProvider(this.type);
	}

	getInitialConfigurationContent(initialConfigs?: IConfig[]): Promise<string> {
		// at this point we got some configs from the package.json and/or from registered DebugConfigurationProviders
		let initialConfigurations = this.debuggerContribution.initialConfigurations || [];
		if (initialConfigs) {
			initialConfigurations = initialConfigurations.concat(initialConfigs);
		}

		const eol = this.resourcePropertiesService.getEOL(URI.from({ scheme: Schemas.untitled, path: '1' })) === '\r\n' ? '\r\n' : '\n';
		const configs = JSON.stringify(initialConfigurations, null, '\t').split('\n').map(line => '\t' + line).join(eol).trim();
		const comment1 = nls.localize('launch.config.comment1', "Use IntelliSense to learn about possible attributes.");
		const comment2 = nls.localize('launch.config.comment2', "Hover to view descriptions of existing attributes.");
		const comment3 = nls.localize('launch.config.comment3', "For more information, visit: {0}", 'https://go.microsoft.com/fwlink/?linkid=830387');

		let content = [
			'{',
			`\t// ${comment1}`,
			`\t// ${comment2}`,
			`\t// ${comment3}`,
			`\t"version": "0.2.0",`,
			`\t"configurations": ${configs}`,
			'}'
		].join(eol);

		// fix formatting
		const editorConfig = this.configurationService.getValue<any>();
		if (editorConfig.editor && editorConfig.editor.insertSpaces) {
			content = content.replace(new RegExp('\t', 'g'), ' '.repeat(editorConfig.editor.tabSize));
		}

		return Promise.resolve(content);
	}

	getMainExtensionDescriptor(): IExtensionDescription {
		return this.mainExtensionDescription || this.mergedExtensionDescriptions[0];
	}

	getCustomTelemetryEndpoint(): ITelemetryEndpoint | undefined {
		const aiKey = this.debuggerContribution.aiKey;
		if (!aiKey) {
			return undefined;
		}

		const sendErrorTelemtry = cleanRemoteAuthority(this.environmentService.remoteAuthority) !== 'other';
		return {
			id: `${this.getMainExtensionDescriptor().publisher}.${this.type}`,
			aiKey,
			sendErrorTelemetry: sendErrorTelemtry
		};
	}

	getSchemaAttributes(definitions: IJSONSchemaMap): IJSONSchema[] | null {

		if (!this.debuggerContribution.configurationAttributes) {
			return null;
		}

		// fill in the default configuration attributes shared by all adapters.
		return Object.keys(this.debuggerContribution.configurationAttributes).map(request => {
			const definitionId = `${this.type}:${request}`;
			const attributes: IJSONSchema = this.debuggerContribution.configurationAttributes[request];
			const defaultRequired = ['name', 'type', 'request'];
			attributes.required = attributes.required && attributes.required.length ? defaultRequired.concat(attributes.required) : defaultRequired;
			attributes.additionalProperties = false;
			attributes.type = 'object';
			if (!attributes.properties) {
				attributes.properties = {};
			}
			const properties = attributes.properties;
			properties['type'] = {
				enum: [this.type],
				description: nls.localize('debugType', "Type of configuration."),
				pattern: '^(?!node2)',
				errorMessage: nls.localize('debugTypeNotRecognised', "The debug type is not recognized. Make sure that you have a corresponding debug extension installed and that it is enabled."),
				patternErrorMessage: nls.localize('node2NotSupported', "\"node2\" is no longer supported, use \"node\" instead and set the \"protocol\" attribute to \"inspector\".")
			};
			properties['request'] = {
				enum: [request],
				description: nls.localize('debugRequest', "Request type of configuration. Can be \"launch\" or \"attach\"."),
			};
			for (const prop in definitions['common'].properties) {
				properties[prop] = {
					$ref: `#/definitions/common/properties/${prop}`
				};
			}
			definitions[definitionId] = attributes;

			Object.keys(properties).forEach(name => {
				// Use schema allOf property to get independent error reporting #21113
				ConfigurationResolverUtils.applyDeprecatedVariableMessage(properties[name]);
			});

			const result = {
				allOf: [{
					$ref: `#/definitions/${definitionId}`
				}, {
					properties: {
						windows: {
							$ref: `#/definitions/${definitionId}`,
							description: nls.localize('debugWindowsConfiguration', "Windows specific launch configuration attributes.")
						},
						osx: {
							$ref: `#/definitions/${definitionId}`,
							description: nls.localize('debugOSXConfiguration', "OS X specific launch configuration attributes.")
						},
						linux: {
							$ref: `#/definitions/${definitionId}`,
							description: nls.localize('debugLinuxConfiguration', "Linux specific launch configuration attributes.")
						}
					}
				}]
			};

			return result;
		});
	}
}
