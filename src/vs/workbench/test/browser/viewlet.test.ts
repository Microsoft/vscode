/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as Platform from 'vs/platform/registry/common/platform';
import { ViewletDescriptor, Extensions, Viewlet, ViewletRegistry } from 'vs/workbench/browser/viewlet';
import * as Types from 'vs/base/common/types';

suite('Viewlets', () => {

	class TestViewlet extends Viewlet {

		constructor() {
			super('id', null!, null!, null!, null!, null!, null!, null!, null!, null!, null!);
		}

		layout(dimension: any): void {
			throw new Error('Method not implemented.');
		}
	}

	test('ViewletDescriptor API', function () {
		let d = ViewletDescriptor.create(TestViewlet, 'id', 'name', 'class', 5);
		assert.strictEqual(d.id, 'id');
		assert.strictEqual(d.name, 'name');
		assert.strictEqual(d.cssClass, 'class');
		assert.strictEqual(d.order, 5);
	});

	test('Editor Aware ViewletDescriptor API', function () {
		let d = ViewletDescriptor.create(TestViewlet, 'id', 'name', 'class', 5);
		assert.strictEqual(d.id, 'id');
		assert.strictEqual(d.name, 'name');

		d = ViewletDescriptor.create(TestViewlet, 'id', 'name', 'class', 5);
		assert.strictEqual(d.id, 'id');
		assert.strictEqual(d.name, 'name');
	});

	test('Viewlet extension point and registration', function () {
		assert(Types.isFunction(Platform.Registry.as<ViewletRegistry>(Extensions.Viewlets).registerViewlet));
		assert(Types.isFunction(Platform.Registry.as<ViewletRegistry>(Extensions.Viewlets).getViewlet));
		assert(Types.isFunction(Platform.Registry.as<ViewletRegistry>(Extensions.Viewlets).getViewlets));

		let oldCount = Platform.Registry.as<ViewletRegistry>(Extensions.Viewlets).getViewlets().length;
		let d = ViewletDescriptor.create(TestViewlet, 'reg-test-id', 'name');
		Platform.Registry.as<ViewletRegistry>(Extensions.Viewlets).registerViewlet(d);

		assert(d === Platform.Registry.as<ViewletRegistry>(Extensions.Viewlets).getViewlet('reg-test-id'));
		assert.equal(oldCount + 1, Platform.Registry.as<ViewletRegistry>(Extensions.Viewlets).getViewlets().length);
	});
});
