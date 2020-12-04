/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Registry } from 'vs/platform/registry/common/platform';
import * as nls from 'vs/nls';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IEditorRegistry, EditorDescriptor, Extensions as EditorExtensions } from 'vs/workbench/browser/editor';
import { EditorInput, IEditorInputFactory, SideBySideEditorInput, IEditorInputFactoryRegistry, Extensions as EditorInputExtensions, TextCompareEditorActiveContext, ActiveEditorPinnedContext, EditorGroupEditorsCountContext, ActiveEditorStickyContext, ActiveEditorAvailableEditorIdsContext, MultipleEditorGroupsContext, ActiveEditorDirtyContext } from 'vs/workbench/common/editor';
import { TextResourceEditor } from 'vs/workbench/browser/parts/editor/textResourceEditor';
import { SideBySideEditor } from 'vs/workbench/browser/parts/editor/sideBySideEditor';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';
import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { TextDiffEditor } from 'vs/workbench/browser/parts/editor/textDiffEditor';
import { BinaryResourceDiffEditor } from 'vs/workbench/browser/parts/editor/binaryDiffEditor';
import { ChangeEncodingAction, ChangeEOLAction, ChangeModeAction, EditorStatus } from 'vs/workbench/browser/parts/editor/editorStatus';
import { IWorkbenchActionRegistry, Extensions as ActionExtensions, CATEGORIES } from 'vs/workbench/common/actions';
import { SyncActionDescriptor, MenuRegistry, MenuId, IMenuItem } from 'vs/platform/actions/common/actions';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { KeyMod, KeyChord, KeyCode } from 'vs/base/common/keyCodes';
import {
	CloseEditorsInOtherGroupsAction, CloseAllEditorsAction, MoveGroupLeftAction, MoveGroupRightAction, SplitEditorAction, JoinTwoGroupsAction, RevertAndCloseEditorAction,
	NavigateBetweenGroupsAction, FocusActiveGroupAction, FocusFirstGroupAction, ResetGroupSizesAction, MaximizeGroupAction, MinimizeOtherGroupsAction, FocusPreviousGroup, FocusNextGroup,
	CloseLeftEditorsInGroupAction, OpenNextEditor, OpenPreviousEditor, NavigateBackwardsAction, NavigateForwardAction, NavigateLastAction, ReopenClosedEditorAction,
	QuickAccessPreviousRecentlyUsedEditorInGroupAction, QuickAccessPreviousEditorFromHistoryAction, ShowAllEditorsByAppearanceAction, ClearEditorHistoryAction, MoveEditorRightInGroupAction, OpenNextEditorInGroup,
	OpenPreviousEditorInGroup, OpenNextRecentlyUsedEditorAction, OpenPreviousRecentlyUsedEditorAction, MoveEditorToPreviousGroupAction,
	MoveEditorToNextGroupAction, MoveEditorToFirstGroupAction, MoveEditorLeftInGroupAction, ClearRecentFilesAction, OpenLastEditorInGroup,
	ShowEditorsInActiveGroupByMostRecentlyUsedAction, MoveEditorToLastGroupAction, OpenFirstEditorInGroup, MoveGroupUpAction, MoveGroupDownAction, FocusLastGroupAction, SplitEditorLeftAction, SplitEditorRightAction,
	SplitEditorUpAction, SplitEditorDownAction, MoveEditorToLeftGroupAction, MoveEditorToRightGroupAction, MoveEditorToAboveGroupAction, MoveEditorToBelowGroupAction, CloseAllEditorGroupsAction,
	JoinAllGroupsAction, FocusLeftGroup, FocusAboveGroup, FocusRightGroup, FocusBelowGroup, EditorLayoutSingleAction, EditorLayoutTwoColumnsAction, EditorLayoutThreeColumnsAction, EditorLayoutTwoByTwoGridAction,
	EditorLayoutTwoRowsAction, EditorLayoutThreeRowsAction, EditorLayoutTwoColumnsBottomAction, EditorLayoutTwoRowsRightAction, NewEditorGroupLeftAction, NewEditorGroupRightAction,
	NewEditorGroupAboveAction, NewEditorGroupBelowAction, SplitEditorOrthogonalAction, CloseEditorInAllGroupsAction, NavigateToLastEditLocationAction, ToggleGroupSizesAction, ShowAllEditorsByMostRecentlyUsedAction,
	QuickAccessPreviousRecentlyUsedEditorAction, OpenPreviousRecentlyUsedEditorInGroupAction, OpenNextRecentlyUsedEditorInGroupAction, QuickAccessLeastRecentlyUsedEditorAction, QuickAccessLeastRecentlyUsedEditorInGroupAction, ReopenResourcesAction, ToggleEditorTypeAction
} from 'vs/workbench/browser/parts/editor/editorActions';
import * as editorCommands from 'vs/workbench/browser/parts/editor/editorCommands';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { inQuickPickContext, getQuickNavigateHandler } from 'vs/workbench/browser/quickaccess';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ContextKeyExpr, ContextKeyExpression } from 'vs/platform/contextkey/common/contextkey';
import { isMacintosh } from 'vs/base/common/platform';
import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { OpenWorkspaceButtonContribution } from 'vs/workbench/browser/parts/editor/editorWidgets';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { toLocalResource } from 'vs/base/common/resources';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { EditorAutoSave } from 'vs/workbench/browser/parts/editor/editorAutoSave';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { PLAINTEXT_MODE_ID } from 'vs/editor/common/modes/modesRegistry';
import { IQuickAccessRegistry, Extensions as QuickAccessExtensions } from 'vs/platform/quickinput/common/quickAccess';
import { ActiveGroupEditorsByMostRecentlyUsedQuickAccess, AllEditorsByAppearanceQuickAccess, AllEditorsByMostRecentlyUsedQuickAccess } from 'vs/workbench/browser/parts/editor/editorQuickAccess';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { FileAccess } from 'vs/base/common/network';
import { Codicon } from 'vs/base/common/codicons';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';

// Register String Editor
Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
	EditorDescriptor.create(
		TextResourceEditor,
		TextResourceEditor.ID,
		nls.localize('textEditor', "Text Editor"),
	),
	[
		new SyncDescriptor(UntitledTextEditorInput),
		new SyncDescriptor(ResourceEditorInput)
	]
);

// Register Text Diff Editor
Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
	EditorDescriptor.create(
		TextDiffEditor,
		TextDiffEditor.ID,
		nls.localize('textDiffEditor', "Text Diff Editor")
	),
	[
		new SyncDescriptor(DiffEditorInput)
	]
);

// Register Binary Resource Diff Editor
Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
	EditorDescriptor.create(
		BinaryResourceDiffEditor,
		BinaryResourceDiffEditor.ID,
		nls.localize('binaryDiffEditor', "Binary Diff Editor")
	),
	[
		new SyncDescriptor(DiffEditorInput)
	]
);

