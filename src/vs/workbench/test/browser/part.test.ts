/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Part } from 'vs/workbench/browser/part';
import * as Types from 'vs/base/common/types';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { append, $, hide } from 'vs/base/browser/dom';
import { TestLayoutService } from 'vs/workbench/test/browser/workbenchTestServices';
import { StorageScope } from 'vs/platform/storage/common/storage';
import { TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';

class SimplePart extends Part {

	minimumWidth: number = 50;
	maximumWidth: number = 50;
	minimumHeight: number = 50;
	maximumHeight: number = 50;

	layout(width: number, height: number): void {
		throw new Error('Method not implemented.');
	}

	toJSON(): object {
		throw new Error('Method not implemented.');
	}
}

class MyPart extends SimplePart {

	constructor(private expectedParent: HTMLElement) {
		super('myPart', { hasTitle: true }, new TestThemeService(), new TestStorageService(), new TestLayoutService());
	}

	createTitleArea(parent: HTMLElement): HTMLElement {
		assert.strictEqual(parent, this.expectedParent);
		return super.createTitleArea(parent)!;
	}

	createContentArea(parent: HTMLElement): HTMLElement {
		assert.strictEqual(parent, this.expectedParent);
		return super.createContentArea(parent)!;
	}

	getMemento(scope: StorageScope) {
		return super.getMemento(scope);
	}

	saveState(): void {
		return super.saveState();
	}
}

class MyPart2 extends SimplePart {

	constructor() {
		super('myPart2', { hasTitle: true }, new TestThemeService(), new TestStorageService(), new TestLayoutService());
	}

	createTitleArea(parent: HTMLElement): HTMLElement {
		const titleContainer = append(parent, $('div'));
		const titleLabel = append(titleContainer, $('span'));
		titleLabel.id = 'myPart.title';
		titleLabel.innerText = 'Title';

		return titleContainer;
	}

	createContentArea(parent: HTMLElement): HTMLElement {
		const contentContainer = append(parent, $('div'));
		const contentSpan = append(contentContainer, $('span'));
		contentSpan.id = 'myPart.content';
		contentSpan.innerText = 'Content';

		return contentContainer;
	}
}

class MyPart3 extends SimplePart {

	constructor() {
		super('myPart2', { hasTitle: false }, new TestThemeService(), new TestStorageService(), new TestLayoutService());
	}

	createTitleArea(parent: HTMLElement): HTMLElement {
		return null!;
	}

	createContentArea(parent: HTMLElement): HTMLElement {
		const contentContainer = append(parent, $('div'));
		const contentSpan = append(contentContainer, $('span'));
		contentSpan.id = 'myPart.content';
		contentSpan.innerText = 'Content';

		return contentContainer;
	}
}

suite('Workbench parts', () => {
	let fixture: HTMLElement;
	let fixtureId = 'workbench-part-fixture';

	setup(() => {
		fixture = document.createElement('div');
		fixture.id = fixtureId;
		document.body.appendChild(fixture);
	});

	teardown(() => {
		document.body.removeChild(fixture);
	});

	test('Creation', () => {
		let b = document.createElement('div');
		document.getElementById(fixtureId)!.appendChild(b);
		hide(b);

		let part = new MyPart(b);
		part.create(b);

		assert.strictEqual(part.getId(), 'myPart');

		// Memento
		let memento = part.getMemento(StorageScope.GLOBAL) as any;
		assert(memento);
		memento.foo = 'bar';
		memento.bar = [1, 2, 3];

		part.saveState();

		// Re-Create to assert memento contents
		part = new MyPart(b);

		memento = part.getMemento(StorageScope.GLOBAL);
		assert(memento);
		assert.strictEqual(memento.foo, 'bar');
		assert.strictEqual(memento.bar.length, 3);

		// Empty Memento stores empty object
		delete memento.foo;
		delete memento.bar;

		part.saveState();
		part = new MyPart(b);
		memento = part.getMemento(StorageScope.GLOBAL);
		assert(memento);
		assert.strictEqual(Types.isEmptyObject(memento), true);
	});

	test('Part Layout with Title and Content', function () {
		let b = document.createElement('div');
		document.getElementById(fixtureId)!.appendChild(b);
		hide(b);

		let part = new MyPart2();
		part.create(b);

		assert(document.getElementById('myPart.title'));
		assert(document.getElementById('myPart.content'));
	});

	test('Part Layout with Content only', function () {
		let b = document.createElement('div');
		document.getElementById(fixtureId)!.appendChild(b);
		hide(b);

		let part = new MyPart3();
		part.create(b);

		assert(!document.getElementById('myPart.title'));
		assert(document.getElementById('myPart.content'));
	});
});
