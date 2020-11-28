/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionTipsService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IWorkspaceContextService, WorkbenchState, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { IFileService } from 'vs/platform/files/common/files';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { IWorkspaceTagsService } from 'vs/workbench/contrib/tags/common/workspaceTags';
import { isNumber } from 'vs/base/common/types';
import { ExtensionRecommendations, ExtensionRecommendation } from 'vs/workbench/contrib/extensions/browser/extensionRecommendations';
import { ExtensionRecommendationReason } from 'vs/workbench/services/extensionRecommendations/common/extensionRecommendations';
import { localize } from 'vs/nls';

type DynamicWorkspaceRecommendationsClassification = {
	count: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
	cache: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
};

type IStoredDynamicWorkspaceRecommendations = { recommendations: string[], timestamp: number };
const dynamicWorkspaceRecommendationsStorageKey = 'extensionsAssistant/dynamicWorkspaceRecommendations';
const milliSecondsInADay = 1000 * 60 * 60 * 24;

export class DynamicWorkspaceRecommendations extends ExtensionRecommendations {

	private _recommendations: ExtensionRecommendation[] = [];
	get recommendations(): ReadonlyArray<ExtensionRecommendation> { return this._recommendations; }

	constructor(
		@IExtensionTipsService private readonly extensionTipsService: IExtensionTipsService,
		@IWorkspaceTagsService private readonly workspaceTagsService: IWorkspaceTagsService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IFileService private readonly fileService: IFileService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
	}

	protected async doActivate(): Promise<void> {
		await this.fetch();
		this._register(this.contextService.onDidChangeWorkbenchState(() => this._recommendations = []));
	}

	/**
	 * Fetch extensions used by others on the same workspace as recommendations
	 */
	private async fetch(): Promise<void> {
		this._register(this.contextService.onDidChangeWorkbenchState(() => this._recommendations = []));

		if (this._recommendations.length
			|| this.contextService.getWorkbenchState() !== WorkbenchState.FOLDER
			|| !this.fileService.canHandleResource(this.contextService.getWorkspace().folders[0].uri)
		) {
			return;
		}

		const folder = this.contextService.getWorkspace().folders[0];
		const cachedDynamicWorkspaceRecommendations = this.getCachedDynamicWorkspaceRecommendations();
		if (cachedDynamicWorkspaceRecommendations) {
			this._recommendations = cachedDynamicWorkspaceRecommendations.map(id => this.toExtensionRecommendation(id, folder));
			this.telemetryService.publicLog2<{ count: number, cache: number }, DynamicWorkspaceRecommendationsClassification>('dynamicWorkspaceRecommendations', { count: this._recommendations.length, cache: 1 });
			return;
		}

		const [hashedRemotes1, hashedRemotes2] = await Promise.all([this.workspaceTagsService.getHashedRemotesFromUri(folder.uri, false), this.workspaceTagsService.getHashedRemotesFromUri(folder.uri, true)]);
		const hashedRemotes = (hashedRemotes1 || []).concat(hashedRemotes2 || []);
		if (!hashedRemotes.length) {
			return;
		}

		const workspacesTips = await this.extensionTipsService.getAllWorkspacesTips();
		if (!workspacesTips.length) {
			return;
		}

		for (const hashedRemote of hashedRemotes) {
			const workspaceTip = workspacesTips.filter(workspaceTip => isNonEmptyArray(workspaceTip.remoteSet) && workspaceTip.remoteSet.indexOf(hashedRemote) > -1)[0];
			if (workspaceTip) {
				this._recommendations = workspaceTip.recommendations.map(id => this.toExtensionRecommendation(id, folder));
				this.storageService.store(dynamicWorkspaceRecommendationsStorageKey, JSON.stringify(<IStoredDynamicWorkspaceRecommendations>{ recommendations: workspaceTip.recommendations, timestamp: Date.now() }), StorageScope.WORKSPACE, StorageTarget.MACHINE);
				this.telemetryService.publicLog2<{ count: number, cache: number }, DynamicWorkspaceRecommendationsClassification>('dynamicWorkspaceRecommendations', { count: this._recommendations.length, cache: 0 });
				return;
			}
		}
	}

	private getCachedDynamicWorkspaceRecommendations(): string[] | undefined {
		try {
			const storedDynamicWorkspaceRecommendations: IStoredDynamicWorkspaceRecommendations = JSON.parse(this.storageService.get(dynamicWorkspaceRecommendationsStorageKey, StorageScope.WORKSPACE, '{}'));
			if (isNonEmptyArray(storedDynamicWorkspaceRecommendations.recommendations)
				&& isNumber(storedDynamicWorkspaceRecommendations.timestamp)
				&& storedDynamicWorkspaceRecommendations.timestamp > 0
				&& (Date.now() - storedDynamicWorkspaceRecommendations.timestamp) / milliSecondsInADay < 14) {
				return storedDynamicWorkspaceRecommendations.recommendations;
			}
		} catch (e) {
			this.storageService.remove(dynamicWorkspaceRecommendationsStorageKey, StorageScope.WORKSPACE);
		}
		return undefined;
	}

	private toExtensionRecommendation(extensionId: string, folder: IWorkspaceFolder): ExtensionRecommendation {
		return {
			extensionId: extensionId.toLowerCase(),
			reason: {
				reasonId: ExtensionRecommendationReason.DynamicWorkspace,
				reasonText: localize('dynamicWorkspaceRecommendation', "This extension may interest you because it's popular among users of the {0} repository.", folder.name)
			}
		};
	}
}

