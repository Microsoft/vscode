/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITextModel, IModelDecoration } from 'vs/editor/common/model';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IMarker } from 'vs/platform/markers/common/markers';
import { Event } from 'vs/base/common/event';
import { Range } from 'vs/editor/common/core/range';

export const IMarkerDecorationsService = createDecorator<IMarkerDecorationsService>('markerDecorationsService');

export interface IMarkerDecorationsService {
	readonly _serviceBrand: undefined;

	onDidChangeMarker: Event<ITextModel>;

	getMarker(model: ITextModel, decoration: IModelDecoration): IMarker | null;

	getLiveMarkers(model: ITextModel): [Range, IMarker][];
}
