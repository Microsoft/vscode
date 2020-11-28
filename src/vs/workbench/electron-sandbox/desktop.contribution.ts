/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from 'vs/platform/registry/common/platform';
import * as nls from 'vs/nls';
import { SyncActionDescriptor, MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { IWorkbenchActionRegistry, Extensions, CATEGORIES } from 'vs/workbench/common/actions';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { isLinux, isMacintosh } from 'vs/base/common/platform';
import { ToggleDevToolsAction, ConfigureRuntimeArgumentsAction } from 'vs/workbench/electron-sandbox/actions/developerActions';
import { ZoomResetAction, ZoomOutAction, ZoomInAction, CloseCurrentWindowAction, SwitchWindow, QuickSwitchWindow, ReloadWindowWithExtensionsDisabledAction, NewWindowTabHandler, ShowPreviousWindowTabHandler, ShowNextWindowTabHandler, MoveWindowTabToNewWindowHandler, MergeWindowTabsHandlerHandler, ToggleWindowTabsBarHandler } from 'vs/workbench/electron-sandbox/actions/windowActions';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IsDevelopmentContext, IsMacContext } from 'vs/platform/contextkey/common/contextkeys';
import { EditorsVisibleContext, SingleEditorGroupsContext } from 'vs/workbench/common/editor';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { IJSONContributionRegistry, Extensions as JSONExtensions } from 'vs/platform/jsonschemas/common/jsonContributionRegistry';
import product from 'vs/platform/product/common/product';
import { IJSONSchema } from 'vs/base/common/jsonSchema';

