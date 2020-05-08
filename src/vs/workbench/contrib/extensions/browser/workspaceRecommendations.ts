/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EXTENSION_IDENTIFIER_PATTERN, IExtensionGalleryService, IExtensionManagementService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IWorkspaceContextService, IWorkspaceFolder, IWorkspace, IWorkspaceFoldersChangeEvent } from 'vs/platform/workspace/common/workspace';
import { IFileService } from 'vs/platform/files/common/files';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { distinct, flatten, coalesce } from 'vs/base/common/arrays';
import { ExtensionRecommendations, ExtensionRecommendation } from 'vs/workbench/contrib/extensions/browser/extensionRecommendations';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IExtensionsConfigContent, ExtensionRecommendationSource, ExtensionRecommendationReason, IWorkbenchExtensionEnablementService, EnablementState } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { parse } from 'vs/base/common/json';
import { EXTENSIONS_CONFIG } from 'vs/workbench/contrib/extensions/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';
import { CancellationToken } from 'vs/base/common/cancellation';
import { localize } from 'vs/nls';
import { ExtensionType } from 'vs/platform/extensions/common/extensions';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { InstallWorkspaceRecommendedExtensionsAction, ShowRecommendedExtensionsAction } from 'vs/workbench/contrib/extensions/browser/extensionsActions';
import { StorageScope, IStorageService } from 'vs/platform/storage/common/storage';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IStorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';

type ExtensionWorkspaceRecommendationsNotificationClassification = {
	userReaction: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
};

const choiceNever = localize('neverShowAgain', "Don't Show Again");
const ignoreWorkspaceRecommendationsStorageKey = 'extensionsAssistant/workspaceRecommendationsIgnore';

export class WorkspaceRecommendations extends ExtensionRecommendations {

	private _recommendations: ExtensionRecommendation[] = [];
	get recommendations(): ReadonlyArray<ExtensionRecommendation> { return this._recommendations; }

	private _ignoredRecommendations: string[] = [];
	get ignoredRecommendations(): ReadonlyArray<string> { return this._ignoredRecommendations; }

	constructor(
		isExtensionAllowedToBeRecommended: (extensionId: string) => boolean,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IExtensionGalleryService private readonly galleryService: IExtensionGalleryService,
		@ILogService private readonly logService: ILogService,
		@IFileService private readonly fileService: IFileService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@INotificationService notificationService: INotificationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IStorageService storageService: IStorageService,
		@IStorageKeysSyncRegistryService storageKeysSyncRegistryService: IStorageKeysSyncRegistryService,
	) {
		super(isExtensionAllowedToBeRecommended, instantiationService, configurationService, notificationService, telemetryService, storageService, storageKeysSyncRegistryService);
	}

	protected async doActivate(): Promise<void> {
		await this.fetch();
		this._register(this.contextService.onDidChangeWorkspaceFolders(e => this.onWorkspaceFoldersChanged(e)));
		this.promptWorkspaceRecommendations();
	}

	/**
	 * Parse all extensions.json files, fetch workspace recommendations, filter out invalid and unwanted ones
	 */
	private async fetch(): Promise<void> {

		const extensionsConfigBySource = await this.fetchExtensionsConfigBySource();

		const { invalidRecommendations, message } = await this.validateExtensions(extensionsConfigBySource.map(({ contents }) => contents));
		if (invalidRecommendations.length) {
			this.notificationService.warn(`The below ${invalidRecommendations.length} extension(s) in workspace recommendations have issues:\n${message}`);
		}

		this._ignoredRecommendations = [];

		for (const extensionsConfig of extensionsConfigBySource) {
			for (const unwantedRecommendation of extensionsConfig.contents.unwantedRecommendations) {
				if (invalidRecommendations.indexOf(unwantedRecommendation) === -1) {
					this._ignoredRecommendations.push(unwantedRecommendation);
				}
			}
			for (const extensionId of extensionsConfig.contents.recommendations) {
				if (invalidRecommendations.indexOf(extensionId) === -1) {
					this._recommendations.push({
						extensionId,
						source: extensionsConfig.source,
						reason: {
							reasonId: ExtensionRecommendationReason.Workspace,
							reasonText: localize('workspaceRecommendation', "This extension is recommended by users of the current workspace.")
						}
					});
				}
			}
		}
	}

