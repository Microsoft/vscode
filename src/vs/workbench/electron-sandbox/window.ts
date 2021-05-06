/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { onUnexpectedError } from 'vs/base/common/errors';
import { equals } from 'vs/base/common/objects';
import { EventType, EventHelper, addDisposableListener, scheduleAtNextAnimationFrame } from 'vs/base/browser/dom';
import { Separator } from 'vs/base/common/actions';
import { IFileService } from 'vs/platform/files/common/files';
import { EditorResourceAccessor, IUntitledTextResourceEditorInput, SideBySideEditor, pathsToEditors } from 'vs/workbench/common/editor';
import { IEditorService, IResourceEditorInputType } from 'vs/workbench/services/editor/common/editorService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { WindowMinimumSize, IOpenFileRequest, IWindowsConfiguration, getTitleBarStyle, IAddFoldersRequest, INativeRunActionInWindowRequest, INativeRunKeybindingInWindowRequest, INativeOpenFileRequest } from 'vs/platform/windows/common/windows';
import { ITitleService } from 'vs/workbench/services/title/common/titleService';
import { IWorkbenchThemeService } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { applyZoom } from 'vs/platform/windows/electron-sandbox/window';
import { setFullscreen, getZoomLevel } from 'vs/base/browser/browser';
import { ICommandService, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IResourceEditorInput } from 'vs/platform/editor/common/editor';
import { ipcRenderer } from 'vs/base/parts/sandbox/electron-sandbox/globals';
import { env } from 'vs/base/common/process';
import { IWorkspaceEditingService } from 'vs/workbench/services/workspaces/common/workspaceEditing';
import { IMenuService, MenuId, IMenu, MenuItemAction, ICommandAction, MenuRegistry } from 'vs/platform/actions/common/actions';
import { createAndFillInActionBarActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { RunOnceScheduler } from 'vs/base/common/async';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { LifecyclePhase, ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IWorkspaceFolderCreationData } from 'vs/platform/workspaces/common/workspaces';
import { IIntegrityService } from 'vs/workbench/services/integrity/common/integrity';
import { isWindows, isMacintosh } from 'vs/base/common/platform';
import { IProductService } from 'vs/platform/product/common/productService';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { IAccessibilityService, AccessibilitySupport } from 'vs/platform/accessibility/common/accessibility';
import { WorkbenchState, IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { coalesce } from 'vs/base/common/arrays';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { assertIsDefined } from 'vs/base/common/types';
import { IOpenerService, OpenOptions } from 'vs/platform/opener/common/opener';
import { Schemas } from 'vs/base/common/network';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { posix, dirname } from 'vs/base/common/path';
import { getBaseLabel } from 'vs/base/common/labels';
import { ITunnelService, extractLocalHostUriMetaDataForPortMapping } from 'vs/platform/remote/common/tunnel';
import { IWorkbenchLayoutService, Parts, positionFromString, Position } from 'vs/workbench/services/layout/browser/layoutService';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { WorkingCopyCapabilities } from 'vs/workbench/services/workingCopy/common/workingCopy';
import { AutoSaveMode, IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { Event } from 'vs/base/common/event';
import { IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { IAddressProvider, IAddress } from 'vs/platform/remote/common/remoteAgentConnection';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { AuthInfo } from 'vs/base/parts/sandbox/electron-sandbox/electronTypes';
import { ILogService } from 'vs/platform/log/common/log';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { whenEditorClosed } from 'vs/workbench/browser/editor';

export class NativeWindow extends Disposable {

	private static REMEMBER_PROXY_CREDENTIALS_KEY = 'window.rememberProxyCredentials';

	private touchBarMenu: IMenu | undefined;
	private readonly touchBarDisposables = this._register(new DisposableStore());
	private lastInstalledTouchedBar: ICommandAction[][] | undefined;

	private readonly customTitleContextMenuDisposable = this._register(new DisposableStore());

	private previousConfiguredZoomLevel: number | undefined;

	private readonly addFoldersScheduler = this._register(new RunOnceScheduler(() => this.doAddFolders(), 100));
	private pendingFoldersToAdd: URI[] = [];

	private readonly closeEmptyWindowScheduler = this._register(new RunOnceScheduler(() => this.onDidAllEditorsClose(), 50));

	private isDocumentedEdited = false;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITitleService private readonly titleService: ITitleService,
		@IWorkbenchThemeService protected themeService: IWorkbenchThemeService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICommandService private readonly commandService: ICommandService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IWorkspaceEditingService private readonly workspaceEditingService: IWorkspaceEditingService,
		@IFileService private readonly fileService: IFileService,
		@IMenuService private readonly menuService: IMenuService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IIntegrityService private readonly integrityService: IIntegrityService,
		@INativeWorkbenchEnvironmentService private readonly environmentService: INativeWorkbenchEnvironmentService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IOpenerService private readonly openerService: IOpenerService,
		@INativeHostService private readonly nativeHostService: INativeHostService,
		@ITunnelService private readonly tunnelService: ITunnelService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService,
		@IProductService private readonly productService: IProductService,
		@IRemoteAuthorityResolverService private readonly remoteAuthorityResolverService: IRemoteAuthorityResolverService,
		@IDialogService private readonly dialogService: IDialogService,
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();

		this.registerListeners();
		this.create();
	}

	private registerListeners(): void {

		// Layout
		this._register(addDisposableListener(window, EventType.RESIZE, e => this.onWindowResize(e, true)));

		// React to editor input changes
		this._register(this.editorService.onDidActiveEditorChange(() => this.updateTouchbarMenu()));

		// prevent opening a real URL inside the window
		[EventType.DRAG_OVER, EventType.DROP].forEach(event => {
			window.document.body.addEventListener(event, (e: DragEvent) => {
				EventHelper.stop(e);
			});
		});

		// Support runAction event
		ipcRenderer.on('vscode:runAction', async (event: unknown, request: INativeRunActionInWindowRequest) => {
			const args: unknown[] = request.args || [];

			// If we run an action from the touchbar, we fill in the currently active resource
			// as payload because the touch bar items are context aware depending on the editor
			if (request.from === 'touchbar') {
				const activeEditor = this.editorService.activeEditor;
				if (activeEditor) {
					const resource = EditorResourceAccessor.getOriginalUri(activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
					if (resource) {
						args.push(resource);
					}
				}
			} else {
				args.push({ from: request.from });
			}

			try {
				await this.commandService.executeCommand(request.id, ...args);

				type CommandExecutedClassifcation = {
					id: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
					from: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
				};
				this.telemetryService.publicLog2<{ id: String, from: String }, CommandExecutedClassifcation>('commandExecuted', { id: request.id, from: request.from });
			} catch (error) {
				this.notificationService.error(error);
			}
		});

		// Support runKeybinding event
		ipcRenderer.on('vscode:runKeybinding', (event: unknown, request: INativeRunKeybindingInWindowRequest) => {
			if (document.activeElement) {
				this.keybindingService.dispatchByUserSettingsLabel(request.userSettingsLabel, document.activeElement);
			}
		});

		// Error reporting from main
		ipcRenderer.on('vscode:reportError', (event: unknown, error: string) => {
			if (error) {
				onUnexpectedError(JSON.parse(error));
			}
		});

		// Support openFiles event for existing and new files
		ipcRenderer.on('vscode:openFiles', (event: unknown, request: IOpenFileRequest) => this.onOpenFiles(request));

		// Support addFolders event if we have a workspace opened
		ipcRenderer.on('vscode:addFolders', (event: unknown, request: IAddFoldersRequest) => this.onAddFoldersRequest(request));

		// Message support
		ipcRenderer.on('vscode:showInfoMessage', (event: unknown, message: string) => this.notificationService.info(message));

		// Fullscreen Events
		ipcRenderer.on('vscode:enterFullScreen', async () => {
			await this.lifecycleService.when(LifecyclePhase.Ready);
			setFullscreen(true);
		});

		ipcRenderer.on('vscode:leaveFullScreen', async () => {
			await this.lifecycleService.when(LifecyclePhase.Ready);
			setFullscreen(false);
		});

		// Proxy Login Dialog
		ipcRenderer.on('vscode:openProxyAuthenticationDialog', async (event: unknown, payload: { authInfo: AuthInfo, username?: string, password?: string, replyChannel: string }) => {
			const rememberCredentials = this.storageService.getBoolean(NativeWindow.REMEMBER_PROXY_CREDENTIALS_KEY, StorageScope.GLOBAL);
			const result = await this.dialogService.input(Severity.Warning, localize('proxyAuthRequired', "Proxy Authentication Required"),
				[
					localize({ key: 'loginButton', comment: ['&& denotes a mnemonic'] }, "&&Log In"),
					localize({ key: 'cancelButton', comment: ['&& denotes a mnemonic'] }, "&&Cancel")
				],
				[
					{ placeholder: localize('username', "Username"), value: payload.username },
					{ placeholder: localize('password', "Password"), type: 'password', value: payload.password }
				],
				{
					cancelId: 1,
					detail: localize('proxyDetail', "The proxy {0} requires a username and password.", `${payload.authInfo.host}:${payload.authInfo.port}`),
					checkbox: {
						label: localize('rememberCredentials', "Remember my credentials"),
						checked: rememberCredentials
					}
				});

			// Reply back to the channel without result to indicate
			// that the login dialog was cancelled
			if (result.choice !== 0 || !result.values) {
				ipcRenderer.send(payload.replyChannel);
			}

			// Other reply back with the picked credentials
			else {

				// Update state based on checkbox
				if (result.checkboxChecked) {
					this.storageService.store(NativeWindow.REMEMBER_PROXY_CREDENTIALS_KEY, true, StorageScope.GLOBAL, StorageTarget.MACHINE);
				} else {
					this.storageService.remove(NativeWindow.REMEMBER_PROXY_CREDENTIALS_KEY, StorageScope.GLOBAL);
				}

				// Reply back to main side with credentials
				const [username, password] = result.values;
				ipcRenderer.send(payload.replyChannel, { username, password, remember: !!result.checkboxChecked });
			}
		});

		// Accessibility support changed event
		ipcRenderer.on('vscode:accessibilitySupportChanged', (event: unknown, accessibilitySupportEnabled: boolean) => {
			this.accessibilityService.setAccessibilitySupport(accessibilitySupportEnabled ? AccessibilitySupport.Enabled : AccessibilitySupport.Disabled);
		});

		// Zoom level changes
		this.updateWindowZoomLevel();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('window.zoomLevel')) {
				this.updateWindowZoomLevel();
			} else if (e.affectsConfiguration('keyboard.touchbar.enabled') || e.affectsConfiguration('keyboard.touchbar.ignored')) {
				this.updateTouchbarMenu();
			}
		}));

		// Listen to visible editor changes
		this._register(this.editorService.onDidVisibleEditorsChange(() => this.onDidChangeVisibleEditors()));

		// Listen to editor closing (if we run with --wait)
		const filesToWait = this.environmentService.configuration.filesToWait;
		if (filesToWait) {
			this.trackClosedWaitFiles(filesToWait.waitMarkerFileUri, coalesce(filesToWait.paths.map(path => path.fileUri)));
		}

		// macOS OS integration
		if (isMacintosh) {
			this._register(this.editorService.onDidActiveEditorChange(() => {
				const file = EditorResourceAccessor.getOriginalUri(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY, filterByScheme: Schemas.file });

				// Represented Filename
				this.updateRepresentedFilename(file?.fsPath);

				// Custom title menu
				this.provideCustomTitleContextMenu(file?.fsPath);
			}));
		}

		// Maximize/Restore on doubleclick (for macOS custom title)
		if (isMacintosh && getTitleBarStyle(this.configurationService) === 'custom') {
			const titlePart = assertIsDefined(this.layoutService.getContainer(Parts.TITLEBAR_PART));

			this._register(addDisposableListener(titlePart, EventType.DBLCLICK, e => {
				EventHelper.stop(e);

				this.nativeHostService.handleTitleDoubleClick();
			}));
		}

		// Document edited: indicate for dirty working copies
		this._register(this.workingCopyService.onDidChangeDirty(workingCopy => {
			const gotDirty = workingCopy.isDirty();
			if (gotDirty && !(workingCopy.capabilities & WorkingCopyCapabilities.Untitled) && this.filesConfigurationService.getAutoSaveMode() === AutoSaveMode.AFTER_SHORT_DELAY) {
				return; // do not indicate dirty of working copies that are auto saved after short delay
			}

			this.updateDocumentEdited(gotDirty);
		}));

		this.updateDocumentEdited();

		// Detect minimize / maximize
		this._register(Event.any(
			Event.map(Event.filter(this.nativeHostService.onDidMaximizeWindow, id => id === this.nativeHostService.windowId), () => true),
			Event.map(Event.filter(this.nativeHostService.onDidUnmaximizeWindow, id => id === this.nativeHostService.windowId), () => false)
		)(e => this.onDidChangeWindowMaximized(e)));

		this.onDidChangeWindowMaximized(this.environmentService.configuration.maximized ?? false);

		// Detect panel position to determine minimum width
		this._register(this.layoutService.onDidChangePanelPosition(pos => this.onDidChangePanelPosition(positionFromString(pos))));
		this.onDidChangePanelPosition(this.layoutService.getPanelPosition());
	}

	private onWindowResize(e: UIEvent, retry: boolean): void {
		if (e.target === window) {
			if (window.document && window.document.body && window.document.body.clientWidth === 0) {
				// TODO@electron this is an electron issue on macOS when simple fullscreen is enabled
				// where for some reason the window clientWidth is reported as 0 when switching
				// between simple fullscreen and normal screen. In that case we schedule the layout
				// call at the next animation frame once, in the hope that the dimensions are
				// proper then.
				if (retry) {
					scheduleAtNextAnimationFrame(() => this.onWindowResize(e, false));
				}
				return;
			}

			this.layoutService.layout();
		}
	}

	private updateDocumentEdited(isDirty = this.workingCopyService.hasDirty): void {
		if ((!this.isDocumentedEdited && isDirty) || (this.isDocumentedEdited && !isDirty)) {
			this.isDocumentedEdited = isDirty;

			this.nativeHostService.setDocumentEdited(isDirty);
		}
	}

	private onDidChangeWindowMaximized(maximized: boolean): void {
		this.layoutService.updateWindowMaximizedState(maximized);
	}

	private getWindowMinimumWidth(panelPosition: Position = this.layoutService.getPanelPosition()): number {

		// if panel is on the side, then return the larger minwidth
		const panelOnSide = panelPosition === Position.LEFT || panelPosition === Position.RIGHT;
		if (panelOnSide) {
			return WindowMinimumSize.WIDTH_WITH_VERTICAL_PANEL;
		}

		return WindowMinimumSize.WIDTH;
	}

	private onDidChangePanelPosition(pos: Position): void {
		const minWidth = this.getWindowMinimumWidth(pos);

		this.nativeHostService.setMinimumSize(minWidth, undefined);
	}

	private onDidChangeVisibleEditors(): void {

		// Close when empty: check if we should close the window based on the setting
		// Overruled by: window has a workspace opened or this window is for extension development
		// or setting is disabled. Also enabled when running with --wait from the command line.
		const visibleEditorPanes = this.editorService.visibleEditorPanes;
		if (visibleEditorPanes.length === 0 && this.contextService.getWorkbenchState() === WorkbenchState.EMPTY && !this.environmentService.isExtensionDevelopment) {
			const closeWhenEmpty = this.configurationService.getValue<boolean>('window.closeWhenEmpty');
			if (closeWhenEmpty || this.environmentService.args.wait) {
				this.closeEmptyWindowScheduler.schedule();
			}
		}
	}

	private onDidAllEditorsClose(): void {
		const visibleEditorPanes = this.editorService.visibleEditorPanes.length;
		if (visibleEditorPanes === 0) {
			this.nativeHostService.closeWindow();
		}
	}

	private updateWindowZoomLevel(): void {
		const windowConfig = this.configurationService.getValue<IWindowsConfiguration>();

		let configuredZoomLevel = 0;
		if (windowConfig.window && typeof windowConfig.window.zoomLevel === 'number') {
			configuredZoomLevel = windowConfig.window.zoomLevel;

			// Leave early if the configured zoom level did not change (https://github.com/microsoft/vscode/issues/1536)
			if (this.previousConfiguredZoomLevel === configuredZoomLevel) {
				return;
			}

			this.previousConfiguredZoomLevel = configuredZoomLevel;
		}

		if (getZoomLevel() !== configuredZoomLevel) {
			applyZoom(configuredZoomLevel);
		}
	}

	private updateRepresentedFilename(filePath: string | undefined): void {
		this.nativeHostService.setRepresentedFilename(filePath ? filePath : '');
	}

	private provideCustomTitleContextMenu(filePath: string | undefined): void {

		// Clear old menu
		this.customTitleContextMenuDisposable.clear();

		// Provide new menu if a file is opened and we are on a custom title
		if (!filePath || getTitleBarStyle(this.configurationService) !== 'custom') {
			return;
		}

		// Split up filepath into segments
		const segments = filePath.split(posix.sep);
		for (let i = segments.length; i > 0; i--) {
			const isFile = (i === segments.length);

			let pathOffset = i;
			if (!isFile) {
				pathOffset++; // for segments which are not the file name we want to open the folder
			}

			const path = segments.slice(0, pathOffset).join(posix.sep);

			let label: string;
			if (!isFile) {
				label = getBaseLabel(dirname(path));
			} else {
				label = getBaseLabel(path);
			}

			const commandId = `workbench.action.revealPathInFinder${i}`;
			this.customTitleContextMenuDisposable.add(CommandsRegistry.registerCommand(commandId, () => this.nativeHostService.showItemInFolder(path)));
			this.customTitleContextMenuDisposable.add(MenuRegistry.appendMenuItem(MenuId.TitleBarContext, { command: { id: commandId, title: label || posix.sep }, order: -i }));
		}
	}

	private create(): void {

		// Handle open calls
		this.setupOpenHandlers();

		// Notify main side when window ready
		this.lifecycleService.when(LifecyclePhase.Ready).then(() => this.nativeHostService.notifyReady());

		// Integrity warning
		this.integrityService.isPure().then(({ isPure }) => this.titleService.updateProperties({ isPure }));

		// Root warning
		this.lifecycleService.when(LifecyclePhase.Restored).then(async () => {
			const isAdmin = await this.nativeHostService.isAdmin();

			// Update title
			this.titleService.updateProperties({ isAdmin });

			// Show warning message (unix only)
			if (isAdmin && !isWindows) {
				this.notificationService.warn(localize('runningAsRoot', "It is not recommended to run {0} as root user.", this.productService.nameShort));
			}
		});

		// Touchbar menu (if enabled)
		this.updateTouchbarMenu();

		// Check for cyclic dependencies
		if (require.hasDependencyCycle()) {
			if (env['CI'] || env['BUILD_ARTIFACTSTAGINGDIRECTORY']) {
				this.logService.error('Error: There is a dependency cycle in the AMD modules that needs to be resolved!');
				this.nativeHostService.exit(37); // running on a build machine, just exit without showing a dialog
			} else {
				this.dialogService.show(Severity.Error, localize('loaderCycle', "There is a dependency cycle in the AMD modules that needs to be resolved!"), [localize('ok', "OK")]);
				this.nativeHostService.openDevTools();
			}
		}
	}

	private setupOpenHandlers(): void {

		// Block window.open() calls
		window.open = function (): Window | null {
			throw new Error('Prevented call to window.open(). Use IOpenerService instead!');
		};

		// Handle external open() calls
		this.openerService.setDefaultExternalOpener({
			openExternal: async (href: string) => {
				const success = await this.nativeHostService.openExternal(href);
				if (!success) {
					const fileCandidate = URI.parse(href);
					if (fileCandidate.scheme === Schemas.file) {
						// if opening failed, and this is a file, we can still try to reveal it
						await this.nativeHostService.showItemInFolder(fileCandidate.fsPath);
					}
				}

				return true;
			}
		});

		// Register external URI resolver
		this.openerService.registerExternalUriResolver({
			resolveExternalUri: async (uri: URI, options?: OpenOptions) => {
				if (options?.allowTunneling) {
					const portMappingRequest = extractLocalHostUriMetaDataForPortMapping(uri);
					if (portMappingRequest) {
						const remoteAuthority = this.environmentService.remoteAuthority;
						const addressProvider: IAddressProvider | undefined = remoteAuthority ? {
							getAddress: async (): Promise<IAddress> => {
								return (await this.remoteAuthorityResolverService.resolveAuthority(remoteAuthority)).authority;
							}
						} : undefined;
						const tunnel = await this.tunnelService.openTunnel(addressProvider, portMappingRequest.address, portMappingRequest.port);
						if (tunnel) {
							const addressAsUri = URI.parse(tunnel.localAddress);
							const resolved = addressAsUri.scheme.startsWith(uri.scheme) ? addressAsUri : uri.with({ authority: tunnel.localAddress });
							return {
								resolved,
								dispose: () => tunnel.dispose(),
							};
						}
					}
				}
				return undefined;
			}
		});
	}

	private updateTouchbarMenu(): void {
		if (!isMacintosh) {
			return; // macOS only
		}

		// Dispose old
		this.touchBarDisposables.clear();
		this.touchBarMenu = undefined;

		// Create new (delayed)
		const scheduler: RunOnceScheduler = this.touchBarDisposables.add(new RunOnceScheduler(() => this.doUpdateTouchbarMenu(scheduler), 300));
		scheduler.schedule();
	}

	private doUpdateTouchbarMenu(scheduler: RunOnceScheduler): void {
		if (!this.touchBarMenu) {
			const scopedContextKeyService = this.editorService.activeEditorPane?.scopedContextKeyService || this.editorGroupService.activeGroup.scopedContextKeyService;
			this.touchBarMenu = this.menuService.createMenu(MenuId.TouchBarContext, scopedContextKeyService);
			this.touchBarDisposables.add(this.touchBarMenu);
			this.touchBarDisposables.add(this.touchBarMenu.onDidChange(() => scheduler.schedule()));
		}

		const actions: Array<MenuItemAction | Separator> = [];

		const disabled = this.configurationService.getValue<boolean>('keyboard.touchbar.enabled') === false;
		const ignoredItems = this.configurationService.getValue<string[]>('keyboard.touchbar.ignored') || [];

		// Fill actions into groups respecting order
		this.touchBarDisposables.add(createAndFillInActionBarActions(this.touchBarMenu, undefined, actions));

		// Convert into command action multi array
		const items: ICommandAction[][] = [];
		let group: ICommandAction[] = [];
		if (!disabled) {
			for (const action of actions) {

				// Command
				if (action instanceof MenuItemAction) {
					if (ignoredItems.indexOf(action.item.id) >= 0) {
						continue; // ignored
					}

					group.push(action.item);
				}

				// Separator
				else if (action instanceof Separator) {
					if (group.length) {
						items.push(group);
					}

					group = [];
				}
			}

			if (group.length) {
				items.push(group);
			}
		}

		// Only update if the actions have changed
		if (!equals(this.lastInstalledTouchedBar, items)) {
			this.lastInstalledTouchedBar = items;
			this.nativeHostService.updateTouchBar(items);
		}
	}

	private onAddFoldersRequest(request: IAddFoldersRequest): void {

		// Buffer all pending requests
		this.pendingFoldersToAdd.push(...request.foldersToAdd.map(folder => URI.revive(folder)));

		// Delay the adding of folders a bit to buffer in case more requests are coming
		if (!this.addFoldersScheduler.isScheduled()) {
			this.addFoldersScheduler.schedule();
		}
	}

	private doAddFolders(): void {
		const foldersToAdd: IWorkspaceFolderCreationData[] = [];

		this.pendingFoldersToAdd.forEach(folder => {
			foldersToAdd.push(({ uri: folder }));
		});

		this.pendingFoldersToAdd = [];

		this.workspaceEditingService.addFolders(foldersToAdd);
	}

	private async onOpenFiles(request: INativeOpenFileRequest): Promise<void> {
		const inputs: IResourceEditorInputType[] = [];
		const diffMode = !!(request.filesToDiff && (request.filesToDiff.length === 2));

		if (!diffMode && request.filesToOpenOrCreate) {
			inputs.push(...(await pathsToEditors(request.filesToOpenOrCreate, this.fileService)));
		}

		if (diffMode && request.filesToDiff) {
			inputs.push(...(await pathsToEditors(request.filesToDiff, this.fileService)));
		}

		if (inputs.length) {
			this.openResources(inputs, diffMode);
		}

		if (request.filesToWait && inputs.length) {
			// In wait mode, listen to changes to the editors and wait until the files
			// are closed that the user wants to wait for. When this happens we delete
			// the wait marker file to signal to the outside that editing is done.
			this.trackClosedWaitFiles(URI.revive(request.filesToWait.waitMarkerFileUri), coalesce(request.filesToWait.paths.map(p => URI.revive(p.fileUri))));
		}
	}

	private async trackClosedWaitFiles(waitMarkerFile: URI, resourcesToWaitFor: URI[]): Promise<void> {

		// Wait for the resources to be closed in the text editor...
		await this.instantiationService.invokeFunction(accessor => whenEditorClosed(accessor, resourcesToWaitFor));

		// ...before deleting the wait marker file
		await this.fileService.del(waitMarkerFile);
	}

	private async openResources(resources: Array<IResourceEditorInput | IUntitledTextResourceEditorInput>, diffMode: boolean): Promise<unknown> {
		await this.lifecycleService.when(LifecyclePhase.Ready);

		// In diffMode we open 2 resources as diff
		if (diffMode && resources.length === 2 && resources[0].resource && resources[1].resource) {
			return this.editorService.openEditor({ leftResource: resources[0].resource, rightResource: resources[1].resource, options: { pinned: true } });
		}

		// For one file, just put it into the current active editor
		if (resources.length === 1) {
			return this.editorService.openEditor(resources[0]);
		}

		// Otherwise open all
		return this.editorService.openEditors(resources);
	}
}
