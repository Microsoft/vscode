/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { WalkThroughInput } from 'vs/workbench/contrib/welcome/walkThrough/browser/walkThroughInput';
import { WalkThroughPart } from 'vs/workbench/contrib/welcome/walkThrough/browser/walkThroughPart';
import { WalkThroughArrowUp, WalkThroughArrowDown, WalkThroughPageUp, WalkThroughPageDown } from 'vs/workbench/contrib/welcome/walkThrough/browser/walkThroughActions';
import { WalkThroughSnippetContentProvider } from 'vs/workbench/contrib/welcome/walkThrough/common/walkThroughContentProvider';
import { EditorWalkThroughAction, EditorWalkThroughInputSerializer } from 'vs/workbench/contrib/welcome/walkThrough/browser/editor/editorWalkThrough';
import { Registry } from 'vs/platform/registry/common/platform';
import { EditorExtensions, IEditorInputFactoryRegistry } from 'vs/workbench/common/editor';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IWorkbenchActionRegistry, Extensions, CATEGORIES } from 'vs/workbench/common/actions';
import { SyncActionDescriptor, MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions } from 'vs/workbench/common/contributions';
import { IEditorRegistry, EditorDescriptor } from 'vs/workbench/browser/editor';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';

Registry.as<IEditorRegistry>(EditorExtensions.Editors)
	.registerEditor(EditorDescriptor.create(
		WalkThroughPart,
		WalkThroughPart.ID,
		localize('walkThrough.editor.label', "Interactive Playground"),
	),
		[new SyncDescriptor(WalkThroughInput)]);

Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions)
	.registerWorkbenchAction(
		SyncActionDescriptor.from(EditorWalkThroughAction),
		'Help: Interactive Playground', CATEGORIES.Help.value);

Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).registerEditorInputSerializer(EditorWalkThroughInputSerializer.ID, EditorWalkThroughInputSerializer);

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench)
	.registerWorkbenchContribution(WalkThroughSnippetContentProvider, LifecyclePhase.Starting);

KeybindingsRegistry.registerCommandAndKeybindingRule(WalkThroughArrowUp);

KeybindingsRegistry.registerCommandAndKeybindingRule(WalkThroughArrowDown);

KeybindingsRegistry.registerCommandAndKeybindingRule(WalkThroughPageUp);

KeybindingsRegistry.registerCommandAndKeybindingRule(WalkThroughPageDown);

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
	group: '1_welcome',
	command: {
		id: 'workbench.action.showInteractivePlayground',
		title: localize({ key: 'miInteractivePlayground', comment: ['&& denotes a mnemonic'] }, "I&&nteractive Playground")
	},
	order: 2
});
