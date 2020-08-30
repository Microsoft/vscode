/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IProcessedOutput, IRenderOutput, RenderOutputType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookRegistry } from 'vs/workbench/contrib/notebook/browser/notebookRegistry';
import { onUnexpectedError } from 'vs/base/common/errors';
import { INotebookEditor, IOutputTransformContribution } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { URI } from 'vs/base/common/uri';

export class OutputRenderer {
	protected readonly _contributions: { [key: string]: IOutputTransformContribution; };
	protected readonly _mimeTypeMapping: { [key: number]: IOutputTransformContribution; };

	constructor(
		notebookEditor: INotebookEditor,
		private readonly instantiationService: IInstantiationService
	) {
		this._contributions = {};
		this._mimeTypeMapping = {};

		const contributions = NotebookRegistry.getOutputTransformContributions();

		for (const desc of contributions) {
			try {
				const contribution = this.instantiationService.createInstance(desc.ctor, notebookEditor);
				this._contributions[desc.id] = contribution;
				this._mimeTypeMapping[desc.kind] = contribution;
			} catch (err) {
				onUnexpectedError(err);
			}
		}
	}

	renderNoop(output: IProcessedOutput, container: HTMLElement): IRenderOutput {
		const contentNode = document.createElement('p');

		contentNode.innerText = `No renderer could be found for output. It has the following output type: ${output.outputKind}`;
		container.appendChild(contentNode);
		return { type: RenderOutputType.None, hasDynamicHeight: false };
	}

	render(output: IProcessedOutput, container: HTMLElement, preferredMimeType: string | undefined, notebookUri: URI | undefined): IRenderOutput {
		const transform = this._mimeTypeMapping[output.outputKind];

		if (transform) {
			return transform.render(output, container, preferredMimeType, notebookUri);
		} else {
			return this.renderNoop(output, container);
		}
	}
}
