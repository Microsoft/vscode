/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { UndoRedoService } from 'vs/platform/undoRedo/common/undoRedoService';
import { TestDialogService } from 'vs/platform/dialogs/test/common/testDialogService';
import { TestNotificationService } from 'vs/platform/notification/test/common/testNotificationService';
import { UndoRedoElementType, IUndoRedoElement } from 'vs/platform/undoRedo/common/undoRedo';
import { URI } from 'vs/base/common/uri';
import { mock } from 'vs/base/test/common/mock';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';

suite('UndoRedoService', () => {

	function createUndoRedoService(dialogService: IDialogService = new TestDialogService()): UndoRedoService {
		const notificationService = new TestNotificationService();
		return new UndoRedoService(dialogService, notificationService);
	}

	test('simple single resource elements', () => {
		const resource = URI.file('test.txt');
		const service = createUndoRedoService();

		assert.equal(service.canUndo(resource), false);
		assert.equal(service.canRedo(resource), false);
		assert.equal(service.hasElements(resource), false);
		assert.ok(service.getLastElement(resource) === null);

		let undoCall1 = 0;
		let redoCall1 = 0;
		const element1: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: resource,
			label: 'typing 1',
			undo: () => { undoCall1++; },
			redo: () => { redoCall1++; }
		};
		service.pushElement(element1);

		assert.equal(undoCall1, 0);
		assert.equal(redoCall1, 0);
		assert.equal(service.canUndo(resource), true);
		assert.equal(service.canRedo(resource), false);
		assert.equal(service.hasElements(resource), true);
		assert.ok(service.getLastElement(resource) === element1);

		service.undo(resource);
		assert.equal(undoCall1, 1);
		assert.equal(redoCall1, 0);
		assert.equal(service.canUndo(resource), false);
		assert.equal(service.canRedo(resource), true);
		assert.equal(service.hasElements(resource), true);
		assert.ok(service.getLastElement(resource) === null);

		service.redo(resource);
		assert.equal(undoCall1, 1);
		assert.equal(redoCall1, 1);
		assert.equal(service.canUndo(resource), true);
		assert.equal(service.canRedo(resource), false);
		assert.equal(service.hasElements(resource), true);
		assert.ok(service.getLastElement(resource) === element1);

		let undoCall2 = 0;
		let redoCall2 = 0;
		const element2: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: resource,
			label: 'typing 2',
			undo: () => { undoCall2++; },
			redo: () => { redoCall2++; }
		};
		service.pushElement(element2);

		assert.equal(undoCall1, 1);
		assert.equal(redoCall1, 1);
		assert.equal(undoCall2, 0);
		assert.equal(redoCall2, 0);
		assert.equal(service.canUndo(resource), true);
		assert.equal(service.canRedo(resource), false);
		assert.equal(service.hasElements(resource), true);
		assert.ok(service.getLastElement(resource) === element2);

		service.undo(resource);

		assert.equal(undoCall1, 1);
		assert.equal(redoCall1, 1);
		assert.equal(undoCall2, 1);
		assert.equal(redoCall2, 0);
		assert.equal(service.canUndo(resource), true);
		assert.equal(service.canRedo(resource), true);
		assert.equal(service.hasElements(resource), true);
		assert.ok(service.getLastElement(resource) === null);

		let undoCall3 = 0;
		let redoCall3 = 0;
		const element3: IUndoRedoElement = {
			type: UndoRedoElementType.Resource,
			resource: resource,
			label: 'typing 2',
			undo: () => { undoCall3++; },
			redo: () => { redoCall3++; }
		};
		service.pushElement(element3);

		assert.equal(undoCall1, 1);
		assert.equal(redoCall1, 1);
		assert.equal(undoCall2, 1);
		assert.equal(redoCall2, 0);
		assert.equal(undoCall3, 0);
		assert.equal(redoCall3, 0);
		assert.equal(service.canUndo(resource), true);
		assert.equal(service.canRedo(resource), false);
		assert.equal(service.hasElements(resource), true);
		assert.ok(service.getLastElement(resource) === element3);

		service.undo(resource);

		assert.equal(undoCall1, 1);
		assert.equal(redoCall1, 1);
		assert.equal(undoCall2, 1);
		assert.equal(redoCall2, 0);
		assert.equal(undoCall3, 1);
		assert.equal(redoCall3, 0);
		assert.equal(service.canUndo(resource), true);
		assert.equal(service.canRedo(resource), true);
		assert.equal(service.hasElements(resource), true);
		assert.ok(service.getLastElement(resource) === null);
	});

	test('multi resource elements', async () => {
		const resource1 = URI.file('test1.txt');
		const resource2 = URI.file('test2.txt');
		const service = createUndoRedoService(new class extends mock<IDialogService>() {
			async show() {
				return {
					choice: 0 // confirm!
				};
			}
		});

		let undoCall1 = 0, undoCall11 = 0, undoCall12 = 0;
		let redoCall1 = 0, redoCall11 = 0, redoCall12 = 0;
		const element1: IUndoRedoElement = {
			type: UndoRedoElementType.Workspace,
			resources: [resource1, resource2],
			label: 'typing 1',
			undo: () => { undoCall1++; },
			redo: () => { redoCall1++; },
			split: () => {
				return [
					{
						type: UndoRedoElementType.Resource,
						resource: resource1,
						label: 'typing 1.1',
						undo: () => { undoCall11++; },
						redo: () => { redoCall11++; }
					},
					{
						type: UndoRedoElementType.Resource,
						resource: resource2,
						label: 'typing 1.2',
						undo: () => { undoCall12++; },
						redo: () => { redoCall12++; }
					}
				];
			}
		};
		service.pushElement(element1);

		assert.equal(service.canUndo(resource1), true);
		assert.equal(service.canRedo(resource1), false);
		assert.equal(service.hasElements(resource1), true);
		assert.ok(service.getLastElement(resource1) === element1);
		assert.equal(service.canUndo(resource2), true);
		assert.equal(service.canRedo(resource2), false);
		assert.equal(service.hasElements(resource2), true);
		assert.ok(service.getLastElement(resource2) === element1);

		await service.undo(resource1);

		assert.equal(undoCall1, 1);
		assert.equal(redoCall1, 0);
		assert.equal(service.canUndo(resource1), false);
		assert.equal(service.canRedo(resource1), true);
		assert.equal(service.hasElements(resource1), true);
		assert.ok(service.getLastElement(resource1) === null);
		assert.equal(service.canUndo(resource2), false);
		assert.equal(service.canRedo(resource2), true);
		assert.equal(service.hasElements(resource2), true);
		assert.ok(service.getLastElement(resource2) === null);

		await service.redo(resource2);
		assert.equal(undoCall1, 1);
		assert.equal(redoCall1, 1);
		assert.equal(undoCall11, 0);
		assert.equal(redoCall11, 0);
		assert.equal(undoCall12, 0);
		assert.equal(redoCall12, 0);
		assert.equal(service.canUndo(resource1), true);
		assert.equal(service.canRedo(resource1), false);
		assert.equal(service.hasElements(resource1), true);
		assert.ok(service.getLastElement(resource1) === element1);
		assert.equal(service.canUndo(resource2), true);
		assert.equal(service.canRedo(resource2), false);
		assert.equal(service.hasElements(resource2), true);
		assert.ok(service.getLastElement(resource2) === element1);

	});
});
