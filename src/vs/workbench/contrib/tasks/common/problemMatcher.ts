/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';

import * as Objects from 'vs/base/common/objects';
import * as Strings from 'vs/base/common/strings';
import * as Assert from 'vs/base/common/assert';
import { join, normalize } from 'vs/base/common/path';
import * as Types from 'vs/base/common/types';
import * as UUID from 'vs/base/common/uuid';
import * as Platform from 'vs/base/common/platform';
import Severity from 'vs/base/common/severity';
import { URI } from 'vs/base/common/uri';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { ValidationStatus, ValidationState, IProblemReporter, Parser } from 'vs/base/common/parsers';
import { IStringDictionary } from 'vs/base/common/collections';

import { IMarkerData, MarkerSeverity } from 'vs/platform/markers/common/markers';
import { ExtensionsRegistry, ExtensionMessageCollector } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { Event, Emitter } from 'vs/base/common/event';
import { IFileService, IFileStat } from 'vs/platform/files/common/files';

export enum FileLocationKind {
	Default,
	Relative,
	Absolute,
	AutoDetect
}

export module FileLocationKind {
	export function fromString(value: string): FileLocationKind | undefined {
		value = value.toLowerCase();
		if (value === 'absolute') {
			return FileLocationKind.Absolute;
		} else if (value === 'relative') {
			return FileLocationKind.Relative;
		} else if (value === 'autodetect') {
			return FileLocationKind.AutoDetect;
		} else {
			return undefined;
		}
	}
}

export enum ProblemLocationKind {
	File,
	Location
}

export module ProblemLocationKind {
	export function fromString(value: string): ProblemLocationKind | undefined {
		value = value.toLowerCase();
		if (value === 'file') {
			return ProblemLocationKind.File;
		} else if (value === 'location') {
			return ProblemLocationKind.Location;
		} else {
			return undefined;
		}
	}
}

export interface ProblemPattern {
	regexp: RegExp;

	kind?: ProblemLocationKind;

	file?: number;

	message?: number;

	location?: number;

	line?: number;

	character?: number;

	endLine?: number;

	endCharacter?: number;

	code?: number;

	severity?: number;

	loop?: boolean;
}

export interface NamedProblemPattern extends ProblemPattern {
	name: string;
}

export type MultiLineProblemPattern = ProblemPattern[];

export interface WatchingPattern {
	regexp: RegExp;
	file?: number;
}

export interface WatchingMatcher {
	activeOnStart: boolean;
	beginsPattern: WatchingPattern;
	endsPattern: WatchingPattern;
}

export enum ApplyToKind {
	allDocuments,
	openDocuments,
	closedDocuments
}

export module ApplyToKind {
	export function fromString(value: string): ApplyToKind | undefined {
		value = value.toLowerCase();
		if (value === 'alldocuments') {
			return ApplyToKind.allDocuments;
		} else if (value === 'opendocuments') {
			return ApplyToKind.openDocuments;
		} else if (value === 'closeddocuments') {
			return ApplyToKind.closedDocuments;
		} else {
			return undefined;
		}
	}
}

export interface ProblemMatcher {
	owner: string;
	source?: string;
	applyTo: ApplyToKind;
	fileLocation: FileLocationKind;
	filePrefix?: string;
	pattern: ProblemPattern | ProblemPattern[];
	severity?: Severity;
	watching?: WatchingMatcher;
	uriProvider?: (path: string) => URI;
}

export interface NamedProblemMatcher extends ProblemMatcher {
	name: string;
	label: string;
	deprecated?: boolean;
}

export interface NamedMultiLineProblemPattern {
	name: string;
	label: string;
	patterns: MultiLineProblemPattern;
}

export function isNamedProblemMatcher(value: ProblemMatcher | undefined): value is NamedProblemMatcher {
	return value && Types.isString((<NamedProblemMatcher>value).name) ? true : false;
}

interface Location {
	startLineNumber: number;
	startCharacter: number;
	endLineNumber: number;
	endCharacter: number;
}

interface ProblemData {
	kind?: ProblemLocationKind;
	file?: string;
	location?: string;
	line?: string;
	character?: string;
	endLine?: string;
	endCharacter?: string;
	message?: string;
	severity?: string;
	code?: string;
}

export interface ProblemMatch {
	resource: Promise<URI>;
	marker: IMarkerData;
	description: ProblemMatcher;
}

export interface HandleResult {
	match: ProblemMatch | null;
	continue: boolean;
}


export async function getResource(filename: string, matcher: ProblemMatcher, fileService?: IFileService): Promise<URI> {
	let kind = matcher.fileLocation;
	let fullPath: string | undefined;
	if (kind === FileLocationKind.Absolute) {
		fullPath = filename;
	} else if ((kind === FileLocationKind.Relative) && matcher.filePrefix) {
		fullPath = join(matcher.filePrefix, filename);
	} else if (kind === FileLocationKind.AutoDetect) {
		const matcherClone = Objects.deepClone(matcher);
		matcherClone.fileLocation = FileLocationKind.Relative;
		if (fileService) {
			const relative = await getResource(filename, matcherClone);
			let stat: IFileStat | undefined = undefined;
			try {
				stat = await fileService.resolve(relative);
			} catch (ex) {
				// Do nothing, we just need to catch file resolution errors.
			}
			if (stat) {
				return relative;
			}
		}

		matcherClone.fileLocation = FileLocationKind.Absolute;
		return getResource(filename, matcherClone);
	}
	if (fullPath === undefined) {
		throw new Error('FileLocationKind is not actionable. Does the matcher have a filePrefix? This should never happen.');
	}
	fullPath = normalize(fullPath);
	fullPath = fullPath.replace(/\\/g, '/');
	if (fullPath[0] !== '/') {
		fullPath = '/' + fullPath;
	}
	if (matcher.uriProvider !== undefined) {
		return matcher.uriProvider(fullPath);
	} else {
		return URI.file(fullPath);
	}
}

export interface ILineMatcher {
	matchLength: number;
	next(line: string): ProblemMatch | null;
	handle(lines: string[], start?: number): HandleResult;
}

export function createLineMatcher(matcher: ProblemMatcher, fileService?: IFileService): ILineMatcher {
	let pattern = matcher.pattern;
	if (Types.isArray(pattern)) {
		return new MultiLineMatcher(matcher, fileService);
	} else {
		return new SingleLineMatcher(matcher, fileService);
	}
}

const endOfLine: string = Platform.OS === Platform.OperatingSystem.Windows ? '\r\n' : '\n';

abstract class AbstractLineMatcher implements ILineMatcher {
	private matcher: ProblemMatcher;
	private fileService?: IFileService;

	constructor(matcher: ProblemMatcher, fileService?: IFileService) {
		this.matcher = matcher;
		this.fileService = fileService;
	}

	public handle(lines: string[], start: number = 0): HandleResult {
		return { match: null, continue: false };
	}

	public next(line: string): ProblemMatch | null {
		return null;
	}

	public abstract get matchLength(): number;

	protected fillProblemData(data: ProblemData | undefined, pattern: ProblemPattern, matches: RegExpExecArray): data is ProblemData {
		if (data) {
			this.fillProperty(data, 'file', pattern, matches, true);
			this.appendProperty(data, 'message', pattern, matches, true);
			this.fillProperty(data, 'code', pattern, matches, true);
			this.fillProperty(data, 'severity', pattern, matches, true);
			this.fillProperty(data, 'location', pattern, matches, true);
			this.fillProperty(data, 'line', pattern, matches);
			this.fillProperty(data, 'character', pattern, matches);
			this.fillProperty(data, 'endLine', pattern, matches);
			this.fillProperty(data, 'endCharacter', pattern, matches);
			return true;
		} else {
			return false;
		}
	}

