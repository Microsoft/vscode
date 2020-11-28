/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/openeditors';
import * as nls from 'vs/nls';
import { RunOnceScheduler } from 'vs/base/common/async';
import { IAction, ActionRunner, WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification } from 'vs/base/common/actions';
import * as dom from 'vs/base/browser/dom';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IEditorGroupsService, IEditorGroup, GroupChangeKind, GroupsOrder } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IConfigurationService, IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IEditorInput, Verbosity, EditorResourceAccessor, SideBySideEditor } from 'vs/workbench/common/editor';
import { SaveAllAction, SaveAllInGroupAction, CloseGroupAction } from 'vs/workbench/contrib/files/browser/fileActions';
import { OpenEditorsFocusedContext, ExplorerFocusedContext, IFilesConfiguration, OpenEditor } from 'vs/workbench/contrib/files/common/files';
import { CloseAllEditorsAction, CloseEditorAction, UnpinEditorAction } from 'vs/workbench/browser/parts/editor/editorActions';
import { ToggleEditorLayoutAction } from 'vs/workbench/browser/actions/layoutActions';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { attachStylerCallback } from 'vs/platform/theme/common/styler';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { badgeBackground, badgeForeground, contrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { WorkbenchList, ListResourceNavigator } from 'vs/platform/list/browser/listService';
import { IListVirtualDelegate, IListRenderer, IListContextMenuEvent, IListDragAndDrop, IListDragOverReaction } from 'vs/base/browser/ui/list/list';
import { ResourceLabels, IResourceLabel } from 'vs/workbench/browser/labels';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IEditorService, SIDE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IMenuService, MenuId, IMenu } from 'vs/platform/actions/common/actions';
import { OpenEditorsDirtyEditorContext, OpenEditorsGroupContext, OpenEditorsReadonlyEditorContext } from 'vs/workbench/contrib/files/browser/fileCommands';
import { ResourceContextKey } from 'vs/workbench/common/resources';
import { ResourcesDropHandler, fillResourceDataTransfers, CodeDataTransfers, containsDragType } from 'vs/workbench/browser/dnd';
import { ViewPane } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IViewletViewOptions } from 'vs/workbench/browser/parts/views/viewsViewlet';
import { IDragAndDropData, DataTransfers } from 'vs/base/browser/dnd';
import { memoize } from 'vs/base/common/decorators';
import { ElementsDragAndDropData, NativeDragAndDropData } from 'vs/base/browser/ui/list/listView';
import { URI } from 'vs/base/common/uri';
import { withUndefinedAsNull } from 'vs/base/common/types';
import { isWeb } from 'vs/base/common/platform';
import { IWorkingCopyService, IWorkingCopy, WorkingCopyCapabilities } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { AutoSaveMode, IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { IViewDescriptorService } from 'vs/workbench/common/views';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { Orientation } from 'vs/base/browser/ui/splitview/splitview';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { compareFileNamesDefault } from 'vs/base/common/comparers';

const $ = dom.$;

export class OpenEditorsView extends ViewPane {

	private static readonly DEFAULT_VISIBLE_OPEN_EDITORS = 9;
	static readonly ID = 'workbench.explorer.openEditorsView';
	static readonly NAME = nls.localize({ key: 'openEditors', comment: ['Open is an adjective'] }, "Open Editors");

	private dirtyCountElement!: HTMLElement;
	private listRefreshScheduler: RunOnceScheduler;
	private structuralRefreshDelay: number;
	private list!: WorkbenchList<OpenEditor | IEditorGroup>;
	private listLabels: ResourceLabels | undefined;
	private contributedContextMenu!: IMenu;
	private needsRefresh = false;
	private elements: (OpenEditor | IEditorGroup)[] = [];
	private sortOrder: 'editorOrder' | 'alphabetical';
	private resourceContext!: ResourceContextKey;
	private groupFocusedContext!: IContextKey<boolean>;
	private dirtyEditorFocusedContext!: IContextKey<boolean>;
	private readonlyEditorFocusedContext!: IContextKey<boolean>;

	constructor(
		options: IViewletViewOptions,
		@IInstantiationService instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IThemeService themeService: IThemeService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IMenuService private readonly menuService: IMenuService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService,
		@IOpenerService openerService: IOpenerService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);

		this.structuralRefreshDelay = 0;
		this.listRefreshScheduler = new RunOnceScheduler(() => {
			const previousLength = this.list.length;
			this.list.splice(0, this.list.length, this.getElements());
			this.focusActiveEditor();
			if (previousLength !== this.list.length) {
				this.updateSize();
			}
			this.needsRefresh = false;
		}, this.structuralRefreshDelay);
		this.sortOrder = configurationService.getValue('explorer.openEditors.sortOrder');

		this.registerUpdateEvents();

		// Also handle configuration updates
		this._register(this.configurationService.onDidChangeConfiguration(e => this.onConfigurationChange(e)));

		// Handle dirty counter
		this._register(this.workingCopyService.onDidChangeDirty(workingCopy => this.updateDirtyIndicator(workingCopy)));
	}

	private registerUpdateEvents(): void {
		const updateWholeList = () => {
			if (!this.isBodyVisible() || !this.list) {
				this.needsRefresh = true;
				return;
			}

			this.listRefreshScheduler.schedule(this.structuralRefreshDelay);
		};

		const groupDisposables = new Map<number, IDisposable>();
		const addGroupListener = (group: IEditorGroup) => {
			groupDisposables.set(group.id, group.onDidGroupChange(e => {
				if (this.listRefreshScheduler.isScheduled()) {
					return;
				}
				if (!this.isBodyVisible() || !this.list) {
					this.needsRefresh = true;
					return;
				}

				const index = this.getIndex(group, e.editor);
				switch (e.kind) {
					case GroupChangeKind.GROUP_INDEX: {
						if (index >= 0) {
							this.list.splice(index, 1, [group]);
						}
						break;
					}
					case GroupChangeKind.GROUP_ACTIVE:
					case GroupChangeKind.EDITOR_ACTIVE: {
						this.focusActiveEditor();
						break;
					}
					case GroupChangeKind.EDITOR_DIRTY:
					case GroupChangeKind.EDITOR_LABEL:
					case GroupChangeKind.EDITOR_STICKY:
					case GroupChangeKind.EDITOR_PIN: {
						this.list.splice(index, 1, [new OpenEditor(e.editor!, group)]);
						break;
					}
					case GroupChangeKind.EDITOR_OPEN:
					case GroupChangeKind.EDITOR_CLOSE:
					case GroupChangeKind.EDITOR_MOVE: {
						updateWholeList();
						break;
					}
				}
			}));
			this._register(groupDisposables.get(group.id)!);
		};

		this.editorGroupService.groups.forEach(g => addGroupListener(g));
		this._register(this.editorGroupService.onDidAddGroup(group => {
			addGroupListener(group);
			updateWholeList();
		}));
		this._register(this.editorGroupService.onDidMoveGroup(() => updateWholeList()));
		this._register(this.editorGroupService.onDidRemoveGroup(group => {
			dispose(groupDisposables.get(group.id));
			updateWholeList();
		}));
	}

	protected renderHeaderTitle(container: HTMLElement): void {
		super.renderHeaderTitle(container, this.title);

		const count = dom.append(container, $('.count'));
		this.dirtyCountElement = dom.append(count, $('.dirty-count.monaco-count-badge.long'));

		this._register((attachStylerCallback(this.themeService, { badgeBackground, badgeForeground, contrastBorder }, colors => {
			const background = colors.badgeBackground ? colors.badgeBackground.toString() : '';
			const foreground = colors.badgeForeground ? colors.badgeForeground.toString() : '';
			const border = colors.contrastBorder ? colors.contrastBorder.toString() : '';

			this.dirtyCountElement.style.backgroundColor = background;
			this.dirtyCountElement.style.color = foreground;

			this.dirtyCountElement.style.borderWidth = border ? '1px' : '';
			this.dirtyCountElement.style.borderStyle = border ? 'solid' : '';
			this.dirtyCountElement.style.borderColor = border;
		})));

		this.updateDirtyIndicator();
	}

	renderBody(container: HTMLElement): void {
		super.renderBody(container);

		container.classList.add('open-editors');
		container.classList.add('show-file-icons');

		const delegate = new OpenEditorsDelegate();

		if (this.list) {
			this.list.dispose();
		}
		if (this.listLabels) {
			this.listLabels.clear();
		}
		this.listLabels = this.instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: this.onDidChangeBodyVisibility });
		this.list = <WorkbenchList<OpenEditor | IEditorGroup>>this.instantiationService.createInstance(WorkbenchList, 'OpenEditors', container, delegate, [
			new EditorGroupRenderer(this.keybindingService, this.instantiationService),
			new OpenEditorRenderer(this.listLabels, this.instantiationService, this.keybindingService, this.configurationService)
		], {
			identityProvider: { getId: (element: OpenEditor | IEditorGroup) => element instanceof OpenEditor ? element.getId() : element.id.toString() },
			dnd: new OpenEditorsDragAndDrop(this.instantiationService, this.editorGroupService),
			overrideStyles: {
				listBackground: this.getBackgroundColor()
			},
			accessibilityProvider: new OpenEditorsAccessibilityProvider()
		});
		this._register(this.list);
		this._register(this.listLabels);

		this.contributedContextMenu = this.menuService.createMenu(MenuId.OpenEditorsContext, this.list.contextKeyService);
		this._register(this.contributedContextMenu);

		this.updateSize();

		// Bind context keys
		OpenEditorsFocusedContext.bindTo(this.list.contextKeyService);
		ExplorerFocusedContext.bindTo(this.list.contextKeyService);

		this.resourceContext = this.instantiationService.createInstance(ResourceContextKey);
		this._register(this.resourceContext);
		this.groupFocusedContext = OpenEditorsGroupContext.bindTo(this.contextKeyService);
		this.dirtyEditorFocusedContext = OpenEditorsDirtyEditorContext.bindTo(this.contextKeyService);
		this.readonlyEditorFocusedContext = OpenEditorsReadonlyEditorContext.bindTo(this.contextKeyService);

		this._register(this.list.onContextMenu(e => this.onListContextMenu(e)));
		this.list.onDidChangeFocus(e => {
			this.resourceContext.reset();
			this.groupFocusedContext.reset();
			this.dirtyEditorFocusedContext.reset();
			this.readonlyEditorFocusedContext.reset();
			const element = e.elements.length ? e.elements[0] : undefined;
			if (element instanceof OpenEditor) {
				const resource = element.getResource();
				this.dirtyEditorFocusedContext.set(element.editor.isDirty() && !element.editor.isSaving());
				this.readonlyEditorFocusedContext.set(element.editor.isReadonly());
				this.resourceContext.set(withUndefinedAsNull(resource));
			} else if (!!element) {
				this.groupFocusedContext.set(true);
			}
		});

		// Open when selecting via keyboard
		this._register(this.list.onMouseMiddleClick(e => {
			if (e && e.element instanceof OpenEditor) {
				e.element.group.closeEditor(e.element.editor, { preserveFocus: true });
			}
		}));
		const resourceNavigator = this._register(new ListResourceNavigator(this.list, { configurationService: this.configurationService }));
		this._register(resourceNavigator.onDidOpen(e => {
			if (typeof e.element !== 'number') {
				return;
			}

			const element = this.list.element(e.element);

			if (element instanceof OpenEditor) {
				if (e.browserEvent instanceof MouseEvent && e.browserEvent.button === 1) {
					return; // middle click already handled above: closes the editor
				}

				this.openEditor(element, { preserveFocus: e.editorOptions.preserveFocus, pinned: e.editorOptions.pinned, sideBySide: e.sideBySide });
			} else {
				this.editorGroupService.activateGroup(element);
			}
		}));

		this.listRefreshScheduler.schedule(0);

		this._register(this.onDidChangeBodyVisibility(visible => {
			if (visible && this.needsRefresh) {
				this.listRefreshScheduler.schedule(0);
			}
		}));

		const containerModel = this.viewDescriptorService.getViewContainerModel(this.viewDescriptorService.getViewContainerByViewId(this.id)!)!;
		this._register(containerModel.onDidChangeAllViewDescriptors(() => {
			this.updateSize();
		}));
	}

	getActions(): IAction[] {
		return [
			this.instantiationService.createInstance(ToggleEditorLayoutAction, ToggleEditorLayoutAction.ID, ToggleEditorLayoutAction.LABEL),
			this.instantiationService.createInstance(SaveAllAction, SaveAllAction.ID, SaveAllAction.LABEL),
			this.instantiationService.createInstance(CloseAllEditorsAction, CloseAllEditorsAction.ID, CloseAllEditorsAction.LABEL)
		];
	}

	focus(): void {
		super.focus();
		this.list.domFocus();
	}

	getList(): WorkbenchList<OpenEditor | IEditorGroup> {
		return this.list;
	}

	protected layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		if (this.list) {
			this.list.layout(height, width);
		}
	}

	private get showGroups(): boolean {
		return this.editorGroupService.groups.length > 1;
	}

	private getElements(): Array<IEditorGroup | OpenEditor> {
		this.elements = [];
		this.editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE).forEach(g => {
			if (this.showGroups) {
				this.elements.push(g);
			}
			let editors = g.editors.map(ei => new OpenEditor(ei, g));
			if (this.sortOrder === 'alphabetical') {
				editors = editors.sort((first, second) => compareFileNamesDefault(first.editor.getName(), second.editor.getName()));
			}
			this.elements.push(...editors);
		});

		return this.elements;
	}

	private getIndex(group: IEditorGroup, editor: IEditorInput | undefined | null): number {
		if (!editor) {
			return this.elements.findIndex(e => !(e instanceof OpenEditor) && e.id === group.id);
		}

		return this.elements.findIndex(e => e instanceof OpenEditor && e.editor === editor && e.group.id === group.id);
	}

	private openEditor(element: OpenEditor, options: { preserveFocus?: boolean; pinned?: boolean; sideBySide?: boolean; }): void {
		if (element) {
			this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id: 'workbench.files.openFile', from: 'openEditors' });

			const preserveActivateGroup = options.sideBySide && options.preserveFocus; // needed for https://github.com/microsoft/vscode/issues/42399
			if (!preserveActivateGroup) {
				this.editorGroupService.activateGroup(element.group); // needed for https://github.com/microsoft/vscode/issues/6672
			}
			this.editorService.openEditor(element.editor, options, options.sideBySide ? SIDE_GROUP : element.group);
		}
	}

	private onListContextMenu(e: IListContextMenuEvent<OpenEditor | IEditorGroup>): void {
		if (!e.element) {
			return;
		}

		const element = e.element;
		const actions: IAction[] = [];
		const actionsDisposable = createAndFillInContextMenuActions(this.contributedContextMenu, { shouldForwardArgs: true, arg: element instanceof OpenEditor ? EditorResourceAccessor.getOriginalUri(element.editor) : {} }, actions);

		this.contextMenuService.showContextMenu({
			getAnchor: () => e.anchor,
			getActions: () => actions,
			getActionsContext: () => element instanceof OpenEditor ? { groupId: element.groupId, editorIndex: element.group.getIndexOfEditor(element.editor) } : { groupId: element.id },
			onHide: () => dispose(actionsDisposable)
		});
	}

	private focusActiveEditor(): void {
		if (this.list.length && this.editorGroupService.activeGroup) {
			const index = this.getIndex(this.editorGroupService.activeGroup, this.editorGroupService.activeGroup.activeEditor);
			if (index >= 0) {
				try {
					this.list.setFocus([index]);
					this.list.setSelection([index]);
					this.list.reveal(index);
				} catch (e) {
					// noop list updated in the meantime
				}
				return;
			}
		}

		this.list.setFocus([]);
		this.list.setSelection([]);
	}

	private onConfigurationChange(event: IConfigurationChangeEvent): void {
		if (event.affectsConfiguration('explorer.openEditors')) {
			this.updateSize();
		}
		// Trigger a 'repaint' when decoration settings change or the sort order changed
		if (event.affectsConfiguration('explorer.decorations') || event.affectsConfiguration('explorer.openEditors.sortOrder')) {
			this.sortOrder = this.configurationService.getValue('explorer.openEditors.sortOrder');
			this.listRefreshScheduler.schedule();
		}
	}

	private updateSize(): void {
		// Adjust expanded body size
		this.minimumBodySize = this.orientation === Orientation.VERTICAL ? this.getMinExpandedBodySize() : 170;
		this.maximumBodySize = this.orientation === Orientation.VERTICAL ? this.getMaxExpandedBodySize() : Number.POSITIVE_INFINITY;
	}

	private updateDirtyIndicator(workingCopy?: IWorkingCopy): void {
		if (workingCopy) {
			const gotDirty = workingCopy.isDirty();
			if (gotDirty && !(workingCopy.capabilities & WorkingCopyCapabilities.Untitled) && this.filesConfigurationService.getAutoSaveMode() === AutoSaveMode.AFTER_SHORT_DELAY) {
				return; // do not indicate dirty of working copies that are auto saved after short delay
			}
		}

		let dirty = this.workingCopyService.dirtyCount;
		if (dirty === 0) {
			this.dirtyCountElement.classList.add('hidden');
		} else {
			this.dirtyCountElement.textContent = nls.localize('dirtyCounter', "{0} unsaved", dirty);
			this.dirtyCountElement.classList.remove('hidden');
		}
	}

	private get elementCount(): number {
		return this.editorGroupService.groups.map(g => g.count)
			.reduce((first, second) => first + second, this.showGroups ? this.editorGroupService.groups.length : 0);
	}

	private getMaxExpandedBodySize(): number {
		const containerModel = this.viewDescriptorService.getViewContainerModel(this.viewDescriptorService.getViewContainerByViewId(this.id)!)!;
		if (containerModel.visibleViewDescriptors.length <= 1) {
			return Number.POSITIVE_INFINITY;
		}

		return this.elementCount * OpenEditorsDelegate.ITEM_HEIGHT;
	}

	private getMinExpandedBodySize(): number {
		let visibleOpenEditors = this.configurationService.getValue<number>('explorer.openEditors.visible');
		if (typeof visibleOpenEditors !== 'number') {
			visibleOpenEditors = OpenEditorsView.DEFAULT_VISIBLE_OPEN_EDITORS;
		}

		return this.computeMinExpandedBodySize(visibleOpenEditors);
	}

	private computeMinExpandedBodySize(visibleOpenEditors = OpenEditorsView.DEFAULT_VISIBLE_OPEN_EDITORS): number {
		const itemsToShow = Math.min(Math.max(visibleOpenEditors, 1), this.elementCount);
		return itemsToShow * OpenEditorsDelegate.ITEM_HEIGHT;
	}

	setStructuralRefreshDelay(delay: number): void {
		this.structuralRefreshDelay = delay;
	}

	getOptimalWidth(): number {
		let parentNode = this.list.getHTMLElement();
		let childNodes: HTMLElement[] = [].slice.call(parentNode.querySelectorAll('.open-editor > a'));

		return dom.getLargestChildWidth(parentNode, childNodes);
	}
}

