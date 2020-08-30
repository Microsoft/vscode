/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { WalkThroughPart, WALK_THROUGH_FOCUS } from 'vs/workbench/contrib/welcome/walkThrough/browser/walkThroughPart';
import { ICommandAndKeybindingRule, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { KeyCode } from 'vs/base/common/keyCodes';

export const WalkThroughArrowUp: ICommandAndKeybindingRule = {
	id: 'workbench.action.interactivePlayground.arrowUp',
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(WALK_THROUGH_FOCUS, EditorContextKeys.editorTextFocus.toNegated()),
	primary: KeyCode.UpArrow,
	handler: accessor => {
		const editorService = accessor.get(IEditorService);
		const activeEditorPane = editorService.activeEditorPane;
		if (activeEditorPane instanceof WalkThroughPart) {
			activeEditorPane.arrowUp();
		}
	}
};

export const WalkThroughArrowDown: ICommandAndKeybindingRule = {
	id: 'workbench.action.interactivePlayground.arrowDown',
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(WALK_THROUGH_FOCUS, EditorContextKeys.editorTextFocus.toNegated()),
	primary: KeyCode.DownArrow,
	handler: accessor => {
		const editorService = accessor.get(IEditorService);
		const activeEditorPane = editorService.activeEditorPane;
		if (activeEditorPane instanceof WalkThroughPart) {
			activeEditorPane.arrowDown();
		}
	}
};

export const WalkThroughPageUp: ICommandAndKeybindingRule = {
	id: 'workbench.action.interactivePlayground.pageUp',
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(WALK_THROUGH_FOCUS, EditorContextKeys.editorTextFocus.toNegated()),
	primary: KeyCode.PageUp,
	handler: accessor => {
		const editorService = accessor.get(IEditorService);
		const activeEditorPane = editorService.activeEditorPane;
		if (activeEditorPane instanceof WalkThroughPart) {
			activeEditorPane.pageUp();
		}
	}
};

export const WalkThroughPageDown: ICommandAndKeybindingRule = {
	id: 'workbench.action.interactivePlayground.pageDown',
	weight: KeybindingWeight.WorkbenchContrib,
	when: ContextKeyExpr.and(WALK_THROUGH_FOCUS, EditorContextKeys.editorTextFocus.toNegated()),
	primary: KeyCode.PageDown,
	handler: accessor => {
		const editorService = accessor.get(IEditorService);
		const activeEditorPane = editorService.activeEditorPane;
		if (activeEditorPane instanceof WalkThroughPart) {
			activeEditorPane.pageDown();
		}
	}
};
