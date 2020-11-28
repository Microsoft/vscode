/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'vs/base/common/path';
import { memoize } from 'vs/base/common/decorators';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { NativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { createStaticIPCHandle } from 'vs/base/parts/ipc/node/ipc.net';
import product from 'vs/platform/product/common/product';

export const IEnvironmentMainService = createDecorator<IEnvironmentMainService>('nativeEnvironmentService');

/**
 * A subclass of the `INativeEnvironmentService` to be used only in electron-main
 * environments.
 */
export interface IEnvironmentMainService extends INativeEnvironmentService {

	// --- NLS cache path
	cachedLanguagesPath: string;

	// --- backup paths
	backupHome: string;
	backupWorkspacesPath: string;

	// --- V8 script cache path
	nodeCachedDataDir?: string;

	// --- IPC
	mainIPCHandle: string;

	// --- config
	sandbox: boolean;
	driverVerbose: boolean;
	disableUpdates: boolean;
}

export class EnvironmentMainService extends NativeEnvironmentService implements IEnvironmentMainService {

	@memoize
	get cachedLanguagesPath(): string { return join(this.userDataPath, 'clp'); }

	@memoize
	get backupHome(): string { return join(this.userDataPath, 'Backups'); }

	@memoize
	get backupWorkspacesPath(): string { return join(this.backupHome, 'workspaces.json'); }

	@memoize
	get mainIPCHandle(): string { return createStaticIPCHandle(this.userDataPath, 'main', product.version); }

	@memoize
	get sandbox(): boolean { return !!this._args['__sandbox']; }

	@memoize
	get driverVerbose(): boolean { return !!this._args['driver-verbose']; }

	@memoize
	get disableUpdates(): boolean { return !!this._args['disable-updates']; }

	@memoize
	get nodeCachedDataDir(): string | undefined { return process.env['VSCODE_NODE_CACHED_DATA_DIR'] || undefined; }
}
