/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { List } from 'vs/base/browser/ui/list/listWidget';
import { WorkbenchListFocusContextKey, IListService, WorkbenchListSupportsMultiSelectContextKey, ListWidget, WorkbenchListHasSelectionOrFocus, getSelectionKeyboardEvent } from 'vs/platform/list/browser/listService';
import { PagedList } from 'vs/base/browser/ui/list/listPaging';
import { range } from 'vs/base/common/arrays';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { ObjectTree } from 'vs/base/browser/ui/tree/objectTree';
import { AsyncDataTree } from 'vs/base/browser/ui/tree/asyncDataTree';
import { DataTree } from 'vs/base/browser/ui/tree/dataTree';
import { ITreeNode } from 'vs/base/browser/ui/tree/tree';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';

function ensureDOMFocus(widget: ListWidget | undefined): void {
	// it can happen that one of the commands is executed while
	// DOM focus is within another focusable control within the
	// list/tree item. therefor we should ensure that the
	// list/tree has DOM focus again after the command ran.
	if (widget && widget.getHTMLElement() !== document.activeElement) {
		widget.domFocus();
	}
}

function focusDown(accessor: ServicesAccessor, arg2?: number, loop: boolean = false): void {
	const focused = accessor.get(IListService).lastFocusedList;
	const count = typeof arg2 === 'number' ? arg2 : 1;

	// List
	if (focused instanceof List || focused instanceof PagedList) {
		const list = focused;

		list.focusNext(count);
		const listFocus = list.getFocus();
		if (listFocus.length) {
			list.reveal(listFocus[0]);
		}
	}

	// Tree
	else if (focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
		const tree = focused;

		const fakeKeyboardEvent = new KeyboardEvent('keydown');
		tree.focusNext(count, loop, fakeKeyboardEvent);

		const listFocus = tree.getFocus();
		if (listFocus.length) {
			tree.reveal(listFocus[0]);
		}
	}

	// Ensure DOM Focus
	ensureDOMFocus(focused);
}

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.focusDown',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyCode.DownArrow,
	mac: {
		primary: KeyCode.DownArrow,
		secondary: [KeyMod.WinCtrl | KeyCode.KEY_N]
	},
	handler: (accessor, arg2) => focusDown(accessor, arg2)
});

function expandMultiSelection(focused: List<unknown> | PagedList<unknown> | ObjectTree<unknown, unknown> | DataTree<unknown, unknown, unknown> | AsyncDataTree<unknown, unknown, unknown>, previousFocus: unknown): void {

	// List
	if (focused instanceof List || focused instanceof PagedList) {
		const list = focused;

		const focus = list.getFocus() ? list.getFocus()[0] : undefined;
		const selection = list.getSelection();
		if (selection && typeof focus === 'number' && selection.indexOf(focus) >= 0) {
			list.setSelection(selection.filter(s => s !== previousFocus));
		} else {
			if (typeof focus === 'number') {
				list.setSelection(selection.concat(focus));
			}
		}
	}

	// Tree
	else if (focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
		const list = focused;

		const focus = list.getFocus() ? list.getFocus()[0] : undefined;

		if (previousFocus === focus) {
			return;
		}

		const selection = list.getSelection();
		const fakeKeyboardEvent = new KeyboardEvent('keydown', { shiftKey: true });

		if (selection && selection.indexOf(focus) >= 0) {
			list.setSelection(selection.filter(s => s !== previousFocus), fakeKeyboardEvent);
		} else {
			list.setSelection(selection.concat(focus), fakeKeyboardEvent);
		}
	}
}

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.expandSelectionDown',
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(WorkbenchListFocusContextKey, WorkbenchListSupportsMultiSelectContextKey),
	primary: KeyMod.Shift | KeyCode.DownArrow,
	handler: (accessor, arg2) => {
		const focused = accessor.get(IListService).lastFocusedList;

		// List / Tree
		if (focused instanceof List || focused instanceof PagedList || focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
			const list = focused;

			// Focus down first
			const previousFocus = list.getFocus() ? list.getFocus()[0] : undefined;
			focusDown(accessor, arg2, false);

			// Then adjust selection
			expandMultiSelection(focused, previousFocus);
		}
	}
});

