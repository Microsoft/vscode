/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { alert } from 'vs/base/browser/ui/aria/aria';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { illegalArgument, onUnexpectedExternalError } from 'vs/base/common/errors';
import { URI } from 'vs/base/common/uri';
import { CodeEditorStateFlag, EditorStateCancellationTokenSource, TextModelCancellationTokenSource } from 'vs/editor/browser/core/editorState';
import { IActiveCodeEditor, isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ScrollType } from 'vs/editor/common/editorCommon';
import { ISingleEditOperation, ITextModel } from 'vs/editor/common/model';
import { DocumentFormattingEditProvider, DocumentFormattingEditProviderRegistry, DocumentRangeFormattingEditProvider, DocumentRangeFormattingEditProviderRegistry, FormattingOptions, OnTypeFormattingEditProviderRegistry, TextEdit } from 'vs/editor/common/modes';
import { IEditorWorkerService } from 'vs/editor/common/services/editorWorkerService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { FormattingEdit } from 'vs/editor/contrib/format/formattingEdit';
import * as nls from 'vs/nls';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IDisposable } from 'vs/base/common/lifecycle';
import { LinkedList } from 'vs/base/common/linkedList';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { assertType } from 'vs/base/common/types';
import { IProgress } from 'vs/platform/progress/common/progress';
import { Iterable } from 'vs/base/common/iterator';

export function alertFormattingEdits(edits: ISingleEditOperation[]): void {

	edits = edits.filter(edit => edit.range);
	if (!edits.length) {
		return;
	}

	let { range } = edits[0];
	for (let i = 1; i < edits.length; i++) {
		range = Range.plusRange(range, edits[i].range);
	}
	const { startLineNumber, endLineNumber } = range;
	if (startLineNumber === endLineNumber) {
		if (edits.length === 1) {
			alert(nls.localize('hint11', "Made 1 formatting edit on line {0}", startLineNumber));
		} else {
			alert(nls.localize('hintn1', "Made {0} formatting edits on line {1}", edits.length, startLineNumber));
		}
	} else {
		if (edits.length === 1) {
			alert(nls.localize('hint1n', "Made 1 formatting edit between lines {0} and {1}", startLineNumber, endLineNumber));
		} else {
			alert(nls.localize('hintnn', "Made {0} formatting edits between lines {1} and {2}", edits.length, startLineNumber, endLineNumber));
		}
	}
}

export function getRealAndSyntheticDocumentFormattersOrdered(model: ITextModel): DocumentFormattingEditProvider[] {
	const result: DocumentFormattingEditProvider[] = [];
	const seen = new Set<string>();

	// (1) add all document formatter
	const docFormatter = DocumentFormattingEditProviderRegistry.ordered(model);
	for (const formatter of docFormatter) {
		result.push(formatter);
		if (formatter.extensionId) {
			seen.add(ExtensionIdentifier.toKey(formatter.extensionId));
		}
	}

	// (2) add all range formatter as document formatter (unless the same extension already did that)
	const rangeFormatter = DocumentRangeFormattingEditProviderRegistry.ordered(model);
	for (const formatter of rangeFormatter) {
		if (formatter.extensionId) {
			if (seen.has(ExtensionIdentifier.toKey(formatter.extensionId))) {
				continue;
			}
			seen.add(ExtensionIdentifier.toKey(formatter.extensionId));
		}
		result.push({
			displayName: formatter.displayName,
			extensionId: formatter.extensionId,
			provideDocumentFormattingEdits(model, options, token) {
				return formatter.provideDocumentRangeFormattingEdits(model, model.getFullModelRange(), options, token);
			}
		});
	}
	return result;
}

export const enum FormattingMode {
	Explicit = 1,
	Silent = 2
}

export interface IFormattingEditProviderSelector {
	<T extends (DocumentFormattingEditProvider | DocumentRangeFormattingEditProvider)>(formatter: T[], document: ITextModel, mode: FormattingMode): Promise<T | undefined>;
}

export abstract class FormattingConflicts {

	private static readonly _selectors = new LinkedList<IFormattingEditProviderSelector>();

	static setFormatterSelector(selector: IFormattingEditProviderSelector): IDisposable {
		const remove = FormattingConflicts._selectors.unshift(selector);
		return { dispose: remove };
	}

	static async select<T extends (DocumentFormattingEditProvider | DocumentRangeFormattingEditProvider)>(formatter: T[], document: ITextModel, mode: FormattingMode): Promise<T | undefined> {
		if (formatter.length === 0) {
			return undefined;
		}
		const selector = Iterable.first(FormattingConflicts._selectors);
		if (selector) {
			return await selector(formatter, document, mode);
		}
		return formatter[0];
	}
}

