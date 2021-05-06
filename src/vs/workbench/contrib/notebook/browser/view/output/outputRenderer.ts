/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { NotebookRegistry } from 'vs/workbench/contrib/notebook/browser/notebookRegistry';
import { onUnexpectedError } from 'vs/base/common/errors';
import { ICellOutputViewModel, ICommonNotebookEditor, IOutputTransformContribution, IRenderOutput, RenderOutputType } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { URI } from 'vs/base/common/uri';

export class OutputRenderer {
	protected readonly _contributions: { [key: string]: IOutputTransformContribution; };
	protected readonly _renderers: IOutputTransformContribution[];
	private _richMimeTypeRenderers = new Map<string, IOutputTransformContribution>();

	constructor(
		notebookEditor: ICommonNotebookEditor,
		private readonly instantiationService: IInstantiationService
	) {
		this._contributions = {};
		this._renderers = [];

		const contributions = NotebookRegistry.getOutputTransformContributions();

		for (const desc of contributions) {
			try {
				const contribution = this.instantiationService.createInstance(desc.ctor, notebookEditor);
				this._contributions[desc.id] = contribution;
				contribution.getMimetypes().forEach(mimetype => {
					this._richMimeTypeRenderers.set(mimetype, contribution);
				});
			} catch (err) {
				onUnexpectedError(err);
			}
		}
	}

	getContribution(preferredMimeType: string | undefined): IOutputTransformContribution | undefined {
		if (preferredMimeType) {
			return this._richMimeTypeRenderers.get(preferredMimeType);
		}

		return undefined;
	}

	renderNoop(viewModel: ICellOutputViewModel, container: HTMLElement): IRenderOutput {
		const contentNode = document.createElement('p');

		contentNode.innerText = `No renderer could be found for output.`;
		container.appendChild(contentNode);
		return { type: RenderOutputType.Mainframe };
	}

	render(viewModel: ICellOutputViewModel, container: HTMLElement, preferredMimeType: string | undefined, notebookUri: URI | undefined): IRenderOutput {
		if (!viewModel.model.outputs.length) {
			return this.renderNoop(viewModel, container);
		}

		if (!preferredMimeType || !this._richMimeTypeRenderers.has(preferredMimeType)) {
			const contentNode = document.createElement('p');
			const mimeTypes = viewModel.model.outputs.map(op => op.mime);

			const mimeTypesMessage = mimeTypes.join(', ');

			if (preferredMimeType) {
				contentNode.innerText = `No renderer could be found for MIME type: ${preferredMimeType}`;
			} else {
				contentNode.innerText = `No renderer could be found for output. It has the following MIME types: ${mimeTypesMessage}`;
			}

			container.appendChild(contentNode);
			return { type: RenderOutputType.Mainframe };
		}

		const renderer = this._richMimeTypeRenderers.get(preferredMimeType);
		const items = viewModel.model.outputs.filter(op => op.mime === preferredMimeType);

		if (items.length && renderer) {
			return renderer.render(viewModel, items, container, notebookUri);
		} else {
			return this.renderNoop(viewModel, container);
		}
	}
}
