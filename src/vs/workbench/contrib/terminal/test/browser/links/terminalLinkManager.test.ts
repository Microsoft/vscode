/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { OperatingSystem } from 'vs/base/common/platform';
import { TerminalLinkManager, XtermLinkMatcherHandler } from 'vs/workbench/contrib/terminal/browser/links/terminalLinkManager';
import { Terminal as XtermTerminal } from 'xterm';
import { ITerminalInstanceService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { Event } from 'vs/base/common/event';
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

class MockTerminalInstanceService implements ITerminalInstanceService {
	onRequestDefaultShellAndArgs?: Event<any> | undefined;
	getDefaultShellAndArgs(): Promise<{ shell: string; args: string | string[] | undefined; }> {
		throw new Error('Method not implemented.');
	}
	declare readonly _serviceBrand: undefined;
	getXtermConstructor(): Promise<any> {
		throw new Error('Method not implemented.');
	}
	getXtermSearchConstructor(): Promise<any> {
		throw new Error('Method not implemented.');
	}
	getXtermUnicode11Constructor(): Promise<any> {
		throw new Error('Method not implemented.');
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

suite('Workbench - TerminalLinkManager', () => {
	let instantiationService: TestInstantiationService;

	setup(async () => {
		const configurationService = new TestConfigurationService();
		await configurationService.setUserConfiguration('terminal', { integrated: { enableFileLinks: true } });

		instantiationService = new TestInstantiationService();
		instantiationService.stub(IEnvironmentService, TestEnvironmentService);
		instantiationService.stub(IPathService, new TestPathService());
		instantiationService.stub(ITerminalInstanceService, new MockTerminalInstanceService());
		instantiationService.stub(IConfigurationService, configurationService);
	});

	suite('preprocessPath', () => {
		test('Windows', () => {
			const linkHandler: TestTerminalLinkManager = instantiationService.createInstance(TestTerminalLinkManager, new XtermTerminal() as any, {
				os: OperatingSystem.Windows,
				userHome: 'C:\\Users\\Me'
			} as any);
			linkHandler.processCwd = 'C:\\base';

			assert.equal(linkHandler.preprocessPath('./src/file1'), 'C:\\base\\src\\file1');
			assert.equal(linkHandler.preprocessPath('src\\file2'), 'C:\\base\\src\\file2');
			assert.equal(linkHandler.preprocessPath('~/src/file3'), 'C:\\Users\\Me\\src\\file3');
			assert.equal(linkHandler.preprocessPath('~\\src\\file4'), 'C:\\Users\\Me\\src\\file4');
			assert.equal(linkHandler.preprocessPath('C:\\absolute\\path\\file5'), 'C:\\absolute\\path\\file5');
			assert.equal(linkHandler.preprocessPath('\\\\?\\C:\\absolute\\path\\extended\\file6'), 'C:\\absolute\\path\\extended\\file6');
		});
		test('Windows - spaces', () => {
			const linkHandler: TestTerminalLinkManager = instantiationService.createInstance(TestTerminalLinkManager, new XtermTerminal() as any, {
				os: OperatingSystem.Windows,
				userHome: 'C:\\Users\\M e'
			} as any);
			linkHandler.processCwd = 'C:\\base dir';

			assert.equal(linkHandler.preprocessPath('./src/file1'), 'C:\\base dir\\src\\file1');
			assert.equal(linkHandler.preprocessPath('src\\file2'), 'C:\\base dir\\src\\file2');
			assert.equal(linkHandler.preprocessPath('~/src/file3'), 'C:\\Users\\M e\\src\\file3');
			assert.equal(linkHandler.preprocessPath('~\\src\\file4'), 'C:\\Users\\M e\\src\\file4');
			assert.equal(linkHandler.preprocessPath('C:\\abso lute\\path\\file5'), 'C:\\abso lute\\path\\file5');
		});

		test('Linux', () => {
			const linkHandler: TestTerminalLinkManager = instantiationService.createInstance(TestTerminalLinkManager, new XtermTerminal() as any, {
				os: OperatingSystem.Linux,
				userHome: '/home/me'
			} as any);
			linkHandler.processCwd = '/base';

			assert.equal(linkHandler.preprocessPath('./src/file1'), '/base/src/file1');
			assert.equal(linkHandler.preprocessPath('src/file2'), '/base/src/file2');
			assert.equal(linkHandler.preprocessPath('~/src/file3'), '/home/me/src/file3');
			assert.equal(linkHandler.preprocessPath('/absolute/path/file4'), '/absolute/path/file4');
		});

		test('No Workspace', () => {
			const linkHandler: TestTerminalLinkManager = instantiationService.createInstance(TestTerminalLinkManager, new XtermTerminal() as any, {
				os: OperatingSystem.Linux,
				userHome: '/home/me'
			} as any);

			assert.equal(linkHandler.preprocessPath('./src/file1'), null);
			assert.equal(linkHandler.preprocessPath('src/file2'), null);
			assert.equal(linkHandler.preprocessPath('~/src/file3'), '/home/me/src/file3');
			assert.equal(linkHandler.preprocessPath('/absolute/path/file4'), '/absolute/path/file4');
		});
	});

	suite('wrapLinkHandler', () => {
		const nullMouseEvent: any = Object.freeze({ preventDefault: () => { } });

		test('should allow intercepting of links with onBeforeHandleLink', async () => {
			const linkHandler: TestTerminalLinkManager = instantiationService.createInstance(TestTerminalLinkManager, new XtermTerminal() as any, {
				os: OperatingSystem.Linux,
				userHome: ''
			} as any);
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
