/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { equalsIgnoreCase } from 'vs/base/common/strings';
import { IDebuggerContribution, IDebugSession, IConfigPresentation } from 'vs/workbench/contrib/debug/common/debug';
import { URI as uri } from 'vs/base/common/uri';
import { isAbsolute } from 'vs/base/common/path';
import { deepClone } from 'vs/base/common/objects';

const _formatPIIRegexp = /{([^}]+)}/g;

export function formatPII(value: string, excludePII: boolean, args: { [key: string]: string } | undefined): string {
	return value.replace(_formatPIIRegexp, function (match, group) {
		if (excludePII && group.length > 0 && group[0] !== '_') {
			return match;
		}

		return args && args.hasOwnProperty(group) ?
			args[group] :
			match;
	});
}

/**
 * Filters exceptions (keys marked with "!") from the given object. Used to
 * ensure exception data is not sent on web remotes, see #97628.
 */
export function filterExceptionsFromTelemetry<T extends { [key: string]: unknown }>(data: T): Partial<T> {
	const output: Partial<T> = {};
	for (const key of Object.keys(data) as (keyof T & string)[]) {
		if (!key.startsWith('!')) {
			output[key] = data[key];
		}
	}

	return output;
}


export function isSessionAttach(session: IDebugSession): boolean {
	return session.configuration.request === 'attach' && !getExtensionHostDebugSession(session);
}

/**
 * Returns the session or any parent which is an extension host debug session.
 * Returns undefined if there's none.
 */
export function getExtensionHostDebugSession(session: IDebugSession): IDebugSession | void {
	let type = session.configuration.type;
	if (!type) {
		return;
	}

	if (type === 'vslsShare') {
		type = (<any>session.configuration).adapterProxy.configuration.type;
	}

	if (equalsIgnoreCase(type, 'extensionhost') || equalsIgnoreCase(type, 'pwa-extensionhost')) {
		return session;
	}

	return session.parentSession ? getExtensionHostDebugSession(session.parentSession) : undefined;
}

// only a debugger contributions with a label, program, or runtime attribute is considered a "defining" or "main" debugger contribution
export function isDebuggerMainContribution(dbg: IDebuggerContribution) {
	return dbg.type && (dbg.label || dbg.program || dbg.runtime);
}

