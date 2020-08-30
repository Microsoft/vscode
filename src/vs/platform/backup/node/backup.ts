/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface ISerializedWorkspace { id: string; configURIPath: string; remoteAuthority?: string; }

export interface IBackupWorkspacesFormat {
	rootURIWorkspaces: ISerializedWorkspace[];
	folderURIWorkspaces: string[];
	emptyWorkspaceInfos: IEmptyWindowBackupInfo[];

	// deprecated
	folderWorkspaces?: string[]; // use folderURIWorkspaces instead
	emptyWorkspaces?: string[];
	rootWorkspaces?: { id: string, configPath: string }[]; // use rootURIWorkspaces instead
}

export interface IEmptyWindowBackupInfo {
	backupFolder: string;
	remoteAuthority?: string;
}
