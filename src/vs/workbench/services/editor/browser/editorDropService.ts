/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable } from 'vs/base/common/lifecycle';
import { IEditorDropTargetDelegate } from 'vs/workbench/browser/parts/editor/editorDropTarget';

export const IEditorDropService = createDecorator<IEditorDropService>('editorDropService');

export interface IEditorDropService {

	readonly _serviceBrand: undefined;

	/**
	 * Allows to register a drag and drop target for editors.
	 */
	createEditorDropTarget(container: HTMLElement, delegate: IEditorDropTargetDelegate): IDisposable;
}
