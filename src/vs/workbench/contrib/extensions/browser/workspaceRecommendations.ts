/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EXTENSION_IDENTIFIER_PATTERN, IExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { distinct, flatten } from 'vs/base/common/arrays';
import { ExtensionRecommendations, ExtensionRecommendation } from 'vs/workbench/contrib/extensions/browser/extensionRecommendations';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ExtensionRecommendationReason } from 'vs/workbench/services/extensionRecommendations/common/extensionRecommendations';
import { ILogService } from 'vs/platform/log/common/log';
import { CancellationToken } from 'vs/base/common/cancellation';
import { localize } from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { IExtensionsConfigContent, IWorkpsaceExtensionsConfigService } from 'vs/workbench/services/extensionRecommendations/common/workspaceExtensionsConfig';

export class WorkspaceRecommendations extends ExtensionRecommendations {

	private _recommendations: ExtensionRecommendation[] = [];
	get recommendations(): ReadonlyArray<ExtensionRecommendation> { return this._recommendations; }

	private _onDidChangeRecommendations = this._register(new Emitter<void>());
	readonly onDidChangeRecommendations = this._onDidChangeRecommendations.event;

	private _ignoredRecommendations: string[] = [];
	get ignoredRecommendations(): ReadonlyArray<string> { return this._ignoredRecommendations; }

	constructor(
		@IWorkpsaceExtensionsConfigService private readonly workpsaceExtensionsConfigService: IWorkpsaceExtensionsConfigService,
		@IExtensionGalleryService private readonly galleryService: IExtensionGalleryService,
		@ILogService private readonly logService: ILogService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
	}

	protected async doActivate(): Promise<void> {
		await this.fetch();
		this._register(this.workpsaceExtensionsConfigService.onDidChangeExtensionsConfigs(() => this.onDidChangeExtensionsConfigs()));
	}

	/**
	 * Parse all extensions.json files, fetch workspace recommendations, filter out invalid and unwanted ones
	 */
	private async fetch(): Promise<void> {

		const extensionsConfigs = await this.workpsaceExtensionsConfigService.getExtensionsConfigs();

		const { invalidRecommendations, message } = await this.validateExtensions(extensionsConfigs);
		if (invalidRecommendations.length) {
			this.notificationService.warn(`The ${invalidRecommendations.length} extension(s) below, in workspace recommendations have issues:\n${message}`);
		}

		this._recommendations = [];
		this._ignoredRecommendations = [];

		for (const extensionsConfig of extensionsConfigs) {
			if (extensionsConfig.unwantedRecommendations) {
				for (const unwantedRecommendation of extensionsConfig.unwantedRecommendations) {
					if (invalidRecommendations.indexOf(unwantedRecommendation) === -1) {
						this._ignoredRecommendations.push(unwantedRecommendation);
					}
				}
			}
			if (extensionsConfig.recommendations) {
				for (const extensionId of extensionsConfig.recommendations) {
					if (invalidRecommendations.indexOf(extensionId) === -1) {
						this._recommendations.push({
							extensionId,
							reason: {
								reasonId: ExtensionRecommendationReason.Workspace,
								reasonText: localize('workspaceRecommendation', "This extension is recommended by users of the current workspace.")
							}
						});
					}
				}
			}
		}
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

	private async onDidChangeExtensionsConfigs(): Promise<void> {
		await this.fetch();
		this._onDidChangeRecommendations.fire();
	}

}

