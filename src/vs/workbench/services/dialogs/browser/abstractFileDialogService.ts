/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IWindowOpenable, isWorkspaceToOpen, isFileToOpen } from 'vs/platform/windows/common/windows';
import { IPickAndOpenOptions, ISaveDialogOptions, IOpenDialogOptions, FileFilter, IFileDialogService, IDialogService, ConfirmResult, getFileNamesMessage } from 'vs/platform/dialogs/common/dialogs';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { URI } from 'vs/base/common/uri';
import * as resources from 'vs/base/common/resources';
import { IInstantiationService, } from 'vs/platform/instantiation/common/instantiation';
import { SimpleFileDialog } from 'vs/workbench/services/dialogs/browser/simpleFileDialog';
import { WORKSPACE_EXTENSION, isUntitledWorkspace, IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IFileService } from 'vs/platform/files/common/files';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import Severity from 'vs/base/common/severity';
import { coalesce, distinct } from 'vs/base/common/arrays';
import { compareIgnoreCase, trim } from 'vs/base/common/strings';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ILabelService } from 'vs/platform/label/common/label';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { Schemas } from 'vs/base/common/network';
import { PLAINTEXT_EXTENSION } from 'vs/editor/common/modes/modesRegistry';

export abstract class AbstractFileDialogService implements IFileDialogService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IHostService protected readonly hostService: IHostService,
		@IWorkspaceContextService protected readonly contextService: IWorkspaceContextService,
		@IHistoryService protected readonly historyService: IHistoryService,
		@IWorkbenchEnvironmentService protected readonly environmentService: IWorkbenchEnvironmentService,
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IConfigurationService protected readonly configurationService: IConfigurationService,
		@IFileService protected readonly fileService: IFileService,
		@IOpenerService protected readonly openerService: IOpenerService,
		@IDialogService private readonly dialogService: IDialogService,
		@IModeService private readonly modeService: IModeService,
		@IWorkspacesService private readonly workspacesService: IWorkspacesService,
		@ILabelService private readonly labelService: ILabelService,
		@IPathService private readonly pathService: IPathService
	) { }

	async defaultFilePath(schemeFilter = this.getSchemeFilterForWindow()): Promise<URI> {

		// Check for last active file first...
		let candidate = this.historyService.getLastActiveFile(schemeFilter);

		// ...then for last active file root
		if (!candidate) {
			candidate = this.historyService.getLastActiveWorkspaceRoot(schemeFilter);
		} else {
			candidate = candidate && resources.dirname(candidate);
		}

		if (!candidate) {
			candidate = await this.pathService.userHome({ preferLocal: schemeFilter === Schemas.file });
		}

		return candidate;
	}

	async defaultFolderPath(schemeFilter = this.getSchemeFilterForWindow()): Promise<URI> {

		// Check for last active file root first...
		let candidate = this.historyService.getLastActiveWorkspaceRoot(schemeFilter);

		// ...then for last active file
		if (!candidate) {
			candidate = this.historyService.getLastActiveFile(schemeFilter);
		}

		if (!candidate) {
			return this.pathService.userHome({ preferLocal: schemeFilter === Schemas.file });
		} else {
			return resources.dirname(candidate);
		}
	}

	async defaultWorkspacePath(schemeFilter = this.getSchemeFilterForWindow(), filename?: string): Promise<URI> {
		let defaultWorkspacePath: URI | undefined;
		// Check for current workspace config file first...
		if (this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE) {
			const configuration = this.contextService.getWorkspace().configuration;
			if (configuration && configuration.scheme === schemeFilter && !isUntitledWorkspace(configuration, this.environmentService)) {
				defaultWorkspacePath = resources.dirname(configuration) || undefined;
			}
		}

		// ...then fallback to default file path
		if (!defaultWorkspacePath) {
			defaultWorkspacePath = await this.defaultFilePath(schemeFilter);
		}

		if (defaultWorkspacePath && filename) {
			defaultWorkspacePath = resources.joinPath(defaultWorkspacePath, filename);
		}

		return defaultWorkspacePath;
	}

	async showSaveConfirm(fileNamesOrResources: (string | URI)[]): Promise<ConfirmResult> {
		if (this.environmentService.isExtensionDevelopment && this.environmentService.extensionTestsLocationURI) {
			return ConfirmResult.DONT_SAVE; // no veto when we are in extension dev testing mode because we cannot assume we run interactive
		}

		return this.doShowSaveConfirm(fileNamesOrResources);
	}

	protected async doShowSaveConfirm(fileNamesOrResources: (string | URI)[]): Promise<ConfirmResult> {
		if (fileNamesOrResources.length === 0) {
			return ConfirmResult.DONT_SAVE;
		}

		let message: string;
		let detail = nls.localize('saveChangesDetail', "Your changes will be lost if you don't save them.");
		if (fileNamesOrResources.length === 1) {
			message = nls.localize('saveChangesMessage', "Do you want to save the changes you made to {0}?", typeof fileNamesOrResources[0] === 'string' ? fileNamesOrResources[0] : resources.basename(fileNamesOrResources[0]));
		} else {
			message = nls.localize('saveChangesMessages', "Do you want to save the changes to the following {0} files?", fileNamesOrResources.length);
			detail = getFileNamesMessage(fileNamesOrResources) + '\n' + detail;
		}

		const buttons: string[] = [
			fileNamesOrResources.length > 1 ? nls.localize({ key: 'saveAll', comment: ['&& denotes a mnemonic'] }, "&&Save All") : nls.localize({ key: 'save', comment: ['&& denotes a mnemonic'] }, "&&Save"),
			nls.localize({ key: 'dontSave', comment: ['&& denotes a mnemonic'] }, "Do&&n't Save"),
			nls.localize('cancel', "Cancel")
		];

		const { choice } = await this.dialogService.show(Severity.Warning, message, buttons, {
			cancelId: 2,
			detail
		});

		switch (choice) {
			case 0: return ConfirmResult.SAVE;
			case 1: return ConfirmResult.DONT_SAVE;
			default: return ConfirmResult.CANCEL;
		}
	}

	protected abstract addFileSchemaIfNeeded(schema: string): string[];

	protected async pickFileFolderAndOpenSimplified(schema: string, options: IPickAndOpenOptions, preferNewWindow: boolean): Promise<any> {
		const title = nls.localize('openFileOrFolder.title', 'Open File Or Folder');
		const availableFileSystems = this.addFileSchemaIfNeeded(schema);

		const uri = await this.pickResource({ canSelectFiles: true, canSelectFolders: true, canSelectMany: false, defaultUri: options.defaultUri, title, availableFileSystems });

		if (uri) {
			const stat = await this.fileService.resolve(uri);

			const toOpen: IWindowOpenable = stat.isDirectory ? { folderUri: uri } : { fileUri: uri };
			if (!isWorkspaceToOpen(toOpen) && isFileToOpen(toOpen)) {
				// add the picked file into the list of recently opened
				this.workspacesService.addRecentlyOpened([{ fileUri: toOpen.fileUri, label: this.labelService.getUriLabel(toOpen.fileUri) }]);
			}

			if (stat.isDirectory || options.forceNewWindow || preferNewWindow) {
				return this.hostService.openWindow([toOpen], { forceNewWindow: options.forceNewWindow, remoteAuthority: options.remoteAuthority });
			} else {
				return this.openerService.open(uri, { fromUserGesture: true, editorOptions: { pinned: true } });
			}
		}
	}

	protected async pickFileAndOpenSimplified(schema: string, options: IPickAndOpenOptions, preferNewWindow: boolean): Promise<any> {
		const title = nls.localize('openFile.title', 'Open File');
		const availableFileSystems = this.addFileSchemaIfNeeded(schema);

		const uri = await this.pickResource({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, defaultUri: options.defaultUri, title, availableFileSystems });
		if (uri) {
			// add the picked file into the list of recently opened
			this.workspacesService.addRecentlyOpened([{ fileUri: uri, label: this.labelService.getUriLabel(uri) }]);

			if (options.forceNewWindow || preferNewWindow) {
				return this.hostService.openWindow([{ fileUri: uri }], { forceNewWindow: options.forceNewWindow, remoteAuthority: options.remoteAuthority });
			} else {
				return this.openerService.open(uri, { fromUserGesture: true, editorOptions: { pinned: true } });
			}
		}
	}

	protected async pickFolderAndOpenSimplified(schema: string, options: IPickAndOpenOptions): Promise<any> {
		const title = nls.localize('openFolder.title', 'Open Folder');
		const availableFileSystems = this.addFileSchemaIfNeeded(schema);

		const uri = await this.pickResource({ canSelectFiles: false, canSelectFolders: true, canSelectMany: false, defaultUri: options.defaultUri, title, availableFileSystems });
		if (uri) {
			return this.hostService.openWindow([{ folderUri: uri }], { forceNewWindow: options.forceNewWindow, remoteAuthority: options.remoteAuthority });
		}
	}

	protected async pickWorkspaceAndOpenSimplified(schema: string, options: IPickAndOpenOptions): Promise<any> {
		const title = nls.localize('openWorkspace.title', 'Open Workspace');
		const filters: FileFilter[] = [{ name: nls.localize('filterName.workspace', 'Workspace'), extensions: [WORKSPACE_EXTENSION] }];
		const availableFileSystems = this.addFileSchemaIfNeeded(schema);

		const uri = await this.pickResource({ canSelectFiles: true, canSelectFolders: false, canSelectMany: false, defaultUri: options.defaultUri, title, filters, availableFileSystems });
		if (uri) {
			return this.hostService.openWindow([{ workspaceUri: uri }], { forceNewWindow: options.forceNewWindow, remoteAuthority: options.remoteAuthority });
		}
	}

	protected async pickFileToSaveSimplified(schema: string, options: ISaveDialogOptions): Promise<URI | undefined> {
		if (!options.availableFileSystems) {
			options.availableFileSystems = this.addFileSchemaIfNeeded(schema);
		}

		options.title = nls.localize('saveFileAs.title', 'Save As');
		return this.saveRemoteResource(options);
	}

	protected async showSaveDialogSimplified(schema: string, options: ISaveDialogOptions): Promise<URI | undefined> {
		if (!options.availableFileSystems) {
			options.availableFileSystems = this.addFileSchemaIfNeeded(schema);
		}

		return this.saveRemoteResource(options);
	}

	protected async showOpenDialogSimplified(schema: string, options: IOpenDialogOptions): Promise<URI[] | undefined> {
		if (!options.availableFileSystems) {
			options.availableFileSystems = this.addFileSchemaIfNeeded(schema);
		}

		const uri = await this.pickResource(options);

		return uri ? [uri] : undefined;
	}

	private pickResource(options: IOpenDialogOptions): Promise<URI | undefined> {
		const simpleFileDialog = this.instantiationService.createInstance(SimpleFileDialog);

		return simpleFileDialog.showOpenDialog(options);
	}

	private saveRemoteResource(options: ISaveDialogOptions): Promise<URI | undefined> {
		const remoteFileDialog = this.instantiationService.createInstance(SimpleFileDialog);

		return remoteFileDialog.showSaveDialog(options);
	}

	protected getSchemeFilterForWindow(defaultUriScheme?: string): string {
		return defaultUriScheme ?? this.pathService.defaultUriScheme;
	}

	protected getFileSystemSchema(options: { availableFileSystems?: readonly string[], defaultUri?: URI }): string {
		return options.availableFileSystems && options.availableFileSystems[0] || this.getSchemeFilterForWindow(options.defaultUri?.scheme);
	}

	abstract pickFileFolderAndOpen(options: IPickAndOpenOptions): Promise<void>;
	abstract pickFileAndOpen(options: IPickAndOpenOptions): Promise<void>;
	abstract pickFolderAndOpen(options: IPickAndOpenOptions): Promise<void>;
	abstract pickWorkspaceAndOpen(options: IPickAndOpenOptions): Promise<void>;
	abstract showSaveDialog(options: ISaveDialogOptions): Promise<URI | undefined>;
	abstract showOpenDialog(options: IOpenDialogOptions): Promise<URI[] | undefined>;

	abstract pickFileToSave(defaultUri: URI, availableFileSystems?: string[]): Promise<URI | undefined>;

	protected getPickFileToSaveDialogOptions(defaultUri: URI, availableFileSystems?: string[]): ISaveDialogOptions {
		const options: ISaveDialogOptions = {
			defaultUri,
			title: nls.localize('saveAsTitle', "Save As"),
			availableFileSystems
		};

		interface IFilter { name: string; extensions: string[]; }

		// Build the file filter by using our known languages
		const ext: string | undefined = defaultUri ? resources.extname(defaultUri) : undefined;
		let matchingFilter: IFilter | undefined;

		const registeredLanguageNames = this.modeService.getRegisteredLanguageNames().sort((a, b) => compareIgnoreCase(a, b));
		const registeredLanguageFilters: IFilter[] = coalesce(registeredLanguageNames.map(languageName => {
			const extensions = this.modeService.getExtensions(languageName);
			if (!extensions || !extensions.length) {
				return null;
			}

			const filter: IFilter = { name: languageName, extensions: distinct(extensions).slice(0, 10).map(e => trim(e, '.')) };

			if (!matchingFilter && extensions.indexOf(ext || PLAINTEXT_EXTENSION /* https://github.com/microsoft/vscode/issues/115860 */) >= 0) {
				matchingFilter = filter;

				return null; // first matching filter will be added to the top
			}

			return filter;
		}));

		// We have no matching filter, e.g. because the language
		// is unknown. We still add the extension to the list of
		// filters though so that it can be picked
		// (https://github.com/microsoft/vscode/issues/96283)
		if (!matchingFilter && ext) {
			matchingFilter = { name: trim(ext, '.').toUpperCase(), extensions: [trim(ext, '.')] };
		}

		// Order of filters is
		// - All Files (we MUST do this to fix macOS issue https://github.com/microsoft/vscode/issues/102713)
		// - File Extension Match (if any)
		// - All Languages
		// - No Extension
		options.filters = coalesce([
			{ name: nls.localize('allFiles', "All Files"), extensions: ['*'] },
			matchingFilter,
			...registeredLanguageFilters,
			{ name: nls.localize('noExt', "No Extension"), extensions: [''] }
		]);

		return options;
	}
}
