/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { ILink } from 'vs/editor/common/modes';
import { ILinkComputerTarget, computeLinks } from 'vs/editor/common/modes/linkComputer';

class SimpleLinkComputerTarget implements ILinkComputerTarget {

	constructor(private _lines: string[]) {
		// Intentional Empty
	}

	public getLineCount(): number {
		return this._lines.length;
	}

	public getLineContent(lineNumber: number): string {
		return this._lines[lineNumber - 1];
	}
}

function myComputeLinks(lines: string[]): ILink[] {
	let target = new SimpleLinkComputerTarget(lines);
	return computeLinks(target);
}

function assertLink(text: string, extractedLink: string): void {
	let startColumn = 0,
		endColumn = 0,
		chr: string,
		i = 0;

	for (i = 0; i < extractedLink.length; i++) {
		chr = extractedLink.charAt(i);
		if (chr !== ' ' && chr !== '\t') {
			startColumn = i + 1;
			break;
		}
	}

	for (i = extractedLink.length - 1; i >= 0; i--) {
		chr = extractedLink.charAt(i);
		if (chr !== ' ' && chr !== '\t') {
			endColumn = i + 2;
			break;
		}
	}

	let r = myComputeLinks([text]);
	assert.deepEqual(r, [{
		range: {
			startLineNumber: 1,
			startColumn: startColumn,
			endLineNumber: 1,
			endColumn: endColumn
		},
		url: extractedLink.substring(startColumn - 1, endColumn - 1)
	}]);
}

suite('Editor Modes - Link Computer', () => {

	test('Null model', () => {
		let r = computeLinks(null);
		assert.deepEqual(r, []);
	});

	test('Parsing', () => {

		assertLink(
			'x = "http://foo.bar";',
			'     http://foo.bar  '
		);

		assertLink(
			'x = (http://foo.bar);',
			'     http://foo.bar  '
		);

		assertLink(
			'x = [http://foo.bar];',
			'     http://foo.bar  '
		);

		assertLink(
			'x = \'http://foo.bar\';',
			'     http://foo.bar  '
		);

		assertLink(
			'x =  http://foo.bar ;',
			'     http://foo.bar  '
		);

		assertLink(
			'x = <http://foo.bar>;',
			'     http://foo.bar  '
		);

		assertLink(
			'x = {http://foo.bar};',
			'     http://foo.bar  '
		);

		assertLink(
			'(see http://foo.bar)',
			'     http://foo.bar  '
		);
		assertLink(
			'[see http://foo.bar]',
			'     http://foo.bar  '
		);
		assertLink(
			'{see http://foo.bar}',
			'     http://foo.bar  '
		);
		assertLink(
			'<see http://foo.bar>',
			'     http://foo.bar  '
		);
		assertLink(
			'<url>http://mylink.com</url>',
			'     http://mylink.com      '
		);
		assertLink(
			'// Click here to learn more. https://go.microsoft.com/fwlink/?LinkID=513275&clcid=0x409',
			'                             https://go.microsoft.com/fwlink/?LinkID=513275&clcid=0x409'
		);
		assertLink(
			'// Click here to learn more. https://msdn.microsoft.com/en-us/library/windows/desktop/aa365247(v=vs.85).aspx',
			'                             https://msdn.microsoft.com/en-us/library/windows/desktop/aa365247(v=vs.85).aspx'
		);
		assertLink(
			'// https://github.com/projectkudu/kudu/blob/master/Kudu.Core/Scripts/selectNodeVersion.js',
			'   https://github.com/projectkudu/kudu/blob/master/Kudu.Core/Scripts/selectNodeVersion.js'
		);
		assertLink(
			'<!-- !!! Do not remove !!!   WebContentRef(link:https://go.microsoft.com/fwlink/?LinkId=166007, area:Admin, updated:2015, nextUpdate:2016, tags:SqlServer)   !!! Do not remove !!! -->',
			'                                                https://go.microsoft.com/fwlink/?LinkId=166007                                                                                        '
		);
		assertLink(
			'For instructions, see https://go.microsoft.com/fwlink/?LinkId=166007.</value>',
			'                      https://go.microsoft.com/fwlink/?LinkId=166007         '
		);
		assertLink(
			'For instructions, see https://msdn.microsoft.com/en-us/library/windows/desktop/aa365247(v=vs.85).aspx.</value>',
			'                      https://msdn.microsoft.com/en-us/library/windows/desktop/aa365247(v=vs.85).aspx         '
		);
		assertLink(
			'x = "https://en.wikipedia.org/wiki/Zürich";',
			'     https://en.wikipedia.org/wiki/Zürich  '
		);
		assertLink(
			'請參閱 http://go.microsoft.com/fwlink/?LinkId=761051。',
			'    http://go.microsoft.com/fwlink/?LinkId=761051 '
		);
		assertLink(
			'（請參閱 http://go.microsoft.com/fwlink/?LinkId=761051）',
			'     http://go.microsoft.com/fwlink/?LinkId=761051 '
		);

		assertLink(
			'x = "file:///foo.bar";',
			'     file:///foo.bar  '
		);
		assertLink(
			'x = "file://c:/foo.bar";',
			'     file://c:/foo.bar  '
		);

		assertLink(
			'x = "file://shares/foo.bar";',
			'     file://shares/foo.bar  '
		);

		assertLink(
			'x = "file://shäres/foo.bar";',
			'     file://shäres/foo.bar  '
		);
		assertLink(
			'Some text, then http://www.bing.com.',
			'                http://www.bing.com '
		);
		assertLink(
			'let url = `http://***/_api/web/lists/GetByTitle(\'Teambuildingaanvragen\')/items`;',
			'           http://***/_api/web/lists/GetByTitle(\'Teambuildingaanvragen\')/items  '
		);
	});

	test('issue #7855', () => {
		assertLink(
			'7. At this point, ServiceMain has been called.  There is no functionality presently in ServiceMain, but you can consult the [MSDN documentation](https://msdn.microsoft.com/en-us/library/windows/desktop/ms687414(v=vs.85).aspx) to add functionality as desired!',
			'                                                                                                                                                 https://msdn.microsoft.com/en-us/library/windows/desktop/ms687414(v=vs.85).aspx                                  '
		);
	});

	test('issue #62278: "Ctrl + click to follow link" for IPv6 URLs', () => {
		assertLink(
			'let x = "http://[::1]:5000/connect/token"',
			'         http://[::1]:5000/connect/token  '
		);
	});

	test('issue #70254: bold links dont open in markdown file using editor mode with ctrl + click', () => {
		assertLink(
			'2. Navigate to **https://portal.azure.com**',
			'                 https://portal.azure.com  '
		);
	});

	test('issue #86358: URL wrong recognition pattern', () => {
		assertLink(
			'POST|https://portal.azure.com|2019-12-05|',
			'     https://portal.azure.com            '
		);
	});

	test('issue #67022: Space as end of hyperlink isn\'t always good idea', () => {
		assertLink(
			'aa  https://foo.bar/[this is foo site]  aa',
			'    https://foo.bar/[this is foo site]    '
		);
	});

	test('issue #100353: Link detection stops at ＆(double-byte)', () => {
		assertLink(
			'aa  http://tree-mark.chips.jp/レーズン＆ベリーミックス  aa',
			'    http://tree-mark.chips.jp/レーズン＆ベリーミックス    '
		);
	});
});
