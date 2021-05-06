/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { EditorInput, EditorModel } from 'vs/workbench/common/editor';
import { URI } from 'vs/base/common/uri';
import { DisposableStore, IReference } from 'vs/base/common/lifecycle';
import { ITextEditorModel, ITextModelService } from 'vs/editor/common/services/resolverService';
import * as marked from 'vs/base/common/marked/marked';
import { Schemas } from 'vs/base/common/network';
import { isEqual } from 'vs/base/common/resources';
import { requireToContent } from 'vs/workbench/contrib/welcome/walkThrough/common/walkThroughContentProvider';
import { Dimension } from 'vs/base/browser/dom';

export class WalkThroughModel extends EditorModel {

	constructor(
		private mainRef: string,
		private snippetRefs: IReference<ITextEditorModel>[]
	) {
		super();
	}

	get main() {
		return this.mainRef;
	}

	get snippets() {
		return this.snippetRefs.map(snippet => snippet.object);
	}

	override dispose() {
		this.snippetRefs.forEach(ref => ref.dispose());
		super.dispose();
	}
}

export interface WalkThroughInputOptions {
	readonly typeId: string;
	readonly name: string;
	readonly description?: string;
	readonly resource: URI;
	readonly telemetryFrom: string;
	readonly onReady?: (container: HTMLElement, contentDisposables: DisposableStore) => void;
	readonly layout?: (dimension: Dimension) => void;
}

export class WalkThroughInput extends EditorInput {

	private promise: Promise<WalkThroughModel> | null = null;

	private maxTopScroll = 0;
	private maxBottomScroll = 0;

	get resource() { return this.options.resource; }

	constructor(
		private readonly options: WalkThroughInputOptions,
		@ITextModelService private readonly textModelResolverService: ITextModelService
	) {
		super();
	}

	override get typeId(): string {
		return this.options.typeId;
	}

	override getName(): string {
		return this.options.name;
	}

	override getDescription(): string {
		return this.options.description || '';
	}

	getTelemetryFrom(): string {
		return this.options.telemetryFrom;
	}

	override getTelemetryDescriptor(): { [key: string]: unknown; } {
		const descriptor = super.getTelemetryDescriptor();
		descriptor['target'] = this.getTelemetryFrom();
		/* __GDPR__FRAGMENT__
			"EditorTelemetryDescriptor" : {
				"target" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
			}
		*/
		return descriptor;
	}

	get onReady() {
		return this.options.onReady;
	}

	get layout() {
		return this.options.layout;
	}

	override resolve(): Promise<WalkThroughModel> {
		if (!this.promise) {
			this.promise = requireToContent(this.options.resource)
				.then(content => {
					if (this.resource.path.endsWith('.html')) {
						return new WalkThroughModel(content, []);
					}

					const snippets: Promise<IReference<ITextEditorModel>>[] = [];
					let i = 0;
					const renderer = new marked.Renderer();
					renderer.code = (code, lang) => {
						i++;
						const resource = this.options.resource.with({ scheme: Schemas.walkThroughSnippet, fragment: `${i}.${lang}` });
						snippets.push(this.textModelResolverService.createModelReference(resource));
						return `<div id="snippet-${resource.fragment}" class="walkThroughEditorContainer" ></div>`;
					};
					content = marked(content, { renderer });

					return Promise.all(snippets)
						.then(refs => new WalkThroughModel(content, refs));
				});
		}

		return this.promise;
	}

	override matches(otherInput: unknown): boolean {
		if (super.matches(otherInput) === true) {
			return true;
		}

		if (otherInput instanceof WalkThroughInput) {
			let otherResourceEditorInput = <WalkThroughInput>otherInput;

			// Compare by properties
			return isEqual(otherResourceEditorInput.options.resource, this.options.resource);
		}

		return false;
	}

	override dispose(): void {
		if (this.promise) {
			this.promise.then(model => model.dispose());
			this.promise = null;
		}

		super.dispose();
	}

	public relativeScrollPosition(topScroll: number, bottomScroll: number) {
		this.maxTopScroll = Math.max(this.maxTopScroll, topScroll);
		this.maxBottomScroll = Math.max(this.maxBottomScroll, bottomScroll);
	}
}
