/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as matchers from 'vs/workbench/contrib/tasks/common/problemMatcher';

import * as assert from 'assert';
import { ValidationState, IProblemReporter, ValidationStatus } from 'vs/base/common/parsers';

class ProblemReporter implements IProblemReporter {
	private _validationStatus: ValidationStatus;
	private _messages: string[];

	constructor() {
		this._validationStatus = new ValidationStatus();
		this._messages = [];
	}

	public info(message: string): void {
		this._messages.push(message);
		this._validationStatus.state = ValidationState.Info;
	}

	public warn(message: string): void {
		this._messages.push(message);
		this._validationStatus.state = ValidationState.Warning;
	}

	public error(message: string): void {
		this._messages.push(message);
		this._validationStatus.state = ValidationState.Error;
	}

	public fatal(message: string): void {
		this._messages.push(message);
		this._validationStatus.state = ValidationState.Fatal;
	}

	public hasMessage(message: string): boolean {
		return this._messages.indexOf(message) !== null;
	}
	public get messages(): string[] {
		return this._messages;
	}
	public get state(): ValidationState {
		return this._validationStatus.state;
	}

	public isOK(): boolean {
		return this._validationStatus.isOK();
	}

	public get status(): ValidationStatus {
		return this._validationStatus;
	}
}

