/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRenderOutput, CellOutputKind } from 'vs/workbench/services/notebook/common/notebookCommon';
import { registerOutputTransform } from 'vs/workbench/contrib/notebook/browser/notebookRegistry';
import * as DOM from 'vs/base/browser/dom';
import { INotebookEditor, IOutputTransformContribution } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { isArray } from 'vs/base/common/types';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { URI } from 'vs/base/common/uri';
import { MarkdownRenderer } from 'vs/workbench/contrib/notebook/browser/view/renderers/mdRenderer';

class RichRenderer implements IOutputTransformContribution {
	private _mdRenderer: MarkdownRenderer;
	private _richMimeTypeRenderers = new Map<string, (output: any, container: HTMLElement) => IRenderOutput>();

	constructor(
		public notebookEditor: INotebookEditor,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService
	) {
		this._mdRenderer = instantiationService.createInstance(MarkdownRenderer);
		this._richMimeTypeRenderers.set('application/json', this.renderJSON.bind(this));
		this._richMimeTypeRenderers.set('application/javascript', this.renderJavaScript.bind(this));
		this._richMimeTypeRenderers.set('text/html', this.renderHTML.bind(this));
		this._richMimeTypeRenderers.set('image/svg+xml', this.renderSVG.bind(this));
		this._richMimeTypeRenderers.set('text/markdown', this.renderMarkdown.bind(this));
		this._richMimeTypeRenderers.set('image/png', this.renderPNG.bind(this));
		this._richMimeTypeRenderers.set('image/jpeg', this.renderJavaScript.bind(this));
		this._richMimeTypeRenderers.set('text/plain', this.renderPlainText.bind(this));
		this._richMimeTypeRenderers.set('text/x-javascript', this.renderCode.bind(this));
	}

	render(output: any, container: HTMLElement, preferredMimeType: string | undefined): IRenderOutput {
		if (!output.data) {
			const contentNode = document.createElement('p');
			contentNode.innerText = `No data could be found for output.`;
			container.appendChild(contentNode);

			return {
				hasDynamicHeight: false
			};
		}

		if (!preferredMimeType || !this._richMimeTypeRenderers.has(preferredMimeType)) {
			const contentNode = document.createElement('p');
			let mimeTypes = [];
			for (const property in output.data) {
				mimeTypes.push(property);
			}

			let mimeTypesMessage = mimeTypes.join(', ');

			contentNode.innerText = `No renderer could be found for output. It has the following MIME types: ${mimeTypesMessage}`;
			container.appendChild(contentNode);

			return {
				hasDynamicHeight: false
			};
		}

		let renderer = this._richMimeTypeRenderers.get(preferredMimeType);
		return renderer!(output, container);
	}

	renderJSON(output: any, container: HTMLElement) {
		let data = output.data['application/json'];
		let str = JSON.stringify(data, null, '\t');

		const editor = this.instantiationService.createInstance(CodeEditorWidget, container, {
			...getOutputSimpleEditorOptions(),
			dimension: {
				width: 0,
				height: 0
			}
		}, {
			isSimpleWidget: true
		});

		let mode = this.modeService.create('json');
		let resource = URI.parse(`notebook-output-${Date.now()}.json`);
		const textModel = this.modelService.createModel(str, mode, resource, false);
		editor.setModel(textModel);

		let width = this.notebookEditor.getLayoutInfo().width;
		let fontInfo = this.notebookEditor.getLayoutInfo().fontInfo;
		let height = Math.min(textModel.getLineCount(), 16) * (fontInfo.lineHeight || 18);

		editor.layout({
			height,
			width
		});

		container.style.height = `${height + 16}px`;

		return {
			hasDynamicHeight: true
		};
	}

	renderCode(output: any, container: HTMLElement) {
		let data = output.data['text/x-javascript'];
		let str = isArray(data) ? data.join('') : data;

		const editor = this.instantiationService.createInstance(CodeEditorWidget, container, {
			...getOutputSimpleEditorOptions(),
			dimension: {
				width: 0,
				height: 0
			}
		}, {
			isSimpleWidget: true
		});

		let mode = this.modeService.create('javascript');
		let resource = URI.parse(`notebook-output-${Date.now()}.js`);
		const textModel = this.modelService.createModel(str, mode, resource, false);
		editor.setModel(textModel);

		let width = this.notebookEditor.getLayoutInfo().width;
		let fontInfo = this.notebookEditor.getLayoutInfo().fontInfo;
		let height = Math.min(textModel.getLineCount(), 16) * (fontInfo.lineHeight || 18);

		editor.layout({
			height,
			width
		});

		container.style.height = `${height + 16}px`;

		return {
			hasDynamicHeight: true
		};
	}

	renderJavaScript(output: any, container: HTMLElement) {
		let data = output.data['application/javascript'];
		let str = isArray(data) ? data.join('') : data;
		let scriptVal = `<script type="application/javascript">${str}</script>`;
		return {
			shadowContent: scriptVal,
			hasDynamicHeight: false
		};
	}

	renderHTML(output: any, container: HTMLElement) {
		let data = output.data['text/html'];
		let str = isArray(data) ? data.join('') : data;
		return {
			shadowContent: str,
			hasDynamicHeight: false
		};

	}

	renderSVG(output: any, container: HTMLElement) {
		let data = output.data['image/svg+xml'];
		let str = isArray(data) ? data.join('') : data;
		return {
			shadowContent: str,
			hasDynamicHeight: false
		};
	}

	renderMarkdown(output: any, container: HTMLElement) {
		let data = output.data['text/markdown'];
		const str = isArray(data) ? data.join('') : data;
		const mdOutput = document.createElement('div');
		mdOutput.appendChild(this._mdRenderer.render({ value: str, isTrusted: false, supportThemeIcons: true }).element);
		container.appendChild(mdOutput);

		return {
			hasDynamicHeight: true
		};
	}

	renderPNG(output: any, container: HTMLElement) {
		const image = document.createElement('img');
		image.src = `data:image/png;base64,${output.data['image/png']}`;
		const display = document.createElement('div');
		DOM.addClasses(display, 'display');
		display.appendChild(image);
		container.appendChild(display);
		return {
			hasDynamicHeight: true
		};

	}

	renderJPEG(output: any, container: HTMLElement) {
		const image = document.createElement('img');
		image.src = `data:image/jpeg;base64,${output.data['image/jpeg']}`;
		const display = document.createElement('div');
		DOM.addClasses(display, 'display');
		display.appendChild(image);
		container.appendChild(display);
		return {
			hasDynamicHeight: true
		};
	}

	renderPlainText(output: any, container: HTMLElement) {
		let data = output.data['text/plain'];
		let str = isArray(data) ? data.join('') : data;
		const contentNode = document.createElement('p');
		contentNode.innerText = str;
		container.appendChild(contentNode);

		return {
			hasDynamicHeight: false
		};
	}

	dispose(): void {
	}
}

registerOutputTransform('notebook.output.rich', CellOutputKind.Rich, RichRenderer);


export function getOutputSimpleEditorOptions(): IEditorOptions {
	return {
		readOnly: true,
		wordWrap: 'on',
		overviewRulerLanes: 0,
		glyphMargin: false,
		selectOnLineNumbers: false,
		hideCursorInOverviewRuler: true,
		selectionHighlight: false,
		lineDecorationsWidth: 0,
		overviewRulerBorder: false,
		scrollBeyondLastLine: false,
		renderLineHighlight: 'none',
		minimap: {
			enabled: false
		},
		lineNumbers: 'off',
		scrollbar: {
			alwaysConsumeMouseWheel: false
		}
	};
}
