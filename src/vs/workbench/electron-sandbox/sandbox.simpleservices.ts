/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/* eslint-disable code-import-patterns */

import { URI } from 'vs/base/common/uri';
import { InMemoryFileSystemProvider } from 'vs/platform/files/common/inMemoryFilesystemProvider';
import { Event } from 'vs/base/common/event';
import { IAddressProvider } from 'vs/platform/remote/common/remoteAgentConnection';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IExtensionService, NullExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { isWindows } from 'vs/base/common/platform';
import { IWebviewService, WebviewContentOptions, WebviewElement, WebviewExtensionDescription, WebviewOptions, WebviewOverlay } from 'vs/workbench/contrib/webview/browser/webview';
import { ITunnelProvider, ITunnelService, RemoteTunnel, TunnelProviderFeatures } from 'vs/platform/remote/common/tunnel';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { joinPath } from 'vs/base/common/resources';
import { VSBuffer } from 'vs/base/common/buffer';
import { SearchService } from 'vs/workbench/services/search/common/searchService';
import { ISearchService } from 'vs/workbench/services/search/common/search';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';

//#region Environment

//#region Workspace

export const simpleWorkspaceDir = URI.file(isWindows ? '\\simpleWorkspace' : '/simpleWorkspace');

//#endregion


//#region Files

class SimpleFileSystemProvider extends InMemoryFileSystemProvider { }

export const simpleFileSystemProvider = new SimpleFileSystemProvider();

export async function initFileSystem(environmentService: INativeWorkbenchEnvironmentService, fileService: IFileService): Promise<void> {
	await fileService.createFolder(environmentService.userHome);
	await fileService.createFolder(environmentService.tmpDir);

	const userData = URI.file(environmentService.userDataPath);
	await fileService.writeFile(joinPath(userData, 'User', 'settings.json'), VSBuffer.fromString(JSON.stringify({
		'window.zoomLevel': 1,
		'workbench.colorTheme': 'Default Light+',
	}, undefined, '\t')));

	await fileService.writeFile(joinPath(userData, 'User', 'keybindings.json'), VSBuffer.fromString(JSON.stringify([
		{
			'key': 'f12',
			'command': 'workbench.action.toggleDevTools'
		}
	], undefined, '\t')));
}

function createWorkspaceFile(parent: string, name: string, content: string = ''): void {
	simpleFileSystemProvider.writeFile(joinPath(simpleWorkspaceDir, parent, name), VSBuffer.fromString(content).buffer, { create: true, overwrite: true, unlock: false });
}

function createWorkspaceFolder(name: string): void {
	simpleFileSystemProvider.mkdir(joinPath(simpleWorkspaceDir, name));
}

createWorkspaceFolder('');
createWorkspaceFolder('src');
createWorkspaceFolder('test');

createWorkspaceFile('', '.gitignore', `out
node_modules
.vscode-test/
*.vsix
`);

createWorkspaceFile('', '.vscodeignore', `.vscode/**
.vscode-test/**
out/test/**
src/**
.gitignore
vsc-extension-quickstart.md
**/tsconfig.json
**/tslint.json
**/*.map
**/*.ts`);

createWorkspaceFile('', 'CHANGELOG.md', `# Change Log
All notable changes to the "test-ts" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [Unreleased]
- Initial release`);
createWorkspaceFile('', 'package.json', `{
	"name": "test-ts",
	"displayName": "test-ts",
	"description": "",
	"version": "0.0.1",
	"engines": {
		"vscode": "^1.31.0"
	},
	"categories": [
		"Other"
	],
	"activationEvents": [
		"onCommand:extension.helloWorld"
	],
	"main": "./out/extension.js",
	"contributes": {
		"commands": [
			{
				"command": "extension.helloWorld",
				"title": "Hello World"
			}
		]
	},
	"scripts": {
		"vscode:prepublish": "npm run compile",
		"compile": "tsc -p ./",
		"watch": "tsc -watch -p ./",
		"postinstall": "node ./node_modules/vscode/bin/install",
		"test": "npm run compile && node ./node_modules/vscode/bin/test"
	},
	"devDependencies": {
		"typescript": "^3.3.1",
		"vscode": "^1.1.28",
		"tslint": "^5.12.1",
		"@types/node": "^8.10.25",
		"@types/mocha": "^2.2.42"
	}
}
`);

createWorkspaceFile('', 'tsconfig.json', `{
	"compilerOptions": {
		"module": "commonjs",
		"target": "es6",
		"outDir": "out",
		"lib": [
			"es6"
		],
		"sourceMap": true,
		"rootDir": "src",
		"strict": true   /* enable all strict type-checking options */
		/* Additional Checks */
		// "noImplicitReturns": true, /* Report error when not all code paths in function return a value. */
		// "noFallthroughCasesInSwitch": true, /* Report errors for fallthrough cases in switch statement. */
		// "noUnusedParameters": true,  /* Report errors on unused parameters. */
	},
	"exclude": [
		"node_modules",
		".vscode-test"
	]
}
`);

createWorkspaceFile('', 'tslint.json', `{
	"rules": {
		"no-string-throw": true,
		"no-unused-expression": true,
		"no-duplicate-variable": true,
		"curly": true,
		"class-name": true,
		"semicolon": [
			true,
			"always"
		],
		"triple-equals": true
	},
	"defaultSeverity": "warning"
}
`);

