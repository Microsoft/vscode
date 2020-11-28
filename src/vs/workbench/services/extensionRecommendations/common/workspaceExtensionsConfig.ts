/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { distinct, flatten } from 'vs/base/common/arrays';
import { Emitter, Event } from 'vs/base/common/event';
import { parse } from 'vs/base/common/json';
import { Disposable } from 'vs/base/common/lifecycle';
import { getIconClasses } from 'vs/editor/common/services/getIconClasses';
import { FileKind, IFileService } from 'vs/platform/files/common/files';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IWorkspace, IWorkspaceContextService, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { IJSONEditingService, IJSONValue } from 'vs/workbench/services/configuration/common/jsonEditing';
import { ResourceMap } from 'vs/base/common/map';

export const EXTENSIONS_CONFIG = '.vscode/extensions.json';

export interface IExtensionsConfigContent {
	recommendations?: string[];
	unwantedRecommendations?: string[];
}

export const IWorkpsaceExtensionsConfigService = createDecorator<IWorkpsaceExtensionsConfigService>('IWorkpsaceExtensionsConfigService');

export interface IWorkpsaceExtensionsConfigService {
	readonly _serviceBrand: undefined;

	onDidChangeExtensionsConfigs: Event<void>;
	getExtensionsConfigs(): Promise<IExtensionsConfigContent[]>;
	getRecommendations(): Promise<string[]>;
	getUnwantedRecommendations(): Promise<string[]>;

	toggleRecommendation(extensionId: string): Promise<void>;
	toggleUnwantedRecommendation(extensionId: string): Promise<void>;
}

