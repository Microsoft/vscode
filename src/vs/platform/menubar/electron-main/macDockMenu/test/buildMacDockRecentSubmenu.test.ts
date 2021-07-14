/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { localize } from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { IMenubarMenu, IMenubarMenuItemSeparator, IMenubarMenuRecentItemAction, MenubarMenuItem } from 'vs/platform/menubar/common/menubar';
import { buildMacDockRecentSubmenu } from 'vs/platform/menubar/electron-main/macDockMenu/buildMackDockRecentSubmenu';

suite('Build Mac Dock Recent Menu', () => {
	test('Returns empty array on null input', () => {
		assert.deepStrictEqual(buildMacDockRecentSubmenu(null), {
			id: 'Mac.Dock.RecentMenu',
			label: localize({ key: 'miOpenRecent', comment: ['&& denotes a mnemonic'] }, "Open &&Recent"),
			submenu: {
				items: []
			}
		});
	});

	test('Returns empty array on undefined input', () => {
		assert.deepStrictEqual(buildMacDockRecentSubmenu(undefined), {
			id: 'Mac.Dock.RecentMenu',
			label: localize({ key: 'miOpenRecent', comment: ['&& denotes a mnemonic'] }, "Open &&Recent"),
			submenu: {
				items: []
			}
		});
	});

	test('Returns empty array on empty input', () => {
		assert.deepStrictEqual(buildMacDockRecentSubmenu({ items: [] }), {
			id: 'Mac.Dock.RecentMenu',
			label: localize({ key: 'miOpenRecent', comment: ['&& denotes a mnemonic'] }, "Open &&Recent"),
			submenu: {
				items: []
			}
		});
	});

	const itemProps: MenubarMenuItem = {
		id: '',
		uri: URI.parse(''),
		label: ''
	};

	test('Returns all 3 types of recent menu items', () => {
		const input: IMenubarMenu = {
			items: [
				{
					...itemProps,
					id: 'openRecentFolder',
				},
				{
					id: 'with.submenu',
					label: '',
					submenu: {
						items: [
							{
								...itemProps,
								id: 'openRecentWorkspace',
							},
							{
								...itemProps,
								id: 'openRecentFile',
							},
							{
								...itemProps,
								id: 'openRecentFolder',
							},
						]
					}
				},
				{
					...itemProps,
					id: 'openRecentFile',
				},
			]
		};

		const expectedSubmenuItems: Array<IMenubarMenuRecentItemAction | IMenubarMenuItemSeparator> = [
			{
				...itemProps,
				id: 'openRecentWorkspace'
			},
			{
				id: 'vscode.menubar.separator'
			},
			{
				...itemProps,
				id: 'openRecentFolder'
			},
			{
				...itemProps,
				id: 'openRecentFolder'
			},
			{
				id: 'vscode.menubar.separator'
			},
			{
				...itemProps,
				id: 'openRecentFile'
			},
			{
				...itemProps,
				id: 'openRecentFile'
			},
		];

		assert.deepStrictEqual(buildMacDockRecentSubmenu(input), {
			id: 'Mac.Dock.RecentMenu',
			label: localize({ key: 'miOpenRecent', comment: ['&& denotes a mnemonic'] }, "Open &&Recent"),
			submenu: {
				items: expectedSubmenuItems
			}
		});
	});

	test('Returns folder and file recent menu items', () => {
		const input: IMenubarMenu = {
			items: [
				{
					id: 'with.submenu',
					label: '',
					submenu: {
						items: [
							{
								...itemProps,
								id: 'openRecentFolder',
							},
							{
								...itemProps,
								id: 'openRecentFile',
							},
							{
								...itemProps,
								id: 'openRecentFolder',
							},
							{
								...itemProps,
								id: 'openRecentFile',
							},
						]
					}
				},
			]
		};

		const expectedSubmenuItems: Array<IMenubarMenuRecentItemAction | IMenubarMenuItemSeparator> = [
			{
				...itemProps,
				id: 'openRecentFolder'
			},
			{
				...itemProps,
				id: 'openRecentFolder'
			},
			{
				id: 'vscode.menubar.separator'
			},
			{
				...itemProps,
				id: 'openRecentFile'
			},
			{
				...itemProps,
				id: 'openRecentFile'
			},
		];

		assert.deepStrictEqual(buildMacDockRecentSubmenu(input), {
			id: 'Mac.Dock.RecentMenu',
			label: localize({ key: 'miOpenRecent', comment: ['&& denotes a mnemonic'] }, "Open &&Recent"),
			submenu: {
				items: expectedSubmenuItems
			}
		});
	});

	test('Returns nested folder recent menu items', () => {
		const input: IMenubarMenu = {
			items: [
				{
					id: 'with.submenu',
					label: '',
					submenu: {
						items: [
							{
								...itemProps,
								id: 'openRecentFolder',
							},
							{
								...itemProps,
								id: 'openRecentFolder',
							},
							{
								...itemProps,
								submenu: {
									items: [
										{
											...itemProps,
											id: 'openRecentFolder',
										},
									]
								}
							}
						]
					}
				},
				{
					...itemProps,
					id: 'openRecentFolder',
				},
			]
		};

		const expectedSubmenuItems: Array<IMenubarMenuRecentItemAction | IMenubarMenuItemSeparator> = [
			{
				...itemProps,
				id: 'openRecentFolder'
			},
			{
				...itemProps,
				id: 'openRecentFolder'
			},
			{
				...itemProps,
				id: 'openRecentFolder'
			},
			{
				...itemProps,
				id: 'openRecentFolder'
			},
		];

		assert.deepStrictEqual(buildMacDockRecentSubmenu(input), {
			id: 'Mac.Dock.RecentMenu',
			label: localize({ key: 'miOpenRecent', comment: ['&& denotes a mnemonic'] }, "Open &&Recent"),
			submenu: {
				items: expectedSubmenuItems
			}
		});
	});
});
