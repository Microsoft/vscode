/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TerminalProtocolLinkProvider } from 'vs/workbench/contrib/terminal/browser/links/terminalProtocolLinkProvider';
import { Terminal, ILink } from 'xterm';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

suite('Workbench - TerminalWebLinkProvider', () => {
	let instantiationService: TestInstantiationService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(IConfigurationService, TestConfigurationService);
	});

	async function assertLink(text: string, expected: { text: string, range: [number, number][] }[]) {
		const xterm = new Terminal();
		const provider = instantiationService.createInstance(TerminalProtocolLinkProvider, xterm, () => { }, () => { });

		// Write the text and wait for the parser to finish
		await new Promise<void>(r => xterm.write(text, r));

		// Ensure all links are provided
		const links = (await new Promise<ILink[] | undefined>(r => provider.provideLinks(1, r)))!;
		assert.strictEqual(links.length, expected.length);
		const actual = links.map(e => ({
			text: e.text,
			range: e.range
		}));
		const expectedVerbose = expected.map(e => ({
			text: e.text,
			range: {
				start: { x: e.range[0][0], y: e.range[0][1] },
				end: { x: e.range[1][0], y: e.range[1][1] },
			}
		}));
		assert.deepStrictEqual(actual, expectedVerbose);
	}

	// These tests are based on LinkComputer.test.ts
	test('LinkComputer cases', async () => {
		await assertLink('x = "http://foo.bar";', [{ range: [[6, 1], [19, 1]], text: 'http://foo.bar' }]);
		await assertLink('x = (http://foo.bar);', [{ range: [[6, 1], [19, 1]], text: 'http://foo.bar' }]);
		await assertLink('x = \'http://foo.bar\';', [{ range: [[6, 1], [19, 1]], text: 'http://foo.bar' }]);
		await assertLink('x =  http://foo.bar ;', [{ range: [[6, 1], [19, 1]], text: 'http://foo.bar' }]);
		await assertLink('x = <http://foo.bar>;', [{ range: [[6, 1], [19, 1]], text: 'http://foo.bar' }]);
		await assertLink('x = {http://foo.bar};', [{ range: [[6, 1], [19, 1]], text: 'http://foo.bar' }]);
		await assertLink('(see http://foo.bar)', [{ range: [[6, 1], [19, 1]], text: 'http://foo.bar' }]);
		await assertLink('[see http://foo.bar]', [{ range: [[6, 1], [19, 1]], text: 'http://foo.bar' }]);
		await assertLink('{see http://foo.bar}', [{ range: [[6, 1], [19, 1]], text: 'http://foo.bar' }]);
		await assertLink('<see http://foo.bar>', [{ range: [[6, 1], [19, 1]], text: 'http://foo.bar' }]);
		await assertLink('<url>http://foo.bar</url>', [{ range: [[6, 1], [19, 1]], text: 'http://foo.bar' }]);
		await assertLink('// Click here to learn more. https://go.microsoft.com/fwlink/?LinkID=513275&clcid=0x409', [{ range: [[30, 1], [7, 2]], text: 'https://go.microsoft.com/fwlink/?LinkID=513275&clcid=0x409' }]);
		await assertLink('// Click here to learn more. https://msdn.microsoft.com/en-us/library/windows/desktop/aa365247(v=vs.85).aspx', [{ range: [[30, 1], [28, 2]], text: 'https://msdn.microsoft.com/en-us/library/windows/desktop/aa365247(v=vs.85).aspx' }]);
		await assertLink('// https://github.com/projectkudu/kudu/blob/master/Kudu.Core/Scripts/selectNodeVersion.js', [{ range: [[4, 1], [9, 2]], text: 'https://github.com/projectkudu/kudu/blob/master/Kudu.Core/Scripts/selectNodeVersion.js' }]);
		await assertLink('<!-- !!! Do not remove !!!   WebContentRef(link:https://go.microsoft.com/fwlink/?LinkId=166007, area:Admin, updated:2015, nextUpdate:2016, tags:SqlServer)   !!! Do not remove !!! -->', [{ range: [[49, 1], [14, 2]], text: 'https://go.microsoft.com/fwlink/?LinkId=166007' }]);
		await assertLink('For instructions, see https://go.microsoft.com/fwlink/?LinkId=166007.</value>', [{ range: [[23, 1], [68, 1]], text: 'https://go.microsoft.com/fwlink/?LinkId=166007' }]);
		await assertLink('For instructions, see https://msdn.microsoft.com/en-us/library/windows/desktop/aa365247(v=vs.85).aspx.</value>', [{ range: [[23, 1], [21, 2]], text: 'https://msdn.microsoft.com/en-us/library/windows/desktop/aa365247(v=vs.85).aspx' }]);
		await assertLink('x = "https://en.wikipedia.org/wiki/Zürich";', [{ range: [[6, 1], [41, 1]], text: 'https://en.wikipedia.org/wiki/Zürich' }]);
		await assertLink('請參閱 http://go.microsoft.com/fwlink/?LinkId=761051。', [{ range: [[8, 1], [53, 1]], text: 'http://go.microsoft.com/fwlink/?LinkId=761051' }]);
		await assertLink('（請參閱 http://go.microsoft.com/fwlink/?LinkId=761051）', [{ range: [[10, 1], [55, 1]], text: 'http://go.microsoft.com/fwlink/?LinkId=761051' }]);
		await assertLink('x = "file:///foo.bar";', [{ range: [[6, 1], [20, 1]], text: 'file:///foo.bar' }]);
		await assertLink('x = "file://c:/foo.bar";', [{ range: [[6, 1], [22, 1]], text: 'file://c:/foo.bar' }]);
		await assertLink('x = "file://shares/foo.bar";', [{ range: [[6, 1], [26, 1]], text: 'file://shares/foo.bar' }]);
		await assertLink('x = "file://shäres/foo.bar";', [{ range: [[6, 1], [26, 1]], text: 'file://shäres/foo.bar' }]);
		await assertLink('Some text, then http://www.bing.com.', [{ range: [[17, 1], [35, 1]], text: 'http://www.bing.com' }]);
		await assertLink('let url = `http://***/_api/web/lists/GetByTitle(\'Teambuildingaanvragen\')/items`;', [{ range: [[12, 1], [78, 1]], text: 'http://***/_api/web/lists/GetByTitle(\'Teambuildingaanvragen\')/items' }]);
		await assertLink('7. At this point, ServiceMain has been called.  There is no functionality presently in ServiceMain, but you can consult the [MSDN documentation](https://msdn.microsoft.com/en-us/library/windows/desktop/ms687414(v=vs.85).aspx) to add functionality as desired!', [{ range: [[66, 2], [64, 3]], text: 'https://msdn.microsoft.com/en-us/library/windows/desktop/ms687414(v=vs.85).aspx' }]);
		await assertLink('let x = "http://[::1]:5000/connect/token"', [{ range: [[10, 1], [40, 1]], text: 'http://[::1]:5000/connect/token' }]);
		await assertLink('2. Navigate to **https://portal.azure.com**', [{ range: [[18, 1], [41, 1]], text: 'https://portal.azure.com' }]);
		await assertLink('POST|https://portal.azure.com|2019-12-05|', [{ range: [[6, 1], [29, 1]], text: 'https://portal.azure.com' }]);
		await assertLink('aa  https://foo.bar/[this is foo site]  aa', [{ range: [[5, 1], [38, 1]], text: 'https://foo.bar/[this is foo site]' }]);
	});

	test('should support multiple link results', async () => {
		await assertLink('http://foo.bar http://bar.foo', [
			{ range: [[1, 1], [14, 1]], text: 'http://foo.bar' },
			{ range: [[16, 1], [29, 1]], text: 'http://bar.foo' }
		]);
	});
});