Registry.as<IEditorRegistry>(EditorExtensions.Editors).registerEditor(
	EditorDescriptor.create(
		SideBySideEditor,
		SideBySideEditor.ID,
		nls.localize('sideBySideEditor', "Side by Side Editor")
	),
	[
		new SyncDescriptor(SideBySideEditorInput)
	]
);

interface ISerializedUntitledTextEditorInput {
	resourceJSON: UriComponents;
	modeId: string | undefined;
	encoding: string | undefined;
}

// Register Editor Input Factory
class UntitledTextEditorInputFactory implements IEditorInputFactory {

	constructor(
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IPathService private readonly pathService: IPathService
	) { }

	canSerialize(editorInput: EditorInput): boolean {
		return this.filesConfigurationService.isHotExitEnabled && !editorInput.isDisposed();
	}

	serialize(editorInput: EditorInput): string | undefined {
		if (!this.filesConfigurationService.isHotExitEnabled || editorInput.isDisposed()) {
			return undefined;
		}

		const untitledTextEditorInput = <UntitledTextEditorInput>editorInput;

		let resource = untitledTextEditorInput.resource;
		if (untitledTextEditorInput.model.hasAssociatedFilePath) {
			resource = toLocalResource(resource, this.environmentService.remoteAuthority, this.pathService.defaultUriScheme); // untitled with associated file path use the local schema
		}

		// Mode: only remember mode if it is either specific (not text)
		// or if the mode was explicitly set by the user. We want to preserve
		// this information across restarts and not set the mode unless
		// this is the case.
		let modeId: string | undefined;
		const modeIdCandidate = untitledTextEditorInput.getMode();
		if (modeIdCandidate !== PLAINTEXT_MODE_ID) {
			modeId = modeIdCandidate;
		} else if (untitledTextEditorInput.model.hasModeSetExplicitly) {
			modeId = modeIdCandidate;
		}

		const serialized: ISerializedUntitledTextEditorInput = {
			resourceJSON: resource.toJSON(),
			modeId,
			encoding: untitledTextEditorInput.getEncoding()
		};

		return JSON.stringify(serialized);
	}

	deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): UntitledTextEditorInput {
		return instantiationService.invokeFunction<UntitledTextEditorInput>(accessor => {
			const deserialized: ISerializedUntitledTextEditorInput = JSON.parse(serializedEditorInput);
			const resource = URI.revive(deserialized.resourceJSON);
			const mode = deserialized.modeId;
			const encoding = deserialized.encoding;

			return accessor.get(IEditorService).createEditorInput({ resource, mode, encoding, forceUntitled: true }) as UntitledTextEditorInput;
		});
	}
}

Registry.as<IEditorInputFactoryRegistry>(EditorInputExtensions.EditorInputFactories).registerEditorInputFactory(UntitledTextEditorInput.ID, UntitledTextEditorInputFactory);

// Register SideBySide/DiffEditor Input Factory
interface ISerializedSideBySideEditorInput {
	name: string;
	description: string | undefined;

	primarySerialized: string;
	secondarySerialized: string;

	primaryTypeId: string;
	secondaryTypeId: string;
}

export abstract class AbstractSideBySideEditorInputFactory implements IEditorInputFactory {

	private getInputFactories(secondaryId: string, primaryId: string): [IEditorInputFactory | undefined, IEditorInputFactory | undefined] {
		const registry = Registry.as<IEditorInputFactoryRegistry>(EditorInputExtensions.EditorInputFactories);

		return [registry.getEditorInputFactory(secondaryId), registry.getEditorInputFactory(primaryId)];
	}

	canSerialize(editorInput: EditorInput): boolean {
		const input = editorInput as SideBySideEditorInput | DiffEditorInput;

		if (input.primary && input.secondary) {
			const [secondaryInputFactory, primaryInputFactory] = this.getInputFactories(input.secondary.getTypeId(), input.primary.getTypeId());

			return !!(secondaryInputFactory?.canSerialize(input.secondary) && primaryInputFactory?.canSerialize(input.primary));
		}

		return false;
	}

	serialize(editorInput: EditorInput): string | undefined {
		const input = editorInput as SideBySideEditorInput | DiffEditorInput;

		if (input.primary && input.secondary) {
			const [secondaryInputFactory, primaryInputFactory] = this.getInputFactories(input.secondary.getTypeId(), input.primary.getTypeId());
			if (primaryInputFactory && secondaryInputFactory) {
				const primarySerialized = primaryInputFactory.serialize(input.primary);
				const secondarySerialized = secondaryInputFactory.serialize(input.secondary);

				if (primarySerialized && secondarySerialized) {
					const serializedEditorInput: ISerializedSideBySideEditorInput = {
						name: input.getName(),
						description: input.getDescription(),
						primarySerialized: primarySerialized,
						secondarySerialized: secondarySerialized,
						primaryTypeId: input.primary.getTypeId(),
						secondaryTypeId: input.secondary.getTypeId()
					};

					return JSON.stringify(serializedEditorInput);
				}
			}
		}

		return undefined;
	}

	deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): EditorInput | undefined {
		const deserialized: ISerializedSideBySideEditorInput = JSON.parse(serializedEditorInput);

		const [secondaryInputFactory, primaryInputFactory] = this.getInputFactories(deserialized.secondaryTypeId, deserialized.primaryTypeId);
		if (primaryInputFactory && secondaryInputFactory) {
			const primaryInput = primaryInputFactory.deserialize(instantiationService, deserialized.primarySerialized);
			const secondaryInput = secondaryInputFactory.deserialize(instantiationService, deserialized.secondarySerialized);

			if (primaryInput && secondaryInput) {
				return this.createEditorInput(instantiationService, deserialized.name, deserialized.description, secondaryInput, primaryInput);
			}
		}

		return undefined;
	}

	protected abstract createEditorInput(instantiationService: IInstantiationService, name: string, description: string | undefined, secondaryInput: EditorInput, primaryInput: EditorInput): EditorInput;
}

class SideBySideEditorInputFactory extends AbstractSideBySideEditorInputFactory {

	protected createEditorInput(instantiationService: IInstantiationService, name: string, description: string | undefined, secondaryInput: EditorInput, primaryInput: EditorInput): EditorInput {
		return new SideBySideEditorInput(name, description, secondaryInput, primaryInput);
	}
}

class DiffEditorInputFactory extends AbstractSideBySideEditorInputFactory {

	protected createEditorInput(instantiationService: IInstantiationService, name: string, description: string | undefined, secondaryInput: EditorInput, primaryInput: EditorInput): EditorInput {
		return instantiationService.createInstance(DiffEditorInput, name, description, secondaryInput, primaryInput, undefined);
	}
}

Registry.as<IEditorInputFactoryRegistry>(EditorInputExtensions.EditorInputFactories).registerEditorInputFactory(SideBySideEditorInput.ID, SideBySideEditorInputFactory);
Registry.as<IEditorInputFactoryRegistry>(EditorInputExtensions.EditorInputFactories).registerEditorInputFactory(DiffEditorInput.ID, DiffEditorInputFactory);

// Register Editor Contributions
registerEditorContribution(OpenWorkspaceButtonContribution.ID, OpenWorkspaceButtonContribution);

