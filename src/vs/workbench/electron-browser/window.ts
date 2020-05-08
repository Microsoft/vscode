/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import * as errors from 'vs/base/common/errors';
import { equals, deepClone } from 'vs/base/common/objects';
import * as DOM from 'vs/base/browser/dom';
import { Separator } from 'vs/base/browser/ui/actionbar/actionbar';
import { IAction } from 'vs/base/common/actions';
import { IFileService } from 'vs/platform/files/common/files';
import { toResource, IUntitledTextResourceEditorInput, SideBySideEditor, pathsToEditors } from 'vs/workbench/common/editor';
import { IEditorService, IResourceEditorInputType } from 'vs/workbench/services/editor/common/editorService';
import { ITelemetryService, crashReporterIdStorageKey } from 'vs/platform/telemetry/common/telemetry';
import { IWindowSettings, IOpenFileRequest, IWindowsConfiguration, getTitleBarStyle } from 'vs/platform/windows/common/windows';
import { IRunActionInWindowRequest, IRunKeybindingInWindowRequest, IAddFoldersRequest, INativeOpenFileRequest } from 'vs/platform/windows/node/window';
import { ITitleService } from 'vs/workbench/services/title/common/titleService';
import { IWorkbenchThemeService, VS_HC_THEME } from 'vs/workbench/services/themes/common/workbenchThemeService';
import * as browser from 'vs/base/browser/browser';
import { ICommandService, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IResourceEditorInput } from 'vs/platform/editor/common/editor';
import { KeyboardMapperFactory } from 'vs/workbench/services/keybinding/electron-browser/nativeKeymapService';
import { ipcRenderer as ipc, webFrame, crashReporter, CrashReporterStartOptions, Event as IpcEvent } from 'electron';
import { IWorkspaceEditingService } from 'vs/workbench/services/workspaces/common/workspaceEditing';
import { IMenuService, MenuId, IMenu, MenuItemAction, ICommandAction, SubmenuItemAction, MenuRegistry } from 'vs/platform/actions/common/actions';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { createAndFillInActionBarActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { RunOnceScheduler } from 'vs/base/common/async';
import { IDisposable, Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { LifecyclePhase, ILifecycleService } from 'vs/platform/lifecycle/common/lifecycle';
import { IWorkspaceFolderCreationData, IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { IIntegrityService } from 'vs/workbench/services/integrity/common/integrity';
import { isRootUser, isWindows, isMacintosh, isLinux } from 'vs/base/common/platform';
import product from 'vs/platform/product/common/product';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { EditorServiceImpl } from 'vs/workbench/browser/parts/editor/editor';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IAccessibilityService, AccessibilitySupport } from 'vs/platform/accessibility/common/accessibility';
import { WorkbenchState, IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { coalesce } from 'vs/base/common/arrays';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { isEqual } from 'vs/base/common/resources';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { MenubarControl } from '../browser/parts/titlebar/menubarControl';
import { ILabelService } from 'vs/platform/label/common/label';
import { IUpdateService } from 'vs/platform/update/common/update';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IPreferencesService } from '../services/preferences/common/preferences';
import { IMenubarService, IMenubarData, IMenubarMenu, IMenubarKeybinding, IMenubarMenuItemSubmenu, IMenubarMenuItemAction, MenubarMenuItem } from 'vs/platform/menubar/node/menubar';
import { withNullAsUndefined, assertIsDefined } from 'vs/base/common/types';
import { IOpenerService, OpenOptions } from 'vs/platform/opener/common/opener';
import { Schemas } from 'vs/base/common/network';
import { IElectronService } from 'vs/platform/electron/node/electron';
import { posix, dirname } from 'vs/base/common/path';
import { getBaseLabel } from 'vs/base/common/labels';
import { ITunnelService, extractLocalHostUriMetaDataForPortMapping } from 'vs/platform/remote/common/tunnel';
import { IWorkbenchLayoutService, Parts } from 'vs/workbench/services/layout/browser/layoutService';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IWorkingCopyService, WorkingCopyCapabilities } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { AutoSaveMode, IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { Event } from 'vs/base/common/event';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-browser/environmentService';
import { clearAllFontInfos } from 'vs/editor/browser/config/configuration';

export class NativeWindow extends Disposable {

	private touchBarMenu: IMenu | undefined;
	private readonly touchBarDisposables = this._register(new DisposableStore());
	private lastInstalledTouchedBar: ICommandAction[][] | undefined;

	private readonly customTitleContextMenuDisposable = this._register(new DisposableStore());

	private previousConfiguredZoomLevel: number | undefined;

	private readonly addFoldersScheduler = this._register(new RunOnceScheduler(() => this.doAddFolders(), 100));
	private pendingFoldersToAdd: URI[] = [];

	private readonly closeEmptyWindowScheduler = this._register(new RunOnceScheduler(() => this.onAllEditorsClosed(), 50));

	private isDocumentedEdited = false;

	constructor(
		@IEditorService private readonly editorService: EditorServiceImpl,
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
		@IWorkbenchEnvironmentService private readonly environmentService: INativeWorkbenchEnvironmentService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IElectronService private readonly electronService: IElectronService,
		@ITunnelService private readonly tunnelService: ITunnelService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();

		this.registerListeners();
		this.create();
	}

	private registerListeners(): void {

		// React to editor input changes
		this._register(this.editorService.onDidActiveEditorChange(() => this.updateTouchbarMenu()));

		// prevent opening a real URL inside the shell
		[DOM.EventType.DRAG_OVER, DOM.EventType.DROP].forEach(event => {
			window.document.body.addEventListener(event, (e: DragEvent) => {
				DOM.EventHelper.stop(e);
			});
		});

		// Support runAction event
		ipc.on('vscode:runAction', async (event: IpcEvent, request: IRunActionInWindowRequest) => {
			const args: unknown[] = request.args || [];

			// If we run an action from the touchbar, we fill in the currently active resource
			// as payload because the touch bar items are context aware depending on the editor
			if (request.from === 'touchbar') {
				const activeEditor = this.editorService.activeEditor;
				if (activeEditor) {
					const resource = toResource(activeEditor, { supportSideBySide: SideBySideEditor.MASTER });
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
		ipc.on('vscode:runKeybinding', (event: IpcEvent, request: IRunKeybindingInWindowRequest) => {
			if (document.activeElement) {
				this.keybindingService.dispatchByUserSettingsLabel(request.userSettingsLabel, document.activeElement);
			}
		});

		// Error reporting from main
		ipc.on('vscode:reportError', (event: IpcEvent, error: string) => {
			if (error) {
				errors.onUnexpectedError(JSON.parse(error));
			}
		});

		// Support openFiles event for existing and new files
		ipc.on('vscode:openFiles', (event: IpcEvent, request: IOpenFileRequest) => this.onOpenFiles(request));

		// Support addFolders event if we have a workspace opened
		ipc.on('vscode:addFolders', (event: IpcEvent, request: IAddFoldersRequest) => this.onAddFoldersRequest(request));

		// Message support
		ipc.on('vscode:showInfoMessage', (event: IpcEvent, message: string) => {
			this.notificationService.info(message);
		});

		ipc.on('vscode:displayChanged', (event: IpcEvent) => {
			clearAllFontInfos();
		});

		// Fullscreen Events
		ipc.on('vscode:enterFullScreen', async () => {
			await this.lifecycleService.when(LifecyclePhase.Ready);
			browser.setFullscreen(true);
		});

		ipc.on('vscode:leaveFullScreen', async () => {
			await this.lifecycleService.when(LifecyclePhase.Ready);
			browser.setFullscreen(false);
		});

		// High Contrast Events
		ipc.on('vscode:enterHighContrast', async () => {
			const windowConfig = this.configurationService.getValue<IWindowSettings>('window');
			if (windowConfig?.autoDetectHighContrast) {
				await this.lifecycleService.when(LifecyclePhase.Ready);
				this.themeService.setColorTheme(VS_HC_THEME, undefined);
			}
		});

		ipc.on('vscode:leaveHighContrast', async () => {
			const windowConfig = this.configurationService.getValue<IWindowSettings>('window');
			if (windowConfig?.autoDetectHighContrast) {
				await this.lifecycleService.when(LifecyclePhase.Ready);
				this.themeService.restoreColorTheme();
			}
		});

		// keyboard layout changed event
		ipc.on('vscode:keyboardLayoutChanged', () => {
			KeyboardMapperFactory.INSTANCE._onKeyboardLayoutChanged();
		});

		// accessibility support changed event
		ipc.on('vscode:accessibilitySupportChanged', (event: IpcEvent, accessibilitySupportEnabled: boolean) => {
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
		this._register(this.editorService.onDidVisibleEditorsChange(() => this.onDidVisibleEditorsChange()));

		// Listen to editor closing (if we run with --wait)
		const filesToWait = this.environmentService.configuration.filesToWait;
		if (filesToWait) {
			const waitMarkerFile = filesToWait.waitMarkerFileUri;
			const resourcesToWaitFor = coalesce(filesToWait.paths.map(p => p.fileUri));

			this._register(this.trackClosedWaitFiles(waitMarkerFile, resourcesToWaitFor));
		}

		// macOS OS integration
		if (isMacintosh) {
			this._register(this.editorService.onDidActiveEditorChange(() => {
				const file = toResource(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.MASTER, filterByScheme: Schemas.file });

				// Represented Filename
				this.updateRepresentedFilename(file?.fsPath);

				// Custom title menu
				this.provideCustomTitleContextMenu(file?.fsPath);
			}));
		}

		// Maximize/Restore on doubleclick (for macOS custom title)
		if (isMacintosh && getTitleBarStyle(this.configurationService, this.environmentService) === 'custom') {
			const titlePart = assertIsDefined(this.layoutService.getContainer(Parts.TITLEBAR_PART));

			this._register(DOM.addDisposableListener(titlePart, DOM.EventType.DBLCLICK, e => {
				DOM.EventHelper.stop(e);

				this.electronService.handleTitleDoubleClick();
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
			Event.map(Event.filter(this.electronService.onWindowMaximize, id => id === this.environmentService.configuration.windowId), () => true),
			Event.map(Event.filter(this.electronService.onWindowUnmaximize, id => id === this.environmentService.configuration.windowId), () => false)
		)(e => this.onDidChangeMaximized(e)));

		this.onDidChangeMaximized(this.environmentService.configuration.maximized ?? false);
	}

	private updateDocumentEdited(isDirty = this.workingCopyService.hasDirty): void {
		if ((!this.isDocumentedEdited && isDirty) || (this.isDocumentedEdited && !isDirty)) {
			this.isDocumentedEdited = isDirty;

			this.electronService.setDocumentEdited(isDirty);
		}
	}

	private onDidChangeMaximized(maximized: boolean): void {
		this.layoutService.updateWindowMaximizedState(maximized);
	}

	private onDidVisibleEditorsChange(): void {

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

	private onAllEditorsClosed(): void {
		const visibleEditorPanes = this.editorService.visibleEditorPanes.length;
		if (visibleEditorPanes === 0) {
			this.electronService.closeWindow();
		}
	}

	private updateWindowZoomLevel(): void {
		const windowConfig: IWindowsConfiguration = this.configurationService.getValue<IWindowsConfiguration>();

		let newZoomLevel = 0;
		if (windowConfig.window && typeof windowConfig.window.zoomLevel === 'number') {
			newZoomLevel = windowConfig.window.zoomLevel;

			// Leave early if the configured zoom level did not change (https://github.com/Microsoft/vscode/issues/1536)
			if (this.previousConfiguredZoomLevel === newZoomLevel) {
				return;
			}

			this.previousConfiguredZoomLevel = newZoomLevel;
		}

		if (webFrame.getZoomLevel() !== newZoomLevel) {
			webFrame.setZoomLevel(newZoomLevel);
			browser.setZoomFactor(webFrame.getZoomFactor());
			// See https://github.com/Microsoft/vscode/issues/26151
			// Cannot be trusted because the webFrame might take some time
			// until it really applies the new zoom level
			browser.setZoomLevel(webFrame.getZoomLevel(), /*isTrusted*/false);
		}
	}

	private updateRepresentedFilename(filePath: string | undefined): void {
		this.electronService.setRepresentedFilename(filePath ? filePath : '');
	}

	private provideCustomTitleContextMenu(filePath: string | undefined): void {

		// Clear old menu
		this.customTitleContextMenuDisposable.clear();

		// Provide new menu if a file is opened and we are on a custom title
		if (!filePath || getTitleBarStyle(this.configurationService, this.environmentService) !== 'custom') {
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
			this.customTitleContextMenuDisposable.add(CommandsRegistry.registerCommand(commandId, () => this.electronService.showItemInFolder(path)));
			this.customTitleContextMenuDisposable.add(MenuRegistry.appendMenuItem(MenuId.TitleBarContext, { command: { id: commandId, title: label || posix.sep }, order: -i }));
		}
	}

	private create(): void {

		// Native menu controller
		if (isMacintosh || getTitleBarStyle(this.configurationService, this.environmentService) === 'native') {
			this._register(this.instantiationService.createInstance(NativeMenubarControl));
		}

		// Handle open calls
		this.setupOpenHandlers();

		// Emit event when vscode is ready
		this.lifecycleService.when(LifecyclePhase.Ready).then(() => ipc.send('vscode:workbenchReady', this.environmentService.configuration.windowId));

		// Integrity warning
		this.integrityService.isPure().then(res => this.titleService.updateProperties({ isPure: res.isPure }));

		// Root warning
		this.lifecycleService.when(LifecyclePhase.Restored).then(async () => {
			let isAdmin: boolean;
			if (isWindows) {
				isAdmin = (await import('native-is-elevated'))();
			} else {
				isAdmin = isRootUser();
			}

			// Update title
			this.titleService.updateProperties({ isAdmin });

			// Show warning message (unix only)
			if (isAdmin && !isWindows) {
				this.notificationService.warn(nls.localize('runningAsRoot', "It is not recommended to run {0} as root user.", product.nameShort));
			}
		});

		// Touchbar menu (if enabled)
		this.updateTouchbarMenu();

		// Crash reporter (if enabled)
		if (!this.environmentService.disableCrashReporter && this.configurationService.getValue('telemetry.enableCrashReporter')) {
			const companyName = product.crashReporter?.companyName || 'Microsoft';
			const productName = product.crashReporter?.productName || product.nameShort;

			// With appCenter enabled, crashes will be uploaded
			if (product.appCenter) {
				this.setupCrashReporter(companyName, productName, product.appCenter, undefined);
			}

			// With a provided crash reporter directory, crashes
			// will be stored only locally in that folder
			else if (this.environmentService.crashReporterDirectory) {
				this.setupCrashReporter(companyName, productName, undefined, this.environmentService.crashReporterDirectory);
			}
		}
	}

	private setupOpenHandlers(): void {

		// Block window.open() calls
		window.open = function (): Window | null {
			throw new Error('Prevented call to window.open(). Use IOpenerService instead!');
		};

		// Handle external open() calls
		this.openerService.setExternalOpener({
			openExternal: async (href: string) => {
				const success = await this.electronService.openExternal(href);
				if (!success) {
					const fileCandidate = URI.parse(href);
					if (fileCandidate.scheme === Schemas.file) {
						// if opening failed, and this is a file, we can still try to reveal it
						await this.electronService.showItemInFolder(fileCandidate.fsPath);
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
						const tunnel = await this.tunnelService.openTunnel(undefined, portMappingRequest.port);
						if (tunnel) {
							return {
								resolved: uri.with({ authority: `127.0.0.1:${tunnel.tunnelLocalPort}` }),
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
			this.touchBarMenu = this.editorService.invokeWithinEditorContext(accessor => this.menuService.createMenu(MenuId.TouchBarContext, accessor.get(IContextKeyService)));
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
			this.electronService.updateTouchBar(items);
		}
	}

	private async setupCrashReporter(companyName: string, productName: string, appCenter: typeof product.appCenter, crashesDirectory: undefined): Promise<void>;
	private async setupCrashReporter(companyName: string, productName: string, appCenter: undefined, crashesDirectory: string): Promise<void>;
	private async setupCrashReporter(companyName: string, productName: string, appCenter: typeof product.appCenter | undefined, crashesDirectory: string | undefined): Promise<void> {
		let submitURL: string | undefined = undefined;
		if (appCenter) {
			submitURL = isWindows ? appCenter[process.arch === 'ia32' ? 'win32-ia32' : 'win32-x64'] : isLinux ? appCenter[`linux-x64`] : appCenter.darwin;
		}

		const info = await this.telemetryService.getTelemetryInfo();
		const crashReporterId = this.storageService.get(crashReporterIdStorageKey, StorageScope.GLOBAL)!;

		// base options with product info
		const options: CrashReporterStartOptions = {
			companyName,
			productName,
			submitURL: (submitURL?.concat('&uid=', crashReporterId, '&iid=', crashReporterId, '&sid=', info.sessionId)) || '',
			extra: {
				vscode_version: product.version,
				vscode_commit: product.commit || ''
			},

			// If `crashesDirectory` is specified, we do not upload
			uploadToServer: !crashesDirectory,
		};

		// start crash reporter in the main process first.
		// On windows crashpad excepts a name pipe for the client to connect,
		// this pipe is created by crash reporter initialization from the main process,
		// changing this order of initialization will cause issues.
		// For more info: https://chromium.googlesource.com/crashpad/crashpad/+/HEAD/doc/overview_design.md#normal-registration
		await this.electronService.startCrashReporter(options);

		// start crash reporter right here
		crashReporter.start(deepClone(options));
	}

	private onAddFoldersRequest(request: IAddFoldersRequest): void {

		// Buffer all pending requests
		this.pendingFoldersToAdd.push(...request.foldersToAdd.map(f => URI.revive(f)));

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
			const waitMarkerFile = URI.revive(request.filesToWait.waitMarkerFileUri);
			const resourcesToWaitFor = coalesce(request.filesToWait.paths.map(p => URI.revive(p.fileUri)));
			this.trackClosedWaitFiles(waitMarkerFile, resourcesToWaitFor);
		}
	}

	private trackClosedWaitFiles(waitMarkerFile: URI, resourcesToWaitFor: URI[]): IDisposable {
		let remainingResourcesToWaitFor = resourcesToWaitFor.slice(0);

		// In wait mode, listen to changes to the editors and wait until the files
		// are closed that the user wants to wait for. When this happens we delete
		// the wait marker file to signal to the outside that editing is done.
		const listener = this.editorService.onDidCloseEditor(async event => {
			const detailsResource = toResource(event.editor, { supportSideBySide: SideBySideEditor.DETAILS });
			const masterResource = toResource(event.editor, { supportSideBySide: SideBySideEditor.MASTER });

			// Remove from resources to wait for based on the
			// resources from editors that got closed
			remainingResourcesToWaitFor = remainingResourcesToWaitFor.filter(resourceToWaitFor => {
				if (isEqual(resourceToWaitFor, masterResource) || isEqual(resourceToWaitFor, detailsResource)) {
					return false; // remove - the closing editor matches this resource
				}

				return true; // keep - not yet closed
			});

			if (remainingResourcesToWaitFor.length === 0) {
				// If auto save is configured with the default delay (1s) it is possible
				// to close the editor while the save still continues in the background. As such
				// we have to also check if the files to wait for are dirty and if so wait
				// for them to get saved before deleting the wait marker file.
				const dirtyFilesToWait = resourcesToWaitFor.filter(resourceToWaitFor => this.workingCopyService.isDirty(resourceToWaitFor));
				if (dirtyFilesToWait.length > 0) {
					await Promise.all(dirtyFilesToWait.map(async dirtyFileToWait => await this.joinResourceSaved(dirtyFileToWait)));
				}

				listener.dispose();
				await this.fileService.del(waitMarkerFile);
			}
		});

		return listener;
	}

	private joinResourceSaved(resource: URI): Promise<void> {
		return new Promise(resolve => {
			if (!this.workingCopyService.isDirty(resource)) {
				return resolve(); // return early if resource is not dirty
			}

			// Otherwise resolve promise when resource is saved
			const listener = this.workingCopyService.onDidChangeDirty(workingCopy => {
				if (!workingCopy.isDirty() && isEqual(resource, workingCopy.resource)) {
					listener.dispose();

					resolve();
				}
			});
		});
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

class NativeMenubarControl extends MenubarControl {
	constructor(
		@IMenuService menuService: IMenuService,
		@IWorkspacesService workspacesService: IWorkspacesService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IConfigurationService configurationService: IConfigurationService,
		@ILabelService labelService: ILabelService,
		@IUpdateService updateService: IUpdateService,
		@IStorageService storageService: IStorageService,
		@INotificationService notificationService: INotificationService,
		@IPreferencesService preferencesService: IPreferencesService,
		@IWorkbenchEnvironmentService protected readonly environmentService: INativeWorkbenchEnvironmentService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@IMenubarService private readonly menubarService: IMenubarService,
		@IHostService hostService: IHostService,
	) {
		super(
			menuService,
			workspacesService,
			contextKeyService,
			keybindingService,
			configurationService,
			labelService,
			updateService,
			storageService,
			notificationService,
			preferencesService,
			environmentService,
			accessibilityService,
			hostService
		);

		if (isMacintosh) {
			this.menus['Preferences'] = this._register(this.menuService.createMenu(MenuId.MenubarPreferencesMenu, this.contextKeyService));
			this.topLevelTitles['Preferences'] = nls.localize('mPreferences', "Preferences");
		}

		for (const topLevelMenuName of Object.keys(this.topLevelTitles)) {
			const menu = this.menus[topLevelMenuName];
			if (menu) {
				this._register(menu.onDidChange(() => this.updateMenubar()));
			}
		}

		(async () => {
			this.recentlyOpened = await this.workspacesService.getRecentlyOpened();

			this.doUpdateMenubar(true);
		})();

		this.registerListeners();
	}

	protected doUpdateMenubar(firstTime: boolean): void {
		// Since the native menubar is shared between windows (main process)
		// only allow the focused window to update the menubar
		if (!this.hostService.hasFocus) {
			return;
		}

		// Send menus to main process to be rendered by Electron
		const menubarData = { menus: {}, keybindings: {} };
		if (this.getMenubarMenus(menubarData)) {
			this.menubarService.updateMenubar(this.environmentService.configuration.windowId, menubarData);
		}
	}

	private getMenubarMenus(menubarData: IMenubarData): boolean {
		if (!menubarData) {
			return false;
		}

		menubarData.keybindings = this.getAdditionalKeybindings();
		for (const topLevelMenuName of Object.keys(this.topLevelTitles)) {
			const menu = this.menus[topLevelMenuName];
			if (menu) {
				const menubarMenu: IMenubarMenu = { items: [] };
				this.populateMenuItems(menu, menubarMenu, menubarData.keybindings);
				if (menubarMenu.items.length === 0) {
					return false; // Menus are incomplete
				}
				menubarData.menus[topLevelMenuName] = menubarMenu;
			}
		}

		return true;
	}

	private populateMenuItems(menu: IMenu, menuToPopulate: IMenubarMenu, keybindings: { [id: string]: IMenubarKeybinding | undefined }) {
		let groups = menu.getActions();
		for (let group of groups) {
			const [, actions] = group;

			actions.forEach(menuItem => {

				if (menuItem instanceof SubmenuItemAction) {
					const submenu = { items: [] };

					if (!this.menus[menuItem.item.submenu.id]) {
						const menu = this.menus[menuItem.item.submenu.id] = this.menuService.createMenu(menuItem.item.submenu, this.contextKeyService);
						this._register(menu.onDidChange(() => this.updateMenubar()));
					}

					const menuToDispose = this.menuService.createMenu(menuItem.item.submenu, this.contextKeyService);
					this.populateMenuItems(menuToDispose, submenu, keybindings);

					let menubarSubmenuItem: IMenubarMenuItemSubmenu = {
						id: menuItem.id,
						label: menuItem.label,
						submenu: submenu
					};

					menuToPopulate.items.push(menubarSubmenuItem);
					menuToDispose.dispose();
				} else {
					if (menuItem.id === 'workbench.action.openRecent') {
						const actions = this.getOpenRecentActions().map(this.transformOpenRecentAction);
						menuToPopulate.items.push(...actions);
					}

					let menubarMenuItem: IMenubarMenuItemAction = {
						id: menuItem.id,
						label: menuItem.label
					};

					if (menuItem.checked) {
						menubarMenuItem.checked = true;
					}

					if (!menuItem.enabled) {
						menubarMenuItem.enabled = false;
					}

					menubarMenuItem.label = this.calculateActionLabel(menubarMenuItem);
					keybindings[menuItem.id] = this.getMenubarKeybinding(menuItem.id);
					menuToPopulate.items.push(menubarMenuItem);
				}
			});

			menuToPopulate.items.push({ id: 'vscode.menubar.separator' });
		}

		if (menuToPopulate.items.length > 0) {
			menuToPopulate.items.pop();
		}
	}

	private transformOpenRecentAction(action: Separator | (IAction & { uri: URI })): MenubarMenuItem {
		if (action instanceof Separator) {
			return { id: 'vscode.menubar.separator' };
		}

		return {
			id: action.id,
			uri: action.uri,
			enabled: action.enabled,
			label: action.label
		};
	}

	private getAdditionalKeybindings(): { [id: string]: IMenubarKeybinding } {
		const keybindings: { [id: string]: IMenubarKeybinding } = {};
		if (isMacintosh) {
			const keybinding = this.getMenubarKeybinding('workbench.action.quit');
			if (keybinding) {
				keybindings['workbench.action.quit'] = keybinding;
			}
		}

		return keybindings;
	}

	private getMenubarKeybinding(id: string): IMenubarKeybinding | undefined {
		const binding = this.keybindingService.lookupKeybinding(id);
		if (!binding) {
			return undefined;
		}

		// first try to resolve a native accelerator
		const electronAccelerator = binding.getElectronAccelerator();
		if (electronAccelerator) {
			return { label: electronAccelerator, userSettingsLabel: withNullAsUndefined(binding.getUserSettingsLabel()) };
		}

		// we need this fallback to support keybindings that cannot show in electron menus (e.g. chords)
		const acceleratorLabel = binding.getLabel();
		if (acceleratorLabel) {
			return { label: acceleratorLabel, isNative: false, userSettingsLabel: withNullAsUndefined(binding.getUserSettingsLabel()) };
		}

		return undefined;
	}
}
