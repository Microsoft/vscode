/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EditorInput } from 'vs/workbench/common/editor';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';

suite('Workbench editor input', () => {

	class MyEditorInput extends EditorInput {
		readonly resource = undefined;

		override get typeId(): string { return 'myEditorInput'; }
		override resolve(): any { return null; }
	}

	test('EditorInput', () => {
		let counter = 0;
		let input = new MyEditorInput();
		let otherInput = new MyEditorInput();

		assert(input.matches(input));
		assert(!input.matches(otherInput));
		assert(!input.matches(null));
		assert(input.getName());

		input.onWillDispose(() => {
			assert(true);
			counter++;
		});

		input.dispose();
		assert.strictEqual(counter, 1);
	});

	test('DiffEditorInput', () => {
		const instantiationService = workbenchInstantiationService();

		let counter = 0;
		let input = new MyEditorInput();
		input.onWillDispose(() => {
			assert(true);
			counter++;
		});

		let otherInput = new MyEditorInput();
		otherInput.onWillDispose(() => {
			assert(true);
			counter++;
		});

		let diffInput = instantiationService.createInstance(DiffEditorInput, 'name', 'description', input, otherInput, undefined);

		assert.strictEqual(diffInput.originalInput, input);
		assert.strictEqual(diffInput.modifiedInput, otherInput);
		assert(diffInput.matches(diffInput));
		assert(!diffInput.matches(otherInput));
		assert(!diffInput.matches(null));

		diffInput.dispose();
		assert.strictEqual(counter, 0);
	});

	test('DiffEditorInput disposes when input inside disposes', function () {
		const instantiationService = workbenchInstantiationService();

		let counter = 0;
		let input = new MyEditorInput();
		let otherInput = new MyEditorInput();

		let diffInput = instantiationService.createInstance(DiffEditorInput, 'name', 'description', input, otherInput, undefined);
		diffInput.onWillDispose(() => {
			counter++;
			assert(true);
		});

		input.dispose();

		input = new MyEditorInput();
		otherInput = new MyEditorInput();

		let diffInput2 = instantiationService.createInstance(DiffEditorInput, 'name', 'description', input, otherInput, undefined);
		diffInput2.onWillDispose(() => {
			counter++;
			assert(true);
		});

		otherInput.dispose();
		assert.strictEqual(counter, 2);
	});
});
