/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { stat } from 'vs/base/node/pfs';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { isLinux, isMacintosh, isWindows } from 'vs/base/common/platform';
import { IResourceIdentityService } from 'vs/platform/resource/common/resourceIdentityService';
import { Disposable } from 'vs/base/common/lifecycle';
import { ResourceMap } from 'vs/base/common/map';

export class NativeResourceIdentityService extends Disposable implements IResourceIdentityService {

	declare readonly _serviceBrand: undefined;

	private readonly cache: ResourceMap<Promise<string>> = new ResourceMap<Promise<string>>();

	resolveResourceIdentity(resource: URI): Promise<string> {
		let promise = this.cache.get(resource);
		if (!promise) {
			promise = this.createIdentity(resource);
			this.cache.set(resource, promise);
		}
		return promise;
	}

	private async createIdentity(resource: URI): Promise<string> {
		// Return early the folder is not local
		if (resource.scheme !== Schemas.file) {
			return createHash('md5').update(resource.toString()).digest('hex');
		}

		const fileStat = await stat(resource.fsPath);
		let ctime: number | undefined;
		if (isLinux) {
			ctime = fileStat.ino; // Linux: birthtime is ctime, so we cannot use it! We use the ino instead!
		} else if (isMacintosh) {
			ctime = fileStat.birthtime.getTime(); // macOS: birthtime is fine to use as is
		} else if (isWindows) {
			if (typeof fileStat.birthtimeMs === 'number') {
				ctime = Math.floor(fileStat.birthtimeMs); // Windows: fix precision issue in node.js 8.x to get 7.x results (see https://github.com/nodejs/node/issues/19897)
			} else {
				ctime = fileStat.birthtime.getTime();
			}
		}

		// we use the ctime as extra salt to the ID so that we catch the case of a folder getting
		// deleted and recreated. in that case we do not want to carry over previous state
		return createHash('md5').update(resource.fsPath).update(ctime ? String(ctime) : '').digest('hex');
	}
}
