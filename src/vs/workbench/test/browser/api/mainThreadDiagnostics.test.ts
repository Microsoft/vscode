/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { MarkerService } from 'vs/platform/markers/common/markerService';
import { MainThreadDiagnostics } from 'vs/workbench/api/browser/mainThreadDiagnostics';
import { URI } from 'vs/base/common/uri';
import { IExtHostContext } from 'vs/workbench/api/common/extHost.protocol';
import { mock } from 'vs/workbench/test/common/workbenchTestServices';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { ExtensionHostKind } from 'vs/workbench/services/extensions/common/extensions';


suite('MainThreadDiagnostics', function () {

	let markerService: MarkerService;

	setup(function () {
		markerService = new MarkerService();
	});

	test('clear markers on dispose', function () {

		let diag = new MainThreadDiagnostics(
			new class implements IExtHostContext {
				remoteAuthority = '';
				extensionHostKind = ExtensionHostKind.LocalProcess;
				assertRegistered() { }
				set(v: any): any { return null; }
				getProxy(): any {
					return {
						$acceptMarkersChange() { }
					};
				}
				drain(): any { return null; }
			},
			markerService,
			new class extends mock<IUriIdentityService>() {
				override asCanonicalUri(uri: URI) { return uri; }
			}
		);

		diag.$changeMany('foo', [[URI.file('a'), [{
			code: '666',
			startLineNumber: 1,
			startColumn: 1,
			endLineNumber: 1,
			endColumn: 1,
			message: 'fffff',
			severity: 1,
			source: 'me'
		}]]]);

		assert.strictEqual(markerService.read().length, 1);
		diag.dispose();
		assert.strictEqual(markerService.read().length, 0);
	});
});
