/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'vs/base/common/path';
import * as json from 'vs/base/common/json';
import { ChordKeybinding, KeyCode, SimpleKeybinding } from 'vs/base/common/keyCodes';
import { OS } from 'vs/base/common/platform';
import * as uuid from 'vs/base/common/uuid';
import { mkdirp, rimraf, RimRafMode } from 'vs/base/node/pfs';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ModeServiceImpl } from 'vs/editor/common/services/modeServiceImpl';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ModelServiceImpl } from 'vs/editor/common/services/modelServiceImpl';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { ITextResourcePropertiesService } from 'vs/editor/common/services/textResourceConfigurationService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpr, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IFileService } from 'vs/platform/files/common/files';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { IUserFriendlyKeybinding } from 'vs/platform/keybinding/common/keybinding';
import { ResolvedKeybindingItem } from 'vs/platform/keybinding/common/resolvedKeybindingItem';
import { USLayoutResolvedKeybinding } from 'vs/platform/keybinding/common/usLayoutResolvedKeybinding';
import { MockContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';
import { ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { ILogService, NullLogService } from 'vs/platform/log/common/log';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { KeybindingsEditingService } from 'vs/workbench/services/keybinding/common/keybindingEditing';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { TextModelResolverService } from 'vs/workbench/services/textmodelResolver/common/textModelResolverService';
import { TestBackupFileService, TestEditorGroupsService, TestEditorService, TestLifecycleService, TestPathService, TestProductService } from 'vs/workbench/test/browser/workbenchTestServices';
import { FileService } from 'vs/platform/files/common/fileService';
import { Schemas } from 'vs/base/common/network';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { URI } from 'vs/base/common/uri';
import { FileUserDataProvider } from 'vs/workbench/services/userData/common/fileUserDataProvider';
import { NativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-browser/environmentService';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { TestWorkbenchConfiguration, TestTextFileService } from 'vs/workbench/test/electron-browser/workbenchTestServices';
import { ILabelService } from 'vs/platform/label/common/label';
import { LabelService } from 'vs/workbench/services/label/common/labelService';
import { IFilesConfigurationService, FilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { WorkingCopyFileService, IWorkingCopyFileService } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { UndoRedoService } from 'vs/platform/undoRedo/common/undoRedoService';
import { TestTextResourcePropertiesService, TestContextService, TestWorkingCopyService } from 'vs/workbench/test/common/workbenchTestServices';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { UriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentityService';

class TestWorkbenchEnvironmentService extends NativeWorkbenchEnvironmentService {

	constructor(private _appSettingsHome: URI) {
		super(TestWorkbenchConfiguration, TestProductService);
	}

	get appSettingsHome() { return this._appSettingsHome; }
}

interface Modifiers {
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
}

suite('KeybindingsEditing', () => {

	let instantiationService: TestInstantiationService;
	let testObject: KeybindingsEditingService;
	let testDir: string;
	let keybindingsFile: string;

	setup(() => {
		return setUpWorkspace().then(() => {
			keybindingsFile = path.join(testDir, 'keybindings.json');

			instantiationService = new TestInstantiationService();

			const environmentService = new TestWorkbenchEnvironmentService(URI.file(testDir));

			const configService = new TestConfigurationService();
			configService.setUserConfiguration('files', { 'eol': '\n' });

			instantiationService.stub(IEnvironmentService, environmentService);
			instantiationService.stub(IPathService, new TestPathService());
			instantiationService.stub(IConfigurationService, configService);
			instantiationService.stub(IWorkspaceContextService, new TestContextService());
			const lifecycleService = new TestLifecycleService();
			instantiationService.stub(ILifecycleService, lifecycleService);
			instantiationService.stub(IContextKeyService, <IContextKeyService>instantiationService.createInstance(MockContextKeyService));
			instantiationService.stub(IEditorGroupsService, new TestEditorGroupsService());
			instantiationService.stub(IEditorService, new TestEditorService());
			instantiationService.stub(IWorkingCopyService, new TestWorkingCopyService());
			instantiationService.stub(ITelemetryService, NullTelemetryService);
			instantiationService.stub(IModeService, ModeServiceImpl);
			instantiationService.stub(ILogService, new NullLogService());
			instantiationService.stub(ILabelService, instantiationService.createInstance(LabelService));
			instantiationService.stub(IFilesConfigurationService, instantiationService.createInstance(FilesConfigurationService));
			instantiationService.stub(ITextResourcePropertiesService, new TestTextResourcePropertiesService(instantiationService.get(IConfigurationService)));
			instantiationService.stub(IUndoRedoService, instantiationService.createInstance(UndoRedoService));
			instantiationService.stub(IThemeService, new TestThemeService());
			instantiationService.stub(IModelService, instantiationService.createInstance(ModelServiceImpl));
			const fileService = new FileService(new NullLogService());
			const diskFileSystemProvider = new DiskFileSystemProvider(new NullLogService());
			fileService.registerProvider(Schemas.file, diskFileSystemProvider);
			fileService.registerProvider(Schemas.userData, new FileUserDataProvider(Schemas.file, diskFileSystemProvider, Schemas.userData, new NullLogService()));
			instantiationService.stub(IFileService, fileService);
			instantiationService.stub(IUriIdentityService, new UriIdentityService(fileService));
			instantiationService.stub(IWorkingCopyService, new TestWorkingCopyService());
			instantiationService.stub(IWorkingCopyFileService, instantiationService.createInstance(WorkingCopyFileService));
			instantiationService.stub(ITextFileService, instantiationService.createInstance(TestTextFileService));
			instantiationService.stub(ITextModelService, <ITextModelService>instantiationService.createInstance(TextModelResolverService));
			instantiationService.stub(IBackupFileService, new TestBackupFileService());

			testObject = instantiationService.createInstance(KeybindingsEditingService);
		});
	});

	async function setUpWorkspace(): Promise<void> {
		testDir = path.join(os.tmpdir(), 'vsctests', uuid.generateUuid());
		return await mkdirp(testDir, 493);
	}

	teardown(() => {
		return new Promise<void>((c) => {
			if (testDir) {
				rimraf(testDir, RimRafMode.MOVE).then(c, c);
			} else {
				c(undefined);
			}
		}).then(() => testDir = null!);
	});

	test('errors cases - parse errors', () => {
		fs.writeFileSync(keybindingsFile, ',,,,,,,,,,,,,,');
		return testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape } }), 'alt+c', undefined)
			.then(() => assert.fail('Should fail with parse errors'),
				error => assert.equal(error.message, 'Unable to write to the keybindings configuration file. Please open it to correct errors/warnings in the file and try again.'));
	});

	test('errors cases - parse errors 2', () => {
		fs.writeFileSync(keybindingsFile, '[{"key": }]');
		return testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape } }), 'alt+c', undefined)
			.then(() => assert.fail('Should fail with parse errors'),
				error => assert.equal(error.message, 'Unable to write to the keybindings configuration file. Please open it to correct errors/warnings in the file and try again.'));
	});

	test('errors cases - dirty', () => {
		instantiationService.stub(ITextFileService, 'isDirty', true);
		return testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape } }), 'alt+c', undefined)
			.then(() => assert.fail('Should fail with dirty error'),
				error => assert.equal(error.message, 'Unable to write because the keybindings configuration file is dirty. Please save it first and then try again.'));
	});

	test('errors cases - did not find an array', () => {
		fs.writeFileSync(keybindingsFile, '{"key": "alt+c", "command": "hello"}');
		return testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape } }), 'alt+c', undefined)
			.then(() => assert.fail('Should fail with dirty error'),
				error => assert.equal(error.message, 'Unable to write to the keybindings configuration file. It has an object which is not of type Array. Please open the file to clean up and try again.'));
	});

	test('edit a default keybinding to an empty file', () => {
		fs.writeFileSync(keybindingsFile, '');
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: 'a' }, { key: 'escape', command: '-a' }];
		return testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape }, command: 'a' }), 'alt+c', undefined)
			.then(() => assert.deepEqual(getUserKeybindings(), expected));
	});

	test('edit a default keybinding to an empty array', () => {
		writeToKeybindingsFile();
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: 'a' }, { key: 'escape', command: '-a' }];
		return testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape }, command: 'a' }), 'alt+c', undefined)
			.then(() => assert.deepEqual(getUserKeybindings(), expected));
	});

	test('edit a default keybinding in an existing array', () => {
		writeToKeybindingsFile({ command: 'b', key: 'shift+c' });
		const expected: IUserFriendlyKeybinding[] = [{ key: 'shift+c', command: 'b' }, { key: 'alt+c', command: 'a' }, { key: 'escape', command: '-a' }];
		return testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape }, command: 'a' }), 'alt+c', undefined)
			.then(() => assert.deepEqual(getUserKeybindings(), expected));
	});

	test('add another keybinding', () => {
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: 'a' }];
		return testObject.addKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape }, command: 'a' }), 'alt+c', undefined)
			.then(() => assert.deepEqual(getUserKeybindings(), expected));
	});

	test('add a new default keybinding', () => {
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: 'a' }];
		return testObject.addKeybinding(aResolvedKeybindingItem({ command: 'a' }), 'alt+c', undefined)
			.then(() => assert.deepEqual(getUserKeybindings(), expected));
	});

	test('add a new default keybinding using edit', () => {
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: 'a' }];
		return testObject.editKeybinding(aResolvedKeybindingItem({ command: 'a' }), 'alt+c', undefined)
			.then(() => assert.deepEqual(getUserKeybindings(), expected));
	});

	test('edit an user keybinding', () => {
		writeToKeybindingsFile({ key: 'escape', command: 'b' });
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: 'b' }];
		return testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape }, command: 'b', isDefault: false }), 'alt+c', undefined)
			.then(() => assert.deepEqual(getUserKeybindings(), expected));
	});

	test('edit an user keybinding with more than one element', () => {
		writeToKeybindingsFile({ key: 'escape', command: 'b' }, { key: 'alt+shift+g', command: 'c' });
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: 'b' }, { key: 'alt+shift+g', command: 'c' }];
		return testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape }, command: 'b', isDefault: false }), 'alt+c', undefined)
			.then(() => assert.deepEqual(getUserKeybindings(), expected));
	});

	test('remove a default keybinding', () => {
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: '-a' }];
		return testObject.removeKeybinding(aResolvedKeybindingItem({ command: 'a', firstPart: { keyCode: KeyCode.KEY_C, modifiers: { altKey: true } } }))
			.then(() => assert.deepEqual(getUserKeybindings(), expected));
	});

	test('remove a default keybinding should not ad duplicate entries', async () => {
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: '-a' }];
		await testObject.removeKeybinding(aResolvedKeybindingItem({ command: 'a', firstPart: { keyCode: KeyCode.KEY_C, modifiers: { altKey: true } } }));
		await testObject.removeKeybinding(aResolvedKeybindingItem({ command: 'a', firstPart: { keyCode: KeyCode.KEY_C, modifiers: { altKey: true } } }));
		await testObject.removeKeybinding(aResolvedKeybindingItem({ command: 'a', firstPart: { keyCode: KeyCode.KEY_C, modifiers: { altKey: true } } }));
		await testObject.removeKeybinding(aResolvedKeybindingItem({ command: 'a', firstPart: { keyCode: KeyCode.KEY_C, modifiers: { altKey: true } } }));
		await testObject.removeKeybinding(aResolvedKeybindingItem({ command: 'a', firstPart: { keyCode: KeyCode.KEY_C, modifiers: { altKey: true } } }));
		assert.deepEqual(getUserKeybindings(), expected);
	});

	test('remove a user keybinding', () => {
		writeToKeybindingsFile({ key: 'alt+c', command: 'b' });
		return testObject.removeKeybinding(aResolvedKeybindingItem({ command: 'b', firstPart: { keyCode: KeyCode.KEY_C, modifiers: { altKey: true } }, isDefault: false }))
			.then(() => assert.deepEqual(getUserKeybindings(), []));
	});

	test('reset an edited keybinding', () => {
		writeToKeybindingsFile({ key: 'alt+c', command: 'b' });
		return testObject.resetKeybinding(aResolvedKeybindingItem({ command: 'b', firstPart: { keyCode: KeyCode.KEY_C, modifiers: { altKey: true } }, isDefault: false }))
			.then(() => assert.deepEqual(getUserKeybindings(), []));
	});

	test('reset a removed keybinding', () => {
		writeToKeybindingsFile({ key: 'alt+c', command: '-b' });
		return testObject.resetKeybinding(aResolvedKeybindingItem({ command: 'b', isDefault: false }))
			.then(() => assert.deepEqual(getUserKeybindings(), []));
	});

	test('reset multiple removed keybindings', () => {
		writeToKeybindingsFile({ key: 'alt+c', command: '-b' });
		writeToKeybindingsFile({ key: 'alt+shift+c', command: '-b' });
		writeToKeybindingsFile({ key: 'escape', command: '-b' });
		return testObject.resetKeybinding(aResolvedKeybindingItem({ command: 'b', isDefault: false }))
			.then(() => assert.deepEqual(getUserKeybindings(), []));
	});

	test('add a new keybinding to unassigned keybinding', () => {
		writeToKeybindingsFile({ key: 'alt+c', command: '-a' });
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: '-a' }, { key: 'shift+alt+c', command: 'a' }];
		return testObject.editKeybinding(aResolvedKeybindingItem({ command: 'a', isDefault: false }), 'shift+alt+c', undefined)
			.then(() => assert.deepEqual(getUserKeybindings(), expected));
	});

	test('add when expression', () => {
		writeToKeybindingsFile({ key: 'alt+c', command: '-a' });
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: '-a' }, { key: 'shift+alt+c', command: 'a', when: 'editorTextFocus' }];
		return testObject.editKeybinding(aResolvedKeybindingItem({ command: 'a', isDefault: false }), 'shift+alt+c', 'editorTextFocus')
			.then(() => assert.deepEqual(getUserKeybindings(), expected));
	});

	test('update command and when expression', () => {
		writeToKeybindingsFile({ key: 'alt+c', command: '-a', when: 'editorTextFocus && !editorReadonly' });
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: '-a', when: 'editorTextFocus && !editorReadonly' }, { key: 'shift+alt+c', command: 'a', when: 'editorTextFocus' }];
		return testObject.editKeybinding(aResolvedKeybindingItem({ command: 'a', isDefault: false }), 'shift+alt+c', 'editorTextFocus')
			.then(() => assert.deepEqual(getUserKeybindings(), expected));
	});

	test('update when expression', () => {
		writeToKeybindingsFile({ key: 'alt+c', command: '-a', when: 'editorTextFocus && !editorReadonly' }, { key: 'shift+alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' });
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: '-a', when: 'editorTextFocus && !editorReadonly' }, { key: 'shift+alt+c', command: 'a', when: 'editorTextFocus' }];
		return testObject.editKeybinding(aResolvedKeybindingItem({ command: 'a', isDefault: false, when: 'editorTextFocus && !editorReadonly' }), 'shift+alt+c', 'editorTextFocus')
			.then(() => assert.deepEqual(getUserKeybindings(), expected));
	});

	test('remove when expression', () => {
		writeToKeybindingsFile({ key: 'alt+c', command: '-a', when: 'editorTextFocus && !editorReadonly' });
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: '-a', when: 'editorTextFocus && !editorReadonly' }, { key: 'shift+alt+c', command: 'a' }];
		return testObject.editKeybinding(aResolvedKeybindingItem({ command: 'a', isDefault: false }), 'shift+alt+c', undefined)
			.then(() => assert.deepEqual(getUserKeybindings(), expected));
	});

	function writeToKeybindingsFile(...keybindings: IUserFriendlyKeybinding[]) {
		fs.writeFileSync(keybindingsFile, JSON.stringify(keybindings || []));
	}

	function getUserKeybindings(): IUserFriendlyKeybinding[] {
		return json.parse(fs.readFileSync(keybindingsFile).toString('utf8'));
	}

	function aResolvedKeybindingItem({ command, when, isDefault, firstPart, chordPart }: { command?: string, when?: string, isDefault?: boolean, firstPart?: { keyCode: KeyCode, modifiers?: Modifiers }, chordPart?: { keyCode: KeyCode, modifiers?: Modifiers } }): ResolvedKeybindingItem {
		const aSimpleKeybinding = function (part: { keyCode: KeyCode, modifiers?: Modifiers }): SimpleKeybinding {
			const { ctrlKey, shiftKey, altKey, metaKey } = part.modifiers || { ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
			return new SimpleKeybinding(ctrlKey!, shiftKey!, altKey!, metaKey!, part.keyCode);
		};
		let parts: SimpleKeybinding[] = [];
		if (firstPart) {
			parts.push(aSimpleKeybinding(firstPart));
			if (chordPart) {
				parts.push(aSimpleKeybinding(chordPart));
			}
		}
		const keybinding = parts.length > 0 ? new USLayoutResolvedKeybinding(new ChordKeybinding(parts), OS) : undefined;
		return new ResolvedKeybindingItem(keybinding, command || 'some command', null, when ? ContextKeyExpr.deserialize(when) : undefined, isDefault === undefined ? true : isDefault, null, false);
	}

});
