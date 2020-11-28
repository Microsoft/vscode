/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { localize } from 'vs/nls';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';

export const debugConsoleViewIcon = registerIcon('debug-console-view-icon', Codicon.debugConsole, localize('debugConsoleViewIcon', 'View icon of the debug console view.'));
export const runViewIcon = registerIcon('run-view-icon', Codicon.debugAlt, localize('runViewIcon', 'View icon of the run view.'));
export const variablesViewIcon = registerIcon('variables-view-icon', Codicon.debugAlt, localize('variablesViewIcon', 'View icon of the variables view.'));
export const watchViewIcon = registerIcon('watch-view-icon', Codicon.debugAlt, localize('watchViewIcon', 'View icon of the watch view.'));
export const callStackViewIcon = registerIcon('callstack-view-icon', Codicon.debugAlt, localize('callStackViewIcon', 'View icon of the call stack view.'));
export const breakpointsViewIcon = registerIcon('breakpoints-view-icon', Codicon.debugAlt, localize('breakpointsViewIcon', 'View icon of the breakpoints view.'));
export const loadedScriptsViewIcon = registerIcon('loaded-scripts-view-icon', Codicon.debugAlt, localize('loadedScriptsViewIcon', 'View icon of the loaded scripts view.'));

export const debugBreakpoint = registerIcon('debug-breakpoint', Codicon.debugBreakpoint, localize('debugBreakpoint', 'Icon for breakpoints.'));
export const debugBreakpointDisabled = registerIcon('debug-breakpoint-disabled', Codicon.debugBreakpointDisabled, localize('debugBreakpointDisabled', 'Icon for disabled breakpoints.'));
export const debugBreakpointUnverified = registerIcon('debug-breakpoint-unverified', Codicon.debugBreakpointUnverified, localize('debugBreakpointUnverified', 'Icon for unverified breakpoints.'));
export const debugBreakpointHint = registerIcon('debug-hint', Codicon.debugHint, localize('debugBreakpointHint', 'Icon for breakpoint hints shown on hover in editor glyph margin.'));
export const debugBreakpointFunction = registerIcon('debug-breakpoint-function', Codicon.debugBreakpointFunction, localize('debugBreakpointFunction', 'Icon for function breakpoints.'));
export const debugBreakpointFunctionUnverified = registerIcon('debug-breakpoint-function-unverified', Codicon.debugBreakpointFunctionUnverified, localize('debugBreakpointFunctionUnverified', 'Icon for unverified function breakpoints.'));
export const debugBreakpointFunctionDisabled = registerIcon('debug-breakpoint-function-disabled', Codicon.debugBreakpointFunctionDisabled, localize('debugBreakpointFunctionDisabled', 'Icon for disabled function breakpoints.'));

export const debugBreakpointUnsupported = registerIcon('debug-breakpoint-unsupported', Codicon.debugBreakpointUnsupported, localize('debugBreakpointUnsupported', 'Icon for unsupported breakpoints.'));

export const debugBreakpointConditionalUnverified = registerIcon('debug-breakpoint-conditional-unverified', Codicon.debugBreakpointConditionalUnverified, localize('debugBreakpointConditionalUnverified', 'Icon for unverified conditional breakpoints.'));
export const debugBreakpointConditional = registerIcon('debug-breakpoint-conditional', Codicon.debugBreakpointConditional, localize('debugBreakpointConditional', 'Icon for conditional breakpoints.'));
export const debugBreakpointConditionalDisabled = registerIcon('debug-breakpoint-conditional-disabled', Codicon.debugBreakpointConditionalDisabled, localize('debugBreakpointConditionalDisabled', 'Icon for disabled conditional breakpoints.'));
export const debugBreakpointDataUnverified = registerIcon('debug-breakpoint-data-unverified', Codicon.debugBreakpointDataUnverified, localize('debugBreakpointDataUnverified', 'Icon for unverified data breakpoints.'));
export const debugBreakpointData = registerIcon('debug-breakpoint-data', Codicon.debugBreakpointData, localize('debugBreakpointData', 'Icon for data breakpoints.'));
export const debugBreakpointDataDisabled = registerIcon('debug-breakpoint-data-disabled', Codicon.debugBreakpointDataDisabled, localize('debugBreakpointDataDisabled', 'Icon for disabled data breakpoints.'));
export const debugBreakpointLogUnverified = registerIcon('debug-breakpoint-log-unverified', Codicon.debugBreakpointLogUnverified, localize('debugBreakpointLogUnverified', 'Icon for unverified log breakpoints.'));
export const debugBreakpointLog = registerIcon('debug-breakpoint-log', Codicon.debugBreakpointLog, localize('debugBreakpointLog', 'Icon for log breakpoints.'));
export const debugBreakpointLogDisabled = registerIcon('debug-breakpoint-log-disabled', Codicon.debugBreakpointLogDisabled, localize('debugBreakpointLogDisabled', 'Icon for disabled log breakpoint.'));

