/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRenderOutput, CellOutputKind } from 'vs/workbench/services/notebook/common/notebookCommon';
import { registerOutputTransform } from 'vs/workbench/contrib/notebook/browser/notebookRegistry';
import { INotebookEditor, IOutputTransformContribution } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';

class StreamRenderer implements IOutputTransformContribution {
	constructor(
		editor: INotebookEditor
	) {
	}

	render(output: any, container: HTMLElement): IRenderOutput {
		const contentNode = document.createElement('p');
		contentNode.innerText = output.text;
		container.appendChild(contentNode);
		return {
			hasDynamicHeight: false
		};

	}

	dispose(): void {
	}
}

registerOutputTransform('notebook.output.stream', CellOutputKind.Text, StreamRenderer);
