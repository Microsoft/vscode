/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from 'vs/base/common/errors';
import { IDisposable } from 'vs/base/common/lifecycle';
import { ISearchConfiguration, ISearchConfigurationProperties } from 'vs/workbench/services/search/common/search';
import { SymbolKind, Location, ProviderResult, SymbolTag } from 'vs/editor/common/modes';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { URI } from 'vs/base/common/uri';
import { toResource, SideBySideEditor } from 'vs/workbench/common/editor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IFileService } from 'vs/platform/files/common/files';
import { IRange } from 'vs/editor/common/core/range';
import { isNumber } from 'vs/base/common/types';

export interface IWorkspaceSymbol {
	name: string;
	containerName?: string;
	kind: SymbolKind;
	tags?: SymbolTag[];
	location: Location;
}

export interface IWorkspaceSymbolProvider {
	provideWorkspaceSymbols(search: string, token: CancellationToken): ProviderResult<IWorkspaceSymbol[]>;
	resolveWorkspaceSymbol?(item: IWorkspaceSymbol, token: CancellationToken): ProviderResult<IWorkspaceSymbol>;
}

export namespace WorkspaceSymbolProviderRegistry {

	const _supports: IWorkspaceSymbolProvider[] = [];

	export function register(provider: IWorkspaceSymbolProvider): IDisposable {
		let support: IWorkspaceSymbolProvider | undefined = provider;
		if (support) {
			_supports.push(support);
		}

		return {
			dispose() {
				if (support) {
					const idx = _supports.indexOf(support);
					if (idx >= 0) {
						_supports.splice(idx, 1);
						support = undefined;
					}
				}
			}
		};
	}

	export function all(): IWorkspaceSymbolProvider[] {
		return _supports.slice(0);
	}
}

export function getWorkspaceSymbols(query: string, token: CancellationToken = CancellationToken.None): Promise<[IWorkspaceSymbolProvider, IWorkspaceSymbol[]][]> {

	const result: [IWorkspaceSymbolProvider, IWorkspaceSymbol[]][] = [];

	const promises = WorkspaceSymbolProviderRegistry.all().map(support => {
		return Promise.resolve(support.provideWorkspaceSymbols(query, token)).then(value => {
			if (Array.isArray(value)) {
				result.push([support, value]);
			}
		}, onUnexpectedError);
	});

	return Promise.all(promises).then(_ => result);
}

export interface IWorkbenchSearchConfigurationProperties extends ISearchConfigurationProperties {
	quickOpen: {
		includeSymbols: boolean;
		includeHistory: boolean;
		history: {
			filterSortOrder: 'default' | 'recency'
		}
	};
}

export interface IWorkbenchSearchConfiguration extends ISearchConfiguration {
	search: IWorkbenchSearchConfigurationProperties;
}

/**
 * Helper to return all opened editors with resources not belonging to the currently opened workspace.
 */
export function getOutOfWorkspaceEditorResources(accessor: ServicesAccessor): URI[] {
	const editorService = accessor.get(IEditorService);
	const contextService = accessor.get(IWorkspaceContextService);
	const fileService = accessor.get(IFileService);

	const resources = editorService.editors
		.map(editor => toResource(editor, { supportSideBySide: SideBySideEditor.PRIMARY }))
		.filter(resource => !!resource && !contextService.isInsideWorkspace(resource) && fileService.canHandleResource(resource));

	return resources as URI[];
}

// Supports patterns of <path><#|:|(><line><#|:|,><col?>
const LINE_COLON_PATTERN = /\s?[#:\(](?:line )?(\d*)(?:[#:,](\d*))?\)?\s*$/;

export interface IFilterAndRange {
	filter: string;
	range: IRange;
}

export function extractRangeFromFilter(filter: string, unless?: string[]): IFilterAndRange | undefined {
	if (!filter || unless?.some(value => filter.indexOf(value) !== -1)) {
		return undefined;
	}

	let range: IRange | undefined = undefined;

	// Find Line/Column number from search value using RegExp
	const patternMatch = LINE_COLON_PATTERN.exec(filter);

	if (patternMatch) {
		const startLineNumber = parseInt(patternMatch[1] ?? '', 10);

		// Line Number
		if (isNumber(startLineNumber)) {
			range = {
				startLineNumber: startLineNumber,
				startColumn: 1,
				endLineNumber: startLineNumber,
				endColumn: 1
			};

			// Column Number
			const startColumn = parseInt(patternMatch[2] ?? '', 10);
			if (isNumber(startColumn)) {
				range = {
					startLineNumber: range.startLineNumber,
					startColumn: startColumn,
					endLineNumber: range.endLineNumber,
					endColumn: startColumn
				};
			}
		}

		// User has typed "something:" or "something#" without a line number, in this case treat as start of file
		else if (patternMatch[1] === '') {
			range = {
				startLineNumber: 1,
				startColumn: 1,
				endLineNumber: 1,
				endColumn: 1
			};
		}
	}

	if (patternMatch && range) {
		return {
			filter: filter.substr(0, patternMatch.index), // clear range suffix from search value
			range
		};
	}

	return undefined;
}
