/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CancellationToken } from 'vs/base/common/cancellation';
import { basename } from 'vs/base/common/path';
import { URI, UriComponents } from 'vs/base/common/uri';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
import { IWorkspaceFolderData } from 'vs/platform/workspace/common/workspace';
import { MainThreadWorkspace } from 'vs/workbench/api/browser/mainThreadWorkspace';
import { IMainContext, IWorkspaceData, MainContext, ITextSearchComplete } from 'vs/workbench/api/common/extHost.protocol';
import { RelativePattern } from 'vs/workbench/api/common/extHostTypes';
import { ExtHostWorkspace } from 'vs/workbench/api/common/extHostWorkspace';
import { mock } from 'vs/base/test/common/mock';
import { TestRPCProtocol } from './testRPCProtocol';
import { ExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { IExtHostInitDataService } from 'vs/workbench/api/common/extHostInitDataService';
import { ITextQueryBuilderOptions } from 'vs/workbench/contrib/search/common/queryBuilder';
import { IPatternInfo } from 'vs/workbench/services/search/common/search';
import { isLinux, isWindows } from 'vs/base/common/platform';
import { IExtHostFileSystemInfo } from 'vs/workbench/api/common/extHostFileSystemInfo';
import { FileSystemProviderCapabilities } from 'vs/platform/files/common/files';

function createExtHostWorkspace(mainContext: IMainContext, data: IWorkspaceData, logService: ILogService): ExtHostWorkspace {
	const result = new ExtHostWorkspace(
		new ExtHostRpcService(mainContext),
		new class extends mock<IExtHostInitDataService>() { workspace = data; },
		new class extends mock<IExtHostFileSystemInfo>() { override getCapabilities() { return isLinux ? FileSystemProviderCapabilities.PathCaseSensitive : undefined; } },
		logService,
	);
	result.$initializeWorkspace(data, true);
	return result;
}

suite('ExtHostWorkspace', function () {

	const extensionDescriptor: IExtensionDescription = {
		identifier: new ExtensionIdentifier('nullExtensionDescription'),
		name: 'ext',
		publisher: 'vscode',
		enableProposedApi: false,
		engines: undefined!,
		extensionLocation: undefined!,
		isBuiltin: false,
		isUserBuiltin: false,
		isUnderDevelopment: false,
		version: undefined!
	};

	function assertAsRelativePath(workspace: ExtHostWorkspace, input: string, expected: string, includeWorkspace?: boolean) {
		const actual = workspace.getRelativePath(input, includeWorkspace);
		assert.strictEqual(actual, expected);
	}

	test('asRelativePath', () => {

		const ws = createExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', folders: [aWorkspaceFolderData(URI.file('/Coding/Applications/NewsWoWBot'), 0)], name: 'Test' }, new NullLogService());

		assertAsRelativePath(ws, '/Coding/Applications/NewsWoWBot/bernd/das/brot', 'bernd/das/brot');
		assertAsRelativePath(ws, '/Apps/DartPubCache/hosted/pub.dartlang.org/convert-2.0.1/lib/src/hex.dart',
			'/Apps/DartPubCache/hosted/pub.dartlang.org/convert-2.0.1/lib/src/hex.dart');

		assertAsRelativePath(ws, '', '');
		assertAsRelativePath(ws, '/foo/bar', '/foo/bar');
		assertAsRelativePath(ws, 'in/out', 'in/out');
	});

	test('asRelativePath, same paths, #11402', function () {
		const root = '/home/aeschli/workspaces/samples/docker';
		const input = '/home/aeschli/workspaces/samples/docker';
		const ws = createExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', folders: [aWorkspaceFolderData(URI.file(root), 0)], name: 'Test' }, new NullLogService());

		assertAsRelativePath(ws, input, input);

		const input2 = '/home/aeschli/workspaces/samples/docker/a.file';
		assertAsRelativePath(ws, input2, 'a.file');
	});

	test('asRelativePath, no workspace', function () {
		const ws = createExtHostWorkspace(new TestRPCProtocol(), null!, new NullLogService());
		assertAsRelativePath(ws, '', '');
		assertAsRelativePath(ws, '/foo/bar', '/foo/bar');
	});

	test('asRelativePath, multiple folders', function () {
		const ws = createExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', folders: [aWorkspaceFolderData(URI.file('/Coding/One'), 0), aWorkspaceFolderData(URI.file('/Coding/Two'), 1)], name: 'Test' }, new NullLogService());
		assertAsRelativePath(ws, '/Coding/One/file.txt', 'One/file.txt');
		assertAsRelativePath(ws, '/Coding/Two/files/out.txt', 'Two/files/out.txt');
		assertAsRelativePath(ws, '/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt');
	});

	test('slightly inconsistent behaviour of asRelativePath and getWorkspaceFolder, #31553', function () {
		const mrws = createExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', folders: [aWorkspaceFolderData(URI.file('/Coding/One'), 0), aWorkspaceFolderData(URI.file('/Coding/Two'), 1)], name: 'Test' }, new NullLogService());

		assertAsRelativePath(mrws, '/Coding/One/file.txt', 'One/file.txt');
		assertAsRelativePath(mrws, '/Coding/One/file.txt', 'One/file.txt', true);
		assertAsRelativePath(mrws, '/Coding/One/file.txt', 'file.txt', false);
		assertAsRelativePath(mrws, '/Coding/Two/files/out.txt', 'Two/files/out.txt');
		assertAsRelativePath(mrws, '/Coding/Two/files/out.txt', 'Two/files/out.txt', true);
		assertAsRelativePath(mrws, '/Coding/Two/files/out.txt', 'files/out.txt', false);
		assertAsRelativePath(mrws, '/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt');
		assertAsRelativePath(mrws, '/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt', true);
		assertAsRelativePath(mrws, '/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt', false);

		const srws = createExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', folders: [aWorkspaceFolderData(URI.file('/Coding/One'), 0)], name: 'Test' }, new NullLogService());
		assertAsRelativePath(srws, '/Coding/One/file.txt', 'file.txt');
		assertAsRelativePath(srws, '/Coding/One/file.txt', 'file.txt', false);
		assertAsRelativePath(srws, '/Coding/One/file.txt', 'One/file.txt', true);
		assertAsRelativePath(srws, '/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt');
		assertAsRelativePath(srws, '/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt', true);
		assertAsRelativePath(srws, '/Coding/Two2/files/out.txt', '/Coding/Two2/files/out.txt', false);
	});

	test('getPath, legacy', function () {
		let ws = createExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [] }, new NullLogService());
		assert.strictEqual(ws.getPath(), undefined);

		ws = createExtHostWorkspace(new TestRPCProtocol(), null!, new NullLogService());
		assert.strictEqual(ws.getPath(), undefined);

		ws = createExtHostWorkspace(new TestRPCProtocol(), undefined!, new NullLogService());
		assert.strictEqual(ws.getPath(), undefined);

		ws = createExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.file('Folder'), 0), aWorkspaceFolderData(URI.file('Another/Folder'), 1)] }, new NullLogService());
		assert.strictEqual(ws.getPath()!.replace(/\\/g, '/'), '/Folder');

		ws = createExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.file('/Folder'), 0)] }, new NullLogService());
		assert.strictEqual(ws.getPath()!.replace(/\\/g, '/'), '/Folder');
	});

	test('WorkspaceFolder has name and index', function () {
		const ws = createExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', folders: [aWorkspaceFolderData(URI.file('/Coding/One'), 0), aWorkspaceFolderData(URI.file('/Coding/Two'), 1)], name: 'Test' }, new NullLogService());

		const [one, two] = ws.getWorkspaceFolders()!;

		assert.strictEqual(one.name, 'One');
		assert.strictEqual(one.index, 0);
		assert.strictEqual(two.name, 'Two');
		assert.strictEqual(two.index, 1);
	});

	test('getContainingWorkspaceFolder', () => {
		const ws = createExtHostWorkspace(new TestRPCProtocol(), {
			id: 'foo',
			name: 'Test',
			folders: [
				aWorkspaceFolderData(URI.file('/Coding/One'), 0),
				aWorkspaceFolderData(URI.file('/Coding/Two'), 1),
				aWorkspaceFolderData(URI.file('/Coding/Two/Nested'), 2)
			]
		}, new NullLogService());

		let folder = ws.getWorkspaceFolder(URI.file('/foo/bar'));
		assert.strictEqual(folder, undefined);

		folder = ws.getWorkspaceFolder(URI.file('/Coding/One/file/path.txt'))!;
		assert.strictEqual(folder.name, 'One');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two/file/path.txt'))!;
		assert.strictEqual(folder.name, 'Two');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two/Nest'))!;
		assert.strictEqual(folder.name, 'Two');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two/Nested/file'))!;
		assert.strictEqual(folder.name, 'Nested');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two/Nested/f'))!;
		assert.strictEqual(folder.name, 'Nested');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two/Nested'), true)!;
		assert.strictEqual(folder.name, 'Two');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two/Nested/'), true)!;
		assert.strictEqual(folder.name, 'Two');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two/Nested'))!;
		assert.strictEqual(folder.name, 'Nested');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two/Nested/'))!;
		assert.strictEqual(folder.name, 'Nested');

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two'), true)!;
		assert.strictEqual(folder, undefined);

		folder = ws.getWorkspaceFolder(URI.file('/Coding/Two'), false)!;
		assert.strictEqual(folder.name, 'Two');
	});

	test('Multiroot change event should have a delta, #29641', function (done) {
		let ws = createExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [] }, new NullLogService());

		let finished = false;
		const finish = (error?: any) => {
			if (!finished) {
				finished = true;
				done(error);
			}
		};

		let sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.deepStrictEqual(e.added, []);
				assert.deepStrictEqual(e.removed, []);
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [] });
		sub.dispose();

		sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.deepStrictEqual(e.removed, []);
				assert.strictEqual(e.added.length, 1);
				assert.strictEqual(e.added[0].uri.toString(), 'foo:bar');
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar'), 0)] });
		sub.dispose();

		sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.deepStrictEqual(e.removed, []);
				assert.strictEqual(e.added.length, 1);
				assert.strictEqual(e.added[0].uri.toString(), 'foo:bar2');
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar'), 0), aWorkspaceFolderData(URI.parse('foo:bar2'), 1)] });
		sub.dispose();

		sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.strictEqual(e.removed.length, 2);
				assert.strictEqual(e.removed[0].uri.toString(), 'foo:bar');
				assert.strictEqual(e.removed[1].uri.toString(), 'foo:bar2');

				assert.strictEqual(e.added.length, 1);
				assert.strictEqual(e.added[0].uri.toString(), 'foo:bar3');
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar3'), 0)] });
		sub.dispose();
		finish();
	});

	test('Multiroot change keeps existing workspaces live', function () {
		let ws = createExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar'), 0)] }, new NullLogService());

		let firstFolder = ws.getWorkspaceFolders()![0];
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar2'), 0), aWorkspaceFolderData(URI.parse('foo:bar'), 1, 'renamed')] });

		assert.strictEqual(ws.getWorkspaceFolders()![1], firstFolder);
		assert.strictEqual(firstFolder.index, 1);
		assert.strictEqual(firstFolder.name, 'renamed');

		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar3'), 0), aWorkspaceFolderData(URI.parse('foo:bar2'), 1), aWorkspaceFolderData(URI.parse('foo:bar'), 2)] });
		assert.strictEqual(ws.getWorkspaceFolders()![2], firstFolder);
		assert.strictEqual(firstFolder.index, 2);

		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar3'), 0)] });
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar3'), 0), aWorkspaceFolderData(URI.parse('foo:bar'), 1)] });

		assert.notStrictEqual(firstFolder, ws.workspace!.folders[0]);
	});

	test('updateWorkspaceFolders - invalid arguments', function () {
		let ws = createExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [] }, new NullLogService());

		assert.strictEqual(false, ws.updateWorkspaceFolders(extensionDescriptor, null!, null!));
		assert.strictEqual(false, ws.updateWorkspaceFolders(extensionDescriptor, 0, 0));
		assert.strictEqual(false, ws.updateWorkspaceFolders(extensionDescriptor, 0, 1));
		assert.strictEqual(false, ws.updateWorkspaceFolders(extensionDescriptor, 1, 0));
		assert.strictEqual(false, ws.updateWorkspaceFolders(extensionDescriptor, -1, 0));
		assert.strictEqual(false, ws.updateWorkspaceFolders(extensionDescriptor, -1, -1));

		ws = createExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar'), 0)] }, new NullLogService());

		assert.strictEqual(false, ws.updateWorkspaceFolders(extensionDescriptor, 1, 1));
		assert.strictEqual(false, ws.updateWorkspaceFolders(extensionDescriptor, 0, 2));
		assert.strictEqual(false, ws.updateWorkspaceFolders(extensionDescriptor, 0, 1, asUpdateWorkspaceFolderData(URI.parse('foo:bar'))));
	});

	test('updateWorkspaceFolders - valid arguments', function (done) {
		let finished = false;
		const finish = (error?: any) => {
			if (!finished) {
				finished = true;
				done(error);
			}
		};

		const protocol: IMainContext = {
			getProxy: () => { return undefined!; },
			set: () => { return undefined!; },
			assertRegistered: () => { },
			drain: () => { return undefined!; },
		};

		const ws = createExtHostWorkspace(protocol, { id: 'foo', name: 'Test', folders: [] }, new NullLogService());

		//
		// Add one folder
		//

		assert.strictEqual(true, ws.updateWorkspaceFolders(extensionDescriptor, 0, 0, asUpdateWorkspaceFolderData(URI.parse('foo:bar'))));
		assert.strictEqual(1, ws.workspace!.folders.length);
		assert.strictEqual(ws.workspace!.folders[0].uri.toString(), URI.parse('foo:bar').toString());

		const firstAddedFolder = ws.getWorkspaceFolders()![0];

		let gotEvent = false;
		let sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.deepStrictEqual(e.removed, []);
				assert.strictEqual(e.added.length, 1);
				assert.strictEqual(e.added[0].uri.toString(), 'foo:bar');
				assert.strictEqual(e.added[0], firstAddedFolder); // verify object is still live
				gotEvent = true;
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar'), 0)] }); // simulate acknowledgement from main side
		assert.strictEqual(gotEvent, true);
		sub.dispose();
		assert.strictEqual(ws.getWorkspaceFolders()![0], firstAddedFolder); // verify object is still live

		//
		// Add two more folders
		//

		assert.strictEqual(true, ws.updateWorkspaceFolders(extensionDescriptor, 1, 0, asUpdateWorkspaceFolderData(URI.parse('foo:bar1')), asUpdateWorkspaceFolderData(URI.parse('foo:bar2'))));
		assert.strictEqual(3, ws.workspace!.folders.length);
		assert.strictEqual(ws.workspace!.folders[0].uri.toString(), URI.parse('foo:bar').toString());
		assert.strictEqual(ws.workspace!.folders[1].uri.toString(), URI.parse('foo:bar1').toString());
		assert.strictEqual(ws.workspace!.folders[2].uri.toString(), URI.parse('foo:bar2').toString());

		const secondAddedFolder = ws.getWorkspaceFolders()![1];
		const thirdAddedFolder = ws.getWorkspaceFolders()![2];

		gotEvent = false;
		sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.deepStrictEqual(e.removed, []);
				assert.strictEqual(e.added.length, 2);
				assert.strictEqual(e.added[0].uri.toString(), 'foo:bar1');
				assert.strictEqual(e.added[1].uri.toString(), 'foo:bar2');
				assert.strictEqual(e.added[0], secondAddedFolder);
				assert.strictEqual(e.added[1], thirdAddedFolder);
				gotEvent = true;
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar'), 0), aWorkspaceFolderData(URI.parse('foo:bar1'), 1), aWorkspaceFolderData(URI.parse('foo:bar2'), 2)] }); // simulate acknowledgement from main side
		assert.strictEqual(gotEvent, true);
		sub.dispose();
		assert.strictEqual(ws.getWorkspaceFolders()![0], firstAddedFolder); // verify object is still live
		assert.strictEqual(ws.getWorkspaceFolders()![1], secondAddedFolder); // verify object is still live
		assert.strictEqual(ws.getWorkspaceFolders()![2], thirdAddedFolder); // verify object is still live

		//
		// Remove one folder
		//

		assert.strictEqual(true, ws.updateWorkspaceFolders(extensionDescriptor, 2, 1));
		assert.strictEqual(2, ws.workspace!.folders.length);
		assert.strictEqual(ws.workspace!.folders[0].uri.toString(), URI.parse('foo:bar').toString());
		assert.strictEqual(ws.workspace!.folders[1].uri.toString(), URI.parse('foo:bar1').toString());

		gotEvent = false;
		sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.deepStrictEqual(e.added, []);
				assert.strictEqual(e.removed.length, 1);
				assert.strictEqual(e.removed[0], thirdAddedFolder);
				gotEvent = true;
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar'), 0), aWorkspaceFolderData(URI.parse('foo:bar1'), 1)] }); // simulate acknowledgement from main side
		assert.strictEqual(gotEvent, true);
		sub.dispose();
		assert.strictEqual(ws.getWorkspaceFolders()![0], firstAddedFolder); // verify object is still live
		assert.strictEqual(ws.getWorkspaceFolders()![1], secondAddedFolder); // verify object is still live

		//
		// Rename folder
		//

		assert.strictEqual(true, ws.updateWorkspaceFolders(extensionDescriptor, 0, 2, asUpdateWorkspaceFolderData(URI.parse('foo:bar'), 'renamed 1'), asUpdateWorkspaceFolderData(URI.parse('foo:bar1'), 'renamed 2')));
		assert.strictEqual(2, ws.workspace!.folders.length);
		assert.strictEqual(ws.workspace!.folders[0].uri.toString(), URI.parse('foo:bar').toString());
		assert.strictEqual(ws.workspace!.folders[1].uri.toString(), URI.parse('foo:bar1').toString());
		assert.strictEqual(ws.workspace!.folders[0].name, 'renamed 1');
		assert.strictEqual(ws.workspace!.folders[1].name, 'renamed 2');
		assert.strictEqual(ws.getWorkspaceFolders()![0].name, 'renamed 1');
		assert.strictEqual(ws.getWorkspaceFolders()![1].name, 'renamed 2');

		gotEvent = false;
		sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.deepStrictEqual(e.added, []);
				assert.strictEqual(e.removed.length, 0);
				gotEvent = true;
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar'), 0, 'renamed 1'), aWorkspaceFolderData(URI.parse('foo:bar1'), 1, 'renamed 2')] }); // simulate acknowledgement from main side
		assert.strictEqual(gotEvent, true);
		sub.dispose();
		assert.strictEqual(ws.getWorkspaceFolders()![0], firstAddedFolder); // verify object is still live
		assert.strictEqual(ws.getWorkspaceFolders()![1], secondAddedFolder); // verify object is still live
		assert.strictEqual(ws.workspace!.folders[0].name, 'renamed 1');
		assert.strictEqual(ws.workspace!.folders[1].name, 'renamed 2');
		assert.strictEqual(ws.getWorkspaceFolders()![0].name, 'renamed 1');
		assert.strictEqual(ws.getWorkspaceFolders()![1].name, 'renamed 2');

		//
		// Add and remove folders
		//

		assert.strictEqual(true, ws.updateWorkspaceFolders(extensionDescriptor, 0, 2, asUpdateWorkspaceFolderData(URI.parse('foo:bar3')), asUpdateWorkspaceFolderData(URI.parse('foo:bar4'))));
		assert.strictEqual(2, ws.workspace!.folders.length);
		assert.strictEqual(ws.workspace!.folders[0].uri.toString(), URI.parse('foo:bar3').toString());
		assert.strictEqual(ws.workspace!.folders[1].uri.toString(), URI.parse('foo:bar4').toString());

		const fourthAddedFolder = ws.getWorkspaceFolders()![0];
		const fifthAddedFolder = ws.getWorkspaceFolders()![1];

		gotEvent = false;
		sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.strictEqual(e.added.length, 2);
				assert.strictEqual(e.added[0], fourthAddedFolder);
				assert.strictEqual(e.added[1], fifthAddedFolder);
				assert.strictEqual(e.removed.length, 2);
				assert.strictEqual(e.removed[0], firstAddedFolder);
				assert.strictEqual(e.removed[1], secondAddedFolder);
				gotEvent = true;
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar3'), 0), aWorkspaceFolderData(URI.parse('foo:bar4'), 1)] }); // simulate acknowledgement from main side
		assert.strictEqual(gotEvent, true);
		sub.dispose();
		assert.strictEqual(ws.getWorkspaceFolders()![0], fourthAddedFolder); // verify object is still live
		assert.strictEqual(ws.getWorkspaceFolders()![1], fifthAddedFolder); // verify object is still live

		//
		// Swap folders
		//

		assert.strictEqual(true, ws.updateWorkspaceFolders(extensionDescriptor, 0, 2, asUpdateWorkspaceFolderData(URI.parse('foo:bar4')), asUpdateWorkspaceFolderData(URI.parse('foo:bar3'))));
		assert.strictEqual(2, ws.workspace!.folders.length);
		assert.strictEqual(ws.workspace!.folders[0].uri.toString(), URI.parse('foo:bar4').toString());
		assert.strictEqual(ws.workspace!.folders[1].uri.toString(), URI.parse('foo:bar3').toString());

		assert.strictEqual(ws.getWorkspaceFolders()![0], fifthAddedFolder); // verify object is still live
		assert.strictEqual(ws.getWorkspaceFolders()![1], fourthAddedFolder); // verify object is still live

		gotEvent = false;
		sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.strictEqual(e.added.length, 0);
				assert.strictEqual(e.removed.length, 0);
				gotEvent = true;
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [aWorkspaceFolderData(URI.parse('foo:bar4'), 0), aWorkspaceFolderData(URI.parse('foo:bar3'), 1)] }); // simulate acknowledgement from main side
		assert.strictEqual(gotEvent, true);
		sub.dispose();
		assert.strictEqual(ws.getWorkspaceFolders()![0], fifthAddedFolder); // verify object is still live
		assert.strictEqual(ws.getWorkspaceFolders()![1], fourthAddedFolder); // verify object is still live
		assert.strictEqual(fifthAddedFolder.index, 0);
		assert.strictEqual(fourthAddedFolder.index, 1);

		//
		// Add one folder after the other without waiting for confirmation (not supported currently)
		//

		assert.strictEqual(true, ws.updateWorkspaceFolders(extensionDescriptor, 2, 0, asUpdateWorkspaceFolderData(URI.parse('foo:bar5'))));

		assert.strictEqual(3, ws.workspace!.folders.length);
		assert.strictEqual(ws.workspace!.folders[0].uri.toString(), URI.parse('foo:bar4').toString());
		assert.strictEqual(ws.workspace!.folders[1].uri.toString(), URI.parse('foo:bar3').toString());
		assert.strictEqual(ws.workspace!.folders[2].uri.toString(), URI.parse('foo:bar5').toString());

		const sixthAddedFolder = ws.getWorkspaceFolders()![2];

		gotEvent = false;
		sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.strictEqual(e.added.length, 1);
				assert.strictEqual(e.added[0], sixthAddedFolder);
				gotEvent = true;
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({
			id: 'foo', name: 'Test', folders: [
				aWorkspaceFolderData(URI.parse('foo:bar4'), 0),
				aWorkspaceFolderData(URI.parse('foo:bar3'), 1),
				aWorkspaceFolderData(URI.parse('foo:bar5'), 2)
			]
		}); // simulate acknowledgement from main side
		assert.strictEqual(gotEvent, true);
		sub.dispose();

		assert.strictEqual(ws.getWorkspaceFolders()![0], fifthAddedFolder); // verify object is still live
		assert.strictEqual(ws.getWorkspaceFolders()![1], fourthAddedFolder); // verify object is still live
		assert.strictEqual(ws.getWorkspaceFolders()![2], sixthAddedFolder); // verify object is still live

		finish();
	});

	test('Multiroot change event is immutable', function (done) {
		let finished = false;
		const finish = (error?: any) => {
			if (!finished) {
				finished = true;
				done(error);
			}
		};

		let ws = createExtHostWorkspace(new TestRPCProtocol(), { id: 'foo', name: 'Test', folders: [] }, new NullLogService());
		let sub = ws.onDidChangeWorkspace(e => {
			try {
				assert.throws(() => {
					(<any>e).added = [];
				});
				// assert.throws(() => {
				// 	(<any>e.added)[0] = null;
				// });
			} catch (error) {
				finish(error);
			}
		});
		ws.$acceptWorkspaceData({ id: 'foo', name: 'Test', folders: [] });
		sub.dispose();
		finish();
	});

	test('`vscode.workspace.getWorkspaceFolder(file)` don\'t return workspace folder when file open from command line. #36221', function () {
		if (isWindows) {

			let ws = createExtHostWorkspace(new TestRPCProtocol(), {
				id: 'foo', name: 'Test', folders: [
					aWorkspaceFolderData(URI.file('c:/Users/marek/Desktop/vsc_test/'), 0)
				]
			}, new NullLogService());

			assert.ok(ws.getWorkspaceFolder(URI.file('c:/Users/marek/Desktop/vsc_test/a.txt')));
			assert.ok(ws.getWorkspaceFolder(URI.file('C:/Users/marek/Desktop/vsc_test/b.txt')));
		}
	});

	function aWorkspaceFolderData(uri: URI, index: number, name: string = ''): IWorkspaceFolderData {
		return {
			uri,
			index,
			name: name || basename(uri.path)
		};
	}

	function asUpdateWorkspaceFolderData(uri: URI, name?: string): { uri: URI, name?: string } {
		return { uri, name };
	}

	test('findFiles - string include', () => {
		const root = '/project/foo';
		const rpcProtocol = new TestRPCProtocol();

		let mainThreadCalled = false;
		rpcProtocol.set(MainContext.MainThreadWorkspace, new class extends mock<MainThreadWorkspace>() {
			override $startFileSearch(includePattern: string, _includeFolder: UriComponents | null, excludePatternOrDisregardExcludes: string | false, maxResults: number, token: CancellationToken): Promise<URI[] | null> {
				mainThreadCalled = true;
				assert.strictEqual(includePattern, 'foo');
				assert.strictEqual(_includeFolder, null);
				assert.strictEqual(excludePatternOrDisregardExcludes, null);
				assert.strictEqual(maxResults, 10);
				return Promise.resolve(null);
			}
		});

		const ws = createExtHostWorkspace(rpcProtocol, { id: 'foo', folders: [aWorkspaceFolderData(URI.file(root), 0)], name: 'Test' }, new NullLogService());
		return ws.findFiles('foo', undefined, 10, new ExtensionIdentifier('test')).then(() => {
			assert(mainThreadCalled, 'mainThreadCalled');
		});
	});

	function testFindFilesInclude(pattern: RelativePattern) {
		const root = '/project/foo';
		const rpcProtocol = new TestRPCProtocol();

		let mainThreadCalled = false;
		rpcProtocol.set(MainContext.MainThreadWorkspace, new class extends mock<MainThreadWorkspace>() {
			override $startFileSearch(includePattern: string, _includeFolder: UriComponents | null, excludePatternOrDisregardExcludes: string | false, maxResults: number, token: CancellationToken): Promise<URI[] | null> {
				mainThreadCalled = true;
				assert.strictEqual(includePattern, 'glob/**');
				assert.deepStrictEqual(_includeFolder ? URI.from(_includeFolder).toJSON() : null, URI.file('/other/folder').toJSON());
				assert.strictEqual(excludePatternOrDisregardExcludes, null);
				return Promise.resolve(null);
			}
		});

		const ws = createExtHostWorkspace(rpcProtocol, { id: 'foo', folders: [aWorkspaceFolderData(URI.file(root), 0)], name: 'Test' }, new NullLogService());
		return ws.findFiles(pattern, undefined, 10, new ExtensionIdentifier('test')).then(() => {
			assert(mainThreadCalled, 'mainThreadCalled');
		});
	}

	test('findFiles - RelativePattern include (string)', () => {
		return testFindFilesInclude(new RelativePattern('/other/folder', 'glob/**'));
	});

	test('findFiles - RelativePattern include (URI)', () => {
		return testFindFilesInclude(new RelativePattern(URI.file('/other/folder'), 'glob/**'));
	});

	test('findFiles - no excludes', () => {
		const root = '/project/foo';
		const rpcProtocol = new TestRPCProtocol();

		let mainThreadCalled = false;
		rpcProtocol.set(MainContext.MainThreadWorkspace, new class extends mock<MainThreadWorkspace>() {
			override $startFileSearch(includePattern: string, _includeFolder: UriComponents | null, excludePatternOrDisregardExcludes: string | false, maxResults: number, token: CancellationToken): Promise<URI[] | null> {
				mainThreadCalled = true;
				assert.strictEqual(includePattern, 'glob/**');
				assert.deepStrictEqual(_includeFolder, URI.file('/other/folder').toJSON());
				assert.strictEqual(excludePatternOrDisregardExcludes, false);
				return Promise.resolve(null);
			}
		});

		const ws = createExtHostWorkspace(rpcProtocol, { id: 'foo', folders: [aWorkspaceFolderData(URI.file(root), 0)], name: 'Test' }, new NullLogService());
		return ws.findFiles(new RelativePattern('/other/folder', 'glob/**'), null!, 10, new ExtensionIdentifier('test')).then(() => {
			assert(mainThreadCalled, 'mainThreadCalled');
		});
	});

	test('findFiles - with cancelled token', () => {
		const root = '/project/foo';
		const rpcProtocol = new TestRPCProtocol();

		let mainThreadCalled = false;
		rpcProtocol.set(MainContext.MainThreadWorkspace, new class extends mock<MainThreadWorkspace>() {
			override $startFileSearch(includePattern: string, _includeFolder: UriComponents | null, excludePatternOrDisregardExcludes: string | false, maxResults: number, token: CancellationToken): Promise<URI[] | null> {
				mainThreadCalled = true;
				return Promise.resolve(null);
			}
		});

		const ws = createExtHostWorkspace(rpcProtocol, { id: 'foo', folders: [aWorkspaceFolderData(URI.file(root), 0)], name: 'Test' }, new NullLogService());

		const token = CancellationToken.Cancelled;
		return ws.findFiles(new RelativePattern('/other/folder', 'glob/**'), null!, 10, new ExtensionIdentifier('test'), token).then(() => {
			assert(!mainThreadCalled, '!mainThreadCalled');
		});
	});

	test('findFiles - RelativePattern exclude', () => {
		const root = '/project/foo';
		const rpcProtocol = new TestRPCProtocol();

		let mainThreadCalled = false;
		rpcProtocol.set(MainContext.MainThreadWorkspace, new class extends mock<MainThreadWorkspace>() {
			override $startFileSearch(includePattern: string, _includeFolder: UriComponents | null, excludePatternOrDisregardExcludes: string | false, maxResults: number, token: CancellationToken): Promise<URI[] | null> {
				mainThreadCalled = true;
				assert(excludePatternOrDisregardExcludes, 'glob/**'); // Note that the base portion is ignored, see #52651
				return Promise.resolve(null);
			}
		});

		const ws = createExtHostWorkspace(rpcProtocol, { id: 'foo', folders: [aWorkspaceFolderData(URI.file(root), 0)], name: 'Test' }, new NullLogService());
		return ws.findFiles('', new RelativePattern(root, 'glob/**'), 10, new ExtensionIdentifier('test')).then(() => {
			assert(mainThreadCalled, 'mainThreadCalled');
		});
	});

	test('findTextInFiles - no include', async () => {
		const root = '/project/foo';
		const rpcProtocol = new TestRPCProtocol();

		let mainThreadCalled = false;
		rpcProtocol.set(MainContext.MainThreadWorkspace, new class extends mock<MainThreadWorkspace>() {
			override async $startTextSearch(query: IPatternInfo, folder: UriComponents | null, options: ITextQueryBuilderOptions, requestId: number, token: CancellationToken): Promise<ITextSearchComplete | null> {
				mainThreadCalled = true;
				assert.strictEqual(query.pattern, 'foo');
				assert.strictEqual(folder, null);
				assert.strictEqual(options.includePattern, undefined);
				assert.strictEqual(options.excludePattern, undefined);
				return null;
			}
		});

		const ws = createExtHostWorkspace(rpcProtocol, { id: 'foo', folders: [aWorkspaceFolderData(URI.file(root), 0)], name: 'Test' }, new NullLogService());
		await ws.findTextInFiles({ pattern: 'foo' }, {}, () => { }, new ExtensionIdentifier('test'));
		assert(mainThreadCalled, 'mainThreadCalled');
	});

	test('findTextInFiles - string include', async () => {
		const root = '/project/foo';
		const rpcProtocol = new TestRPCProtocol();

		let mainThreadCalled = false;
		rpcProtocol.set(MainContext.MainThreadWorkspace, new class extends mock<MainThreadWorkspace>() {
			override async $startTextSearch(query: IPatternInfo, folder: UriComponents | null, options: ITextQueryBuilderOptions, requestId: number, token: CancellationToken): Promise<ITextSearchComplete | null> {
				mainThreadCalled = true;
				assert.strictEqual(query.pattern, 'foo');
				assert.strictEqual(folder, null);
				assert.strictEqual(options.includePattern, '**/files');
				assert.strictEqual(options.excludePattern, undefined);
				return null;
			}
		});

		const ws = createExtHostWorkspace(rpcProtocol, { id: 'foo', folders: [aWorkspaceFolderData(URI.file(root), 0)], name: 'Test' }, new NullLogService());
		await ws.findTextInFiles({ pattern: 'foo' }, { include: '**/files' }, () => { }, new ExtensionIdentifier('test'));
		assert(mainThreadCalled, 'mainThreadCalled');
	});

	test('findTextInFiles - RelativePattern include', async () => {
		const root = '/project/foo';
		const rpcProtocol = new TestRPCProtocol();

		let mainThreadCalled = false;
		rpcProtocol.set(MainContext.MainThreadWorkspace, new class extends mock<MainThreadWorkspace>() {
			override async $startTextSearch(query: IPatternInfo, folder: UriComponents | null, options: ITextQueryBuilderOptions, requestId: number, token: CancellationToken): Promise<ITextSearchComplete | null> {
				mainThreadCalled = true;
				assert.strictEqual(query.pattern, 'foo');
				assert.deepStrictEqual(folder, URI.file('/other/folder').toJSON());
				assert.strictEqual(options.includePattern, 'glob/**');
				assert.strictEqual(options.excludePattern, undefined);
				return null;
			}
		});

		const ws = createExtHostWorkspace(rpcProtocol, { id: 'foo', folders: [aWorkspaceFolderData(URI.file(root), 0)], name: 'Test' }, new NullLogService());
		await ws.findTextInFiles({ pattern: 'foo' }, { include: new RelativePattern('/other/folder', 'glob/**') }, () => { }, new ExtensionIdentifier('test'));
		assert(mainThreadCalled, 'mainThreadCalled');
	});

	test('findTextInFiles - with cancelled token', async () => {
		const root = '/project/foo';
		const rpcProtocol = new TestRPCProtocol();

		let mainThreadCalled = false;
		rpcProtocol.set(MainContext.MainThreadWorkspace, new class extends mock<MainThreadWorkspace>() {
			override async $startTextSearch(query: IPatternInfo, folder: UriComponents | null, options: ITextQueryBuilderOptions, requestId: number, token: CancellationToken): Promise<ITextSearchComplete | null> {
				mainThreadCalled = true;
				return null;
			}
		});

		const ws = createExtHostWorkspace(rpcProtocol, { id: 'foo', folders: [aWorkspaceFolderData(URI.file(root), 0)], name: 'Test' }, new NullLogService());
		const token = CancellationToken.Cancelled;
		await ws.findTextInFiles({ pattern: 'foo' }, {}, () => { }, new ExtensionIdentifier('test'), token);
		assert(!mainThreadCalled, '!mainThreadCalled');
	});

	test('findTextInFiles - RelativePattern exclude', async () => {
		const root = '/project/foo';
		const rpcProtocol = new TestRPCProtocol();

		let mainThreadCalled = false;
		rpcProtocol.set(MainContext.MainThreadWorkspace, new class extends mock<MainThreadWorkspace>() {
			override async $startTextSearch(query: IPatternInfo, folder: UriComponents | null, options: ITextQueryBuilderOptions, requestId: number, token: CancellationToken): Promise<ITextSearchComplete | null> {
				mainThreadCalled = true;
				assert.strictEqual(query.pattern, 'foo');
				assert.deepStrictEqual(folder, null);
				assert.strictEqual(options.includePattern, undefined);
				assert.strictEqual(options.excludePattern, 'glob/**'); // exclude folder is ignored...
				return null;
			}
		});

		const ws = createExtHostWorkspace(rpcProtocol, { id: 'foo', folders: [aWorkspaceFolderData(URI.file(root), 0)], name: 'Test' }, new NullLogService());
		await ws.findTextInFiles({ pattern: 'foo' }, { exclude: new RelativePattern('/other/folder', 'glob/**') }, () => { }, new ExtensionIdentifier('test'));
		assert(mainThreadCalled, 'mainThreadCalled');
	});
});
