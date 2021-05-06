/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import * as perf from 'vs/base/common/performance';
import { IAction, WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification } from 'vs/base/common/actions';
import { memoize } from 'vs/base/common/decorators';
import { IFilesConfiguration, ExplorerFolderContext, FilesExplorerFocusedContext, ExplorerFocusedContext, ExplorerRootContext, ExplorerResourceReadonlyContext, ExplorerResourceCut, ExplorerResourceMoveableToTrash, ExplorerCompressedFocusContext, ExplorerCompressedFirstFocusContext, ExplorerCompressedLastFocusContext, ExplorerResourceAvailableEditorIdsContext, VIEW_ID, VIEWLET_ID } from 'vs/workbench/contrib/files/common/files';
import { FileCopiedContext, NEW_FILE_COMMAND_ID, NEW_FOLDER_COMMAND_ID } from 'vs/workbench/contrib/files/browser/fileActions';
import * as DOM from 'vs/base/browser/dom';
import { IWorkbenchLayoutService } from 'vs/workbench/services/layout/browser/layoutService';
import { ExplorerDecorationsProvider } from 'vs/workbench/contrib/files/browser/views/explorerDecorationsProvider';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IConfigurationService, IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IContextKeyService, IContextKey, ContextKeyEqualsExpr } from 'vs/platform/contextkey/common/contextkey';
import { ResourceContextKey } from 'vs/workbench/common/resources';
import { IDecorationsService } from 'vs/workbench/services/decorations/browser/decorations';
import { WorkbenchCompressibleAsyncDataTree } from 'vs/platform/list/browser/listService';
import { DelayedDragHandler } from 'vs/base/browser/dnd';
import { IEditorService, SIDE_GROUP, ACTIVE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { IViewPaneOptions, ViewPane } from 'vs/workbench/browser/parts/views/viewPane';
import { ILabelService } from 'vs/platform/label/common/label';
import { ExplorerDelegate, ExplorerDataSource, FilesRenderer, ICompressedNavigationController, FilesFilter, FileSorter, FileDragAndDrop, ExplorerCompressionDelegate, isCompressedFolderName } from 'vs/workbench/contrib/files/browser/views/explorerViewer';
import { IThemeService, IFileIconTheme } from 'vs/platform/theme/common/themeService';
import { IWorkbenchThemeService } from 'vs/workbench/services/themes/common/workbenchThemeService';
import { ITreeContextMenuEvent, TreeVisibility } from 'vs/base/browser/ui/tree/tree';
import { IMenuService, MenuId, IMenu, Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { createAndFillInContextMenuActions } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ExplorerItem, NewExplorerItem } from 'vs/workbench/contrib/files/common/explorerModel';
import { ResourceLabels } from 'vs/workbench/browser/labels';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IAsyncDataTreeViewState } from 'vs/base/browser/ui/tree/asyncDataTree';
import { FuzzyScore } from 'vs/base/common/filters';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IFileService, FileSystemProviderCapabilities } from 'vs/platform/files/common/files';
import { DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { attachStyler, IColorMapping } from 'vs/platform/theme/common/styler';
import { ColorValue, listDropBackground } from 'vs/platform/theme/common/colorRegistry';
import { Color } from 'vs/base/common/color';
import { SIDE_BAR_BACKGROUND } from 'vs/workbench/common/theme';
import { IViewDescriptorService, IViewsService } from 'vs/workbench/common/views';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { EditorResourceAccessor, SideBySideEditor } from 'vs/workbench/common/editor';
import { IExplorerService } from 'vs/workbench/contrib/files/browser/files';
import { Codicon } from 'vs/base/common/codicons';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';

interface IExplorerViewColors extends IColorMapping {
	listDropBackground?: ColorValue | undefined;
}

interface IExplorerViewStyles {
	listDropBackground?: Color;
}

function hasExpandedRootChild(tree: WorkbenchCompressibleAsyncDataTree<ExplorerItem | ExplorerItem[], ExplorerItem, FuzzyScore>, treeInput: ExplorerItem[]): boolean {
	for (const folder of treeInput) {
		if (tree.hasNode(folder) && !tree.isCollapsed(folder)) {
			for (const [, child] of folder.children.entries()) {
				if (tree.hasNode(child) && tree.isCollapsible(child) && !tree.isCollapsed(child)) {
					return true;
				}
			}
		}
	}

	return false;
}

const identityProvider = {
	getId: (stat: ExplorerItem) => {
		if (stat instanceof NewExplorerItem) {
			return `new:${stat.resource}`;
		}

		return stat.resource;
	}
};

export function getContext(focus: ExplorerItem[], selection: ExplorerItem[], respectMultiSelection: boolean,
	compressedNavigationControllerProvider: { getCompressedNavigationController(stat: ExplorerItem): ICompressedNavigationController | undefined }): ExplorerItem[] {

	let focusedStat: ExplorerItem | undefined;
	focusedStat = focus.length ? focus[0] : undefined;

	const compressedNavigationController = focusedStat && compressedNavigationControllerProvider.getCompressedNavigationController(focusedStat);
	focusedStat = compressedNavigationController ? compressedNavigationController.current : focusedStat;

	const selectedStats: ExplorerItem[] = [];

	for (const stat of selection) {
		const controller = compressedNavigationControllerProvider.getCompressedNavigationController(stat);
		if (controller && focusedStat && controller === compressedNavigationController) {
			if (stat === focusedStat) {
				selectedStats.push(stat);
			}
			// Ignore stats which are selected but are part of the same compact node as the focused stat
			continue;
		}

		if (controller) {
			selectedStats.push(...controller.items);
		} else {
			selectedStats.push(stat);
		}
	}
	if (!focusedStat) {
		if (respectMultiSelection) {
			return selectedStats;
		} else {
			return [];
		}
	}

	if (respectMultiSelection && selectedStats.indexOf(focusedStat) >= 0) {
		return selectedStats;
	}

	return [focusedStat];
}

export class ExplorerView extends ViewPane {
	static readonly TREE_VIEW_STATE_STORAGE_KEY: string = 'workbench.explorer.treeViewState';

	private tree!: WorkbenchCompressibleAsyncDataTree<ExplorerItem | ExplorerItem[], ExplorerItem, FuzzyScore>;
	private filter!: FilesFilter;

	private resourceContext: ResourceContextKey;
	private folderContext: IContextKey<boolean>;
	private readonlyContext: IContextKey<boolean>;
	private availableEditorIdsContext: IContextKey<string>;

	private rootContext: IContextKey<boolean>;
	private resourceMoveableToTrash: IContextKey<boolean>;

	private renderer!: FilesRenderer;

	private styleElement!: HTMLStyleElement;
	private treeContainer!: HTMLElement;
	private container!: HTMLElement;
	private compressedFocusContext: IContextKey<boolean>;
	private compressedFocusFirstContext: IContextKey<boolean>;
	private compressedFocusLastContext: IContextKey<boolean>;

	private horizontalScrolling: boolean | undefined;

	// Refresh is needed on the initial explorer open
	private shouldRefresh = true;
	private dragHandler!: DelayedDragHandler;
	private autoReveal: boolean | 'focusNoScroll' = false;
	private decorationsProvider: ExplorerDecorationsProvider | undefined;

	constructor(
		options: IViewPaneOptions,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IProgressService private readonly progressService: IProgressService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IConfigurationService configurationService: IConfigurationService,
		@IDecorationsService private readonly decorationService: IDecorationsService,
		@ILabelService private readonly labelService: ILabelService,
		@IThemeService themeService: IWorkbenchThemeService,
		@IMenuService private readonly menuService: IMenuService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IExplorerService private readonly explorerService: IExplorerService,
		@IStorageService private readonly storageService: IStorageService,
		@IClipboardService private clipboardService: IClipboardService,
		@IFileService private readonly fileService: IFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@ICommandService private readonly commandService: ICommandService,
		@IOpenerService openerService: IOpenerService
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);

		this.resourceContext = instantiationService.createInstance(ResourceContextKey);
		this._register(this.resourceContext);

		this.folderContext = ExplorerFolderContext.bindTo(contextKeyService);
		this.readonlyContext = ExplorerResourceReadonlyContext.bindTo(contextKeyService);
		this.availableEditorIdsContext = ExplorerResourceAvailableEditorIdsContext.bindTo(contextKeyService);
		this.rootContext = ExplorerRootContext.bindTo(contextKeyService);
		this.resourceMoveableToTrash = ExplorerResourceMoveableToTrash.bindTo(contextKeyService);
		this.compressedFocusContext = ExplorerCompressedFocusContext.bindTo(contextKeyService);
		this.compressedFocusFirstContext = ExplorerCompressedFirstFocusContext.bindTo(contextKeyService);
		this.compressedFocusLastContext = ExplorerCompressedLastFocusContext.bindTo(contextKeyService);

		this.explorerService.registerView(this);
	}

	get name(): string {
		return this.labelService.getWorkspaceLabel(this.contextService.getWorkspace());
	}

	override get title(): string {
		return this.name;
	}

	override set title(_: string) {
		// noop
	}

	// Memoized locals
	@memoize private get contributedContextMenu(): IMenu {
		const contributedContextMenu = this.menuService.createMenu(MenuId.ExplorerContext, this.tree.contextKeyService);
		this._register(contributedContextMenu);
		return contributedContextMenu;
	}

	@memoize private get fileCopiedContextKey(): IContextKey<boolean> {
		return FileCopiedContext.bindTo(this.contextKeyService);
	}

	@memoize private get resourceCutContextKey(): IContextKey<boolean> {
		return ExplorerResourceCut.bindTo(this.contextKeyService);
	}

	// Split view methods

	protected override renderHeader(container: HTMLElement): void {
		super.renderHeader(container);

		// Expand on drag over
		this.dragHandler = new DelayedDragHandler(container, () => this.setExpanded(true));

		const titleElement = container.querySelector('.title') as HTMLElement;
		const setHeader = () => {
			const workspace = this.contextService.getWorkspace();
			const title = workspace.folders.map(folder => folder.name).join();
			titleElement.textContent = this.name;
			titleElement.title = title;
			titleElement.setAttribute('aria-label', nls.localize('explorerSection', "Explorer Section: {0}", this.name));
		};

		this._register(this.contextService.onDidChangeWorkspaceName(setHeader));
		this._register(this.labelService.onDidChangeFormatters(setHeader));
		setHeader();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
		this.tree.layout(height, width);
	}

	override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		this.container = container;
		this.treeContainer = DOM.append(container, DOM.$('.explorer-folders-view'));

		this.styleElement = DOM.createStyleSheet(this.treeContainer);
		attachStyler<IExplorerViewColors>(this.themeService, { listDropBackground }, this.styleListDropBackground.bind(this));

		this.createTree(this.treeContainer);

		this._register(this.labelService.onDidChangeFormatters(() => {
			this._onDidChangeTitleArea.fire();
		}));

		// Update configuration
		const configuration = this.configurationService.getValue<IFilesConfiguration>();
		this.onConfigurationUpdated(configuration);

		// When the explorer viewer is loaded, listen to changes to the editor input
		this._register(this.editorService.onDidActiveEditorChange(() => {
			this.selectActiveFile();
		}));

		// Also handle configuration updates
		this._register(this.configurationService.onDidChangeConfiguration(e => this.onConfigurationUpdated(this.configurationService.getValue<IFilesConfiguration>(), e)));

		this._register(this.onDidChangeBodyVisibility(async visible => {
			if (visible) {
				// If a refresh was requested and we are now visible, run it
				if (this.shouldRefresh) {
					this.shouldRefresh = false;
					await this.setTreeInput();
				}
				// Find resource to focus from active editor input if set
				this.selectActiveFile(true);
			}
		}));
	}

	override focus(): void {
		this.tree.domFocus();

		const focused = this.tree.getFocus();
		if (focused.length === 1 && this.autoReveal) {
			this.tree.reveal(focused[0], 0.5);
		}
	}

	hasFocus(): boolean {
		return DOM.isAncestor(document.activeElement, this.container);
	}

	getContext(respectMultiSelection: boolean): ExplorerItem[] {
		return getContext(this.tree.getFocus(), this.tree.getSelection(), respectMultiSelection, this.renderer);
	}

	isItemVisible(item: ExplorerItem): boolean {
		return this.filter.filter(item, TreeVisibility.Visible);
	}

	async setEditable(stat: ExplorerItem, isEditing: boolean): Promise<void> {
		if (isEditing) {
			this.horizontalScrolling = this.tree.options.horizontalScrolling;

			if (this.horizontalScrolling) {
				this.tree.updateOptions({ horizontalScrolling: false });
			}

			await this.tree.expand(stat.parent!);
		} else {
			if (this.horizontalScrolling !== undefined) {
				this.tree.updateOptions({ horizontalScrolling: this.horizontalScrolling });
			}

			this.horizontalScrolling = undefined;
			this.treeContainer.classList.remove('highlight');
		}

		await this.refresh(false, stat.parent, false);

		if (isEditing) {
			this.treeContainer.classList.add('highlight');
			this.tree.reveal(stat);
		} else {
			this.tree.domFocus();
		}
	}

	private selectActiveFile(reveal = this.autoReveal): void {
		if (this.autoReveal) {
			const activeFile = EditorResourceAccessor.getCanonicalUri(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });

			if (activeFile) {
				const focus = this.tree.getFocus();
				const selection = this.tree.getSelection();
				if (focus.length === 1 && this.uriIdentityService.extUri.isEqual(focus[0].resource, activeFile) && selection.length === 1 && this.uriIdentityService.extUri.isEqual(selection[0].resource, activeFile)) {
					// No action needed, active file is already focused and selected
					return;
				}
				this.explorerService.select(activeFile, reveal);
			}
		}
	}

	private createTree(container: HTMLElement): void {
		this.filter = this.instantiationService.createInstance(FilesFilter);
		this._register(this.filter);
		this._register(this.filter.onDidChange(() => this.refresh(true)));
		const explorerLabels = this.instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: this.onDidChangeBodyVisibility });
		this._register(explorerLabels);

		const updateWidth = (stat: ExplorerItem) => this.tree.updateWidth(stat);
		this.renderer = this.instantiationService.createInstance(FilesRenderer, explorerLabels, updateWidth);
		this._register(this.renderer);

		this._register(createFileIconThemableTreeContainerScope(container, this.themeService));

		const isCompressionEnabled = () => this.configurationService.getValue<boolean>('explorer.compactFolders');

		this.tree = <WorkbenchCompressibleAsyncDataTree<ExplorerItem | ExplorerItem[], ExplorerItem, FuzzyScore>>this.instantiationService.createInstance(WorkbenchCompressibleAsyncDataTree, 'FileExplorer', container, new ExplorerDelegate(), new ExplorerCompressionDelegate(), [this.renderer],
			this.instantiationService.createInstance(ExplorerDataSource), {
			compressionEnabled: isCompressionEnabled(),
			accessibilityProvider: this.renderer,
			identityProvider,
			keyboardNavigationLabelProvider: {
				getKeyboardNavigationLabel: (stat: ExplorerItem) => {
					if (this.explorerService.isEditable(stat)) {
						return undefined;
					}

					return stat.name;
				},
				getCompressedNodeKeyboardNavigationLabel: (stats: ExplorerItem[]) => {
					if (stats.some(stat => this.explorerService.isEditable(stat))) {
						return undefined;
					}

					return stats.map(stat => stat.name).join('/');
				}
			},
			multipleSelectionSupport: true,
			filter: this.filter,
			sorter: this.instantiationService.createInstance(FileSorter),
			dnd: this.instantiationService.createInstance(FileDragAndDrop),
			autoExpandSingleChildren: true,
			additionalScrollHeight: ExplorerDelegate.ITEM_HEIGHT,
			overrideStyles: {
				listBackground: SIDE_BAR_BACKGROUND
			}
		});
		this._register(this.tree);

		// Bind configuration
		const onDidChangeCompressionConfiguration = Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('explorer.compactFolders'));
		this._register(onDidChangeCompressionConfiguration(_ => this.tree.updateOptions({ compressionEnabled: isCompressionEnabled() })));

		// Bind context keys
		FilesExplorerFocusedContext.bindTo(this.tree.contextKeyService);
		ExplorerFocusedContext.bindTo(this.tree.contextKeyService);

		// Update resource context based on focused element
		this._register(this.tree.onDidChangeFocus(e => this.onFocusChanged(e.elements)));
		this.onFocusChanged([]);
		// Open when selecting via keyboard
		this._register(this.tree.onDidOpen(async e => {
			const element = e.element;
			if (!element) {
				return;
			}
			// Do not react if the user is expanding selection via keyboard.
			// Check if the item was previously also selected, if yes the user is simply expanding / collapsing current selection #66589.
			const shiftDown = e.browserEvent instanceof KeyboardEvent && e.browserEvent.shiftKey;
			if (!shiftDown) {
				if (element.isDirectory || this.explorerService.isEditable(undefined)) {
					// Do not react if user is clicking on explorer items while some are being edited #70276
					// Do not react if clicking on directories
					return;
				}
				this.telemetryService.publicLog2<WorkbenchActionExecutedEvent, WorkbenchActionExecutedClassification>('workbenchActionExecuted', { id: 'workbench.files.openFile', from: 'explorer' });
				await this.editorService.openEditor({ resource: element.resource, options: { preserveFocus: e.editorOptions.preserveFocus, pinned: e.editorOptions.pinned } }, e.sideBySide ? SIDE_GROUP : ACTIVE_GROUP);
			}
		}));

		this._register(this.tree.onContextMenu(e => this.onContextMenu(e)));

		this._register(this.tree.onDidScroll(async e => {
			let editable = this.explorerService.getEditable();
			if (e.scrollTopChanged && editable && this.tree.getRelativeTop(editable.stat) === null) {
				await editable.data.onFinish('', false);
			}
		}));

		this._register(this.tree.onDidChangeCollapseState(e => {
			const element = e.node.element?.element;
			if (element) {
				const navigationController = this.renderer.getCompressedNavigationController(element instanceof Array ? element[0] : element);
				if (navigationController) {
					navigationController.updateCollapsed(e.node.collapsed);
				}
			}
		}));

		this._register(this.tree.onMouseDblClick(e => {
			if (e.element === null) {
				// click in empty area -> create a new file #116676
				this.commandService.executeCommand(NEW_FILE_COMMAND_ID);
			}
		}));

		// save view state
		this._register(this.storageService.onWillSaveState(() => {
			this.storageService.store(ExplorerView.TREE_VIEW_STATE_STORAGE_KEY, JSON.stringify(this.tree.getViewState()), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}));
	}

	// React on events

	private onConfigurationUpdated(configuration: IFilesConfiguration, event?: IConfigurationChangeEvent): void {
		this.autoReveal = configuration?.explorer?.autoReveal;

		// Push down config updates to components of viewer
		if (event && (event.affectsConfiguration('explorer.decorations.colors') || event.affectsConfiguration('explorer.decorations.badges'))) {
			this.refresh(true);
		}
	}

	private setContextKeys(stat: ExplorerItem | null | undefined): void {
		const isSingleFolder = this.contextService.getWorkbenchState() === WorkbenchState.FOLDER;
		const resource = stat ? stat.resource : isSingleFolder ? this.contextService.getWorkspace().folders[0].uri : null;
		this.resourceContext.set(resource);
		this.folderContext.set((isSingleFolder && !stat) || !!stat && stat.isDirectory);
		this.readonlyContext.set(!!stat && stat.isReadonly);
		this.rootContext.set(!stat || (stat && stat.isRoot));

		if (resource) {
			const overrides = resource ? this.editorService.getEditorOverrides(resource, undefined, undefined) : [];
			this.availableEditorIdsContext.set(overrides.map(([, entry]) => entry.id).join(','));
		} else {
			this.availableEditorIdsContext.reset();
		}
	}

	private async onContextMenu(e: ITreeContextMenuEvent<ExplorerItem>): Promise<void> {
		const disposables = new DisposableStore();
		let stat = e.element;
		let anchor = e.anchor;

		// Compressed folders
		if (stat) {
			const controller = this.renderer.getCompressedNavigationController(stat);

			if (controller) {
				if (e.browserEvent instanceof KeyboardEvent || isCompressedFolderName(e.browserEvent.target)) {
					anchor = controller.labels[controller.index];
				} else {
					controller.last();
				}
			}
		}

		// update dynamic contexts
		this.fileCopiedContextKey.set(await this.clipboardService.hasResources());
		this.setContextKeys(stat);

		const selection = this.tree.getSelection();

		const actions: IAction[] = [];
		const roots = this.explorerService.roots; // If the click is outside of the elements pass the root resource if there is only one root. If there are multiple roots pass empty object.
		let arg: URI | {};
		if (stat instanceof ExplorerItem) {
			const compressedController = this.renderer.getCompressedNavigationController(stat);
			arg = compressedController ? compressedController.current.resource : stat.resource;
		} else {
			arg = roots.length === 1 ? roots[0].resource : {};
		}
		disposables.add(createAndFillInContextMenuActions(this.contributedContextMenu, { arg, shouldForwardArgs: true }, actions));

		this.contextMenuService.showContextMenu({
			getAnchor: () => anchor,
			getActions: () => actions,
			onHide: (wasCancelled?: boolean) => {
				if (wasCancelled) {
					this.tree.domFocus();
				}

				disposables.dispose();
			},
			getActionsContext: () => stat && selection && selection.indexOf(stat) >= 0
				? selection.map((fs: ExplorerItem) => fs.resource)
				: stat instanceof ExplorerItem ? [stat.resource] : []
		});
	}

	private onFocusChanged(elements: ExplorerItem[]): void {
		const stat = elements && elements.length ? elements[0] : undefined;
		this.setContextKeys(stat);

		if (stat) {
			const enableTrash = this.configurationService.getValue<IFilesConfiguration>().files.enableTrash;
			const hasCapability = this.fileService.hasCapability(stat.resource, FileSystemProviderCapabilities.Trash);
			this.resourceMoveableToTrash.set(enableTrash && hasCapability);
		} else {
			this.resourceMoveableToTrash.reset();
		}

		const compressedNavigationController = stat && this.renderer.getCompressedNavigationController(stat);

		if (!compressedNavigationController) {
			this.compressedFocusContext.set(false);
			return;
		}

		this.compressedFocusContext.set(true);
		this.updateCompressedNavigationContextKeys(compressedNavigationController);
	}

	// General methods

	/**
	 * Refresh the contents of the explorer to get up to date data from the disk about the file structure.
	 * If the item is passed we refresh only that level of the tree, otherwise we do a full refresh.
	 */
	refresh(recursive: boolean, item?: ExplorerItem, cancelEditing: boolean = true): Promise<void> {
		if (!this.tree || !this.isBodyVisible() || (item && !this.tree.hasNode(item))) {
			// Tree node doesn't exist yet
			this.shouldRefresh = true;
			return Promise.resolve(undefined);
		}

		if (cancelEditing && this.explorerService.isEditable(undefined)) {
			this.tree.domFocus();
		}

		const toRefresh = item || this.tree.getInput();
		return this.tree.updateChildren(toRefresh, recursive, false, {
			diffIdentityProvider: identityProvider
		});
	}

	focusNeighbourIfItemFocused(item: ExplorerItem): void {
		const focus = this.tree.getFocus();
		if (focus.length !== 1) {
			return;
		}
		const compressedController = this.renderer.getCompressedNavigationController(focus[0]) || this.renderer.getCompressedNavigationController(item);
		const indexOfItem = compressedController?.items.indexOf(item) || -1;
		const itemsCompressedTogether = compressedController && (compressedController.items.indexOf(focus[0]) >= 0) && (indexOfItem >= 0);

		if (focus[0] === item || itemsCompressedTogether) {
			if (itemsCompressedTogether && indexOfItem > 0 && item.parent) {
				// In case of compact items just focus the parent if it is part of the compact item. So the focus stays
				this.tree.setFocus([item.parent]);
			} else {
				this.tree.focusNext();
				const newFocus = this.tree.getFocus();
				if (newFocus.length === 1 && newFocus[0] === item) {
					// There was no next item to focus, focus the previous one
					this.tree.focusPrevious();
				}
			}
		}
	}

	override getOptimalWidth(): number {
		const parentNode = this.tree.getHTMLElement();
		const childNodes = ([] as HTMLElement[]).slice.call(parentNode.querySelectorAll('.explorer-item .label-name')); // select all file labels

		return DOM.getLargestChildWidth(parentNode, childNodes);
	}

	async setTreeInput(): Promise<void> {
		if (!this.isBodyVisible()) {
			this.shouldRefresh = true;
			return Promise.resolve(undefined);
		}

		const initialInputSetup = !this.tree.getInput();
		if (initialInputSetup) {
			perf.mark('code/willResolveExplorer');
		}
		const roots = this.explorerService.roots;
		let input: ExplorerItem | ExplorerItem[] = roots[0];
		if (this.contextService.getWorkbenchState() !== WorkbenchState.FOLDER || roots[0].isError) {
			// Display roots only when multi folder workspace
			input = roots;
		}

		let viewState: IAsyncDataTreeViewState | undefined;
		if (this.tree && this.tree.getInput()) {
			viewState = this.tree.getViewState();
		} else {
			const rawViewState = this.storageService.get(ExplorerView.TREE_VIEW_STATE_STORAGE_KEY, StorageScope.WORKSPACE);
			if (rawViewState) {
				viewState = JSON.parse(rawViewState);
			}
		}

		const previousInput = this.tree.getInput();
		const promise = this.tree.setInput(input, viewState).then(async () => {
			if (Array.isArray(input)) {
				if (!viewState || previousInput instanceof ExplorerItem) {
					// There is no view state for this workspace, expand all roots. Or we transitioned from a folder workspace.
					await Promise.all(input.map(async item => {
						try {
							await this.tree.expand(item);
						} catch (e) { }
					}));
				}
				if (Array.isArray(previousInput) && previousInput.length < input.length) {
					// Roots added to the explorer -> expand them.
					await Promise.all(input.slice(previousInput.length).map(async item => {
						try {
							await this.tree.expand(item);
						} catch (e) { }
					}));
				}
			}
			if (initialInputSetup) {
				perf.mark('code/didResolveExplorer');
			}
		});

		this.progressService.withProgress({
			location: ProgressLocation.Explorer,
			delay: this.layoutService.isRestored() ? 800 : 1500 // reduce progress visibility when still restoring
		}, _progress => promise);

		await promise;
		if (!this.decorationsProvider) {
			this.decorationsProvider = new ExplorerDecorationsProvider(this.explorerService, this.contextService);
			this._register(this.decorationService.registerDecorationsProvider(this.decorationsProvider));
		}
	}

	public async selectResource(resource: URI | undefined, reveal = this.autoReveal, retry = 0): Promise<void> {
		// do no retry more than once to prevent inifinite loops in cases of inconsistent model
		if (retry === 2) {
			return;
		}

		if (!resource || !this.isBodyVisible()) {
			return;
		}

		// Expand all stats in the parent chain.
		let item: ExplorerItem | null = this.explorerService.findClosestRoot(resource);

		while (item && item.resource.toString() !== resource.toString()) {
			try {
				await this.tree.expand(item);
			} catch (e) {
				return this.selectResource(resource, reveal, retry + 1);
			}

			for (let child of item.children.values()) {
				if (this.uriIdentityService.extUri.isEqualOrParent(resource, child.resource)) {
					item = child;
					break;
				}
				item = null;
			}
		}

		if (item) {
			if (item === this.tree.getInput()) {
				this.tree.setFocus([]);
				this.tree.setSelection([]);
				return;
			}

			try {
				if (reveal === true && this.tree.getRelativeTop(item) === null) {
					// Don't scroll to the item if it's already visible, or if set not to.
					this.tree.reveal(item, 0.5);
				}

				this.tree.setFocus([item]);
				this.tree.setSelection([item]);
			} catch (e) {
				// Element might not be in the tree, try again and silently fail
				return this.selectResource(resource, reveal, retry + 1);
			}
		}
	}

	itemsCopied(stats: ExplorerItem[], cut: boolean, previousCut: ExplorerItem[] | undefined): void {
		this.fileCopiedContextKey.set(stats.length > 0);
		this.resourceCutContextKey.set(cut && stats.length > 0);
		if (previousCut) {
			previousCut.forEach(item => this.tree.rerender(item));
		}
		if (cut) {
			stats.forEach(s => this.tree.rerender(s));
		}
	}

	collapseAll(): void {
		if (this.explorerService.isEditable(undefined)) {
			this.tree.domFocus();
		}

		const treeInput = this.tree.getInput();
		if (Array.isArray(treeInput)) {
			if (hasExpandedRootChild(this.tree, treeInput)) {
				treeInput.forEach(folder => {
					folder.children.forEach(child => this.tree.hasNode(child) && this.tree.collapse(child, true));
				});

				return;
			}
		}

		this.tree.collapseAll();
	}

	previousCompressedStat(): void {
		const focused = this.tree.getFocus();
		if (!focused.length) {
			return;
		}

		const compressedNavigationController = this.renderer.getCompressedNavigationController(focused[0])!;
		compressedNavigationController.previous();
		this.updateCompressedNavigationContextKeys(compressedNavigationController);
	}

	nextCompressedStat(): void {
		const focused = this.tree.getFocus();
		if (!focused.length) {
			return;
		}

		const compressedNavigationController = this.renderer.getCompressedNavigationController(focused[0])!;
		compressedNavigationController.next();
		this.updateCompressedNavigationContextKeys(compressedNavigationController);
	}

	firstCompressedStat(): void {
		const focused = this.tree.getFocus();
		if (!focused.length) {
			return;
		}

		const compressedNavigationController = this.renderer.getCompressedNavigationController(focused[0])!;
		compressedNavigationController.first();
		this.updateCompressedNavigationContextKeys(compressedNavigationController);
	}

	lastCompressedStat(): void {
		const focused = this.tree.getFocus();
		if (!focused.length) {
			return;
		}

		const compressedNavigationController = this.renderer.getCompressedNavigationController(focused[0])!;
		compressedNavigationController.last();
		this.updateCompressedNavigationContextKeys(compressedNavigationController);
	}

	private updateCompressedNavigationContextKeys(controller: ICompressedNavigationController): void {
		this.compressedFocusFirstContext.set(controller.index === 0);
		this.compressedFocusLastContext.set(controller.index === controller.count - 1);
	}

	styleListDropBackground(styles: IExplorerViewStyles): void {
		const content: string[] = [];

		if (styles.listDropBackground) {
			content.push(`.explorer-viewlet .explorer-item .monaco-icon-name-container.multiple > .label-name.drop-target > .monaco-highlighted-label { background-color: ${styles.listDropBackground}; }`);
		}

		const newStyles = content.join('\n');
		if (newStyles !== this.styleElement.textContent) {
			this.styleElement.textContent = newStyles;
		}
	}

	override dispose(): void {
		if (this.dragHandler) {
			this.dragHandler.dispose();
		}
		super.dispose();
	}
}

