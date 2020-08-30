/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { Workspace, toWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { isWindows } from 'vs/base/common/platform';

const wsUri = URI.file(isWindows ? 'C:\\testWorkspace' : '/testWorkspace');
export const TestWorkspace = testWorkspace(wsUri);

export function testWorkspace(resource: URI): Workspace {
	return new Workspace(resource.toString(), [toWorkspaceFolder(resource)]);
}
