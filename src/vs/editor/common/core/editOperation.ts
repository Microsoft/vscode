/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { IIdentifiedSingleEditOperation } from 'vs/editor/common/model';

export class EditOperation {

	public static insert(position: Position, text: string): IIdentifiedSingleEditOperation {
		return {
			range: new Range(position.lineNumber, position.column, position.lineNumber, position.column),
			text: text,
			forceMoveMarkers: true
		};
	}

	public static delete(range: Range): IIdentifiedSingleEditOperation {
		return {
			range: range,
			text: null
		};
	}

	public static replace(range: Range, text: string | null): IIdentifiedSingleEditOperation {
		return {
			range: range,
			text: text
		};
	}

	public static replaceMove(range: Range, text: string | null): IIdentifiedSingleEditOperation {
		return {
			range: range,
			text: text,
			forceMoveMarkers: true
		};
	}
}