export const debugStackframe = registerIcon('debug-stackframe', Codicon.debugStackframe, localize('debugStackframe', 'Icon for a stackframe shown in the editor glyph margin.'));
export const debugStackframeFocused = registerIcon('debug-stackframe-focused', Codicon.debugStackframeFocused, localize('debugStackframeFocused', 'Icon for a focused stackframe  shown in the editor glyph margin.'));

export const debugGripper = registerIcon('debug-gripper', Codicon.gripper, localize('debugGripper', 'Icon for the debug bar gripper.'));

export const debugRestartFrame = registerIcon('debug-restart-frame', Codicon.debugRestartFrame, localize('debugRestartFrame', 'Icon for the debug restart frame action.'));

export const debugStop = registerIcon('debug-stop', Codicon.debugStop, localize('debugStop', 'Icon for the debug stop action.'));
export const debugDisconnect = registerIcon('debug-disconnect', Codicon.debugDisconnect, localize('debugDisconnect', 'Icon for the debug disconnect action.'));
export const debugRestart = registerIcon('debug-restart', Codicon.debugRestart, localize('debugRestart', 'Icon for the debug restart action.'));
export const debugStepOver = registerIcon('debug-step-over', Codicon.debugStepOver, localize('debugStepOver', 'Icon for the debug step over action.'));
export const debugStepInto = registerIcon('debug-step-into', Codicon.debugStepInto, localize('debugStepInto', 'Icon for the debug step into action.'));
export const debugStepOut = registerIcon('debug-step-out', Codicon.debugStepOut, localize('debugStepOut', 'Icon for the debug step out action.'));
export const debugStepBack = registerIcon('debug-step-back', Codicon.debugStepBack, localize('debugStepBack', 'Icon for the debug step back action.'));
export const debugPause = registerIcon('debug-pause', Codicon.debugPause, localize('debugPause', 'Icon for the debug pause action.'));
export const debugContinue = registerIcon('debug-continue', Codicon.debugContinue, localize('debugContinue', 'Icon for the debug continue action.'));
export const debugReverseContinue = registerIcon('debug-reverse-continue', Codicon.debugReverseContinue, localize('debugReverseContinue', 'Icon for the debug reverse continue action.'));

export const debugStart = registerIcon('debug-start', Codicon.debugStart, localize('debugStart', 'Icon for the debug start action.'));
export const debugConfigure = registerIcon('debug-configure', Codicon.gear, localize('debugConfigure', 'Icon for the debug configure action.'));
export const debugConsole = registerIcon('debug-console', Codicon.gear, localize('debugConsole', 'Icon for the debug console open action.'));

export const debugCollapseAll = registerIcon('debug-collapse-all', Codicon.collapseAll, localize('debugCollapseAll', 'Icon for the collapse all action in the debug views.'));
export const callstackViewSession = registerIcon('callstack-view-session', Codicon.bug, localize('callstackViewSession', 'Icon for the session icon in the call stack view.'));
export const debugConsoleClearAll = registerIcon('debug-console-clear-all', Codicon.clearAll, localize('debugConsoleClearAll', 'Icon for the clear all action in the debug console.'));
export const watchExpressionsRemoveAll = registerIcon('watch-expressions-remove-all', Codicon.closeAll, localize('watchExpressionsRemoveAll', 'Icon for the remove all action in the watch view.'));
export const watchExpressionsAdd = registerIcon('watch-expressions-add', Codicon.add, localize('watchExpressionsAdd', 'Icon for the add action in the watch view.'));
export const watchExpressionsAddFuncBreakpoint = registerIcon('watch-expressions-add-function-breakpoint', Codicon.add, localize('watchExpressionsAddFuncBreakpoint', 'Icon for the add function breakpoint action in the watch view.'));

export const breakpointsRemoveAll = registerIcon('breakpoints-remove-all', Codicon.closeAll, localize('breakpointsRemoveAll', 'Icon for the remove all action in the breakpoints view.'));
export const breakpointsActivate = registerIcon('breakpoints-activate', Codicon.activateBreakpoints, localize('breakpointsActivate', 'Icon for the activate action in the breakpoints view.'));

export const debugConsoleEvaluationInput = registerIcon('debug-console-evaluation-input', Codicon.arrowSmallRight, localize('debugConsoleEvaluationInput', 'Icon for the debug evaluation input marker.'));
export const debugConsoleEvaluationPrompt = registerIcon('debug-console-evaluation-prompt', Codicon.chevronRight, localize('debugConsoleEvaluationPrompt', 'Icon for the debug evaluation prompt.'));
