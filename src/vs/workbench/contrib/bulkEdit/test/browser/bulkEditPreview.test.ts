/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Event } from 'vs/base/common/event';
import { IFileService } from 'vs/platform/files/common/files';
import { mock } from 'vs/workbench/test/common/workbenchTestServices';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IModelService } from 'vs/editor/common/services/modelService';
import { URI } from 'vs/base/common/uri';
import { BulkFileOperations } from 'vs/workbench/contrib/bulkEdit/browser/preview/bulkEditPreview';
import { Range } from 'vs/editor/common/core/range';
import { ResourceFileEdit, ResourceTextEdit } from 'vs/editor/browser/services/bulkEditService';

suite('BulkEditPreview', function () {


	let instaService: IInstantiationService;

	setup(function () {

		const fileService: IFileService = new class extends mock<IFileService>() {
			override onDidFilesChange = Event.None;
			override async exists() {
				return true;
			}
		};

		const modelService: IModelService = new class extends mock<IModelService>() {
			override getModel() {
				return null;
			}
			override getModels() {
				return [];
			}
		};

		instaService = new InstantiationService(new ServiceCollection(
			[IFileService, fileService],
			[IModelService, modelService],
		));
	});

	test('one needsConfirmation unchecks all of file', async function () {

		const edits = [
			new ResourceFileEdit(undefined, URI.parse('some:///uri1'), undefined, { label: 'cat1', needsConfirmation: true }),
			new ResourceFileEdit(URI.parse('some:///uri1'), URI.parse('some:///uri2'), undefined, { label: 'cat2', needsConfirmation: false }),
		];

		const ops = await instaService.invokeFunction(BulkFileOperations.create, edits);
		assert.strictEqual(ops.fileOperations.length, 1);
		assert.strictEqual(ops.checked.isChecked(edits[0]), false);
	});

	test('has categories', async function () {

		const edits = [
			new ResourceFileEdit(undefined, URI.parse('some:///uri1'), undefined, { label: 'uri1', needsConfirmation: true }),
			new ResourceFileEdit(undefined, URI.parse('some:///uri2'), undefined, { label: 'uri2', needsConfirmation: false }),
		];


		const ops = await instaService.invokeFunction(BulkFileOperations.create, edits);
		assert.strictEqual(ops.categories.length, 2);
		assert.strictEqual(ops.categories[0].metadata.label, 'uri1'); // unconfirmed!
		assert.strictEqual(ops.categories[1].metadata.label, 'uri2');
	});

	test('has not categories', async function () {

		const edits = [
			new ResourceFileEdit(undefined, URI.parse('some:///uri1'), undefined, { label: 'uri1', needsConfirmation: true }),
			new ResourceFileEdit(undefined, URI.parse('some:///uri2'), undefined, { label: 'uri1', needsConfirmation: false }),
		];

		const ops = await instaService.invokeFunction(BulkFileOperations.create, edits);
		assert.strictEqual(ops.categories.length, 1);
		assert.strictEqual(ops.categories[0].metadata.label, 'uri1'); // unconfirmed!
		assert.strictEqual(ops.categories[0].metadata.label, 'uri1');
	});

	test('category selection', async function () {

		const edits = [
			new ResourceFileEdit(undefined, URI.parse('some:///uri1'), undefined, { label: 'C1', needsConfirmation: false }),
			new ResourceTextEdit(URI.parse('some:///uri2'), { text: 'foo', range: new Range(1, 1, 1, 1) }, undefined, { label: 'C2', needsConfirmation: false }),
		];


		const ops = await instaService.invokeFunction(BulkFileOperations.create, edits);

		assert.strictEqual(ops.checked.isChecked(edits[0]), true);
		assert.strictEqual(ops.checked.isChecked(edits[1]), true);

		assert.ok(edits === ops.getWorkspaceEdit());

		// NOT taking to create, but the invalid text edit will
		// go through
		ops.checked.updateChecked(edits[0], false);
		const newEdits = ops.getWorkspaceEdit();
		assert.ok(edits !== newEdits);

		assert.strictEqual(edits.length, 2);
		assert.strictEqual(newEdits.length, 1);
	});

	test('fix bad metadata', async function () {

		// bogous edit that wants creation to be confirmed, but not it's textedit-child...

		const edits = [
			new ResourceFileEdit(undefined, URI.parse('some:///uri1'), undefined, { label: 'C1', needsConfirmation: true }),
			new ResourceTextEdit(URI.parse('some:///uri1'), { text: 'foo', range: new Range(1, 1, 1, 1) }, undefined, { label: 'C2', needsConfirmation: false })
		];

		const ops = await instaService.invokeFunction(BulkFileOperations.create, edits);

		assert.strictEqual(ops.checked.isChecked(edits[0]), false);
		assert.strictEqual(ops.checked.isChecked(edits[1]), false);
	});
});
