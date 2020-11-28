/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import * as network from 'vs/base/common/network';
import { Disposable } from 'vs/base/common/lifecycle';
import { IReplaceService } from 'vs/workbench/contrib/search/common/replace';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { Match, FileMatch, FileMatchOrMatch, ISearchWorkbenchService } from 'vs/workbench/contrib/search/common/searchModel';
import { IProgress, IProgressStep } from 'vs/platform/progress/common/progress';
import { ITextModelService, ITextModelContentProvider } from 'vs/editor/common/services/resolverService';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { ScrollType } from 'vs/editor/common/editorCommon';
import { ITextModel, IIdentifiedSingleEditOperation } from 'vs/editor/common/model';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { createTextBufferFactoryFromSnapshot } from 'vs/editor/common/model/textModel';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IBulkEditService, ResourceTextEdit } from 'vs/editor/browser/services/bulkEditService';
import { Range } from 'vs/editor/common/core/range';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { mergeSort } from 'vs/base/common/arrays';
import { ILabelService } from 'vs/platform/label/common/label';
import { dirname } from 'vs/base/common/resources';

const REPLACE_PREVIEW = 'replacePreview';

const toReplaceResource = (fileResource: URI): URI => {
	return fileResource.with({ scheme: network.Schemas.internal, fragment: REPLACE_PREVIEW, query: JSON.stringify({ scheme: fileResource.scheme }) });
};

const toFileResource = (replaceResource: URI): URI => {
	return replaceResource.with({ scheme: JSON.parse(replaceResource.query)['scheme'], fragment: '', query: '' });
};

export class ReplacePreviewContentProvider implements ITextModelContentProvider, IWorkbenchContribution {

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITextModelService private readonly textModelResolverService: ITextModelService
	) {
		this.textModelResolverService.registerTextModelContentProvider(network.Schemas.internal, this);
	}

	provideTextContent(uri: URI): Promise<ITextModel> | null {
		if (uri.fragment === REPLACE_PREVIEW) {
			return this.instantiationService.createInstance(ReplacePreviewModel).resolve(uri);
		}
		return null;
	}
}

class ReplacePreviewModel extends Disposable {
	constructor(
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService,
		@ITextModelService private readonly textModelResolverService: ITextModelService,
		@IReplaceService private readonly replaceService: IReplaceService,
		@ISearchWorkbenchService private readonly searchWorkbenchService: ISearchWorkbenchService
	) {
		super();
	}

	async resolve(replacePreviewUri: URI): Promise<ITextModel> {
		const fileResource = toFileResource(replacePreviewUri);
		const fileMatch = <FileMatch>this.searchWorkbenchService.searchModel.searchResult.matches().filter(match => match.resource.toString() === fileResource.toString())[0];
		const ref = this._register(await this.textModelResolverService.createModelReference(fileResource));
		const sourceModel = ref.object.textEditorModel;
		const sourceModelModeId = sourceModel.getLanguageIdentifier().language;
		const replacePreviewModel = this.modelService.createModel(createTextBufferFactoryFromSnapshot(sourceModel.createSnapshot()), this.modeService.create(sourceModelModeId), replacePreviewUri);
		this._register(fileMatch.onChange(({ forceUpdateModel }) => this.update(sourceModel, replacePreviewModel, fileMatch, forceUpdateModel)));
		this._register(this.searchWorkbenchService.searchModel.onReplaceTermChanged(() => this.update(sourceModel, replacePreviewModel, fileMatch)));
		this._register(fileMatch.onDispose(() => replacePreviewModel.dispose())); // TODO@Sandeep we should not dispose a model directly but rather the reference (depends on https://github.com/microsoft/vscode/issues/17073)
		this._register(replacePreviewModel.onWillDispose(() => this.dispose()));
		this._register(sourceModel.onWillDispose(() => this.dispose()));
		return replacePreviewModel;
	}

	private update(sourceModel: ITextModel, replacePreviewModel: ITextModel, fileMatch: FileMatch, override: boolean = false): void {
		if (!sourceModel.isDisposed() && !replacePreviewModel.isDisposed()) {
			this.replaceService.updateReplacePreview(fileMatch, override);
		}
	}
}