// Actions
(function registerActions(): void {
	const registry = Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions);

	// Actions: Zoom
	(function registerZoomActions(): void {
		registry.registerWorkbenchAction(SyncActionDescriptor.from(ZoomInAction, { primary: KeyMod.CtrlCmd | KeyCode.US_EQUAL, secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_EQUAL, KeyMod.CtrlCmd | KeyCode.NUMPAD_ADD] }), 'View: Zoom In', CATEGORIES.View.value);
		registry.registerWorkbenchAction(SyncActionDescriptor.from(ZoomOutAction, { primary: KeyMod.CtrlCmd | KeyCode.US_MINUS, secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_MINUS, KeyMod.CtrlCmd | KeyCode.NUMPAD_SUBTRACT], linux: { primary: KeyMod.CtrlCmd | KeyCode.US_MINUS, secondary: [KeyMod.CtrlCmd | KeyCode.NUMPAD_SUBTRACT] } }), 'View: Zoom Out', CATEGORIES.View.value);
		registry.registerWorkbenchAction(SyncActionDescriptor.from(ZoomResetAction, { primary: KeyMod.CtrlCmd | KeyCode.NUMPAD_0 }), 'View: Reset Zoom', CATEGORIES.View.value);
	})();

	// Actions: Window
	(function registerWindowActions(): void {
		registry.registerWorkbenchAction(SyncActionDescriptor.from(CloseCurrentWindowAction, { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_W }), 'Close Window');
		registry.registerWorkbenchAction(SyncActionDescriptor.from(SwitchWindow, { primary: 0, mac: { primary: KeyMod.WinCtrl | KeyCode.KEY_W } }), 'Switch Window...');
		registry.registerWorkbenchAction(SyncActionDescriptor.from(QuickSwitchWindow), 'Quick Switch Window...');

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: CloseCurrentWindowAction.ID, // close the window when the last editor is closed by reusing the same keybinding
			weight: KeybindingWeight.WorkbenchContrib,
			when: ContextKeyExpr.and(EditorsVisibleContext.toNegated(), SingleEditorGroupsContext),
			primary: KeyMod.CtrlCmd | KeyCode.KEY_W,
			handler: accessor => {
				const nativeHostService = accessor.get(INativeHostService);
				nativeHostService.closeWindow();
			}
		});

		KeybindingsRegistry.registerCommandAndKeybindingRule({
			id: 'workbench.action.quit',
			weight: KeybindingWeight.WorkbenchContrib,
			handler(accessor: ServicesAccessor) {
				const nativeHostService = accessor.get(INativeHostService);
				nativeHostService.quit();
			},
			when: undefined,
			mac: { primary: KeyMod.CtrlCmd | KeyCode.KEY_Q },
			linux: { primary: KeyMod.CtrlCmd | KeyCode.KEY_Q }
		});
	})();

	// Actions: macOS Native Tabs
	(function registerMacOSNativeTabsActions(): void {
		if (isMacintosh) {
			[
				{ handler: NewWindowTabHandler, id: 'workbench.action.newWindowTab', title: { value: nls.localize('newTab', "New Window Tab"), original: 'New Window Tab' } },
				{ handler: ShowPreviousWindowTabHandler, id: 'workbench.action.showPreviousWindowTab', title: { value: nls.localize('showPreviousTab', "Show Previous Window Tab"), original: 'Show Previous Window Tab' } },
				{ handler: ShowNextWindowTabHandler, id: 'workbench.action.showNextWindowTab', title: { value: nls.localize('showNextWindowTab', "Show Next Window Tab"), original: 'Show Next Window Tab' } },
				{ handler: MoveWindowTabToNewWindowHandler, id: 'workbench.action.moveWindowTabToNewWindow', title: { value: nls.localize('moveWindowTabToNewWindow', "Move Window Tab to New Window"), original: 'Move Window Tab to New Window' } },
				{ handler: MergeWindowTabsHandlerHandler, id: 'workbench.action.mergeAllWindowTabs', title: { value: nls.localize('mergeAllWindowTabs', "Merge All Windows"), original: 'Merge All Windows' } },
				{ handler: ToggleWindowTabsBarHandler, id: 'workbench.action.toggleWindowTabsBar', title: { value: nls.localize('toggleWindowTabsBar', "Toggle Window Tabs Bar"), original: 'Toggle Window Tabs Bar' } }
			].forEach(command => {
				CommandsRegistry.registerCommand(command.id, command.handler);

				MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
					command,
					when: ContextKeyExpr.equals('config.window.nativeTabs', true)
				});
			});
		}
	})();

	// Actions: Developer
	(function registerDeveloperActions(): void {
		registry.registerWorkbenchAction(SyncActionDescriptor.from(ReloadWindowWithExtensionsDisabledAction), 'Developer: Reload With Extensions Disabled', CATEGORIES.Developer.value);
		registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleDevToolsAction), 'Developer: Toggle Developer Tools', CATEGORIES.Developer.value);

		KeybindingsRegistry.registerKeybindingRule({
			id: ToggleDevToolsAction.ID,
			weight: KeybindingWeight.WorkbenchContrib + 50,
			when: IsDevelopmentContext,
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_I,
			mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_I }
		});
	})();

	// Actions: Runtime Arguments
	(function registerRuntimeArgumentsAction(): void {
		const preferencesCategory = nls.localize('preferences', "Preferences");
		registry.registerWorkbenchAction(SyncActionDescriptor.from(ConfigureRuntimeArgumentsAction), 'Preferences: Configure Runtime Arguments', preferencesCategory);
	})();
})();

