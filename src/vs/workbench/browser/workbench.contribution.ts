/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from 'vs/platform/registry/common/platform';
import { localize } from 'vs/nls';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { isMacintosh, isWindows, isLinux, isWeb, isNative } from 'vs/base/common/platform';
import { workbenchConfigurationNodeBase } from 'vs/workbench/common/configuration';
import { isStandalone } from 'vs/base/browser/browser';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { ITASExperimentService } from 'vs/workbench/services/experiment/common/experimentService';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';

const registry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);

// Configuration
(function registerConfiguration(): void {

	// Workbench
	registry.registerConfiguration({
		...workbenchConfigurationNodeBase,
		'properties': {
			'workbench.editor.titleScrollbarSizing': {
				type: 'string',
				enum: ['default', 'large'],
				enumDescriptions: [
					localize('workbench.editor.titleScrollbarSizing.default', "The default size."),
					localize('workbench.editor.titleScrollbarSizing.large', "Increases the size, so it can be grabbed more easily with the mouse.")
				],
				description: localize('tabScrollbarHeight', "Controls the height of the scrollbars used for tabs and breadcrumbs in the editor title area."),
				default: 'default',
			},
			'workbench.editor.showTabs': {
				'type': 'boolean',
				'description': localize('showEditorTabs', "Controls whether opened editors should show in tabs or not."),
				'default': true
			},
			'workbench.editor.wrapTabs': {
				'type': 'boolean',
				'markdownDescription': localize('wrapTabs', "Controls whether tabs should be wrapped over multiple lines when exceeding available space or whether a scrollbar should appear instead. This value is ignored when `#workbench.editor.showTabs#` is disabled."),
				'default': false
			},
			'workbench.editor.scrollToSwitchTabs': {
				'type': 'boolean',
				'markdownDescription': localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'scrollToSwitchTabs' }, "Controls whether scrolling over tabs will open them or not. By default tabs will only reveal upon scrolling, but not open. You can press and hold the Shift-key while scrolling to change this behavior for that duration. This value is ignored when `#workbench.editor.showTabs#` is disabled."),
				'default': false
			},
			'workbench.editor.highlightModifiedTabs': {
				'type': 'boolean',
				'markdownDescription': localize('highlightModifiedTabs', "Controls whether a top border is drawn on modified (dirty) editor tabs or not. This value is ignored when `#workbench.editor.showTabs#` is disabled."),
				'default': false
			},
			'workbench.editor.decorations.badges': {
				'type': 'boolean',
				'markdownDescription': localize('decorations.badges', "Controls whether editor file decorations should use badges."),
				'default': true
			},
			'workbench.editor.decorations.colors': {
				'type': 'boolean',
				'markdownDescription': localize('decorations.colors', "Controls whether editor file decorations should use colors."),
				'default': true
			},
			'workbench.editor.labelFormat': {
				'type': 'string',
				'enum': ['default', 'short', 'medium', 'long'],
				'enumDescriptions': [
					localize('workbench.editor.labelFormat.default', "Show the name of the file. When tabs are enabled and two files have the same name in one group the distinguishing sections of each file's path are added. When tabs are disabled, the path relative to the workspace folder is shown if the editor is active."),
					localize('workbench.editor.labelFormat.short', "Show the name of the file followed by its directory name."),
					localize('workbench.editor.labelFormat.medium', "Show the name of the file followed by its path relative to the workspace folder."),
					localize('workbench.editor.labelFormat.long', "Show the name of the file followed by its absolute path.")
				],
				'default': 'default',
				'description': localize({
					comment: ['This is the description for a setting. Values surrounded by parenthesis are not to be translated.'],
					key: 'tabDescription'
				}, "Controls the format of the label for an editor."),
			},
			'workbench.editor.untitled.labelFormat': {
				'type': 'string',
				'enum': ['content', 'name'],
				'enumDescriptions': [
					localize('workbench.editor.untitled.labelFormat.content', "The name of the untitled file is derived from the contents of its first line unless it has an associated file path. It will fallback to the name in case the line is empty or contains no word characters."),
					localize('workbench.editor.untitled.labelFormat.name', "The name of the untitled file is not derived from the contents of the file."),
				],
				'default': 'content',
				'description': localize({
					comment: ['This is the description for a setting. Values surrounded by parenthesis are not to be translated.'],
					key: 'untitledLabelFormat'
				}, "Controls the format of the label for an untitled editor."),
			},
			'workbench.editor.untitled.hint': {
				'type': 'string',
				'enum': ['text', 'hidden', 'default'],
				'default': 'default',
				'markdownDescription': localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'untitledHint' }, "Controls if the untitled hint should be inline text in the editor or a floating button or hidden.")
			},
			'workbench.editor.tabCloseButton': {
				'type': 'string',
				'enum': ['left', 'right', 'off'],
				'default': 'right',
				'markdownDescription': localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'editorTabCloseButton' }, "Controls the position of the editor's tabs close buttons, or disables them when set to 'off'. This value is ignored when `#workbench.editor.showTabs#` is disabled.")
			},
			'workbench.editor.tabSizing': {
				'type': 'string',
				'enum': ['fit', 'shrink'],
				'default': 'fit',
				'enumDescriptions': [
					localize('workbench.editor.tabSizing.fit', "Always keep tabs large enough to show the full editor label."),
					localize('workbench.editor.tabSizing.shrink', "Allow tabs to get smaller when the available space is not enough to show all tabs at once.")
				],
				'markdownDescription': localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'tabSizing' }, "Controls the sizing of editor tabs. This value is ignored when `#workbench.editor.showTabs#` is disabled.")
			},
			'workbench.editor.pinnedTabSizing': {
				'type': 'string',
				'enum': ['normal', 'compact', 'shrink'],
				'default': 'normal',
				'enumDescriptions': [
					localize('workbench.editor.pinnedTabSizing.normal', "A pinned tab inherits the look of non pinned tabs."),
					localize('workbench.editor.pinnedTabSizing.compact', "A pinned tab will show in a compact form with only icon or first letter of the editor name."),
					localize('workbench.editor.pinnedTabSizing.shrink', "A pinned tab shrinks to a compact fixed size showing parts of the editor name.")
				],
				'markdownDescription': localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'pinnedTabSizing' }, "Controls the sizing of pinned editor tabs. Pinned tabs are sorted to the beginning of all opened tabs and typically do not close until unpinned. This value is ignored when `#workbench.editor.showTabs#` is disabled.")
			},
			'workbench.editor.splitSizing': {
				'type': 'string',
				'enum': ['distribute', 'split'],
				'default': 'distribute',
				'enumDescriptions': [
					localize('workbench.editor.splitSizingDistribute', "Splits all the editor groups to equal parts."),
					localize('workbench.editor.splitSizingSplit', "Splits the active editor group to equal parts.")
				],
				'description': localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'splitSizing' }, "Controls the sizing of editor groups when splitting them.")
			},
			'workbench.editor.splitOnDragAndDrop': {
				'type': 'boolean',
				'default': true,
				'description': localize('splitOnDragAndDrop', "Controls if editor groups can be split from drag and drop operations by dropping an editor or file on the edges of the editor area.")
			},
			'workbench.editor.focusRecentEditorAfterClose': {
				'type': 'boolean',
				'description': localize('focusRecentEditorAfterClose', "Controls whether tabs are closed in most recently used order or from left to right."),
				'default': true
			},
			'workbench.editor.showIcons': {
				'type': 'boolean',
				'description': localize('showIcons', "Controls whether opened editors should show with an icon or not. This requires a file icon theme to be enabled as well."),
				'default': true
			},
			'workbench.editor.enablePreview': {
				'type': 'boolean',
				'description': localize('enablePreview', "Controls whether opened editors show as preview. Preview editors do not keep open and are reused until explicitly set to be kept open (e.g. via double click or editing) and show up with an italic font style."),
				'default': true
			},
			'workbench.editor.enablePreviewFromQuickOpen': {
				'type': 'boolean',
				'markdownDescription': localize('enablePreviewFromQuickOpen', "Controls whether editors opened from Quick Open show as preview. Preview editors do not keep open and are reused until explicitly set to be kept open (e.g. via double click or editing). This value is ignored when `#workbench.editor.enablePreview#` is disabled."),
				'default': false
			},
			'workbench.editor.enablePreviewFromCodeNavigation': {
				'type': 'boolean',
				'markdownDescription': localize('enablePreviewFromCodeNavigation', "Controls whether editors remain in preview when a code navigation is started from them. Preview editors do not keep open and are reused until explicitly set to be kept open (e.g. via double click or editing). This value is ignored when `#workbench.editor.enablePreview#` is disabled."),
				'default': false
			},
			'workbench.editor.closeOnFileDelete': {
				'type': 'boolean',
				'description': localize('closeOnFileDelete', "Controls whether editors showing a file that was opened during the session should close automatically when getting deleted or renamed by some other process. Disabling this will keep the editor open  on such an event. Note that deleting from within the application will always close the editor and that dirty files will never close to preserve your data."),
				'default': false
			},
			'workbench.editor.openPositioning': {
				'type': 'string',
				'enum': ['left', 'right', 'first', 'last'],
				'default': 'right',
				'markdownDescription': localize({ comment: ['This is the description for a setting. Values surrounded by single quotes are not to be translated.'], key: 'editorOpenPositioning' }, "Controls where editors open. Select `left` or `right` to open editors to the left or right of the currently active one. Select `first` or `last` to open editors independently from the currently active one.")
			},
			'workbench.editor.openSideBySideDirection': {
				'type': 'string',
				'enum': ['right', 'down'],
				'default': 'right',
				'markdownDescription': localize('sideBySideDirection', "Controls the default direction of editors that are opened side by side (for example, from the Explorer). By default, editors will open on the right hand side of the currently active one. If changed to `down`, the editors will open below the currently active one.")
			},
			'workbench.editor.closeEmptyGroups': {
				'type': 'boolean',
				'description': localize('closeEmptyGroups', "Controls the behavior of empty editor groups when the last tab in the group is closed. When enabled, empty groups will automatically close. When disabled, empty groups will remain part of the grid."),
				'default': true
			},
			'workbench.editor.revealIfOpen': {
				'type': 'boolean',
				'description': localize('revealIfOpen', "Controls whether an editor is revealed in any of the visible groups if opened. If disabled, an editor will prefer to open in the currently active editor group. If enabled, an already opened editor will be revealed instead of opened again in the currently active editor group. Note that there are some cases where this setting is ignored, e.g. when forcing an editor to open in a specific group or to the side of the currently active group."),
				'default': false
			},
			'workbench.editor.mouseBackForwardToNavigate': {
				'type': 'boolean',
				'description': localize('mouseBackForwardToNavigate', "Navigate between open files using mouse buttons four and five if provided."),
				'default': true
			},
			'workbench.editor.restoreViewState': {
				'type': 'boolean',
				'description': localize('restoreViewState', "Restores the last view state (e.g. scroll position) when re-opening textual editors after they have been closed."),
				'default': true,
				'scope': ConfigurationScope.LANGUAGE_OVERRIDABLE
			},
			'workbench.editor.centeredLayoutAutoResize': {
				'type': 'boolean',
				'default': true,
				'description': localize('centeredLayoutAutoResize', "Controls if the centered layout should automatically resize to maximum width when more than one group is open. Once only one group is open it will resize back to the original centered width.")
			},
			'workbench.editor.limit.enabled': {
				'type': 'boolean',
				'default': false,
				'description': localize('limitEditorsEnablement', "Controls if the number of opened editors should be limited or not. When enabled, less recently used editors that are not dirty will close to make space for newly opening editors.")
			},
			'workbench.editor.limit.value': {
				'type': 'number',
				'default': 10,
				'exclusiveMinimum': 0,
				'markdownDescription': localize('limitEditorsMaximum', "Controls the maximum number of opened editors. Use the `#workbench.editor.limit.perEditorGroup#` setting to control this limit per editor group or across all groups.")
			},
			'workbench.editor.limit.perEditorGroup': {
				'type': 'boolean',
				'default': false,
				'description': localize('perEditorGroup', "Controls if the limit of maximum opened editors should apply per editor group or across all editor groups.")
			},
			'workbench.commandPalette.history': {
				'type': 'number',
				'description': localize('commandHistory', "Controls the number of recently used commands to keep in history for the command palette. Set to 0 to disable command history."),
				'default': 50
			},
			'workbench.commandPalette.preserveInput': {
				'type': 'boolean',
				'description': localize('preserveInput', "Controls whether the last typed input to the command palette should be restored when opening it the next time."),
				'default': false
			},
			'workbench.quickOpen.closeOnFocusLost': {
				'type': 'boolean',
				'description': localize('closeOnFocusLost', "Controls whether Quick Open should close automatically once it loses focus."),
				'default': true
			},
			'workbench.quickOpen.preserveInput': {
				'type': 'boolean',
				'description': localize('workbench.quickOpen.preserveInput', "Controls whether the last typed input to Quick Open should be restored when opening it the next time."),
				'default': false
			},
			'workbench.settings.openDefaultSettings': {
				'type': 'boolean',
				'description': localize('openDefaultSettings', "Controls whether opening settings also opens an editor showing all default settings."),
				'default': false
			},
			'workbench.settings.useSplitJSON': {
				'type': 'boolean',
				'markdownDescription': localize('useSplitJSON', "Controls whether to use the split JSON editor when editing settings as JSON."),
				'default': false
			},
			'workbench.settings.openDefaultKeybindings': {
				'type': 'boolean',
				'description': localize('openDefaultKeybindings', "Controls whether opening keybinding settings also opens an editor showing all default keybindings."),
				'default': false
			},
			'workbench.sideBar.location': {
				'type': 'string',
				'enum': ['left', 'right'],
				'default': 'left',
				'description': localize('sideBarLocation', "Controls the location of the sidebar and activity bar. They can either show on the left or right of the workbench.")
			},
			'workbench.panel.defaultLocation': {
				'type': 'string',
				'enum': ['left', 'bottom', 'right'],
				'default': 'bottom',
				'description': localize('panelDefaultLocation', "Controls the default location of the panel (terminal, debug console, output, problems). It can either show at the bottom, right, or left of the workbench.")
			},
			'workbench.panel.opensMaximized': {
				'type': 'string',
				'enum': ['always', 'never', 'preserve'],
				'default': 'preserve',
				'description': localize('panelOpensMaximized', "Controls whether the panel opens maximized. It can either always open maximized, never open maximized, or open to the last state it was in before being closed."),
				'enumDescriptions': [
					localize('workbench.panel.opensMaximized.always', "Always maximize the panel when opening it."),
					localize('workbench.panel.opensMaximized.never', "Never maximize the panel when opening it. The panel will open un-maximized."),
					localize('workbench.panel.opensMaximized.preserve', "Open the panel to the state that it was in, before it was closed.")
				]
			},
			'workbench.statusBar.visible': {
				'type': 'boolean',
				'default': true,
				'description': localize('statusBarVisibility', "Controls the visibility of the status bar at the bottom of the workbench.")
			},
			'workbench.activityBar.visible': {
				'type': 'boolean',
				'default': true,
				'description': localize('activityBarVisibility', "Controls the visibility of the activity bar in the workbench.")
			},
			'workbench.activityBar.iconClickBehavior': {
				'type': 'string',
				'enum': ['toggle', 'focus'],
				'default': 'toggle',
				'description': localize('activityBarIconClickBehavior', "Controls the behavior of clicking an activity bar icon in the workbench."),
				'enumDescriptions': [
					localize('workbench.activityBar.iconClickBehavior.toggle', "Hide the side bar if the clicked item is already visible."),
					localize('workbench.activityBar.iconClickBehavior.focus', "Focus side bar if the clicked item is already visible.")
				]
			},
			'workbench.view.alwaysShowHeaderActions': {
				'type': 'boolean',
				'default': false,
				'description': localize('viewVisibility', "Controls the visibility of view header actions. View header actions may either be always visible, or only visible when that view is focused or hovered over.")
			},
			'workbench.fontAliasing': {
				'type': 'string',
				'enum': ['default', 'antialiased', 'none', 'auto'],
				'default': 'default',
				'description':
					localize('fontAliasing', "Controls font aliasing method in the workbench."),
				'enumDescriptions': [
					localize('workbench.fontAliasing.default', "Sub-pixel font smoothing. On most non-retina displays this will give the sharpest text."),
					localize('workbench.fontAliasing.antialiased', "Smooth the font on the level of the pixel, as opposed to the subpixel. Can make the font appear lighter overall."),
					localize('workbench.fontAliasing.none', "Disables font smoothing. Text will show with jagged sharp edges."),
					localize('workbench.fontAliasing.auto', "Applies `default` or `antialiased` automatically based on the DPI of displays.")
				],
				'included': isMacintosh
			},
			'workbench.settings.editor': {
				'type': 'string',
				'enum': ['ui', 'json'],
				'enumDescriptions': [
					localize('settings.editor.ui', "Use the settings UI editor."),
					localize('settings.editor.json', "Use the JSON file editor."),
				],
				'description': localize('settings.editor.desc', "Determines which settings editor to use by default."),
				'default': 'ui',
				'scope': ConfigurationScope.WINDOW
			},
			'workbench.hover.delay': {
				'type': 'number',
				'description': localize('workbench.hover.delay', "Controls the delay in milliseconds after which the hover is shown for workbench items (ex. some extension provided tree view items). Already visible items may require a refresh before reflecting this setting change."),
				// Testing has indicated that on Windows and Linux 500 ms matches the native hovers most closely.
				// On Mac, the delay is 1500.
				'default': isMacintosh ? 1500 : 500
			}
		}
	});

	// Window

	let windowTitleDescription = localize('windowTitle', "Controls the window title based on the active editor. Variables are substituted based on the context:");
	windowTitleDescription += '\n- ' + [
		localize('activeEditorShort', "`\${activeEditorShort}`: the file name (e.g. myFile.txt)."),
		localize('activeEditorMedium', "`\${activeEditorMedium}`: the path of the file relative to the workspace folder (e.g. myFolder/myFileFolder/myFile.txt)."),
		localize('activeEditorLong', "`\${activeEditorLong}`: the full path of the file (e.g. /Users/Development/myFolder/myFileFolder/myFile.txt)."),
		localize('activeFolderShort', "`\${activeFolderShort}`: the name of the folder the file is contained in (e.g. myFileFolder)."),
		localize('activeFolderMedium', "`\${activeFolderMedium}`: the path of the folder the file is contained in, relative to the workspace folder (e.g. myFolder/myFileFolder)."),
		localize('activeFolderLong', "`\${activeFolderLong}`: the full path of the folder the file is contained in (e.g. /Users/Development/myFolder/myFileFolder)."),
		localize('folderName', "`\${folderName}`: name of the workspace folder the file is contained in (e.g. myFolder)."),
		localize('folderPath', "`\${folderPath}`: file path of the workspace folder the file is contained in (e.g. /Users/Development/myFolder)."),
		localize('rootName', "`\${rootName}`: name of the opened workspace or folder (e.g. myFolder or myWorkspace)."),
		localize('rootPath', "`\${rootPath}`: file path of the opened workspace or folder (e.g. /Users/Development/myWorkspace)."),
		localize('appName', "`\${appName}`: e.g. VS Code."),
		localize('remoteName', "`\${remoteName}`: e.g. SSH"),
		localize('dirty', "`\${dirty}`: a dirty indicator if the active editor is dirty."),
		localize('separator', "`\${separator}`: a conditional separator (\" - \") that only shows when surrounded by variables with values or static text.")
	].join('\n- '); // intentionally concatenated to not produce a string that is too long for translations

	registry.registerConfiguration({
		'id': 'window',
		'order': 8,
		'title': localize('windowConfigurationTitle', "Window"),
		'type': 'object',
		'properties': {
			'window.title': {
				'type': 'string',
				'default': (() => {
					if (isMacintosh && isNative) {
						return '${activeEditorShort}${separator}${rootName}'; // macOS has native dirty indicator
					}

					const base = '${dirty}${activeEditorShort}${separator}${rootName}${separator}${appName}';
					if (isWeb) {
						return base + '${separator}${remoteName}'; // Web: always show remote name
					}

					return base;
				})(),
				'markdownDescription': windowTitleDescription
			},
			'window.titleSeparator': {
				'type': 'string',
				'default': isMacintosh ? ' — ' : ' - ',
				'markdownDescription': localize("window.titleSeparator", "Separator used by `window.title`.")
			},
			'window.menuBarVisibility': {
				'type': 'string',
				'enum': ['classic', 'visible', 'toggle', 'hidden', 'compact'],
				'markdownEnumDescriptions': [
					localize('window.menuBarVisibility.classic', "Menu is displayed at the top of the window and only hidden in full screen mode."),
					localize('window.menuBarVisibility.visible', "Menu is always visible at the top of the window even in full screen mode."),
					isMacintosh ?
						localize('window.menuBarVisibility.toggle.mac', "Menu is hidden but can be displayed at the top of the window by executing the `Focus Application Menu` command.") :
						localize('window.menuBarVisibility.toggle', "Menu is hidden but can be displayed at the top of the window via the Alt key."),
					localize('window.menuBarVisibility.hidden', "Menu is always hidden."),
					localize('window.menuBarVisibility.compact', "Menu is displayed as a compact button in the sidebar. This value is ignored when `#window.titleBarStyle#` is `native`.")
				],
				'default': isWeb ? 'compact' : 'classic',
				'scope': ConfigurationScope.APPLICATION,
				'markdownDescription': isMacintosh ?
					localize('menuBarVisibility.mac', "Control the visibility of the menu bar. A setting of 'toggle' means that the menu bar is hidden and executing `Focus Application Menu` will show it. A setting of 'compact' will move the menu into the sidebar.") :
					localize('menuBarVisibility', "Control the visibility of the menu bar. A setting of 'toggle' means that the menu bar is hidden and a single press of the Alt key will show it. A setting of 'compact' will move the menu into the sidebar."),
				'included': isWindows || isLinux || isWeb
			},
			'window.enableMenuBarMnemonics': {
				'type': 'boolean',
				'default': true,
				'scope': ConfigurationScope.APPLICATION,
				'description': localize('enableMenuBarMnemonics', "Controls whether the main menus can be opened via Alt-key shortcuts. Disabling mnemonics allows to bind these Alt-key shortcuts to editor commands instead."),
				'included': isWindows || isLinux
			},
			'window.customMenuBarAltFocus': {
				'type': 'boolean',
				'default': true,
				'scope': ConfigurationScope.APPLICATION,
				'markdownDescription': localize('customMenuBarAltFocus', "Controls whether the menu bar will be focused by pressing the Alt-key. This setting has no effect on toggling the menu bar with the Alt-key."),
				'included': isWindows || isLinux
			},
			'window.openFilesInNewWindow': {
				'type': 'string',
				'enum': ['on', 'off', 'default'],
				'enumDescriptions': [
					localize('window.openFilesInNewWindow.on', "Files will open in a new window."),
					localize('window.openFilesInNewWindow.off', "Files will open in the window with the files' folder open or the last active window."),
					isMacintosh ?
						localize('window.openFilesInNewWindow.defaultMac', "Files will open in the window with the files' folder open or the last active window unless opened via the Dock or from Finder.") :
						localize('window.openFilesInNewWindow.default', "Files will open in a new window unless picked from within the application (e.g. via the File menu).")
				],
				'default': 'off',
				'scope': ConfigurationScope.APPLICATION,
				'markdownDescription':
					isMacintosh ?
						localize('openFilesInNewWindowMac', "Controls whether files should open in a new window. \nNote that there can still be cases where this setting is ignored (e.g. when using the `--new-window` or `--reuse-window` command line option).") :
						localize('openFilesInNewWindow', "Controls whether files should open in a new window.\nNote that there can still be cases where this setting is ignored (e.g. when using the `--new-window` or `--reuse-window` command line option).")
			},
			'window.openFoldersInNewWindow': {
				'type': 'string',
				'enum': ['on', 'off', 'default'],
				'enumDescriptions': [
					localize('window.openFoldersInNewWindow.on', "Folders will open in a new window."),
					localize('window.openFoldersInNewWindow.off', "Folders will replace the last active window."),
					localize('window.openFoldersInNewWindow.default', "Folders will open in a new window unless a folder is picked from within the application (e.g. via the File menu).")
				],
				'default': 'default',
				'scope': ConfigurationScope.APPLICATION,
				'markdownDescription': localize('openFoldersInNewWindow', "Controls whether folders should open in a new window or replace the last active window.\nNote that there can still be cases where this setting is ignored (e.g. when using the `--new-window` or `--reuse-window` command line option).")
			},
			'window.confirmBeforeClose': {
				'type': 'string',
				'enum': ['always', 'keyboardOnly', 'never'],
				'enumDescriptions': [
					localize('window.confirmBeforeClose.always', "Always try to ask for confirmation. Note that browsers may still decide to close a tab or window without confirmation."),
					localize('window.confirmBeforeClose.keyboardOnly', "Only ask for confirmation if a keybinding was detected. Note that detection may not be possible in some cases."),
					localize('window.confirmBeforeClose.never', "Never explicitly ask for confirmation unless data loss is imminent.")
				],
				'default': isWeb && !isStandalone ? 'keyboardOnly' : 'never', // on by default in web, unless PWA
				'description': localize('confirmBeforeCloseWeb', "Controls whether to show a confirmation dialog before closing the browser tab or window. Note that even if enabled, browsers may still decide to close a tab or window without confirmation and that this setting is only a hint that may not work in all cases."),
				'scope': ConfigurationScope.APPLICATION,
				'included': isWeb
			}
		}
	});

	// Zen Mode
	registry.registerConfiguration({
		'id': 'zenMode',
		'order': 9,
		'title': localize('zenModeConfigurationTitle', "Zen Mode"),
		'type': 'object',
		'properties': {
			'zenMode.fullScreen': {
				'type': 'boolean',
				'default': true,
				'description': localize('zenMode.fullScreen', "Controls whether turning on Zen Mode also puts the workbench into full screen mode.")
			},
			'zenMode.centerLayout': {
				'type': 'boolean',
				'default': true,
				'description': localize('zenMode.centerLayout', "Controls whether turning on Zen Mode also centers the layout.")
			},
			'zenMode.hideTabs': {
				'type': 'boolean',
				'default': true,
				'description': localize('zenMode.hideTabs', "Controls whether turning on Zen Mode also hides workbench tabs.")
			},
			'zenMode.hideStatusBar': {
				'type': 'boolean',
				'default': true,
				'description': localize('zenMode.hideStatusBar', "Controls whether turning on Zen Mode also hides the status bar at the bottom of the workbench.")
			},
			'zenMode.hideActivityBar': {
				'type': 'boolean',
				'default': true,
				'description': localize('zenMode.hideActivityBar', "Controls whether turning on Zen Mode also hides the activity bar either at the left or right of the workbench.")
			},
			'zenMode.hideLineNumbers': {
				'type': 'boolean',
				'default': true,
				'description': localize('zenMode.hideLineNumbers', "Controls whether turning on Zen Mode also hides the editor line numbers.")
			},
			'zenMode.restore': {
				'type': 'boolean',
				'default': true,
				'description': localize('zenMode.restore', "Controls whether a window should restore to zen mode if it was exited in zen mode.")
			},
			'zenMode.silentNotifications': {
				'type': 'boolean',
				'default': true,
				'description': localize('zenMode.silentNotifications', "Controls whether notifications are shown while in zen mode. If true, only error notifications will pop out.")
			}
		}
	});
})();

class ExperimentalCustomHoverConfigContribution implements IWorkbenchContribution {
	constructor(@ITASExperimentService tasExperimentService: ITASExperimentService) {
		tasExperimentService.getTreatment<boolean>('customHovers').then(useCustomHoversAsDefault => {
			registry.registerConfiguration({
				...workbenchConfigurationNodeBase,
				'properties': {
					'workbench.experimental.useCustomHover': {
						'type': 'boolean',
						'description': localize('workbench.experimental.useCustomHover', "Enable/disable custom hovers on Activity Bar & Panel. Note this configuration is experimental and subjected to be removed at any time."),
						'default': !!useCustomHoversAsDefault
					}
				}
			});
		});
	}
}

const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(ExperimentalCustomHoverConfigContribution, LifecyclePhase.Starting);