	private appendProperty(data: ProblemData, property: keyof ProblemData, pattern: ProblemPattern, matches: RegExpExecArray, trim: boolean = false): void {
		const patternProperty = pattern[property];
		if (Types.isUndefined(data[property])) {
			this.fillProperty(data, property, pattern, matches, trim);
		}
		else if (!Types.isUndefined(patternProperty) && patternProperty < matches.length) {
			let value = matches[patternProperty];
			if (trim) {
				value = Strings.trim(value)!;
			}
			(data as any)[property] += endOfLine + value;
		}
	}

	private fillProperty(data: ProblemData, property: keyof ProblemData, pattern: ProblemPattern, matches: RegExpExecArray, trim: boolean = false): void {
		const patternAtProperty = pattern[property];
		if (Types.isUndefined(data[property]) && !Types.isUndefined(patternAtProperty) && patternAtProperty < matches.length) {
			let value = matches[patternAtProperty];
			if (value !== undefined) {
				if (trim) {
					value = Strings.trim(value)!;
				}
				(data as any)[property] = value;
			}
		}
	}

	protected getMarkerMatch(data: ProblemData): ProblemMatch | undefined {
		try {
			let location = this.getLocation(data);
			if (data.file && location && data.message) {
				let marker: IMarkerData = {
					severity: this.getSeverity(data),
					startLineNumber: location.startLineNumber,
					startColumn: location.startCharacter,
					endLineNumber: location.endLineNumber,
					endColumn: location.endCharacter,
					message: data.message
				};
				if (data.code !== undefined) {
					marker.code = data.code;
				}
				if (this.matcher.source !== undefined) {
					marker.source = this.matcher.source;
				}
				return {
					description: this.matcher,
					resource: this.getResource(data.file),
					marker: marker
				};
			}
		} catch (err) {
			console.error(`Failed to convert problem data into match: ${JSON.stringify(data)}`);
		}
		return undefined;
	}

	protected getResource(filename: string): Promise<URI> {
		return getResource(filename, this.matcher, this.fileService);
	}

	private getLocation(data: ProblemData): Location | null {
		if (data.kind === ProblemLocationKind.File) {
			return this.createLocation(0, 0, 0, 0);
		}
		if (data.location) {
			return this.parseLocationInfo(data.location);
		}
		if (!data.line) {
			return null;
		}
		let startLine = parseInt(data.line);
		let startColumn = data.character ? parseInt(data.character) : undefined;
		let endLine = data.endLine ? parseInt(data.endLine) : undefined;
		let endColumn = data.endCharacter ? parseInt(data.endCharacter) : undefined;
		return this.createLocation(startLine, startColumn, endLine, endColumn);
	}

	private parseLocationInfo(value: string): Location | null {
		if (!value || !value.match(/(\d+|\d+,\d+|\d+,\d+,\d+,\d+)/)) {
			return null;
		}
		let parts = value.split(',');
		let startLine = parseInt(parts[0]);
		let startColumn = parts.length > 1 ? parseInt(parts[1]) : undefined;
		if (parts.length > 3) {
			return this.createLocation(startLine, startColumn, parseInt(parts[2]), parseInt(parts[3]));
		} else {
			return this.createLocation(startLine, startColumn, undefined, undefined);
		}
	}

	private createLocation(startLine: number, startColumn: number | undefined, endLine: number | undefined, endColumn: number | undefined): Location {
		if (startColumn !== undefined && endColumn !== undefined) {
			return { startLineNumber: startLine, startCharacter: startColumn, endLineNumber: endLine || startLine, endCharacter: endColumn };
		}
		if (startColumn !== undefined) {
			return { startLineNumber: startLine, startCharacter: startColumn, endLineNumber: startLine, endCharacter: startColumn };
		}
		return { startLineNumber: startLine, startCharacter: 1, endLineNumber: startLine, endCharacter: 2 ** 31 - 1 }; // See https://github.com/microsoft/vscode/issues/80288#issuecomment-650636442 for discussion
	}

	private getSeverity(data: ProblemData): MarkerSeverity {
		let result: Severity | null = null;
		if (data.severity) {
			let value = data.severity;
			if (value) {
				result = Severity.fromValue(value);
				if (result === Severity.Ignore) {
					if (value === 'E') {
						result = Severity.Error;
					} else if (value === 'W') {
						result = Severity.Warning;
					} else if (value === 'I') {
						result = Severity.Info;
					} else if (Strings.equalsIgnoreCase(value, 'hint')) {
						result = Severity.Info;
					} else if (Strings.equalsIgnoreCase(value, 'note')) {
						result = Severity.Info;
					}
				}
			}
		}
		if (result === null || result === Severity.Ignore) {
			result = this.matcher.severity || Severity.Error;
		}
		return MarkerSeverity.fromSeverity(result);
	}
}

class SingleLineMatcher extends AbstractLineMatcher {

	private pattern: ProblemPattern;

	constructor(matcher: ProblemMatcher, fileService?: IFileService) {
		super(matcher, fileService);
		this.pattern = <ProblemPattern>matcher.pattern;
	}

	public get matchLength(): number {
		return 1;
	}

	public handle(lines: string[], start: number = 0): HandleResult {
		Assert.ok(lines.length - start === 1);
		let data: ProblemData = Object.create(null);
		if (this.pattern.kind !== undefined) {
			data.kind = this.pattern.kind;
		}
		let matches = this.pattern.regexp.exec(lines[start]);
		if (matches) {
			this.fillProblemData(data, this.pattern, matches);
			let match = this.getMarkerMatch(data);
			if (match) {
				return { match: match, continue: false };
			}
		}
		return { match: null, continue: false };
	}

	public next(line: string): ProblemMatch | null {
		return null;
	}
}

class MultiLineMatcher extends AbstractLineMatcher {

	private patterns: ProblemPattern[];
	private data: ProblemData | undefined;

	constructor(matcher: ProblemMatcher, fileService?: IFileService) {
		super(matcher, fileService);
		this.patterns = <ProblemPattern[]>matcher.pattern;
	}

	public get matchLength(): number {
		return this.patterns.length;
	}

	public handle(lines: string[], start: number = 0): HandleResult {
		Assert.ok(lines.length - start === this.patterns.length);
		this.data = Object.create(null);
		let data = this.data!;
		data.kind = this.patterns[0].kind;
		for (let i = 0; i < this.patterns.length; i++) {
			let pattern = this.patterns[i];
			let matches = pattern.regexp.exec(lines[i + start]);
			if (!matches) {
				return { match: null, continue: false };
			} else {
				// Only the last pattern can loop
				if (pattern.loop && i === this.patterns.length - 1) {
					data = Objects.deepClone(data);
				}
				this.fillProblemData(data, pattern, matches);
			}
		}
		let loop = !!this.patterns[this.patterns.length - 1].loop;
		if (!loop) {
			this.data = undefined;
		}
		const markerMatch = data ? this.getMarkerMatch(data) : null;
		return { match: markerMatch ? markerMatch : null, continue: loop };
	}

	public next(line: string): ProblemMatch | null {
		let pattern = this.patterns[this.patterns.length - 1];
		Assert.ok(pattern.loop === true && this.data !== null);
		let matches = pattern.regexp.exec(line);
		if (!matches) {
			this.data = undefined;
			return null;
		}
		let data = Objects.deepClone(this.data);
		let problemMatch: ProblemMatch | undefined;
		if (this.fillProblemData(data, pattern, matches)) {
			problemMatch = this.getMarkerMatch(data);
		}
		return problemMatch ? problemMatch : null;
	}
}

