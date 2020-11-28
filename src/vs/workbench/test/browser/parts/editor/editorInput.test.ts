/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EditorInput } from 'vs/workbench/common/editor';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';

class MyEditorInput extends EditorInput {
	readonly resource = undefined;

	getTypeId(): string { return ''; }
	resolve(): any { return null; }
}

suite('Workbench editor input', () => {

	test('EditorInput', () => {
		let counter = 0;
		let input = new MyEditorInput();
		let otherInput = new MyEditorInput();

		assert(input.matches(input));
		assert(!input.matches(otherInput));
		assert(!input.matches(null));
		assert(input.getName());

		input.onDispose(() => {
			assert(true);
			counter++;
		});

		input.dispose();
		assert.equal(counter, 1);
	});

	test('DiffEditorInput', () => {
		const instantiationService = workbenchInstantiationService();

		let counter = 0;
		let input = new MyEditorInput();
		input.onDispose(() => {
			assert(true);
			counter++;
		});

		let otherInput = new MyEditorInput();
		otherInput.onDispose(() => {
			assert(true);
			counter++;
		});

		let diffInput = instantiationService.createInstance(DiffEditorInput, 'name', 'description', input, otherInput, undefined);

		assert.equal(diffInput.originalInput, input);
		assert.equal(diffInput.modifiedInput, otherInput);
		assert(diffInput.matches(diffInput));
		assert(!diffInput.matches(otherInput));
		assert(!diffInput.matches(null));

		diffInput.dispose();
		assert.equal(counter, 0);
	});

	test('DiffEditorInput disposes when input inside disposes', function () {
		const instantiationService = workbenchInstantiationService();

		let counter = 0;
		let input = new MyEditorInput();
		let otherInput = new MyEditorInput();

		let diffInput = instantiationService.createInstance(DiffEditorInput, 'name', 'description', input, otherInput, undefined);
		diffInput.onDispose(() => {
			counter++;
			assert(true);
		});

		input.dispose();

		input = new MyEditorInput();
		otherInput = new MyEditorInput();

		let diffInput2 = instantiationService.createInstance(DiffEditorInput, 'name', 'description', input, otherInput, undefined);
		diffInput2.onDispose(() => {
			counter++;
			assert(true);
		});

		otherInput.dispose();
		assert.equal(counter, 2);
	});
});