interface IOpenEditorTemplateData {
	container: HTMLElement;
	root: IResourceLabel;
	actionBar: ActionBar;
	actionRunner: OpenEditorActionRunner;
}

interface IEditorGroupTemplateData {
	root: HTMLElement;
	name: HTMLSpanElement;
	actionBar: ActionBar;
	editorGroup: IEditorGroup;
}

class OpenEditorActionRunner extends ActionRunner {
	public editor: OpenEditor | undefined;

	async run(action: IAction): Promise<void> {
		if (!this.editor) {
			return;
		}

		return super.run(action, { groupId: this.editor.groupId, editorIndex: this.editor.group.getIndexOfEditor(this.editor.editor) });
	}
}

class OpenEditorsDelegate implements IListVirtualDelegate<OpenEditor | IEditorGroup> {

	public static readonly ITEM_HEIGHT = 22;

	getHeight(_element: OpenEditor | IEditorGroup): number {
		return OpenEditorsDelegate.ITEM_HEIGHT;
	}

	getTemplateId(element: OpenEditor | IEditorGroup): string {
		if (element instanceof OpenEditor) {
			return OpenEditorRenderer.ID;
		}

		return EditorGroupRenderer.ID;
	}
}

class EditorGroupRenderer implements IListRenderer<IEditorGroup, IEditorGroupTemplateData> {
	static readonly ID = 'editorgroup';