suite('ProblemPatternParser', () => {
	let reporter: ProblemReporter;
	let parser: matchers.ProblemPatternParser;
	const testRegexp = new RegExp('test');

	setup(() => {
		reporter = new ProblemReporter();
		parser = new matchers.ProblemPatternParser(reporter);
	});

	suite('single-pattern definitions', () => {
		test('parses a pattern defined by only a regexp', () => {
			let problemPattern: matchers.Config.ProblemPattern = {
				regexp: 'test'
			};
			let parsed = parser.parse(problemPattern);
			assert(reporter.isOK());
			assert.deepStrictEqual(parsed, {
				regexp: testRegexp,
				kind: matchers.ProblemLocationKind.Location,
				file: 1,
				line: 2,
				character: 3,
				message: 0
			});
		});
		test('does not sets defaults for line and character if kind is File', () => {
			let problemPattern: matchers.Config.ProblemPattern = {
				regexp: 'test',
				kind: 'file'
			};
			let parsed = parser.parse(problemPattern);
			assert.deepStrictEqual(parsed, {
				regexp: testRegexp,
				kind: matchers.ProblemLocationKind.File,
				file: 1,
				message: 0
			});
		});
	});

	suite('multi-pattern definitions', () => {
		test('defines a pattern based on regexp and property fields, with file/line location', () => {
			let problemPattern: matchers.Config.MultiLineProblemPattern = [
				{ regexp: 'test', file: 3, line: 4, column: 5, message: 6 }
			];
			let parsed = parser.parse(problemPattern);
			assert(reporter.isOK());
			assert.deepStrictEqual(parsed,
				[{
					regexp: testRegexp,
					kind: matchers.ProblemLocationKind.Location,
					file: 3,
					line: 4,
					character: 5,
					message: 6
				}]
			);
		});
		test('defines a pattern bsaed on regexp and property fields, with location', () => {
			let problemPattern: matchers.Config.MultiLineProblemPattern = [
				{ regexp: 'test', file: 3, location: 4, message: 6 }
			];
			let parsed = parser.parse(problemPattern);
			assert(reporter.isOK());
			assert.deepStrictEqual(parsed,
				[{
					regexp: testRegexp,
					kind: matchers.ProblemLocationKind.Location,
					file: 3,
					location: 4,
					message: 6
				}]
			);
		});
		test('accepts a pattern that provides the fields from multiple entries', () => {
			let problemPattern: matchers.Config.MultiLineProblemPattern = [
				{ regexp: 'test', file: 3 },
				{ regexp: 'test1', line: 4 },
				{ regexp: 'test2', column: 5 },
				{ regexp: 'test3', message: 6 }
			];
			let parsed = parser.parse(problemPattern);
			assert(reporter.isOK());
			assert.deepStrictEqual(parsed, [
				{ regexp: testRegexp, kind: matchers.ProblemLocationKind.Location, file: 3 },
				{ regexp: new RegExp('test1'), line: 4 },
				{ regexp: new RegExp('test2'), character: 5 },
				{ regexp: new RegExp('test3'), message: 6 }
			]);
		});
		test('forbids setting the loop flag outside of the last element in the array', () => {
			let problemPattern: matchers.Config.MultiLineProblemPattern = [
				{ regexp: 'test', file: 3, loop: true },
				{ regexp: 'test1', line: 4 }
			];
			let parsed = parser.parse(problemPattern);
			assert.strictEqual(null, parsed);
			assert.strictEqual(ValidationState.Error, reporter.state);
			assert(reporter.hasMessage('The loop property is only supported on the last line matcher.'));
		});
		test('forbids setting the kind outside of the first element of the array', () => {
			let problemPattern: matchers.Config.MultiLineProblemPattern = [
				{ regexp: 'test', file: 3 },
				{ regexp: 'test1', kind: 'file', line: 4 }
			];
			let parsed = parser.parse(problemPattern);
			assert.strictEqual(null, parsed);
			assert.strictEqual(ValidationState.Error, reporter.state);
			assert(reporter.hasMessage('The problem pattern is invalid. The kind property must be provided only in the first element'));
		});

		test('kind: Location requires a regexp', () => {
			let problemPattern: matchers.Config.MultiLineProblemPattern = [
				{ file: 0, line: 1, column: 20, message: 0 }
			];
			let parsed = parser.parse(problemPattern);
			assert.strictEqual(null, parsed);
			assert.strictEqual(ValidationState.Error, reporter.state);
			assert(reporter.hasMessage('The problem pattern is missing a regular expression.'));
		});
		test('kind: Location requires a regexp on every entry', () => {
			let problemPattern: matchers.Config.MultiLineProblemPattern = [
				{ regexp: 'test', file: 3 },
				{ line: 4 },
				{ regexp: 'test2', column: 5 },
				{ regexp: 'test3', message: 6 }
			];
			let parsed = parser.parse(problemPattern);
			assert.strictEqual(null, parsed);
			assert.strictEqual(ValidationState.Error, reporter.state);
			assert(reporter.hasMessage('The problem pattern is missing a regular expression.'));
		});
		test('kind: Location requires a message', () => {
			let problemPattern: matchers.Config.MultiLineProblemPattern = [
				{ regexp: 'test', file: 0, line: 1, column: 20 }
			];
			let parsed = parser.parse(problemPattern);
			assert.strictEqual(null, parsed);
			assert.strictEqual(ValidationState.Error, reporter.state);
			assert(reporter.hasMessage('The problem pattern is invalid. It must have at least have a file and a message.'));
		});

		test('kind: Location requires a file', () => {
			let problemPattern: matchers.Config.MultiLineProblemPattern = [
				{ regexp: 'test', line: 1, column: 20, message: 0 }
			];
			let parsed = parser.parse(problemPattern);
			assert.strictEqual(null, parsed);
			assert.strictEqual(ValidationState.Error, reporter.state);
			assert(reporter.hasMessage('The problem pattern is invalid. It must either have kind: "file" or have a line or location match group.'));
		});

		test('kind: Location requires either a line or location', () => {
			let problemPattern: matchers.Config.MultiLineProblemPattern = [
				{ regexp: 'test', file: 1, column: 20, message: 0 }
			];
			let parsed = parser.parse(problemPattern);
			assert.strictEqual(null, parsed);
			assert.strictEqual(ValidationState.Error, reporter.state);
			assert(reporter.hasMessage('The problem pattern is invalid. It must either have kind: "file" or have a line or location match group.'));
		});

		test('kind: File accepts a regexp, file and message', () => {
			let problemPattern: matchers.Config.MultiLineProblemPattern = [
				{ regexp: 'test', file: 2, kind: 'file', message: 6 }
			];
			let parsed = parser.parse(problemPattern);
			assert(reporter.isOK());
			assert.deepStrictEqual(parsed,
				[{
					regexp: testRegexp,
					kind: matchers.ProblemLocationKind.File,
					file: 2,
					message: 6
				}]
			);
		});

		test('kind: File requires a file', () => {
			let problemPattern: matchers.Config.MultiLineProblemPattern = [
				{ regexp: 'test', kind: 'file', message: 6 }
			];
			let parsed = parser.parse(problemPattern);
			assert.strictEqual(null, parsed);
			assert.strictEqual(ValidationState.Error, reporter.state);
			assert(reporter.hasMessage('The problem pattern is invalid. It must have at least have a file and a message.'));
		});

		test('kind: File requires a message', () => {
			let problemPattern: matchers.Config.MultiLineProblemPattern = [
				{ regexp: 'test', kind: 'file', file: 6 }
			];
			let parsed = parser.parse(problemPattern);
			assert.strictEqual(null, parsed);
			assert.strictEqual(ValidationState.Error, reporter.state);
			assert(reporter.hasMessage('The problem pattern is invalid. It must have at least have a file and a message.'));
		});
	});
});