// Menu
(function registerMenu(): void {
	MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
		group: '6_close',
		command: {
			id: CloseCurrentWindowAction.ID,
			title: nls.localize({ key: 'miCloseWindow', comment: ['&& denotes a mnemonic'] }, "Clos&&e Window")
		},
		order: 4
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
		group: 'z_Exit',
		command: {
			id: 'workbench.action.quit',
			title: nls.localize({ key: 'miExit', comment: ['&& denotes a mnemonic'] }, "E&&xit")
		},
		order: 1,
		when: IsMacContext.toNegated()
	});

	// Zoom

	MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
		group: '3_zoom',
		command: {
			id: ZoomInAction.ID,
			title: nls.localize({ key: 'miZoomIn', comment: ['&& denotes a mnemonic'] }, "&&Zoom In")
		},
		order: 1
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
		group: '3_zoom',
		command: {
			id: ZoomOutAction.ID,
			title: nls.localize({ key: 'miZoomOut', comment: ['&& denotes a mnemonic'] }, "&&Zoom Out")
		},
		order: 2
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
		group: '3_zoom',
		command: {
			id: ZoomResetAction.ID,
			title: nls.localize({ key: 'miZoomReset', comment: ['&& denotes a mnemonic'] }, "&&Reset Zoom")
		},
		order: 3
	});

	if (!!product.reportIssueUrl) {
		MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
			group: '3_feedback',
			command: {
				id: 'workbench.action.openIssueReporter',
				title: nls.localize({ key: 'miReportIssue', comment: ['&& denotes a mnemonic', 'Translate this to "Report Issue in English" in all languages please!'] }, "Report &&Issue")
			},
			order: 3
		});
	}

	// Tools
	MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
		group: '5_tools',
		command: {
			id: ToggleDevToolsAction.ID,
			title: nls.localize({ key: 'miToggleDevTools', comment: ['&& denotes a mnemonic'] }, "&&Toggle Developer Tools")
		},
		order: 1
	});

	MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
		group: '5_tools',
		command: {
			id: 'workbench.action.openProcessExplorer',
			title: nls.localize({ key: 'miOpenProcessExplorerer', comment: ['&& denotes a mnemonic'] }, "Open &&Process Explorer")
		},
		order: 2
	});
})();