	constructor(
		private keybindingService: IKeybindingService,
		private instantiationService: IInstantiationService,
	) {
		// noop
	}

	get templateId() {
		return EditorGroupRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IEditorGroupTemplateData {
		const editorGroupTemplate: IEditorGroupTemplateData = Object.create(null);
		editorGroupTemplate.root = dom.append(container, $('.editor-group'));
		editorGroupTemplate.name = dom.append(editorGroupTemplate.root, $('span.name'));
		editorGroupTemplate.actionBar = new ActionBar(container);

		const saveAllInGroupAction = this.instantiationService.createInstance(SaveAllInGroupAction, SaveAllInGroupAction.ID, SaveAllInGroupAction.LABEL);
		const saveAllInGroupKey = this.keybindingService.lookupKeybinding(saveAllInGroupAction.id);
		editorGroupTemplate.actionBar.push(saveAllInGroupAction, { icon: true, label: false, keybinding: saveAllInGroupKey ? saveAllInGroupKey.getLabel() : undefined });

		const closeGroupAction = this.instantiationService.createInstance(CloseGroupAction, CloseGroupAction.ID, CloseGroupAction.LABEL);
		const closeGroupActionKey = this.keybindingService.lookupKeybinding(closeGroupAction.id);
		editorGroupTemplate.actionBar.push(closeGroupAction, { icon: true, label: false, keybinding: closeGroupActionKey ? closeGroupActionKey.getLabel() : undefined });

		return editorGroupTemplate;
	}

	renderElement(editorGroup: IEditorGroup, _index: number, templateData: IEditorGroupTemplateData): void {
		templateData.editorGroup = editorGroup;
		templateData.name.textContent = editorGroup.label;
		templateData.actionBar.context = { groupId: editorGroup.id };
	}

	disposeTemplate(templateData: IEditorGroupTemplateData): void {
		templateData.actionBar.dispose();
	}
}

class OpenEditorRenderer implements IListRenderer<OpenEditor, IOpenEditorTemplateData> {
	static readonly ID = 'openeditor';