export namespace Config {

	export interface ProblemPattern {

		/**
		* The regular expression to find a problem in the console output of an
		* executed task.
		*/
		regexp?: string;

		/**
		* Whether the pattern matches a whole file, or a location (file/line)
		*
		* The default is to match for a location. Only valid on the
		* first problem pattern in a multi line problem matcher.
		*/
		kind?: string;

		/**
		* The match group index of the filename.
		* If omitted 1 is used.
		*/
		file?: number;

		/**
		* The match group index of the problem's location. Valid location
		* patterns are: (line), (line,column) and (startLine,startColumn,endLine,endColumn).
		* If omitted the line and column properties are used.
		*/
		location?: number;

		/**
		* The match group index of the problem's line in the source file.
		*
		* Defaults to 2.
		*/
		line?: number;

		/**
		* The match group index of the problem's column in the source file.
		*
		* Defaults to 3.
		*/
		column?: number;

		/**
		* The match group index of the problem's end line in the source file.
		*
		* Defaults to undefined. No end line is captured.
		*/
		endLine?: number;

		/**
		* The match group index of the problem's end column in the source file.
		*
		* Defaults to undefined. No end column is captured.
		*/
		endColumn?: number;

		/**
		* The match group index of the problem's severity.
		*
		* Defaults to undefined. In this case the problem matcher's severity
		* is used.
		*/
		severity?: number;

		/**
		* The match group index of the problem's code.
		*
		* Defaults to undefined. No code is captured.
		*/
		code?: number;

		/**
		* The match group index of the message. If omitted it defaults
		* to 4 if location is specified. Otherwise it defaults to 5.
		*/
		message?: number;

		/**
		* Specifies if the last pattern in a multi line problem matcher should
		* loop as long as it does match a line consequently. Only valid on the
		* last problem pattern in a multi line problem matcher.
		*/
		loop?: boolean;
	}

	export interface CheckedProblemPattern extends ProblemPattern {
		/**
		* The regular expression to find a problem in the console output of an
		* executed task.
		*/
		regexp: string;
	}

	export namespace CheckedProblemPattern {
		export function is(value: any): value is CheckedProblemPattern {
			let candidate: ProblemPattern = value as ProblemPattern;
			return candidate && Types.isString(candidate.regexp);
		}
	}

	export interface NamedProblemPattern extends ProblemPattern {
		/**
		 * The name of the problem pattern.
		 */
		name: string;

		/**
		 * A human readable label
		 */
		label?: string;
	}

	export namespace NamedProblemPattern {
		export function is(value: any): value is NamedProblemPattern {
			let candidate: NamedProblemPattern = value as NamedProblemPattern;
			return candidate && Types.isString(candidate.name);
		}
	}

	export interface NamedCheckedProblemPattern extends NamedProblemPattern {
		/**
		* The regular expression to find a problem in the console output of an
		* executed task.
		*/
		regexp: string;
	}

	export namespace NamedCheckedProblemPattern {
		export function is(value: any): value is NamedCheckedProblemPattern {
			let candidate: NamedProblemPattern = value as NamedProblemPattern;
			return candidate && NamedProblemPattern.is(candidate) && Types.isString(candidate.regexp);
		}
	}

	export type MultiLineProblemPattern = ProblemPattern[];

	export namespace MultiLineProblemPattern {
		export function is(value: any): value is MultiLineProblemPattern {
			return value && Types.isArray(value);
		}
	}

	export type MultiLineCheckedProblemPattern = CheckedProblemPattern[];

	export namespace MultiLineCheckedProblemPattern {
		export function is(value: any): value is MultiLineCheckedProblemPattern {
			if (!MultiLineProblemPattern.is(value)) {
				return false;
			}
			for (const element of value) {
				if (!Config.CheckedProblemPattern.is(element)) {
					return false;
				}
			}
			return true;
		}
	}

	export interface NamedMultiLineCheckedProblemPattern {
		/**
		 * The name of the problem pattern.
		 */
		name: string;

		/**
		 * A human readable label
		 */
		label?: string;

		/**
		 * The actual patterns
		 */
		patterns: MultiLineCheckedProblemPattern;
	}

	export namespace NamedMultiLineCheckedProblemPattern {
		export function is(value: any): value is NamedMultiLineCheckedProblemPattern {
			let candidate = value as NamedMultiLineCheckedProblemPattern;
			return candidate && Types.isString(candidate.name) && Types.isArray(candidate.patterns) && MultiLineCheckedProblemPattern.is(candidate.patterns);
		}
	}

	export type NamedProblemPatterns = (Config.NamedProblemPattern | Config.NamedMultiLineCheckedProblemPattern)[];

	/**
	* A watching pattern
	*/
	export interface WatchingPattern {
		/**
		* The actual regular expression
		*/
		regexp?: string;

		/**
		* The match group index of the filename. If provided the expression
		* is matched for that file only.
		*/
		file?: number;
	}

	/**
	* A description to track the start and end of a watching task.
	*/
	export interface BackgroundMonitor {

		/**
		* If set to true the watcher is in active mode when the task
		* starts. This is equals of issuing a line that matches the
		* beginsPattern.
		*/
		activeOnStart?: boolean;

		/**
		* If matched in the output the start of a watching task is signaled.
		*/
		beginsPattern?: string | WatchingPattern;

		/**
		* If matched in the output the end of a watching task is signaled.
		*/
		endsPattern?: string | WatchingPattern;
	}

	/**
	* A description of a problem matcher that detects problems
	* in build output.
	*/
	export interface ProblemMatcher {

		/**
		 * The name of a base problem matcher to use. If specified the
		 * base problem matcher will be used as a template and properties
		 * specified here will replace properties of the base problem
		 * matcher
		 */
		base?: string;

		/**
		 * The owner of the produced VSCode problem. This is typically
		 * the identifier of a VSCode language service if the problems are
		 * to be merged with the one produced by the language service
		 * or a generated internal id. Defaults to the generated internal id.
		 */
		owner?: string;

		/**
		 * A human-readable string describing the source of this problem.
		 * E.g. 'typescript' or 'super lint'.
		 */
		source?: string;

		/**
		* Specifies to which kind of documents the problems found by this
		* matcher are applied. Valid values are:
		*
		*   "allDocuments": problems found in all documents are applied.
		*   "openDocuments": problems found in documents that are open
		*   are applied.
		*   "closedDocuments": problems found in closed documents are
		*   applied.
		*/
		applyTo?: string;

		/**
		* The severity of the VSCode problem produced by this problem matcher.
		*
		* Valid values are:
		*   "error": to produce errors.
		*   "warning": to produce warnings.
		*   "info": to produce infos.
		*
		* The value is used if a pattern doesn't specify a severity match group.
		* Defaults to "error" if omitted.
		*/
		severity?: string;

		/**
		* Defines how filename reported in a problem pattern
		* should be read. Valid values are:
		*  - "absolute": the filename is always treated absolute.
		*  - "relative": the filename is always treated relative to
		*    the current working directory. This is the default.
		*  - ["relative", "path value"]: the filename is always
		*    treated relative to the given path value.
		*  - "autodetect": the filename is treated relative to
		*    the current workspace directory, and if the file
		*    does not exist, it is treated as absolute.
		*  - ["autodetect", "path value"]: the filename is treated
		*    relative to the given path value, and if it does not
		*    exist, it is treated as absolute.
		*/
		fileLocation?: string | string[];

		/**
		* The name of a predefined problem pattern, the inline definition
		* of a problem pattern or an array of problem patterns to match
		* problems spread over multiple lines.
		*/
		pattern?: string | ProblemPattern | ProblemPattern[];

