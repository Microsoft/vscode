/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { writeFile } from 'vs/base/node/pfs';
import product from 'vs/platform/product/common/product';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-browser/environmentService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationNode, IConfigurationRegistry, Extensions, IConfigurationPropertySchema } from 'vs/platform/configuration/common/configurationRegistry';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { ICommandService } from 'vs/platform/commands/common/commands';

interface IExportedConfigurationNode {
	name: string;
	description: string;
	default: any;
	type?: string | string[];
	enum?: any[];
	enumDescriptions?: string[];
}

interface IConfigurationExport {
	settings: IExportedConfigurationNode[];
	buildTime: number;
	commit?: string;
	buildNumber?: number;
}

export class DefaultConfigurationExportHelper {

	constructor(
		@IWorkbenchEnvironmentService environmentService: INativeWorkbenchEnvironmentService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@ICommandService private readonly commandService: ICommandService) {
		if (environmentService.args['export-default-configuration']) {
			this.writeConfigModelAndQuit(environmentService.args['export-default-configuration']);
		}
	}

	private writeConfigModelAndQuit(targetPath: string): Promise<void> {
		return Promise.resolve(this.extensionService.whenInstalledExtensionsRegistered())
			.then(() => this.writeConfigModel(targetPath))
			.finally(() => this.commandService.executeCommand('workbench.action.quit'))
			.then(() => { });
	}

	private writeConfigModel(targetPath: string): Promise<void> {
		const config = this.getConfigModel();

		const resultString = JSON.stringify(config, undefined, '  ');
		return writeFile(targetPath, resultString);
	}

	private getConfigModel(): IConfigurationExport {
		const configRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
		const configurations = configRegistry.getConfigurations().slice();
		const settings: IExportedConfigurationNode[] = [];
		const processedNames = new Set<string>();

		const processProperty = (name: string, prop: IConfigurationPropertySchema) => {
			if (processedNames.has(name)) {
				console.warn('Setting is registered twice: ' + name);
				return;
			}

			processedNames.add(name);
			const propDetails: IExportedConfigurationNode = {
				name,
				description: prop.description || prop.markdownDescription || '',
				default: prop.default,
				type: prop.type
			};

			if (prop.enum) {
				propDetails.enum = prop.enum;
			}

			if (prop.enumDescriptions || prop.markdownEnumDescriptions) {
				propDetails.enumDescriptions = prop.enumDescriptions || prop.markdownEnumDescriptions;
			}

			settings.push(propDetails);
		};

		const processConfig = (config: IConfigurationNode) => {
			if (config.properties) {
				for (let name in config.properties) {
					processProperty(name, config.properties[name]);
				}
			}

			if (config.allOf) {
				config.allOf.forEach(processConfig);
			}
		};

		configurations.forEach(processConfig);

		const excludedProps = configRegistry.getExcludedConfigurationProperties();
		for (let name in excludedProps) {
			processProperty(name, excludedProps[name]);
		}

		const result: IConfigurationExport = {
			settings: settings.sort((a, b) => a.name.localeCompare(b.name)),
			buildTime: Date.now(),
			commit: product.commit,
			buildNumber: product.settingsSearchBuildId
		};

		return result;
	}
}
