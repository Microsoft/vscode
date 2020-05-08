/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon, registerIcon } from 'vs/base/common/codicons';

export const searchDetailsIcon = registerIcon('search-details', Codicon.ellipsis);

export const searchShowContextIcon = registerIcon('search-show-context', Codicon.listSelection);
export const searchHideReplaceIcon = registerIcon('search-hide-replace', Codicon.chevronRight);
export const searchShowReplaceIcon = registerIcon('search-show-replace', Codicon.chevronDown);
export const searchReplaceAllIcon = registerIcon('search-replace-all', Codicon.replaceAll);
export const searchReplaceIcon = registerIcon('search-replace', Codicon.replace);
export const searchRemoveIcon = registerIcon('search-remove', Codicon.close);

export const searchRefreshIcon = registerIcon('search-refresh', Codicon.refresh);
export const searchCollapseAllIcon = registerIcon('search-collapse-results', Codicon.collapseAll);
export const searchExpandAllIcon = registerIcon('search-expand-results', Codicon.expandAll);
export const searchClearIcon = registerIcon('search-clear-results', Codicon.clearAll);
export const searchStopIcon = Codicon.searchStop;

export const searchViewIcon = Codicon.search;

export const searchNewEditorIcon = registerIcon('search-new-editor', Codicon.newFile);
export const searchGotoFileIcon = registerIcon('search-goto-file', Codicon.goToFile);