// Register Editor Status
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(EditorStatus, LifecyclePhase.Ready);

// Register Editor Auto Save
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(EditorAutoSave, LifecyclePhase.Ready);

// Register Status Actions
const registry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
registry.registerWorkbenchAction(SyncActionDescriptor.from(ChangeModeAction, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.KEY_M) }), 'Change Language Mode');
registry.registerWorkbenchAction(SyncActionDescriptor.from(ChangeEOLAction), 'Change End of Line Sequence');
registry.registerWorkbenchAction(SyncActionDescriptor.from(ChangeEncodingAction), 'Change File Encoding');

// Register Editor Quick Access
const quickAccessRegistry = Registry.as<IQuickAccessRegistry>(QuickAccessExtensions.Quickaccess);
const editorPickerContextKey = 'inEditorsPicker';
const editorPickerContext = ContextKeyExpr.and(inQuickPickContext, ContextKeyExpr.has(editorPickerContextKey));

quickAccessRegistry.registerQuickAccessProvider({
	ctor: ActiveGroupEditorsByMostRecentlyUsedQuickAccess,
	prefix: ActiveGroupEditorsByMostRecentlyUsedQuickAccess.PREFIX,
	contextKey: editorPickerContextKey,
	placeholder: nls.localize('editorQuickAccessPlaceholder', "Type the name of an editor to open it."),
	helpEntries: [{ description: nls.localize('activeGroupEditorsByMostRecentlyUsedQuickAccess', "Show Editors in Active Group by Most Recently Used"), needsEditor: false }]
});

quickAccessRegistry.registerQuickAccessProvider({
	ctor: AllEditorsByAppearanceQuickAccess,
	prefix: AllEditorsByAppearanceQuickAccess.PREFIX,
	contextKey: editorPickerContextKey,
	placeholder: nls.localize('editorQuickAccessPlaceholder', "Type the name of an editor to open it."),
	helpEntries: [{ description: nls.localize('allEditorsByAppearanceQuickAccess', "Show All Opened Editors By Appearance"), needsEditor: false }]
});

quickAccessRegistry.registerQuickAccessProvider({
	ctor: AllEditorsByMostRecentlyUsedQuickAccess,
	prefix: AllEditorsByMostRecentlyUsedQuickAccess.PREFIX,
	contextKey: editorPickerContextKey,
	placeholder: nls.localize('editorQuickAccessPlaceholder', "Type the name of an editor to open it."),
	helpEntries: [{ description: nls.localize('allEditorsByMostRecentlyUsedQuickAccess', "Show All Opened Editors By Most Recently Used"), needsEditor: false }]
});

// Register Editor Actions
registry.registerWorkbenchAction(SyncActionDescriptor.from(OpenNextEditor, { primary: KeyMod.CtrlCmd | KeyCode.PageDown, mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.RightArrow, secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_CLOSE_SQUARE_BRACKET] } }), 'View: Open Next Editor', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(OpenPreviousEditor, { primary: KeyMod.CtrlCmd | KeyCode.PageUp, mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.LeftArrow, secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_OPEN_SQUARE_BRACKET] } }), 'View: Open Previous Editor', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(OpenNextEditorInGroup, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.PageDown), mac: { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.RightArrow) } }), 'View: Open Next Editor in Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(OpenPreviousEditorInGroup, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.PageUp), mac: { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.LeftArrow) } }), 'View: Open Previous Editor in Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(OpenNextRecentlyUsedEditorAction), 'View: Open Next Recently Used Editor', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(OpenPreviousRecentlyUsedEditorAction), 'View: Open Previous Recently Used Editor', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(OpenNextRecentlyUsedEditorInGroupAction), 'View: Open Next Recently Used Editor In Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(OpenPreviousRecentlyUsedEditorInGroupAction), 'View: Open Previous Recently Used Editor In Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(OpenFirstEditorInGroup), 'View: Open First Editor in Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(OpenLastEditorInGroup, { primary: KeyMod.Alt | KeyCode.KEY_0, secondary: [KeyMod.CtrlCmd | KeyCode.KEY_9], mac: { primary: KeyMod.WinCtrl | KeyCode.KEY_0, secondary: [KeyMod.CtrlCmd | KeyCode.KEY_9] } }), 'View: Open Last Editor in Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(ReopenClosedEditorAction, { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_T }), 'View: Reopen Closed Editor', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(ShowAllEditorsByAppearanceAction, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_P), mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.Tab } }), 'View: Show All Editors By Appearance', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(ShowAllEditorsByMostRecentlyUsedAction), 'View: Show All Editors By Most Recently Used', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(ShowEditorsInActiveGroupByMostRecentlyUsedAction), 'View: Show Editors in Active Group By Most Recently Used', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(ClearRecentFilesAction), 'File: Clear Recently Opened', nls.localize('file', "File"));
registry.registerWorkbenchAction(SyncActionDescriptor.from(CloseAllEditorsAction, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_W) }), 'View: Close All Editors', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(CloseAllEditorGroupsAction, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_W) }), 'View: Close All Editor Groups', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(CloseLeftEditorsInGroupAction), 'View: Close Editors to the Left in Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(CloseEditorsInOtherGroupsAction), 'View: Close Editors in Other Groups', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(CloseEditorInAllGroupsAction), 'View: Close Editor in All Groups', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(SplitEditorAction, { primary: KeyMod.CtrlCmd | KeyCode.US_BACKSLASH }), 'View: Split Editor', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(SplitEditorOrthogonalAction, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.US_BACKSLASH) }), 'View: Split Editor Orthogonal', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(SplitEditorLeftAction), 'View: Split Editor Left', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(SplitEditorRightAction), 'View: Split Editor Right', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(SplitEditorUpAction), 'Split Editor Up', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(SplitEditorDownAction), 'View: Split Editor Down', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(JoinTwoGroupsAction), 'View: Join Editor Group with Next Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(JoinAllGroupsAction), 'View: Join All Editor Groups', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(NavigateBetweenGroupsAction), 'View: Navigate Between Editor Groups', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(ResetGroupSizesAction), 'View: Reset Editor Group Sizes', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleGroupSizesAction), 'View: Toggle Editor Group Sizes', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(MaximizeGroupAction), 'View: Maximize Editor Group and Hide Side Bar', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(MinimizeOtherGroupsAction), 'View: Maximize Editor Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(MoveEditorLeftInGroupAction, { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.PageUp, mac: { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.LeftArrow) } }), 'View: Move Editor Left', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(MoveEditorRightInGroupAction, { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.PageDown, mac: { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.RightArrow) } }), 'View: Move Editor Right', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(MoveGroupLeftAction, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.LeftArrow) }), 'View: Move Editor Group Left', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(MoveGroupRightAction, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.RightArrow) }), 'View: Move Editor Group Right', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(MoveGroupUpAction, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.UpArrow) }), 'View: Move Editor Group Up', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(MoveGroupDownAction, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.DownArrow) }), 'View: Move Editor Group Down', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(MoveEditorToPreviousGroupAction, { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.LeftArrow, mac: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.LeftArrow } }), 'View: Move Editor into Previous Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(MoveEditorToNextGroupAction, { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.RightArrow, mac: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.RightArrow } }), 'View: Move Editor into Next Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(MoveEditorToFirstGroupAction, { primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KEY_1, mac: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KEY_1 } }), 'View: Move Editor into First Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(MoveEditorToLastGroupAction, { primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KEY_9, mac: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KEY_9 } }), 'View: Move Editor into Last Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(MoveEditorToLeftGroupAction), 'View: Move Editor into Left Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(MoveEditorToRightGroupAction), 'View: Move Editor into Right Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(MoveEditorToAboveGroupAction), 'View: Move Editor into Above Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(MoveEditorToBelowGroupAction), 'View: Move Editor into Below Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(FocusActiveGroupAction), 'View: Focus Active Editor Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(FocusFirstGroupAction, { primary: KeyMod.CtrlCmd | KeyCode.KEY_1 }), 'View: Focus First Editor Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(FocusLastGroupAction), 'View: Focus Last Editor Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(FocusPreviousGroup), 'View: Focus Previous Editor Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(FocusNextGroup), 'View: Focus Next Editor Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(FocusLeftGroup, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.LeftArrow) }), 'View: Focus Left Editor Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(FocusRightGroup, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.RightArrow) }), 'View: Focus Right Editor Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(FocusAboveGroup, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.UpArrow) }), 'View: Focus Above Editor Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(FocusBelowGroup, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.DownArrow) }), 'View: Focus Below Editor Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(NewEditorGroupLeftAction), 'View: New Editor Group to the Left', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(NewEditorGroupRightAction), 'View: New Editor Group to the Right', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(NewEditorGroupAboveAction), 'View: New Editor Group Above', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(NewEditorGroupBelowAction), 'View: New Editor Group Below', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(NavigateForwardAction, { primary: 0, win: { primary: KeyMod.Alt | KeyCode.RightArrow }, mac: { primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.US_MINUS }, linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_MINUS } }), 'Go Forward');
registry.registerWorkbenchAction(SyncActionDescriptor.from(NavigateBackwardsAction, { primary: 0, win: { primary: KeyMod.Alt | KeyCode.LeftArrow }, mac: { primary: KeyMod.WinCtrl | KeyCode.US_MINUS }, linux: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.US_MINUS } }), 'Go Back');
registry.registerWorkbenchAction(SyncActionDescriptor.from(NavigateToLastEditLocationAction, { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyCode.KEY_Q) }), 'Go to Last Edit Location');
registry.registerWorkbenchAction(SyncActionDescriptor.from(NavigateLastAction), 'Go Last');
registry.registerWorkbenchAction(SyncActionDescriptor.from(ClearEditorHistoryAction), 'Clear Editor History');
registry.registerWorkbenchAction(SyncActionDescriptor.from(RevertAndCloseEditorAction), 'View: Revert and Close Editor', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(EditorLayoutSingleAction), 'View: Single Column Editor Layout', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(EditorLayoutTwoColumnsAction), 'View: Two Columns Editor Layout', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(EditorLayoutThreeColumnsAction), 'View: Three Columns Editor Layout', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(EditorLayoutTwoRowsAction), 'View: Two Rows Editor Layout', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(EditorLayoutThreeRowsAction), 'View: Three Rows Editor Layout', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(EditorLayoutTwoByTwoGridAction), 'View: Grid Editor Layout (2x2)', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(EditorLayoutTwoRowsRightAction), 'View: Two Rows Right Editor Layout', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(EditorLayoutTwoColumnsBottomAction), 'View: Two Columns Bottom Editor Layout', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(ReopenResourcesAction), 'View: Reopen Editor With...', CATEGORIES.View.value, ActiveEditorAvailableEditorIdsContext);
registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleEditorTypeAction), 'View: Toggle Editor Type', CATEGORIES.View.value, ActiveEditorAvailableEditorIdsContext);

