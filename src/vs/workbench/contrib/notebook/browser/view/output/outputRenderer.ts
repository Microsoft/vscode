/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { OutputRendererRegistry } from 'vs/workbench/contrib/notebook/browser/view/output/rendererRegistry';
import { onUnexpectedError } from 'vs/base/common/errors';
import { ICellOutputViewModel, ICommonNotebookEditor, IOutputTransformContribution, IRenderOutput, RenderOutputType } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { URI } from 'vs/base/common/uri';
import { dispose } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';

export class OutputRenderer {

	private readonly _richMimeTypeRenderers = new Map<string, IOutputTransformContribution>();

	constructor(
		private readonly notebookEditor: ICommonNotebookEditor,
		private readonly instantiationService: IInstantiationService
	) {
	}
	dispose(): void {
		dispose(this._richMimeTypeRenderers.values());
		this._richMimeTypeRenderers.clear();
	}

	getContribution(preferredMimeType: string): IOutputTransformContribution | undefined {
		this._initialize();
		return this._richMimeTypeRenderers.get(preferredMimeType);
	}

	private _initialize() {
		if (this._richMimeTypeRenderers.size) {
			return;
		}
		for (const desc of OutputRendererRegistry.getOutputTransformContributions()) {
			try {
				const contribution = this.instantiationService.createInstance(desc.ctor, this.notebookEditor);
				contribution.getMimetypes().forEach(mimetype => { this._richMimeTypeRenderers.set(mimetype, contribution); });
			} catch (err) {
				onUnexpectedError(err);
			}
		}
	}

	private _renderMessage(container: HTMLElement, message: string): IRenderOutput {
		const contentNode = document.createElement('p');
		contentNode.innerText = message;
		container.appendChild(contentNode);
		return { type: RenderOutputType.Mainframe };
	}

	render(viewModel: ICellOutputViewModel, container: HTMLElement, preferredMimeType: string | undefined, notebookUri: URI): IRenderOutput {
		this._initialize();
		if (!viewModel.model.outputs.length) {
			return this._renderMessage(container, localize('empty', "Cell has no output"));
		}
		if (!preferredMimeType) {
			const mimeTypes = viewModel.model.outputs.map(op => op.mime);
			const mimeTypesMessage = mimeTypes.join(', ');
			return this._renderMessage(container, localize('noRenderer.2', "No renderer could be found for output. It has the following MIME types: {0}", mimeTypesMessage));
		}
		if (!preferredMimeType || !this._richMimeTypeRenderers.has(preferredMimeType)) {
			if (preferredMimeType) {
				return this._renderMessage(container, localize('noRenderer.1', "No renderer could be found for MIME type: {0}", preferredMimeType));
			}
		}
		const renderer = this._richMimeTypeRenderers.get(preferredMimeType);
		if (!renderer) {
			return this._renderMessage(container, localize('noRenderer.1', "No renderer could be found for MIME type: {0}", preferredMimeType));
		}
		const first = viewModel.model.outputs.find(op => op.mime === preferredMimeType);
		if (!first) {
			return this._renderMessage(container, localize('empty', "Cell has no output"));
		}

		return renderer.render(viewModel, first, container, notebookUri);
	}
}
