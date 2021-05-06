/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { isWeb } from 'vs/base/common/platform';

if (isWeb) {
	CommandsRegistry.registerCommand('_workbench.fetchJSON', async function (accessor: ServicesAccessor, url: string, method: string) {
		const result = await fetch(url, { method, headers: { Accept: 'application/json' } });

		if (result.ok) {
			return result.json();
		} else {
			throw new Error(result.statusText);
		}
	});
}
