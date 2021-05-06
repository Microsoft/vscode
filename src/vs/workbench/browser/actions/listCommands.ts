/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { List } from 'vs/base/browser/ui/list/listWidget';
import { WorkbenchListFocusContextKey, IListService, WorkbenchListSupportsMultiSelectContextKey, ListWidget, WorkbenchListHasSelectionOrFocus, getSelectionKeyboardEvent, WorkbenchListWidget, WorkbenchListSelectionNavigation } from 'vs/platform/list/browser/listService';
import { PagedList } from 'vs/base/browser/ui/list/listPaging';
import { equals, range } from 'vs/base/common/arrays';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { ObjectTree } from 'vs/base/browser/ui/tree/objectTree';
import { AsyncDataTree } from 'vs/base/browser/ui/tree/asyncDataTree';
import { DataTree } from 'vs/base/browser/ui/tree/dataTree';
import { ITreeNode } from 'vs/base/browser/ui/tree/tree';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { Table } from 'vs/base/browser/ui/table/tableWidget';

function ensureDOMFocus(widget: ListWidget | undefined): void {
	// it can happen that one of the commands is executed while
	// DOM focus is within another focusable control within the
	// list/tree item. therefor we should ensure that the
	// list/tree has DOM focus again after the command ran.
	if (widget && widget.getHTMLElement() !== document.activeElement) {
		widget.domFocus();
	}
}

async function updateFocus(widget: WorkbenchListWidget, updateFocusFn: (widget: WorkbenchListWidget) => void | Promise<void>): Promise<void> {
	if (!WorkbenchListSelectionNavigation.getValue(widget.contextKeyService)) {
		return updateFocusFn(widget);
	}

	const focus = widget.getFocus();
	const selection = widget.getSelection();

	await updateFocusFn(widget);

	const newFocus = widget.getFocus();

	if (selection.length > 1 || !equals(focus, selection) || equals(focus, newFocus)) {
		return;
	}

	const fakeKeyboardEvent = new KeyboardEvent('keydown');
	widget.setSelection(newFocus, fakeKeyboardEvent);
}

