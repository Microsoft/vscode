/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWindowSettings, IWindowOpenable, IOpenWindowOptions, isFolderToOpen, isWorkspaceToOpen, isFileToOpen, IOpenEmptyWindowOptions, IPathData, IFileToOpen } from 'vs/platform/windows/common/windows';
import { pathsToEditors } from 'vs/workbench/common/editor';
import { IFileService } from 'vs/platform/files/common/files';
import { ILabelService } from 'vs/platform/label/common/label';
import { trackFocus } from 'vs/base/browser/dom';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { domEvent } from 'vs/base/browser/event';
import { memoize } from 'vs/base/common/decorators';
import { parseLineAndColumnAware } from 'vs/base/common/extpath';
import { IWorkspaceFolderCreationData } from 'vs/platform/workspaces/common/workspaces';
import { IWorkspaceEditingService } from 'vs/workbench/services/workspaces/common/workspaceEditing';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';

/**
 * A workspace to open in the workbench can either be:
 * - a workspace file with 0-N folders (via `workspaceUri`)
 * - a single folder (via `folderUri`)
 * - empty (via `undefined`)
 */
export type IWorkspace = { workspaceUri: URI } | { folderUri: URI } | undefined;

export interface IWorkspaceProvider {

	/**
	 * The initial workspace to open.
	 */
	readonly workspace: IWorkspace;

	/**
	 * Arbitrary payload from the `IWorkspaceProvider.open` call.
	 */
	readonly payload?: object;

	/**
	 * Asks to open a workspace in the current or a new window.
	 *
	 * @param workspace the workspace to open.
	 * @param options optional options for the workspace to open.
	 * - `reuse`: whether to open inside the current window or a new window
	 * - `payload`: arbitrary payload that should be made available
	 * to the opening window via the `IWorkspaceProvider.payload` property.
	 * @param payload optional payload to send to the workspace to open.
	 */
	open(workspace: IWorkspace, options?: { reuse?: boolean, payload?: object }): Promise<void>;
}

export class BrowserHostService extends Disposable implements IHostService {

	declare readonly _serviceBrand: undefined;

	private workspaceProvider: IWorkspaceProvider;

	constructor(
		@ILayoutService private readonly layoutService: ILayoutService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IFileService private readonly fileService: IFileService,
		@ILabelService private readonly labelService: ILabelService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();

		if (environmentService.options && environmentService.options.workspaceProvider) {
			this.workspaceProvider = environmentService.options.workspaceProvider;
		} else {
			this.workspaceProvider = new class implements IWorkspaceProvider {
				readonly workspace = undefined;
				async open() { }
			};
		}
	}

	@memoize
	get onDidChangeFocus(): Event<boolean> {
		const focusTracker = this._register(trackFocus(window));

		return Event.latch(Event.any(
			Event.map(focusTracker.onDidFocus, () => this.hasFocus),
			Event.map(focusTracker.onDidBlur, () => this.hasFocus),
			Event.map(domEvent(window.document, 'visibilitychange'), () => this.hasFocus)
		));
	}

	get hasFocus(): boolean {
		return document.hasFocus();
	}

	async hadLastFocus(): Promise<boolean> {
		return true;
	}

	async focus(): Promise<void> {
		window.focus();
	}

	openWindow(options?: IOpenEmptyWindowOptions): Promise<void>;
	openWindow(toOpen: IWindowOpenable[], options?: IOpenWindowOptions): Promise<void>;
	openWindow(arg1?: IOpenEmptyWindowOptions | IWindowOpenable[], arg2?: IOpenWindowOptions): Promise<void> {
		if (Array.isArray(arg1)) {
			return this.doOpenWindow(arg1, arg2);
		}

		return this.doOpenEmptyWindow(arg1);
	}

