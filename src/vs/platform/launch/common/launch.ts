/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UriComponents } from 'vs/base/common/uri';

export interface IWindowInfo {
	pid: number;
	title: string;
	folderURIs: UriComponents[];
	remoteAuthority?: string;
}

export interface IMainProcessInfo {
	mainPID: number;
	// All arguments after argv[0], the exec path
	mainArguments: string[];
	windows: IWindowInfo[];
	screenReader: boolean;
	gpuFeatureStatus: any;
}