// Register Quick Editor Actions including built in quick navigate support for some

registry.registerWorkbenchAction(SyncActionDescriptor.from(QuickAccessPreviousRecentlyUsedEditorAction), 'View: Quick Open Previous Recently Used Editor', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(QuickAccessLeastRecentlyUsedEditorAction), 'View: Quick Open Least Recently Used Editor', CATEGORIES.View.value);

registry.registerWorkbenchAction(SyncActionDescriptor.from(QuickAccessPreviousRecentlyUsedEditorInGroupAction, { primary: KeyMod.CtrlCmd | KeyCode.Tab, mac: { primary: KeyMod.WinCtrl | KeyCode.Tab } }), 'View: Quick Open Previous Recently Used Editor in Group', CATEGORIES.View.value);
registry.registerWorkbenchAction(SyncActionDescriptor.from(QuickAccessLeastRecentlyUsedEditorInGroupAction, { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Tab, mac: { primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.Tab } }), 'View: Quick Open Least Recently Used Editor in Group', CATEGORIES.View.value);

registry.registerWorkbenchAction(SyncActionDescriptor.from(QuickAccessPreviousEditorFromHistoryAction), 'Quick Open Previous Editor from History');

const quickAccessNavigateNextInEditorPickerId = 'workbench.action.quickOpenNavigateNextInEditorPicker';
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: quickAccessNavigateNextInEditorPickerId,
	weight: KeybindingWeight.WorkbenchContrib + 50,
	handler: getQuickNavigateHandler(quickAccessNavigateNextInEditorPickerId, true),
	when: editorPickerContext,
	primary: KeyMod.CtrlCmd | KeyCode.Tab,
	mac: { primary: KeyMod.WinCtrl | KeyCode.Tab }
});

const quickAccessNavigatePreviousInEditorPickerId = 'workbench.action.quickOpenNavigatePreviousInEditorPicker';
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: quickAccessNavigatePreviousInEditorPickerId,
	weight: KeybindingWeight.WorkbenchContrib + 50,
	handler: getQuickNavigateHandler(quickAccessNavigatePreviousInEditorPickerId, false),
	when: editorPickerContext,
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.Tab,
	mac: { primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.Tab }
});

// Editor Commands
editorCommands.setup();

// Touch Bar
if (isMacintosh) {
	MenuRegistry.appendMenuItem(MenuId.TouchBarContext, {
		command: { id: NavigateBackwardsAction.ID, title: NavigateBackwardsAction.LABEL, icon: { dark: FileAccess.asFileUri('vs/workbench/browser/parts/editor/media/back-tb.png', require) } },
		group: 'navigation',
		order: 0
	});

	MenuRegistry.appendMenuItem(MenuId.TouchBarContext, {
		command: { id: NavigateForwardAction.ID, title: NavigateForwardAction.LABEL, icon: { dark: FileAccess.asFileUri('vs/workbench/browser/parts/editor/media/forward-tb.png', require) } },
		group: 'navigation',
		order: 1
	});
}