	private async promptWorkspaceRecommendations(): Promise<void> {
		const allowedRecommendations = this.recommendations.filter(rec => this.isExtensionAllowedToBeRecommended(rec.extensionId));

		if (allowedRecommendations.length === 0 || this.hasToIgnoreWorkspaceRecommendationNotifications()) {
			return;
		}

		let installed = await this.extensionManagementService.getInstalled(ExtensionType.User);
		installed = installed.filter(l => this.extensionEnablementService.getEnablementState(l) !== EnablementState.DisabledByExtensionKind); // Filter extensions disabled by kind
		const recommendations = allowedRecommendations.filter(({ extensionId }) => installed.every(local => !areSameExtensions({ id: extensionId }, local.identifier)));

		if (!recommendations.length) {
			return;
		}

		return new Promise<void>(c => {
			this.notificationService.prompt(
				Severity.Info,
				localize('workspaceRecommended', "This workspace has extension recommendations."),
				[{
					label: localize('installAll', "Install All"),
					run: () => {
						this.telemetryService.publicLog2<{ userReaction: string }, ExtensionWorkspaceRecommendationsNotificationClassification>('extensionWorkspaceRecommendations:popup', { userReaction: 'install' });
						const installAllAction = this.instantiationService.createInstance(InstallWorkspaceRecommendedExtensionsAction, InstallWorkspaceRecommendedExtensionsAction.ID, localize('installAll', "Install All"), recommendations.map(({ extensionId }) => extensionId));
						installAllAction.run();
						installAllAction.dispose();
						c(undefined);
					}
				}, {
					label: localize('showRecommendations', "Show Recommendations"),
					run: () => {
						this.telemetryService.publicLog2<{ userReaction: string }, ExtensionWorkspaceRecommendationsNotificationClassification>('extensionWorkspaceRecommendations:popup', { userReaction: 'show' });
						const showAction = this.instantiationService.createInstance(ShowRecommendedExtensionsAction, ShowRecommendedExtensionsAction.ID, localize('showRecommendations', "Show Recommendations"));
						showAction.run();
						showAction.dispose();
						c(undefined);
					}
				}, {
					label: choiceNever,
					isSecondary: true,
					run: () => {
						this.telemetryService.publicLog2<{ userReaction: string }, ExtensionWorkspaceRecommendationsNotificationClassification>('extensionWorkspaceRecommendations:popup', { userReaction: 'neverShowAgain' });
						this.storageService.store(ignoreWorkspaceRecommendationsStorageKey, true, StorageScope.WORKSPACE);
						c(undefined);
					}
				}],
				{
					sticky: true,
					onCancel: () => {
						this.telemetryService.publicLog2<{ userReaction: string }, ExtensionWorkspaceRecommendationsNotificationClassification>('extensionWorkspaceRecommendations:popup', { userReaction: 'cancelled' });
						c(undefined);
					}
				}
			);
		});
	}

	private async fetchExtensionsConfigBySource(): Promise<{ contents: IExtensionsConfigContent, source: ExtensionRecommendationSource }[]> {
		const workspace = this.contextService.getWorkspace();
		const result = await Promise.all([
			this.resolveWorkspaceExtensionConfig(workspace),
			...workspace.folders.map(workspaceFolder => this.resolveWorkspaceFolderExtensionConfig(workspaceFolder))
		]);
		return coalesce(result);
	}