	private readonly closeEditorAction = this.instantiationService.createInstance(CloseEditorAction, CloseEditorAction.ID, CloseEditorAction.LABEL);
	private readonly unpinEditorAction = this.instantiationService.createInstance(UnpinEditorAction, UnpinEditorAction.ID, UnpinEditorAction.LABEL);

	constructor(
		private labels: ResourceLabels,
		private instantiationService: IInstantiationService,
		private keybindingService: IKeybindingService,
		private configurationService: IConfigurationService
	) {
		// noop
	}

	get templateId() {
		return OpenEditorRenderer.ID;
	}

	renderTemplate(container: HTMLElement): IOpenEditorTemplateData {
		const editorTemplate: IOpenEditorTemplateData = Object.create(null);
		editorTemplate.container = container;
		editorTemplate.actionRunner = new OpenEditorActionRunner();
		editorTemplate.actionBar = new ActionBar(container, { actionRunner: editorTemplate.actionRunner });
		editorTemplate.root = this.labels.create(container);

		return editorTemplate;
	}

	renderElement(openedEditor: OpenEditor, _index: number, templateData: IOpenEditorTemplateData): void {
		const editor = openedEditor.editor;
		templateData.actionRunner.editor = openedEditor;
		templateData.container.classList.toggle('dirty', editor.isDirty() && !editor.isSaving());
		templateData.container.classList.toggle('sticky', openedEditor.isSticky());
		templateData.root.setResource({
			resource: EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.BOTH }),
			name: editor.getName(),
			description: editor.getDescription(Verbosity.MEDIUM)
		}, {
			italic: openedEditor.isPreview(),
			extraClasses: ['open-editor'],
			fileDecorations: this.configurationService.getValue<IFilesConfiguration>().explorer.decorations,
			title: editor.getTitle(Verbosity.LONG)
		});
		const editorAction = openedEditor.isSticky() ? this.unpinEditorAction : this.closeEditorAction;
		if (!templateData.actionBar.hasAction(editorAction)) {
			if (!templateData.actionBar.isEmpty()) {
				templateData.actionBar.clear();
			}
			templateData.actionBar.push(editorAction, { icon: true, label: false, keybinding: this.keybindingService.lookupKeybinding(editorAction.id)?.getLabel() });
		}
	}

	disposeTemplate(templateData: IOpenEditorTemplateData): void {
		templateData.actionBar.dispose();
		templateData.root.dispose();
		templateData.actionRunner.dispose();
	}
}

