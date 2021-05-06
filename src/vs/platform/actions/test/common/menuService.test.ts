/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { MenuRegistry, MenuId, isIMenuItem } from 'vs/platform/actions/common/actions';
import { MenuService } from 'vs/platform/actions/common/menuService';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { NullCommandService } from 'vs/platform/commands/common/commands';
import { MockContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';

// --- service instances

const contextKeyService = new class extends MockContextKeyService {
	override contextMatchesRules() {
		return true;
	}
};

// --- tests

suite('MenuService', function () {

	let menuService: MenuService;
	const disposables = new DisposableStore();
	let testMenuId: MenuId;

	setup(function () {
		menuService = new MenuService(NullCommandService);
		testMenuId = new MenuId('testo');
		disposables.clear();
	});

	teardown(function () {
		disposables.clear();
	});

	test('group sorting', function () {

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'one', title: 'FOO' },
			group: '0_hello'
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'two', title: 'FOO' },
			group: 'hello'
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'three', title: 'FOO' },
			group: 'Hello'
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'four', title: 'FOO' },
			group: ''
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'five', title: 'FOO' },
			group: 'navigation'
		}));

		const groups = menuService.createMenu(testMenuId, contextKeyService).getActions();

		assert.strictEqual(groups.length, 5);
		const [one, two, three, four, five] = groups;

		assert.strictEqual(one[0], 'navigation');
		assert.strictEqual(two[0], '0_hello');
		assert.strictEqual(three[0], 'hello');
		assert.strictEqual(four[0], 'Hello');
		assert.strictEqual(five[0], '');
	});

	test('in group sorting, by title', function () {

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'a', title: 'aaa' },
			group: 'Hello'
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'b', title: 'fff' },
			group: 'Hello'
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'c', title: 'zzz' },
			group: 'Hello'
		}));

		const groups = menuService.createMenu(testMenuId, contextKeyService).getActions();

		assert.strictEqual(groups.length, 1);
		const [, actions] = groups[0];

		assert.strictEqual(actions.length, 3);
		const [one, two, three] = actions;
		assert.strictEqual(one.id, 'a');
		assert.strictEqual(two.id, 'b');
		assert.strictEqual(three.id, 'c');
	});

	test('in group sorting, by title and order', function () {

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'a', title: 'aaa' },
			group: 'Hello',
			order: 10
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'b', title: 'fff' },
			group: 'Hello'
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'c', title: 'zzz' },
			group: 'Hello',
			order: -1
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'd', title: 'yyy' },
			group: 'Hello',
			order: -1
		}));

		const groups = menuService.createMenu(testMenuId, contextKeyService).getActions();

		assert.strictEqual(groups.length, 1);
		const [, actions] = groups[0];

		assert.strictEqual(actions.length, 4);
		const [one, two, three, four] = actions;
		assert.strictEqual(one.id, 'd');
		assert.strictEqual(two.id, 'c');
		assert.strictEqual(three.id, 'b');
		assert.strictEqual(four.id, 'a');
	});


	test('in group sorting, special: navigation', function () {

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'a', title: 'aaa' },
			group: 'navigation',
			order: 1.3
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'b', title: 'fff' },
			group: 'navigation',
			order: 1.2
		}));

		disposables.add(MenuRegistry.appendMenuItem(testMenuId, {
			command: { id: 'c', title: 'zzz' },
			group: 'navigation',
			order: 1.1
		}));

		const groups = menuService.createMenu(testMenuId, contextKeyService).getActions();

		assert.strictEqual(groups.length, 1);
		const [[, actions]] = groups;

		assert.strictEqual(actions.length, 3);
		const [one, two, three] = actions;
		assert.strictEqual(one.id, 'c');
		assert.strictEqual(two.id, 'b');
		assert.strictEqual(three.id, 'a');
	});

	test('special MenuId palette', function () {

		disposables.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: { id: 'a', title: 'Explicit' }
		}));

		MenuRegistry.addCommand({ id: 'b', title: 'Implicit' });

		let foundA = false;
		let foundB = false;
		for (const item of MenuRegistry.getMenuItems(MenuId.CommandPalette)) {
			if (isIMenuItem(item)) {
				if (item.command.id === 'a') {
					assert.strictEqual(item.command.title, 'Explicit');
					foundA = true;
				}
				if (item.command.id === 'b') {
					assert.strictEqual(item.command.title, 'Implicit');
					foundB = true;
				}
			}
		}
		assert.strictEqual(foundA, true);
		assert.strictEqual(foundB, true);
	});
});
