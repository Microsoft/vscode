/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { timeout } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { mock } from 'vs/base/test/common/mock';
import { NullLogService } from 'vs/platform/log/common/log';
import { MainThreadDecorationsShape } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostDecorations } from 'vs/workbench/api/common/extHostDecorations';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { nullExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';

suite('ExtHostDecorations', function () {

	let mainThreadShape: MainThreadDecorationsShape;
	let extHostDecorations: ExtHostDecorations;
	let providers = new Set<number>();

	setup(function () {

		providers.clear();

		mainThreadShape = new class extends mock<MainThreadDecorationsShape>() {
			$registerDecorationProvider(handle: number) {
				providers.add(handle);
			}
		};

		extHostDecorations = new ExtHostDecorations(
			new class extends mock<IExtHostRpcService>() {
				getProxy(): any {
					return mainThreadShape;
				}
			},
			new NullLogService()
		);
	});

	test('SCM Decorations missing #100524', async function () {

		let calledA = false;
		let calledB = false;

		// never returns
		extHostDecorations.registerDecorationProvider({
			onDidChangeDecorations: Event.None,
			provideDecoration() {
				calledA = true;
				return new Promise(() => { });
			}
		}, nullExtensionDescription.identifier);

		// always returns
		extHostDecorations.registerDecorationProvider({
			onDidChangeDecorations: Event.None,
			provideDecoration() {
				calledB = true;
				return new Promise(resolve => resolve({ letter: 'H', title: 'Hello' }));
			}
		}, nullExtensionDescription.identifier);


		const requests = [...providers.values()].map((handle, idx) => {
			return extHostDecorations.$provideDecorations(handle, [{ id: idx, uri: URI.parse('test:///file') }], CancellationToken.None);
		});

		assert.equal(calledA, true);
		assert.equal(calledB, true);

		assert.equal(requests.length, 2);
		const [first, second] = requests;

		const firstResult = await Promise.race([first, timeout(30).then(() => false)]);
		assert.equal(typeof firstResult, 'boolean'); // never finishes...

		const secondResult = await Promise.race([second, timeout(30).then(() => false)]);
		assert.equal(typeof secondResult, 'object');
	});

});