class OpenEditorsDragAndDrop implements IListDragAndDrop<OpenEditor | IEditorGroup> {

	constructor(
		private instantiationService: IInstantiationService,
		private editorGroupService: IEditorGroupsService
	) { }

	@memoize private get dropHandler(): ResourcesDropHandler {
		return this.instantiationService.createInstance(ResourcesDropHandler, { allowWorkspaceOpen: false });
	}

	getDragURI(element: OpenEditor | IEditorGroup): string | null {
		if (element instanceof OpenEditor) {
			const resource = element.getResource();
			if (resource) {
				return resource.toString();
			}
		}
		return null;
	}

	getDragLabel?(elements: (OpenEditor | IEditorGroup)[]): string {
		if (elements.length > 1) {
			return String(elements.length);
		}
		const element = elements[0];

		return element instanceof OpenEditor ? element.editor.getName() : element.label;
	}

	onDragStart(data: IDragAndDropData, originalEvent: DragEvent): void {
		const items = (data as ElementsDragAndDropData<OpenEditor | IEditorGroup>).elements;
		const resources: URI[] = [];
		if (items) {
			items.forEach(i => {
				if (i instanceof OpenEditor) {
					const resource = i.getResource();
					if (resource) {
						resources.push(resource);
					}
				}
			});
		}

		if (resources.length) {
			// Apply some datatransfer types to allow for dragging the element outside of the application
			this.instantiationService.invokeFunction(fillResourceDataTransfers, resources, undefined, originalEvent);
		}
	}