// Configuration
(function registerConfiguration(): void {
	const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

	// Window
	registry.registerConfiguration({
		'id': 'window',
		'order': 8,
		'title': nls.localize('windowConfigurationTitle', "Window"),
		'type': 'object',
		'properties': {
			'window.openWithoutArgumentsInNewWindow': {
				'type': 'string',
				'enum': ['on', 'off'],
				'enumDescriptions': [
					nls.localize('window.openWithoutArgumentsInNewWindow.on', "Open a new empty window."),
					nls.localize('window.openWithoutArgumentsInNewWindow.off', "Focus the last active running instance.")
				],
				'default': isMacintosh ? 'off' : 'on',
				'scope': ConfigurationScope.APPLICATION,
				'markdownDescription': nls.localize('openWithoutArgumentsInNewWindow', "Controls whether a new empty window should open when starting a second instance without arguments or if the last running instance should get focus.\nNote that there can still be cases where this setting is ignored (e.g. when using the `--new-window` or `--reuse-window` command line option).")
			},
			'window.restoreWindows': {
				'type': 'string',
				'enum': ['preserve', 'all', 'folders', 'one', 'none'],
				'enumDescriptions': [
					nls.localize('window.reopenFolders.preserve', "Reopen all windows. If a folder or workspace is opened (e.g. from the command line) it opens as new window. Files will open in one of the restored windows."),
					nls.localize('window.reopenFolders.all', "Reopen all windows unless a folder, workspace or file is opened (e.g. from the command line)."),
					nls.localize('window.reopenFolders.folders', "Reopen all windows that had folders or workspaces opened unless a folder, workspace or file is opened (e.g. from the command line)."),
					nls.localize('window.reopenFolders.one', "Reopen the last active window unless a folder, workspace or file is opened (e.g. from the command line)."),
					nls.localize('window.reopenFolders.none', "Never reopen a window. Unless a folder or workspace is opened (e.g. from the command line), an empty window will appear.")
				],
				'default': 'all',
				'scope': ConfigurationScope.APPLICATION,
				'description': nls.localize('restoreWindows', "Controls how windows are being reopened after starting for the first time. This setting has no effect when the application is already running.")
			},
			'window.restoreFullscreen': {
				'type': 'boolean',
				'default': false,
				'scope': ConfigurationScope.APPLICATION,
				'description': nls.localize('restoreFullscreen', "Controls whether a window should restore to full screen mode if it was exited in full screen mode.")
			},
			'window.zoomLevel': {
				'type': 'number',
				'default': 0,
				'description': nls.localize('zoomLevel', "Adjust the zoom level of the window. The original size is 0 and each increment above (e.g. 1) or below (e.g. -1) represents zooming 20% larger or smaller. You can also enter decimals to adjust the zoom level with a finer granularity.")
			},
			'window.newWindowDimensions': {
				'type': 'string',
				'enum': ['default', 'inherit', 'offset', 'maximized', 'fullscreen'],
				'enumDescriptions': [
					nls.localize('window.newWindowDimensions.default', "Open new windows in the center of the screen."),
					nls.localize('window.newWindowDimensions.inherit', "Open new windows with same dimension as last active one."),
					nls.localize('window.newWindowDimensions.offset', "Open new windows with same dimension as last active one with an offset position."),
					nls.localize('window.newWindowDimensions.maximized', "Open new windows maximized."),
					nls.localize('window.newWindowDimensions.fullscreen', "Open new windows in full screen mode.")
				],
				'default': 'default',
				'scope': ConfigurationScope.APPLICATION,
				'description': nls.localize('newWindowDimensions', "Controls the dimensions of opening a new window when at least one window is already opened. Note that this setting does not have an impact on the first window that is opened. The first window will always restore the size and location as you left it before closing.")
			},
			'window.closeWhenEmpty': {
				'type': 'boolean',
				'default': false,
				'description': nls.localize('closeWhenEmpty', "Controls whether closing the last editor should also close the window. This setting only applies for windows that do not show folders.")
			},
			'window.doubleClickIconToClose': {
				'type': 'boolean',
				'default': false,
				'scope': ConfigurationScope.APPLICATION,
				'markdownDescription': nls.localize('window.doubleClickIconToClose', "If enabled, double clicking the application icon in the title bar will close the window and the window cannot be dragged by the icon. This setting only has an effect when `#window.titleBarStyle#` is set to `custom`.")
			},
			'window.titleBarStyle': {
				'type': 'string',
				'enum': ['native', 'custom'],
				'default': isLinux ? 'native' : 'custom',
				'scope': ConfigurationScope.APPLICATION,
				'description': nls.localize('titleBarStyle', "Adjust the appearance of the window title bar. On Linux and Windows, this setting also affects the application and context menu appearances. Changes require a full restart to apply.")
			},
			'window.dialogStyle': {
				'type': 'string',
				'enum': ['native', 'custom'],
				'default': 'native',
				'scope': ConfigurationScope.APPLICATION,
				'description': nls.localize('dialogStyle', "Adjust the appearance of dialog windows.")
			},
			'window.nativeTabs': {
				'type': 'boolean',
				'default': false,
				'scope': ConfigurationScope.APPLICATION,
				'description': nls.localize('window.nativeTabs', "Enables macOS Sierra window tabs. Note that changes require a full restart to apply and that native tabs will disable a custom title bar style if configured."),
				'included': isMacintosh
			},
			'window.nativeFullScreen': {
				'type': 'boolean',
				'default': true,
				'description': nls.localize('window.nativeFullScreen', "Controls if native full-screen should be used on macOS. Disable this option to prevent macOS from creating a new space when going full-screen."),
				'scope': ConfigurationScope.APPLICATION,
				'included': isMacintosh
			},
			'window.clickThroughInactive': {
				'type': 'boolean',
				'default': true,
				'scope': ConfigurationScope.APPLICATION,
				'description': nls.localize('window.clickThroughInactive', "If enabled, clicking on an inactive window will both activate the window and trigger the element under the mouse if it is clickable. If disabled, clicking anywhere on an inactive window will activate it only and a second click is required on the element."),
				'included': isMacintosh
			},
			'window.enableExperimentalProxyLoginDialog': {
				'type': 'boolean',
				'default': true,
				'scope': ConfigurationScope.APPLICATION,
				'description': nls.localize('window.enableExperimentalProxyLoginDialog', "Enables a new login dialog for proxy authentication. Requires a restart to take effect."),
			}
		}
	});

	// Telemetry
	registry.registerConfiguration({
		'id': 'telemetry',
		'order': 110,
		title: nls.localize('telemetryConfigurationTitle', "Telemetry"),
		'type': 'object',
		'properties': {
			'telemetry.enableCrashReporter': {
				'type': 'boolean',
				'description': nls.localize('telemetry.enableCrashReporting', "Enable crash reports to be sent to a Microsoft online service. \nThis option requires restart to take effect."),
				'default': true,
				'tags': ['usesOnlineServices']
			}
		}
	});

	// Keybinding
	registry.registerConfiguration({
		'id': 'keyboard',
		'order': 15,
		'type': 'object',
		'title': nls.localize('keyboardConfigurationTitle', "Keyboard"),
		'properties': {
			'keyboard.touchbar.enabled': {
				'type': 'boolean',
				'default': true,
				'description': nls.localize('touchbar.enabled', "Enables the macOS touchbar buttons on the keyboard if available."),
				'included': isMacintosh
			},
			'keyboard.touchbar.ignored': {
				'type': 'array',
				'items': {
					'type': 'string'
				},
				'default': [],
				'markdownDescription': nls.localize('touchbar.ignored', 'A set of identifiers for entries in the touchbar that should not show up (for example `workbench.action.navigateBack`.'),
				'included': isMacintosh
			}
		}
	});
})();

