/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ListView } from 'vs/base/browser/ui/list/listView';
import { IListVirtualDelegate, IListRenderer } from 'vs/base/browser/ui/list/list';
import { range } from 'vs/base/common/arrays';

suite('ListView', function () {
	test('all rows get disposed', function () {
		const element = document.createElement('div');
		element.style.height = '200px';
		element.style.width = '200px';

		const delegate: IListVirtualDelegate<number> = {
			getHeight() { return 20; },
			getTemplateId() { return 'template'; }
		};

		let templatesCount = 0;

		const renderer: IListRenderer<number, void> = {
			templateId: 'template',
			renderTemplate() { templatesCount++; },
			renderElement() { },
			disposeTemplate() { templatesCount--; }
		};

		const listView = new ListView<number>(element, delegate, [renderer]);
		listView.layout(200);

		assert.equal(templatesCount, 0, 'no templates have been allocated');
		listView.splice(0, 0, range(100));
		assert.equal(templatesCount, 10, 'some templates have been allocated');
		listView.dispose();
		assert.equal(templatesCount, 0, 'all templates have been disposed');
	});
});