	onDragOver(data: IDragAndDropData, _targetElement: OpenEditor | IEditorGroup, _targetIndex: number, originalEvent: DragEvent): boolean | IListDragOverReaction {
		if (data instanceof NativeDragAndDropData) {
			if (isWeb) {
				return false; // dropping files into editor is unsupported on web
			}

			return containsDragType(originalEvent, DataTransfers.FILES, CodeDataTransfers.FILES);
		}

		return true;
	}

	drop(data: IDragAndDropData, targetElement: OpenEditor | IEditorGroup | undefined, _targetIndex: number, originalEvent: DragEvent): void {
		const group = targetElement instanceof OpenEditor ? targetElement.group : targetElement || this.editorGroupService.groups[this.editorGroupService.count - 1];
		const index = targetElement instanceof OpenEditor ? targetElement.group.getIndexOfEditor(targetElement.editor) : 0;

		if (data instanceof ElementsDragAndDropData) {
			const elementsData = data.elements;
			elementsData.forEach((oe: OpenEditor, offset) => {
				oe.group.moveEditor(oe.editor, group, { index: index + offset, preserveFocus: true });
			});
			this.editorGroupService.activateGroup(group);
		} else {
			this.dropHandler.handleDrop(originalEvent, () => group, () => group.focus(), index);
		}
	}
}

class OpenEditorsAccessibilityProvider implements IListAccessibilityProvider<OpenEditor | IEditorGroup> {

	getWidgetAriaLabel(): string {
		return nls.localize('openEditors', "Open Editors");
	}

	getAriaLabel(element: OpenEditor | IEditorGroup): string | null {
		if (element instanceof OpenEditor) {
			return `${element.editor.getName()}, ${element.editor.getDescription()}`;
		}

		return element.ariaLabel;
	}
}
