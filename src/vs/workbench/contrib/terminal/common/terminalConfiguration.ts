/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Extensions, IConfigurationNode, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { localize } from 'vs/nls';
import { DEFAULT_LETTER_SPACING, DEFAULT_LINE_HEIGHT, TerminalCursorStyle, DEFAULT_COMMANDS_TO_SKIP_SHELL, SUGGESTIONS_FONT_WEIGHT, MINIMUM_FONT_WEIGHT, MAXIMUM_FONT_WEIGHT, DEFAULT_LOCAL_ECHO_EXCLUDE } from 'vs/workbench/contrib/terminal/common/terminal';
import { TerminalLocation, TerminalSettingId } from 'vs/platform/terminal/common/terminal';
import { isMacintosh, isWindows } from 'vs/base/common/platform';
import { Registry } from 'vs/platform/registry/common/platform';

const terminalConfiguration: IConfigurationNode = {
	id: 'terminal',
	order: 100,
	title: localize('terminalIntegratedConfigurationTitle', "Integrated Terminal"),
	type: 'object',
	properties: {
		[TerminalSettingId.SendKeybindingsToShell]: {
			markdownDescription: localize('terminal.integrated.sendKeybindingsToShell', "Dispatches most keybindings to the terminal instead of the workbench, overriding `#terminal.integrated.commandsToSkipShell#`, which can be used alternatively for fine tuning."),
			type: 'boolean',
			default: false
		},
		[TerminalSettingId.TabsEnabled]: {
			description: localize('terminal.integrated.tabs.enabled', 'Controls whether terminal tabs display as a list to the side of the terminal. When this is disabled a dropdown will display instead.'),
			type: 'boolean',
			default: true,
		},
		[TerminalSettingId.TabsEnableAnimation]: {
			description: localize('terminal.integrated.tabs.enableAnimation', 'Controls whether terminal tab statuses support animation (eg. in progress tasks).'),
			type: 'boolean',
			default: true,
		},
		[TerminalSettingId.TabsHideCondition]: {
			description: localize('terminal.integrated.tabs.hideCondition', 'Controls whether the terminal tabs view will hide under certain conditions.'),
			type: 'string',
			enum: ['never', 'singleTerminal', 'singleGroup'],
			enumDescriptions: [
				localize('terminal.integrated.tabs.hideCondition.never', "Never hide the terminal tabs view"),
				localize('terminal.integrated.tabs.hideCondition.singleTerminal', "Hide the terminal tabs view when there is only a single terminal opened"),
				localize('terminal.integrated.tabs.hideCondition.singleGroup', "Hide the terminal tabs view when there is only a single terminal group opened"),
			],
			default: 'singleTerminal',
		},
		[TerminalSettingId.TabsShowActiveTerminal]: {
			description: localize('terminal.integrated.tabs.showActiveTerminal', 'Shows the active terminal information in the view, this is particularly useful when the title within the tabs aren\'t visible.'),
			type: 'string',
			enum: ['always', 'singleTerminal', 'singleTerminalOrNarrow', 'never'],
			enumDescriptions: [
				localize('terminal.integrated.tabs.showActiveTerminal.always', "Always show the active terminal"),
				localize('terminal.integrated.tabs.showActiveTerminal.singleTerminal', "Show the active terminal when it is the only terminal opened"),
				localize('terminal.integrated.tabs.showActiveTerminal.singleTerminalOrNarrow', "Show the active terminal when it is the only terminal opened or when the tabs view is in its narrow textless state"),
				localize('terminal.integrated.tabs.showActiveTerminal.never', "Never show the active terminal"),
			],
			default: 'singleTerminalOrNarrow',
		},
		[TerminalSettingId.TabsShowActions]: {
			description: localize('terminal.integrated.tabs.showActions', 'Controls whether terminal split and kill buttons are displays next to the new terminal button.'),
			type: 'string',
			enum: ['always', 'singleTerminal', 'singleTerminalOrNarrow', 'never'],
			enumDescriptions: [
				localize('terminal.integrated.tabs.showActions.always', "Always show the actions"),
				localize('terminal.integrated.tabs.showActions.singleTerminal', "Show the actions when it is the only terminal opened"),
				localize('terminal.integrated.tabs.showActions.singleTerminalOrNarrow', "Show the actions when it is the only terminal opened or when the tabs view is in its narrow textless state"),
				localize('terminal.integrated.tabs.showActions.never', "Never show the actions"),
			],
			default: 'singleTerminalOrNarrow',
		},
		[TerminalSettingId.TabsLocation]: {
			type: 'string',
			enum: ['left', 'right'],
			enumDescriptions: [
				localize('terminal.integrated.tabs.location.left', "Show the terminal tabs view to the left of the terminal"),
				localize('terminal.integrated.tabs.location.right', "Show the terminal tabs view to the right of the terminal")
			],
			default: 'right',
			description: localize('terminal.integrated.tabs.location', "Controls the location of the terminal tabs, either to the left or right of the actual terminal(s).")
		},
		[TerminalSettingId.DefaultLocation]: {
			type: 'string',
			enum: [TerminalLocation.Editor, TerminalLocation.TerminalView],
			enumDescriptions: [
				localize('terminal.integrated.defaultLocation.editor', "Create terminals in the editor"),
				localize('terminal.integrated.defaultLocation.view', "Create terminals in the terminal view")
			],
			default: 'view',
			description: localize('terminal.integrated.defaultLocation', "Controls where newly created terminals will appear.")
		},
		[TerminalSettingId.TabsFocusMode]: {
			type: 'string',
			enum: ['singleClick', 'doubleClick'],
			enumDescriptions: [
				localize('terminal.integrated.tabs.focusMode.singleClick', "Focus the terminal when clicking a terminal tab"),
				localize('terminal.integrated.tabs.focusMode.doubleClick', "Focus the terminal when double clicking a terminal tab")
			],
			default: 'doubleClick',
			description: localize('terminal.integrated.tabs.focusMode', "Controls whether focusing the terminal of a tab happens on double or single click.")
		},
		[TerminalSettingId.MacOptionIsMeta]: {
			description: localize('terminal.integrated.macOptionIsMeta', "Controls whether to treat the option key as the meta key in the terminal on macOS."),
			type: 'boolean',
			default: false
		},
		[TerminalSettingId.MacOptionClickForcesSelection]: {
			description: localize('terminal.integrated.macOptionClickForcesSelection', "Controls whether to force selection when using Option+click on macOS. This will force a regular (line) selection and disallow the use of column selection mode. This enables copying and pasting using the regular terminal selection, for example, when mouse mode is enabled in tmux."),
			type: 'boolean',
			default: false
		},
		[TerminalSettingId.AltClickMovesCursor]: {
			markdownDescription: localize('terminal.integrated.altClickMovesCursor', "If enabled, alt/option + click will reposition the prompt cursor to underneath the mouse when `#editor.multiCursorModifier#` is set to `'alt'` (the default value). This may not work reliably depending on your shell."),
			type: 'boolean',
			default: true
		},
		[TerminalSettingId.CopyOnSelection]: {
			description: localize('terminal.integrated.copyOnSelection', "Controls whether text selected in the terminal will be copied to the clipboard."),
			type: 'boolean',
			default: false
		},
		[TerminalSettingId.DrawBoldTextInBrightColors]: {
			description: localize('terminal.integrated.drawBoldTextInBrightColors', "Controls whether bold text in the terminal will always use the \"bright\" ANSI color variant."),
			type: 'boolean',
			default: true
		},
		// TODO: Support font ligatures
		// 'terminal.integrated.fontLigatures': {
		// 	'description': localize('terminal.integrated.fontLigatures', "Controls whether font ligatures are enabled in the terminal."),
		// 	'type': 'boolean',
		// 	'default': false
		// },
		[TerminalSettingId.FontSize]: {
			description: localize('terminal.integrated.fontSize', "Controls the font size in pixels of the terminal."),
			type: 'number',
			default: isMacintosh ? 12 : 14
		},
		[TerminalSettingId.LetterSpacing]: {
			description: localize('terminal.integrated.letterSpacing', "Controls the letter spacing of the terminal, this is an integer value which represents the amount of additional pixels to add between characters."),
			type: 'number',
			default: DEFAULT_LETTER_SPACING
		},
		[TerminalSettingId.LineHeight]: {
			description: localize('terminal.integrated.lineHeight', "Controls the line height of the terminal, this number is multiplied by the terminal font size to get the actual line-height in pixels."),
			type: 'number',
			default: DEFAULT_LINE_HEIGHT
		},
		[TerminalSettingId.MinimumContrastRatio]: {
			markdownDescription: localize('terminal.integrated.minimumContrastRatio', "When set the foreground color of each cell will change to try meet the contrast ratio specified. Example values:\n\n- 1: The default, do nothing.\n- 4.5: [WCAG AA compliance (minimum)](https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast-contrast.html).\n- 7: [WCAG AAA compliance (enhanced)](https://www.w3.org/TR/UNDERSTANDING-WCAG20/visual-audio-contrast7.html).\n- 21: White on black or black on white."),
			type: 'number',
			default: 1
		},
		[TerminalSettingId.FastScrollSensitivity]: {
			markdownDescription: localize('terminal.integrated.fastScrollSensitivity', "Scrolling speed multiplier when pressing `Alt`."),
			type: 'number',
			default: 5
		},
		[TerminalSettingId.MouseWheelScrollSensitivity]: {
			markdownDescription: localize('terminal.integrated.mouseWheelScrollSensitivity', "A multiplier to be used on the `deltaY` of mouse wheel scroll events."),
			type: 'number',
			default: 1
		},
		[TerminalSettingId.BellDuration]: {
			markdownDescription: localize('terminal.integrated.bellDuration', "The number of milliseconds to show the bell within a terminal tab when triggered."),
			type: 'number',
			default: 1000
		},
		[TerminalSettingId.FontWeight]: {
			'anyOf': [
				{
					type: 'number',
					minimum: MINIMUM_FONT_WEIGHT,
					maximum: MAXIMUM_FONT_WEIGHT,
					errorMessage: localize('terminal.integrated.fontWeightError', "Only \"normal\" and \"bold\" keywords or numbers between 1 and 1000 are allowed.")
				},
				{
					type: 'string',
					pattern: '^(normal|bold|1000|[1-9][0-9]{0,2})$'
				},
				{
					enum: SUGGESTIONS_FONT_WEIGHT,
				}
			],
			description: localize('terminal.integrated.fontWeight', "The font weight to use within the terminal for non-bold text. Accepts \"normal\" and \"bold\" keywords or numbers between 1 and 1000."),
			default: 'normal'
		},
		[TerminalSettingId.FontWeightBold]: {
			'anyOf': [
				{
					type: 'number',
					minimum: MINIMUM_FONT_WEIGHT,
					maximum: MAXIMUM_FONT_WEIGHT,
					errorMessage: localize('terminal.integrated.fontWeightError', "Only \"normal\" and \"bold\" keywords or numbers between 1 and 1000 are allowed.")
				},
				{
					type: 'string',
					pattern: '^(normal|bold|1000|[1-9][0-9]{0,2})$'
				},
				{
					enum: SUGGESTIONS_FONT_WEIGHT,
				}
			],
			description: localize('terminal.integrated.fontWeightBold', "The font weight to use within the terminal for bold text. Accepts \"normal\" and \"bold\" keywords or numbers between 1 and 1000."),
			default: 'bold'
		},
		[TerminalSettingId.CursorBlinking]: {
			description: localize('terminal.integrated.cursorBlinking', "Controls whether the terminal cursor blinks."),
			type: 'boolean',
			default: false
		},
		[TerminalSettingId.CursorStyle]: {
			description: localize('terminal.integrated.cursorStyle', "Controls the style of terminal cursor."),
			enum: [TerminalCursorStyle.BLOCK, TerminalCursorStyle.LINE, TerminalCursorStyle.UNDERLINE],
			default: TerminalCursorStyle.BLOCK
		},
		[TerminalSettingId.CursorWidth]: {
			markdownDescription: localize('terminal.integrated.cursorWidth', "Controls the width of the cursor when `#terminal.integrated.cursorStyle#` is set to `line`."),
			type: 'number',
			default: 1
		},
		[TerminalSettingId.Scrollback]: {
			description: localize('terminal.integrated.scrollback', "Controls the maximum amount of lines the terminal keeps in its buffer."),
			type: 'number',
			default: 1000
		},
		[TerminalSettingId.DetectLocale]: {
			markdownDescription: localize('terminal.integrated.detectLocale', "Controls whether to detect and set the `$LANG` environment variable to a UTF-8 compliant option since VS Code's terminal only supports UTF-8 encoded data coming from the shell."),
			type: 'string',
			enum: ['auto', 'off', 'on'],
			markdownEnumDescriptions: [
				localize('terminal.integrated.detectLocale.auto', "Set the `$LANG` environment variable if the existing variable does not exist or it does not end in `'.UTF-8'`."),
				localize('terminal.integrated.detectLocale.off', "Do not set the `$LANG` environment variable."),
				localize('terminal.integrated.detectLocale.on', "Always set the `$LANG` environment variable.")
			],
			default: 'auto'
		},
		[TerminalSettingId.GpuAcceleration]: {
			type: 'string',
			enum: ['auto', 'on', 'off', 'canvas'],
			markdownEnumDescriptions: [
				localize('terminal.integrated.gpuAcceleration.auto', "Let VS Code detect which renderer will give the best experience."),
				localize('terminal.integrated.gpuAcceleration.on', "Enable GPU acceleration within the terminal."),
				localize('terminal.integrated.gpuAcceleration.off', "Disable GPU acceleration within the terminal."),
				localize('terminal.integrated.gpuAcceleration.canvas', "Use the fallback canvas renderer within the terminal. This uses a 2d context instead of webgl and may be better on some systems.")
			],
			default: 'auto',
			description: localize('terminal.integrated.gpuAcceleration', "Controls whether the terminal will leverage the GPU to do its rendering.")
		},
		[TerminalSettingId.RightClickBehavior]: {
			type: 'string',
			enum: ['default', 'copyPaste', 'paste', 'selectWord'],
			enumDescriptions: [
				localize('terminal.integrated.rightClickBehavior.default', "Show the context menu."),
				localize('terminal.integrated.rightClickBehavior.copyPaste', "Copy when there is a selection, otherwise paste."),
				localize('terminal.integrated.rightClickBehavior.paste', "Paste on right click."),
				localize('terminal.integrated.rightClickBehavior.selectWord', "Select the word under the cursor and show the context menu.")
			],
			default: isMacintosh ? 'selectWord' : isWindows ? 'copyPaste' : 'default',
			description: localize('terminal.integrated.rightClickBehavior', "Controls how terminal reacts to right click.")
		},
		[TerminalSettingId.Cwd]: {
			restricted: true,
			description: localize('terminal.integrated.cwd', "An explicit start path where the terminal will be launched, this is used as the current working directory (cwd) for the shell process. This may be particularly useful in workspace settings if the root directory is not a convenient cwd."),
			type: 'string',
			default: undefined
		},
		[TerminalSettingId.ConfirmOnExit]: {
			description: localize('terminal.integrated.confirmOnExit', "Controls whether to confirm on exit if there are active terminal sessions."),
			type: 'boolean',
			default: false
		},
		[TerminalSettingId.EnableBell]: {
			description: localize('terminal.integrated.enableBell', "Controls whether the terminal bell is enabled, this shows up as a visual bell next to the terminal's name."),
			type: 'boolean',
			default: false
		},
		[TerminalSettingId.CommandsToSkipShell]: {
			markdownDescription: localize(
				'terminal.integrated.commandsToSkipShell',
				"A set of command IDs whose keybindings will not be sent to the shell but instead always be handled by VS Code. This allows keybindings that would normally be consumed by the shell to act instead the same as when the terminal is not focused, for example `Ctrl+P` to launch Quick Open.\n\n&nbsp;\n\nMany commands are skipped by default. To override a default and pass that command's keybinding to the shell instead, add the command prefixed with the `-` character. For example add `-workbench.action.quickOpen` to allow `Ctrl+P` to reach the shell.\n\n&nbsp;\n\nThe following list of default skipped commands is truncated when viewed in Settings Editor. To see the full list, {1} and search for the first command from the list below.\n\n&nbsp;\n\nDefault Skipped Commands:\n\n{0}",
				DEFAULT_COMMANDS_TO_SKIP_SHELL.sort().map(command => `- ${command}`).join('\n'),
				`[${localize('openDefaultSettingsJson', "open the default settings JSON")}](command:workbench.action.openRawDefaultSettings '${localize('openDefaultSettingsJson.capitalized', "Open Default Settings (JSON)")}')`
			),
			type: 'array',
			items: {
				type: 'string'
			},
			default: []
		},
		[TerminalSettingId.AllowChords]: {
			markdownDescription: localize('terminal.integrated.allowChords', "Whether or not to allow chord keybindings in the terminal. Note that when this is true and the keystroke results in a chord it will bypass `#terminal.integrated.commandsToSkipShell#`, setting this to false is particularly useful when you want ctrl+k to go to your shell (not VS Code)."),
			type: 'boolean',
			default: true
		},
		[TerminalSettingId.AllowMnemonics]: {
			markdownDescription: localize('terminal.integrated.allowMnemonics', "Whether to allow menubar mnemonics (eg. alt+f) to trigger the open the menubar. Note that this will cause all alt keystrokes to skip the shell when true. This does nothing on macOS."),
			type: 'boolean',
			default: false
		},
		[TerminalSettingId.EnvMacOs]: {
			restricted: true,
			markdownDescription: localize('terminal.integrated.env.osx', "Object with environment variables that will be added to the VS Code process to be used by the terminal on macOS. Set to `null` to delete the environment variable."),
			type: 'object',
			additionalProperties: {
				type: ['string', 'null']
			},
			default: {}
		},
		[TerminalSettingId.EnvLinux]: {
			restricted: true,
			markdownDescription: localize('terminal.integrated.env.linux', "Object with environment variables that will be added to the VS Code process to be used by the terminal on Linux. Set to `null` to delete the environment variable."),
			type: 'object',
			additionalProperties: {
				type: ['string', 'null']
			},
			default: {}
		},
		[TerminalSettingId.EnvWindows]: {
			restricted: true,
			markdownDescription: localize('terminal.integrated.env.windows', "Object with environment variables that will be added to the VS Code process to be used by the terminal on Windows. Set to `null` to delete the environment variable."),
			type: 'object',
			additionalProperties: {
				type: ['string', 'null']
			},
			default: {}
		},
		[TerminalSettingId.EnvironmentChangesIndicator]: {
			markdownDescription: localize('terminal.integrated.environmentChangesIndicator', "Whether to display the environment changes indicator on each terminal which explains whether extensions have made, or want to make changes to the terminal's environment."),
			type: 'string',
			enum: ['off', 'on', 'warnonly'],
			enumDescriptions: [
				localize('terminal.integrated.environmentChangesIndicator.off', "Disable the indicator."),
				localize('terminal.integrated.environmentChangesIndicator.on', "Enable the indicator."),
				localize('terminal.integrated.environmentChangesIndicator.warnonly', "Only show the warning indicator when a terminal's environment is 'stale', not the information indicator that shows a terminal has had its environment modified by an extension."),
			],
			default: 'warnonly'
		},
		[TerminalSettingId.EnvironmentChangesRelaunch]: {
			markdownDescription: localize('terminal.integrated.environmentChangesRelaunch', "Whether to relaunch terminals automatically if extension want to contribute to their environment and have not been interacted with yet."),
			type: 'boolean',
			default: true
		},
		[TerminalSettingId.ShowExitAlert]: {
			description: localize('terminal.integrated.showExitAlert', "Controls whether to show the alert \"The terminal process terminated with exit code\" when exit code is non-zero."),
			type: 'boolean',
			default: true
		},
		[TerminalSettingId.SplitCwd]: {
			description: localize('terminal.integrated.splitCwd', "Controls the working directory a split terminal starts with."),
			type: 'string',
			enum: ['workspaceRoot', 'initial', 'inherited'],
			enumDescriptions: [
				localize('terminal.integrated.splitCwd.workspaceRoot', "A new split terminal will use the workspace root as the working directory. In a multi-root workspace a choice for which root folder to use is offered."),
				localize('terminal.integrated.splitCwd.initial', "A new split terminal will use the working directory that the parent terminal started with."),
				localize('terminal.integrated.splitCwd.inherited', "On macOS and Linux, a new split terminal will use the working directory of the parent terminal. On Windows, this behaves the same as initial."),
			],
			default: 'inherited'
		},
		[TerminalSettingId.WindowsEnableConpty]: {
			description: localize('terminal.integrated.windowsEnableConpty', "Whether to use ConPTY for Windows terminal process communication (requires Windows 10 build number 18309+). Winpty will be used if this is false."),
			type: 'boolean',
			default: true
		},
		[TerminalSettingId.WordSeparators]: {
			description: localize('terminal.integrated.wordSeparators', "A string containing all characters to be considered word separators by the double click to select word feature."),
			type: 'string',
			default: ' ()[]{}\',"`─'
		},
		[TerminalSettingId.TitleMode]: {
			description: localize('terminal.integrated.titleMode', "Determines how the terminal's title is set, this shows up in the terminal's tab or dropdown entry."),
			type: 'string',
			enum: ['executable', 'sequence'],
			markdownEnumDescriptions: [
				localize('titleMode.executable', "The title is set by the _terminal_, the name of the detected foreground process will be used."),
				localize('titleMode.sequence', "The title is set by the _process_ via an escape sequence, this is useful if your shell dynamically sets the title.")
			],
			default: 'executable'
		},
		[TerminalSettingId.EnableFileLinks]: {
			description: localize('terminal.integrated.enableFileLinks', "Whether to enable file links in the terminal. Links can be slow when working on a network drive in particular because each file link is verified against the file system. Changing this will take effect only in new terminals."),
			type: 'boolean',
			default: true
		},
		[TerminalSettingId.UnicodeVersion]: {
			type: 'string',
			enum: ['6', '11'],
			enumDescriptions: [
				localize('terminal.integrated.unicodeVersion.six', "Version 6 of unicode, this is an older version which should work better on older systems."),
				localize('terminal.integrated.unicodeVersion.eleven', "Version 11 of unicode, this version provides better support on modern systems that use modern versions of unicode.")
			],
			default: '11',
			description: localize('terminal.integrated.unicodeVersion', "Controls what version of unicode to use when evaluating the width of characters in the terminal. If you experience emoji or other wide characters not taking up the right amount of space or backspace either deleting too much or too little then you may want to try tweaking this setting.")
		},
		[TerminalSettingId.ExperimentalLinkProvider]: {
			description: localize('terminal.integrated.experimentalLinkProvider', "An experimental setting that aims to improve link detection in the terminal by improving when links are detected and by enabling shared link detection with the editor. Currently this only supports web links."),
			type: 'boolean',
			default: true
		},
		[TerminalSettingId.LocalEchoLatencyThreshold]: {
			description: localize('terminal.integrated.localEchoLatencyThreshold', "Experimental: length of network delay, in milliseconds, where local edits will be echoed on the terminal without waiting for server acknowledgement. If '0', local echo will always be on, and if '-1' it will be disabled."),
			type: 'integer',
			minimum: -1,
			default: 30,
		},
		[TerminalSettingId.LocalEchoExcludePrograms]: {
			description: localize('terminal.integrated.localEchoExcludePrograms', "Experimental: local echo will be disabled when any of these program names are found in the terminal title."),
			type: 'array',
			items: {
				type: 'string',
				uniqueItems: true
			},
			default: DEFAULT_LOCAL_ECHO_EXCLUDE,
		},
		[TerminalSettingId.LocalEchoStyle]: {
			description: localize('terminal.integrated.localEchoStyle', "Experimental: terminal style of locally echoed text; either a font style or an RGB color."),
			default: 'dim',
			oneOf: [
				{
					type: 'string',
					default: 'dim',
					enum: ['bold', 'dim', 'italic', 'underlined', 'inverted'],
				},
				{
					type: 'string',
					format: 'color-hex',
					default: '#ff0000',
				}
			]
		},
		[TerminalSettingId.EnablePersistentSessions]: {
			description: localize('terminal.integrated.enablePersistentSessions', "Persist terminal sessions for the workspace across window reloads."),
			type: 'boolean',
			default: true
		},
	}
};

export function registerTerminalConfiguration() {
	const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
	configurationRegistry.registerConfiguration(terminalConfiguration);
	registerTerminalFontFamilyConfiguration();
}

async function registerTerminalFontFamilyConfiguration() {
	// Gather font families, avoiding duplicates
	const fontsIterator = await (navigator as any).fonts.query();
	const fontFamilies: string[] = ['monospace'];
	for await (const metadata of fontsIterator) {
		if (fontFamilies.length === 0 || fontFamilies[fontFamilies.length - 1] !== metadata.family) {
			fontFamilies.push(metadata.family);
		}
	}

	// Register configuration
	const fontConfiguration: IConfigurationNode = {
		id: 'terminal',
		order: 100,
		title: localize('terminalIntegratedConfigurationTitle', "Integrated Terminal"),
		type: 'object',
		properties: {
			[TerminalSettingId.FontFamily]: {
				markdownDescription: localize('terminal.integrated.fontFamily', "Controls the font family of the terminal, this defaults to `#editor.fontFamily#`'s value."),
				type: 'string',
				enum: fontFamilies
			}
		}
	};
	const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
	configurationRegistry.registerConfiguration(fontConfiguration);
}