		/**
		* A regular expression signaling that a watched tasks begins executing
		* triggered through file watching.
		*/
		watchedTaskBeginsRegExp?: string;

		/**
		* A regular expression signaling that a watched tasks ends executing.
		*/
		watchedTaskEndsRegExp?: string;

		/**
		 * @deprecated Use background instead.
		 */
		watching?: BackgroundMonitor;
		background?: BackgroundMonitor;
	}

	export type ProblemMatcherType = string | ProblemMatcher | Array<string | ProblemMatcher>;

	export interface NamedProblemMatcher extends ProblemMatcher {
		/**
		* This name can be used to refer to the
		* problem matcher from within a task.
		*/
		name: string;

		/**
		 * A human readable label.
		 */
		label?: string;
	}

	export function isNamedProblemMatcher(value: ProblemMatcher): value is NamedProblemMatcher {
		return Types.isString((<NamedProblemMatcher>value).name);
	}
}

export class ProblemPatternParser extends Parser {

	constructor(logger: IProblemReporter) {
		super(logger);
	}

	public parse(value: Config.ProblemPattern): ProblemPattern;
	public parse(value: Config.MultiLineProblemPattern): MultiLineProblemPattern;
	public parse(value: Config.NamedProblemPattern): NamedProblemPattern;
	public parse(value: Config.NamedMultiLineCheckedProblemPattern): NamedMultiLineProblemPattern;
	public parse(value: Config.ProblemPattern | Config.MultiLineProblemPattern | Config.NamedProblemPattern | Config.NamedMultiLineCheckedProblemPattern): any {
		if (Config.NamedMultiLineCheckedProblemPattern.is(value)) {
			return this.createNamedMultiLineProblemPattern(value);
		} else if (Config.MultiLineCheckedProblemPattern.is(value)) {
			return this.createMultiLineProblemPattern(value);
		} else if (Config.NamedCheckedProblemPattern.is(value)) {
			let result = this.createSingleProblemPattern(value) as NamedProblemPattern;
			result.name = value.name;
			return result;
		} else if (Config.CheckedProblemPattern.is(value)) {
			return this.createSingleProblemPattern(value);
		} else {
			this.error(localize('ProblemPatternParser.problemPattern.missingRegExp', 'The problem pattern is missing a regular expression.'));
			return null;
		}
	}

	private createSingleProblemPattern(value: Config.CheckedProblemPattern): ProblemPattern | null {
		let result = this.doCreateSingleProblemPattern(value, true);
		if (result === undefined) {
			return null;
		} else if (result.kind === undefined) {
			result.kind = ProblemLocationKind.Location;
		}
		return this.validateProblemPattern([result]) ? result : null;
	}

	private createNamedMultiLineProblemPattern(value: Config.NamedMultiLineCheckedProblemPattern): NamedMultiLineProblemPattern | null {
		const validPatterns = this.createMultiLineProblemPattern(value.patterns);
		if (!validPatterns) {
			return null;
		}
		let result = {
			name: value.name,
			label: value.label ? value.label : value.name,
			patterns: validPatterns
		};
		return result;
	}

	private createMultiLineProblemPattern(values: Config.MultiLineCheckedProblemPattern): MultiLineProblemPattern | null {
		let result: MultiLineProblemPattern = [];
		for (let i = 0; i < values.length; i++) {
			let pattern = this.doCreateSingleProblemPattern(values[i], false);
			if (pattern === undefined) {
				return null;
			}
			if (i < values.length - 1) {
				if (!Types.isUndefined(pattern.loop) && pattern.loop) {
					pattern.loop = false;
					this.error(localize('ProblemPatternParser.loopProperty.notLast', 'The loop property is only supported on the last line matcher.'));
				}
			}
			result.push(pattern);
		}
		if (result[0].kind === undefined) {
			result[0].kind = ProblemLocationKind.Location;
		}
		return this.validateProblemPattern(result) ? result : null;
	}

	private doCreateSingleProblemPattern(value: Config.CheckedProblemPattern, setDefaults: boolean): ProblemPattern | undefined {
		const regexp = this.createRegularExpression(value.regexp);
		if (regexp === undefined) {
			return undefined;
		}
		let result: ProblemPattern = { regexp };
		if (value.kind) {
			result.kind = ProblemLocationKind.fromString(value.kind);
		}

		function copyProperty(result: ProblemPattern, source: Config.ProblemPattern, resultKey: keyof ProblemPattern, sourceKey: keyof Config.ProblemPattern) {
			const value = source[sourceKey];
			if (typeof value === 'number') {
				(result as any)[resultKey] = value;
			}
		}
		copyProperty(result, value, 'file', 'file');
		copyProperty(result, value, 'location', 'location');
		copyProperty(result, value, 'line', 'line');
		copyProperty(result, value, 'character', 'column');
		copyProperty(result, value, 'endLine', 'endLine');
		copyProperty(result, value, 'endCharacter', 'endColumn');
		copyProperty(result, value, 'severity', 'severity');
		copyProperty(result, value, 'code', 'code');
		copyProperty(result, value, 'message', 'message');
		if (value.loop === true || value.loop === false) {
			result.loop = value.loop;
		}
		if (setDefaults) {
			if (result.location || result.kind === ProblemLocationKind.File) {
				let defaultValue: Partial<ProblemPattern> = {
					file: 1,
					message: 0
				};
				result = Objects.mixin(result, defaultValue, false);
			} else {
				let defaultValue: Partial<ProblemPattern> = {
					file: 1,
					line: 2,
					character: 3,
					message: 0
				};
				result = Objects.mixin(result, defaultValue, false);
			}
		}
		return result;
	}

	private validateProblemPattern(values: ProblemPattern[]): boolean {
		let file: boolean = false, message: boolean = false, location: boolean = false, line: boolean = false;
		let locationKind = (values[0].kind === undefined) ? ProblemLocationKind.Location : values[0].kind;

		values.forEach((pattern, i) => {
			if (i !== 0 && pattern.kind) {
				this.error(localize('ProblemPatternParser.problemPattern.kindProperty.notFirst', 'The problem pattern is invalid. The kind property must be provided only in the first element'));
			}
			file = file || !Types.isUndefined(pattern.file);
			message = message || !Types.isUndefined(pattern.message);
			location = location || !Types.isUndefined(pattern.location);
			line = line || !Types.isUndefined(pattern.line);
		});
		if (!(file && message)) {
			this.error(localize('ProblemPatternParser.problemPattern.missingProperty', 'The problem pattern is invalid. It must have at least have a file and a message.'));
			return false;
		}
		if (locationKind === ProblemLocationKind.Location && !(location || line)) {
			this.error(localize('ProblemPatternParser.problemPattern.missingLocation', 'The problem pattern is invalid. It must either have kind: "file" or have a line or location match group.'));
			return false;
		}
		return true;
	}

	private createRegularExpression(value: string): RegExp | undefined {
		let result: RegExp | undefined;
		try {
			result = new RegExp(value);
		} catch (err) {
			this.error(localize('ProblemPatternParser.invalidRegexp', 'Error: The string {0} is not a valid regular expression.\n', value));
		}
		return result;
	}
}

export class ExtensionRegistryReporter implements IProblemReporter {
	constructor(private _collector: ExtensionMessageCollector, private _validationStatus: ValidationStatus = new ValidationStatus()) {
	}

	public info(message: string): void {
		this._validationStatus.state = ValidationState.Info;
		this._collector.info(message);
	}

	public warn(message: string): void {
		this._validationStatus.state = ValidationState.Warning;
		this._collector.warn(message);
	}