export class WorkspaceExtensionsConfigService extends Disposable implements IWorkpsaceExtensionsConfigService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeExtensionsConfigs = this._register(new Emitter<void>());
	readonly onDidChangeExtensionsConfigs = this._onDidChangeExtensionsConfigs.event;

	constructor(
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService,
		@IJSONEditingService private readonly jsonEditingService: IJSONEditingService,
	) {
		super();
		this._register(workspaceContextService.onDidChangeWorkspaceFolders(e => this._onDidChangeExtensionsConfigs.fire()));
		this._register(fileService.onDidFilesChange(e => {
			const workspace = workspaceContextService.getWorkspace();
			if ((workspace.configuration && e.affects(workspace.configuration))
				|| workspace.folders.some(folder => e.affects(folder.toResource(EXTENSIONS_CONFIG)))
			) {
				this._onDidChangeExtensionsConfigs.fire();
			}
		}));
	}

	async getExtensionsConfigs(): Promise<IExtensionsConfigContent[]> {
		const workspace = this.workspaceContextService.getWorkspace();
		const result: IExtensionsConfigContent[] = [];
		const workspaceExtensionsConfigContent = workspace.configuration ? await this.resolveWorkspaceExtensionConfig(workspace.configuration) : undefined;
		if (workspaceExtensionsConfigContent) {
			result.push(workspaceExtensionsConfigContent);
		}
		result.push(...await Promise.all(workspace.folders.map(workspaceFolder => this.resolveWorkspaceFolderExtensionConfig(workspaceFolder))));
		return result;
	}

	async getRecommendations(): Promise<string[]> {
		const configs = await this.getExtensionsConfigs();
		return distinct(flatten(configs.map(c => c.recommendations ? c.recommendations.map(c => c.toLowerCase()) : [])));
	}

	async getUnwantedRecommendations(): Promise<string[]> {
		const configs = await this.getExtensionsConfigs();
		return distinct(flatten(configs.map(c => c.unwantedRecommendations ? c.unwantedRecommendations.map(c => c.toLowerCase()) : [])));
	}

	async toggleRecommendation(extensionId: string): Promise<void> {
		const workspace = this.workspaceContextService.getWorkspace();
		const workspaceExtensionsConfigContent = workspace.configuration ? await this.resolveWorkspaceExtensionConfig(workspace.configuration) : undefined;
		const workspaceFolderExtensionsConfigContents = new ResourceMap<IExtensionsConfigContent>();
		await Promise.all(workspace.folders.map(async workspaceFolder => {
			const extensionsConfigContent = await this.resolveWorkspaceFolderExtensionConfig(workspaceFolder);
			workspaceFolderExtensionsConfigContents.set(workspaceFolder.uri, extensionsConfigContent);
		}));

		const isWorkspaceRecommended = workspaceExtensionsConfigContent && workspaceExtensionsConfigContent.recommendations?.some(r => r === extensionId);
		const recommendedWorksapceFolders = workspace.folders.filter(workspaceFolder => workspaceFolderExtensionsConfigContents.get(workspaceFolder.uri)?.recommendations?.some(r => r === extensionId));
		const isRecommended = isWorkspaceRecommended || recommendedWorksapceFolders.length > 0;

		const workspaceOrFolders = isRecommended
			? await this.pickWorkspaceOrFolders(recommendedWorksapceFolders, isWorkspaceRecommended ? workspace : undefined, localize('select for remove', "Remove extension recommendation from"))
			: await this.pickWorkspaceOrFolders(workspace.folders, workspace.configuration ? workspace : undefined, localize('select for add', "Add extension recommendation to"));

		for (const workspaceOrWorkspaceFolder of workspaceOrFolders) {
			if (IWorkspace.isIWorkspace(workspaceOrWorkspaceFolder)) {
				await this.addOrRemoveWorkspaceRecommendation(extensionId, workspaceOrWorkspaceFolder, workspaceExtensionsConfigContent, !isRecommended);
			} else {
				await this.addOrRemoveWorkspaceFolderRecommendation(extensionId, workspaceOrWorkspaceFolder, workspaceFolderExtensionsConfigContents.get(workspaceOrWorkspaceFolder.uri)!, !isRecommended);
			}
		}
	}

	async toggleUnwantedRecommendation(extensionId: string): Promise<void> {
		const workspace = this.workspaceContextService.getWorkspace();
		const workspaceExtensionsConfigContent = workspace.configuration ? await this.resolveWorkspaceExtensionConfig(workspace.configuration) : undefined;
		const workspaceFolderExtensionsConfigContents = new ResourceMap<IExtensionsConfigContent>();
		await Promise.all(workspace.folders.map(async workspaceFolder => {
			const extensionsConfigContent = await this.resolveWorkspaceFolderExtensionConfig(workspaceFolder);
			workspaceFolderExtensionsConfigContents.set(workspaceFolder.uri, extensionsConfigContent);
		}));

		const isWorkspaceUnwanted = workspaceExtensionsConfigContent && workspaceExtensionsConfigContent.unwantedRecommendations?.some(r => r === extensionId);
		const unWantedWorksapceFolders = workspace.folders.filter(workspaceFolder => workspaceFolderExtensionsConfigContents.get(workspaceFolder.uri)?.unwantedRecommendations?.some(r => r === extensionId));
		const isUnwanted = isWorkspaceUnwanted || unWantedWorksapceFolders.length > 0;

		const workspaceOrFolders = isUnwanted
			? await this.pickWorkspaceOrFolders(unWantedWorksapceFolders, isWorkspaceUnwanted ? workspace : undefined, localize('select for remove', "Remove extension recommendation from"))
			: await this.pickWorkspaceOrFolders(workspace.folders, workspace.configuration ? workspace : undefined, localize('select for add', "Add extension recommendation to"));

		for (const workspaceOrWorkspaceFolder of workspaceOrFolders) {
			if (IWorkspace.isIWorkspace(workspaceOrWorkspaceFolder)) {
				await this.addOrRemoveWorkspaceUnwantedRecommendation(extensionId, workspaceOrWorkspaceFolder, workspaceExtensionsConfigContent, !isUnwanted);
			} else {
				await this.addOrRemoveWorkspaceFolderUnwantedRecommendation(extensionId, workspaceOrWorkspaceFolder, workspaceFolderExtensionsConfigContents.get(workspaceOrWorkspaceFolder.uri)!, !isUnwanted);
			}
		}
	}

	private async addOrRemoveWorkspaceFolderRecommendation(extensionId: string, workspaceFolder: IWorkspaceFolder, extensionsConfigContent: IExtensionsConfigContent, add: boolean): Promise<void> {
		const values: IJSONValue[] = [];
		if (add) {
			values.push({ path: ['recommendations'], value: [...extensionsConfigContent.recommendations || [], extensionId] });
			if (extensionsConfigContent.unwantedRecommendations && extensionsConfigContent.unwantedRecommendations.some(e => e === extensionId)) {
				values.push({ path: ['unwantedRecommendations'], value: extensionsConfigContent.unwantedRecommendations.filter(e => e !== extensionId) });
			}
		} else if (extensionsConfigContent.recommendations) {
			values.push({ path: ['recommendations'], value: extensionsConfigContent.recommendations.filter(e => e !== extensionId) });
		}

		if (values.length) {
			return this.jsonEditingService.write(workspaceFolder.toResource(EXTENSIONS_CONFIG), values, true);
		}
	}

	private async addOrRemoveWorkspaceRecommendation(extensionId: string, workspace: IWorkspace, extensionsConfigContent: IExtensionsConfigContent | undefined, add: boolean): Promise<void> {
		const values: IJSONValue[] = [];
		if (extensionsConfigContent) {
			if (add) {
				values.push({ path: ['recommendations'], value: [...extensionsConfigContent.recommendations || [], extensionId] });
				if (extensionsConfigContent.unwantedRecommendations && extensionsConfigContent.unwantedRecommendations.some(e => e === extensionId)) {
					values.push({ path: ['unwantedRecommendations'], value: extensionsConfigContent.unwantedRecommendations.filter(e => e !== extensionId) });
				}
			} else if (extensionsConfigContent.recommendations) {
				values.push({ path: ['recommendations'], value: extensionsConfigContent.recommendations.filter(e => e !== extensionId) });
			}
		} else if (add) {
			values.push({ path: ['extensions'], value: { recommendations: [extensionId] } });
		}

		if (values.length) {
			return this.jsonEditingService.write(workspace.configuration!, values, true);
		}
	}

	private async addOrRemoveWorkspaceFolderUnwantedRecommendation(extensionId: string, workspaceFolder: IWorkspaceFolder, extensionsConfigContent: IExtensionsConfigContent, add: boolean): Promise<void> {
		const values: IJSONValue[] = [];
		if (add) {
			values.push({ path: ['unwantedRecommendations'], value: [...extensionsConfigContent.unwantedRecommendations || [], extensionId] });
			if (extensionsConfigContent.recommendations && extensionsConfigContent.recommendations.some(e => e === extensionId)) {
				values.push({ path: ['recommendations'], value: extensionsConfigContent.recommendations.filter(e => e !== extensionId) });
			}
		} else if (extensionsConfigContent.unwantedRecommendations) {
			values.push({ path: ['unwantedRecommendations'], value: extensionsConfigContent.unwantedRecommendations.filter(e => e !== extensionId) });
		}
		if (values.length) {
			return this.jsonEditingService.write(workspaceFolder.toResource(EXTENSIONS_CONFIG), values, true);
		}
	}

	private async addOrRemoveWorkspaceUnwantedRecommendation(extensionId: string, workspace: IWorkspace, extensionsConfigContent: IExtensionsConfigContent | undefined, add: boolean): Promise<void> {
		const values: IJSONValue[] = [];
		if (extensionsConfigContent) {
			if (add) {
				values.push({ path: ['unwantedRecommendations'], value: [...extensionsConfigContent.unwantedRecommendations || [], extensionId] });
				if (extensionsConfigContent.recommendations && extensionsConfigContent.recommendations.some(e => e === extensionId)) {
					values.push({ path: ['recommendations'], value: extensionsConfigContent.recommendations.filter(e => e !== extensionId) });
				}
			} else if (extensionsConfigContent.unwantedRecommendations) {
				values.push({ path: ['unwantedRecommendations'], value: extensionsConfigContent.unwantedRecommendations.filter(e => e !== extensionId) });
			}
		} else if (add) {
			values.push({ path: ['extensions'], value: { unwantedRecommendations: [extensionId] } });
		}

		if (values.length) {
			return this.jsonEditingService.write(workspace.configuration!, values, true);
		}
	}

	private async pickWorkspaceOrFolders(workspaceFolders: IWorkspaceFolder[], workspace: IWorkspace | undefined, placeHolder: string): Promise<(IWorkspace | IWorkspaceFolder)[]> {
		const workspaceOrFolders = workspace ? [...workspaceFolders, workspace] : [...workspaceFolders];
		if (workspaceOrFolders.length === 1) {
			return workspaceOrFolders;
		}

		const folderPicks: (IQuickPickItem & { workspaceOrFolder: IWorkspace | IWorkspaceFolder } | IQuickPickSeparator)[] = workspaceFolders.map(workspaceFolder => {
			return {
				label: workspaceFolder.name,
				description: localize('workspace folder', "Workspace Folder"),
				workspaceOrFolder: workspaceFolder,
				iconClasses: getIconClasses(this.modelService, this.modeService, workspaceFolder.uri, FileKind.ROOT_FOLDER)
			};
		});

		if (workspace) {
			folderPicks.push({ type: 'separator' });
			folderPicks.push({
				label: localize('workspace', "Workspace"),
				workspaceOrFolder: workspace,
			});
		}

		const result = await this.quickInputService.pick(folderPicks, { placeHolder, canPickMany: true }) || [];
		return result.map(r => r.workspaceOrFolder!);
	}

	private async resolveWorkspaceExtensionConfig(workspaceConfigurationResource: URI): Promise<IExtensionsConfigContent | undefined> {
		try {
			const content = await this.fileService.readFile(workspaceConfigurationResource);
			const extensionsConfigContent = <IExtensionsConfigContent | undefined>parse(content.value.toString())['extensions'];
			return extensionsConfigContent ? this.parseExtensionConfig(extensionsConfigContent) : undefined;
		} catch (e) { /* Ignore */ }
		return undefined;
	}

	private async resolveWorkspaceFolderExtensionConfig(workspaceFolder: IWorkspaceFolder): Promise<IExtensionsConfigContent> {
		try {
			const content = await this.fileService.readFile(workspaceFolder.toResource(EXTENSIONS_CONFIG));
			const extensionsConfigContent = <IExtensionsConfigContent>parse(content.value.toString());
			return this.parseExtensionConfig(extensionsConfigContent);
		} catch (e) { /* ignore */ }
		return {};
	}

	private parseExtensionConfig(extensionsConfigContent: IExtensionsConfigContent): IExtensionsConfigContent {
		return {
			recommendations: distinct((extensionsConfigContent.recommendations || []).map(e => e.toLowerCase())),
			unwantedRecommendations: distinct((extensionsConfigContent.unwantedRecommendations || []).map(e => e.toLowerCase()))
		};
	}

}

registerSingleton(IWorkpsaceExtensionsConfigService, WorkspaceExtensionsConfigService);
