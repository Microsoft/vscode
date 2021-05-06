/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from 'vs/platform/registry/common/platform';
import { localize } from 'vs/nls';
import { MenuRegistry, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { isLinux, isMacintosh } from 'vs/base/common/platform';
import { ConfigureRuntimeArgumentsAction, ToggleDevToolsAction, ToggleSharedProcessAction, ReloadWindowWithExtensionsDisabledAction } from 'vs/workbench/electron-sandbox/actions/developerActions';
import { ZoomResetAction, ZoomOutAction, ZoomInAction, CloseWindowAction, SwitchWindowAction, QuickSwitchWindowAction, NewWindowTabHandler, ShowPreviousWindowTabHandler, ShowNextWindowTabHandler, MoveWindowTabToNewWindowHandler, MergeWindowTabsHandlerHandler, ToggleWindowTabsBarHandler } from 'vs/workbench/electron-sandbox/actions/windowActions';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IsMacContext } from 'vs/platform/contextkey/common/contextkeys';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { IJSONContributionRegistry, Extensions as JSONExtensions } from 'vs/platform/jsonschemas/common/jsonContributionRegistry';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { PartsSplash } from 'vs/workbench/electron-sandbox/splash';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';

// Actions
(function registerActions(): void {

	// Actions: Zoom
	registerAction2(ZoomInAction);
	registerAction2(ZoomOutAction);
	registerAction2(ZoomResetAction);

	// Actions: Window
	registerAction2(SwitchWindowAction);
	registerAction2(QuickSwitchWindowAction);
	registerAction2(CloseWindowAction);

	// Quit
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

	// Actions: macOS Native Tabs
	if (isMacintosh) {
		[
			{ handler: NewWindowTabHandler, id: 'workbench.action.newWindowTab', title: { value: localize('newTab', "New Window Tab"), original: 'New Window Tab' } },
			{ handler: ShowPreviousWindowTabHandler, id: 'workbench.action.showPreviousWindowTab', title: { value: localize('showPreviousTab', "Show Previous Window Tab"), original: 'Show Previous Window Tab' } },
			{ handler: ShowNextWindowTabHandler, id: 'workbench.action.showNextWindowTab', title: { value: localize('showNextWindowTab', "Show Next Window Tab"), original: 'Show Next Window Tab' } },
			{ handler: MoveWindowTabToNewWindowHandler, id: 'workbench.action.moveWindowTabToNewWindow', title: { value: localize('moveWindowTabToNewWindow', "Move Window Tab to New Window"), original: 'Move Window Tab to New Window' } },
			{ handler: MergeWindowTabsHandlerHandler, id: 'workbench.action.mergeAllWindowTabs', title: { value: localize('mergeAllWindowTabs', "Merge All Windows"), original: 'Merge All Windows' } },
			{ handler: ToggleWindowTabsBarHandler, id: 'workbench.action.toggleWindowTabsBar', title: { value: localize('toggleWindowTabsBar', "Toggle Window Tabs Bar"), original: 'Toggle Window Tabs Bar' } }
		].forEach(command => {
			CommandsRegistry.registerCommand(command.id, command.handler);

			MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
				command,
				when: ContextKeyExpr.equals('config.window.nativeTabs', true)
			});
		});
	}

	// Actions: Developer
	registerAction2(ReloadWindowWithExtensionsDisabledAction);
	registerAction2(ConfigureRuntimeArgumentsAction);
	registerAction2(ToggleSharedProcessAction);
	registerAction2(ToggleDevToolsAction);
})();

// Menu
(function registerMenu(): void {

	// Quit
	MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
		group: 'z_Exit',
		command: {
			id: 'workbench.action.quit',
			title: localize({ key: 'miExit', comment: ['&& denotes a mnemonic'] }, "E&&xit")
		},
		order: 1,
		when: IsMacContext.toNegated()
	});
})();