	public error(message: string): void {
		this._validationStatus.state = ValidationState.Error;
		this._collector.error(message);
	}

	public fatal(message: string): void {
		this._validationStatus.state = ValidationState.Fatal;
		this._collector.error(message);
	}

	public get status(): ValidationStatus {
		return this._validationStatus;
	}
}

export namespace Schemas {

	export const ProblemPattern: IJSONSchema = {
		default: {
			regexp: '^([^\\\\s].*)\\\\((\\\\d+,\\\\d+)\\\\):\\\\s*(.*)$',
			file: 1,
			location: 2,
			message: 3
		},
		type: 'object',
		additionalProperties: false,
		properties: {
			regexp: {
				type: 'string',
				description: localize('ProblemPatternSchema.regexp', 'The regular expression to find an error, warning or info in the output.')
			},
			kind: {
				type: 'string',
				description: localize('ProblemPatternSchema.kind', 'whether the pattern matches a location (file and line) or only a file.')
			},
			file: {
				type: 'integer',
				description: localize('ProblemPatternSchema.file', 'The match group index of the filename. If omitted 1 is used.')
			},
			location: {
				type: 'integer',
				description: localize('ProblemPatternSchema.location', 'The match group index of the problem\'s location. Valid location patterns are: (line), (line,column) and (startLine,startColumn,endLine,endColumn). If omitted (line,column) is assumed.')
			},
			line: {
				type: 'integer',
				description: localize('ProblemPatternSchema.line', 'The match group index of the problem\'s line. Defaults to 2')
			},
			column: {
				type: 'integer',
				description: localize('ProblemPatternSchema.column', 'The match group index of the problem\'s line character. Defaults to 3')
			},
			endLine: {
				type: 'integer',
				description: localize('ProblemPatternSchema.endLine', 'The match group index of the problem\'s end line. Defaults to undefined')
			},
			endColumn: {
				type: 'integer',
				description: localize('ProblemPatternSchema.endColumn', 'The match group index of the problem\'s end line character. Defaults to undefined')
			},
			severity: {
				type: 'integer',
				description: localize('ProblemPatternSchema.severity', 'The match group index of the problem\'s severity. Defaults to undefined')
			},
			code: {
				type: 'integer',
				description: localize('ProblemPatternSchema.code', 'The match group index of the problem\'s code. Defaults to undefined')
			},
			message: {
				type: 'integer',
				description: localize('ProblemPatternSchema.message', 'The match group index of the message. If omitted it defaults to 4 if location is specified. Otherwise it defaults to 5.')
			},
			loop: {
				type: 'boolean',
				description: localize('ProblemPatternSchema.loop', 'In a multi line matcher loop indicated whether this pattern is executed in a loop as long as it matches. Can only specified on a last pattern in a multi line pattern.')
			}
		}
	};

	export const NamedProblemPattern: IJSONSchema = Objects.deepClone(ProblemPattern);
	NamedProblemPattern.properties = Objects.deepClone(NamedProblemPattern.properties) || {};
	NamedProblemPattern.properties['name'] = {
		type: 'string',
		description: localize('NamedProblemPatternSchema.name', 'The name of the problem pattern.')
	};

	export const MultiLineProblemPattern: IJSONSchema = {
		type: 'array',
		items: ProblemPattern
	};

	export const NamedMultiLineProblemPattern: IJSONSchema = {
		type: 'object',
		additionalProperties: false,
		properties: {
			name: {
				type: 'string',
				description: localize('NamedMultiLineProblemPatternSchema.name', 'The name of the problem multi line problem pattern.')
			},
			patterns: {
				type: 'array',
				description: localize('NamedMultiLineProblemPatternSchema.patterns', 'The actual patterns.'),
				items: ProblemPattern
			}
		}
	};
}

const problemPatternExtPoint = ExtensionsRegistry.registerExtensionPoint<Config.NamedProblemPatterns>({
	extensionPoint: 'problemPatterns',
	jsonSchema: {
		description: localize('ProblemPatternExtPoint', 'Contributes problem patterns'),
		type: 'array',
		items: {
			anyOf: [
				Schemas.NamedProblemPattern,
				Schemas.NamedMultiLineProblemPattern
			]
		}
	}
});

export interface IProblemPatternRegistry {
	onReady(): Promise<void>;

	get(key: string): ProblemPattern | MultiLineProblemPattern;
}

class ProblemPatternRegistryImpl implements IProblemPatternRegistry {

	private patterns: IStringDictionary<ProblemPattern | ProblemPattern[]>;
	private readyPromise: Promise<void>;

	constructor() {
		this.patterns = Object.create(null);
		this.fillDefaults();
		this.readyPromise = new Promise<void>((resolve, reject) => {
			problemPatternExtPoint.setHandler((extensions, delta) => {
				// We get all statically know extension during startup in one batch
				try {
					delta.removed.forEach(extension => {
						let problemPatterns = extension.value as Config.NamedProblemPatterns;
						for (let pattern of problemPatterns) {
							if (this.patterns[pattern.name]) {
								delete this.patterns[pattern.name];
							}
						}
					});
					delta.added.forEach(extension => {
						let problemPatterns = extension.value as Config.NamedProblemPatterns;
						let parser = new ProblemPatternParser(new ExtensionRegistryReporter(extension.collector));
						for (let pattern of problemPatterns) {
							if (Config.NamedMultiLineCheckedProblemPattern.is(pattern)) {
								let result = parser.parse(pattern);
								if (parser.problemReporter.status.state < ValidationState.Error) {
									this.add(result.name, result.patterns);
								} else {
									extension.collector.error(localize('ProblemPatternRegistry.error', 'Invalid problem pattern. The pattern will be ignored.'));
									extension.collector.error(JSON.stringify(pattern, undefined, 4));
								}
							}
							else if (Config.NamedProblemPattern.is(pattern)) {
								let result = parser.parse(pattern);
								if (parser.problemReporter.status.state < ValidationState.Error) {
									this.add(pattern.name, result);
								} else {
									extension.collector.error(localize('ProblemPatternRegistry.error', 'Invalid problem pattern. The pattern will be ignored.'));
									extension.collector.error(JSON.stringify(pattern, undefined, 4));
								}
							}
							parser.reset();
						}
					});
				} catch (error) {
					// Do nothing
				}
				resolve(undefined);
			});
		});
	}

	public onReady(): Promise<void> {
		return this.readyPromise;
	}

	public add(key: string, value: ProblemPattern | ProblemPattern[]): void {
		this.patterns[key] = value;
	}

	public get(key: string): ProblemPattern | ProblemPattern[] {
		return this.patterns[key];
	}