// Empty Editor Group Context Menu
MenuRegistry.appendMenuItem(MenuId.EmptyEditorGroupContext, { command: { id: editorCommands.SPLIT_EDITOR_UP, title: nls.localize('splitUp', "Split Up") }, group: '2_split', order: 10 });
MenuRegistry.appendMenuItem(MenuId.EmptyEditorGroupContext, { command: { id: editorCommands.SPLIT_EDITOR_DOWN, title: nls.localize('splitDown', "Split Down") }, group: '2_split', order: 20 });
MenuRegistry.appendMenuItem(MenuId.EmptyEditorGroupContext, { command: { id: editorCommands.SPLIT_EDITOR_LEFT, title: nls.localize('splitLeft', "Split Left") }, group: '2_split', order: 30 });
MenuRegistry.appendMenuItem(MenuId.EmptyEditorGroupContext, { command: { id: editorCommands.SPLIT_EDITOR_RIGHT, title: nls.localize('splitRight', "Split Right") }, group: '2_split', order: 40 });
MenuRegistry.appendMenuItem(MenuId.EmptyEditorGroupContext, { command: { id: editorCommands.CLOSE_EDITOR_GROUP_COMMAND_ID, title: nls.localize('close', "Close") }, group: '3_close', order: 10, when: ContextKeyExpr.has('multipleEditorGroups') });

// Editor Title Context Menu
MenuRegistry.appendMenuItem(MenuId.EditorTitleContext, { command: { id: editorCommands.CLOSE_EDITOR_COMMAND_ID, title: nls.localize('close', "Close") }, group: '1_close', order: 10 });
MenuRegistry.appendMenuItem(MenuId.EditorTitleContext, { command: { id: editorCommands.CLOSE_OTHER_EDITORS_IN_GROUP_COMMAND_ID, title: nls.localize('closeOthers', "Close Others"), precondition: EditorGroupEditorsCountContext.notEqualsTo('1') }, group: '1_close', order: 20 });
MenuRegistry.appendMenuItem(MenuId.EditorTitleContext, { command: { id: editorCommands.CLOSE_EDITORS_TO_THE_RIGHT_COMMAND_ID, title: nls.localize('closeRight', "Close to the Right"), precondition: EditorGroupEditorsCountContext.notEqualsTo('1') }, group: '1_close', order: 30, when: ContextKeyExpr.has('config.workbench.editor.showTabs') });
MenuRegistry.appendMenuItem(MenuId.EditorTitleContext, { command: { id: editorCommands.CLOSE_SAVED_EDITORS_COMMAND_ID, title: nls.localize('closeAllSaved', "Close Saved") }, group: '1_close', order: 40 });
MenuRegistry.appendMenuItem(MenuId.EditorTitleContext, { command: { id: editorCommands.CLOSE_EDITORS_IN_GROUP_COMMAND_ID, title: nls.localize('closeAll', "Close All") }, group: '1_close', order: 50 });
MenuRegistry.appendMenuItem(MenuId.EditorTitleContext, { command: { id: ReopenResourcesAction.ID, title: ReopenResourcesAction.LABEL }, group: '1_open', order: 10, when: ActiveEditorAvailableEditorIdsContext });
MenuRegistry.appendMenuItem(MenuId.EditorTitleContext, { command: { id: editorCommands.KEEP_EDITOR_COMMAND_ID, title: nls.localize('keepOpen', "Keep Open"), precondition: ActiveEditorPinnedContext.toNegated() }, group: '3_preview', order: 10, when: ContextKeyExpr.has('config.workbench.editor.enablePreview') });
MenuRegistry.appendMenuItem(MenuId.EditorTitleContext, { command: { id: editorCommands.PIN_EDITOR_COMMAND_ID, title: nls.localize('pin', "Pin") }, group: '3_preview', order: 20, when: ActiveEditorStickyContext.toNegated() });
MenuRegistry.appendMenuItem(MenuId.EditorTitleContext, { command: { id: editorCommands.UNPIN_EDITOR_COMMAND_ID, title: nls.localize('unpin', "Unpin") }, group: '3_preview', order: 20, when: ActiveEditorStickyContext });
MenuRegistry.appendMenuItem(MenuId.EditorTitleContext, { command: { id: editorCommands.SPLIT_EDITOR_UP, title: nls.localize('splitUp', "Split Up") }, group: '5_split', order: 10 });
MenuRegistry.appendMenuItem(MenuId.EditorTitleContext, { command: { id: editorCommands.SPLIT_EDITOR_DOWN, title: nls.localize('splitDown', "Split Down") }, group: '5_split', order: 20 });
MenuRegistry.appendMenuItem(MenuId.EditorTitleContext, { command: { id: editorCommands.SPLIT_EDITOR_LEFT, title: nls.localize('splitLeft', "Split Left") }, group: '5_split', order: 30 });
MenuRegistry.appendMenuItem(MenuId.EditorTitleContext, { command: { id: editorCommands.SPLIT_EDITOR_RIGHT, title: nls.localize('splitRight', "Split Right") }, group: '5_split', order: 40 });

// Editor Title Menu
MenuRegistry.appendMenuItem(MenuId.EditorTitle, { command: { id: editorCommands.TOGGLE_DIFF_SIDE_BY_SIDE, title: nls.localize('toggleInlineView', "Toggle Inline View") }, group: '1_diff', order: 10, when: ContextKeyExpr.has('isInDiffEditor') });
MenuRegistry.appendMenuItem(MenuId.EditorTitle, { command: { id: editorCommands.SHOW_EDITORS_IN_GROUP, title: nls.localize('showOpenedEditors', "Show Opened Editors") }, group: '3_open', order: 10 });
MenuRegistry.appendMenuItem(MenuId.EditorTitle, { command: { id: editorCommands.CLOSE_EDITORS_IN_GROUP_COMMAND_ID, title: nls.localize('closeAll', "Close All") }, group: '5_close', order: 10 });
MenuRegistry.appendMenuItem(MenuId.EditorTitle, { command: { id: editorCommands.CLOSE_SAVED_EDITORS_COMMAND_ID, title: nls.localize('closeAllSaved', "Close Saved") }, group: '5_close', order: 20 });
MenuRegistry.appendMenuItem(MenuId.EditorTitle, { command: { id: editorCommands.TOGGLE_KEEP_EDITORS_COMMAND_ID, title: nls.localize('toggleKeepEditors', "Keep Editors Open"), toggled: ContextKeyExpr.not('config.workbench.editor.enablePreview') }, group: '7_settings', order: 10 });

interface IEditorToolItem { id: string; title: string; icon?: { dark?: URI; light?: URI; } | ThemeIcon; }

function appendEditorToolItem(primary: IEditorToolItem, when: ContextKeyExpression | undefined, order: number, alternative?: IEditorToolItem, precondition?: ContextKeyExpression | undefined): void {
	const item: IMenuItem = {
		command: {
			id: primary.id,
			title: primary.title,
			icon: primary.icon,
			precondition
		},
		group: 'navigation',
		when,
		order
	};

	if (alternative) {
		item.alt = {
			id: alternative.id,
			title: alternative.title,
			icon: alternative.icon
		};
	}

	MenuRegistry.appendMenuItem(MenuId.EditorTitle, item);
}

