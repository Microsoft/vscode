/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ICommonIssueService } from 'vs/platform/issue/common/issue';

export const IIssueService = createDecorator<IIssueService>('issueService');

export interface IIssueService extends ICommonIssueService { }