function createFileIconThemableTreeContainerScope(container: HTMLElement, themeService: IThemeService): IDisposable {
	container.classList.add('file-icon-themable-tree');
	container.classList.add('show-file-icons');

	const onDidChangeFileIconTheme = (theme: IFileIconTheme) => {
		container.classList.toggle('align-icons-and-twisties', theme.hasFileIcons && !theme.hasFolderIcons);
		container.classList.toggle('hide-arrows', theme.hidesExplorerArrows === true);
	};

	onDidChangeFileIconTheme(themeService.getFileIconTheme());
	return themeService.onDidFileIconThemeChange(onDidChangeFileIconTheme);
}

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.files.action.createFileFromExplorer',
			title: nls.localize('createNewFile', "New File"),
			f1: false,
			icon: Codicon.newFile,
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				when: ContextKeyEqualsExpr.create('view', VIEW_ID),
				order: 10
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const commandService = accessor.get(ICommandService);
		commandService.executeCommand(NEW_FILE_COMMAND_ID);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.files.action.createFolderFromExplorer',
			title: nls.localize('createNewFolder', "New Folder"),
			f1: false,
			icon: Codicon.newFolder,
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				when: ContextKeyEqualsExpr.create('view', VIEW_ID),
				order: 20
			}
		});
	}

	run(accessor: ServicesAccessor): void {
		const commandService = accessor.get(ICommandService);
		commandService.executeCommand(NEW_FOLDER_COMMAND_ID);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.files.action.refreshFilesExplorer',
			title: { value: nls.localize('refreshExplorer', "Refresh Explorer"), original: 'Refresh Explorer' },
			f1: true,
			icon: Codicon.refresh,
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				when: ContextKeyEqualsExpr.create('view', VIEW_ID),
				order: 30
			}
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const viewletService = accessor.get(IViewletService);
		const explorerService = accessor.get(IExplorerService);
		await viewletService.openViewlet(VIEWLET_ID);
		await explorerService.refresh();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.files.action.collapseExplorerFolders',
			title: { value: nls.localize('collapseExplorerFolders', "Collapse Folders in Explorer"), original: 'Collapse Folders in Explorer' },
			f1: true,
			icon: Codicon.collapseAll,
			menu: {
				id: MenuId.ViewTitle,
				group: 'navigation',
				when: ContextKeyEqualsExpr.create('view', VIEW_ID),
				order: 40
			}
		});
	}

	run(accessor: ServicesAccessor) {
		const viewsService = accessor.get(IViewsService);
		const explorerView = viewsService.getViewWithId(VIEW_ID) as ExplorerView;
		explorerView.collapseAll();
	}
});
