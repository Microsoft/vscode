/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { Scanner, TokenType, SnippetParser, Text, Placeholder, Variable, Marker, TextmateSnippet, Choice, FormatString, Transform } from 'vs/editor/contrib/snippet/snippetParser';

suite('SnippetParser', () => {

	test('Scanner', () => {

		const scanner = new Scanner();
		assert.strictEqual(scanner.next().type, TokenType.EOF);

		scanner.text('abc');
		assert.strictEqual(scanner.next().type, TokenType.VariableName);
		assert.strictEqual(scanner.next().type, TokenType.EOF);

		scanner.text('{{abc}}');
		assert.strictEqual(scanner.next().type, TokenType.CurlyOpen);
		assert.strictEqual(scanner.next().type, TokenType.CurlyOpen);
		assert.strictEqual(scanner.next().type, TokenType.VariableName);
		assert.strictEqual(scanner.next().type, TokenType.CurlyClose);
		assert.strictEqual(scanner.next().type, TokenType.CurlyClose);
		assert.strictEqual(scanner.next().type, TokenType.EOF);

		scanner.text('abc() ');
		assert.strictEqual(scanner.next().type, TokenType.VariableName);
		assert.strictEqual(scanner.next().type, TokenType.Format);
		assert.strictEqual(scanner.next().type, TokenType.EOF);

		scanner.text('abc 123');
		assert.strictEqual(scanner.next().type, TokenType.VariableName);
		assert.strictEqual(scanner.next().type, TokenType.Format);
		assert.strictEqual(scanner.next().type, TokenType.Int);
		assert.strictEqual(scanner.next().type, TokenType.EOF);

		scanner.text('$foo');
		assert.strictEqual(scanner.next().type, TokenType.Dollar);
		assert.strictEqual(scanner.next().type, TokenType.VariableName);
		assert.strictEqual(scanner.next().type, TokenType.EOF);

		scanner.text('$foo_bar');
		assert.strictEqual(scanner.next().type, TokenType.Dollar);
		assert.strictEqual(scanner.next().type, TokenType.VariableName);
		assert.strictEqual(scanner.next().type, TokenType.EOF);

		scanner.text('$foo-bar');
		assert.strictEqual(scanner.next().type, TokenType.Dollar);
		assert.strictEqual(scanner.next().type, TokenType.VariableName);
		assert.strictEqual(scanner.next().type, TokenType.Dash);
		assert.strictEqual(scanner.next().type, TokenType.VariableName);
		assert.strictEqual(scanner.next().type, TokenType.EOF);

		scanner.text('${foo}');
		assert.strictEqual(scanner.next().type, TokenType.Dollar);
		assert.strictEqual(scanner.next().type, TokenType.CurlyOpen);
		assert.strictEqual(scanner.next().type, TokenType.VariableName);
		assert.strictEqual(scanner.next().type, TokenType.CurlyClose);
		assert.strictEqual(scanner.next().type, TokenType.EOF);

		scanner.text('${1223:foo}');
		assert.strictEqual(scanner.next().type, TokenType.Dollar);
		assert.strictEqual(scanner.next().type, TokenType.CurlyOpen);
		assert.strictEqual(scanner.next().type, TokenType.Int);
		assert.strictEqual(scanner.next().type, TokenType.Colon);
		assert.strictEqual(scanner.next().type, TokenType.VariableName);
		assert.strictEqual(scanner.next().type, TokenType.CurlyClose);
		assert.strictEqual(scanner.next().type, TokenType.EOF);

		scanner.text('\\${}');
		assert.strictEqual(scanner.next().type, TokenType.Backslash);
		assert.strictEqual(scanner.next().type, TokenType.Dollar);
		assert.strictEqual(scanner.next().type, TokenType.CurlyOpen);
		assert.strictEqual(scanner.next().type, TokenType.CurlyClose);

		scanner.text('${foo/regex/format/option}');
		assert.strictEqual(scanner.next().type, TokenType.Dollar);
		assert.strictEqual(scanner.next().type, TokenType.CurlyOpen);
		assert.strictEqual(scanner.next().type, TokenType.VariableName);
		assert.strictEqual(scanner.next().type, TokenType.Forwardslash);
		assert.strictEqual(scanner.next().type, TokenType.VariableName);
		assert.strictEqual(scanner.next().type, TokenType.Forwardslash);
		assert.strictEqual(scanner.next().type, TokenType.VariableName);
		assert.strictEqual(scanner.next().type, TokenType.Forwardslash);
		assert.strictEqual(scanner.next().type, TokenType.VariableName);
		assert.strictEqual(scanner.next().type, TokenType.CurlyClose);
		assert.strictEqual(scanner.next().type, TokenType.EOF);
	});

	function assertText(value: string, expected: string) {
		const p = new SnippetParser();
		const actual = p.text(value);
		assert.strictEqual(actual, expected);
	}

	function assertMarker(input: TextmateSnippet | Marker[] | string, ...ctors: Function[]) {
		let marker: Marker[];
		if (input instanceof TextmateSnippet) {
			marker = input.children;
		} else if (typeof input === 'string') {
			const p = new SnippetParser();
			marker = p.parse(input).children;
		} else {
			marker = input;
		}
		while (marker.length > 0) {
			let m = marker.pop();
			let ctor = ctors.pop()!;
			assert.ok(m instanceof ctor);
		}
		assert.strictEqual(marker.length, ctors.length);
		assert.strictEqual(marker.length, 0);
	}

	function assertTextAndMarker(value: string, escaped: string, ...ctors: Function[]) {
		assertText(value, escaped);
		assertMarker(value, ...ctors);
	}

	function assertEscaped(value: string, expected: string) {
		const actual = SnippetParser.escape(value);
		assert.strictEqual(actual, expected);
	}

	test('Parser, escaped', function () {
		assertEscaped('foo$0', 'foo\\$0');
		assertEscaped('foo\\$0', 'foo\\\\\\$0');
		assertEscaped('f$1oo$0', 'f\\$1oo\\$0');
		assertEscaped('${1:foo}$0', '\\${1:foo\\}\\$0');
		assertEscaped('$', '\\$');
	});

	test('Parser, text', () => {
		assertText('$', '$');
		assertText('\\\\$', '\\$');
		assertText('{', '{');
		assertText('\\}', '}');
		assertText('\\abc', '\\abc');
		assertText('foo${f:\\}}bar', 'foo}bar');
		assertText('\\{', '\\{');
		assertText('I need \\\\\\$', 'I need \\$');
		assertText('\\', '\\');
		assertText('\\{{', '\\{{');
		assertText('{{', '{{');
		assertText('{{dd', '{{dd');
		assertText('}}', '}}');
		assertText('ff}}', 'ff}}');

		assertText('farboo', 'farboo');
		assertText('far{{}}boo', 'far{{}}boo');
		assertText('far{{123}}boo', 'far{{123}}boo');
		assertText('far\\{{123}}boo', 'far\\{{123}}boo');
		assertText('far{{id:bern}}boo', 'far{{id:bern}}boo');
		assertText('far{{id:bern {{basel}}}}boo', 'far{{id:bern {{basel}}}}boo');
		assertText('far{{id:bern {{id:basel}}}}boo', 'far{{id:bern {{id:basel}}}}boo');
		assertText('far{{id:bern {{id2:basel}}}}boo', 'far{{id:bern {{id2:basel}}}}boo');
	});


	test('Parser, TM text', () => {
		assertTextAndMarker('foo${1:bar}}', 'foobar}', Text, Placeholder, Text);
		assertTextAndMarker('foo${1:bar}${2:foo}}', 'foobarfoo}', Text, Placeholder, Placeholder, Text);

		assertTextAndMarker('foo${1:bar\\}${2:foo}}', 'foobar}foo', Text, Placeholder);

		let [, placeholder] = new SnippetParser().parse('foo${1:bar\\}${2:foo}}').children;
		let { children } = (<Placeholder>placeholder);

		assert.strictEqual((<Placeholder>placeholder).index, 1);
		assert.ok(children[0] instanceof Text);
		assert.strictEqual(children[0].toString(), 'bar}');
		assert.ok(children[1] instanceof Placeholder);
		assert.strictEqual(children[1].toString(), 'foo');
	});

	test('Parser, placeholder', () => {
		assertTextAndMarker('farboo', 'farboo', Text);
		assertTextAndMarker('far{{}}boo', 'far{{}}boo', Text);
		assertTextAndMarker('far{{123}}boo', 'far{{123}}boo', Text);
		assertTextAndMarker('far\\{{123}}boo', 'far\\{{123}}boo', Text);
	});

	test('Parser, literal code', () => {
		assertTextAndMarker('far`123`boo', 'far`123`boo', Text);
		assertTextAndMarker('far\\`123\\`boo', 'far\\`123\\`boo', Text);
	});

	test('Parser, variables/tabstop', () => {
		assertTextAndMarker('$far-boo', '-boo', Variable, Text);
		assertTextAndMarker('\\$far-boo', '$far-boo', Text);
		assertTextAndMarker('far$farboo', 'far', Text, Variable);
		assertTextAndMarker('far${farboo}', 'far', Text, Variable);
		assertTextAndMarker('$123', '', Placeholder);
		assertTextAndMarker('$farboo', '', Variable);
		assertTextAndMarker('$far12boo', '', Variable);
		assertTextAndMarker('000_${far}_000', '000__000', Text, Variable, Text);
		assertTextAndMarker('FFF_${TM_SELECTED_TEXT}_FFF$0', 'FFF__FFF', Text, Variable, Text, Placeholder);
	});

	test('Parser, variables/placeholder with defaults', () => {
		assertTextAndMarker('${name:value}', 'value', Variable);
		assertTextAndMarker('${1:value}', 'value', Placeholder);
		assertTextAndMarker('${1:bar${2:foo}bar}', 'barfoobar', Placeholder);

		assertTextAndMarker('${name:value', '${name:value', Text);
		assertTextAndMarker('${1:bar${2:foobar}', '${1:barfoobar', Text, Placeholder);
	});

	test('Parser, variable transforms', function () {
		assertTextAndMarker('${foo///}', '', Variable);
		assertTextAndMarker('${foo/regex/format/gmi}', '', Variable);
		assertTextAndMarker('${foo/([A-Z][a-z])/format/}', '', Variable);

		// invalid regex
		assertTextAndMarker('${foo/([A-Z][a-z])/format/GMI}', '${foo/([A-Z][a-z])/format/GMI}', Text);
		assertTextAndMarker('${foo/([A-Z][a-z])/format/funky}', '${foo/([A-Z][a-z])/format/funky}', Text);
		assertTextAndMarker('${foo/([A-Z][a-z]/format/}', '${foo/([A-Z][a-z]/format/}', Text);

		// tricky regex
		assertTextAndMarker('${foo/m\\/atch/$1/i}', '', Variable);
		assertMarker('${foo/regex\/format/options}', Text);

		// incomplete
		assertTextAndMarker('${foo///', '${foo///', Text);
		assertTextAndMarker('${foo/regex/format/options', '${foo/regex/format/options', Text);

		// format string
		assertMarker('${foo/.*/${0:fooo}/i}', Variable);
		assertMarker('${foo/.*/${1}/i}', Variable);
		assertMarker('${foo/.*/$1/i}', Variable);
		assertMarker('${foo/.*/This-$1-encloses/i}', Variable);
		assertMarker('${foo/.*/complex${1:else}/i}', Variable);
		assertMarker('${foo/.*/complex${1:-else}/i}', Variable);
		assertMarker('${foo/.*/complex${1:+if}/i}', Variable);
		assertMarker('${foo/.*/complex${1:?if:else}/i}', Variable);
		assertMarker('${foo/.*/complex${1:/upcase}/i}', Variable);

	});

	test('Parser, placeholder transforms', function () {
		assertTextAndMarker('${1///}', '', Placeholder);
		assertTextAndMarker('${1/regex/format/gmi}', '', Placeholder);
		assertTextAndMarker('${1/([A-Z][a-z])/format/}', '', Placeholder);

		// tricky regex
		assertTextAndMarker('${1/m\\/atch/$1/i}', '', Placeholder);
		assertMarker('${1/regex\/format/options}', Text);

		// incomplete
		assertTextAndMarker('${1///', '${1///', Text);
		assertTextAndMarker('${1/regex/format/options', '${1/regex/format/options', Text);
	});

	test('No way to escape forward slash in snippet regex #36715', function () {
		assertMarker('${TM_DIRECTORY/src\\//$1/}', Variable);
	});

	test('No way to escape forward slash in snippet format section #37562', function () {
		assertMarker('${TM_SELECTED_TEXT/a/\\/$1/g}', Variable);
		assertMarker('${TM_SELECTED_TEXT/a/in\\/$1ner/g}', Variable);
		assertMarker('${TM_SELECTED_TEXT/a/end\\//g}', Variable);
	});

	test('Parser, placeholder with choice', () => {

		assertTextAndMarker('${1|one,two,three|}', 'one', Placeholder);
		assertTextAndMarker('${1|one|}', 'one', Placeholder);
		assertTextAndMarker('${1|one1,two2|}', 'one1', Placeholder);
		assertTextAndMarker('${1|one1\\,two2|}', 'one1,two2', Placeholder);
		assertTextAndMarker('${1|one1\\|two2|}', 'one1|two2', Placeholder);
		assertTextAndMarker('${1|one1\\atwo2|}', 'one1\\atwo2', Placeholder);
		assertTextAndMarker('${1|one,two,three,|}', '${1|one,two,three,|}', Text);
		assertTextAndMarker('${1|one,', '${1|one,', Text);

		const p = new SnippetParser();
		const snippet = p.parse('${1|one,two,three|}');
		assertMarker(snippet, Placeholder);
		const expected = [Placeholder, Text, Text, Text];
		snippet.walk(marker => {
			assert.strictEqual(marker, expected.shift());
			return true;
		});
	});

	test('Snippet choices: unable to escape comma and pipe, #31521', function () {
		assertTextAndMarker('console.log(${1|not\\, not, five, 5, 1   23|});', 'console.log(not, not);', Text, Placeholder, Text);
	});

	test('Marker, toTextmateString()', function () {

		function assertTextsnippetString(input: string, expected: string): void {
			const snippet = new SnippetParser().parse(input);
			const actual = snippet.toTextmateString();
			assert.strictEqual(actual, expected);
		}

		assertTextsnippetString('$1', '$1');
		assertTextsnippetString('\\$1', '\\$1');
		assertTextsnippetString('console.log(${1|not\\, not, five, 5, 1   23|});', 'console.log(${1|not\\, not, five, 5, 1   23|});');
		assertTextsnippetString('console.log(${1|not\\, not, \\| five, 5, 1   23|});', 'console.log(${1|not\\, not, \\| five, 5, 1   23|});');
		assertTextsnippetString('this is text', 'this is text');
		assertTextsnippetString('this ${1:is ${2:nested with $var}}', 'this ${1:is ${2:nested with ${var}}}');
		assertTextsnippetString('this ${1:is ${2:nested with $var}}}', 'this ${1:is ${2:nested with ${var}}}\\}');
	});

	test('Marker, toTextmateString() <-> identity', function () {

		function assertIdent(input: string): void {
			// full loop: (1) parse input, (2) generate textmate string, (3) parse, (4) ensure both trees are equal
			const snippet = new SnippetParser().parse(input);
			const input2 = snippet.toTextmateString();
			const snippet2 = new SnippetParser().parse(input2);

			function checkCheckChildren(marker1: Marker, marker2: Marker) {
				assert.ok(marker1 instanceof Object.getPrototypeOf(marker2).constructor);
				assert.ok(marker2 instanceof Object.getPrototypeOf(marker1).constructor);

				assert.strictEqual(marker1.children.length, marker2.children.length);
				assert.strictEqual(marker1.toString(), marker2.toString());

				for (let i = 0; i < marker1.children.length; i++) {
					checkCheckChildren(marker1.children[i], marker2.children[i]);
				}
			}

			checkCheckChildren(snippet, snippet2);
		}

		assertIdent('$1');
		assertIdent('\\$1');
		assertIdent('console.log(${1|not\\, not, five, 5, 1   23|});');
		assertIdent('console.log(${1|not\\, not, \\| five, 5, 1   23|});');
		assertIdent('this is text');
		assertIdent('this ${1:is ${2:nested with $var}}');
		assertIdent('this ${1:is ${2:nested with $var}}}');
		assertIdent('this ${1:is ${2:nested with $var}} and repeating $1');
	});

	test('Parser, choise marker', () => {
		const { placeholders } = new SnippetParser().parse('${1|one,two,three|}');

		assert.strictEqual(placeholders.length, 1);
		assert.ok(placeholders[0].choice instanceof Choice);
		assert.ok(placeholders[0].children[0] instanceof Choice);
		assert.strictEqual((<Choice>placeholders[0].children[0]).options.length, 3);

		assertText('${1|one,two,three|}', 'one');
		assertText('\\${1|one,two,three|}', '${1|one,two,three|}');
		assertText('${1\\|one,two,three|}', '${1\\|one,two,three|}');
		assertText('${1||}', '${1||}');
	});

	test('Backslash character escape in choice tabstop doesn\'t work #58494', function () {

		const { placeholders } = new SnippetParser().parse('${1|\\,,},$,\\|,\\\\|}');
		assert.strictEqual(placeholders.length, 1);
		assert.ok(placeholders[0].choice instanceof Choice);
	});

	test('Parser, only textmate', () => {
		const p = new SnippetParser();
		assertMarker(p.parse('far{{}}boo'), Text);
		assertMarker(p.parse('far{{123}}boo'), Text);
		assertMarker(p.parse('far\\{{123}}boo'), Text);

		assertMarker(p.parse('far$0boo'), Text, Placeholder, Text);
		assertMarker(p.parse('far${123}boo'), Text, Placeholder, Text);
		assertMarker(p.parse('far\\${123}boo'), Text);
	});

	test('Parser, real world', () => {
		let marker = new SnippetParser().parse('console.warn(${1: $TM_SELECTED_TEXT })').children;

		assert.strictEqual(marker[0].toString(), 'console.warn(');
		assert.ok(marker[1] instanceof Placeholder);
		assert.strictEqual(marker[2].toString(), ')');

		const placeholder = <Placeholder>marker[1];
		assert.strictEqual(placeholder.index, 1);
		assert.strictEqual(placeholder.children.length, 3);
		assert.ok(placeholder.children[0] instanceof Text);
		assert.ok(placeholder.children[1] instanceof Variable);
		assert.ok(placeholder.children[2] instanceof Text);
		assert.strictEqual(placeholder.children[0].toString(), ' ');
		assert.strictEqual(placeholder.children[1].toString(), '');
		assert.strictEqual(placeholder.children[2].toString(), ' ');

		const nestedVariable = <Variable>placeholder.children[1];
		assert.strictEqual(nestedVariable.name, 'TM_SELECTED_TEXT');
		assert.strictEqual(nestedVariable.children.length, 0);

		marker = new SnippetParser().parse('$TM_SELECTED_TEXT').children;
		assert.strictEqual(marker.length, 1);
		assert.ok(marker[0] instanceof Variable);
	});

	test('Parser, transform example', () => {
		let { children } = new SnippetParser().parse('${1:name} : ${2:type}${3/\\s:=(.*)/${1:+ :=}${1}/};\n$0');

		//${1:name}
		assert.ok(children[0] instanceof Placeholder);
		assert.strictEqual(children[0].children.length, 1);
		assert.strictEqual(children[0].children[0].toString(), 'name');
		assert.strictEqual((<Placeholder>children[0]).transform, undefined);

		// :
		assert.ok(children[1] instanceof Text);
		assert.strictEqual(children[1].toString(), ' : ');

		//${2:type}
		assert.ok(children[2] instanceof Placeholder);
		assert.strictEqual(children[2].children.length, 1);
		assert.strictEqual(children[2].children[0].toString(), 'type');

		//${3/\\s:=(.*)/${1:+ :=}${1}/}
		assert.ok(children[3] instanceof Placeholder);
		assert.strictEqual(children[3].children.length, 0);
		assert.notStrictEqual((<Placeholder>children[3]).transform, undefined);
		let transform = (<Placeholder>children[3]).transform!;
		assert.deepStrictEqual(transform.regexp, /\s:=(.*)/);
		assert.strictEqual(transform.children.length, 2);
		assert.ok(transform.children[0] instanceof FormatString);
		assert.strictEqual((<FormatString>transform.children[0]).index, 1);
		assert.strictEqual((<FormatString>transform.children[0]).ifValue, ' :=');
		assert.ok(transform.children[1] instanceof FormatString);
		assert.strictEqual((<FormatString>transform.children[1]).index, 1);
		assert.ok(children[4] instanceof Text);
		assert.strictEqual(children[4].toString(), ';\n');

	});

	// TODO @jrieken making this strictEqul causes circular json conversion errors
	test('Parser, default placeholder values', () => {

		assertMarker('errorContext: `${1:err}`, error: $1', Text, Placeholder, Text, Placeholder);

		const [, p1, , p2] = new SnippetParser().parse('errorContext: `${1:err}`, error:$1').children;

		assert.strictEqual((<Placeholder>p1).index, 1);
		assert.strictEqual((<Placeholder>p1).children.length, 1);
		assert.strictEqual((<Text>(<Placeholder>p1).children[0]).toString(), 'err');

		assert.strictEqual((<Placeholder>p2).index, 1);
		assert.strictEqual((<Placeholder>p2).children.length, 1);
		assert.strictEqual((<Text>(<Placeholder>p2).children[0]).toString(), 'err');
	});

	// TODO @jrieken making this strictEqul causes circular json conversion errors
	test('Parser, default placeholder values and one transform', () => {

		assertMarker('errorContext: `${1:err}`, error: ${1/err/ok/}', Text, Placeholder, Text, Placeholder);

		const [, p3, , p4] = new SnippetParser().parse('errorContext: `${1:err}`, error:${1/err/ok/}').children;

		assert.strictEqual((<Placeholder>p3).index, 1);
		assert.strictEqual((<Placeholder>p3).children.length, 1);
		assert.strictEqual((<Text>(<Placeholder>p3).children[0]).toString(), 'err');
		assert.strictEqual((<Placeholder>p3).transform, undefined);

		assert.strictEqual((<Placeholder>p4).index, 1);
		assert.strictEqual((<Placeholder>p4).children.length, 1);
		assert.strictEqual((<Text>(<Placeholder>p4).children[0]).toString(), 'err');
		assert.notStrictEqual((<Placeholder>p4).transform, undefined);
	});

	test('Repeated snippet placeholder should always inherit, #31040', function () {
		assertText('${1:foo}-abc-$1', 'foo-abc-foo');
		assertText('${1:foo}-abc-${1}', 'foo-abc-foo');
		assertText('${1:foo}-abc-${1:bar}', 'foo-abc-foo');
		assertText('${1}-abc-${1:foo}', 'foo-abc-foo');
	});

	test('backspace esapce in TM only, #16212', () => {
		const actual = new SnippetParser().text('Foo \\\\${abc}bar');
		assert.strictEqual(actual, 'Foo \\bar');
	});

	test('colon as variable/placeholder value, #16717', () => {
		let actual = new SnippetParser().text('${TM_SELECTED_TEXT:foo:bar}');
		assert.strictEqual(actual, 'foo:bar');

		actual = new SnippetParser().text('${1:foo:bar}');
		assert.strictEqual(actual, 'foo:bar');
	});

	test('incomplete placeholder', () => {
		assertTextAndMarker('${1:}', '', Placeholder);
	});

	test('marker#len', () => {

		function assertLen(template: string, ...lengths: number[]): void {
			const snippet = new SnippetParser().parse(template, true);
			snippet.walk(m => {
				const expected = lengths.shift();
				assert.strictEqual(m.len(), expected);
				return true;
			});
			assert.strictEqual(lengths.length, 0);
		}

		assertLen('text$0', 4, 0);
		assertLen('$1text$0', 0, 4, 0);
		assertLen('te$1xt$0', 2, 0, 2, 0);
		assertLen('errorContext: `${1:err}`, error: $0', 15, 0, 3, 10, 0);
		assertLen('errorContext: `${1:err}`, error: $1$0', 15, 0, 3, 10, 0, 3, 0);
		assertLen('$TM_SELECTED_TEXT$0', 0, 0);
		assertLen('${TM_SELECTED_TEXT:def}$0', 0, 3, 0);
	});

	test('parser, parent node', function () {
		let snippet = new SnippetParser().parse('This ${1:is ${2:nested}}$0', true);

		assert.strictEqual(snippet.placeholders.length, 3);
		let [first, second] = snippet.placeholders;
		assert.strictEqual(first.index, 1);
		assert.strictEqual(second.index, 2);
		assert.ok(second.parent === first);
		assert.ok(first.parent === snippet);

		snippet = new SnippetParser().parse('${VAR:default${1:value}}$0', true);
		assert.strictEqual(snippet.placeholders.length, 2);
		[first] = snippet.placeholders;
		assert.strictEqual(first.index, 1);

		assert.ok(snippet.children[0] instanceof Variable);
		assert.ok(first.parent === snippet.children[0]);
	});

	test('TextmateSnippet#enclosingPlaceholders', () => {
		let snippet = new SnippetParser().parse('This ${1:is ${2:nested}}$0', true);
		let [first, second] = snippet.placeholders;

		assert.deepStrictEqual(snippet.enclosingPlaceholders(first), []);
		assert.deepStrictEqual(snippet.enclosingPlaceholders(second), [first]);
	});

	test('TextmateSnippet#offset', () => {
		let snippet = new SnippetParser().parse('te$1xt', true);
		assert.strictEqual(snippet.offset(snippet.children[0]), 0);
		assert.strictEqual(snippet.offset(snippet.children[1]), 2);
		assert.strictEqual(snippet.offset(snippet.children[2]), 2);

		snippet = new SnippetParser().parse('${TM_SELECTED_TEXT:def}', true);
		assert.strictEqual(snippet.offset(snippet.children[0]), 0);
		assert.strictEqual(snippet.offset((<Variable>snippet.children[0]).children[0]), 0);

		// forgein marker
		assert.strictEqual(snippet.offset(new Text('foo')), -1);
	});

	test('TextmateSnippet#placeholder', () => {
		let snippet = new SnippetParser().parse('te$1xt$0', true);
		let placeholders = snippet.placeholders;
		assert.strictEqual(placeholders.length, 2);

		snippet = new SnippetParser().parse('te$1xt$1$0', true);
		placeholders = snippet.placeholders;
		assert.strictEqual(placeholders.length, 3);


		snippet = new SnippetParser().parse('te$1xt$2$0', true);
		placeholders = snippet.placeholders;
		assert.strictEqual(placeholders.length, 3);

		snippet = new SnippetParser().parse('${1:bar${2:foo}bar}$0', true);
		placeholders = snippet.placeholders;
		assert.strictEqual(placeholders.length, 3);
	});

	test('TextmateSnippet#replace 1/2', function () {
		let snippet = new SnippetParser().parse('aaa${1:bbb${2:ccc}}$0', true);

		assert.strictEqual(snippet.placeholders.length, 3);
		const [, second] = snippet.placeholders;
		assert.strictEqual(second.index, 2);

		const enclosing = snippet.enclosingPlaceholders(second);
		assert.strictEqual(enclosing.length, 1);
		assert.strictEqual(enclosing[0].index, 1);

		let nested = new SnippetParser().parse('ddd$1eee$0', true);
		snippet.replace(second, nested.children);

		assert.strictEqual(snippet.toString(), 'aaabbbdddeee');
		assert.strictEqual(snippet.placeholders.length, 4);
		assert.strictEqual(snippet.placeholders[0].index, 1);
		assert.strictEqual(snippet.placeholders[1].index, 1);
		assert.strictEqual(snippet.placeholders[2].index, 0);
		assert.strictEqual(snippet.placeholders[3].index, 0);

		const newEnclosing = snippet.enclosingPlaceholders(snippet.placeholders[1]);
		assert.ok(newEnclosing[0] === snippet.placeholders[0]);
		assert.strictEqual(newEnclosing.length, 1);
		assert.strictEqual(newEnclosing[0].index, 1);
	});

	test('TextmateSnippet#replace 2/2', function () {
		let snippet = new SnippetParser().parse('aaa${1:bbb${2:ccc}}$0', true);

		assert.strictEqual(snippet.placeholders.length, 3);
		const [, second] = snippet.placeholders;
		assert.strictEqual(second.index, 2);

		let nested = new SnippetParser().parse('dddeee$0', true);
		snippet.replace(second, nested.children);

		assert.strictEqual(snippet.toString(), 'aaabbbdddeee');
		assert.strictEqual(snippet.placeholders.length, 3);
	});

	test('Snippet order for placeholders, #28185', function () {

		const _10 = new Placeholder(10);
		const _2 = new Placeholder(2);

		assert.strictEqual(Placeholder.compareByIndex(_10, _2), 1);
	});

	test('Maximum call stack size exceeded, #28983', function () {
		new SnippetParser().parse('${1:${foo:${1}}}');
	});

	test('Snippet can freeze the editor, #30407', function () {

		const seen = new Set<Marker>();

		seen.clear();
		new SnippetParser().parse('class ${1:${TM_FILENAME/(?:\\A|_)([A-Za-z0-9]+)(?:\\.rb)?/(?2::\\u$1)/g}} < ${2:Application}Controller\n  $3\nend').walk(marker => {
			assert.ok(!seen.has(marker));
			seen.add(marker);
			return true;
		});

		seen.clear();
		new SnippetParser().parse('${1:${FOO:abc$1def}}').walk(marker => {
			assert.ok(!seen.has(marker));
			seen.add(marker);
			return true;
		});
	});

	test('Snippets: make parser ignore `${0|choice|}`, #31599', function () {
		assertTextAndMarker('${0|foo,bar|}', '${0|foo,bar|}', Text);
		assertTextAndMarker('${1|foo,bar|}', 'foo', Placeholder);
	});


	test('Transform -> FormatString#resolve', function () {

		// shorthand functions
		assert.strictEqual(new FormatString(1, 'upcase').resolve('foo'), 'FOO');
		assert.strictEqual(new FormatString(1, 'downcase').resolve('FOO'), 'foo');
		assert.strictEqual(new FormatString(1, 'capitalize').resolve('bar'), 'Bar');
		assert.strictEqual(new FormatString(1, 'capitalize').resolve('bar no repeat'), 'Bar no repeat');
		assert.strictEqual(new FormatString(1, 'pascalcase').resolve('bar-foo'), 'BarFoo');
		assert.strictEqual(new FormatString(1, 'pascalcase').resolve('bar-42-foo'), 'Bar42Foo');
		assert.strictEqual(new FormatString(1, 'notKnown').resolve('input'), 'input');

		// if
		assert.strictEqual(new FormatString(1, undefined, 'foo', undefined).resolve(undefined), '');
		assert.strictEqual(new FormatString(1, undefined, 'foo', undefined).resolve(''), '');
		assert.strictEqual(new FormatString(1, undefined, 'foo', undefined).resolve('bar'), 'foo');

		// else
		assert.strictEqual(new FormatString(1, undefined, undefined, 'foo').resolve(undefined), 'foo');
		assert.strictEqual(new FormatString(1, undefined, undefined, 'foo').resolve(''), 'foo');
		assert.strictEqual(new FormatString(1, undefined, undefined, 'foo').resolve('bar'), 'bar');

		// if-else
		assert.strictEqual(new FormatString(1, undefined, 'bar', 'foo').resolve(undefined), 'foo');
		assert.strictEqual(new FormatString(1, undefined, 'bar', 'foo').resolve(''), 'foo');
		assert.strictEqual(new FormatString(1, undefined, 'bar', 'foo').resolve('baz'), 'bar');
	});

	test('Snippet variable transformation doesn\'t work if regex is complicated and snippet body contains \'$$\' #55627', function () {
		const snippet = new SnippetParser().parse('const fileName = "${TM_FILENAME/(.*)\\..+$/$1/}"');
		assert.strictEqual(snippet.toTextmateString(), 'const fileName = "${TM_FILENAME/(.*)\\..+$/${1}/}"');
	});

	test('[BUG] HTML attribute suggestions: Snippet session does not have end-position set, #33147', function () {

		const { placeholders } = new SnippetParser().parse('src="$1"', true);
		const [first, second] = placeholders;

		assert.strictEqual(placeholders.length, 2);
		assert.strictEqual(first.index, 1);
		assert.strictEqual(second.index, 0);

	});

	test('Snippet optional transforms are not applied correctly when reusing the same variable, #37702', function () {

		const transform = new Transform();
		transform.appendChild(new FormatString(1, 'upcase'));
		transform.appendChild(new FormatString(2, 'upcase'));
		transform.regexp = /^(.)|-(.)/g;

		assert.strictEqual(transform.resolve('my-file-name'), 'MyFileName');

		const clone = transform.clone();
		assert.strictEqual(clone.resolve('my-file-name'), 'MyFileName');
	});

	test('problem with snippets regex #40570', function () {

		const snippet = new SnippetParser().parse('${TM_DIRECTORY/.*src[\\/](.*)/$1/}');
		assertMarker(snippet, Variable);
	});

	test('Variable transformation doesn\'t work if undefined variables are used in the same snippet #51769', function () {
		let transform = new Transform();
		transform.appendChild(new Text('bar'));
		transform.regexp = new RegExp('foo', 'gi');
		assert.strictEqual(transform.toTextmateString(), '/foo/bar/ig');
	});

	test('Snippet parser freeze #53144', function () {
		let snippet = new SnippetParser().parse('${1/(void$)|(.+)/${1:?-\treturn nil;}/}');
		assertMarker(snippet, Placeholder);
	});

	test('snippets variable not resolved in JSON proposal #52931', function () {
		assertTextAndMarker('FOO${1:/bin/bash}', 'FOO/bin/bash', Text, Placeholder);
	});

	test('Mirroring sequence of nested placeholders not selected properly on backjumping #58736', function () {
		let snippet = new SnippetParser().parse('${3:nest1 ${1:nest2 ${2:nest3}}} $3');
		assert.strictEqual(snippet.children.length, 3);
		assert.ok(snippet.children[0] instanceof Placeholder);
		assert.ok(snippet.children[1] instanceof Text);
		assert.ok(snippet.children[2] instanceof Placeholder);

		function assertParent(marker: Marker) {
			marker.children.forEach(assertParent);
			if (!(marker instanceof Placeholder)) {
				return;
			}
			let found = false;
			let m: Marker = marker;
			while (m && !found) {
				if (m.parent === snippet) {
					found = true;
				}
				m = m.parent;
			}
			assert.ok(found);
		}
		let [, , clone] = snippet.children;
		assertParent(clone);
	});

	test('Backspace can\'t be escaped in snippet variable transforms #65412', function () {

		let snippet = new SnippetParser().parse('namespace ${TM_DIRECTORY/[\\/]/\\\\/g};');
		assertMarker(snippet, Text, Variable, Text);
	});

	test('Snippet cannot escape closing bracket inside conditional insertion variable replacement #78883', function () {

		let snippet = new SnippetParser().parse('${TM_DIRECTORY/(.+)/${1:+import { hello \\} from world}/}');
		let variable = <Variable>snippet.children[0];
		assert.strictEqual(snippet.children.length, 1);
		assert.ok(variable instanceof Variable);
		assert.ok(variable.transform);
		assert.strictEqual(variable.transform!.children.length, 1);
		assert.ok(variable.transform!.children[0] instanceof FormatString);
		assert.strictEqual((<FormatString>variable.transform!.children[0]).ifValue, 'import { hello } from world');
		assert.strictEqual((<FormatString>variable.transform!.children[0]).elseValue, undefined);
	});

	test('Snippet escape backslashes inside conditional insertion variable replacement #80394', function () {

		let snippet = new SnippetParser().parse('${CURRENT_YEAR/(.+)/${1:+\\\\}/}');
		let variable = <Variable>snippet.children[0];
		assert.strictEqual(snippet.children.length, 1);
		assert.ok(variable instanceof Variable);
		assert.ok(variable.transform);
		assert.strictEqual(variable.transform!.children.length, 1);
		assert.ok(variable.transform!.children[0] instanceof FormatString);
		assert.strictEqual((<FormatString>variable.transform!.children[0]).ifValue, '\\');
		assert.strictEqual((<FormatString>variable.transform!.children[0]).elseValue, undefined);
	});
});