	private fillDefaults(): void {
		this.add('msCompile', {
			regexp: /^(?:\s+\d+\>)?([^\s].*)\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\)\s*:\s+(error|warning|info)\s+(\w{1,2}\d+)\s*:\s*(.*)$/,
			kind: ProblemLocationKind.Location,
			file: 1,
			location: 2,
			severity: 3,
			code: 4,
			message: 5
		});
		this.add('gulp-tsc', {
			regexp: /^([^\s].*)\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\):\s+(\d+)\s+(.*)$/,
			kind: ProblemLocationKind.Location,
			file: 1,
			location: 2,
			code: 3,
			message: 4
		});
		this.add('cpp', {
			regexp: /^([^\s].*)\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\):\s+(error|warning|info)\s+(C\d+)\s*:\s*(.*)$/,
			kind: ProblemLocationKind.Location,
			file: 1,
			location: 2,
			severity: 3,
			code: 4,
			message: 5
		});
		this.add('csc', {
			regexp: /^([^\s].*)\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\):\s+(error|warning|info)\s+(CS\d+)\s*:\s*(.*)$/,
			kind: ProblemLocationKind.Location,
			file: 1,
			location: 2,
			severity: 3,
			code: 4,
			message: 5
		});
		this.add('vb', {
			regexp: /^([^\s].*)\((\d+|\d+,\d+|\d+,\d+,\d+,\d+)\):\s+(error|warning|info)\s+(BC\d+)\s*:\s*(.*)$/,
			kind: ProblemLocationKind.Location,
			file: 1,
			location: 2,
			severity: 3,
			code: 4,
			message: 5
		});
		this.add('lessCompile', {
			regexp: /^\s*(.*) in file (.*) line no. (\d+)$/,
			kind: ProblemLocationKind.Location,
			message: 1,
			file: 2,
			line: 3
		});
		this.add('jshint', {
			regexp: /^(.*):\s+line\s+(\d+),\s+col\s+(\d+),\s(.+?)(?:\s+\((\w)(\d+)\))?$/,
			kind: ProblemLocationKind.Location,
			file: 1,
			line: 2,
			character: 3,
			message: 4,
			severity: 5,
			code: 6
		});
		this.add('jshint-stylish', [
			{
				regexp: /^(.+)$/,
				kind: ProblemLocationKind.Location,
				file: 1
			},
			{
				regexp: /^\s+line\s+(\d+)\s+col\s+(\d+)\s+(.+?)(?:\s+\((\w)(\d+)\))?$/,
				line: 1,
				character: 2,
				message: 3,
				severity: 4,
				code: 5,
				loop: true
			}
		]);
		this.add('eslint-compact', {
			regexp: /^(.+):\sline\s(\d+),\scol\s(\d+),\s(Error|Warning|Info)\s-\s(.+)\s\((.+)\)$/,
			file: 1,
			kind: ProblemLocationKind.Location,
			line: 2,
			character: 3,
			severity: 4,
			message: 5,
			code: 6
		});
		this.add('eslint-stylish', [
			{
				regexp: /^([^\s].*)$/,
				kind: ProblemLocationKind.Location,
				file: 1
			},
			{
				regexp: /^\s+(\d+):(\d+)\s+(error|warning|info)\s+(.+?)(?:\s\s+(.*))?$/,
				line: 1,
				character: 2,
				severity: 3,
				message: 4,
				code: 5,
				loop: true
			}
		]);
		this.add('go', {
			regexp: /^([^:]*: )?((.:)?[^:]*):(\d+)(:(\d+))?: (.*)$/,
			kind: ProblemLocationKind.Location,
			file: 2,
			line: 4,
			character: 6,
			message: 7
		});
	}
}

export const ProblemPatternRegistry: IProblemPatternRegistry = new ProblemPatternRegistryImpl();

export class ProblemMatcherParser extends Parser {

	constructor(logger: IProblemReporter) {
		super(logger);
	}

	public parse(json: Config.ProblemMatcher): ProblemMatcher | undefined {
		let result = this.createProblemMatcher(json);
		if (!this.checkProblemMatcherValid(json, result)) {
			return undefined;
		}
		this.addWatchingMatcher(json, result);

		return result;
	}

	private checkProblemMatcherValid(externalProblemMatcher: Config.ProblemMatcher, problemMatcher: ProblemMatcher | null): problemMatcher is ProblemMatcher {
		if (!problemMatcher) {
			this.error(localize('ProblemMatcherParser.noProblemMatcher', 'Error: the description can\'t be converted into a problem matcher:\n{0}\n', JSON.stringify(externalProblemMatcher, null, 4)));
			return false;
		}
		if (!problemMatcher.pattern) {
			this.error(localize('ProblemMatcherParser.noProblemPattern', 'Error: the description doesn\'t define a valid problem pattern:\n{0}\n', JSON.stringify(externalProblemMatcher, null, 4)));
			return false;
		}
		if (!problemMatcher.owner) {
			this.error(localize('ProblemMatcherParser.noOwner', 'Error: the description doesn\'t define an owner:\n{0}\n', JSON.stringify(externalProblemMatcher, null, 4)));
			return false;
		}
		if (Types.isUndefined(problemMatcher.fileLocation)) {
			this.error(localize('ProblemMatcherParser.noFileLocation', 'Error: the description doesn\'t define a file location:\n{0}\n', JSON.stringify(externalProblemMatcher, null, 4)));
			return false;
		}
		return true;
	}

	private createProblemMatcher(description: Config.ProblemMatcher): ProblemMatcher | null {
		let result: ProblemMatcher | null = null;

		let owner = Types.isString(description.owner) ? description.owner : UUID.generateUuid();
		let source = Types.isString(description.source) ? description.source : undefined;
		let applyTo = Types.isString(description.applyTo) ? ApplyToKind.fromString(description.applyTo) : ApplyToKind.allDocuments;
		if (!applyTo) {
			applyTo = ApplyToKind.allDocuments;
		}
		let fileLocation: FileLocationKind | undefined = undefined;
		let filePrefix: string | undefined = undefined;

		let kind: FileLocationKind | undefined;
		if (Types.isUndefined(description.fileLocation)) {
			fileLocation = FileLocationKind.Relative;
			filePrefix = '${workspaceFolder}';
		} else if (Types.isString(description.fileLocation)) {
			kind = FileLocationKind.fromString(<string>description.fileLocation);
			if (kind) {
				fileLocation = kind;
				if ((kind === FileLocationKind.Relative) || (kind === FileLocationKind.AutoDetect)) {
					filePrefix = '${workspaceFolder}';
				}
			}
		} else if (Types.isStringArray(description.fileLocation)) {
			let values = <string[]>description.fileLocation;
			if (values.length > 0) {
				kind = FileLocationKind.fromString(values[0]);
				if (values.length === 1 && kind === FileLocationKind.Absolute) {
					fileLocation = kind;
				} else if (values.length === 2 && (kind === FileLocationKind.Relative || kind === FileLocationKind.AutoDetect) && values[1]) {
					fileLocation = kind;
					filePrefix = values[1];
				}
			}
		}

		let pattern = description.pattern ? this.createProblemPattern(description.pattern) : undefined;

		let severity = description.severity ? Severity.fromValue(description.severity) : undefined;
		if (severity === Severity.Ignore) {
			this.info(localize('ProblemMatcherParser.unknownSeverity', 'Info: unknown severity {0}. Valid values are error, warning and info.\n', description.severity));
			severity = Severity.Error;
		}

		if (Types.isString(description.base)) {
			let variableName = <string>description.base;
			if (variableName.length > 1 && variableName[0] === '$') {
				let base = ProblemMatcherRegistry.get(variableName.substring(1));
				if (base) {
					result = Objects.deepClone(base);
					if (description.owner !== undefined && owner !== undefined) {
						result.owner = owner;
					}
					if (description.source !== undefined && source !== undefined) {
						result.source = source;
					}
					if (description.fileLocation !== undefined && fileLocation !== undefined) {
						result.fileLocation = fileLocation;
						result.filePrefix = filePrefix;
					}
					if (description.pattern !== undefined && pattern !== undefined && pattern !== null) {
						result.pattern = pattern;
					}
					if (description.severity !== undefined && severity !== undefined) {
						result.severity = severity;
					}
					if (description.applyTo !== undefined && applyTo !== undefined) {
						result.applyTo = applyTo;
					}
				}
			}
		} else if (fileLocation && pattern) {
			result = {
				owner: owner,
				applyTo: applyTo,
				fileLocation: fileLocation,
				pattern: pattern,
			};
			if (source) {
				result.source = source;
			}
			if (filePrefix) {
				result.filePrefix = filePrefix;
			}
			if (severity) {
				result.severity = severity;
			}
		}
		if (Config.isNamedProblemMatcher(description)) {
			(result as NamedProblemMatcher).name = description.name;
			(result as NamedProblemMatcher).label = Types.isString(description.label) ? description.label : description.name;
		}
		return result;
	}

