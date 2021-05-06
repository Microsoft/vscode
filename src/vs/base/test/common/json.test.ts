/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import {
	SyntaxKind, createScanner, parse, Node, ParseError, parseTree, ParseErrorCode, ParseOptions, ScanError
} from 'vs/base/common/json';
import { getParseErrorMessage } from 'vs/base/common/jsonErrorMessages';

function assertKinds(text: string, ...kinds: SyntaxKind[]): void {
	let scanner = createScanner(text);
	let kind: SyntaxKind;
	while ((kind = scanner.scan()) !== SyntaxKind.EOF) {
		assert.strictEqual(kind, kinds.shift());
	}
	assert.strictEqual(kinds.length, 0);
}
function assertScanError(text: string, expectedKind: SyntaxKind, scanError: ScanError): void {
	let scanner = createScanner(text);
	scanner.scan();
	assert.strictEqual(scanner.getToken(), expectedKind);
	assert.strictEqual(scanner.getTokenError(), scanError);
}

function assertValidParse(input: string, expected: any, options?: ParseOptions): void {
	let errors: ParseError[] = [];
	let actual = parse(input, errors, options);

	if (errors.length !== 0) {
		assert(false, getParseErrorMessage(errors[0].error));
	}
	assert.deepStrictEqual(actual, expected);
}

function assertInvalidParse(input: string, expected: any, options?: ParseOptions): void {
	let errors: ParseError[] = [];
	let actual = parse(input, errors, options);

	assert(errors.length > 0);
	assert.deepStrictEqual(actual, expected);
}

function assertTree(input: string, expected: any, expectedErrors: number[] = [], options?: ParseOptions): void {
	let errors: ParseError[] = [];
	let actual = parseTree(input, errors, options);

	assert.deepStrictEqual(errors.map(e => e.error, expected), expectedErrors);
	let checkParent = (node: Node) => {
		if (node.children) {
			for (let child of node.children) {
				assert.strictEqual(node, child.parent);
				delete (<any>child).parent; // delete to avoid recursion in deep equal
				checkParent(child);
			}
		}
	};
	checkParent(actual);

	assert.deepStrictEqual(actual, expected);
}

