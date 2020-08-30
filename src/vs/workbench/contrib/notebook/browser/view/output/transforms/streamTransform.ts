/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { IRenderOutput, CellOutputKind, IStreamOutput, RenderOutputType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookRegistry } from 'vs/workbench/contrib/notebook/browser/notebookRegistry';
import { INotebookEditor, IOutputTransformContribution } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';

class StreamRenderer implements IOutputTransformContribution {
	constructor(
		editor: INotebookEditor
	) {
	}

	render(output: IStreamOutput, container: HTMLElement): IRenderOutput {
		const contentNode = DOM.$('.output-stream');
		contentNode.innerText = output.text;
		container.appendChild(contentNode);
		return { type: RenderOutputType.None, hasDynamicHeight: false };
	}

	dispose(): void {
	}
}

NotebookRegistry.registerOutputTransform('notebook.output.stream', CellOutputKind.Text, StreamRenderer);