async function navigate(widget: WorkbenchListWidget | undefined, updateFocusFn: (widget: WorkbenchListWidget) => void | Promise<void>): Promise<void> {
	if (!widget) {
		return;
	}

	await updateFocus(widget, updateFocusFn);

	const listFocus = widget.getFocus();

	if (listFocus.length) {
		widget.reveal(listFocus[0]);
	}

	ensureDOMFocus(widget);
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
	handler: (accessor, arg2) => {
		navigate(accessor.get(IListService).lastFocusedList, async widget => {
			const fakeKeyboardEvent = new KeyboardEvent('keydown');
			await widget.focusNext(typeof arg2 === 'number' ? arg2 : 1, false, fakeKeyboardEvent);
		});
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.focusUp',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyCode.UpArrow,
	mac: {
		primary: KeyCode.UpArrow,
		secondary: [KeyMod.WinCtrl | KeyCode.KEY_P]
	},
	handler: (accessor, arg2) => {
		navigate(accessor.get(IListService).lastFocusedList, async widget => {
			const fakeKeyboardEvent = new KeyboardEvent('keydown');
			await widget.focusPrevious(typeof arg2 === 'number' ? arg2 : 1, false, fakeKeyboardEvent);
		});
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.focusPageDown',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyCode.PageDown,
	handler: (accessor) => {
		navigate(accessor.get(IListService).lastFocusedList, async widget => {
			const fakeKeyboardEvent = new KeyboardEvent('keydown');
			await widget.focusNextPage(fakeKeyboardEvent);
		});
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.focusPageUp',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyCode.PageUp,
	handler: (accessor) => {
		navigate(accessor.get(IListService).lastFocusedList, async widget => {
			const fakeKeyboardEvent = new KeyboardEvent('keydown');
			await widget.focusPreviousPage(fakeKeyboardEvent);
		});
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.focusFirst',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyCode.Home,
	handler: (accessor) => {
		navigate(accessor.get(IListService).lastFocusedList, async widget => {
			const fakeKeyboardEvent = new KeyboardEvent('keydown');
			await widget.focusFirst(fakeKeyboardEvent);
		});
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.focusLast',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyCode.End,
	handler: (accessor) => {
		navigate(accessor.get(IListService).lastFocusedList, async widget => {
			const fakeKeyboardEvent = new KeyboardEvent('keydown');
			await widget.focusLast(fakeKeyboardEvent);
		});
	}
});

function expandMultiSelection(focused: WorkbenchListWidget, previousFocus: unknown): void {

	// List
	if (focused instanceof List || focused instanceof PagedList || focused instanceof Table) {
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
		const widget = accessor.get(IListService).lastFocusedList;

		if (!widget) {
			return;
		}

		// Focus down first
		const previousFocus = widget.getFocus() ? widget.getFocus()[0] : undefined;
		const fakeKeyboardEvent = new KeyboardEvent('keydown');
		widget.focusNext(typeof arg2 === 'number' ? arg2 : 1, false, fakeKeyboardEvent);

		// Then adjust selection
		expandMultiSelection(widget, previousFocus);

		const focus = widget.getFocus();

		if (focus.length) {
			widget.reveal(focus[0]);
		}

		ensureDOMFocus(widget);
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.expandSelectionUp',
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(WorkbenchListFocusContextKey, WorkbenchListSupportsMultiSelectContextKey),
	primary: KeyMod.Shift | KeyCode.UpArrow,
	handler: (accessor, arg2) => {
		const widget = accessor.get(IListService).lastFocusedList;

		if (!widget) {
			return;
		}

		// Focus up first
		const previousFocus = widget.getFocus() ? widget.getFocus()[0] : undefined;
		const fakeKeyboardEvent = new KeyboardEvent('keydown');
		widget.focusPrevious(typeof arg2 === 'number' ? arg2 : 1, false, fakeKeyboardEvent);

		// Then adjust selection
		expandMultiSelection(widget, previousFocus);

		const focus = widget.getFocus();

		if (focus.length) {
			widget.reveal(focus[0]);
		}

		ensureDOMFocus(widget);
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
		const widget = accessor.get(IListService).lastFocusedList;

		if (!widget || !(widget instanceof ObjectTree || widget instanceof DataTree || widget instanceof AsyncDataTree)) {
			return;
		}

		const tree = widget;
		const focusedElements = tree.getFocus();

		if (focusedElements.length === 0) {
			return;
		}

		const focus = focusedElements[0];

		if (!tree.collapse(focus)) {
			const parent = tree.getParentElement(focus);

			if (parent) {
				navigate(widget, widget => {
					const fakeKeyboardEvent = new KeyboardEvent('keydown');
					widget.setFocus([parent], fakeKeyboardEvent);
				});
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
		const focused = accessor.get(IListService).lastFocusedList;

		if (focused && !(focused instanceof List || focused instanceof PagedList || focused instanceof Table)) {
			focused.collapseAll();
		}
	}
});


KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.focusParent',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	handler: (accessor) => {
		const widget = accessor.get(IListService).lastFocusedList;

		if (!widget || !(widget instanceof ObjectTree || widget instanceof DataTree || widget instanceof AsyncDataTree)) {
			return;
		}

		const tree = widget;
		const focusedElements = tree.getFocus();
		if (focusedElements.length === 0) {
			return;
		}
		const focus = focusedElements[0];
		const parent = tree.getParentElement(focus);
		if (parent) {
			navigate(widget, widget => {
				const fakeKeyboardEvent = new KeyboardEvent('keydown');
				widget.setFocus([parent], fakeKeyboardEvent);
			});
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.expand',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	primary: KeyCode.RightArrow,
	handler: (accessor) => {
		const widget = accessor.get(IListService).lastFocusedList;

		if (!widget) {
			return;
		}

		if (widget instanceof ObjectTree || widget instanceof DataTree) {
			// TODO@Joao: instead of doing this here, just delegate to a tree method
			const focusedElements = widget.getFocus();

			if (focusedElements.length === 0) {
				return;
			}

			const focus = focusedElements[0];

			if (!widget.expand(focus)) {
				const child = widget.getFirstElementChild(focus);

				if (child) {
					const node = widget.getNode(child);

					if (node.visible) {
						navigate(widget, widget => {
							const fakeKeyboardEvent = new KeyboardEvent('keydown');
							widget.setFocus([child], fakeKeyboardEvent);
						});
					}
				}
			}
		} else if (widget instanceof AsyncDataTree) {
			// TODO@Joao: instead of doing this here, just delegate to a tree method
			const focusedElements = widget.getFocus();

			if (focusedElements.length === 0) {
				return;
			}

			const focus = focusedElements[0];
			widget.expand(focus).then(didExpand => {
				if (focus && !didExpand) {
					const child = widget.getFirstElementChild(focus);

					if (child) {
						const node = widget.getNode(child);

						if (node.visible) {
							navigate(widget, widget => {
								const fakeKeyboardEvent = new KeyboardEvent('keydown');
								widget.setFocus([child], fakeKeyboardEvent);
							});
						}
					}
				}
			});
		}
	}
});

function selectElement(accessor: ServicesAccessor, retainCurrentFocus: boolean): void {
	const focused = accessor.get(IListService).lastFocusedList;
	const fakeKeyboardEvent = getSelectionKeyboardEvent('keydown', retainCurrentFocus);
	// List
	if (focused instanceof List || focused instanceof PagedList || focused instanceof Table) {
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
		selectElement(accessor, false);
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.selectAndPreserveFocus',
	weight: KeybindingWeight.WorkbenchContrib,
	when: WorkbenchListFocusContextKey,
	handler: accessor => {
		selectElement(accessor, true);
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
		if (focused instanceof List || focused instanceof PagedList || focused instanceof Table) {
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

		selectElement(accessor, true);
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: 'list.clear',
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(WorkbenchListFocusContextKey, WorkbenchListHasSelectionOrFocus),
	primary: KeyCode.Escape,
	handler: (accessor) => {
		const widget = accessor.get(IListService).lastFocusedList;

		if (!widget) {
			return;
		}

		const fakeKeyboardEvent = new KeyboardEvent('keydown');
		widget.setSelection([], fakeKeyboardEvent);
		widget.setFocus([], fakeKeyboardEvent);
		widget.setAnchor(undefined);
	}
});

CommandsRegistry.registerCommand({
	id: 'list.toggleKeyboardNavigation',
	handler: (accessor) => {
		const widget = accessor.get(IListService).lastFocusedList;
		widget?.toggleKeyboardNavigation();
	}
});

CommandsRegistry.registerCommand({
	id: 'list.toggleFilterOnType',
	handler: (accessor) => {
		const focused = accessor.get(IListService).lastFocusedList;

		// List
		if (focused instanceof List || focused instanceof PagedList || focused instanceof Table) {
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