// Configuration
(function registerConfiguration(): void {
	const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

	// Window
	registry.registerConfiguration({
		'id': 'window',
		'order': 8,
		'title': localize('windowConfigurationTitle', "Window"),
		'type': 'object',
		'properties': {
			'window.openWithoutArgumentsInNewWindow': {
				'type': 'string',
				'enum': ['on', 'off'],
				'enumDescriptions': [
					localize('window.openWithoutArgumentsInNewWindow.on', "Open a new empty window."),
					localize('window.openWithoutArgumentsInNewWindow.off', "Focus the last active running instance.")
				],
				'default': isMacintosh ? 'off' : 'on',
				'scope': ConfigurationScope.APPLICATION,
				'markdownDescription': localize('openWithoutArgumentsInNewWindow', "Controls whether a new empty window should open when starting a second instance without arguments or if the last running instance should get focus.\nNote that there can still be cases where this setting is ignored (e.g. when using the `--new-window` or `--reuse-window` command line option).")
			},
			'window.restoreWindows': {
				'type': 'string',
				'enum': ['preserve', 'all', 'folders', 'one', 'none'],
				'enumDescriptions': [
					localize('window.reopenFolders.preserve', "Always reopen all windows. If a folder or workspace is opened (e.g. from the command line) it opens as a new window unless it was opened before. If files are opened they will open in one of the restored windows."),
					localize('window.reopenFolders.all', "Reopen all windows unless a folder, workspace or file is opened (e.g. from the command line)."),
					localize('window.reopenFolders.folders', "Reopen all windows that had folders or workspaces opened unless a folder, workspace or file is opened (e.g. from the command line)."),
					localize('window.reopenFolders.one', "Reopen the last active window unless a folder, workspace or file is opened (e.g. from the command line)."),
					localize('window.reopenFolders.none', "Never reopen a window. Unless a folder or workspace is opened (e.g. from the command line), an empty window will appear.")
				],
				'default': 'all',
				'scope': ConfigurationScope.APPLICATION,
				'description': localize('restoreWindows', "Controls how windows are being reopened after starting for the first time. This setting has no effect when the application is already running.")
			},
			'window.restoreFullscreen': {
				'type': 'boolean',
				'default': false,
				'scope': ConfigurationScope.APPLICATION,
				'description': localize('restoreFullscreen', "Controls whether a window should restore to full screen mode if it was exited in full screen mode.")
			},
			'window.zoomLevel': {
				'type': 'number',
				'default': 0,
				'description': localize('zoomLevel', "Adjust the zoom level of the window. The original size is 0 and each increment above (e.g. 1) or below (e.g. -1) represents zooming 20% larger or smaller. You can also enter decimals to adjust the zoom level with a finer granularity."),
				ignoreSync: true
			},
			'window.newWindowDimensions': {
				'type': 'string',
				'enum': ['default', 'inherit', 'offset', 'maximized', 'fullscreen'],
				'enumDescriptions': [
					localize('window.newWindowDimensions.default', "Open new windows in the center of the screen."),
					localize('window.newWindowDimensions.inherit', "Open new windows with same dimension as last active one."),
					localize('window.newWindowDimensions.offset', "Open new windows with same dimension as last active one with an offset position."),
					localize('window.newWindowDimensions.maximized', "Open new windows maximized."),
					localize('window.newWindowDimensions.fullscreen', "Open new windows in full screen mode.")
				],
				'default': 'default',
				'scope': ConfigurationScope.APPLICATION,
				'description': localize('newWindowDimensions', "Controls the dimensions of opening a new window when at least one window is already opened. Note that this setting does not have an impact on the first window that is opened. The first window will always restore the size and location as you left it before closing.")
			},
			'window.closeWhenEmpty': {
				'type': 'boolean',
				'default': false,
				'description': localize('closeWhenEmpty', "Controls whether closing the last editor should also close the window. This setting only applies for windows that do not show folders.")
			},
			'window.doubleClickIconToClose': {
				'type': 'boolean',
				'default': false,
				'scope': ConfigurationScope.APPLICATION,
				'markdownDescription': localize('window.doubleClickIconToClose', "If enabled, double clicking the application icon in the title bar will close the window and the window cannot be dragged by the icon. This setting only has an effect when `#window.titleBarStyle#` is set to `custom`.")
			},
			'window.titleBarStyle': {
				'type': 'string',
				'enum': ['native', 'custom'],
				'default': isLinux ? 'native' : 'custom',
				'scope': ConfigurationScope.APPLICATION,
				'description': localize('titleBarStyle', "Adjust the appearance of the window title bar. On Linux and Windows, this setting also affects the application and context menu appearances. Changes require a full restart to apply.")
			},
			'window.dialogStyle': {
				'type': 'string',
				'enum': ['native', 'custom'],
				'default': 'native',
				'scope': ConfigurationScope.APPLICATION,
				'description': localize('dialogStyle', "Adjust the appearance of dialog windows.")
			},
			'window.nativeTabs': {
				'type': 'boolean',
				'default': false,
				'scope': ConfigurationScope.APPLICATION,
				'description': localize('window.nativeTabs', "Enables macOS Sierra window tabs. Note that changes require a full restart to apply and that native tabs will disable a custom title bar style if configured."),
				'included': isMacintosh
			},
			'window.nativeFullScreen': {
				'type': 'boolean',
				'default': true,
				'description': localize('window.nativeFullScreen', "Controls if native full-screen should be used on macOS. Disable this option to prevent macOS from creating a new space when going full-screen."),
				'scope': ConfigurationScope.APPLICATION,
				'included': isMacintosh
			},
			'window.clickThroughInactive': {
				'type': 'boolean',
				'default': true,
				'scope': ConfigurationScope.APPLICATION,
				'description': localize('window.clickThroughInactive', "If enabled, clicking on an inactive window will both activate the window and trigger the element under the mouse if it is clickable. If disabled, clicking anywhere on an inactive window will activate it only and a second click is required on the element."),
				'included': isMacintosh
			}
		}
	});

	// Telemetry
	registry.registerConfiguration({
		'id': 'telemetry',
		'order': 110,
		title: localize('telemetryConfigurationTitle', "Telemetry"),
		'type': 'object',
		'properties': {
			'telemetry.enableCrashReporter': {
				'type': 'boolean',
				'description': localize('telemetry.enableCrashReporting', "Enable crash reports to be sent to a Microsoft online service. \nThis option requires restart to take effect."),
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
		'title': localize('keyboardConfigurationTitle', "Keyboard"),
		'properties': {
			'keyboard.touchbar.enabled': {
				'type': 'boolean',
				'default': true,
				'description': localize('touchbar.enabled', "Enables the macOS touchbar buttons on the keyboard if available."),
				'included': isMacintosh
			},
			'keyboard.touchbar.ignored': {
				'type': 'array',
				'items': {
					'type': 'string'
				},
				'default': [],
				'markdownDescription': localize('touchbar.ignored', 'A set of identifiers for entries in the touchbar that should not show up (for example `workbench.action.navigateBack`).'),
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
				description: localize('argv.locale', 'The display Language to use. Picking a different language requires the associated language pack to be installed.')
			},
			'disable-hardware-acceleration': {
				type: 'boolean',
				description: localize('argv.disableHardwareAcceleration', 'Disables hardware acceleration. ONLY change this option if you encounter graphic issues.')
			},
			'disable-color-correct-rendering': {
				type: 'boolean',
				description: localize('argv.disableColorCorrectRendering', 'Resolves issues around color profile selection. ONLY change this option if you encounter graphic issues.')
			},
			'force-color-profile': {
				type: 'string',
				markdownDescription: localize('argv.forceColorProfile', 'Allows to override the color profile to use. If you experience colors appear badly, try to set this to `srgb` and restart.')
			},
			'enable-crash-reporter': {
				type: 'boolean',
				markdownDescription: localize('argv.enableCrashReporter', 'Allows to disable crash reporting, should restart the app if the value is changed.')
			},
			'crash-reporter-id': {
				type: 'string',
				markdownDescription: localize('argv.crashReporterId', 'Unique id used for correlating crash reports sent from this app instance.')
			},
			'enable-proposed-api': {
				type: 'array',
				description: localize('argv.enebleProposedApi', "Enable proposed APIs for a list of extension ids (such as \`vscode.git\`). Proposed APIs are unstable and subject to breaking without warning at any time. This should only be set for extension development and testing purposes."),
				items: {
					type: 'string'
				}
			},
			'log-level': {
				type: 'string',
				description: localize('argv.logLevel', "Log level to use. Default is 'info'. Allowed values are 'critical', 'error', 'warn', 'info', 'debug', 'trace', 'off'.")
			}
		}
	};
	if (isLinux) {
		schema.properties!['force-renderer-accessibility'] = {
			type: 'boolean',
			description: localize('argv.force-renderer-accessibility', 'Forces the renderer to be accessible. ONLY change this if you are using a screen reader on Linux. On other platforms the renderer will automatically be accessible. This flag is automatically set if you have editor.accessibilitySupport: on.'),
		};
	}

	jsonRegistry.registerSchema(argvDefinitionFileSchemaId, schema);
})();

// Workbench Contributions
(function registerWorkbenchContributions() {

	// Splash
	Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(PartsSplash, LifecyclePhase.Starting);
})();
