/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as platform from 'vs/base/common/platform';
import * as os from 'os';
import * as path from 'vs/base/common/path';
import * as pfs from 'vs/base/node/pfs';
import { URI } from 'vs/base/common/uri';
import { getRandomTestPath } from 'vs/base/test/node/testUtils';
import { hashPath } from 'vs/workbench/services/backup/electron-browser/backupFileService';
import { NativeBackupTracker } from 'vs/workbench/contrib/backup/electron-sandbox/backupTracker';
import { TextFileEditorModelManager } from 'vs/workbench/services/textfile/common/textFileEditorModelManager';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { EditorPart } from 'vs/workbench/browser/parts/editor/editorPart';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { EditorService } from 'vs/workbench/services/editor/browser/editorService';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorInput, IUntitledTextResourceEditorInput } from 'vs/workbench/common/editor';
import { FileEditorInput } from 'vs/workbench/contrib/files/common/editors/fileEditorInput';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IEditorRegistry, EditorDescriptor, Extensions as EditorExtensions } from 'vs/workbench/browser/editor';
import { TextFileEditor } from 'vs/workbench/contrib/files/browser/editors/textFileEditor';
import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { NodeTestBackupFileService } from 'vs/workbench/services/backup/test/electron-browser/backupFileService.test';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';
import { toResource } from 'vs/base/test/common/utils';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { IWorkingCopyBackup, IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { ILogService } from 'vs/platform/log/common/log';
import { HotExitConfiguration } from 'vs/platform/files/common/files';
import { ShutdownReason, ILifecycleService, BeforeShutdownEvent } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IFileDialogService, ConfirmResult, IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { BackupTracker } from 'vs/workbench/contrib/backup/common/backupTracker';
import { workbenchInstantiationService, TestServiceAccessor } from 'vs/workbench/test/electron-browser/workbenchTestServices';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestFilesConfigurationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { MockContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { TestWorkingCopy } from 'vs/workbench/test/common/workbenchTestServices';
import { CancellationToken } from 'vs/base/common/cancellation';
import { timeout } from 'vs/base/common/async';
import { Workspace } from 'vs/platform/workspace/test/common/testWorkspace';

const userdataDir = getRandomTestPath(os.tmpdir(), 'vsctests', 'backuprestorer');
const backupHome = path.join(userdataDir, 'Backups');
const workspacesJsonPath = path.join(backupHome, 'workspaces.json');

const workspaceResource = URI.file(platform.isWindows ? 'c:\\workspace' : '/workspace');
const workspaceBackupPath = path.join(backupHome, hashPath(workspaceResource));

class TestBackupTracker extends NativeBackupTracker {

	constructor(
		@IBackupFileService backupFileService: IBackupFileService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IFileDialogService fileDialogService: IFileDialogService,
		@IDialogService dialogService: IDialogService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@INativeHostService nativeHostService: INativeHostService,
		@ILogService logService: ILogService,
		@IEditorService editorService: IEditorService,
		@IEnvironmentService environmentService: IEnvironmentService
	) {
		super(backupFileService, filesConfigurationService, workingCopyService, lifecycleService, fileDialogService, dialogService, contextService, nativeHostService, logService, editorService, environmentService);
	}

	protected getBackupScheduleDelay(): number {
		return 10; // Reduce timeout for tests
	}
}

class BeforeShutdownEventImpl implements BeforeShutdownEvent {

	value: boolean | Promise<boolean> | undefined;
	reason = ShutdownReason.CLOSE;

	veto(value: boolean | Promise<boolean>): void {
		this.value = value;
	}
}

suite('BackupTracker', () => {
	let accessor: TestServiceAccessor;
	let disposables: IDisposable[] = [];

	setup(async () => {
		const instantiationService = workbenchInstantiationService();
		accessor = instantiationService.createInstance(TestServiceAccessor);

		disposables.push(Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
			EditorDescriptor.create(
				TextFileEditor,
				TextFileEditor.ID,
				'Text File Editor'
			),
			[new SyncDescriptor<EditorInput>(FileEditorInput)]
		));

		// Delete any existing backups completely and then re-create it.
		await pfs.rimraf(backupHome, pfs.RimRafMode.MOVE);
		await pfs.mkdirp(backupHome);
		await pfs.mkdirp(workspaceBackupPath);

		return pfs.writeFile(workspacesJsonPath, '');
	});

	teardown(async () => {
		dispose(disposables);
		disposables = [];

		(<TextFileEditorModelManager>accessor.textFileService.files).dispose();

		return pfs.rimraf(backupHome, pfs.RimRafMode.MOVE);
	});

	async function createTracker(autoSaveEnabled = false): Promise<[TestServiceAccessor, EditorPart, BackupTracker, IInstantiationService]> {
		const backupFileService = new NodeTestBackupFileService(workspaceBackupPath);
		const instantiationService = workbenchInstantiationService();
		instantiationService.stub(IBackupFileService, backupFileService);

		const configurationService = new TestConfigurationService();
		if (autoSaveEnabled) {
			configurationService.setUserConfiguration('files', { autoSave: 'afterDelay', autoSaveDelay: 1 });
		}
		instantiationService.stub(IConfigurationService, configurationService);

		instantiationService.stub(IFilesConfigurationService, new TestFilesConfigurationService(
			<IContextKeyService>instantiationService.createInstance(MockContextKeyService),
			configurationService
		));

		const part = instantiationService.createInstance(EditorPart);
		part.create(document.createElement('div'));
		part.layout(400, 300);

		instantiationService.stub(IEditorGroupsService, part);

		const editorService: EditorService = instantiationService.createInstance(EditorService);
		instantiationService.stub(IEditorService, editorService);

		accessor = instantiationService.createInstance(TestServiceAccessor);

		await part.whenRestored;

		const tracker = instantiationService.createInstance(TestBackupTracker);

		return [accessor, part, tracker, instantiationService];
	}

	async function untitledBackupTest(untitled: IUntitledTextResourceEditorInput = {}): Promise<void> {
		const [accessor, part, tracker] = await createTracker();

		const untitledEditor = (await accessor.editorService.openEditor(untitled))?.input as UntitledTextEditorInput;

		const untitledModel = await untitledEditor.resolve();

		if (!untitled?.contents) {
			untitledModel.textEditorModel.setValue('Super Good');
		}

		await accessor.backupFileService.joinBackupResource();

		assert.equal(accessor.backupFileService.hasBackupSync(untitledEditor.resource), true);

		untitledModel.dispose();

		await accessor.backupFileService.joinDiscardBackup();

		assert.equal(accessor.backupFileService.hasBackupSync(untitledEditor.resource), false);

		part.dispose();
		tracker.dispose();
	}

	test('Track backups (untitled)', function () {
		this.timeout(20000);

		return untitledBackupTest();
	});

	test('Track backups (untitled with initial contents)', function () {
		this.timeout(20000);

		return untitledBackupTest({ contents: 'Foo Bar' });
	});

	test('Track backups (file)', async function () {
		this.timeout(20000);

		const [accessor, part, tracker] = await createTracker();

		const resource = toResource.call(this, '/path/index.txt');
		await accessor.editorService.openEditor({ resource, options: { pinned: true } });

		const fileModel = accessor.textFileService.files.get(resource);
		fileModel?.textEditorModel?.setValue('Super Good');

		await accessor.backupFileService.joinBackupResource();

		assert.equal(accessor.backupFileService.hasBackupSync(resource), true);

		fileModel?.dispose();

		await accessor.backupFileService.joinDiscardBackup();

		assert.equal(accessor.backupFileService.hasBackupSync(resource), false);

		part.dispose();
		tracker.dispose();
	});

	test('Track backups (custom)', async function () {
		const [accessor, part, tracker] = await createTracker();

		class TestBackupWorkingCopy extends TestWorkingCopy {

			backupDelay = 0;

			constructor(resource: URI) {
				super(resource);

				accessor.workingCopyService.registerWorkingCopy(this);
			}

			async backup(token: CancellationToken): Promise<IWorkingCopyBackup> {
				await timeout(this.backupDelay);

				return {};
			}
		}

		const resource = toResource.call(this, '/path/custom.txt');
		const customWorkingCopy = new TestBackupWorkingCopy(resource);

		// Normal
		customWorkingCopy.setDirty(true);
		await accessor.backupFileService.joinBackupResource();
		assert.equal(accessor.backupFileService.hasBackupSync(resource), true);

		customWorkingCopy.setDirty(false);
		customWorkingCopy.setDirty(true);
		await accessor.backupFileService.joinBackupResource();
		assert.equal(accessor.backupFileService.hasBackupSync(resource), true);

		customWorkingCopy.setDirty(false);
		await accessor.backupFileService.joinDiscardBackup();
		assert.equal(accessor.backupFileService.hasBackupSync(resource), false);

		// Cancellation
		customWorkingCopy.setDirty(true);
		await timeout(0);
		customWorkingCopy.setDirty(false);
		await accessor.backupFileService.joinDiscardBackup();
		assert.equal(accessor.backupFileService.hasBackupSync(resource), false);

		customWorkingCopy.dispose();
		part.dispose();
		tracker.dispose();
	});

	test('onWillShutdown - no veto if no dirty files', async function () {
		const [accessor, part, tracker] = await createTracker();

		const resource = toResource.call(this, '/path/index.txt');
		await accessor.editorService.openEditor({ resource, options: { pinned: true } });

		const event = new BeforeShutdownEventImpl();
		accessor.lifecycleService.fireWillShutdown(event);

		const veto = await event.value;
		assert.ok(!veto);

		part.dispose();
		tracker.dispose();
	});

	test('onWillShutdown - veto if user cancels (hot.exit: off)', async function () {
		const [accessor, part, tracker] = await createTracker();

		const resource = toResource.call(this, '/path/index.txt');
		await accessor.editorService.openEditor({ resource, options: { pinned: true } });

		const model = accessor.textFileService.files.get(resource);

		accessor.fileDialogService.setConfirmResult(ConfirmResult.CANCEL);
		accessor.filesConfigurationService.onFilesConfigurationChange({ files: { hotExit: 'off' } });

		await model?.load();
		model?.textEditorModel?.setValue('foo');
		assert.equal(accessor.workingCopyService.dirtyCount, 1);

		const event = new BeforeShutdownEventImpl();
		accessor.lifecycleService.fireWillShutdown(event);

		const veto = await event.value;
		assert.ok(veto);

		part.dispose();
		tracker.dispose();
	});

	test('onWillShutdown - no veto if auto save is on', async function () {
		const [accessor, part, tracker] = await createTracker(true /* auto save enabled */);

		const resource = toResource.call(this, '/path/index.txt');
		await accessor.editorService.openEditor({ resource, options: { pinned: true } });

		const model = accessor.textFileService.files.get(resource);

		await model?.load();
		model?.textEditorModel?.setValue('foo');
		assert.equal(accessor.workingCopyService.dirtyCount, 1);

		const event = new BeforeShutdownEventImpl();
		accessor.lifecycleService.fireWillShutdown(event);

		const veto = await event.value;
		assert.ok(!veto);

		assert.equal(accessor.workingCopyService.dirtyCount, 0);

		part.dispose();
		tracker.dispose();
	});

	test('onWillShutdown - no veto and backups cleaned up if user does not want to save (hot.exit: off)', async function () {
		const [accessor, part, tracker] = await createTracker();

		const resource = toResource.call(this, '/path/index.txt');
		await accessor.editorService.openEditor({ resource, options: { pinned: true } });

		const model = accessor.textFileService.files.get(resource);

		accessor.fileDialogService.setConfirmResult(ConfirmResult.DONT_SAVE);
		accessor.filesConfigurationService.onFilesConfigurationChange({ files: { hotExit: 'off' } });

		await model?.load();
		model?.textEditorModel?.setValue('foo');
		assert.equal(accessor.workingCopyService.dirtyCount, 1);
		const event = new BeforeShutdownEventImpl();
		accessor.lifecycleService.fireWillShutdown(event);

		const veto = await event.value;
		assert.ok(!veto);
		assert.ok(accessor.backupFileService.discardedBackups.length > 0);

		part.dispose();
		tracker.dispose();
	});

	test('onWillShutdown - save (hot.exit: off)', async function () {
		const [accessor, part, tracker] = await createTracker();

		const resource = toResource.call(this, '/path/index.txt');
		await accessor.editorService.openEditor({ resource, options: { pinned: true } });

		const model = accessor.textFileService.files.get(resource);

		accessor.fileDialogService.setConfirmResult(ConfirmResult.SAVE);
		accessor.filesConfigurationService.onFilesConfigurationChange({ files: { hotExit: 'off' } });

		await model?.load();
		model?.textEditorModel?.setValue('foo');
		assert.equal(accessor.workingCopyService.dirtyCount, 1);
		const event = new BeforeShutdownEventImpl();
		accessor.lifecycleService.fireWillShutdown(event);

		const veto = await event.value;
		assert.ok(!veto);
		assert.ok(!model?.isDirty());

		part.dispose();
		tracker.dispose();
	});

	suite('Hot Exit', () => {
		suite('"onExit" setting', () => {
			test('should hot exit on non-Mac (reason: CLOSE, windows: single, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.CLOSE, false, true, !!platform.isMacintosh);
			});
			test('should hot exit on non-Mac (reason: CLOSE, windows: single, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.CLOSE, false, false, !!platform.isMacintosh);
			});
			test('should NOT hot exit (reason: CLOSE, windows: multiple, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.CLOSE, true, true, true);
			});
			test('should NOT hot exit (reason: CLOSE, windows: multiple, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.CLOSE, true, false, true);
			});
			test('should hot exit (reason: QUIT, windows: single, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.QUIT, false, true, false);
			});
			test('should hot exit (reason: QUIT, windows: single, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.QUIT, false, false, false);
			});
			test('should hot exit (reason: QUIT, windows: multiple, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.QUIT, true, true, false);
			});
			test('should hot exit (reason: QUIT, windows: multiple, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.QUIT, true, false, false);
			});
			test('should hot exit (reason: RELOAD, windows: single, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.RELOAD, false, true, false);
			});
			test('should hot exit (reason: RELOAD, windows: single, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.RELOAD, false, false, false);
			});
			test('should hot exit (reason: RELOAD, windows: multiple, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.RELOAD, true, true, false);
			});
			test('should hot exit (reason: RELOAD, windows: multiple, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.RELOAD, true, false, false);
			});
			test('should NOT hot exit (reason: LOAD, windows: single, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.LOAD, false, true, true);
			});
			test('should NOT hot exit (reason: LOAD, windows: single, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.LOAD, false, false, true);
			});
			test('should NOT hot exit (reason: LOAD, windows: multiple, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.LOAD, true, true, true);
			});
			test('should NOT hot exit (reason: LOAD, windows: multiple, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT, ShutdownReason.LOAD, true, false, true);
			});
		});

		suite('"onExitAndWindowClose" setting', () => {
			test('should hot exit (reason: CLOSE, windows: single, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.CLOSE, false, true, false);
			});
			test('should hot exit (reason: CLOSE, windows: single, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.CLOSE, false, false, !!platform.isMacintosh);
			});
			test('should hot exit (reason: CLOSE, windows: multiple, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.CLOSE, true, true, false);
			});
			test('should NOT hot exit (reason: CLOSE, windows: multiple, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.CLOSE, true, false, true);
			});
			test('should hot exit (reason: QUIT, windows: single, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.QUIT, false, true, false);
			});
			test('should hot exit (reason: QUIT, windows: single, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.QUIT, false, false, false);
			});
			test('should hot exit (reason: QUIT, windows: multiple, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.QUIT, true, true, false);
			});
			test('should hot exit (reason: QUIT, windows: multiple, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.QUIT, true, false, false);
			});
			test('should hot exit (reason: RELOAD, windows: single, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.RELOAD, false, true, false);
			});
			test('should hot exit (reason: RELOAD, windows: single, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.RELOAD, false, false, false);
			});
			test('should hot exit (reason: RELOAD, windows: multiple, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.RELOAD, true, true, false);
			});
			test('should hot exit (reason: RELOAD, windows: multiple, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.RELOAD, true, false, false);
			});
			test('should hot exit (reason: LOAD, windows: single, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.LOAD, false, true, false);
			});
			test('should NOT hot exit (reason: LOAD, windows: single, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.LOAD, false, false, true);
			});
			test('should hot exit (reason: LOAD, windows: multiple, workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.LOAD, true, true, false);
			});
			test('should NOT hot exit (reason: LOAD, windows: multiple, empty workspace)', function () {
				return hotExitTest.call(this, HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE, ShutdownReason.LOAD, true, false, true);
			});
		});

		async function hotExitTest(this: any, setting: string, shutdownReason: ShutdownReason, multipleWindows: boolean, workspace: boolean, shouldVeto: boolean): Promise<void> {
			const [accessor, part, tracker] = await createTracker();

			const resource = toResource.call(this, '/path/index.txt');
			await accessor.editorService.openEditor({ resource, options: { pinned: true } });

			const model = accessor.textFileService.files.get(resource);

			// Set hot exit config
			accessor.filesConfigurationService.onFilesConfigurationChange({ files: { hotExit: setting } });

			// Set empty workspace if required
			if (!workspace) {
				accessor.contextService.setWorkspace(new Workspace('empty:1508317022751'));
			}

			// Set multiple windows if required
			if (multipleWindows) {
				accessor.nativeHostService.windowCount = Promise.resolve(2);
			}

			// Set cancel to force a veto if hot exit does not trigger
			accessor.fileDialogService.setConfirmResult(ConfirmResult.CANCEL);

			await model?.load();
			model?.textEditorModel?.setValue('foo');
			assert.equal(accessor.workingCopyService.dirtyCount, 1);

			const event = new BeforeShutdownEventImpl();
			event.reason = shutdownReason;
			accessor.lifecycleService.fireWillShutdown(event);

			const veto = await event.value;
			assert.equal(accessor.backupFileService.discardedBackups.length, 0); // When hot exit is set, backups should never be cleaned since the confirm result is cancel
			assert.equal(veto, shouldVeto);

			part.dispose();
			tracker.dispose();
		}
	});
});
