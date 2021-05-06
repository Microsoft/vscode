/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { isWindows } from 'vs/base/common/platform';
import { URI } from 'vs/base/common/uri';
import { bufferToReadable, VSBuffer } from 'vs/base/common/buffer';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { EditorService } from 'vs/workbench/services/editor/browser/editorService';
import { IWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/common/workingCopyBackup';
import { Schemas } from 'vs/base/common/network';
import { isEqual } from 'vs/base/common/resources';
import { createEditorPart, InMemoryTestWorkingCopyBackupService, registerTestResourceEditor, TestServiceAccessor, toUntypedWorkingCopyId, workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { LegacyWorkingCopyBackupRestorer } from 'vs/workbench/services/workingCopy/common/legacyBackupRestorer';
import { BrowserWorkingCopyBackupTracker } from 'vs/workbench/services/workingCopy/browser/workingCopyBackupTracker';
import { DisposableStore } from 'vs/base/common/lifecycle';

suite('LegacyWorkingCopyBackupRestorer', () => {

	class TestBackupRestorer extends LegacyWorkingCopyBackupRestorer {
		override async doRestoreLegacyBackups(): Promise<void> {
			return super.doRestoreLegacyBackups();
		}
	}

	let accessor: TestServiceAccessor;
	let disposables = new DisposableStore();

	const fooFile = URI.file(isWindows ? 'c:\\Foo' : '/Foo');
	const barFile = URI.file(isWindows ? 'c:\\Bar' : '/Bar');
	const untitledFile1 = URI.from({ scheme: Schemas.untitled, path: 'Untitled-1' });
	const untitledFile2 = URI.from({ scheme: Schemas.untitled, path: 'Untitled-2' });

	setup(() => {
		disposables.add(registerTestResourceEditor());
	});

	teardown(() => {
		disposables.clear();
	});

	test('Restore backups', async function () {
		const workingCopyBackupService = new InMemoryTestWorkingCopyBackupService();
		const instantiationService = workbenchInstantiationService();
		instantiationService.stub(IWorkingCopyBackupService, workingCopyBackupService);

		const part = await createEditorPart(instantiationService, disposables);

		instantiationService.stub(IEditorGroupsService, part);

		const editorService: EditorService = instantiationService.createInstance(EditorService);
		instantiationService.stub(IEditorService, editorService);

		accessor = instantiationService.createInstance(TestServiceAccessor);

		disposables.add(instantiationService.createInstance(BrowserWorkingCopyBackupTracker));
		const restorer = instantiationService.createInstance(TestBackupRestorer);

		// Backup 2 normal files and 2 untitled files
		await workingCopyBackupService.backup(toUntypedWorkingCopyId(untitledFile1), bufferToReadable(VSBuffer.fromString('untitled-1')));
		await workingCopyBackupService.backup(toUntypedWorkingCopyId(untitledFile2), bufferToReadable(VSBuffer.fromString('untitled-2')));
		await workingCopyBackupService.backup(toUntypedWorkingCopyId(fooFile), bufferToReadable(VSBuffer.fromString('fooFile')));
		await workingCopyBackupService.backup(toUntypedWorkingCopyId(barFile), bufferToReadable(VSBuffer.fromString('barFile')));

		// Verify backups restored and opened as dirty
		await restorer.doRestoreLegacyBackups();
		assert.strictEqual(editorService.count, 4);
		assert.ok(editorService.editors.every(editor => editor.isDirty()));

		let counter = 0;
		for (const editor of editorService.editors) {
			const resource = editor.resource;
			if (isEqual(resource, untitledFile1)) {
				const model = await accessor.textFileService.untitled.resolve({ untitledResource: resource });
				if (model.textEditorModel?.getValue() !== 'untitled-1') {
					const backupContents = await workingCopyBackupService.getBackupContents(model);
					assert.fail(`Unable to restore backup for resource ${untitledFile1.toString()}. Backup contents: ${backupContents}`);
				}
				model.dispose();
				counter++;
			} else if (isEqual(resource, untitledFile2)) {
				const model = await accessor.textFileService.untitled.resolve({ untitledResource: resource });
				if (model.textEditorModel?.getValue() !== 'untitled-2') {
					const backupContents = await workingCopyBackupService.getBackupContents(model);
					assert.fail(`Unable to restore backup for resource ${untitledFile2.toString()}. Backup contents: ${backupContents}`);
				}
				model.dispose();
				counter++;
			} else if (isEqual(resource, fooFile)) {
				const model = accessor.textFileService.files.get(fooFile);
				await model?.resolve();
				if (model?.textEditorModel?.getValue() !== 'fooFile') {
					const backupContents = await workingCopyBackupService.getBackupContents(model!);
					assert.fail(`Unable to restore backup for resource ${fooFile.toString()}. Backup contents: ${backupContents}`);
				}
				counter++;
			} else {
				const model = accessor.textFileService.files.get(barFile);
				await model?.resolve();
				if (model?.textEditorModel?.getValue() !== 'barFile') {
					const backupContents = await workingCopyBackupService.getBackupContents(model!);
					assert.fail(`Unable to restore backup for resource ${barFile.toString()}. Backup contents: ${backupContents}`);
				}
				counter++;
			}
		}

		assert.strictEqual(counter, 4);
	});
});
