/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import TypeScriptServiceClientHost from '../typeScriptServiceClientHost';
import { Lazy } from '../utils/lazy';
import { Command } from './commandManager';

export class RestartTsServerCommand implements Command {
	public readonly id = 'typescript.restartTsServer';

	public constructor(
		private readonly lazyClientHost: Lazy<TypeScriptServiceClientHost>
	) { }

	public execute() {
		this.lazyClientHost.value.serviceClient.restartTsServer();
	}
}