export async function formatDocumentRangeWithSelectedProvider(
	accessor: ServicesAccessor,
	editorOrModel: ITextModel | IActiveCodeEditor,
	range: Range,
	mode: FormattingMode,
	token: CancellationToken
): Promise<void> {

	const instaService = accessor.get(IInstantiationService);
	const model = isCodeEditor(editorOrModel) ? editorOrModel.getModel() : editorOrModel;
	const provider = DocumentRangeFormattingEditProviderRegistry.ordered(model);
	const selected = await FormattingConflicts.select(provider, model, mode);
	if (selected) {
		await instaService.invokeFunction(formatDocumentRangeWithProvider, selected, editorOrModel, range, token);
	}
}

export async function formatDocumentRangeWithProvider(
	accessor: ServicesAccessor,
	provider: DocumentRangeFormattingEditProvider,
	editorOrModel: ITextModel | IActiveCodeEditor,
	range: Range,
	token: CancellationToken
): Promise<boolean> {
	const workerService = accessor.get(IEditorWorkerService);

	let model: ITextModel;
	let cts: CancellationTokenSource;
	if (isCodeEditor(editorOrModel)) {
		model = editorOrModel.getModel();
		cts = new EditorStateCancellationTokenSource(editorOrModel, CodeEditorStateFlag.Value | CodeEditorStateFlag.Position, undefined, token);
	} else {
		model = editorOrModel;
		cts = new TextModelCancellationTokenSource(editorOrModel, token);
	}

	let edits: TextEdit[] | undefined;
	try {
		const rawEdits = await provider.provideDocumentRangeFormattingEdits(
			model,
			range,
			model.getFormattingOptions(),
			cts.token
		);
		edits = await workerService.computeMoreMinimalEdits(model.uri, rawEdits);

		if (cts.token.isCancellationRequested) {
			return true;
		}

	} finally {
		cts.dispose();
	}

	if (!edits || edits.length === 0) {
		return false;
	}

	if (isCodeEditor(editorOrModel)) {
		// use editor to apply edits
		FormattingEdit.execute(editorOrModel, edits, true);
		alertFormattingEdits(edits);
		editorOrModel.revealPositionInCenterIfOutsideViewport(editorOrModel.getPosition(), ScrollType.Immediate);

	} else {
		// use model to apply edits
		const [{ range }] = edits;
		const initialSelection = new Selection(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn);
		model.pushEditOperations([initialSelection], edits.map(edit => {
			return {
				text: edit.text,
				range: Range.lift(edit.range),
				forceMoveMarkers: true
			};
		}), undoEdits => {
			for (const { range } of undoEdits) {
				if (Range.areIntersectingOrTouching(range, initialSelection)) {
					return [new Selection(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn)];
				}
			}
			return null;
		});
	}

	return true;
}

export async function formatDocumentWithSelectedProvider(
	accessor: ServicesAccessor,
	editorOrModel: ITextModel | IActiveCodeEditor,
	mode: FormattingMode,
	progress: IProgress<DocumentFormattingEditProvider>,
	token: CancellationToken
): Promise<void> {

	const instaService = accessor.get(IInstantiationService);
	const model = isCodeEditor(editorOrModel) ? editorOrModel.getModel() : editorOrModel;
	const provider = getRealAndSyntheticDocumentFormattersOrdered(model);
	const selected = await FormattingConflicts.select(provider, model, mode);
	if (selected) {
		progress.report(selected);
		await instaService.invokeFunction(formatDocumentWithProvider, selected, editorOrModel, mode, token);
	}
}

