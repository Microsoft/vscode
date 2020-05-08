/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { OperatingSystem } from 'vs/base/common/platform';
import { TerminalLinkManager, LineColumnInfo, XtermLinkMatcherHandler } from 'vs/workbench/contrib/terminal/browser/links/terminalLinkManager';
import * as strings from 'vs/base/common/strings';
import { ITerminalInstanceService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { Event } from 'vs/base/common/event';
import { ITerminalConfigHelper } from 'vs/workbench/contrib/terminal/common/terminal';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { TestPathService, TestEnvironmentService } from 'vs/workbench/test/browser/workbenchTestServices';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';

class TestTerminalLinkManager extends TerminalLinkManager {
	public get localLinkRegex(): RegExp {
		return this._localLinkRegex;
	}
	public get gitDiffLinkPreImageRegex(): RegExp {
		return this._gitDiffPreImageRegex;
	}
	public get gitDiffLinkPostImageRegex(): RegExp {
		return this._gitDiffPostImageRegex;
	}
	public preprocessPath(link: string): string | null {
		return this._preprocessPath(link);
	}
	protected _isLinkActivationModifierDown(event: MouseEvent): boolean {
		return true;
	}
	public wrapLinkHandler(handler: (link: string) => void): XtermLinkMatcherHandler {
		TerminalLinkManager._LINK_INTERCEPT_THRESHOLD = 0;
		return this._wrapLinkHandler((_, link) => handler(link));
	}
}

class TestXterm {
	public loadAddon() { }
	public registerLinkMatcher() { }
}

class MockTerminalInstanceService implements ITerminalInstanceService {
	onRequestDefaultShellAndArgs?: Event<any> | undefined;
	getDefaultShellAndArgs(): Promise<{ shell: string; args: string | string[] | undefined; }> {
		throw new Error('Method not implemented.');
	}
	_serviceBrand: undefined;
	getXtermConstructor(): Promise<any> {
		throw new Error('Method not implemented.');
	}
	getXtermSearchConstructor(): Promise<any> {
		throw new Error('Method not implemented.');
	}
	getXtermUnicode11Constructor(): Promise<any> {
		throw new Error('Method not implemented.');
	}
	async getXtermWebLinksConstructor(): Promise<any> {
		return (await import('xterm-addon-web-links')).WebLinksAddon;
	}
	getXtermWebglConstructor(): Promise<any> {
		throw new Error('Method not implemented.');
	}
	createWindowsShellHelper(): any {
		throw new Error('Method not implemented.');
	}
	createTerminalProcess(): any {
		throw new Error('Method not implemented.');
	}
	getMainProcessParentEnv(): any {
		throw new Error('Method not implemented.');
	}
}

interface LinkFormatInfo {
	urlFormat: string;
	line?: string;
	column?: string;
}

const testConfigHelper: ITerminalConfigHelper = <any>{
	config: {
		enableFileLinks: true
	}
};

suite('Workbench - TerminalLinkHandler', () => {
	let instantiationService: TestInstantiationService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(IEnvironmentService, TestEnvironmentService);
		instantiationService.stub(IPathService, new TestPathService());
		instantiationService.stub(ITerminalInstanceService, new MockTerminalInstanceService());
		instantiationService.stub(IConfigurationService, new TestConfigurationService());
	});

	suite('localLinkRegex', () => {
		test('Windows', () => {
			const terminalLinkHandler: TestTerminalLinkManager = instantiationService.createInstance(TestTerminalLinkManager, new TestXterm(), {
				os: OperatingSystem.Windows,
				userHome: ''
			} as any, testConfigHelper);
			function testLink(link: string, linkUrl: string, lineNo?: string, columnNo?: string) {
				assert.equal(terminalLinkHandler.extractLinkUrl(link), linkUrl);
				assert.equal(terminalLinkHandler.extractLinkUrl(`:${link}:`), linkUrl);
				assert.equal(terminalLinkHandler.extractLinkUrl(`;${link};`), linkUrl);
				assert.equal(terminalLinkHandler.extractLinkUrl(`(${link})`), linkUrl);

				if (lineNo) {
					const lineColumnInfo: LineColumnInfo = terminalLinkHandler.extractLineColumnInfo(link);
					assert.equal(lineColumnInfo.lineNumber, lineNo, `For link ${link}, expected line number ${lineNo}, actual ${lineColumnInfo.lineNumber}`);

					if (columnNo) {
						assert.equal(lineColumnInfo.columnNumber, columnNo, `For link ${link}, expected column number ${columnNo}, actual ${lineColumnInfo.columnNumber}`);
					}
				}
			}

			function generateAndTestLinks() {
				const linkUrls = [
					'c:\\foo',
					'\\\\?\\c:\\foo',
					'c:/foo',
					'.\\foo',
					'./foo',
					'..\\foo',
					'~\\foo',
					'~/foo',
					'c:/a/long/path',
					'c:\\a\\long\\path',
					'c:\\mixed/slash\\path',
					'a/relative/path',
					'plain/path',
					'plain\\path'
				];

				const supportedLinkFormats: LinkFormatInfo[] = [
					{ urlFormat: '{0}' },
					{ urlFormat: '{0} on line {1}', line: '5' },
					{ urlFormat: '{0} on line {1}, column {2}', line: '5', column: '3' },
					{ urlFormat: '{0}:line {1}', line: '5' },
					{ urlFormat: '{0}:line {1}, column {2}', line: '5', column: '3' },
					{ urlFormat: '{0}({1})', line: '5' },
					{ urlFormat: '{0} ({1})', line: '5' },
					{ urlFormat: '{0}({1},{2})', line: '5', column: '3' },
					{ urlFormat: '{0} ({1},{2})', line: '5', column: '3' },
					{ urlFormat: '{0}({1}, {2})', line: '5', column: '3' },
					{ urlFormat: '{0} ({1}, {2})', line: '5', column: '3' },
					{ urlFormat: '{0}:{1}', line: '5' },
					{ urlFormat: '{0}:{1}:{2}', line: '5', column: '3' },
					{ urlFormat: '{0}[{1}]', line: '5' },
					{ urlFormat: '{0} [{1}]', line: '5' },
					{ urlFormat: '{0}[{1},{2}]', line: '5', column: '3' },
					{ urlFormat: '{0} [{1},{2}]', line: '5', column: '3' },
					{ urlFormat: '{0}[{1}, {2}]', line: '5', column: '3' },
					{ urlFormat: '{0} [{1}, {2}]', line: '5', column: '3' },
					{ urlFormat: '"{0}",{1}', line: '5' }
				];

				linkUrls.forEach(linkUrl => {
					supportedLinkFormats.forEach(linkFormatInfo => {
						testLink(
							strings.format(linkFormatInfo.urlFormat, linkUrl, linkFormatInfo.line, linkFormatInfo.column),
							linkUrl,
							linkFormatInfo.line,
							linkFormatInfo.column
						);
					});
				});
			}

			generateAndTestLinks();
		});

		test('Linux', () => {
			const terminalLinkHandler: TestTerminalLinkManager = instantiationService.createInstance(TestTerminalLinkManager, new TestXterm(), {
				os: OperatingSystem.Linux,
				userHome: ''
			} as any, testConfigHelper);
			function testLink(link: string, linkUrl: string, lineNo?: string, columnNo?: string) {
				assert.equal(terminalLinkHandler.extractLinkUrl(link), linkUrl);
				assert.equal(terminalLinkHandler.extractLinkUrl(`:${link}:`), linkUrl);
				assert.equal(terminalLinkHandler.extractLinkUrl(`;${link};`), linkUrl);
				assert.equal(terminalLinkHandler.extractLinkUrl(`(${link})`), linkUrl);

				if (lineNo) {
					const lineColumnInfo: LineColumnInfo = terminalLinkHandler.extractLineColumnInfo(link);
					assert.equal(lineColumnInfo.lineNumber, lineNo, `For link ${link}, expected line number ${lineNo}, actual ${lineColumnInfo.lineNumber}`);

					if (columnNo) {
						assert.equal(lineColumnInfo.columnNumber, columnNo, `For link ${link}, expected column number ${columnNo}, actual ${lineColumnInfo.columnNumber}`);
					}
				}
			}

			function generateAndTestLinks() {
				const linkUrls = [
					'/foo',
					'~/foo',
					'./foo',
					'../foo',
					'/a/long/path',
					'a/relative/path'
				];

				const supportedLinkFormats: LinkFormatInfo[] = [
					{ urlFormat: '{0}' },
					{ urlFormat: '{0} on line {1}', line: '5' },
					{ urlFormat: '{0} on line {1}, column {2}', line: '5', column: '3' },
					{ urlFormat: '{0}:line {1}', line: '5' },
					{ urlFormat: '{0}:line {1}, column {2}', line: '5', column: '3' },
					{ urlFormat: '{0}({1})', line: '5' },
					{ urlFormat: '{0} ({1})', line: '5' },
					{ urlFormat: '{0}({1},{2})', line: '5', column: '3' },
					{ urlFormat: '{0} ({1},{2})', line: '5', column: '3' },
					{ urlFormat: '{0}:{1}', line: '5' },
					{ urlFormat: '{0}:{1}:{2}', line: '5', column: '3' },
					{ urlFormat: '{0}[{1}]', line: '5' },
					{ urlFormat: '{0} [{1}]', line: '5' },
					{ urlFormat: '{0}[{1},{2}]', line: '5', column: '3' },
					{ urlFormat: '{0} [{1},{2}]', line: '5', column: '3' },
					{ urlFormat: '"{0}",{1}', line: '5' }
				];

				linkUrls.forEach(linkUrl => {
					supportedLinkFormats.forEach(linkFormatInfo => {
						// console.log('linkFormatInfo: ', linkFormatInfo);
						testLink(
							strings.format(linkFormatInfo.urlFormat, linkUrl, linkFormatInfo.line, linkFormatInfo.column),
							linkUrl,
							linkFormatInfo.line,
							linkFormatInfo.column
						);
					});
				});
			}

			generateAndTestLinks();
		});
	});

	suite('preprocessPath', () => {
		test('Windows', () => {
			const linkHandler: TestTerminalLinkManager = instantiationService.createInstance(TestTerminalLinkManager, new TestXterm() as any, {
				os: OperatingSystem.Windows,
				userHome: 'C:\\Users\\Me'
			} as any, testConfigHelper);
			linkHandler.processCwd = 'C:\\base';

			assert.equal(linkHandler.preprocessPath('./src/file1'), 'C:\\base\\src\\file1');
			assert.equal(linkHandler.preprocessPath('src\\file2'), 'C:\\base\\src\\file2');
			assert.equal(linkHandler.preprocessPath('~/src/file3'), 'C:\\Users\\Me\\src\\file3');
			assert.equal(linkHandler.preprocessPath('~\\src\\file4'), 'C:\\Users\\Me\\src\\file4');
			assert.equal(linkHandler.preprocessPath('C:\\absolute\\path\\file5'), 'C:\\absolute\\path\\file5');
			assert.equal(linkHandler.preprocessPath('\\\\?\\C:\\absolute\\path\\extended\\file6'), 'C:\\absolute\\path\\extended\\file6');
		});
		test('Windows - spaces', () => {
			const linkHandler: TestTerminalLinkManager = instantiationService.createInstance(TestTerminalLinkManager, new TestXterm() as any, {
				os: OperatingSystem.Windows,
				userHome: 'C:\\Users\\M e'
			} as any, testConfigHelper);
			linkHandler.processCwd = 'C:\\base dir';

			assert.equal(linkHandler.preprocessPath('./src/file1'), 'C:\\base dir\\src\\file1');
			assert.equal(linkHandler.preprocessPath('src\\file2'), 'C:\\base dir\\src\\file2');
			assert.equal(linkHandler.preprocessPath('~/src/file3'), 'C:\\Users\\M e\\src\\file3');
			assert.equal(linkHandler.preprocessPath('~\\src\\file4'), 'C:\\Users\\M e\\src\\file4');
			assert.equal(linkHandler.preprocessPath('C:\\abso lute\\path\\file5'), 'C:\\abso lute\\path\\file5');
		});

		test('Linux', () => {
			const linkHandler: TestTerminalLinkManager = instantiationService.createInstance(TestTerminalLinkManager, new TestXterm() as any, {
				os: OperatingSystem.Linux,
				userHome: '/home/me'
			} as any, testConfigHelper);
			linkHandler.processCwd = '/base';

			assert.equal(linkHandler.preprocessPath('./src/file1'), '/base/src/file1');
			assert.equal(linkHandler.preprocessPath('src/file2'), '/base/src/file2');
			assert.equal(linkHandler.preprocessPath('~/src/file3'), '/home/me/src/file3');
			assert.equal(linkHandler.preprocessPath('/absolute/path/file4'), '/absolute/path/file4');
		});

		test('No Workspace', () => {
			const linkHandler: TestTerminalLinkManager = instantiationService.createInstance(TestTerminalLinkManager, new TestXterm() as any, {
				os: OperatingSystem.Linux,
				userHome: '/home/me'
			} as any, testConfigHelper);

			assert.equal(linkHandler.preprocessPath('./src/file1'), null);
			assert.equal(linkHandler.preprocessPath('src/file2'), null);
			assert.equal(linkHandler.preprocessPath('~/src/file3'), '/home/me/src/file3');
			assert.equal(linkHandler.preprocessPath('/absolute/path/file4'), '/absolute/path/file4');
		});
	});

	test('gitDiffLinkRegex', () => {
		// The platform is irrelevant because the links generated by Git are the same format regardless of platform
		const linkHandler: TestTerminalLinkManager = instantiationService.createInstance(TestTerminalLinkManager, new TestXterm() as any, {
			os: OperatingSystem.Linux,
			userHome: ''
		} as any, testConfigHelper);

		function assertAreGoodMatches(matches: RegExpMatchArray | null) {
			if (matches) {
				assert.equal(matches.length, 2);
				assert.equal(matches[1], 'src/file1');
			} else {
				assert.fail();
			}
		}

		// Happy cases
		assertAreGoodMatches('--- a/src/file1'.match(linkHandler.gitDiffLinkPreImageRegex));
		assertAreGoodMatches('--- a/src/file1             '.match(linkHandler.gitDiffLinkPreImageRegex));
		assertAreGoodMatches('+++ b/src/file1'.match(linkHandler.gitDiffLinkPostImageRegex));
		assertAreGoodMatches('+++ b/src/file1             '.match(linkHandler.gitDiffLinkPostImageRegex));

		// Make sure /dev/null isn't a match
		assert.equal(linkHandler.gitDiffLinkPreImageRegex.test('--- /dev/null'), false);
		assert.equal(linkHandler.gitDiffLinkPreImageRegex.test('--- /dev/null           '), false);
		assert.equal(linkHandler.gitDiffLinkPostImageRegex.test('+++ /dev/null'), false);
		assert.equal(linkHandler.gitDiffLinkPostImageRegex.test('+++ /dev/null          '), false);
	});

	suite('wrapLinkHandler', () => {
		const nullMouseEvent: any = Object.freeze({ preventDefault: () => { } });

		test('should allow intercepting of links with onBeforeHandleLink', async () => {
			const linkHandler: TestTerminalLinkManager = instantiationService.createInstance(TestTerminalLinkManager, new TestXterm() as any, {
				os: OperatingSystem.Linux,
				userHome: ''
			} as any, testConfigHelper);
			linkHandler.onBeforeHandleLink(e => {
				if (e.link === 'https://www.microsoft.com') {
					intercepted = true;
					e.resolve(true);
				}
				e.resolve(false);
			});
			const wrappedHandler = linkHandler.wrapLinkHandler(() => defaultHandled = true);

			let defaultHandled = false;
			let intercepted = false;
			await wrappedHandler(nullMouseEvent, 'https://www.visualstudio.com');
			assert.equal(intercepted, false);
			assert.equal(defaultHandled, true);

			defaultHandled = false;
			intercepted = false;
			await wrappedHandler(nullMouseEvent, 'https://www.microsoft.com');
			assert.equal(intercepted, true);
			assert.equal(defaultHandled, false);
		});
	});
});