function focusUp(accessor: ServicesAccessor, arg2?: number, loop: boolean = false): void {
	const focused = accessor.get(IListService).lastFocusedList;
	const count = typeof arg2 === 'number' ? arg2 : 1;

	// List
	if (focused instanceof List || focused instanceof PagedList) {
		const list = focused;

		list.focusPrevious(count);
		const listFocus = list.getFocus();
		if (listFocus.length) {
			list.reveal(listFocus[0]);
		}
	}

	// Tree
	else if (focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
		const tree = focused;

		const fakeKeyboardEvent = new KeyboardEvent('keydown');
		tree.focusPrevious(count, loop, fakeKeyboardEvent);

		const listFocus = tree.getFocus();
		if (listFocus.length) {
			tree.reveal(listFocus[0]);
		}
	}

	// Ensure DOM Focus
	ensureDOMFocus(focused);
}

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.focusUp',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyCode.UpArrow,
	mac: {
		primary: KeyCode.UpArrow,
		secondary: [KeyMod.WinCtrl | KeyCode.KEY_P]
	},
	handler: (accessor, arg2) => focusUp(accessor, arg2)
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.expandSelectionUp',
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(WorkbenchListFocusContextKey, WorkbenchListSupportsMultiSelectContextKey),
	primary: KeyMod.Shift | KeyCode.UpArrow,
	handler: (accessor, arg2) => {
		const focused = accessor.get(IListService).lastFocusedList;

		// List / Tree
		if (focused instanceof List || focused instanceof PagedList || focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
			const list = focused;

			// Focus up first
			const previousFocus = list.getFocus() ? list.getFocus()[0] : undefined;
			focusUp(accessor, arg2, false);

			// Then adjust selection
			expandMultiSelection(focused, previousFocus);
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.collapse',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyCode.LeftArrow,
	mac: {
		primary: KeyCode.LeftArrow,
		secondary: [KeyMod.CtrlCmd | KeyCode.UpArrow]
	},
	handler: (accessor) => {
		const focused = accessor.get(IListService).lastFocusedList;

		// Tree only
		if (focused && !(focused instanceof List || focused instanceof PagedList)) {
			if (focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
				const tree = focused;
				const focusedElements = tree.getFocus();

				if (focusedElements.length === 0) {
					return;
				}

				const focus = focusedElements[0];

				if (!tree.collapse(focus)) {
					const parent = tree.getParentElement(focus);

					if (parent) {
						const fakeKeyboardEvent = new KeyboardEvent('keydown');
						tree.setFocus([parent], fakeKeyboardEvent);
						tree.reveal(parent);
					}
				}
			}
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.collapseAll',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyMod.CtrlCmd | KeyCode.LeftArrow,
	mac: {
		primary: KeyMod.CtrlCmd | KeyCode.LeftArrow,
		secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.UpArrow]
	},
	handler: (accessor) => {
		const focusedTree = accessor.get(IListService).lastFocusedList;

		if (focusedTree && !(focusedTree instanceof List || focusedTree instanceof PagedList)) {
			focusedTree.collapseAll();
		}
	}
});


KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.focusParent',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	handler: (accessor) => {
		const focused = accessor.get(IListService).lastFocusedList;

		if (!focused || focused instanceof List || focused instanceof PagedList) {
			return;
		}

		if (focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
			const tree = focused;
			const focusedElements = tree.getFocus();
			if (focusedElements.length === 0) {
				return;
			}
			const focus = focusedElements[0];
			const parent = tree.getParentElement(focus);
			if (parent) {
				const fakeKeyboardEvent = new KeyboardEvent('keydown');
				tree.setFocus([parent], fakeKeyboardEvent);
				tree.reveal(parent);
			}
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.expand',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyCode.RightArrow,
	handler: (accessor) => {
		const focused = accessor.get(IListService).lastFocusedList;

		// Tree only
		if (focused && !(focused instanceof List || focused instanceof PagedList)) {
			if (focused instanceof ObjectTree || focused instanceof DataTree) {
				// TODO@Joao: instead of doing this here, just delegate to a tree method
				const tree = focused;
				const focusedElements = tree.getFocus();

				if (focusedElements.length === 0) {
					return;
				}

				const focus = focusedElements[0];

				if (!tree.expand(focus)) {
					const child = tree.getFirstElementChild(focus);

					if (child) {
						const node = tree.getNode(child);

						if (node.visible) {
							const fakeKeyboardEvent = new KeyboardEvent('keydown');
							tree.setFocus([child], fakeKeyboardEvent);
							tree.reveal(child);
						}
					}
				}
			} else if (focused instanceof AsyncDataTree) {
				// TODO@Joao: instead of doing this here, just delegate to a tree method
				const tree = focused;
				const focusedElements = tree.getFocus();

				if (focusedElements.length === 0) {
					return;
				}

				const focus = focusedElements[0];
				tree.expand(focus).then(didExpand => {
					if (focus && !didExpand) {
						const child = tree.getFirstElementChild(focus);

						if (child) {
							const node = tree.getNode(child);

							if (node.visible) {
								const fakeKeyboardEvent = new KeyboardEvent('keydown');
								tree.setFocus([child], fakeKeyboardEvent);
								tree.reveal(child);
							}
						}
					}
				});
			}
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.focusPageUp',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyCode.PageUp,
	handler: (accessor) => {
		const focused = accessor.get(IListService).lastFocusedList;

		// List
		if (focused instanceof List || focused instanceof PagedList) {
			focused.focusPreviousPage();
		}

		// Tree
		else if (focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
			const fakeKeyboardEvent = new KeyboardEvent('keydown');
			focused.focusPreviousPage(fakeKeyboardEvent);
		}

		// Ensure DOM Focus
		ensureDOMFocus(focused);
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.focusPageDown',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyCode.PageDown,
	handler: (accessor) => {
		const focused = accessor.get(IListService).lastFocusedList;

		// List
		if (focused instanceof List || focused instanceof PagedList) {
			focused.focusNextPage();
		}

		// Tree
		else if (focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
			const fakeKeyboardEvent = new KeyboardEvent('keydown');
			focused.focusNextPage(fakeKeyboardEvent);
		}

		// Ensure DOM Focus
		ensureDOMFocus(focused);
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.focusFirst',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyCode.Home,
	handler: accessor => listFocusFirst(accessor)
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.focusFirstChild',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: 0,
	handler: accessor => listFocusFirst(accessor, { fromFocused: true })
});

function listFocusFirst(accessor: ServicesAccessor, options?: { fromFocused: boolean }): void {
	const focused = accessor.get(IListService).lastFocusedList;

	// List
	if (focused instanceof List || focused instanceof PagedList) {
		const list = focused;

		list.setFocus([0]);
		list.reveal(0);
	}

	// Tree
	else if (focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
		const tree = focused;
		const fakeKeyboardEvent = new KeyboardEvent('keydown');
		tree.focusFirst(fakeKeyboardEvent);

		const focus = tree.getFocus();

		if (focus.length > 0) {
			tree.reveal(focus[0]);
		}
	}

	// Ensure DOM Focus
	ensureDOMFocus(focused);
}

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.focusLast',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyCode.End,
	handler: accessor => listFocusLast(accessor)
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.focusLastChild',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: 0,
	handler: accessor => listFocusLast(accessor, { fromFocused: true })
});

function listFocusLast(accessor: ServicesAccessor, options?: { fromFocused: boolean }): void {
	const focused = accessor.get(IListService).lastFocusedList;

	// List
	if (focused instanceof List || focused instanceof PagedList) {
		const list = focused;

		list.setFocus([list.length - 1]);
		list.reveal(list.length - 1);
	}

	// Tree
	else if (focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
		const tree = focused;
		const fakeKeyboardEvent = new KeyboardEvent('keydown');
		tree.focusLast(fakeKeyboardEvent);

		const focus = tree.getFocus();

		if (focus.length > 0) {
			tree.reveal(focus[0]);
		}
	}

	// Ensure DOM Focus
	ensureDOMFocus(focused);
}


function focusElement(accessor: ServicesAccessor, retainCurrentFocus: boolean): void {
	const focused = accessor.get(IListService).lastFocusedList;
	const fakeKeyboardEvent = getSelectionKeyboardEvent('keydown', retainCurrentFocus);
	// List
	if (focused instanceof List || focused instanceof PagedList) {
		const list = focused;
		list.setSelection(list.getFocus(), fakeKeyboardEvent);
	}

	// Trees
	else if (focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
		const tree = focused;
		const focus = tree.getFocus();

		if (focus.length > 0) {
			let toggleCollapsed = true;

			if (tree.expandOnlyOnTwistieClick === true) {
				toggleCollapsed = false;
			} else if (typeof tree.expandOnlyOnTwistieClick !== 'boolean' && tree.expandOnlyOnTwistieClick(focus[0])) {
				toggleCollapsed = false;
			}

			if (toggleCollapsed) {
				tree.toggleCollapsed(focus[0]);
			}
		}
		tree.setSelection(focus, fakeKeyboardEvent);
	}
}

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.select',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyCode.Enter,
	mac: {
		primary: KeyCode.Enter,
		secondary: [KeyMod.CtrlCmd | KeyCode.DownArrow]
	},
	handler: (accessor) => {
		focusElement(accessor, false);
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.selectAndPreserveFocus',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	handler: accessor => {
		focusElement(accessor, true);
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.selectAll',
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(WorkbenchListFocusContextKey, WorkbenchListSupportsMultiSelectContextKey),
	primary: KeyMod.CtrlCmd | KeyCode.KEY_A,
	handler: (accessor) => {
		const focused = accessor.get(IListService).lastFocusedList;

		// List
		if (focused instanceof List || focused instanceof PagedList) {
			const list = focused;
			const fakeKeyboardEvent = new KeyboardEvent('keydown');
			list.setSelection(range(list.length), fakeKeyboardEvent);
		}

		// Trees
		else if (focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
			const tree = focused;
			const focus = tree.getFocus();
			const selection = tree.getSelection();

			// Which element should be considered to start selecting all?
			let start: unknown | undefined = undefined;

			if (focus.length > 0 && (selection.length === 0 || !selection.includes(focus[0]))) {
				start = focus[0];
			}

			if (!start && selection.length > 0) {
				start = selection[0];
			}

			// What is the scope of select all?
			let scope: unknown | undefined = undefined;

			if (!start) {
				scope = undefined;
			} else {
				scope = tree.getParentElement(start);
			}

			const newSelection: unknown[] = [];
			const visit = (node: ITreeNode<unknown, unknown>) => {
				for (const child of node.children) {
					if (child.visible) {
						newSelection.push(child.element);

						if (!child.collapsed) {
							visit(child);
						}
					}
				}
			};

			// Add the whole scope subtree to the new selection
			visit(tree.getNode(scope));

			// If the scope isn't the tree root, it should be part of the new selection
			if (scope && selection.length === newSelection.length) {
				newSelection.unshift(scope);
			}

			const fakeKeyboardEvent = new KeyboardEvent('keydown');
			tree.setSelection(newSelection, fakeKeyboardEvent);
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.toggleSelection',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Enter,
	handler: (accessor) => {
		const widget = accessor.get(IListService).lastFocusedList;

		if (!widget) {
			return;
		}

		const focus = widget.getFocus();

		if (focus.length === 0) {
			return;
		}

		const selection = widget.getSelection();
		const index = selection.indexOf(focus[0]);

		if (index > -1) {
			widget.setSelection([...selection.slice(0, index), ...selection.slice(index + 1)]);
		} else {
			widget.setSelection([...selection, focus[0]]);
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.toggleExpand',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyCode.Space,
	handler: (accessor) => {
		const focused = accessor.get(IListService).lastFocusedList;

		// Tree only
		if (focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
			const tree = focused;
			const focus = tree.getFocus();

			if (focus.length > 0 && tree.isCollapsible(focus[0])) {
				tree.toggleCollapsed(focus[0]);
				return;
			}
		}

		focusElement(accessor, true);
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.clear',
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(WorkbenchListFocusContextKey, WorkbenchListHasSelectionOrFocus),
	primary: KeyCode.Escape,
	handler: (accessor) => {
		const focused = accessor.get(IListService).lastFocusedList;

		// List
		if (focused instanceof List || focused instanceof PagedList) {
			const list = focused;

			list.setSelection([]);
			list.setFocus([]);
		}

		// Tree
		else if (focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
			const list = focused;
			const fakeKeyboardEvent = new KeyboardEvent('keydown');

			list.setSelection([], fakeKeyboardEvent);
			list.setFocus([], fakeKeyboardEvent);
		}
	}
});

CommandsRegistry.registerCommand({
	id: 'list.toggleKeyboardNavigation',
	handler: (accessor) => {
		const focused = accessor.get(IListService).lastFocusedList;

		// List
		if (focused instanceof List || focused instanceof PagedList) {
			const list = focused;
			list.toggleKeyboardNavigation();
		}

		// Tree
		else if (focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
			const tree = focused;
			tree.toggleKeyboardNavigation();
		}
	}
});

CommandsRegistry.registerCommand({
	id: 'list.toggleFilterOnType',
	handler: (accessor) => {
		const focused = accessor.get(IListService).lastFocusedList;

		// List
		if (focused instanceof List || focused instanceof PagedList) {
			// TODO@joao
		}

		// Tree
		else if (focused instanceof ObjectTree || focused instanceof DataTree || focused instanceof AsyncDataTree) {
			const tree = focused;
			tree.updateOptions({ filterOnType: !tree.filterOnType });
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.scrollUp',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyMod.CtrlCmd | KeyCode.UpArrow,
	handler: accessor => {
		const focused = accessor.get(IListService).lastFocusedList;

		if (!focused) {
			return;
		}

		focused.scrollTop -= 10;
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.scrollDown',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyMod.CtrlCmd | KeyCode.DownArrow,
	handler: accessor => {
		const focused = accessor.get(IListService).lastFocusedList;

		if (!focused) {
			return;
		}

		focused.scrollTop += 10;
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.scrollLeft',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	handler: accessor => {
		const focused = accessor.get(IListService).lastFocusedList;

		if (!focused) {
			return;
		}

		focused.scrollLeft -= 10;
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.scrollRight',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	handler: accessor => {
		const focused = accessor.get(IListService).lastFocusedList;

		if (!focused) {
			return;
		}

		focused.scrollLeft += 10;
	}
});
