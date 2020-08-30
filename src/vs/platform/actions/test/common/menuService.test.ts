/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { MenuRegistry, MenuId, isIMenuItem } from 'vs/platform/actions/common/actions';
import { MenuService } from 'vs/platform/actions/common/menuService';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { NullCommandService } from 'vs/platform/commands/common/commands';
import { MockContextKeyService } from 'vs/platform/keybinding/test/common/mockKeybindingService';

// --- service instances

const contextKeyService = new class extends MockContextKeyService {
	contextMatchesRules() {
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

		assert.equal(groups.length, 5);
		const [one, two, three, four, five] = groups;

		assert.equal(one[0], 'navigation');
		assert.equal(two[0], '0_hello');
		assert.equal(three[0], 'hello');
		assert.equal(four[0], 'Hello');
		assert.equal(five[0], '');
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

		assert.equal(groups.length, 1);
		const [, actions] = groups[0];

		assert.equal(actions.length, 3);
		const [one, two, three] = actions;
		assert.equal(one.id, 'a');
		assert.equal(two.id, 'b');
		assert.equal(three.id, 'c');
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

		assert.equal(groups.length, 1);
		const [, actions] = groups[0];

		assert.equal(actions.length, 4);
		const [one, two, three, four] = actions;
		assert.equal(one.id, 'd');
		assert.equal(two.id, 'c');
		assert.equal(three.id, 'b');
		assert.equal(four.id, 'a');
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

		assert.equal(groups.length, 1);
		const [[, actions]] = groups;

		assert.equal(actions.length, 3);
		const [one, two, three] = actions;
		assert.equal(one.id, 'c');
		assert.equal(two.id, 'b');
		assert.equal(three.id, 'a');
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
					assert.equal(item.command.title, 'Explicit');
					foundA = true;
				}
				if (item.command.id === 'b') {
					assert.equal(item.command.title, 'Implicit');
					foundB = true;
				}
			}
		}
		assert.equal(foundA, true);
		assert.equal(foundB, true);
	});
});
