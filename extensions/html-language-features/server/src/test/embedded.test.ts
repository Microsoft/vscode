/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import 'mocha';
import * as assert from 'assert';
import * as embeddedSupport from '../modes/embeddedSupport';
import { getLanguageService } from 'vscode-html-languageservice';
import { TextDocument } from '../modes/languageModes';

suite('HTML Embedded Support', () => {

	const htmlLanguageService = getLanguageService();

	function assertLanguageId(value: string, expectedLanguageId: string | undefined): void {
		const offset = value.indexOf('|');
		value = value.substr(0, offset) + value.substr(offset + 1);

		const document = TextDocument.create('test://test/test.html', 'html', 0, value);

		const position = document.positionAt(offset);

		const docRegions = embeddedSupport.getDocumentRegions(htmlLanguageService, document);
		const languageId = docRegions.getLanguageAtPosition(position);

		assert.strictEqual(languageId, expectedLanguageId);
	}

	function assertEmbeddedLanguageContent(value: string, languageId: string, expectedContent: string): void {
		const document = TextDocument.create('test://test/test.html', 'html', 0, value);

		const docRegions = embeddedSupport.getDocumentRegions(htmlLanguageService, document);
		const content = docRegions.getEmbeddedDocument(languageId);
		assert.strictEqual(content.getText(), expectedContent);
	}

	test('Styles', function (): any {
		assertLanguageId('|<html><style>foo { }</style></html>', 'html');
		assertLanguageId('<html|><style>foo { }</style></html>', 'html');
		assertLanguageId('<html><st|yle>foo { }</style></html>', 'html');
		assertLanguageId('<html><style>|foo { }</style></html>', 'css');
		assertLanguageId('<html><style>foo| { }</style></html>', 'css');
		assertLanguageId('<html><style>foo { }|</style></html>', 'css');
		assertLanguageId('<html><style>foo { }</sty|le></html>', 'html');
	});

	test('Styles - Incomplete HTML', function (): any {
		assertLanguageId('|<html><style>foo { }', 'html');
		assertLanguageId('<html><style>fo|o { }', 'css');
		assertLanguageId('<html><style>foo { }|', 'css');
	});

	test('Style in attribute', function (): any {
		assertLanguageId('<div id="xy" |style="color: red"/>', 'html');
		assertLanguageId('<div id="xy" styl|e="color: red"/>', 'html');
		assertLanguageId('<div id="xy" style=|"color: red"/>', 'html');
		assertLanguageId('<div id="xy" style="|color: red"/>', 'css');
		assertLanguageId('<div id="xy" style="color|: red"/>', 'css');
		assertLanguageId('<div id="xy" style="color: red|"/>', 'css');
		assertLanguageId('<div id="xy" style="color: red"|/>', 'html');
		assertLanguageId('<div id="xy" style=\'color: r|ed\'/>', 'css');
		assertLanguageId('<div id="xy" style|=color:red/>', 'html');
		assertLanguageId('<div id="xy" style=|color:red/>', 'css');
		assertLanguageId('<div id="xy" style=color:r|ed/>', 'css');
		assertLanguageId('<div id="xy" style=color:red|/>', 'css');
		assertLanguageId('<div id="xy" style=color:red/|>', 'html');
	});

	test('Style content', function (): any {
		assertEmbeddedLanguageContent('<html><style>foo { }</style></html>', 'css', '             foo { }               ');
		assertEmbeddedLanguageContent('<html><script>var i = 0;</script></html>', 'css', '                                        ');
		assertEmbeddedLanguageContent('<html><style>foo { }</style>Hello<style>foo { }</style></html>', 'css', '             foo { }                    foo { }               ');
		assertEmbeddedLanguageContent('<html>\n  <style>\n    foo { }  \n  </style>\n</html>\n', 'css', '\n         \n    foo { }  \n  \n\n');

		assertEmbeddedLanguageContent('<div style="color: red"></div>', 'css', '         __{color: red}       ');
		assertEmbeddedLanguageContent('<div style=color:red></div>', 'css', '        __{color:red}      ');
	});

	test('Scripts', function (): any {
		assertLanguageId('|<html><script>var i = 0;</script></html>', 'html');
		assertLanguageId('<html|><script>var i = 0;</script></html>', 'html');
		assertLanguageId('<html><scr|ipt>var i = 0;</script></html>', 'html');
		assertLanguageId('<html><script>|var i = 0;</script></html>', 'javascript');
		assertLanguageId('<html><script>var| i = 0;</script></html>', 'javascript');
		assertLanguageId('<html><script>var i = 0;|</script></html>', 'javascript');
		assertLanguageId('<html><script>var i = 0;</scr|ipt></html>', 'html');

		assertLanguageId('<script type="text/javascript">var| i = 0;</script>', 'javascript');
		assertLanguageId('<script type="text/ecmascript">var| i = 0;</script>', 'javascript');
		assertLanguageId('<script type="application/javascript">var| i = 0;</script>', 'javascript');
		assertLanguageId('<script type="application/ecmascript">var| i = 0;</script>', 'javascript');
		assertLanguageId('<script type="application/typescript">var| i = 0;</script>', undefined);
		assertLanguageId('<script type=\'text/javascript\'>var| i = 0;</script>', 'javascript');
	});

	test('Scripts in attribute', function (): any {
		assertLanguageId('<div |onKeyUp="foo()" onkeydown=\'bar()\'/>', 'html');
		assertLanguageId('<div onKeyUp=|"foo()" onkeydown=\'bar()\'/>', 'html');
		assertLanguageId('<div onKeyUp="|foo()" onkeydown=\'bar()\'/>', 'javascript');
		assertLanguageId('<div onKeyUp="foo(|)" onkeydown=\'bar()\'/>', 'javascript');
		assertLanguageId('<div onKeyUp="foo()|" onkeydown=\'bar()\'/>', 'javascript');
		assertLanguageId('<div onKeyUp="foo()"| onkeydown=\'bar()\'/>', 'html');
		assertLanguageId('<div onKeyUp="foo()" onkeydown=|\'bar()\'/>', 'html');
		assertLanguageId('<div onKeyUp="foo()" onkeydown=\'|bar()\'/>', 'javascript');
		assertLanguageId('<div onKeyUp="foo()" onkeydown=\'bar()|\'/>', 'javascript');
		assertLanguageId('<div onKeyUp="foo()" onkeydown=\'bar()\'|/>', 'html');

		assertLanguageId('<DIV ONKEYUP|=foo()</DIV>', 'html');
		assertLanguageId('<DIV ONKEYUP=|foo()</DIV>', 'javascript');
		assertLanguageId('<DIV ONKEYUP=f|oo()</DIV>', 'javascript');
		assertLanguageId('<DIV ONKEYUP=foo(|)</DIV>', 'javascript');
		assertLanguageId('<DIV ONKEYUP=foo()|</DIV>', 'javascript');
		assertLanguageId('<DIV ONKEYUP=foo()<|/DIV>', 'html');

		assertLanguageId('<label data-content="|Checkbox"/>', 'html');
		assertLanguageId('<label on="|Checkbox"/>', 'html');
	});

	test('Script content', function (): any {
		assertEmbeddedLanguageContent('<html><script>var i = 0;</script></html>', 'javascript', '              var i = 0;                ');
		assertEmbeddedLanguageContent('<script type="text/javascript">var i = 0;</script>', 'javascript', '                               var i = 0;         ');

		assertEmbeddedLanguageContent('<div onKeyUp="foo()" onkeydown="bar()"/>', 'javascript', '              foo();            bar();  ');
	});

});