	private async resolveWorkspaceExtensionConfig(workspace: IWorkspace): Promise<{ contents: IExtensionsConfigContent, source: ExtensionRecommendationSource } | null> {
		try {
			if (workspace.configuration) {
				const content = await this.fileService.readFile(workspace.configuration);
				const extensionsConfigContent = <IExtensionsConfigContent | undefined>parse(content.value.toString())['extensions'];
				const contents = this.parseExtensionConfig(extensionsConfigContent);
				if (contents) {
					return { contents, source: workspace };
				}
			}
		} catch (e) { /* Ignore */ }
		return null;
	}

	private async resolveWorkspaceFolderExtensionConfig(workspaceFolder: IWorkspaceFolder): Promise<{ contents: IExtensionsConfigContent, source: ExtensionRecommendationSource } | null> {
		try {
			const content = await this.fileService.readFile(workspaceFolder.toResource(EXTENSIONS_CONFIG));
			const extensionsConfigContent = <IExtensionsConfigContent>parse(content.value.toString());
			const contents = this.parseExtensionConfig(extensionsConfigContent);
			if (contents) {
				return { contents, source: workspaceFolder };
			}
		} catch (e) { /* ignore */ }
		return null;
	}

	private async validateExtensions(contents: IExtensionsConfigContent[]): Promise<{ validRecommendations: string[], invalidRecommendations: string[], message: string }> {

		const validExtensions: string[] = [];
		const invalidExtensions: string[] = [];
		const extensionsToQuery: string[] = [];
		let message = '';

		const allRecommendations = distinct(flatten(contents.map(({ recommendations }) => recommendations || [])));
		const regEx = new RegExp(EXTENSION_IDENTIFIER_PATTERN);
		for (const extensionId of allRecommendations) {
			if (regEx.test(extensionId)) {
				extensionsToQuery.push(extensionId);
			} else {
				invalidExtensions.push(extensionId);
				message += `${extensionId} (bad format) Expected: <provider>.<name>\n`;
			}
		}

		if (extensionsToQuery.length) {
			try {
				const queryResult = await this.galleryService.query({ names: extensionsToQuery, pageSize: extensionsToQuery.length }, CancellationToken.None);
				const extensions = queryResult.firstPage.map(extension => extension.identifier.id.toLowerCase());

				for (const extensionId of extensionsToQuery) {
					if (extensions.indexOf(extensionId) === -1) {
						invalidExtensions.push(extensionId);
						message += `${extensionId} (not found in marketplace)\n`;
					} else {
						validExtensions.push(extensionId);
					}
				}

			} catch (e) {
				this.logService.warn('Error querying extensions gallery', e);
			}
		}

		return { validRecommendations: validExtensions, invalidRecommendations: invalidExtensions, message };
	}

	private async onWorkspaceFoldersChanged(event: IWorkspaceFoldersChangeEvent): Promise<void> {
		if (event.added.length) {
			const oldWorkspaceRecommended = this._recommendations;
			await this.fetch();
			// Suggest only if at least one of the newly added recommendations was not suggested before
			if (this._recommendations.some(current => oldWorkspaceRecommended.every(old => current.extensionId !== old.extensionId))) {
				this.promptWorkspaceRecommendations();
			}
		}
	}

	private parseExtensionConfig(extensionsConfigContent: IExtensionsConfigContent | undefined): IExtensionsConfigContent | null {
		if (extensionsConfigContent) {
			return {
				recommendations: distinct((extensionsConfigContent.recommendations || []).map(e => e.toLowerCase())),
				unwantedRecommendations: distinct((extensionsConfigContent.unwantedRecommendations || []).map(e => e.toLowerCase()))
			};
		}
		return null;
	}

	private hasToIgnoreWorkspaceRecommendationNotifications(): boolean {
		return this.hasToIgnoreRecommendationNotifications() || this.storageService.getBoolean(ignoreWorkspaceRecommendationsStorageKey, StorageScope.WORKSPACE, false);
	}
}