suite('JSON', () => {
	test('tokens', () => {
		assertKinds('{', SyntaxKind.OpenBraceToken);
		assertKinds('}', SyntaxKind.CloseBraceToken);
		assertKinds('[', SyntaxKind.OpenBracketToken);
		assertKinds(']', SyntaxKind.CloseBracketToken);
		assertKinds(':', SyntaxKind.ColonToken);
		assertKinds(',', SyntaxKind.CommaToken);
	});

	test('comments', () => {
		assertKinds('// this is a comment', SyntaxKind.LineCommentTrivia);
		assertKinds('// this is a comment\n', SyntaxKind.LineCommentTrivia, SyntaxKind.LineBreakTrivia);
		assertKinds('/* this is a comment*/', SyntaxKind.BlockCommentTrivia);
		assertKinds('/* this is a \r\ncomment*/', SyntaxKind.BlockCommentTrivia);
		assertKinds('/* this is a \ncomment*/', SyntaxKind.BlockCommentTrivia);

		// unexpected end
		assertKinds('/* this is a', SyntaxKind.BlockCommentTrivia);
		assertKinds('/* this is a \ncomment', SyntaxKind.BlockCommentTrivia);

		// broken comment
		assertKinds('/ ttt', SyntaxKind.Unknown, SyntaxKind.Trivia, SyntaxKind.Unknown);
	});

	test('strings', () => {
		assertKinds('"test"', SyntaxKind.StringLiteral);
		assertKinds('"\\""', SyntaxKind.StringLiteral);
		assertKinds('"\\/"', SyntaxKind.StringLiteral);
		assertKinds('"\\b"', SyntaxKind.StringLiteral);
		assertKinds('"\\f"', SyntaxKind.StringLiteral);
		assertKinds('"\\n"', SyntaxKind.StringLiteral);
		assertKinds('"\\r"', SyntaxKind.StringLiteral);
		assertKinds('"\\t"', SyntaxKind.StringLiteral);
		assertKinds('"\\v"', SyntaxKind.StringLiteral);
		assertKinds('"\u88ff"', SyntaxKind.StringLiteral);
		assertKinds('"​\u2028"', SyntaxKind.StringLiteral);

		// unexpected end
		assertKinds('"test', SyntaxKind.StringLiteral);
		assertKinds('"test\n"', SyntaxKind.StringLiteral, SyntaxKind.LineBreakTrivia, SyntaxKind.StringLiteral);

		// invalid characters
		assertScanError('"\t"', SyntaxKind.StringLiteral, ScanError.InvalidCharacter);
		assertScanError('"\t "', SyntaxKind.StringLiteral, ScanError.InvalidCharacter);
	});

	test('numbers', () => {
		assertKinds('0', SyntaxKind.NumericLiteral);
		assertKinds('0.1', SyntaxKind.NumericLiteral);
		assertKinds('-0.1', SyntaxKind.NumericLiteral);
		assertKinds('-1', SyntaxKind.NumericLiteral);
		assertKinds('1', SyntaxKind.NumericLiteral);
		assertKinds('123456789', SyntaxKind.NumericLiteral);
		assertKinds('10', SyntaxKind.NumericLiteral);
		assertKinds('90', SyntaxKind.NumericLiteral);
		assertKinds('90E+123', SyntaxKind.NumericLiteral);
		assertKinds('90e+123', SyntaxKind.NumericLiteral);
		assertKinds('90e-123', SyntaxKind.NumericLiteral);
		assertKinds('90E-123', SyntaxKind.NumericLiteral);
		assertKinds('90E123', SyntaxKind.NumericLiteral);
		assertKinds('90e123', SyntaxKind.NumericLiteral);

		// zero handling
		assertKinds('01', SyntaxKind.NumericLiteral, SyntaxKind.NumericLiteral);
		assertKinds('-01', SyntaxKind.NumericLiteral, SyntaxKind.NumericLiteral);

		// unexpected end
		assertKinds('-', SyntaxKind.Unknown);
		assertKinds('.0', SyntaxKind.Unknown);
	});

	test('keywords: true, false, null', () => {
		assertKinds('true', SyntaxKind.TrueKeyword);
		assertKinds('false', SyntaxKind.FalseKeyword);
		assertKinds('null', SyntaxKind.NullKeyword);


		assertKinds('true false null',
			SyntaxKind.TrueKeyword,
			SyntaxKind.Trivia,
			SyntaxKind.FalseKeyword,
			SyntaxKind.Trivia,
			SyntaxKind.NullKeyword);

		// invalid words
		assertKinds('nulllll', SyntaxKind.Unknown);
		assertKinds('True', SyntaxKind.Unknown);
		assertKinds('foo-bar', SyntaxKind.Unknown);
		assertKinds('foo bar', SyntaxKind.Unknown, SyntaxKind.Trivia, SyntaxKind.Unknown);
	});

	test('trivia', () => {
		assertKinds(' ', SyntaxKind.Trivia);
		assertKinds('  \t  ', SyntaxKind.Trivia);
		assertKinds('  \t  \n  \t  ', SyntaxKind.Trivia, SyntaxKind.LineBreakTrivia, SyntaxKind.Trivia);
		assertKinds('\r\n', SyntaxKind.LineBreakTrivia);
		assertKinds('\r', SyntaxKind.LineBreakTrivia);
		assertKinds('\n', SyntaxKind.LineBreakTrivia);
		assertKinds('\n\r', SyntaxKind.LineBreakTrivia, SyntaxKind.LineBreakTrivia);
		assertKinds('\n   \n', SyntaxKind.LineBreakTrivia, SyntaxKind.Trivia, SyntaxKind.LineBreakTrivia);
	});

	test('parse: literals', () => {

		assertValidParse('true', true);
		assertValidParse('false', false);
		assertValidParse('null', null);
		assertValidParse('"foo"', 'foo');
		assertValidParse('"\\"-\\\\-\\/-\\b-\\f-\\n-\\r-\\t"', '"-\\-/-\b-\f-\n-\r-\t');
		assertValidParse('"\\u00DC"', 'Ü');
		assertValidParse('9', 9);
		assertValidParse('-9', -9);
		assertValidParse('0.129', 0.129);
		assertValidParse('23e3', 23e3);
		assertValidParse('1.2E+3', 1.2E+3);
		assertValidParse('1.2E-3', 1.2E-3);
		assertValidParse('1.2E-3 // comment', 1.2E-3);
	});

	test('parse: objects', () => {
		assertValidParse('{}', {});
		assertValidParse('{ "foo": true }', { foo: true });
		assertValidParse('{ "bar": 8, "xoo": "foo" }', { bar: 8, xoo: 'foo' });
		assertValidParse('{ "hello": [], "world": {} }', { hello: [], world: {} });
		assertValidParse('{ "a": false, "b": true, "c": [ 7.4 ] }', { a: false, b: true, c: [7.4] });
		assertValidParse('{ "lineComment": "//", "blockComment": ["/*", "*/"], "brackets": [ ["{", "}"], ["[", "]"], ["(", ")"] ] }', { lineComment: '//', blockComment: ['/*', '*/'], brackets: [['{', '}'], ['[', ']'], ['(', ')']] });
		assertValidParse('{ "hello": [], "world": {} }', { hello: [], world: {} });
		assertValidParse('{ "hello": { "again": { "inside": 5 }, "world": 1 }}', { hello: { again: { inside: 5 }, world: 1 } });
		assertValidParse('{ "foo": /*hello*/true }', { foo: true });
	});

	test('parse: arrays', () => {
		assertValidParse('[]', []);
		assertValidParse('[ [],  [ [] ]]', [[], [[]]]);
		assertValidParse('[ 1, 2, 3 ]', [1, 2, 3]);
		assertValidParse('[ { "a": null } ]', [{ a: null }]);
	});

	test('parse: objects with errors', () => {
		assertInvalidParse('{,}', {});
		assertInvalidParse('{ "foo": true, }', { foo: true }, { allowTrailingComma: false });
		assertInvalidParse('{ "bar": 8 "xoo": "foo" }', { bar: 8, xoo: 'foo' });
		assertInvalidParse('{ ,"bar": 8 }', { bar: 8 });
		assertInvalidParse('{ ,"bar": 8, "foo" }', { bar: 8 });
		assertInvalidParse('{ "bar": 8, "foo": }', { bar: 8 });
		assertInvalidParse('{ 8, "foo": 9 }', { foo: 9 });
	});

	test('parse: array with errors', () => {
		assertInvalidParse('[,]', []);
		assertInvalidParse('[ 1, 2, ]', [1, 2], { allowTrailingComma: false });
		assertInvalidParse('[ 1 2, 3 ]', [1, 2, 3]);
		assertInvalidParse('[ ,1, 2, 3 ]', [1, 2, 3]);
		assertInvalidParse('[ ,1, 2, 3, ]', [1, 2, 3], { allowTrailingComma: false });
	});

	test('parse: disallow commments', () => {
		let options = { disallowComments: true };

		assertValidParse('[ 1, 2, null, "foo" ]', [1, 2, null, 'foo'], options);
		assertValidParse('{ "hello": [], "world": {} }', { hello: [], world: {} }, options);

		assertInvalidParse('{ "foo": /*comment*/ true }', { foo: true }, options);
	});

	test('parse: trailing comma', () => {
		// default is allow
		assertValidParse('{ "hello": [], }', { hello: [] });

		let options = { allowTrailingComma: true };
		assertValidParse('{ "hello": [], }', { hello: [] }, options);
		assertValidParse('{ "hello": [] }', { hello: [] }, options);
		assertValidParse('{ "hello": [], "world": {}, }', { hello: [], world: {} }, options);
		assertValidParse('{ "hello": [], "world": {} }', { hello: [], world: {} }, options);
		assertValidParse('{ "hello": [1,] }', { hello: [1] }, options);

		options = { allowTrailingComma: false };
		assertInvalidParse('{ "hello": [], }', { hello: [] }, options);
		assertInvalidParse('{ "hello": [], "world": {}, }', { hello: [], world: {} }, options);
	});

	test('tree: literals', () => {
		assertTree('true', { type: 'boolean', offset: 0, length: 4, value: true });
		assertTree('false', { type: 'boolean', offset: 0, length: 5, value: false });
		assertTree('null', { type: 'null', offset: 0, length: 4, value: null });
		assertTree('23', { type: 'number', offset: 0, length: 2, value: 23 });
		assertTree('-1.93e-19', { type: 'number', offset: 0, length: 9, value: -1.93e-19 });
		assertTree('"hello"', { type: 'string', offset: 0, length: 7, value: 'hello' });
	});

	test('tree: arrays', () => {
		assertTree('[]', { type: 'array', offset: 0, length: 2, children: [] });
		assertTree('[ 1 ]', { type: 'array', offset: 0, length: 5, children: [{ type: 'number', offset: 2, length: 1, value: 1 }] });
		assertTree('[ 1,"x"]', {
			type: 'array', offset: 0, length: 8, children: [
				{ type: 'number', offset: 2, length: 1, value: 1 },
				{ type: 'string', offset: 4, length: 3, value: 'x' }
			]
		});
		assertTree('[[]]', {
			type: 'array', offset: 0, length: 4, children: [
				{ type: 'array', offset: 1, length: 2, children: [] }
			]
		});
	});

	test('tree: objects', () => {
		assertTree('{ }', { type: 'object', offset: 0, length: 3, children: [] });
		assertTree('{ "val": 1 }', {
			type: 'object', offset: 0, length: 12, children: [
				{
					type: 'property', offset: 2, length: 8, colonOffset: 7, children: [
						{ type: 'string', offset: 2, length: 5, value: 'val' },
						{ type: 'number', offset: 9, length: 1, value: 1 }
					]
				}
			]
		});
		assertTree('{"id": "$", "v": [ null, null] }',
			{
				type: 'object', offset: 0, length: 32, children: [
					{
						type: 'property', offset: 1, length: 9, colonOffset: 5, children: [
							{ type: 'string', offset: 1, length: 4, value: 'id' },
							{ type: 'string', offset: 7, length: 3, value: '$' }
						]
					},
					{
						type: 'property', offset: 12, length: 18, colonOffset: 15, children: [
							{ type: 'string', offset: 12, length: 3, value: 'v' },
							{
								type: 'array', offset: 17, length: 13, children: [
									{ type: 'null', offset: 19, length: 4, value: null },
									{ type: 'null', offset: 25, length: 4, value: null }
								]
							}
						]
					}
				]
			}
		);
		assertTree('{  "id": { "foo": { } } , }',
			{
				type: 'object', offset: 0, length: 27, children: [
					{
						type: 'property', offset: 3, length: 20, colonOffset: 7, children: [
							{ type: 'string', offset: 3, length: 4, value: 'id' },
							{
								type: 'object', offset: 9, length: 14, children: [
									{
										type: 'property', offset: 11, length: 10, colonOffset: 16, children: [
											{ type: 'string', offset: 11, length: 5, value: 'foo' },
											{ type: 'object', offset: 18, length: 3, children: [] }
										]
									}
								]
							}
						]
					}
				]
			}
			, [ParseErrorCode.PropertyNameExpected, ParseErrorCode.ValueExpected], { allowTrailingComma: false });
	});
});
