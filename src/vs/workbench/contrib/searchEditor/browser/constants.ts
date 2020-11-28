/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';

export const InSearchEditor = new RawContextKey<boolean>('inSearchEditor', false);

export const SearchEditorScheme = 'search-editor';

export const SearchEditorFindMatchClass = 'seaarchEditorFindMatch';

export const SearchEditorID = 'workbench.editor.searchEditor';

export const OpenNewEditorCommandId = 'search.action.openNewEditor';
export const OpenEditorCommandId = 'search.action.openEditor';
export const ToggleSearchEditorContextLinesCommandId = 'toggleSearchEditorContextLines';
