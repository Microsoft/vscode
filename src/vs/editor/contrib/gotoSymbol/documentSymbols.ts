/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { Range } from 'vs/editor/common/core/range';
import { ITextModel } from 'vs/editor/common/model';
import { DocumentSymbol } from 'vs/editor/common/modes';
import { IModelService } from 'vs/editor/common/services/modelService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { OutlineModel, OutlineElement } from 'vs/editor/contrib/documentSymbols/outlineModel';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { assertType } from 'vs/base/common/types';
import { Iterable } from 'vs/base/common/iterator';

export async function getDocumentSymbols(document: ITextModel, flat: boolean, token: CancellationToken): Promise<DocumentSymbol[]> {

	const model = await OutlineModel.create(document, token);
	const roots: DocumentSymbol[] = [];
	for (const child of model.children.values()) {
		if (child instanceof OutlineElement) {
			roots.push(child.symbol);
		} else {
			roots.push(...Iterable.map(child.children.values(), child => child.symbol));
		}
	}

	let flatEntries: DocumentSymbol[] = [];
	if (token.isCancellationRequested) {
		return flatEntries;
	}
	if (flat) {
		flatten(flatEntries, roots, '');
	} else {
		flatEntries = roots;
	}

	return flatEntries.sort(compareEntriesUsingStart);
}

function compareEntriesUsingStart(a: DocumentSymbol, b: DocumentSymbol): number {
	return Range.compareRangesUsingStarts(a.range, b.range);
}

function flatten(bucket: DocumentSymbol[], entries: DocumentSymbol[], overrideContainerLabel: string): void {
	for (let entry of entries) {
		bucket.push({
			kind: entry.kind,
			tags: entry.tags,
			name: entry.name,
			detail: entry.detail,
			containerName: entry.containerName || overrideContainerLabel,
			range: entry.range,
			selectionRange: entry.selectionRange,
			children: undefined, // we flatten it...
		});
		if (entry.children) {
			flatten(bucket, entry.children, entry.name);
		}
	}
}

CommandsRegistry.registerCommand('_executeDocumentSymbolProvider', async function (accessor, ...args) {
	const [resource] = args;
	assertType(URI.isUri(resource));

	const model = accessor.get(IModelService).getModel(resource);
	if (model) {
		return getDocumentSymbols(model, false, CancellationToken.None);
	}

	const reference = await accessor.get(ITextModelService).createModelReference(resource);
	try {
		return await getDocumentSymbols(reference.object.textEditorModel, false, CancellationToken.None);
	} finally {
		reference.dispose();
	}
});