// Editor Title Menu: Split Editor
appendEditorToolItem(
	{
		id: SplitEditorAction.ID,
		title: nls.localize('splitEditorRight', "Split Editor Right"),
		icon: Codicon.splitHorizontal
	},
	ContextKeyExpr.not('splitEditorsVertically'),
	100000, // towards the end
	{
		id: editorCommands.SPLIT_EDITOR_DOWN,
		title: nls.localize('splitEditorDown', "Split Editor Down"),
		icon: Codicon.splitVertical
	}
);

appendEditorToolItem(
	{
		id: SplitEditorAction.ID,
		title: nls.localize('splitEditorDown', "Split Editor Down"),
		icon: Codicon.splitVertical
	},
	ContextKeyExpr.has('splitEditorsVertically'),
	100000, // towards the end
	{
		id: editorCommands.SPLIT_EDITOR_RIGHT,
		title: nls.localize('splitEditorRight', "Split Editor Right"),
		icon: Codicon.splitHorizontal
	}
);

// Editor Title Menu: Close (tabs disabled, normal editor)
appendEditorToolItem(
	{
		id: editorCommands.CLOSE_EDITOR_COMMAND_ID,
		title: nls.localize('close', "Close"),
		icon: Codicon.close
	},
	ContextKeyExpr.and(ContextKeyExpr.not('config.workbench.editor.showTabs'), ActiveEditorDirtyContext.toNegated(), ActiveEditorStickyContext.toNegated()),
	1000000, // towards the far end
	{
		id: editorCommands.CLOSE_EDITORS_IN_GROUP_COMMAND_ID,
		title: nls.localize('closeAll', "Close All"),
		icon: Codicon.closeAll
	}
);

// Editor Title Menu: Close (tabs disabled, dirty editor)
appendEditorToolItem(
	{
		id: editorCommands.CLOSE_EDITOR_COMMAND_ID,
		title: nls.localize('close', "Close"),
		icon: Codicon.closeDirty
	},
	ContextKeyExpr.and(ContextKeyExpr.not('config.workbench.editor.showTabs'), ActiveEditorDirtyContext, ActiveEditorStickyContext.toNegated()),
	1000000, // towards the far end
	{
		id: editorCommands.CLOSE_EDITORS_IN_GROUP_COMMAND_ID,
		title: nls.localize('closeAll', "Close All"),
		icon: Codicon.closeAll
	}
);

// Editor Title Menu: Close (tabs disabled, sticky editor)
appendEditorToolItem(
	{
		id: editorCommands.UNPIN_EDITOR_COMMAND_ID,
		title: nls.localize('unpin', "Unpin"),
		icon: Codicon.pinned
	},
	ContextKeyExpr.and(ContextKeyExpr.not('config.workbench.editor.showTabs'), ActiveEditorDirtyContext.toNegated(), ActiveEditorStickyContext),
	1000000, // towards the far end
	{
		id: editorCommands.CLOSE_EDITOR_COMMAND_ID,
		title: nls.localize('close', "Close"),
		icon: Codicon.close
	}
);

// Editor Title Menu: Close (tabs disabled, dirty & sticky editor)
appendEditorToolItem(
	{
		id: editorCommands.UNPIN_EDITOR_COMMAND_ID,
		title: nls.localize('unpin', "Unpin"),
		icon: Codicon.pinnedDirty
	},
	ContextKeyExpr.and(ContextKeyExpr.not('config.workbench.editor.showTabs'), ActiveEditorDirtyContext, ActiveEditorStickyContext),
	1000000, // towards the far end
	{
		id: editorCommands.CLOSE_EDITOR_COMMAND_ID,
		title: nls.localize('close', "Close"),
		icon: Codicon.close
	}
);

const previousChangeIcon = registerIcon('diff-editor-previous-change', Codicon.arrowUp, nls.localize('previousChangeIcon', 'Icon for the previous change action in the diff editor.'));
const nextChangeIcon = registerIcon('diff-editor-next-change', Codicon.arrowDown, nls.localize('nextChangeIcon', 'Icon for the next change action in the diff editor.'));
const toggleWhitespace = registerIcon('diff-editor-toggle-whitespace', Codicon.whitespace, nls.localize('toggleWhitespace', 'Icon for the toggle whitespace action in the diff editor.'));


// Diff Editor Title Menu: Previous Change
appendEditorToolItem(
	{
		id: editorCommands.GOTO_PREVIOUS_CHANGE,
		title: nls.localize('navigate.prev.label', "Previous Change"),
		icon: previousChangeIcon
	},
	TextCompareEditorActiveContext,
	10
);

// Diff Editor Title Menu: Next Change
appendEditorToolItem(
	{
		id: editorCommands.GOTO_NEXT_CHANGE,
		title: nls.localize('navigate.next.label', "Next Change"),
		icon: nextChangeIcon
	},
	TextCompareEditorActiveContext,
	11
);

// Diff Editor Title Menu: Toggle Ignore Trim Whitespace (Enabled)
appendEditorToolItem(
	{
		id: editorCommands.TOGGLE_DIFF_IGNORE_TRIM_WHITESPACE,
		title: nls.localize('ignoreTrimWhitespace.label', "Ignore Leading/Trailing Whitespace Differences"),
		icon: toggleWhitespace
	},
	ContextKeyExpr.and(TextCompareEditorActiveContext, ContextKeyExpr.notEquals('config.diffEditor.ignoreTrimWhitespace', true)),
	20
);

// Diff Editor Title Menu: Toggle Ignore Trim Whitespace (Disabled)
appendEditorToolItem(
	{
		id: editorCommands.TOGGLE_DIFF_IGNORE_TRIM_WHITESPACE,
		title: nls.localize('showTrimWhitespace.label', "Show Leading/Trailing Whitespace Differences"),
		icon: ThemeIcon.modify(toggleWhitespace, 'disabled')
	},
	ContextKeyExpr.and(TextCompareEditorActiveContext, ContextKeyExpr.notEquals('config.diffEditor.ignoreTrimWhitespace', false)),
	20
);

