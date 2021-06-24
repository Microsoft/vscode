/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerColor, foreground, editorInfoForeground, editorWarningForeground, errorForeground, badgeBackground, badgeForeground, listDeemphasizedForeground, contrastBorder, inputBorder } from 'vs/platform/theme/common/colorRegistry';
import { registerThemingParticipant, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { Color } from 'vs/base/common/color';
import { localize } from 'vs/nls';
import * as icons from 'vs/workbench/contrib/debug/browser/debugIcons';

export const debugToolBarBackground = registerColor('debugToolBar.background', {
	dark: '#333333',
	light: '#F3F3F3',
	hc: '#000000'
}, localize('debugToolBarBackground', "Debug toolbar background color."));

export const debugToolBarBorder = registerColor('debugToolBar.border', {
	dark: null,
	light: null,
	hc: null
}, localize('debugToolBarBorder', "Debug toolbar border color."));

export const debugIconStartForeground = registerColor('debugIcon.startForeground', {
	dark: '#89D185',
	light: '#388A34',
	hc: '#89D185'
}, localize('debugIcon.startForeground', "Debug toolbar icon for start debugging."));

export function registerColors() {

	const debugTokenExpressionName = registerColor('debugTokenExpression.name', { dark: '#c586c0', light: '#9b46b0', hc: foreground }, 'Foreground color for the token names shown in the debug views (ie. the Variables or Watch view).');
	const debugTokenExpressionValue = registerColor('debugTokenExpression.value', { dark: '#cccccc99', light: '#6c6c6ccc', hc: foreground }, 'Foreground color for the token values shown in the debug views (ie. the Variables or Watch view).');
	const debugTokenExpressionString = registerColor('debugTokenExpression.string', { dark: '#ce9178', light: '#a31515', hc: '#f48771' }, 'Foreground color for strings in the debug views (ie. the Variables or Watch view).');
	const debugTokenExpressionBoolean = registerColor('debugTokenExpression.boolean', { dark: '#4e94ce', light: '#0000ff', hc: '#75bdfe' }, 'Foreground color for booleans in the debug views (ie. the Variables or Watch view).');
	const debugTokenExpressionNumber = registerColor('debugTokenExpression.number', { dark: '#b5cea8', light: '#098658', hc: '#89d185' }, 'Foreground color for numbers in the debug views (ie. the Variables or Watch view).');
	const debugTokenExpressionError = registerColor('debugTokenExpression.error', { dark: '#f48771', light: '#e51400', hc: '#f48771' }, 'Foreground color for expression errors in the debug views (ie. the Variables or Watch view) and for error logs shown in the debug console.');

	const debugViewExceptionLabelForeground = registerColor('debugView.exceptionLabelForeground', { dark: foreground, light: '#FFF', hc: foreground }, 'Foreground color for a label shown in the CALL STACK view when the debugger breaks on an exception.');
	const debugViewExceptionLabelBackground = registerColor('debugView.exceptionLabelBackground', { dark: '#6C2022', light: '#A31515', hc: '#6C2022' }, 'Background color for a label shown in the CALL STACK view when the debugger breaks on an exception.');
	const debugViewStateLabelForeground = registerColor('debugView.stateLabelForeground', { dark: foreground, light: foreground, hc: foreground }, 'Foreground color for a label in the CALL STACK view showing the current session\'s or thread\'s state.');
	const debugViewStateLabelBackground = registerColor('debugView.stateLabelBackground', { dark: '#88888844', light: '#88888844', hc: '#88888844' }, 'Background color for a label in the CALL STACK view showing the current session\'s or thread\'s state.');
	const debugViewValueChangedHighlight = registerColor('debugView.valueChangedHighlight', { dark: '#569CD6', light: '#569CD6', hc: '#569CD6' }, 'Color used to highlight value changes in the debug views (ie. in the Variables view).');

	const debugConsoleInfoForeground = registerColor('debugConsole.infoForeground', { dark: editorInfoForeground, light: editorInfoForeground, hc: foreground }, 'Foreground color for info messages in debug REPL console.');
	const debugConsoleWarningForeground = registerColor('debugConsole.warningForeground', { dark: editorWarningForeground, light: editorWarningForeground, hc: '#008000' }, 'Foreground color for warning messages in debug REPL console.');
	const debugConsoleErrorForeground = registerColor('debugConsole.errorForeground', { dark: errorForeground, light: errorForeground, hc: errorForeground }, 'Foreground color for error messages in debug REPL console.');
	const debugConsoleSourceForeground = registerColor('debugConsole.sourceForeground', { dark: foreground, light: foreground, hc: foreground }, 'Foreground color for source filenames in debug REPL console.');
	const debugConsoleInputIconForeground = registerColor('debugConsoleInputIcon.foreground', { dark: foreground, light: foreground, hc: foreground }, 'Foreground color for debug console input marker icon.');

	const debugIconPauseForeground = registerColor('debugIcon.pauseForeground', {
		dark: '#75BEFF',
		light: '#007ACC',
		hc: '#75BEFF'
	}, localize('debugIcon.pauseForeground', "Debug toolbar icon for pause."));

	const debugIconStopForeground = registerColor('debugIcon.stopForeground', {
		dark: '#F48771',
		light: '#A1260D',
		hc: '#F48771'
	}, localize('debugIcon.stopForeground', "Debug toolbar icon for stop."));

	const debugIconDisconnectForeground = registerColor('debugIcon.disconnectForeground', {
		dark: '#F48771',
		light: '#A1260D',
		hc: '#F48771'
	}, localize('debugIcon.disconnectForeground', "Debug toolbar icon for disconnect."));

	const debugIconRestartForeground = registerColor('debugIcon.restartForeground', {
		dark: '#89D185',
		light: '#388A34',
		hc: '#89D185'
	}, localize('debugIcon.restartForeground', "Debug toolbar icon for restart."));

	const debugIconStepOverForeground = registerColor('debugIcon.stepOverForeground', {
		dark: '#75BEFF',
		light: '#007ACC',
		hc: '#75BEFF'
	}, localize('debugIcon.stepOverForeground', "Debug toolbar icon for step over."));

	const debugIconStepIntoForeground = registerColor('debugIcon.stepIntoForeground', {
		dark: '#75BEFF',
		light: '#007ACC',
		hc: '#75BEFF'
	}, localize('debugIcon.stepIntoForeground', "Debug toolbar icon for step into."));

	const debugIconStepOutForeground = registerColor('debugIcon.stepOutForeground', {
		dark: '#75BEFF',
		light: '#007ACC',
		hc: '#75BEFF'
	}, localize('debugIcon.stepOutForeground', "Debug toolbar icon for step over."));

	const debugIconContinueForeground = registerColor('debugIcon.continueForeground', {
		dark: '#75BEFF',
		light: '#007ACC',
		hc: '#75BEFF'
	}, localize('debugIcon.continueForeground', "Debug toolbar icon for continue."));

	const debugIconStepBackForeground = registerColor('debugIcon.stepBackForeground', {
		dark: '#75BEFF',
		light: '#007ACC',
		hc: '#75BEFF'
	}, localize('debugIcon.stepBackForeground', "Debug toolbar icon for step back."));

	registerThemingParticipant((theme, collector) => {
		// All these colours provide a default value so they will never be undefined, hence the `!`
		const badgeBackgroundColor = theme.getColor(badgeBackground)!;
		const badgeForegroundColor = theme.getColor(badgeForeground)!;
		const listDeemphasizedForegroundColor = theme.getColor(listDeemphasizedForeground)!;
		const debugViewExceptionLabelForegroundColor = theme.getColor(debugViewExceptionLabelForeground)!;
		const debugViewExceptionLabelBackgroundColor = theme.getColor(debugViewExceptionLabelBackground)!;
		const debugViewStateLabelForegroundColor = theme.getColor(debugViewStateLabelForeground)!;
		const debugViewStateLabelBackgroundColor = theme.getColor(debugViewStateLabelBackground)!;
		const debugViewValueChangedHighlightColor = theme.getColor(debugViewValueChangedHighlight)!;

		collector.addRule(`
			/* Text colour of the call stack row's filename */
			.debug-pane .debug-call-stack .monaco-list-row:not(.selected) .stack-frame > .file .file-name {
				color: ${listDeemphasizedForegroundColor}
			}

			/* Line & column number "badge" for selected call stack row */
			.debug-pane .monaco-list-row.selected .line-number {
				background-color: ${badgeBackgroundColor};
				color: ${badgeForegroundColor};
			}

			/* Line & column number "badge" for unselected call stack row (basically all other rows) */
			.debug-pane .line-number {
				background-color: ${badgeBackgroundColor.transparent(0.6)};
				color: ${badgeForegroundColor.transparent(0.6)};
			}

			/* State "badge" displaying the active session's current state.
			* Only visible when there are more active debug sessions/threads running.
			*/
			.debug-pane .debug-call-stack .thread > .state.label,
			.debug-pane .debug-call-stack .session > .state.label {
				background-color: ${debugViewStateLabelBackgroundColor};
				color: ${debugViewStateLabelForegroundColor};
			}

			/* State "badge" displaying the active session's current state.
			* Only visible when there are more active debug sessions/threads running
			* and thread paused due to a thrown exception.
			*/
			.debug-pane .debug-call-stack .thread > .state.label.exception,
			.debug-pane .debug-call-stack .session > .state.label.exception {
				background-color: ${debugViewExceptionLabelBackgroundColor};
				color: ${debugViewExceptionLabelForegroundColor};
			}

			/* Info "badge" shown when the debugger pauses due to a thrown exception. */
			.debug-pane .call-stack-state-message > .label.exception {
				background-color: ${debugViewExceptionLabelBackgroundColor};
				color: ${debugViewExceptionLabelForegroundColor};
			}

			/* Animation of changed values in Debug viewlet */
			@keyframes debugViewletValueChanged {
				0%   { background-color: ${debugViewValueChangedHighlightColor.transparent(0)} }
				5%   { background-color: ${debugViewValueChangedHighlightColor.transparent(0.9)} }
				100% { background-color: ${debugViewValueChangedHighlightColor.transparent(0.3)} }
			}

			.debug-pane .monaco-list-row .expression .value.changed {
				background-color: ${debugViewValueChangedHighlightColor.transparent(0.3)};
				animation-name: debugViewletValueChanged;
				animation-duration: 1s;
				animation-fill-mode: forwards;
			}
		`);

		const contrastBorderColor = theme.getColor(contrastBorder);

		if (contrastBorderColor) {
			collector.addRule(`
			.debug-pane .line-number {
				border: 1px solid ${contrastBorderColor};
			}
			`);
		}

		const tokenNameColor = theme.getColor(debugTokenExpressionName)!;
		const tokenValueColor = theme.getColor(debugTokenExpressionValue)!;
		const tokenStringColor = theme.getColor(debugTokenExpressionString)!;
		const tokenBooleanColor = theme.getColor(debugTokenExpressionBoolean)!;
		const tokenErrorColor = theme.getColor(debugTokenExpressionError)!;
		const tokenNumberColor = theme.getColor(debugTokenExpressionNumber)!;

		collector.addRule(`
			.monaco-workbench .monaco-list-row .expression .name {
				color: ${tokenNameColor};
			}

			.monaco-workbench .monaco-list-row .expression .value,
			.monaco-workbench .debug-hover-widget .value {
				color: ${tokenValueColor};
			}

			.monaco-workbench .monaco-list-row .expression .value.string,
			.monaco-workbench .debug-hover-widget .value.string {
				color: ${tokenStringColor};
			}

			.monaco-workbench .monaco-list-row .expression .value.boolean,
			.monaco-workbench .debug-hover-widget .value.boolean {
				color: ${tokenBooleanColor};
			}

			.monaco-workbench .monaco-list-row .expression .error,
			.monaco-workbench .debug-hover-widget .error,
			.monaco-workbench .debug-pane .debug-variables .scope .error {
				color: ${tokenErrorColor};
			}

			.monaco-workbench .monaco-list-row .expression .value.number,
			.monaco-workbench .debug-hover-widget .value.number {
				color: ${tokenNumberColor};
			}
		`);

		const debugConsoleInputBorderColor = theme.getColor(inputBorder) || Color.fromHex('#80808060');
		const debugConsoleInfoForegroundColor = theme.getColor(debugConsoleInfoForeground)!;
		const debugConsoleWarningForegroundColor = theme.getColor(debugConsoleWarningForeground)!;
		const debugConsoleErrorForegroundColor = theme.getColor(debugConsoleErrorForeground)!;
		const debugConsoleSourceForegroundColor = theme.getColor(debugConsoleSourceForeground)!;
		const debugConsoleInputIconForegroundColor = theme.getColor(debugConsoleInputIconForeground)!;

		collector.addRule(`
			.repl .repl-input-wrapper {
				border-top: 1px solid ${debugConsoleInputBorderColor};
			}

			.monaco-workbench .repl .repl-tree .output .expression .value.info {
				color: ${debugConsoleInfoForegroundColor};
			}

			.monaco-workbench .repl .repl-tree .output .expression .value.warn {
				color: ${debugConsoleWarningForegroundColor};
			}

			.monaco-workbench .repl .repl-tree .output .expression .value.error {
				color: ${debugConsoleErrorForegroundColor};
			}

			.monaco-workbench .repl .repl-tree .output .expression .source {
				color: ${debugConsoleSourceForegroundColor};
			}

			.monaco-workbench .repl .repl-tree .monaco-tl-contents .arrow {
				color: ${debugConsoleInputIconForegroundColor};
			}
		`);

		if (!theme.defines(debugConsoleInputIconForeground)) {
			collector.addRule(`
				.monaco-workbench.vs .repl .repl-tree .monaco-tl-contents .arrow {
					opacity: 0.25;
				}

				.monaco-workbench.vs-dark .repl .repl-tree .monaco-tl-contents .arrow {
					opacity: 0.4;
				}

				.monaco-workbench.hc-black .repl .repl-tree .monaco-tl-contents .arrow {
					opacity: 1;
				}
			`);
		}

		const debugIconStartColor = theme.getColor(debugIconStartForeground);
		if (debugIconStartColor) {
			collector.addRule(`.monaco-workbench .debug-view-content ${ThemeIcon.asCSSSelector(icons.debugStart)}, .monaco-workbench .debug-toolbar ${ThemeIcon.asCSSSelector(icons.debugStart)}, .monaco-workbench .start-debug-action-item ${ThemeIcon.asCSSSelector(icons.debugStart)} { color: ${debugIconStartColor} !important; }`);
		}

		const debugIconPauseColor = theme.getColor(debugIconPauseForeground);
		if (debugIconPauseColor) {
			collector.addRule(`.monaco-workbench .debug-view-content ${ThemeIcon.asCSSSelector(icons.debugPause)}, .monaco-workbench .debug-toolbar ${ThemeIcon.asCSSSelector(icons.debugPause)} { color: ${debugIconPauseColor} !important; }`);
		}

		const debugIconStopColor = theme.getColor(debugIconStopForeground);
		if (debugIconStopColor) {
			collector.addRule(`.monaco-workbench .debug-view-content ${ThemeIcon.asCSSSelector(icons.debugStop)}, .monaco-workbench .debug-toolbar ${ThemeIcon.asCSSSelector(icons.debugStop)} { color: ${debugIconStopColor} !important; }`);
		}

		const debugIconDisconnectColor = theme.getColor(debugIconDisconnectForeground);
		if (debugIconDisconnectColor) {
			collector.addRule(`.monaco-workbench .debug-view-content ${ThemeIcon.asCSSSelector(icons.debugDisconnect)}, .monaco-workbench .debug-toolbar ${ThemeIcon.asCSSSelector(icons.debugDisconnect)} { color: ${debugIconDisconnectColor} !important; }`);
		}

		const debugIconRestartColor = theme.getColor(debugIconRestartForeground);
		if (debugIconRestartColor) {
			collector.addRule(`.monaco-workbench .debug-view-content ${ThemeIcon.asCSSSelector(icons.debugRestart)}, .monaco-workbench .debug-toolbar ${ThemeIcon.asCSSSelector(icons.debugRestart)}, .monaco-workbench ${ThemeIcon.asCSSSelector(icons.debugRestartFrame)} { color: ${debugIconRestartColor} !important; }`);
		}

		const debugIconStepOverColor = theme.getColor(debugIconStepOverForeground);
		if (debugIconStepOverColor) {
			collector.addRule(`.monaco-workbench .debug-view-content ${ThemeIcon.asCSSSelector(icons.debugStepOver)}, .monaco-workbench .debug-toolbar ${ThemeIcon.asCSSSelector(icons.debugStepOver)} { color: ${debugIconStepOverColor} !important; }`);
		}

		const debugIconStepIntoColor = theme.getColor(debugIconStepIntoForeground);
		if (debugIconStepIntoColor) {
			collector.addRule(`.monaco-workbench .debug-view-content ${ThemeIcon.asCSSSelector(icons.debugStepInto)}, .monaco-workbench .debug-toolbar ${ThemeIcon.asCSSSelector(icons.debugStepInto)} { color: ${debugIconStepIntoColor} !important; }`);
		}

		const debugIconStepOutColor = theme.getColor(debugIconStepOutForeground);
		if (debugIconStepOutColor) {
			collector.addRule(`.monaco-workbench .debug-view-content ${ThemeIcon.asCSSSelector(icons.debugStepOut)}, .monaco-workbench .debug-toolbar ${ThemeIcon.asCSSSelector(icons.debugStepOut)} { color: ${debugIconStepOutColor} !important; }`);
		}

		const debugIconContinueColor = theme.getColor(debugIconContinueForeground);
		if (debugIconContinueColor) {
			collector.addRule(`.monaco-workbench .debug-view-content ${ThemeIcon.asCSSSelector(icons.debugContinue)}, .monaco-workbench .debug-toolbar ${ThemeIcon.asCSSSelector(icons.debugContinue)}, .monaco-workbench ${ThemeIcon.asCSSSelector(icons.debugReverseContinue)} { color: ${debugIconContinueColor} !important; }`);
		}

		const debugIconStepBackColor = theme.getColor(debugIconStepBackForeground);
		if (debugIconStepBackColor) {
			collector.addRule(`.monaco-workbench .debug-view-content ${ThemeIcon.asCSSSelector(icons.debugStepBack)}, .monaco-workbench .debug-toolbar ${ThemeIcon.asCSSSelector(icons.debugStepBack)} { color: ${debugIconStepBackColor} !important; }`);
		}
	});
}