	private createProblemPattern(value: string | Config.ProblemPattern | Config.MultiLineProblemPattern): ProblemPattern | ProblemPattern[] | null {
		if (Types.isString(value)) {
			let variableName: string = <string>value;
			if (variableName.length > 1 && variableName[0] === '$') {
				let result = ProblemPatternRegistry.get(variableName.substring(1));
				if (!result) {
					this.error(localize('ProblemMatcherParser.noDefinedPatter', 'Error: the pattern with the identifier {0} doesn\'t exist.', variableName));
				}
				return result;
			} else {
				if (variableName.length === 0) {
					this.error(localize('ProblemMatcherParser.noIdentifier', 'Error: the pattern property refers to an empty identifier.'));
				} else {
					this.error(localize('ProblemMatcherParser.noValidIdentifier', 'Error: the pattern property {0} is not a valid pattern variable name.', variableName));
				}
			}
		} else if (value) {
			let problemPatternParser = new ProblemPatternParser(this.problemReporter);
			if (Array.isArray(value)) {
				return problemPatternParser.parse(value);
			} else {
				return problemPatternParser.parse(value);
			}
		}
		return null;
	}

	private addWatchingMatcher(external: Config.ProblemMatcher, internal: ProblemMatcher): void {
		let oldBegins = this.createRegularExpression(external.watchedTaskBeginsRegExp);
		let oldEnds = this.createRegularExpression(external.watchedTaskEndsRegExp);
		if (oldBegins && oldEnds) {
			internal.watching = {
				activeOnStart: false,
				beginsPattern: { regexp: oldBegins },
				endsPattern: { regexp: oldEnds }
			};
			return;
		}
		let backgroundMonitor = external.background || external.watching;
		if (Types.isUndefinedOrNull(backgroundMonitor)) {
			return;
		}
		let begins: WatchingPattern | null = this.createWatchingPattern(backgroundMonitor.beginsPattern);
		let ends: WatchingPattern | null = this.createWatchingPattern(backgroundMonitor.endsPattern);
		if (begins && ends) {
			internal.watching = {
				activeOnStart: Types.isBoolean(backgroundMonitor.activeOnStart) ? backgroundMonitor.activeOnStart : false,
				beginsPattern: begins,
				endsPattern: ends
			};
			return;
		}
		if (begins || ends) {
			this.error(localize('ProblemMatcherParser.problemPattern.watchingMatcher', 'A problem matcher must define both a begin pattern and an end pattern for watching.'));
		}
	}

	private createWatchingPattern(external: string | Config.WatchingPattern | undefined): WatchingPattern | null {
		if (Types.isUndefinedOrNull(external)) {
			return null;
		}
		let regexp: RegExp | null;
		let file: number | undefined;
		if (Types.isString(external)) {
			regexp = this.createRegularExpression(external);
		} else {
			regexp = this.createRegularExpression(external.regexp);
			if (Types.isNumber(external.file)) {
				file = external.file;
			}
		}
		if (!regexp) {
			return null;
		}
		return file ? { regexp, file } : { regexp, file: 1 };
	}

	private createRegularExpression(value: string | undefined): RegExp | null {
		let result: RegExp | null = null;
		if (!value) {
			return result;
		}
		try {
			result = new RegExp(value);
		} catch (err) {
			this.error(localize('ProblemMatcherParser.invalidRegexp', 'Error: The string {0} is not a valid regular expression.\n', value));
		}
		return result;
	}
}

export namespace Schemas {

	export const WatchingPattern: IJSONSchema = {
		type: 'object',
		additionalProperties: false,
		properties: {
			regexp: {
				type: 'string',
				description: localize('WatchingPatternSchema.regexp', 'The regular expression to detect the begin or end of a background task.')
			},
			file: {
				type: 'integer',
				description: localize('WatchingPatternSchema.file', 'The match group index of the filename. Can be omitted.')
			},
		}
	};


	export const PatternType: IJSONSchema = {
		anyOf: [
			{
				type: 'string',
				description: localize('PatternTypeSchema.name', 'The name of a contributed or predefined pattern')
			},
			Schemas.ProblemPattern,
			Schemas.MultiLineProblemPattern
		],
		description: localize('PatternTypeSchema.description', 'A problem pattern or the name of a contributed or predefined problem pattern. Can be omitted if base is specified.')
	};

	export const ProblemMatcher: IJSONSchema = {
		type: 'object',
		additionalProperties: false,
		properties: {
			base: {
				type: 'string',
				description: localize('ProblemMatcherSchema.base', 'The name of a base problem matcher to use.')
			},
			owner: {
				type: 'string',
				description: localize('ProblemMatcherSchema.owner', 'The owner of the problem inside Code. Can be omitted if base is specified. Defaults to \'external\' if omitted and base is not specified.')
			},
			source: {
				type: 'string',
				description: localize('ProblemMatcherSchema.source', 'A human-readable string describing the source of this diagnostic, e.g. \'typescript\' or \'super lint\'.')
			},
			severity: {
				type: 'string',
				enum: ['error', 'warning', 'info'],
				description: localize('ProblemMatcherSchema.severity', 'The default severity for captures problems. Is used if the pattern doesn\'t define a match group for severity.')
			},
			applyTo: {
				type: 'string',
				enum: ['allDocuments', 'openDocuments', 'closedDocuments'],
				description: localize('ProblemMatcherSchema.applyTo', 'Controls if a problem reported on a text document is applied only to open, closed or all documents.')
			},
			pattern: PatternType,
			fileLocation: {
				oneOf: [
					{
						type: 'string',
						enum: ['absolute', 'relative', 'autoDetect']
					},
					{
						type: 'array',
						items: {
							type: 'string'
						}
					}
				],
				description: localize('ProblemMatcherSchema.fileLocation', 'Defines how file names reported in a problem pattern should be interpreted. A relative fileLocation may be an array, where the second element of the array is the path the relative file location.')
			},
			background: {
				type: 'object',
				additionalProperties: false,
				description: localize('ProblemMatcherSchema.background', 'Patterns to track the begin and end of a matcher active on a background task.'),
				properties: {
					activeOnStart: {
						type: 'boolean',
						description: localize('ProblemMatcherSchema.background.activeOnStart', 'If set to true the background monitor is in active mode when the task starts. This is equals of issuing a line that matches the beginsPattern')
					},
					beginsPattern: {
						oneOf: [
							{
								type: 'string'
							},
							Schemas.WatchingPattern
						],
						description: localize('ProblemMatcherSchema.background.beginsPattern', 'If matched in the output the start of a background task is signaled.')
					},
					endsPattern: {
						oneOf: [
							{
								type: 'string'
							},
							Schemas.WatchingPattern
						],
						description: localize('ProblemMatcherSchema.background.endsPattern', 'If matched in the output the end of a background task is signaled.')
					}
				}
			},
			watching: {
				type: 'object',
				additionalProperties: false,
				deprecationMessage: localize('ProblemMatcherSchema.watching.deprecated', 'The watching property is deprecated. Use background instead.'),
				description: localize('ProblemMatcherSchema.watching', 'Patterns to track the begin and end of a watching matcher.'),
				properties: {
					activeOnStart: {
						type: 'boolean',
						description: localize('ProblemMatcherSchema.watching.activeOnStart', 'If set to true the watcher is in active mode when the task starts. This is equals of issuing a line that matches the beginPattern')
					},
					beginsPattern: {
						oneOf: [
							{
								type: 'string'
							},
							Schemas.WatchingPattern
						],
						description: localize('ProblemMatcherSchema.watching.beginsPattern', 'If matched in the output the start of a watching task is signaled.')
					},
					endsPattern: {
						oneOf: [
							{
								type: 'string'
							},
							Schemas.WatchingPattern
						],
						description: localize('ProblemMatcherSchema.watching.endsPattern', 'If matched in the output the end of a watching task is signaled.')
					}
				}
			}
		}
	};