// Editor Commands for Command Palette
MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: editorCommands.KEEP_EDITOR_COMMAND_ID, title: { value: nls.localize('keepEditor', "Keep Editor"), original: 'Keep Editor' }, category: CATEGORIES.View }, when: ContextKeyExpr.has('config.workbench.editor.enablePreview') });
MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: editorCommands.PIN_EDITOR_COMMAND_ID, title: { value: nls.localize('pinEditor', "Pin Editor"), original: 'Pin Editor' }, category: CATEGORIES.View } });
MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: editorCommands.UNPIN_EDITOR_COMMAND_ID, title: { value: nls.localize('unpinEditor', "Unpin Editor"), original: 'Unpin Editor' }, category: CATEGORIES.View } });
MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: editorCommands.CLOSE_EDITOR_COMMAND_ID, title: { value: nls.localize('closeEditor', "Close Editor"), original: 'Close Editor' }, category: CATEGORIES.View } });
MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: editorCommands.CLOSE_PINNED_EDITOR_COMMAND_ID, title: { value: nls.localize('closePinnedEditor', "Close Pinned Editor"), original: 'Close Pinned Editor' }, category: CATEGORIES.View } });
MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: editorCommands.CLOSE_EDITORS_IN_GROUP_COMMAND_ID, title: { value: nls.localize('closeEditorsInGroup', "Close All Editors in Group"), original: 'Close All Editors in Group' }, category: CATEGORIES.View } });
MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: editorCommands.CLOSE_SAVED_EDITORS_COMMAND_ID, title: { value: nls.localize('closeSavedEditors', "Close Saved Editors in Group"), original: 'Close Saved Editors in Group' }, category: CATEGORIES.View } });
MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: editorCommands.CLOSE_OTHER_EDITORS_IN_GROUP_COMMAND_ID, title: { value: nls.localize('closeOtherEditors', "Close Other Editors in Group"), original: 'Close Other Editors in Group' }, category: CATEGORIES.View } });
MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: editorCommands.CLOSE_EDITORS_TO_THE_RIGHT_COMMAND_ID, title: { value: nls.localize('closeRightEditors', "Close Editors to the Right in Group"), original: 'Close Editors to the Right in Group' }, category: CATEGORIES.View } });
MenuRegistry.appendMenuItem(MenuId.CommandPalette, { command: { id: editorCommands.CLOSE_EDITORS_AND_GROUP_COMMAND_ID, title: { value: nls.localize('closeEditorGroup', "Close Editor Group"), original: 'Close Editor Group' }, category: CATEGORIES.View }, when: MultipleEditorGroupsContext });