export class ReplaceService implements IReplaceService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ITextFileService private readonly textFileService: ITextFileService,
		@IEditorService private readonly editorService: IEditorService,
		@ITextModelService private readonly textModelResolverService: ITextModelService,
		@IBulkEditService private readonly bulkEditorService: IBulkEditService,
		@ILabelService private readonly labelService: ILabelService
	) { }

	replace(match: Match): Promise<any>;
	replace(files: FileMatch[], progress?: IProgress<IProgressStep>): Promise<any>;
	replace(match: FileMatchOrMatch, progress?: IProgress<IProgressStep>, resource?: URI): Promise<any>;
	async replace(arg: any, progress: IProgress<IProgressStep> | undefined = undefined, resource: URI | null = null): Promise<any> {
		const edits = this.createEdits(arg, resource);
		await this.bulkEditorService.apply(edits, { progress });

		return Promise.all(edits.map(e => this.textFileService.files.get(e.resource)?.save()));
	}

	async openReplacePreview(element: FileMatchOrMatch, preserveFocus?: boolean, sideBySide?: boolean, pinned?: boolean): Promise<any> {
		const fileMatch = element instanceof Match ? element.parent() : element;

		const editor = await this.editorService.openEditor({
			leftResource: fileMatch.resource,
			rightResource: toReplaceResource(fileMatch.resource),
			label: nls.localize('fileReplaceChanges', "{0} ↔ {1} (Replace Preview)", fileMatch.name(), fileMatch.name()),
			description: this.labelService.getUriLabel(dirname(fileMatch.resource), { relative: true }),
			options: {
				preserveFocus,
				pinned,
				revealIfVisible: true
			}
		});
		const input = editor?.input;
		const disposable = fileMatch.onDispose(() => {
			if (input) {
				input.dispose();
			}
			disposable.dispose();
		});
		await this.updateReplacePreview(fileMatch);
		if (editor) {
			const editorControl = editor.getControl();
			if (element instanceof Match && editorControl) {
				editorControl.revealLineInCenter(element.range().startLineNumber, ScrollType.Immediate);
			}
		}
	}

	async updateReplacePreview(fileMatch: FileMatch, override: boolean = false): Promise<void> {
		const replacePreviewUri = toReplaceResource(fileMatch.resource);
		const [sourceModelRef, replaceModelRef] = await Promise.all([this.textModelResolverService.createModelReference(fileMatch.resource), this.textModelResolverService.createModelReference(replacePreviewUri)]);
		const sourceModel = sourceModelRef.object.textEditorModel;
		const replaceModel = replaceModelRef.object.textEditorModel;
		// If model is disposed do not update
		try {
			if (sourceModel && replaceModel) {
				if (override) {
					replaceModel.setValue(sourceModel.getValue());
				} else {
					replaceModel.undo();
				}
				this.applyEditsToPreview(fileMatch, replaceModel);
			}
		} finally {
			sourceModelRef.dispose();
			replaceModelRef.dispose();
		}
	}

	private applyEditsToPreview(fileMatch: FileMatch, replaceModel: ITextModel): void {
		const resourceEdits = this.createEdits(fileMatch, replaceModel.uri);
		const modelEdits: IIdentifiedSingleEditOperation[] = [];
		for (const resourceEdit of resourceEdits) {
			modelEdits.push(EditOperation.replaceMove(
				Range.lift(resourceEdit.textEdit.range),
				resourceEdit.textEdit.text)
			);
		}
		replaceModel.pushEditOperations([], mergeSort(modelEdits, (a, b) => Range.compareRangesUsingStarts(a.range, b.range)), () => []);
	}

	private createEdits(arg: FileMatchOrMatch | FileMatch[], resource: URI | null = null): ResourceTextEdit[] {
		const edits: ResourceTextEdit[] = [];

		if (arg instanceof Match) {
			const match = <Match>arg;
			edits.push(this.createEdit(match, match.replaceString, resource));
		}

		if (arg instanceof FileMatch) {
			arg = [arg];
		}

		if (arg instanceof Array) {
			arg.forEach(element => {
				const fileMatch = <FileMatch>element;
				if (fileMatch.count() > 0) {
					edits.push(...fileMatch.matches().map(match => this.createEdit(match, match.replaceString, resource)));
				}
			});
		}

		return edits;
	}

	private createEdit(match: Match, text: string, resource: URI | null = null): ResourceTextEdit {
		const fileMatch: FileMatch = match.parent();
		return new ResourceTextEdit(
			resource ?? fileMatch.resource,
			{ range: match.range(), text }, undefined, undefined
		);
	}
}
