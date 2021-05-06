/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { IWorkspace } from 'vs/platform/workspace/common/workspace';

export function getRemoteAuthority(uri: URI): string | undefined {
	return uri.scheme === Schemas.vscodeRemote ? uri.authority : undefined;
}

export function getRemoteName(authority: string): string;
export function getRemoteName(authority: undefined): undefined;
export function getRemoteName(authority: string | undefined): string | undefined;
export function getRemoteName(authority: string | undefined): string | undefined {
	if (!authority) {
		return undefined;
	}
	const pos = authority.indexOf('+');
	if (pos < 0) {
		// e.g. localhost:8000
		return authority;
	}
	return authority.substr(0, pos);
}

function isVirtualResource(resource: URI) {
	return resource.scheme !== Schemas.file && resource.scheme !== Schemas.vscodeRemote;
}

export function getVirtualWorkspaceLocation(workspace: IWorkspace): { scheme: string, authority: string } | undefined {
	if (workspace.folders.length) {
		return workspace.folders.every(f => isVirtualResource(f.uri)) ? workspace.folders[0].uri : undefined;
	} else if (workspace.configuration && isVirtualResource(workspace.configuration)) {
		return workspace.configuration;
	}
	return undefined;
}

export function getVirtualWorkspaceScheme(workspace: IWorkspace): string | undefined {
	return getVirtualWorkspaceLocation(workspace)?.scheme;
}