	export const LegacyProblemMatcher: IJSONSchema = Objects.deepClone(ProblemMatcher);
	LegacyProblemMatcher.properties = Objects.deepClone(LegacyProblemMatcher.properties) || {};
	LegacyProblemMatcher.properties['watchedTaskBeginsRegExp'] = {
		type: 'string',
		deprecationMessage: localize('LegacyProblemMatcherSchema.watchedBegin.deprecated', 'This property is deprecated. Use the watching property instead.'),
		description: localize('LegacyProblemMatcherSchema.watchedBegin', 'A regular expression signaling that a watched tasks begins executing triggered through file watching.')
	};
	LegacyProblemMatcher.properties['watchedTaskEndsRegExp'] = {
		type: 'string',
		deprecationMessage: localize('LegacyProblemMatcherSchema.watchedEnd.deprecated', 'This property is deprecated. Use the watching property instead.'),
		description: localize('LegacyProblemMatcherSchema.watchedEnd', 'A regular expression signaling that a watched tasks ends executing.')
	};

	export const NamedProblemMatcher: IJSONSchema = Objects.deepClone(ProblemMatcher);
	NamedProblemMatcher.properties = Objects.deepClone(NamedProblemMatcher.properties) || {};
	NamedProblemMatcher.properties.name = {
		type: 'string',
		description: localize('NamedProblemMatcherSchema.name', 'The name of the problem matcher used to refer to it.')
	};
	NamedProblemMatcher.properties.label = {
		type: 'string',
		description: localize('NamedProblemMatcherSchema.label', 'A human readable label of the problem matcher.')
	};
}

const problemMatchersExtPoint = ExtensionsRegistry.registerExtensionPoint<Config.NamedProblemMatcher[]>({
	extensionPoint: 'problemMatchers',
	deps: [problemPatternExtPoint],
	jsonSchema: {
		description: localize('ProblemMatcherExtPoint', 'Contributes problem matchers'),
		type: 'array',
		items: Schemas.NamedProblemMatcher
	}
});

export interface IProblemMatcherRegistry {
	onReady(): Promise<void>;
	get(name: string): NamedProblemMatcher;
	keys(): string[];
	readonly onMatcherChanged: Event<void>;
}

class ProblemMatcherRegistryImpl implements IProblemMatcherRegistry {

	private matchers: IStringDictionary<NamedProblemMatcher>;
	private readyPromise: Promise<void>;
	private readonly _onMatchersChanged: Emitter<void> = new Emitter<void>();
	public readonly onMatcherChanged: Event<void> = this._onMatchersChanged.event;


	constructor() {
		this.matchers = Object.create(null);
		this.fillDefaults();
		this.readyPromise = new Promise<void>((resolve, reject) => {
			problemMatchersExtPoint.setHandler((extensions, delta) => {
				try {
					delta.removed.forEach(extension => {
						let problemMatchers = extension.value;
						for (let matcher of problemMatchers) {
							if (this.matchers[matcher.name]) {
								delete this.matchers[matcher.name];
							}
						}
					});
					delta.added.forEach(extension => {
						let problemMatchers = extension.value;
						let parser = new ProblemMatcherParser(new ExtensionRegistryReporter(extension.collector));
						for (let matcher of problemMatchers) {
							let result = parser.parse(matcher);
							if (result && isNamedProblemMatcher(result)) {
								this.add(result);
							}
						}
					});
					if ((delta.removed.length > 0) || (delta.added.length > 0)) {
						this._onMatchersChanged.fire();
					}
				} catch (error) {
				}
				let matcher = this.get('tsc-watch');
				if (matcher) {
					(<any>matcher).tscWatch = true;
				}
				resolve(undefined);
			});
		});
	}

	public onReady(): Promise<void> {
		ProblemPatternRegistry.onReady();
		return this.readyPromise;
	}

	public add(matcher: NamedProblemMatcher): void {
		this.matchers[matcher.name] = matcher;
	}

	public get(name: string): NamedProblemMatcher {
		return this.matchers[name];
	}

	public keys(): string[] {
		return Object.keys(this.matchers);
	}

	private fillDefaults(): void {
		this.add({
			name: 'msCompile',
			label: localize('msCompile', 'Microsoft compiler problems'),
			owner: 'msCompile',
			applyTo: ApplyToKind.allDocuments,
			fileLocation: FileLocationKind.Absolute,
			pattern: ProblemPatternRegistry.get('msCompile')
		});

		this.add({
			name: 'lessCompile',
			label: localize('lessCompile', 'Less problems'),
			deprecated: true,
			owner: 'lessCompile',
			source: 'less',
			applyTo: ApplyToKind.allDocuments,
			fileLocation: FileLocationKind.Absolute,
			pattern: ProblemPatternRegistry.get('lessCompile'),
			severity: Severity.Error
		});

		this.add({
			name: 'gulp-tsc',
			label: localize('gulp-tsc', 'Gulp TSC Problems'),
			owner: 'typescript',
			source: 'ts',
			applyTo: ApplyToKind.closedDocuments,
			fileLocation: FileLocationKind.Relative,
			filePrefix: '${workspaceFolder}',
			pattern: ProblemPatternRegistry.get('gulp-tsc')
		});

		this.add({
			name: 'jshint',
			label: localize('jshint', 'JSHint problems'),
			owner: 'jshint',
			source: 'jshint',
			applyTo: ApplyToKind.allDocuments,
			fileLocation: FileLocationKind.Absolute,
			pattern: ProblemPatternRegistry.get('jshint')
		});

		this.add({
			name: 'jshint-stylish',
			label: localize('jshint-stylish', 'JSHint stylish problems'),
			owner: 'jshint',
			source: 'jshint',
			applyTo: ApplyToKind.allDocuments,
			fileLocation: FileLocationKind.Absolute,
			pattern: ProblemPatternRegistry.get('jshint-stylish')
		});

		this.add({
			name: 'eslint-compact',
			label: localize('eslint-compact', 'ESLint compact problems'),
			owner: 'eslint',
			source: 'eslint',
			applyTo: ApplyToKind.allDocuments,
			fileLocation: FileLocationKind.Absolute,
			filePrefix: '${workspaceFolder}',
			pattern: ProblemPatternRegistry.get('eslint-compact')
		});

		this.add({
			name: 'eslint-stylish',
			label: localize('eslint-stylish', 'ESLint stylish problems'),
			owner: 'eslint',
			source: 'eslint',
			applyTo: ApplyToKind.allDocuments,
			fileLocation: FileLocationKind.Absolute,
			pattern: ProblemPatternRegistry.get('eslint-stylish')
		});

		this.add({
			name: 'go',
			label: localize('go', 'Go problems'),
			owner: 'go',
			source: 'go',
			applyTo: ApplyToKind.allDocuments,
			fileLocation: FileLocationKind.Relative,
			filePrefix: '${workspaceFolder}',
			pattern: ProblemPatternRegistry.get('go')
		});
	}
}

export const ProblemMatcherRegistry: IProblemMatcherRegistry = new ProblemMatcherRegistryImpl();