// File menu
MenuRegistry.appendMenuItem(MenuId.MenubarRecentMenu, {
	group: '1_editor',
	command: {
		id: ReopenClosedEditorAction.ID,
		title: nls.localize({ key: 'miReopenClosedEditor', comment: ['&& denotes a mnemonic'] }, "&&Reopen Closed Editor"),
		precondition: ContextKeyExpr.has('canReopenClosedEditor')
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarRecentMenu, {
	group: 'z_clear',
	command: {
		id: ClearRecentFilesAction.ID,
		title: nls.localize({ key: 'miClearRecentOpen', comment: ['&& denotes a mnemonic'] }, "&&Clear Recently Opened")
	},
	order: 1
});

// Layout menu
MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '2_appearance',
	title: nls.localize({ key: 'miEditorLayout', comment: ['&& denotes a mnemonic'] }, "Editor &&Layout"),
	submenu: MenuId.MenubarLayoutMenu,
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarLayoutMenu, {
	group: '1_split',
	command: {
		id: editorCommands.SPLIT_EDITOR_UP,
		title: nls.localize({ key: 'miSplitEditorUp', comment: ['&& denotes a mnemonic'] }, "Split &&Up")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarLayoutMenu, {
	group: '1_split',
	command: {
		id: editorCommands.SPLIT_EDITOR_DOWN,
		title: nls.localize({ key: 'miSplitEditorDown', comment: ['&& denotes a mnemonic'] }, "Split &&Down")
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarLayoutMenu, {
	group: '1_split',
	command: {
		id: editorCommands.SPLIT_EDITOR_LEFT,
		title: nls.localize({ key: 'miSplitEditorLeft', comment: ['&& denotes a mnemonic'] }, "Split &&Left")
	},
	order: 3
});

MenuRegistry.appendMenuItem(MenuId.MenubarLayoutMenu, {
	group: '1_split',
	command: {
		id: editorCommands.SPLIT_EDITOR_RIGHT,
		title: nls.localize({ key: 'miSplitEditorRight', comment: ['&& denotes a mnemonic'] }, "Split &&Right")
	},
	order: 4
});

MenuRegistry.appendMenuItem(MenuId.MenubarLayoutMenu, {
	group: '2_layouts',
	command: {
		id: EditorLayoutSingleAction.ID,
		title: nls.localize({ key: 'miSingleColumnEditorLayout', comment: ['&& denotes a mnemonic'] }, "&&Single")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarLayoutMenu, {
	group: '2_layouts',
	command: {
		id: EditorLayoutTwoColumnsAction.ID,
		title: nls.localize({ key: 'miTwoColumnsEditorLayout', comment: ['&& denotes a mnemonic'] }, "&&Two Columns")
	},
	order: 3
});

MenuRegistry.appendMenuItem(MenuId.MenubarLayoutMenu, {
	group: '2_layouts',
	command: {
		id: EditorLayoutThreeColumnsAction.ID,
		title: nls.localize({ key: 'miThreeColumnsEditorLayout', comment: ['&& denotes a mnemonic'] }, "T&&hree Columns")
	},
	order: 4
});

MenuRegistry.appendMenuItem(MenuId.MenubarLayoutMenu, {
	group: '2_layouts',
	command: {
		id: EditorLayoutTwoRowsAction.ID,
		title: nls.localize({ key: 'miTwoRowsEditorLayout', comment: ['&& denotes a mnemonic'] }, "T&&wo Rows")
	},
	order: 5
});

MenuRegistry.appendMenuItem(MenuId.MenubarLayoutMenu, {
	group: '2_layouts',
	command: {
		id: EditorLayoutThreeRowsAction.ID,
		title: nls.localize({ key: 'miThreeRowsEditorLayout', comment: ['&& denotes a mnemonic'] }, "Three &&Rows")
	},
	order: 6
});

MenuRegistry.appendMenuItem(MenuId.MenubarLayoutMenu, {
	group: '2_layouts',
	command: {
		id: EditorLayoutTwoByTwoGridAction.ID,
		title: nls.localize({ key: 'miTwoByTwoGridEditorLayout', comment: ['&& denotes a mnemonic'] }, "&&Grid (2x2)")
	},
	order: 7
});

MenuRegistry.appendMenuItem(MenuId.MenubarLayoutMenu, {
	group: '2_layouts',
	command: {
		id: EditorLayoutTwoRowsRightAction.ID,
		title: nls.localize({ key: 'miTwoRowsRightEditorLayout', comment: ['&& denotes a mnemonic'] }, "Two R&&ows Right")
	},
	order: 8
});

MenuRegistry.appendMenuItem(MenuId.MenubarLayoutMenu, {
	group: '2_layouts',
	command: {
		id: EditorLayoutTwoColumnsBottomAction.ID,
		title: nls.localize({ key: 'miTwoColumnsBottomEditorLayout', comment: ['&& denotes a mnemonic'] }, "Two &&Columns Bottom")
	},
	order: 9
});

// Main Menu Bar Contributions:

// Forward/Back
MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
	group: '1_history_nav',
	command: {
		id: 'workbench.action.navigateBack',
		title: nls.localize({ key: 'miBack', comment: ['&& denotes a mnemonic'] }, "&&Back"),
		precondition: ContextKeyExpr.has('canNavigateBack')
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
	group: '1_history_nav',
	command: {
		id: 'workbench.action.navigateForward',
		title: nls.localize({ key: 'miForward', comment: ['&& denotes a mnemonic'] }, "&&Forward"),
		precondition: ContextKeyExpr.has('canNavigateForward')
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
	group: '1_history_nav',
	command: {
		id: 'workbench.action.navigateToLastEditLocation',
		title: nls.localize({ key: 'miLastEditLocation', comment: ['&& denotes a mnemonic'] }, "&&Last Edit Location"),
		precondition: ContextKeyExpr.has('canNavigateToLastEditLocation')
	},
	order: 3
});

// Switch Editor
MenuRegistry.appendMenuItem(MenuId.MenubarSwitchEditorMenu, {
	group: '1_any',
	command: {
		id: 'workbench.action.nextEditor',
		title: nls.localize({ key: 'miNextEditor', comment: ['&& denotes a mnemonic'] }, "&&Next Editor")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchEditorMenu, {
	group: '1_any',
	command: {
		id: 'workbench.action.previousEditor',
		title: nls.localize({ key: 'miPreviousEditor', comment: ['&& denotes a mnemonic'] }, "&&Previous Editor")
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchEditorMenu, {
	group: '2_any_used',
	command: {
		id: 'workbench.action.openNextRecentlyUsedEditor',
		title: nls.localize({ key: 'miNextRecentlyUsedEditor', comment: ['&& denotes a mnemonic'] }, "&&Next Used Editor")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchEditorMenu, {
	group: '2_any_used',
	command: {
		id: 'workbench.action.openPreviousRecentlyUsedEditor',
		title: nls.localize({ key: 'miPreviousRecentlyUsedEditor', comment: ['&& denotes a mnemonic'] }, "&&Previous Used Editor")
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchEditorMenu, {
	group: '3_group',
	command: {
		id: 'workbench.action.nextEditorInGroup',
		title: nls.localize({ key: 'miNextEditorInGroup', comment: ['&& denotes a mnemonic'] }, "&&Next Editor in Group")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchEditorMenu, {
	group: '3_group',
	command: {
		id: 'workbench.action.previousEditorInGroup',
		title: nls.localize({ key: 'miPreviousEditorInGroup', comment: ['&& denotes a mnemonic'] }, "&&Previous Editor in Group")
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchEditorMenu, {
	group: '4_group_used',
	command: {
		id: 'workbench.action.openNextRecentlyUsedEditorInGroup',
		title: nls.localize({ key: 'miNextUsedEditorInGroup', comment: ['&& denotes a mnemonic'] }, "&&Next Used Editor in Group")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchEditorMenu, {
	group: '4_group_used',
	command: {
		id: 'workbench.action.openPreviousRecentlyUsedEditorInGroup',
		title: nls.localize({ key: 'miPreviousUsedEditorInGroup', comment: ['&& denotes a mnemonic'] }, "&&Previous Used Editor in Group")
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
	group: '2_editor_nav',
	title: nls.localize({ key: 'miSwitchEditor', comment: ['&& denotes a mnemonic'] }, "Switch &&Editor"),
	submenu: MenuId.MenubarSwitchEditorMenu,
	order: 1
});

// Switch Group
MenuRegistry.appendMenuItem(MenuId.MenubarSwitchGroupMenu, {
	group: '1_focus_index',
	command: {
		id: 'workbench.action.focusFirstEditorGroup',
		title: nls.localize({ key: 'miFocusFirstGroup', comment: ['&& denotes a mnemonic'] }, "Group &&1")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchGroupMenu, {
	group: '1_focus_index',
	command: {
		id: 'workbench.action.focusSecondEditorGroup',
		title: nls.localize({ key: 'miFocusSecondGroup', comment: ['&& denotes a mnemonic'] }, "Group &&2")
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchGroupMenu, {
	group: '1_focus_index',
	command: {
		id: 'workbench.action.focusThirdEditorGroup',
		title: nls.localize({ key: 'miFocusThirdGroup', comment: ['&& denotes a mnemonic'] }, "Group &&3"),
		precondition: ContextKeyExpr.has('multipleEditorGroups')
	},
	order: 3
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchGroupMenu, {
	group: '1_focus_index',
	command: {
		id: 'workbench.action.focusFourthEditorGroup',
		title: nls.localize({ key: 'miFocusFourthGroup', comment: ['&& denotes a mnemonic'] }, "Group &&4"),
		precondition: ContextKeyExpr.has('multipleEditorGroups')
	},
	order: 4
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchGroupMenu, {
	group: '1_focus_index',
	command: {
		id: 'workbench.action.focusFifthEditorGroup',
		title: nls.localize({ key: 'miFocusFifthGroup', comment: ['&& denotes a mnemonic'] }, "Group &&5"),
		precondition: ContextKeyExpr.has('multipleEditorGroups')
	},
	order: 5
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchGroupMenu, {
	group: '2_next_prev',
	command: {
		id: 'workbench.action.focusNextGroup',
		title: nls.localize({ key: 'miNextGroup', comment: ['&& denotes a mnemonic'] }, "&&Next Group"),
		precondition: ContextKeyExpr.has('multipleEditorGroups')
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchGroupMenu, {
	group: '2_next_prev',
	command: {
		id: 'workbench.action.focusPreviousGroup',
		title: nls.localize({ key: 'miPreviousGroup', comment: ['&& denotes a mnemonic'] }, "&&Previous Group"),
		precondition: ContextKeyExpr.has('multipleEditorGroups')
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchGroupMenu, {
	group: '3_directional',
	command: {
		id: 'workbench.action.focusLeftGroup',
		title: nls.localize({ key: 'miFocusLeftGroup', comment: ['&& denotes a mnemonic'] }, "Group &&Left"),
		precondition: ContextKeyExpr.has('multipleEditorGroups')
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchGroupMenu, {
	group: '3_directional',
	command: {
		id: 'workbench.action.focusRightGroup',
		title: nls.localize({ key: 'miFocusRightGroup', comment: ['&& denotes a mnemonic'] }, "Group &&Right"),
		precondition: ContextKeyExpr.has('multipleEditorGroups')
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchGroupMenu, {
	group: '3_directional',
	command: {
		id: 'workbench.action.focusAboveGroup',
		title: nls.localize({ key: 'miFocusAboveGroup', comment: ['&& denotes a mnemonic'] }, "Group &&Above"),
		precondition: ContextKeyExpr.has('multipleEditorGroups')
	},
	order: 3
});

MenuRegistry.appendMenuItem(MenuId.MenubarSwitchGroupMenu, {
	group: '3_directional',
	command: {
		id: 'workbench.action.focusBelowGroup',
		title: nls.localize({ key: 'miFocusBelowGroup', comment: ['&& denotes a mnemonic'] }, "Group &&Below"),
		precondition: ContextKeyExpr.has('multipleEditorGroups')
	},
	order: 4
});

MenuRegistry.appendMenuItem(MenuId.MenubarGoMenu, {
	group: '2_editor_nav',
	title: nls.localize({ key: 'miSwitchGroup', comment: ['&& denotes a mnemonic'] }, "Switch &&Group"),
	submenu: MenuId.MenubarSwitchGroupMenu,
	order: 2
});