export function getExactExpressionStartAndEnd(lineContent: string, looseStart: number, looseEnd: number): { start: number, end: number } {
	let matchingExpression: string | undefined = undefined;
	let startOffset = 0;

	// Some example supported expressions: myVar.prop, a.b.c.d, myVar?.prop, myVar->prop, MyClass::StaticProp, *myVar
	// Match any character except a set of characters which often break interesting sub-expressions
	let expression: RegExp = /([^()\[\]{}<>\s+\-/%~#^;=|,`!]|\->)+/g;
	let result: RegExpExecArray | null = null;

	// First find the full expression under the cursor
	while (result = expression.exec(lineContent)) {
		let start = result.index + 1;
		let end = start + result[0].length;

		if (start <= looseStart && end >= looseEnd) {
			matchingExpression = result[0];
			startOffset = start;
			break;
		}
	}

	// If there are non-word characters after the cursor, we want to truncate the expression then.
	// For example in expression 'a.b.c.d', if the focus was under 'b', 'a.b' would be evaluated.
	if (matchingExpression) {
		let subExpression: RegExp = /\w+/g;
		let subExpressionResult: RegExpExecArray | null = null;
		while (subExpressionResult = subExpression.exec(matchingExpression)) {
			let subEnd = subExpressionResult.index + 1 + startOffset + subExpressionResult[0].length;
			if (subEnd >= looseEnd) {
				break;
			}
		}

		if (subExpressionResult) {
			matchingExpression = matchingExpression.substring(0, subExpression.lastIndex);
		}
	}

	return matchingExpression ?
		{ start: startOffset, end: startOffset + matchingExpression.length - 1 } :
		{ start: 0, end: 0 };
}

// RFC 2396, Appendix A: https://www.ietf.org/rfc/rfc2396.txt
const _schemePattern = /^[a-zA-Z][a-zA-Z0-9\+\-\.]+:/;

export function isUri(s: string | undefined): boolean {
	// heuristics: a valid uri starts with a scheme and
	// the scheme has at least 2 characters so that it doesn't look like a drive letter.
	return !!(s && s.match(_schemePattern));
}

function stringToUri(source: PathContainer): string | undefined {
	if (typeof source.path === 'string') {
		if (typeof source.sourceReference === 'number' && source.sourceReference > 0) {
			// if there is a source reference, don't touch path
		} else {
			if (isUri(source.path)) {
				return <string><unknown>uri.parse(source.path);
			} else {
				// assume path
				if (isAbsolute(source.path)) {
					return <string><unknown>uri.file(source.path);
				} else {
					// leave relative path as is
				}
			}
		}
	}
	return source.path;
}

function uriToString(source: PathContainer): string | undefined {
	if (typeof source.path === 'object') {
		const u = uri.revive(source.path);
		if (u) {
			if (u.scheme === 'file') {
				return u.fsPath;
			} else {
				return u.toString();
			}
		}
	}
	return source.path;
}

// path hooks helpers

interface PathContainer {
	path?: string;
	sourceReference?: number;
}

export function convertToDAPaths(message: DebugProtocol.ProtocolMessage, toUri: boolean): DebugProtocol.ProtocolMessage {

	const fixPath = toUri ? stringToUri : uriToString;

	// since we modify Source.paths in the message in place, we need to make a copy of it (see #61129)
	const msg = deepClone(message);

	convertPaths(msg, (toDA: boolean, source: PathContainer | undefined) => {
		if (toDA && source) {
			source.path = fixPath(source);
		}
	});
	return msg;
}

export function convertToVSCPaths(message: DebugProtocol.ProtocolMessage, toUri: boolean): DebugProtocol.ProtocolMessage {

	const fixPath = toUri ? stringToUri : uriToString;

	// since we modify Source.paths in the message in place, we need to make a copy of it (see #61129)
	const msg = deepClone(message);

	convertPaths(msg, (toDA: boolean, source: PathContainer | undefined) => {
		if (!toDA && source) {
			source.path = fixPath(source);
		}
	});
	return msg;
}

function convertPaths(msg: DebugProtocol.ProtocolMessage, fixSourcePath: (toDA: boolean, source: PathContainer | undefined) => void): void {

	switch (msg.type) {
		case 'event':
			const event = <DebugProtocol.Event>msg;
			switch (event.event) {
				case 'output':
					fixSourcePath(false, (<DebugProtocol.OutputEvent>event).body.source);
					break;
				case 'loadedSource':
					fixSourcePath(false, (<DebugProtocol.LoadedSourceEvent>event).body.source);
					break;
				case 'breakpoint':
					fixSourcePath(false, (<DebugProtocol.BreakpointEvent>event).body.breakpoint.source);
					break;
				default:
					break;
			}
			break;
		case 'request':
			const request = <DebugProtocol.Request>msg;
			switch (request.command) {
				case 'setBreakpoints':
					fixSourcePath(true, (<DebugProtocol.SetBreakpointsArguments>request.arguments).source);
					break;
				case 'breakpointLocations':
					fixSourcePath(true, (<DebugProtocol.BreakpointLocationsArguments>request.arguments).source);
					break;
				case 'source':
					fixSourcePath(true, (<DebugProtocol.SourceArguments>request.arguments).source);
					break;
				case 'gotoTargets':
					fixSourcePath(true, (<DebugProtocol.GotoTargetsArguments>request.arguments).source);
					break;
				case 'launchVSCode':
					request.arguments.args.forEach((arg: PathContainer | undefined) => fixSourcePath(false, arg));
					break;
				default:
					break;
			}
			break;
		case 'response':
			const response = <DebugProtocol.Response>msg;
			if (response.success && response.body) {
				switch (response.command) {
					case 'stackTrace':
						(<DebugProtocol.StackTraceResponse>response).body.stackFrames.forEach(frame => fixSourcePath(false, frame.source));
						break;
					case 'loadedSources':
						(<DebugProtocol.LoadedSourcesResponse>response).body.sources.forEach(source => fixSourcePath(false, source));
						break;
					case 'scopes':
						(<DebugProtocol.ScopesResponse>response).body.scopes.forEach(scope => fixSourcePath(false, scope.source));
						break;
					case 'setFunctionBreakpoints':
						(<DebugProtocol.SetFunctionBreakpointsResponse>response).body.breakpoints.forEach(bp => fixSourcePath(false, bp.source));
						break;
					case 'setBreakpoints':
						(<DebugProtocol.SetBreakpointsResponse>response).body.breakpoints.forEach(bp => fixSourcePath(false, bp.source));
						break;
					default:
						break;
				}
			}
			break;
	}
}

export function getVisibleAndSorted<T extends { presentation?: IConfigPresentation }>(array: T[]): T[] {
	return array.filter(config => !config.presentation?.hidden).sort((first, second) => {
		if (!first.presentation) {
			if (!second.presentation) {
				return 0;
			}
			return 1;
		}
		if (!second.presentation) {
			return -1;
		}
		if (!first.presentation.group) {
			if (!second.presentation.group) {
				return compareOrders(first.presentation.order, second.presentation.order);
			}
			return 1;
		}
		if (!second.presentation.group) {
			return -1;
		}
		if (first.presentation.group !== second.presentation.group) {
			return first.presentation.group.localeCompare(second.presentation.group);
		}

		return compareOrders(first.presentation.order, second.presentation.order);
	});
}

function compareOrders(first: number | undefined, second: number | undefined): number {
	if (typeof first !== 'number') {
		if (typeof second !== 'number') {
			return 0;
		}

		return 1;
	}
	if (typeof second !== 'number') {
		return -1;
	}

	return first - second;
}
