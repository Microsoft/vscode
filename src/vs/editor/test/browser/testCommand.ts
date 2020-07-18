/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IRange } from 'vs/editor/common/core/range';
import { Selection, ISelection } from 'vs/editor/common/core/selection';
import { ICommand, IEditOperationBuilder } from 'vs/editor/common/editorCommon';
import { IIdentifiedSingleEditOperation, ITextModel } from 'vs/editor/common/model';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import { LanguageIdentifier } from 'vs/editor/common/modes';
import { withTestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';

export function testCommand(
	lines: string[],
	languageIdentifier: LanguageIdentifier | null,
	selection: Selection,
	commandFactory: (selection: Selection) => ICommand,
	expectedLines: string[],
	expectedSelection: Selection,
	forceTokenization?: boolean
): void {
	let model = createTextModel(lines.join('\n'), undefined, languageIdentifier);
	withTestCodeEditor('', { model: model }, (_editor, cursor) => {
		if (!cursor) {
			return;
		}

		if (forceTokenization) {
			model.forceTokenization(model.getLineCount());
		}

		cursor.setSelections('tests', [selection]);

		cursor.executeCommand(commandFactory(cursor.getSelection()), 'tests');

		assert.deepEqual(model.getLinesContent(), expectedLines);

		let actualSelection = cursor.getSelection();
		assert.deepEqual(actualSelection.toString(), expectedSelection.toString());

	});
	model.dispose();
}

/**
 * Extract edit operations if command `command` were to execute on model `model`
 */
export function getEditOperation(model: ITextModel, command: ICommand): IIdentifiedSingleEditOperation[] {
	let operations: IIdentifiedSingleEditOperation[] = [];
	let editOperationBuilder: IEditOperationBuilder = {
		addEditOperation: (range: IRange, text: string, forceMoveMarkers: boolean = false) => {
			operations.push({
				range: range,
				text: text,
				forceMoveMarkers: forceMoveMarkers
			});
		},

		addTrackedEditOperation: (range: IRange, text: string, forceMoveMarkers: boolean = false) => {
			operations.push({
				range: range,
				text: text,
				forceMoveMarkers: forceMoveMarkers
			});
		},


		trackSelection: (selection: ISelection) => {
			return '';
		}
	};
	command.getEditOperations(model, editOperationBuilder);
	return operations;
}