// JSON Schemas
(function registerJSONSchemas(): void {
	const argvDefinitionFileSchemaId = 'vscode://schemas/argv';
	const jsonRegistry = Registry.as<IJSONContributionRegistry>(JSONExtensions.JSONContribution);
	const schema: IJSONSchema = {
		id: argvDefinitionFileSchemaId,
		allowComments: true,
		allowTrailingCommas: true,
		description: 'VSCode static command line definition file',
		type: 'object',
		additionalProperties: false,
		properties: {
			locale: {
				type: 'string',
				description: nls.localize('argv.locale', 'The display Language to use. Picking a different language requires the associated language pack to be installed.')
			},
			'disable-hardware-acceleration': {
				type: 'boolean',
				description: nls.localize('argv.disableHardwareAcceleration', 'Disables hardware acceleration. ONLY change this option if you encounter graphic issues.')
			},
			'disable-color-correct-rendering': {
				type: 'boolean',
				description: nls.localize('argv.disableColorCorrectRendering', 'Resolves issues around color profile selection. ONLY change this option if you encounter graphic issues.')
			},
			'force-color-profile': {
				type: 'string',
				markdownDescription: nls.localize('argv.forceColorProfile', 'Allows to override the color profile to use. If you experience colors appear badly, try to set this to `srgb` and restart.')
			},
			'enable-crash-reporter': {
				type: 'boolean',
				markdownDescription: nls.localize('argv.enableCrashReporter', 'Allows to disable crash reporting, should restart the app if the value is changed.')
			},
			'crash-reporter-id': {
				type: 'string',
				markdownDescription: nls.localize('argv.crashReporterId', 'Unique id used for correlating crash reports sent from this app instance.')
			},
			'enable-proposed-api': {
				type: 'array',
				description: nls.localize('argv.enebleProposedApi', "Enable proposed APIs for a list of extension ids (such as \`vscode.git\`). Proposed APIs are unstable and subject to breaking without warning at any time. This should only be set for extension development and testing purposes."),
				items: {
					type: 'string'
				}
			}
		}
	};
	if (isLinux) {
		schema.properties!['force-renderer-accessibility'] = {
			type: 'boolean',
			description: nls.localize('argv.force-renderer-accessibility', 'Forces the renderer to be accessible. ONLY change this if you are using a screen reader on Linux. On other platforms the renderer will automatically be accessible. This flag is automatically set if you have editor.accessibilitySupport: on.'),
		};
	}

	jsonRegistry.registerSchema(argvDefinitionFileSchemaId, schema);
})();
