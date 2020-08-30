/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ICommonIssueService } from 'vs/platform/issue/common/issue';

export const IIssueService = createDecorator<IIssueService>('issueService');

export interface IIssueService extends ICommonIssueService { }
