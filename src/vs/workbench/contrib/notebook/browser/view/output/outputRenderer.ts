/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IOutput, IRenderOutput } from 'vs/workbench/services/notebook/common/notebookCommon';
import { NotebookRegistry } from 'vs/workbench/contrib/notebook/browser/notebookRegistry';
import { onUnexpectedError } from 'vs/base/common/errors';
import { INotebookEditor, IOutputTransformContribution } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';

export class OutputRenderer {
	protected readonly _contributions: { [key: string]: IOutputTransformContribution; };
	protected readonly _mimeTypeMapping: { [key: number]: IOutputTransformContribution; };

	constructor(
		notebookEditor: INotebookEditor,
		private readonly instantiationService: IInstantiationService
	) {
		this._contributions = {};
		this._mimeTypeMapping = {};

		let contributions = NotebookRegistry.getOutputTransformContributions();

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

	renderNoop(output: IOutput, container: HTMLElement): IRenderOutput {
		const contentNode = document.createElement('p');

		contentNode.innerText = `No renderer could be found for output. It has the following output type: ${output.outputKind}`;
		container.appendChild(contentNode);
		return {
			hasDynamicHeight: false
		};
	}

	render(output: IOutput, container: HTMLElement, preferredMimeType: string | undefined): IRenderOutput {
		let transform = this._mimeTypeMapping[output.outputKind];

		if (transform) {
			return transform.render(output, container, preferredMimeType);
		} else {
			return this.renderNoop(output, container);
		}
	}
}
