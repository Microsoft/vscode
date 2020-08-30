/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, Event } from 'vscode';
import { RemoteSourceProvider } from './api/git';

export interface IRemoteSourceProviderRegistry {
	readonly onDidAddRemoteSourceProvider: Event<RemoteSourceProvider>;
	readonly onDidRemoveRemoteSourceProvider: Event<RemoteSourceProvider>;
	registerRemoteSourceProvider(provider: RemoteSourceProvider): Disposable;
	getRemoteProviders(): RemoteSourceProvider[];
}
