/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as json from 'vs/base/common/json';
import { ChordKeybinding, KeyCode, SimpleKeybinding } from 'vs/base/common/keyCodes';
import { OS } from 'vs/base/common/platform';
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
import { IWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/common/workingCopyBackup';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { KeybindingsEditingService } from 'vs/workbench/services/keybinding/common/keybindingEditing';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { TextModelResolverService } from 'vs/workbench/services/textmodelResolver/common/textModelResolverService';
import { TestWorkingCopyBackupService, TestEditorGroupsService, TestEditorService, TestEnvironmentService, TestLifecycleService, TestPathService, TestTextFileService } from 'vs/workbench/test/browser/workbenchTestServices';
import { FileService } from 'vs/platform/files/common/fileService';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { FileUserDataProvider } from 'vs/workbench/services/userData/common/fileUserDataProvider';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IWorkingCopyService, WorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { ILabelService } from 'vs/platform/label/common/label';
import { LabelService } from 'vs/workbench/services/label/common/labelService';
import { IFilesConfigurationService, FilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { WorkingCopyFileService, IWorkingCopyFileService } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { UndoRedoService } from 'vs/platform/undoRedo/common/undoRedoService';
import { TestTextResourcePropertiesService, TestContextService } from 'vs/workbench/test/common/workbenchTestServices';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { UriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentityService';
import { joinPath } from 'vs/base/common/resources';
import { InMemoryFileSystemProvider } from 'vs/platform/files/common/inMemoryFilesystemProvider';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { VSBuffer } from 'vs/base/common/buffer';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';

interface Modifiers {
	metaKey?: boolean;
	ctrlKey?: boolean;
	altKey?: boolean;
	shiftKey?: boolean;
}

const ROOT = URI.file('tests').with({ scheme: 'vscode-tests' });

suite('KeybindingsEditing', () => {

	const disposables = new DisposableStore();
	let instantiationService: TestInstantiationService, fileService: IFileService, environmentService: IEnvironmentService;
	let testObject: KeybindingsEditingService;

	setup(async () => {
		const logService = new NullLogService();
		fileService = disposables.add(new FileService(logService));
		const fileSystemProvider = disposables.add(new InMemoryFileSystemProvider());
		disposables.add(fileService.registerProvider(ROOT.scheme, fileSystemProvider));

		const userFolder = joinPath(ROOT, 'User');
		await fileService.createFolder(userFolder);
		environmentService = TestEnvironmentService;

		instantiationService = new TestInstantiationService();

		const configService = new TestConfigurationService();
		configService.setUserConfiguration('files', { 'eol': '\n' });

		instantiationService.stub(IEnvironmentService, environmentService);
		instantiationService.stub(IWorkbenchEnvironmentService, environmentService);
		instantiationService.stub(IPathService, new TestPathService());
		instantiationService.stub(IConfigurationService, configService);
		instantiationService.stub(IWorkspaceContextService, new TestContextService());
		const lifecycleService = new TestLifecycleService();
		instantiationService.stub(ILifecycleService, lifecycleService);
		instantiationService.stub(IContextKeyService, <IContextKeyService>instantiationService.createInstance(MockContextKeyService));
		instantiationService.stub(IEditorGroupsService, new TestEditorGroupsService());
		instantiationService.stub(IEditorService, new TestEditorService());
		instantiationService.stub(IWorkingCopyService, disposables.add(new WorkingCopyService()));
		instantiationService.stub(ITelemetryService, NullTelemetryService);
		instantiationService.stub(IModeService, ModeServiceImpl);
		instantiationService.stub(ILogService, new NullLogService());
		instantiationService.stub(ILabelService, disposables.add(instantiationService.createInstance(LabelService)));
		instantiationService.stub(IFilesConfigurationService, disposables.add(instantiationService.createInstance(FilesConfigurationService)));
		instantiationService.stub(ITextResourcePropertiesService, new TestTextResourcePropertiesService(instantiationService.get(IConfigurationService)));
		instantiationService.stub(IUndoRedoService, instantiationService.createInstance(UndoRedoService));
		instantiationService.stub(IThemeService, new TestThemeService());
		instantiationService.stub(IModelService, disposables.add(instantiationService.createInstance(ModelServiceImpl)));
		fileService.registerProvider(Schemas.userData, disposables.add(new FileUserDataProvider(ROOT.scheme, fileSystemProvider, Schemas.userData, new NullLogService())));
		instantiationService.stub(IFileService, fileService);
		instantiationService.stub(IUriIdentityService, new UriIdentityService(fileService));
		instantiationService.stub(IWorkingCopyFileService, disposables.add(instantiationService.createInstance(WorkingCopyFileService)));
		instantiationService.stub(ITextFileService, disposables.add(instantiationService.createInstance(TestTextFileService)));
		instantiationService.stub(ITextModelService, disposables.add(instantiationService.createInstance(TextModelResolverService)));
		instantiationService.stub(IWorkingCopyBackupService, new TestWorkingCopyBackupService());

		testObject = disposables.add(instantiationService.createInstance(KeybindingsEditingService));

	});

	teardown(() => disposables.clear());

	test('errors cases - parse errors', async () => {
		await fileService.writeFile(environmentService.keybindingsResource, VSBuffer.fromString(',,,,,,,,,,,,,,'));
		try {
			await testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape } }), 'alt+c', undefined);
			assert.fail('Should fail with parse errors');
		} catch (error) {
			assert.strictEqual(error.message, 'Unable to write to the keybindings configuration file. Please open it to correct errors/warnings in the file and try again.');
		}
	});

	test('errors cases - parse errors 2', async () => {
		await fileService.writeFile(environmentService.keybindingsResource, VSBuffer.fromString('[{"key": }]'));
		try {
			await testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape } }), 'alt+c', undefined);
			assert.fail('Should fail with parse errors');
		} catch (error) {
			assert.strictEqual(error.message, 'Unable to write to the keybindings configuration file. Please open it to correct errors/warnings in the file and try again.');
		}
	});

	test('errors cases - dirty', () => {
		instantiationService.stub(ITextFileService, 'isDirty', true);
		return testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape } }), 'alt+c', undefined)
			.then(() => assert.fail('Should fail with dirty error'),
				error => assert.strictEqual(error.message, 'Unable to write because the keybindings configuration file is dirty. Please save it first and then try again.'));
	});

	test('errors cases - did not find an array', async () => {
		await fileService.writeFile(environmentService.keybindingsResource, VSBuffer.fromString('{"key": "alt+c", "command": "hello"}'));
		try {
			await testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape } }), 'alt+c', undefined);
			assert.fail('Should fail');
		} catch (error) {
			assert.strictEqual(error.message, 'Unable to write to the keybindings configuration file. It has an object which is not of type Array. Please open the file to clean up and try again.');
		}
	});

	test('edit a default keybinding to an empty file', async () => {
		await fileService.writeFile(environmentService.keybindingsResource, VSBuffer.fromString(''));
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: 'a' }, { key: 'escape', command: '-a' }];
		await testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape }, command: 'a' }), 'alt+c', undefined);
		assert.deepStrictEqual(await getUserKeybindings(), expected);
	});

	test('edit a default keybinding to an empty array', async () => {
		await writeToKeybindingsFile();
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: 'a' }, { key: 'escape', command: '-a' }];
		await testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape }, command: 'a' }), 'alt+c', undefined);
		return assert.deepStrictEqual(await getUserKeybindings(), expected);
	});

	test('edit a default keybinding in an existing array', async () => {
		await writeToKeybindingsFile({ command: 'b', key: 'shift+c' });
		const expected: IUserFriendlyKeybinding[] = [{ key: 'shift+c', command: 'b' }, { key: 'alt+c', command: 'a' }, { key: 'escape', command: '-a' }];
		await testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape }, command: 'a' }), 'alt+c', undefined);
		return assert.deepStrictEqual(await getUserKeybindings(), expected);
	});

	test('add another keybinding', async () => {
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: 'a' }];
		await testObject.addKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape }, command: 'a' }), 'alt+c', undefined);
		return assert.deepStrictEqual(await getUserKeybindings(), expected);
	});

	test('add a new default keybinding', async () => {
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: 'a' }];
		await testObject.addKeybinding(aResolvedKeybindingItem({ command: 'a' }), 'alt+c', undefined);
		return assert.deepStrictEqual(await getUserKeybindings(), expected);
	});

	test('add a new default keybinding using edit', async () => {
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: 'a' }];
		await testObject.editKeybinding(aResolvedKeybindingItem({ command: 'a' }), 'alt+c', undefined);
		assert.deepStrictEqual(await getUserKeybindings(), expected);
	});

	test('edit an user keybinding', async () => {
		await writeToKeybindingsFile({ key: 'escape', command: 'b' });
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: 'b' }];
		await testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape }, command: 'b', isDefault: false }), 'alt+c', undefined);
		assert.deepStrictEqual(await getUserKeybindings(), expected);
	});

	test('edit an user keybinding with more than one element', async () => {
		await writeToKeybindingsFile({ key: 'escape', command: 'b' }, { key: 'alt+shift+g', command: 'c' });
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: 'b' }, { key: 'alt+shift+g', command: 'c' }];
		await testObject.editKeybinding(aResolvedKeybindingItem({ firstPart: { keyCode: KeyCode.Escape }, command: 'b', isDefault: false }), 'alt+c', undefined);
		assert.deepStrictEqual(await getUserKeybindings(), expected);
	});

	test('remove a default keybinding', async () => {
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: '-a' }];
		await testObject.removeKeybinding(aResolvedKeybindingItem({ command: 'a', firstPart: { keyCode: KeyCode.KEY_C, modifiers: { altKey: true } } }));
		assert.deepStrictEqual(await getUserKeybindings(), expected);
	});

	test('remove a default keybinding should not ad duplicate entries', async () => {
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: '-a' }];
		await testObject.removeKeybinding(aResolvedKeybindingItem({ command: 'a', firstPart: { keyCode: KeyCode.KEY_C, modifiers: { altKey: true } } }));
		await testObject.removeKeybinding(aResolvedKeybindingItem({ command: 'a', firstPart: { keyCode: KeyCode.KEY_C, modifiers: { altKey: true } } }));
		await testObject.removeKeybinding(aResolvedKeybindingItem({ command: 'a', firstPart: { keyCode: KeyCode.KEY_C, modifiers: { altKey: true } } }));
		await testObject.removeKeybinding(aResolvedKeybindingItem({ command: 'a', firstPart: { keyCode: KeyCode.KEY_C, modifiers: { altKey: true } } }));
		await testObject.removeKeybinding(aResolvedKeybindingItem({ command: 'a', firstPart: { keyCode: KeyCode.KEY_C, modifiers: { altKey: true } } }));
		assert.deepStrictEqual(await getUserKeybindings(), expected);
	});

	test('remove a user keybinding', async () => {
		await writeToKeybindingsFile({ key: 'alt+c', command: 'b' });
		await testObject.removeKeybinding(aResolvedKeybindingItem({ command: 'b', firstPart: { keyCode: KeyCode.KEY_C, modifiers: { altKey: true } }, isDefault: false }));
		assert.deepStrictEqual(await getUserKeybindings(), []);
	});

	test('reset an edited keybinding', async () => {
		await writeToKeybindingsFile({ key: 'alt+c', command: 'b' });
		await testObject.resetKeybinding(aResolvedKeybindingItem({ command: 'b', firstPart: { keyCode: KeyCode.KEY_C, modifiers: { altKey: true } }, isDefault: false }));
		assert.deepStrictEqual(await getUserKeybindings(), []);
	});

	test('reset a removed keybinding', async () => {
		await writeToKeybindingsFile({ key: 'alt+c', command: '-b' });
		await testObject.resetKeybinding(aResolvedKeybindingItem({ command: 'b', isDefault: false }));
		assert.deepStrictEqual(await getUserKeybindings(), []);
	});

	test('reset multiple removed keybindings', async () => {
		await writeToKeybindingsFile({ key: 'alt+c', command: '-b' });
		await writeToKeybindingsFile({ key: 'alt+shift+c', command: '-b' });
		await writeToKeybindingsFile({ key: 'escape', command: '-b' });
		await testObject.resetKeybinding(aResolvedKeybindingItem({ command: 'b', isDefault: false }));
		assert.deepStrictEqual(await getUserKeybindings(), []);
	});

	test('add a new keybinding to unassigned keybinding', async () => {
		await writeToKeybindingsFile({ key: 'alt+c', command: '-a' });
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: '-a' }, { key: 'shift+alt+c', command: 'a' }];
		await testObject.editKeybinding(aResolvedKeybindingItem({ command: 'a', isDefault: false }), 'shift+alt+c', undefined);
		assert.deepStrictEqual(await getUserKeybindings(), expected);
	});

	test('add when expression', async () => {
		await writeToKeybindingsFile({ key: 'alt+c', command: '-a' });
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: '-a' }, { key: 'shift+alt+c', command: 'a', when: 'editorTextFocus' }];
		await testObject.editKeybinding(aResolvedKeybindingItem({ command: 'a', isDefault: false }), 'shift+alt+c', 'editorTextFocus');
		assert.deepStrictEqual(await getUserKeybindings(), expected);
	});

	test('update command and when expression', async () => {
		await writeToKeybindingsFile({ key: 'alt+c', command: '-a', when: 'editorTextFocus && !editorReadonly' });
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: '-a', when: 'editorTextFocus && !editorReadonly' }, { key: 'shift+alt+c', command: 'a', when: 'editorTextFocus' }];
		await testObject.editKeybinding(aResolvedKeybindingItem({ command: 'a', isDefault: false }), 'shift+alt+c', 'editorTextFocus');
		assert.deepStrictEqual(await getUserKeybindings(), expected);
	});

	test('update when expression', async () => {
		await writeToKeybindingsFile({ key: 'alt+c', command: '-a', when: 'editorTextFocus && !editorReadonly' }, { key: 'shift+alt+c', command: 'a', when: 'editorTextFocus && !editorReadonly' });
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: '-a', when: 'editorTextFocus && !editorReadonly' }, { key: 'shift+alt+c', command: 'a', when: 'editorTextFocus' }];
		await testObject.editKeybinding(aResolvedKeybindingItem({ command: 'a', isDefault: false, when: 'editorTextFocus && !editorReadonly' }), 'shift+alt+c', 'editorTextFocus');
		assert.deepStrictEqual(await getUserKeybindings(), expected);
	});

	test('remove when expression', async () => {
		await writeToKeybindingsFile({ key: 'alt+c', command: '-a', when: 'editorTextFocus && !editorReadonly' });
		const expected: IUserFriendlyKeybinding[] = [{ key: 'alt+c', command: '-a', when: 'editorTextFocus && !editorReadonly' }, { key: 'shift+alt+c', command: 'a' }];
		await testObject.editKeybinding(aResolvedKeybindingItem({ command: 'a', isDefault: false }), 'shift+alt+c', undefined);
		assert.deepStrictEqual(await getUserKeybindings(), expected);
	});

	async function writeToKeybindingsFile(...keybindings: IUserFriendlyKeybinding[]): Promise<void> {
		await fileService.writeFile(environmentService.keybindingsResource, VSBuffer.fromString(JSON.stringify(keybindings || [])));
	}

	async function getUserKeybindings(): Promise<IUserFriendlyKeybinding[]> {
		return json.parse((await fileService.readFile(environmentService.keybindingsResource)).value.toString());
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
