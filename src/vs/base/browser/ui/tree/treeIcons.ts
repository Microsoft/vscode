/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon, registerIcon } from 'vs/base/common/codicons';

export const treeItemExpandedIcon = registerIcon('tree-item-expanded', Codicon.chevronDown); // collapsed is done with rotation

export const treeFilterOnTypeOnIcon = registerIcon('tree-filter-on-type-on', Codicon.listFilter);
export const treeFilterOnTypeOffIcon = registerIcon('tree-filter-on-type-off', Codicon.listSelection);
export const treeFilterClearIcon = registerIcon('tree-filter-clear', Codicon.close);

export const treeItemLoadingIcon = registerIcon('tree-item-loading', Codicon.loading);
