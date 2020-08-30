/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Position } from 'vs/editor/common/core/position';
import { EndOfLinePreference, EndOfLineSequence, IIdentifiedSingleEditOperation } from 'vs/editor/common/model';
import { MirrorTextModel } from 'vs/editor/common/model/mirrorTextModel';
import { TextModel } from 'vs/editor/common/model/textModel';
import { IModelContentChangedEvent } from 'vs/editor/common/model/textModelEvents';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';

export function testApplyEditsWithSyncedModels(original: string[], edits: IIdentifiedSingleEditOperation[], expected: string[], inputEditsAreInvalid: boolean = false): void {
	let originalStr = original.join('\n');
	let expectedStr = expected.join('\n');

	assertSyncedModels(originalStr, (model, assertMirrorModels) => {
		// Apply edits & collect inverse edits
		let inverseEdits = model.applyEdits(edits, true);

		// Assert edits produced expected result
		assert.deepEqual(model.getValue(EndOfLinePreference.LF), expectedStr);

		assertMirrorModels();

		// Apply the inverse edits
		let inverseInverseEdits = model.applyEdits(inverseEdits, true);

		// Assert the inverse edits brought back model to original state
		assert.deepEqual(model.getValue(EndOfLinePreference.LF), originalStr);

		if (!inputEditsAreInvalid) {
			const simplifyEdit = (edit: IIdentifiedSingleEditOperation) => {
				return {
					identifier: edit.identifier,
					range: edit.range,
					text: edit.text,
					forceMoveMarkers: edit.forceMoveMarkers || false,
					isAutoWhitespaceEdit: edit.isAutoWhitespaceEdit || false
				};
			};
			// Assert the inverse of the inverse edits are the original edits
			assert.deepEqual(inverseInverseEdits.map(simplifyEdit), edits.map(simplifyEdit));
		}

		assertMirrorModels();
	});
}

const enum AssertDocumentLineMappingDirection {
	OffsetToPosition,
	PositionToOffset
}

function assertOneDirectionLineMapping(model: TextModel, direction: AssertDocumentLineMappingDirection, msg: string): void {
	let allText = model.getValue();

	let line = 1, column = 1, previousIsCarriageReturn = false;
	for (let offset = 0; offset <= allText.length; offset++) {
		// The position coordinate system cannot express the position between \r and \n
		let position = new Position(line, column + (previousIsCarriageReturn ? -1 : 0));

		if (direction === AssertDocumentLineMappingDirection.OffsetToPosition) {
			let actualPosition = model.getPositionAt(offset);
			assert.equal(actualPosition.toString(), position.toString(), msg + ' - getPositionAt mismatch for offset ' + offset);
		} else {
			// The position coordinate system cannot express the position between \r and \n
			let expectedOffset = offset + (previousIsCarriageReturn ? -1 : 0);
			let actualOffset = model.getOffsetAt(position);
			assert.equal(actualOffset, expectedOffset, msg + ' - getOffsetAt mismatch for position ' + position.toString());
		}

		if (allText.charAt(offset) === '\n') {
			line++;
			column = 1;
		} else {
			column++;
		}

		previousIsCarriageReturn = (allText.charAt(offset) === '\r');
	}
}

function assertLineMapping(model: TextModel, msg: string): void {
	assertOneDirectionLineMapping(model, AssertDocumentLineMappingDirection.PositionToOffset, msg);
	assertOneDirectionLineMapping(model, AssertDocumentLineMappingDirection.OffsetToPosition, msg);
}


export function assertSyncedModels(text: string, callback: (model: TextModel, assertMirrorModels: () => void) => void, setup: ((model: TextModel) => void) | null = null): void {
	let model = createTextModel(text, TextModel.DEFAULT_CREATION_OPTIONS, null);
	model.setEOL(EndOfLineSequence.LF);
	assertLineMapping(model, 'model');

	if (setup) {
		setup(model);
		assertLineMapping(model, 'model');
	}

	let mirrorModel2 = new MirrorTextModel(null!, model.getLinesContent(), model.getEOL(), model.getVersionId());
	let mirrorModel2PrevVersionId = model.getVersionId();

	model.onDidChangeContent((e: IModelContentChangedEvent) => {
		let versionId = e.versionId;
		if (versionId < mirrorModel2PrevVersionId) {
			console.warn('Model version id did not advance between edits (2)');
		}
		mirrorModel2PrevVersionId = versionId;
		mirrorModel2.onEvents(e);
	});

	let assertMirrorModels = () => {
		assertLineMapping(model, 'model');
		assert.equal(mirrorModel2.getText(), model.getValue(), 'mirror model 2 text OK');
		assert.equal(mirrorModel2.version, model.getVersionId(), 'mirror model 2 version OK');
	};

	callback(model, assertMirrorModels);

	model.dispose();
	mirrorModel2.dispose();
}