createWorkspaceFile('src', 'extension.ts', `// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';

// this method is called when your extension is activated
// your extension is activated the very first time the command is executed
export function activate(context: vscode.ExtensionContext) {

	// Use the console to output diagnostic information (console.log) and errors (console.error)
	// This line of code will only be executed once when your extension is activated
		console.log('Congratulations, your extension "test-ts" is now active!');

	// The command has been defined in the package.json file
	// Now provide the implementation of the command with registerCommand
	// The commandId parameter must match the command field in package.json
	let disposable = vscode.commands.registerCommand('extension.helloWorld', () => {
		// The code you place here will be executed every time your command is executed

		// Display a message box to the user
		vscode.window.showInformationMessage('Hello World!');
	});

	context.subscriptions.push(disposable);
}

// this method is called when your extension is deactivated
export function deactivate() {}
`);

createWorkspaceFile('test', 'extension.test.ts', `//
// Note: This example test is leveraging the Mocha test framework.
// Please refer to their documentation on https://mochajs.org/ for help.
//

// The module 'assert' provides assertion methods from node
import * as assert from 'assert';

// You can import and use all API from the 'vscode' module
// as well as import your extension to test it
// import * as vscode from 'vscode';
// import * as myExtension from '../extension';

// Defines a Mocha test suite to group tests of similar kind together
suite("Extension Tests", function () {

	// Defines a Mocha unit test
	test("Something 1", function() {
		assert.strictEqual(-1, [1, 2, 3].indexOf(5));
		assert.strictEqual(-1, [1, 2, 3].indexOf(0));
	});
});`);

createWorkspaceFile('test', 'index.ts', `//
// PLEASE DO NOT MODIFY / DELETE UNLESS YOU KNOW WHAT YOU ARE DOING
//
// This file is providing the test runner to use when running extension tests.
// By default the test runner in use is Mocha based.
//
// You can provide your own test runner if you want to override it by exporting
// a function run(testRoot: string, clb: (error:Error) => void) that the extension
// host can call to run the tests. The test runner is expected to use console.log
// to report the results back to the caller. When the tests are finished, return
// a possible error to the callback or null if none.

import * as testRunner from 'vscode/lib/testrunner';

// You can directly control Mocha options by configuring the test runner below
// See https://github.com/mochajs/mocha/wiki/Using-mocha-programmatically#set-options
// for more info
testRunner.configure({
	ui: 'tdd', 		// the TDD UI is being used in extension.test.ts (suite, test, etc.)
	useColors: true // colored output from test results
});

module.exports = testRunner;`);

//#endregion


//#region Extensions

class SimpleExtensionService extends NullExtensionService { }

registerSingleton(IExtensionService, SimpleExtensionService);

//#endregion


//#region Webview

class SimpleWebviewService implements IWebviewService {
	declare readonly _serviceBrand: undefined;

	readonly activeWebview = undefined;
	readonly onDidChangeActiveWebview = Event.None;

	createWebviewElement(id: string, options: WebviewOptions, contentOptions: WebviewContentOptions, extension: WebviewExtensionDescription | undefined): WebviewElement { throw new Error('Method not implemented.'); }
	createWebviewOverlay(id: string, options: WebviewOptions, contentOptions: WebviewContentOptions, extension: WebviewExtensionDescription | undefined): WebviewOverlay { throw new Error('Method not implemented.'); }
}

registerSingleton(IWebviewService, SimpleWebviewService);

//#endregion


//#region Tunnel

class SimpleTunnelService implements ITunnelService {

	declare readonly _serviceBrand: undefined;

	tunnels: Promise<readonly RemoteTunnel[]> = Promise.resolve([]);
	canElevate: boolean = false;
	canMakePublic = false;
	onTunnelOpened = Event.None;
	onTunnelClosed = Event.None;

	canTunnel(uri: URI): boolean { return false; }
	openTunnel(addressProvider: IAddressProvider | undefined, remoteHost: string | undefined, remotePort: number, localPort?: number): Promise<RemoteTunnel> | undefined { return undefined; }
	async changeTunnelPrivacy(remoteHost: string, remotePort: number, isPublic: boolean): Promise<RemoteTunnel | undefined> { return undefined; }
	async closeTunnel(remoteHost: string, remotePort: number): Promise<void> { }
	setTunnelProvider(provider: ITunnelProvider | undefined, features: TunnelProviderFeatures): IDisposable { return Disposable.None; }
}

registerSingleton(ITunnelService, SimpleTunnelService);

//#endregion


//#region Search Service

class SimpleSearchService extends SearchService {
	constructor(
		@IModelService modelService: IModelService,
		@IEditorService editorService: IEditorService,
		@ITelemetryService telemetryService: ITelemetryService,
		@ILogService logService: ILogService,
		@IExtensionService extensionService: IExtensionService,
		@IFileService fileService: IFileService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
	) {
		super(modelService, editorService, telemetryService, logService, extensionService, fileService, uriIdentityService);
	}
}

registerSingleton(ISearchService, SimpleSearchService);

//#endregion