	private async doOpenWindow(toOpen: IWindowOpenable[], options?: IOpenWindowOptions): Promise<void> {
		const payload = this.preservePayload();
		const fileOpenables: IFileToOpen[] = [];
		const foldersToAdd: IWorkspaceFolderCreationData[] = [];

		for (const openable of toOpen) {
			openable.label = openable.label || this.getRecentLabel(openable);

			// Folder
			if (isFolderToOpen(openable)) {
				if (options?.addMode) {
					foldersToAdd.push(({ uri: openable.folderUri }));
				} else {
					this.workspaceProvider.open({ folderUri: openable.folderUri }, { reuse: this.shouldReuse(options, false /* no file */), payload });
				}
			}

			// Workspace
			else if (isWorkspaceToOpen(openable)) {
				this.workspaceProvider.open({ workspaceUri: openable.workspaceUri }, { reuse: this.shouldReuse(options, false /* no file */), payload });
			}

			// File (handled later in bulk)
			else if (isFileToOpen(openable)) {
				fileOpenables.push(openable);
			}
		}

		// Handle Folders to Add
		if (foldersToAdd.length > 0) {
			this.instantiationService.invokeFunction(accessor => {
				const workspaceEditingService: IWorkspaceEditingService = accessor.get(IWorkspaceEditingService);
				workspaceEditingService.addFolders(foldersToAdd);
			});
		}

		// Handle Files
		if (fileOpenables.length > 0) {

			// Support diffMode
			if (options?.diffMode && fileOpenables.length === 2) {
				const editors = await pathsToEditors(fileOpenables, this.fileService);
				if (editors.length !== 2 || !editors[0].resource || !editors[1].resource) {
					return; // invalid resources
				}

				// Same Window: open via editor service in current window
				if (this.shouldReuse(options, true /* file */)) {
					this.editorService.openEditor({
						leftResource: editors[0].resource,
						rightResource: editors[1].resource
					});
				}

				// New Window: open into empty window
				else {
					const environment = new Map<string, string>();
					environment.set('diffFileSecondary', editors[0].resource.toString());
					environment.set('diffFilePrimary', editors[1].resource.toString());

					this.workspaceProvider.open(undefined, { payload: Array.from(environment.entries()) });
				}
			}

			// Just open normally
			else {
				for (const openable of fileOpenables) {

					// Same Window: open via editor service in current window
					if (this.shouldReuse(options, true /* file */)) {
						let openables: IPathData[] = [];

						// Support: --goto parameter to open on line/col
						if (options?.gotoLineMode) {
							const pathColumnAware = parseLineAndColumnAware(openable.fileUri.path);
							openables = [{
								fileUri: openable.fileUri.with({ path: pathColumnAware.path }),
								lineNumber: pathColumnAware.line,
								columnNumber: pathColumnAware.column
							}];
						} else {
							openables = [openable];
						}

						this.editorService.openEditors(await pathsToEditors(openables, this.fileService));
					}

					// New Window: open into empty window
					else {
						const environment = new Map<string, string>();
						environment.set('openFile', openable.fileUri.toString());

						if (options?.gotoLineMode) {
							environment.set('gotoLineMode', 'true');
						}

						this.workspaceProvider.open(undefined, { payload: Array.from(environment.entries()) });
					}
				}
			}

			// Support wait mode
			const waitMarkerFileURI = options?.waitMarkerFileURI;
			if (waitMarkerFileURI) {
				(async () => {

					// Wait for the resources to be closed in the editor...
					await this.editorService.whenClosed(fileOpenables.map(openable => ({ resource: openable.fileUri })), { waitForSaved: true });

					// ...before deleting the wait marker file
					await this.fileService.del(waitMarkerFileURI);
				})();
			}
		}
	}

	private preservePayload(): Array<unknown> | undefined {

		// Selectively copy payload: for now only extension debugging properties are considered
		let newPayload: Array<unknown> | undefined = undefined;
		if (this.environmentService.extensionDevelopmentLocationURI) {
			newPayload = new Array();

			newPayload.push(['extensionDevelopmentPath', this.environmentService.extensionDevelopmentLocationURI.toString()]);

			if (this.environmentService.debugExtensionHost.debugId) {
				newPayload.push(['debugId', this.environmentService.debugExtensionHost.debugId]);
			}

			if (this.environmentService.debugExtensionHost.port) {
				newPayload.push(['inspect-brk-extensions', String(this.environmentService.debugExtensionHost.port)]);
			}
		}

		return newPayload;
	}

	private getRecentLabel(openable: IWindowOpenable): string {
		if (isFolderToOpen(openable)) {
			return this.labelService.getWorkspaceLabel(openable.folderUri, { verbose: true });
		}

		if (isWorkspaceToOpen(openable)) {
			return this.labelService.getWorkspaceLabel({ id: '', configPath: openable.workspaceUri }, { verbose: true });
		}

		return this.labelService.getUriLabel(openable.fileUri);
	}

	private shouldReuse(options: IOpenWindowOptions = Object.create(null), isFile: boolean): boolean {
		if (options.waitMarkerFileURI) {
			return true; // always handle --wait in same window
		}

		const windowConfig = this.configurationService.getValue<IWindowSettings>('window');
		const openInNewWindowConfig = isFile ? (windowConfig?.openFilesInNewWindow || 'off' /* default */) : (windowConfig?.openFoldersInNewWindow || 'default' /* default */);

		let openInNewWindow = (options.preferNewWindow || !!options.forceNewWindow) && !options.forceReuseWindow;
		if (!options.forceNewWindow && !options.forceReuseWindow && (openInNewWindowConfig === 'on' || openInNewWindowConfig === 'off')) {
			openInNewWindow = (openInNewWindowConfig === 'on');
		}

		return !openInNewWindow;
	}

	private async doOpenEmptyWindow(options?: IOpenEmptyWindowOptions): Promise<void> {
		return this.workspaceProvider.open(undefined, { reuse: options?.forceReuseWindow });
	}

	async toggleFullScreen(): Promise<void> {
		const target = this.layoutService.container;

		// Chromium
		if (document.fullscreen !== undefined) {
			if (!document.fullscreen) {
				try {
					return await target.requestFullscreen();
				} catch (error) {
					console.warn('Toggle Full Screen failed'); // https://developer.mozilla.org/en-US/docs/Web/API/Element/requestFullscreen
				}
			} else {
				try {
					return await document.exitFullscreen();
				} catch (error) {
					console.warn('Exit Full Screen failed');
				}
			}
		}

		// Safari and Edge 14 are all using webkit prefix
		if ((<any>document).webkitIsFullScreen !== undefined) {
			try {
				if (!(<any>document).webkitIsFullScreen) {
					(<any>target).webkitRequestFullscreen(); // it's async, but doesn't return a real promise.
				} else {
					(<any>document).webkitExitFullscreen(); // it's async, but doesn't return a real promise.
				}
			} catch {
				console.warn('Enter/Exit Full Screen failed');
			}
		}
	}

	async restart(): Promise<void> {
		this.reload();
	}

	async reload(): Promise<void> {
		window.location.reload();
	}
}

registerSingleton(IHostService, BrowserHostService, true);
