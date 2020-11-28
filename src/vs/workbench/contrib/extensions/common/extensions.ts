/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { IPager } from 'vs/base/common/paging';
import { IQueryOptions, ILocalExtension, IGalleryExtension, IExtensionIdentifier, InstallOptions } from 'vs/platform/extensionManagement/common/extensionManagement';
import { EnablementState, IExtensionManagementServer } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Disposable } from 'vs/base/common/lifecycle';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { IExtensionManifest, ExtensionType } from 'vs/platform/extensions/common/extensions';
import { URI } from 'vs/base/common/uri';
import { IViewPaneContainer } from 'vs/workbench/common/views';

export const VIEWLET_ID = 'workbench.view.extensions';

export interface IExtensionsViewPaneContainer extends IViewPaneContainer {
	search(text: string): void;
	refresh(): Promise<void>;
}

export const enum ExtensionState {
	Installing,
	Installed,
	Uninstalling,
	Uninstalled
}

export interface IExtension {
	readonly type: ExtensionType;
	readonly isBuiltin: boolean;
	readonly state: ExtensionState;
	readonly name: string;
	readonly displayName: string;
	readonly identifier: IExtensionIdentifier;
	readonly publisher: string;
	readonly publisherDisplayName: string;
	readonly version: string;
	readonly latestVersion: string;
	readonly description: string;
	readonly url?: string;
	readonly repository?: string;
	readonly iconUrl: string;
	readonly iconUrlFallback: string;
	readonly licenseUrl?: string;
	readonly installCount?: number;
	readonly rating?: number;
	readonly ratingCount?: number;
	readonly outdated: boolean;
	readonly enablementState: EnablementState;
	readonly dependencies: string[];
	readonly extensionPack: string[];
	readonly telemetryData: any;
	readonly preview: boolean;
	getManifest(token: CancellationToken): Promise<IExtensionManifest | null>;
	getReadme(token: CancellationToken): Promise<string>;
	hasReadme(): boolean;
	getChangelog(token: CancellationToken): Promise<string>;
	hasChangelog(): boolean;
	readonly server?: IExtensionManagementServer;
	readonly local?: ILocalExtension;
	gallery?: IGalleryExtension;
	readonly isMalicious: boolean;
}

export const SERVICE_ID = 'extensionsWorkbenchService';

export const IExtensionsWorkbenchService = createDecorator<IExtensionsWorkbenchService>(SERVICE_ID);

export interface IExtensionsWorkbenchService {
	readonly _serviceBrand: undefined;
	onChange: Event<IExtension | undefined>;
	local: IExtension[];
	installed: IExtension[];
	outdated: IExtension[];
	queryLocal(server?: IExtensionManagementServer): Promise<IExtension[]>;
	queryGallery(token: CancellationToken): Promise<IPager<IExtension>>;
	queryGallery(options: IQueryOptions, token: CancellationToken): Promise<IPager<IExtension>>;
	canInstall(extension: IExtension): boolean;
	install(vsix: URI): Promise<IExtension>;
	install(extension: IExtension, installOptins?: InstallOptions): Promise<IExtension>;
	uninstall(extension: IExtension): Promise<void>;
	installVersion(extension: IExtension, version: string): Promise<IExtension>;
	reinstall(extension: IExtension): Promise<IExtension>;
	setEnablement(extensions: IExtension | IExtension[], enablementState: EnablementState): Promise<void>;
	open(extension: IExtension, options?: { sideByside?: boolean, preserveFocus?: boolean, pinned?: boolean }): Promise<any>;
	checkForUpdates(): Promise<void>;

	// Sync APIs
	isExtensionIgnoredToSync(extension: IExtension): boolean;
	toggleExtensionIgnoredToSync(extension: IExtension): Promise<void>;
}

export const ConfigurationKey = 'extensions';
export const AutoUpdateConfigurationKey = 'extensions.autoUpdate';
export const AutoCheckUpdatesConfigurationKey = 'extensions.autoCheckUpdates';
export const CloseExtensionDetailsOnViewChangeKey = 'extensions.closeExtensionDetailsOnViewChange';

export interface IExtensionsConfiguration {
	autoUpdate: boolean;
	autoCheckUpdates: boolean;
	ignoreRecommendations: boolean;
	closeExtensionDetailsOnViewChange: boolean;
}

export interface IExtensionContainer {
	extension: IExtension | null;
	updateWhenCounterExtensionChanges?: boolean;
	update(): void;
}

export class ExtensionContainers extends Disposable {

	constructor(
		private readonly containers: IExtensionContainer[],
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService
	) {
		super();
		this._register(extensionsWorkbenchService.onChange(this.update, this));
	}

	set extension(extension: IExtension) {
		this.containers.forEach(c => c.extension = extension);
	}

	private update(extension: IExtension | undefined): void {
		for (const container of this.containers) {
			if (extension && container.extension) {
				if (areSameExtensions(container.extension.identifier, extension.identifier)) {
					if (!container.extension.server || !extension.server || container.extension.server === extension.server) {
						container.extension = extension;
					} else if (container.updateWhenCounterExtensionChanges) {
						container.update();
					}
				}
			} else {
				container.update();
			}
		}
	}
}

export const TOGGLE_IGNORE_EXTENSION_ACTION_ID = 'workbench.extensions.action.toggleIgnoreExtension';
export const INSTALL_EXTENSION_FROM_VSIX_COMMAND_ID = 'workbench.extensions.command.installFromVSIX';