export async function formatDocumentWithProvider(
	accessor: ServicesAccessor,
	provider: DocumentFormattingEditProvider,
	editorOrModel: ITextModel | IActiveCodeEditor,
	mode: FormattingMode,
	token: CancellationToken
): Promise<boolean> {
	const workerService = accessor.get(IEditorWorkerService);

	let model: ITextModel;
	let cts: CancellationTokenSource;
	if (isCodeEditor(editorOrModel)) {
		model = editorOrModel.getModel();
		cts = new EditorStateCancellationTokenSource(editorOrModel, CodeEditorStateFlag.Value | CodeEditorStateFlag.Position, undefined, token);
	} else {
		model = editorOrModel;
		cts = new TextModelCancellationTokenSource(editorOrModel, token);
	}

	let edits: TextEdit[] | undefined;
	try {
		const rawEdits = await provider.provideDocumentFormattingEdits(
			model,
			model.getFormattingOptions(),
			cts.token
		);

		edits = await workerService.computeMoreMinimalEdits(model.uri, rawEdits);

		if (cts.token.isCancellationRequested) {
			return true;
		}

	} finally {
		cts.dispose();
	}

	if (!edits || edits.length === 0) {
		return false;
	}

	if (isCodeEditor(editorOrModel)) {
		// use editor to apply edits
		FormattingEdit.execute(editorOrModel, edits, mode !== FormattingMode.Silent);

		if (mode !== FormattingMode.Silent) {
			alertFormattingEdits(edits);
			editorOrModel.revealPositionInCenterIfOutsideViewport(editorOrModel.getPosition(), ScrollType.Immediate);
		}

	} else {
		// use model to apply edits
		const [{ range }] = edits;
		const initialSelection = new Selection(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn);
		model.pushEditOperations([initialSelection], edits.map(edit => {
			return {
				text: edit.text,
				range: Range.lift(edit.range),
				forceMoveMarkers: true
			};
		}), undoEdits => {
			for (const { range } of undoEdits) {
				if (Range.areIntersectingOrTouching(range, initialSelection)) {
					return [new Selection(range.startLineNumber, range.startColumn, range.endLineNumber, range.endColumn)];
				}
			}
			return null;
		});
	}

	return true;
}

export async function getDocumentRangeFormattingEditsUntilResult(
	workerService: IEditorWorkerService,
	model: ITextModel,
	range: Range,
	options: FormattingOptions,
	token: CancellationToken
): Promise<TextEdit[] | undefined> {

	const providers = DocumentRangeFormattingEditProviderRegistry.ordered(model);
	for (const provider of providers) {
		let rawEdits = await Promise.resolve(provider.provideDocumentRangeFormattingEdits(model, range, options, token)).catch(onUnexpectedExternalError);
		if (isNonEmptyArray(rawEdits)) {
			return await workerService.computeMoreMinimalEdits(model.uri, rawEdits);
		}
	}
	return undefined;
}

export async function getDocumentFormattingEditsUntilResult(
	workerService: IEditorWorkerService,
	model: ITextModel,
	options: FormattingOptions,
	token: CancellationToken
): Promise<TextEdit[] | undefined> {

	const providers = getRealAndSyntheticDocumentFormattersOrdered(model);
	for (const provider of providers) {
		let rawEdits = await Promise.resolve(provider.provideDocumentFormattingEdits(model, options, token)).catch(onUnexpectedExternalError);
		if (isNonEmptyArray(rawEdits)) {
			return await workerService.computeMoreMinimalEdits(model.uri, rawEdits);
		}
	}
	return undefined;
}

export function getOnTypeFormattingEdits(
	workerService: IEditorWorkerService,
	model: ITextModel,
	position: Position,
	ch: string,
	options: FormattingOptions
): Promise<TextEdit[] | null | undefined> {

	const providers = OnTypeFormattingEditProviderRegistry.ordered(model);

	if (providers.length === 0) {
		return Promise.resolve(undefined);
	}

	if (providers[0].autoFormatTriggerCharacters.indexOf(ch) < 0) {
		return Promise.resolve(undefined);
	}

	return Promise.resolve(providers[0].provideOnTypeFormattingEdits(model, position, ch, options, CancellationToken.None)).catch(onUnexpectedExternalError).then(edits => {
		return workerService.computeMoreMinimalEdits(model.uri, edits);
	});
}

CommandsRegistry.registerCommand('_executeFormatRangeProvider', function (accessor, ...args) {
	const [resource, range, options] = args;
	assertType(URI.isUri(resource));
	assertType(Range.isIRange(range));

	const model = accessor.get(IModelService).getModel(resource);
	if (!model) {
		throw illegalArgument('resource');
	}
	return getDocumentRangeFormattingEditsUntilResult(accessor.get(IEditorWorkerService), model, Range.lift(range), options, CancellationToken.None);
});

CommandsRegistry.registerCommand('_executeFormatDocumentProvider', function (accessor, ...args) {
	const [resource, options] = args;
	assertType(URI.isUri(resource));

	const model = accessor.get(IModelService).getModel(resource);
	if (!model) {
		throw illegalArgument('resource');
	}

	return getDocumentFormattingEditsUntilResult(accessor.get(IEditorWorkerService), model, options, CancellationToken.None);
});

CommandsRegistry.registerCommand('_executeFormatOnTypeProvider', function (accessor, ...args) {
	const [resource, position, ch, options] = args;
	assertType(URI.isUri(resource));
	assertType(Position.isIPosition(position));
	assertType(typeof ch === 'string');

	const model = accessor.get(IModelService).getModel(resource);
	if (!model) {
		throw illegalArgument('resource');
	}

	return getOnTypeFormattingEdits(accessor.get(IEditorWorkerService), model, Position.lift(position), ch, options);
});
