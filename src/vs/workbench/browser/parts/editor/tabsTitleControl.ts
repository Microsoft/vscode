/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/tabstitlecontrol';
import { isMacintosh, isWindows } from 'vs/base/common/platform';
import { shorten } from 'vs/base/common/labels';
import { EditorResourceAccessor, GroupIdentifier, IEditorInput, Verbosity, EditorCommandsContextActionRunner, IEditorPartOptions, SideBySideEditor, computeEditorAriaLabel } from 'vs/workbench/common/editor';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { EventType as TouchEventType, GestureEvent, Gesture } from 'vs/base/browser/touch';
import { KeyCode } from 'vs/base/common/keyCodes';
import { ResourceLabels, IResourceLabel, DEFAULT_LABELS_CONTAINER } from 'vs/workbench/browser/labels';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IMenuService } from 'vs/platform/actions/common/actions';
import { TitleControl } from 'vs/workbench/browser/parts/editor/titleControl';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IDisposable, dispose, DisposableStore, combinedDisposable, MutableDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ScrollableElement } from 'vs/base/browser/ui/scrollbar/scrollableElement';
import { ScrollbarVisibility } from 'vs/base/common/scrollable';
import { getOrSet } from 'vs/base/common/map';
import { IThemeService, registerThemingParticipant, IColorTheme, ICssStyleCollector } from 'vs/platform/theme/common/themeService';
import { TAB_INACTIVE_BACKGROUND, TAB_ACTIVE_BACKGROUND, TAB_ACTIVE_FOREGROUND, TAB_INACTIVE_FOREGROUND, TAB_BORDER, EDITOR_DRAG_AND_DROP_BACKGROUND, TAB_UNFOCUSED_ACTIVE_FOREGROUND, TAB_UNFOCUSED_INACTIVE_FOREGROUND, TAB_UNFOCUSED_ACTIVE_BACKGROUND, TAB_UNFOCUSED_ACTIVE_BORDER, TAB_ACTIVE_BORDER, TAB_HOVER_BACKGROUND, TAB_HOVER_BORDER, TAB_UNFOCUSED_HOVER_BACKGROUND, TAB_UNFOCUSED_HOVER_BORDER, EDITOR_GROUP_HEADER_TABS_BACKGROUND, WORKBENCH_BACKGROUND, TAB_ACTIVE_BORDER_TOP, TAB_UNFOCUSED_ACTIVE_BORDER_TOP, TAB_ACTIVE_MODIFIED_BORDER, TAB_INACTIVE_MODIFIED_BORDER, TAB_UNFOCUSED_ACTIVE_MODIFIED_BORDER, TAB_UNFOCUSED_INACTIVE_MODIFIED_BORDER, TAB_UNFOCUSED_INACTIVE_BACKGROUND, TAB_HOVER_FOREGROUND, TAB_UNFOCUSED_HOVER_FOREGROUND, EDITOR_GROUP_HEADER_TABS_BORDER, TAB_LAST_PINNED_BORDER } from 'vs/workbench/common/theme';
import { activeContrastBorder, contrastBorder, editorBackground, breadcrumbsBackground } from 'vs/platform/theme/common/colorRegistry';
import { ResourcesDropHandler, DraggedEditorIdentifier, DraggedEditorGroupIdentifier, DragAndDropObserver } from 'vs/workbench/browser/dnd';
import { Color } from 'vs/base/common/color';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { MergeGroupMode, IMergeGroupOptions, GroupsArrangement, IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { addDisposableListener, EventType, EventHelper, Dimension, scheduleAtNextAnimationFrame, findParentWithClass, clearNode } from 'vs/base/browser/dom';
import { localize } from 'vs/nls';
import { IEditorGroupsAccessor, IEditorGroupView, EditorServiceImpl, IEditorGroupTitleDimensions } from 'vs/workbench/browser/parts/editor/editor';
import { CloseOneEditorAction, UnpinEditorAction } from 'vs/workbench/browser/parts/editor/editorActions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { BreadcrumbsControl } from 'vs/workbench/browser/parts/editor/breadcrumbsControl';
import { IFileService } from 'vs/platform/files/common/files';
import { withNullAsUndefined, assertAllDefined, assertIsDefined } from 'vs/base/common/types';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { basenameOrAuthority } from 'vs/base/common/resources';
import { RunOnceScheduler } from 'vs/base/common/async';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IPath, win32, posix } from 'vs/base/common/path';
import { insert } from 'vs/base/common/arrays';
import { ColorScheme } from 'vs/platform/theme/common/theme';
import { isSafari } from 'vs/base/browser/browser';

interface IEditorInputLabel {
	name?: string;
	description?: string;
	title?: string;
	ariaLabel?: string;
}

type AugmentedLabel = IEditorInputLabel & { editor: IEditorInput };

export class TabsTitleControl extends TitleControl {

	private static readonly SCROLLBAR_SIZES = {
		default: 3,
		large: 10
	};

	private static readonly TAB_WIDTH = {
		compact: 38,
		shrink: 80,
		fit: 120
	};

	private static readonly TAB_HEIGHT = 35;

	private titleContainer: HTMLElement | undefined;
	private tabsAndActionsContainer: HTMLElement | undefined;
	private tabsContainer: HTMLElement | undefined;
	private editorToolbarContainer: HTMLElement | undefined;
	private tabsScrollbar: ScrollableElement | undefined;

	private readonly closeEditorAction = this._register(this.instantiationService.createInstance(CloseOneEditorAction, CloseOneEditorAction.ID, CloseOneEditorAction.LABEL));
	private readonly unpinEditorAction = this._register(this.instantiationService.createInstance(UnpinEditorAction, UnpinEditorAction.ID, UnpinEditorAction.LABEL));

	private readonly tabResourceLabels = this._register(this.instantiationService.createInstance(ResourceLabels, DEFAULT_LABELS_CONTAINER));
	private tabLabels: IEditorInputLabel[] = [];
	private tabActionBars: ActionBar[] = [];
	private tabDisposables: IDisposable[] = [];

	private dimension: Dimension | undefined;
	private readonly layoutScheduled = this._register(new MutableDisposable());
	private blockRevealActiveTab: boolean | undefined;

	private path: IPath = isWindows ? win32 : posix;

	constructor(
		parent: HTMLElement,
		accessor: IEditorGroupsAccessor,
		group: IEditorGroupView,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IKeybindingService keybindingService: IKeybindingService,
		@ITelemetryService telemetryService: ITelemetryService,
		@INotificationService notificationService: INotificationService,
		@IMenuService menuService: IMenuService,
		@IQuickInputService quickInputService: IQuickInputService,
		@IThemeService themeService: IThemeService,
		@IExtensionService extensionService: IExtensionService,
		@IConfigurationService configurationService: IConfigurationService,
		@IFileService fileService: IFileService,
		@IEditorService private readonly editorService: EditorServiceImpl,
		@IPathService private readonly pathService: IPathService,
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService
	) {
		super(parent, accessor, group, contextMenuService, instantiationService, contextKeyService, keybindingService, telemetryService, notificationService, menuService, quickInputService, themeService, extensionService, configurationService, fileService);

		// Resolve the correct path library for the OS we are on
		// If we are connected to remote, this accounts for the
		// remote OS.
		(async () => this.path = await this.pathService.path)();
	}

	protected create(parent: HTMLElement): void {
		this.titleContainer = parent;

		// Tabs and Actions Container (are on a single row with flex side-by-side)
		this.tabsAndActionsContainer = document.createElement('div');
		this.tabsAndActionsContainer.classList.add('tabs-and-actions-container');
		this.titleContainer.appendChild(this.tabsAndActionsContainer);

		// Tabs Container
		this.tabsContainer = document.createElement('div');
		this.tabsContainer.setAttribute('role', 'tablist');
		this.tabsContainer.draggable = true;
		this.tabsContainer.classList.add('tabs-container');
		this._register(Gesture.addTarget(this.tabsContainer));

		// Tabs Scrollbar
		this.tabsScrollbar = this._register(this.createTabsScrollbar(this.tabsContainer));
		this.tabsAndActionsContainer.appendChild(this.tabsScrollbar.getDomNode());

		// Tabs Container listeners
		this.registerTabsContainerListeners(this.tabsContainer, this.tabsScrollbar);

		// Editor Toolbar Container
		this.editorToolbarContainer = document.createElement('div');
		this.editorToolbarContainer.classList.add('editor-actions');
		this.tabsAndActionsContainer.appendChild(this.editorToolbarContainer);

		// Editor Actions Toolbar
		this.createEditorActionsToolBar(this.editorToolbarContainer);

		// Breadcrumbs (are on a separate row below tabs and actions)
		const breadcrumbsContainer = document.createElement('div');
		breadcrumbsContainer.classList.add('tabs-breadcrumbs');
		this.titleContainer.appendChild(breadcrumbsContainer);
		this.createBreadcrumbsControl(breadcrumbsContainer, { showFileIcons: true, showSymbolIcons: true, showDecorationColors: false, breadcrumbsBackground: breadcrumbsBackground });
	}

	private createTabsScrollbar(scrollable: HTMLElement): ScrollableElement {
		const tabsScrollbar = new ScrollableElement(scrollable, {
			horizontal: ScrollbarVisibility.Auto,
			horizontalScrollbarSize: this.getTabsScrollbarSizing(),
			vertical: ScrollbarVisibility.Hidden,
			scrollYToX: true,
			useShadows: false
		});

		tabsScrollbar.onScroll(e => {
			scrollable.scrollLeft = e.scrollLeft;
		});

		return tabsScrollbar;
	}

	private updateTabsScrollbarSizing(): void {
		this.tabsScrollbar?.updateOptions({
			horizontalScrollbarSize: this.getTabsScrollbarSizing()
		});
	}

	private getTabsScrollbarSizing(): number {
		if (this.accessor.partOptions.titleScrollbarSizing !== 'large') {
			return TabsTitleControl.SCROLLBAR_SIZES.default;
		}

		return TabsTitleControl.SCROLLBAR_SIZES.large;
	}

	private updateBreadcrumbsControl(): void {
		if (this.breadcrumbsControl && this.breadcrumbsControl.update()) {
			this.group.relayout(); // relayout when we have a breadcrumbs and when update changed its hidden-status
		}
	}

	protected handleBreadcrumbsEnablementChange(): void {
		this.group.relayout(); // relayout when breadcrumbs are enable/disabled
	}

	private registerTabsContainerListeners(tabsContainer: HTMLElement, tabsScrollbar: ScrollableElement): void {

		// Group dragging
		this.enableGroupDragging(tabsContainer);

		// Forward scrolling inside the container to our custom scrollbar
		this._register(addDisposableListener(tabsContainer, EventType.SCROLL, () => {
			if (tabsContainer.classList.contains('scroll')) {
				tabsScrollbar.setScrollPosition({
					scrollLeft: tabsContainer.scrollLeft // during DND the container gets scrolled so we need to update the custom scrollbar
				});
			}
		}));

		// New file when double clicking on tabs container (but not tabs)
		[TouchEventType.Tap, EventType.DBLCLICK].forEach(eventType => {
			this._register(addDisposableListener(tabsContainer, eventType, (e: MouseEvent | GestureEvent) => {
				if (eventType === EventType.DBLCLICK) {
					if (e.target !== tabsContainer) {
						return; // ignore if target is not tabs container
					}
				} else {
					if ((<GestureEvent>e).tapCount !== 2) {
						return; // ignore single taps
					}

					if ((<GestureEvent>e).initialTarget !== tabsContainer) {
						return; // ignore if target is not tabs container
					}
				}

				EventHelper.stop(e);

				this.group.openEditor(
					this.editorService.createEditorInput({ forceUntitled: true }),
					{
						pinned: true,			// untitled is always pinned
						index: this.group.count // always at the end
					}
				);
			}));
		});

		// Prevent auto-scrolling (https://github.com/microsoft/vscode/issues/16690)
		this._register(addDisposableListener(tabsContainer, EventType.MOUSE_DOWN, (e: MouseEvent) => {
			if (e.button === 1) {
				e.preventDefault();
			}
		}));

		// Drop support
		this._register(new DragAndDropObserver(tabsContainer, {
			onDragEnter: e => {

				// Always enable support to scroll while dragging
				tabsContainer.classList.add('scroll');

				// Return if the target is not on the tabs container
				if (e.target !== tabsContainer) {
					this.updateDropFeedback(tabsContainer, false); // fixes https://github.com/microsoft/vscode/issues/52093
					return;
				}

				// Return if transfer is unsupported
				if (!this.isSupportedDropTransfer(e)) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'none';
					}

					return;
				}

				// Return if dragged editor is last tab because then this is a no-op
				let isLocalDragAndDrop = false;
				if (this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
					isLocalDragAndDrop = true;

					const data = this.editorTransfer.getData(DraggedEditorIdentifier.prototype);
					if (Array.isArray(data)) {
						const localDraggedEditor = data[0].identifier;
						if (this.group.id === localDraggedEditor.groupId && this.group.getIndexOfEditor(localDraggedEditor.editor) === this.group.count - 1) {
							if (e.dataTransfer) {
								e.dataTransfer.dropEffect = 'none';
							}

							return;
						}
					}
				}

				// Update the dropEffect to "copy" if there is no local data to be dragged because
				// in that case we can only copy the data into and not move it from its source
				if (!isLocalDragAndDrop) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'copy';
					}
				}

				this.updateDropFeedback(tabsContainer, true);
			},

			onDragLeave: e => {
				this.updateDropFeedback(tabsContainer, false);
				tabsContainer.classList.remove('scroll');
			},

			onDragEnd: e => {
				this.updateDropFeedback(tabsContainer, false);
				tabsContainer.classList.remove('scroll');
			},

			onDrop: e => {
				this.updateDropFeedback(tabsContainer, false);
				tabsContainer.classList.remove('scroll');

				if (e.target === tabsContainer) {
					this.onDrop(e, this.group.count, tabsContainer);
				}
			}
		}));

		// Mouse-wheel support to switch to tabs optionally
		this._register(addDisposableListener(tabsContainer, EventType.MOUSE_WHEEL, (e: MouseWheelEvent) => {
			const activeEditor = this.group.activeEditor;
			if (!activeEditor || this.group.count < 2) {
				return;  // need at least 2 open editors
			}

			// Shift-key enables or disables this behaviour depending on the setting
			if (this.accessor.partOptions.scrollToSwitchTabs === true) {
				if (e.shiftKey) {
					return; // 'on': only enable this when Shift-key is not pressed
				}
			} else {
				if (!e.shiftKey) {
					return; // 'off': only enable this when Shift-key is pressed
				}
			}

			// Figure out scrolling direction
			const nextEditor = this.group.getEditorByIndex(this.group.getIndexOfEditor(activeEditor) + (e.deltaX < 0 || e.deltaY < 0 /* scrolling up */ ? -1 : 1));
			if (!nextEditor) {
				return;
			}

			// Open it
			this.group.openEditor(nextEditor);

			// Disable normal scrolling, opening the editor will already reveal it properly
			EventHelper.stop(e, true);
		}));
	}

	protected updateEditorActionsToolbar(): void {
		super.updateEditorActionsToolbar();

		// Changing the actions in the toolbar can have an impact on the size of the
		// tab container, so we need to layout the tabs to make sure the active is visible
		this.layout(this.dimension);
	}

	openEditor(editor: IEditorInput): void {

		// Create tabs as needed
		const [tabsContainer, tabsScrollbar] = assertAllDefined(this.tabsContainer, this.tabsScrollbar);
		for (let i = tabsContainer.children.length; i < this.group.count; i++) {
			tabsContainer.appendChild(this.createTab(i, tabsContainer, tabsScrollbar));
		}

		// An add of a tab requires to recompute all labels
		this.computeTabLabels();

		// Redraw all tabs
		this.redraw();

		// Update Breadcrumbs
		this.updateBreadcrumbsControl();
	}

	closeEditor(editor: IEditorInput): void {
		this.handleClosedEditors();
	}

	closeEditors(editors: IEditorInput[]): void {
		this.handleClosedEditors();
		if (this.group.count === 0) {
			this.updateBreadcrumbsControl();
		}
	}

	private handleClosedEditors(): void {

		// There are tabs to show
		if (this.group.activeEditor) {

			// Remove tabs that got closed
			const tabsContainer = assertIsDefined(this.tabsContainer);
			while (tabsContainer.children.length > this.group.count) {

				// Remove one tab from container (must be the last to keep indexes in order!)
				(tabsContainer.lastChild as HTMLElement).remove();

				// Remove associated tab label and widget
				dispose(this.tabDisposables.pop());
			}

			// A removal of a label requires to recompute all labels
			this.computeTabLabels();

			// Redraw all tabs
			this.redraw();
		}

		// No tabs to show
		else {
			if (this.tabsContainer) {
				clearNode(this.tabsContainer);
			}

			this.tabDisposables = dispose(this.tabDisposables);
			this.tabResourceLabels.clear();
			this.tabLabels = [];
			this.tabActionBars = [];

			this.clearEditorActionsToolbar();
		}
	}

	moveEditor(editor: IEditorInput, fromIndex: number, targetIndex: number): void {

		// Swap the editor label
		const editorLabel = this.tabLabels[fromIndex];
		this.tabLabels.splice(fromIndex, 1);
		this.tabLabels.splice(targetIndex, 0, editorLabel);

		// As such we need to redraw each tab
		this.forEachTab((editor, index, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => {
			this.redrawTab(editor, index, tabContainer, tabLabelWidget, tabLabel, tabActionBar);
		});

		// Moving an editor requires a layout to keep the active editor visible
		this.layout(this.dimension);
	}

	pinEditor(editor: IEditorInput): void {
		this.withTab(editor, (editor, index, tabContainer, tabLabelWidget, tabLabel) => this.redrawTabLabel(editor, index, tabContainer, tabLabelWidget, tabLabel));
	}

	stickEditor(editor: IEditorInput): void {
		this.doHandleStickyEditorChange(editor);
	}

	unstickEditor(editor: IEditorInput): void {
		this.doHandleStickyEditorChange(editor);
	}

	private doHandleStickyEditorChange(editor: IEditorInput): void {

		// Update tab
		this.withTab(editor, (editor, index, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => this.redrawTab(editor, index, tabContainer, tabLabelWidget, tabLabel, tabActionBar));

		// Sticky change has an impact on each tab's border because
		// it potentially moves the border to the last pinned tab
		this.forEachTab((editor, index, tabContainer, tabLabelWidget, tabLabel) => {
			this.redrawTabBorders(index, tabContainer);
		});

		// A change to the sticky state requires a layout to keep the active editor visible
		this.layout(this.dimension);
	}

	setActive(isGroupActive: boolean): void {

		// Activity has an impact on each tab's active indication
		this.forEachTab((editor, index, tabContainer, tabLabelWidget, tabLabel) => {
			this.redrawTabActiveAndDirty(isGroupActive, editor, tabContainer, tabLabelWidget);
		});

		// Activity has an impact on the toolbar, so we need to update and layout
		this.updateEditorActionsToolbar();
		this.layout(this.dimension);
	}

	private updateEditorLabelAggregator = this._register(new RunOnceScheduler(() => this.updateEditorLabels(), 0));

	updateEditorLabel(editor: IEditorInput): void {

		// Update all labels to account for changes to tab labels
		// Since this method may be called a lot of times from
		// individual editors, we collect all those requests and
		// then run the update once because we have to update
		// all opened tabs in the group at once.
		this.updateEditorLabelAggregator.schedule();
	}

	updateEditorLabels(): void {

		// A change to a label requires to recompute all labels
		this.computeTabLabels();

		// As such we need to redraw each label
		this.forEachTab((editor, index, tabContainer, tabLabelWidget, tabLabel) => {
			this.redrawTabLabel(editor, index, tabContainer, tabLabelWidget, tabLabel);
		});

		// A change to a label requires a layout to keep the active editor visible
		this.layout(this.dimension);
	}

	updateEditorDirty(editor: IEditorInput): void {
		this.withTab(editor, (editor, index, tabContainer, tabLabelWidget) => this.redrawTabActiveAndDirty(this.accessor.activeGroup === this.group, editor, tabContainer, tabLabelWidget));
	}

	updateOptions(oldOptions: IEditorPartOptions, newOptions: IEditorPartOptions): void {

		// A change to a label format options requires to recompute all labels
		if (oldOptions.labelFormat !== newOptions.labelFormat) {
			this.computeTabLabels();
		}

		// Update tabs scrollbar sizing
		if (oldOptions.titleScrollbarSizing !== newOptions.titleScrollbarSizing) {
			this.updateTabsScrollbarSizing();
		}

		// Redraw tabs when other options change
		if (
			oldOptions.labelFormat !== newOptions.labelFormat ||
			oldOptions.tabCloseButton !== newOptions.tabCloseButton ||
			oldOptions.tabSizing !== newOptions.tabSizing ||
			oldOptions.pinnedTabSizing !== newOptions.pinnedTabSizing ||
			oldOptions.showIcons !== newOptions.showIcons ||
			oldOptions.hasIcons !== newOptions.hasIcons ||
			oldOptions.highlightModifiedTabs !== newOptions.highlightModifiedTabs
		) {
			this.redraw();
		}
	}

	updateStyles(): void {
		this.redraw();
	}

	private forEachTab(fn: (editor: IEditorInput, index: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, tabActionBar: ActionBar) => void): void {
		this.group.editors.forEach((editor, index) => {
			this.doWithTab(index, editor, fn);
		});
	}

	private withTab(editor: IEditorInput, fn: (editor: IEditorInput, index: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, tabActionBar: ActionBar) => void): void {
		this.doWithTab(this.group.getIndexOfEditor(editor), editor, fn);
	}

	private doWithTab(index: number, editor: IEditorInput, fn: (editor: IEditorInput, index: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, tabActionBar: ActionBar) => void): void {
		const tabsContainer = assertIsDefined(this.tabsContainer);
		const tabContainer = tabsContainer.children[index] as HTMLElement;
		const tabResourceLabel = this.tabResourceLabels.get(index);
		const tabLabel = this.tabLabels[index];
		const tabActionBar = this.tabActionBars[index];
		if (tabContainer && tabResourceLabel && tabLabel) {
			fn(editor, index, tabContainer, tabResourceLabel, tabLabel, tabActionBar);
		}
	}

	private createTab(index: number, tabsContainer: HTMLElement, tabsScrollbar: ScrollableElement): HTMLElement {

		// Tab Container
		const tabContainer = document.createElement('div');
		tabContainer.draggable = true;
		tabContainer.tabIndex = 0;
		tabContainer.setAttribute('role', 'tab');
		tabContainer.classList.add('tab');

		// Gesture Support
		this._register(Gesture.addTarget(tabContainer));

		// Tab Border Top
		const tabBorderTopContainer = document.createElement('div');
		tabBorderTopContainer.classList.add('tab-border-top-container');
		tabContainer.appendChild(tabBorderTopContainer);

		// Tab Editor Label
		const editorLabel = this.tabResourceLabels.create(tabContainer);

		// Tab Actions
		const tabActionsContainer = document.createElement('div');
		tabActionsContainer.classList.add('tab-actions');
		tabContainer.appendChild(tabActionsContainer);

		const tabActionRunner = new EditorCommandsContextActionRunner({ groupId: this.group.id, editorIndex: index });

		const tabActionBar = new ActionBar(tabActionsContainer, { ariaLabel: localize('ariaLabelTabActions', "Tab actions"), actionRunner: tabActionRunner });
		tabActionBar.onBeforeRun(e => {
			if (e.action.id === this.closeEditorAction.id) {
				this.blockRevealActiveTabOnce();
			}
		});

		const tabActionBarDisposable = combinedDisposable(tabActionBar, toDisposable(insert(this.tabActionBars, tabActionBar)));

		// Tab Border Bottom
		const tabBorderBottomContainer = document.createElement('div');
		tabBorderBottomContainer.classList.add('tab-border-bottom-container');
		tabContainer.appendChild(tabBorderBottomContainer);

		// Eventing
		const eventsDisposable = this.registerTabListeners(tabContainer, index, tabsContainer, tabsScrollbar);

		this.tabDisposables.push(combinedDisposable(eventsDisposable, tabActionBarDisposable, tabActionRunner, editorLabel));

		return tabContainer;
	}

	private registerTabListeners(tab: HTMLElement, index: number, tabsContainer: HTMLElement, tabsScrollbar: ScrollableElement): IDisposable {
		const disposables = new DisposableStore();

		const handleClickOrTouch = (e: MouseEvent | GestureEvent): void => {
			tab.blur(); // prevent flicker of focus outline on tab until editor got focus

			if (e instanceof MouseEvent && e.button !== 0) {
				if (e.button === 1) {
					e.preventDefault(); // required to prevent auto-scrolling (https://github.com/microsoft/vscode/issues/16690)
				}

				return undefined; // only for left mouse click
			}

			if (this.originatesFromTabActionBar(e)) {
				return; // not when clicking on actions
			}

			// Open tabs editor
			const input = this.group.getEditorByIndex(index);
			if (input) {
				this.group.openEditor(input);
			}

			return undefined;
		};

		const showContextMenu = (e: Event) => {
			EventHelper.stop(e);

			const input = this.group.getEditorByIndex(index);
			if (input) {
				this.onContextMenu(input, e, tab);
			}
		};

		// Open on Click / Touch
		disposables.add(addDisposableListener(tab, EventType.MOUSE_DOWN, (e: MouseEvent) => handleClickOrTouch(e)));
		disposables.add(addDisposableListener(tab, TouchEventType.Tap, (e: GestureEvent) => handleClickOrTouch(e)));

		// Touch Scroll Support
		disposables.add(addDisposableListener(tab, TouchEventType.Change, (e: GestureEvent) => {
			tabsScrollbar.setScrollPosition({ scrollLeft: tabsScrollbar.getScrollPosition().scrollLeft - e.translationX });
		}));

		// Prevent flicker of focus outline on tab until editor got focus
		disposables.add(addDisposableListener(tab, EventType.MOUSE_UP, (e: MouseEvent) => {
			EventHelper.stop(e);

			tab.blur();
		}));

		// Close on mouse middle click
		disposables.add(addDisposableListener(tab, EventType.AUXCLICK, (e: MouseEvent) => {
			if (e.button === 1 /* Middle Button*/) {
				EventHelper.stop(e, true /* for https://github.com/microsoft/vscode/issues/56715 */);

				this.blockRevealActiveTabOnce();
				this.closeEditorAction.run({ groupId: this.group.id, editorIndex: index });
			}
		}));

		// Context menu on Shift+F10
		disposables.add(addDisposableListener(tab, EventType.KEY_DOWN, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			if (event.shiftKey && event.keyCode === KeyCode.F10) {
				showContextMenu(e);
			}
		}));

		// Context menu on touch context menu gesture
		disposables.add(addDisposableListener(tab, TouchEventType.Contextmenu, (e: GestureEvent) => {
			showContextMenu(e);
		}));

		// Keyboard accessibility
		disposables.add(addDisposableListener(tab, EventType.KEY_UP, (e: KeyboardEvent) => {
			const event = new StandardKeyboardEvent(e);
			let handled = false;

			// Run action on Enter/Space
			if (event.equals(KeyCode.Enter) || event.equals(KeyCode.Space)) {
				handled = true;
				const input = this.group.getEditorByIndex(index);
				if (input) {
					this.group.openEditor(input);
				}
			}

			// Navigate in editors
			else if ([KeyCode.LeftArrow, KeyCode.RightArrow, KeyCode.UpArrow, KeyCode.DownArrow, KeyCode.Home, KeyCode.End].some(kb => event.equals(kb))) {
				let targetIndex: number;
				if (event.equals(KeyCode.LeftArrow) || event.equals(KeyCode.UpArrow)) {
					targetIndex = index - 1;
				} else if (event.equals(KeyCode.RightArrow) || event.equals(KeyCode.DownArrow)) {
					targetIndex = index + 1;
				} else if (event.equals(KeyCode.Home)) {
					targetIndex = 0;
				} else {
					targetIndex = this.group.count - 1;
				}

				const target = this.group.getEditorByIndex(targetIndex);
				if (target) {
					handled = true;
					this.group.openEditor(target, { preserveFocus: true });
					(<HTMLElement>tabsContainer.childNodes[targetIndex]).focus();
				}
			}

			if (handled) {
				EventHelper.stop(e, true);
			}

			// moving in the tabs container can have an impact on scrolling position, so we need to update the custom scrollbar
			tabsScrollbar.setScrollPosition({
				scrollLeft: tabsContainer.scrollLeft
			});
		}));

		// Double click: either pin or toggle maximized
		[TouchEventType.Tap, EventType.DBLCLICK].forEach(eventType => {
			disposables.add(addDisposableListener(tab, eventType, (e: MouseEvent | GestureEvent) => {
				if (eventType === EventType.DBLCLICK) {
					EventHelper.stop(e);
				} else if ((<GestureEvent>e).tapCount !== 2) {
					return; // ignore single taps
				}

				const editor = this.group.getEditorByIndex(index);
				if (editor && this.group.isPinned(editor)) {
					this.accessor.arrangeGroups(GroupsArrangement.TOGGLE, this.group);
				} else {
					this.group.pinEditor(editor);
				}
			}));
		});

		// Context menu
		disposables.add(addDisposableListener(tab, EventType.CONTEXT_MENU, (e: Event) => {
			EventHelper.stop(e, true);

			const input = this.group.getEditorByIndex(index);
			if (input) {
				this.onContextMenu(input, e, tab);
			}
		}, true /* use capture to fix https://github.com/microsoft/vscode/issues/19145 */));

		// Drag support
		disposables.add(addDisposableListener(tab, EventType.DRAG_START, (e: DragEvent) => {
			const editor = this.group.getEditorByIndex(index);
			if (!editor) {
				return;
			}

			this.editorTransfer.setData([new DraggedEditorIdentifier({ editor, groupId: this.group.id })], DraggedEditorIdentifier.prototype);

			if (e.dataTransfer) {
				e.dataTransfer.effectAllowed = 'copyMove';
			}

			// Apply some datatransfer types to allow for dragging the element outside of the application
			this.doFillResourceDataTransfers(editor, e);

			// Fixes https://github.com/microsoft/vscode/issues/18733
			tab.classList.add('dragged');
			scheduleAtNextAnimationFrame(() => tab.classList.remove('dragged'));
		}));

		// Drop support
		disposables.add(new DragAndDropObserver(tab, {
			onDragEnter: e => {

				// Update class to signal drag operation
				tab.classList.add('dragged-over');

				// Return if transfer is unsupported
				if (!this.isSupportedDropTransfer(e)) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'none';
					}

					return;
				}

				// Return if dragged editor is the current tab dragged over
				let isLocalDragAndDrop = false;
				if (this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
					isLocalDragAndDrop = true;

					const data = this.editorTransfer.getData(DraggedEditorIdentifier.prototype);
					if (Array.isArray(data)) {
						const localDraggedEditor = data[0].identifier;
						if (localDraggedEditor.editor === this.group.getEditorByIndex(index) && localDraggedEditor.groupId === this.group.id) {
							if (e.dataTransfer) {
								e.dataTransfer.dropEffect = 'none';
							}

							return;
						}
					}
				}

				// Update the dropEffect to "copy" if there is no local data to be dragged because
				// in that case we can only copy the data into and not move it from its source
				if (!isLocalDragAndDrop) {
					if (e.dataTransfer) {
						e.dataTransfer.dropEffect = 'copy';
					}
				}

				this.updateDropFeedback(tab, true, index);
			},

			onDragLeave: () => {
				tab.classList.remove('dragged-over');
				this.updateDropFeedback(tab, false, index);
			},

			onDragEnd: () => {
				tab.classList.remove('dragged-over');
				this.updateDropFeedback(tab, false, index);

				this.editorTransfer.clearData(DraggedEditorIdentifier.prototype);
			},

			onDrop: e => {
				tab.classList.remove('dragged-over');
				this.updateDropFeedback(tab, false, index);

				this.onDrop(e, index, tabsContainer);
			}
		}));

		return disposables;
	}

	private isSupportedDropTransfer(e: DragEvent): boolean {
		if (this.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype)) {
			const data = this.groupTransfer.getData(DraggedEditorGroupIdentifier.prototype);
			if (Array.isArray(data)) {
				const group = data[0];
				if (group.identifier === this.group.id) {
					return false; // groups cannot be dropped on title area it originates from
				}
			}

			return true;
		}

		if (this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
			return true; // (local) editors can always be dropped
		}

		if (e.dataTransfer && e.dataTransfer.types.length > 0) {
			return true; // optimistically allow external data (// see https://github.com/microsoft/vscode/issues/25789)
		}

		return false;
	}

	private updateDropFeedback(element: HTMLElement, isDND: boolean, index?: number): void {
		const isTab = (typeof index === 'number');
		const editor = typeof index === 'number' ? this.group.getEditorByIndex(index) : undefined;
		const isActiveTab = isTab && !!editor && this.group.isActive(editor);

		// Background
		const noDNDBackgroundColor = isTab ? this.getColor(isActiveTab ? TAB_ACTIVE_BACKGROUND : TAB_INACTIVE_BACKGROUND) : '';
		element.style.backgroundColor = (isDND ? this.getColor(EDITOR_DRAG_AND_DROP_BACKGROUND) : noDNDBackgroundColor) || '';

		// Outline
		const activeContrastBorderColor = this.getColor(activeContrastBorder);
		if (activeContrastBorderColor && isDND) {
			element.style.outlineWidth = '2px';
			element.style.outlineStyle = 'dashed';
			element.style.outlineColor = activeContrastBorderColor;
			element.style.outlineOffset = isTab ? '-5px' : '-3px';
		} else {
			element.style.outlineWidth = '';
			element.style.outlineStyle = '';
			element.style.outlineColor = activeContrastBorderColor || '';
			element.style.outlineOffset = '';
		}
	}

	private computeTabLabels(): void {
		const { labelFormat } = this.accessor.partOptions;
		const { verbosity, shortenDuplicates } = this.getLabelConfigFlags(labelFormat);

		// Build labels and descriptions for each editor
		const labels = this.group.editors.map((editor, index) => ({
			editor,
			name: editor.getName(),
			description: editor.getDescription(verbosity),
			title: withNullAsUndefined(editor.getTitle(Verbosity.LONG)),
			ariaLabel: computeEditorAriaLabel(editor, index, this.group, this.editorGroupService.count)
		}));

		// Shorten labels as needed
		if (shortenDuplicates) {
			this.shortenTabLabels(labels);
		}

		this.tabLabels = labels;
	}

	private shortenTabLabels(labels: AugmentedLabel[]): void {

		// Gather duplicate titles, while filtering out invalid descriptions
		const mapTitleToDuplicates = new Map<string, AugmentedLabel[]>();
		for (const label of labels) {
			if (typeof label.description === 'string') {
				getOrSet(mapTitleToDuplicates, label.name, []).push(label);
			} else {
				label.description = '';
			}
		}

		// Identify duplicate titles and shorten descriptions
		mapTitleToDuplicates.forEach(duplicateTitles => {

			// Remove description if the title isn't duplicated
			if (duplicateTitles.length === 1) {
				duplicateTitles[0].description = '';

				return;
			}

			// Identify duplicate descriptions
			const mapDescriptionToDuplicates = new Map<string, AugmentedLabel[]>();
			for (const label of duplicateTitles) {
				getOrSet(mapDescriptionToDuplicates, label.description, []).push(label);
			}

			// For editors with duplicate descriptions, check whether any long descriptions differ
			let useLongDescriptions = false;
			mapDescriptionToDuplicates.forEach((duplicateDescriptions, name) => {
				if (!useLongDescriptions && duplicateDescriptions.length > 1) {
					const [first, ...rest] = duplicateDescriptions.map(({ editor }) => editor.getDescription(Verbosity.LONG));
					useLongDescriptions = rest.some(description => description !== first);
				}
			});

			// If so, replace all descriptions with long descriptions
			if (useLongDescriptions) {
				mapDescriptionToDuplicates.clear();
				duplicateTitles.forEach(label => {
					label.description = label.editor.getDescription(Verbosity.LONG);
					getOrSet(mapDescriptionToDuplicates, label.description, []).push(label);
				});
			}

			// Obtain final set of descriptions
			const descriptions: string[] = [];
			mapDescriptionToDuplicates.forEach((_, description) => descriptions.push(description));

			// Remove description if all descriptions are identical
			if (descriptions.length === 1) {
				for (const label of mapDescriptionToDuplicates.get(descriptions[0]) || []) {
					label.description = '';
				}

				return;
			}

			// Shorten descriptions
			const shortenedDescriptions = shorten(descriptions, this.path.sep);
			descriptions.forEach((description, i) => {
				for (const label of mapDescriptionToDuplicates.get(description) || []) {
					label.description = shortenedDescriptions[i];
				}
			});
		});
	}

	private getLabelConfigFlags(value: string | undefined) {
		switch (value) {
			case 'short':
				return { verbosity: Verbosity.SHORT, shortenDuplicates: false };
			case 'medium':
				return { verbosity: Verbosity.MEDIUM, shortenDuplicates: false };
			case 'long':
				return { verbosity: Verbosity.LONG, shortenDuplicates: false };
			default:
				return { verbosity: Verbosity.MEDIUM, shortenDuplicates: true };
		}
	}

	private redraw(): void {

		// Border below tabs if any
		const tabsContainerBorderColor = this.getColor(EDITOR_GROUP_HEADER_TABS_BORDER);
		if (this.tabsAndActionsContainer) {
			if (tabsContainerBorderColor) {
				this.tabsAndActionsContainer.classList.add('tabs-border-bottom');
				this.tabsAndActionsContainer.style.setProperty('--tabs-border-bottom-color', tabsContainerBorderColor.toString());
			} else {
				this.tabsAndActionsContainer.classList.remove('tabs-border-bottom');
				this.tabsAndActionsContainer.style.removeProperty('--tabs-border-bottom-color');
			}
		}

		// For each tab
		this.forEachTab((editor, index, tabContainer, tabLabelWidget, tabLabel, tabActionBar) => {
			this.redrawTab(editor, index, tabContainer, tabLabelWidget, tabLabel, tabActionBar);
		});

		// Update Editor Actions Toolbar
		this.updateEditorActionsToolbar();

		// Ensure the active tab is always revealed
		this.layout(this.dimension);
	}

	private redrawTab(editor: IEditorInput, index: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel, tabActionBar: ActionBar): void {
		const isTabSticky = this.group.isSticky(index);
		const options = this.accessor.partOptions;

		// Label
		this.redrawTabLabel(editor, index, tabContainer, tabLabelWidget, tabLabel);

		// Action
		const tabAction = isTabSticky ? this.unpinEditorAction : this.closeEditorAction;
		if (!tabActionBar.hasAction(tabAction)) {
			if (!tabActionBar.isEmpty()) {
				tabActionBar.clear();
			}
			tabActionBar.push(tabAction, { icon: true, label: false, keybinding: this.getKeybindingLabel(tabAction) });
		}

		// Settings
		const tabActionsVisibility = isTabSticky && options.pinnedTabSizing === 'compact' ? 'off' /* treat sticky compact tabs as tabCloseButton: 'off' */ : options.tabCloseButton;
		['off', 'left', 'right'].forEach(option => {
			tabContainer.classList.toggle(`tab-actions-${option}`, tabActionsVisibility === option);
		});

		const tabSizing = isTabSticky && options.pinnedTabSizing === 'shrink' ? 'shrink' /* treat sticky shrink tabs as tabSizing: 'shrink' */ : options.tabSizing;
		['fit', 'shrink'].forEach(option => {
			tabContainer.classList.toggle(`sizing-${option}`, tabSizing === option);
		});

		tabContainer.classList.toggle('has-icon', options.showIcons && options.hasIcons);

		tabContainer.classList.toggle('sticky', isTabSticky);
		['normal', 'compact', 'shrink'].forEach(option => {
			tabContainer.classList.toggle(`sticky-${option}`, isTabSticky && options.pinnedTabSizing === option);
		});

		// Sticky compact/shrink tabs need a position to remain at their location
		// when scrolling to stay in view (requirement for position: sticky)
		if (isTabSticky && options.pinnedTabSizing !== 'normal') {
			let stickyTabWidth = 0;
			switch (options.pinnedTabSizing) {
				case 'compact':
					stickyTabWidth = TabsTitleControl.TAB_WIDTH.compact;
					break;
				case 'shrink':
					stickyTabWidth = TabsTitleControl.TAB_WIDTH.shrink;
					break;
			}

			tabContainer.style.left = `${index * stickyTabWidth}px`;
		} else {
			tabContainer.style.left = 'auto';
		}

		// Borders / outline
		this.redrawTabBorders(index, tabContainer);

		// Active / dirty state
		this.redrawTabActiveAndDirty(this.accessor.activeGroup === this.group, editor, tabContainer, tabLabelWidget);
	}

	private redrawTabLabel(editor: IEditorInput, index: number, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel, tabLabel: IEditorInputLabel): void {
		const options = this.accessor.partOptions;

		// Unless tabs are sticky compact, show the full label and description
		// Sticky compact tabs will only show an icon if icons are enabled
		// or their first character of the name otherwise
		let name: string | undefined;
		let forceLabel = false;
		let description: string;
		if (options.pinnedTabSizing === 'compact' && this.group.isSticky(index)) {
			const isShowingIcons = options.showIcons && options.hasIcons;
			name = isShowingIcons ? '' : tabLabel.name?.charAt(0).toUpperCase();
			description = '';
			forceLabel = true;
		} else {
			name = tabLabel.name;
			description = tabLabel.description || '';
		}

		const title = tabLabel.title || '';

		if (tabLabel.ariaLabel) {
			tabContainer.setAttribute('aria-label', tabLabel.ariaLabel);
			// Set aria-description to empty string so that screen readers would not read the title as well
			// More details https://github.com/microsoft/vscode/issues/95378
			tabContainer.setAttribute('aria-description', '');
		}
		tabContainer.title = title;

		// Label
		tabLabelWidget.setResource(
			{ name, description, resource: EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.BOTH }) },
			{ title, extraClasses: ['tab-label'], italic: !this.group.isPinned(editor), forceLabel }
		);

		// Tests helper
		const resource = EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY });
		if (resource) {
			tabContainer.setAttribute('data-resource-name', basenameOrAuthority(resource));
		} else {
			tabContainer.removeAttribute('data-resource-name');
		}
	}

	private redrawTabActiveAndDirty(isGroupActive: boolean, editor: IEditorInput, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel): void {
		const isTabActive = this.group.isActive(editor);

		const hasModifiedBorderTop = this.doRedrawTabDirty(isGroupActive, isTabActive, editor, tabContainer);

		this.doRedrawTabActive(isGroupActive, !hasModifiedBorderTop, editor, tabContainer, tabLabelWidget);
	}

	private doRedrawTabActive(isGroupActive: boolean, allowBorderTop: boolean, editor: IEditorInput, tabContainer: HTMLElement, tabLabelWidget: IResourceLabel): void {

		// Tab is active
		if (this.group.isActive(editor)) {

			// Container
			tabContainer.classList.add('active');
			tabContainer.setAttribute('aria-selected', 'true');
			tabContainer.style.backgroundColor = this.getColor(isGroupActive ? TAB_ACTIVE_BACKGROUND : TAB_UNFOCUSED_ACTIVE_BACKGROUND) || '';

			const activeTabBorderColorBottom = this.getColor(isGroupActive ? TAB_ACTIVE_BORDER : TAB_UNFOCUSED_ACTIVE_BORDER);
			if (activeTabBorderColorBottom) {
				tabContainer.classList.add('tab-border-bottom');
				tabContainer.style.setProperty('--tab-border-bottom-color', activeTabBorderColorBottom.toString());
			} else {
				tabContainer.classList.remove('tab-border-bottom');
				tabContainer.style.removeProperty('--tab-border-bottom-color');
			}

			const activeTabBorderColorTop = allowBorderTop ? this.getColor(isGroupActive ? TAB_ACTIVE_BORDER_TOP : TAB_UNFOCUSED_ACTIVE_BORDER_TOP) : undefined;
			if (activeTabBorderColorTop) {
				tabContainer.classList.add('tab-border-top');
				tabContainer.style.setProperty('--tab-border-top-color', activeTabBorderColorTop.toString());
			} else {
				tabContainer.classList.remove('tab-border-top');
				tabContainer.style.removeProperty('--tab-border-top-color');
			}

			// Label
			tabContainer.style.color = this.getColor(isGroupActive ? TAB_ACTIVE_FOREGROUND : TAB_UNFOCUSED_ACTIVE_FOREGROUND) || '';
		}

		// Tab is inactive
		else {

			// Container
			tabContainer.classList.remove('active');
			tabContainer.setAttribute('aria-selected', 'false');
			tabContainer.style.backgroundColor = this.getColor(isGroupActive ? TAB_INACTIVE_BACKGROUND : TAB_UNFOCUSED_INACTIVE_BACKGROUND) || '';
			tabContainer.style.boxShadow = '';

			// Label
			tabContainer.style.color = this.getColor(isGroupActive ? TAB_INACTIVE_FOREGROUND : TAB_UNFOCUSED_INACTIVE_FOREGROUND) || '';
		}
	}

	private doRedrawTabDirty(isGroupActive: boolean, isTabActive: boolean, editor: IEditorInput, tabContainer: HTMLElement): boolean {
		let hasModifiedBorderColor = false;

		// Tab: dirty (unless saving)
		if (editor.isDirty() && !editor.isSaving()) {
			tabContainer.classList.add('dirty');

			// Highlight modified tabs with a border if configured
			if (this.accessor.partOptions.highlightModifiedTabs) {
				let modifiedBorderColor: string | null;
				if (isGroupActive && isTabActive) {
					modifiedBorderColor = this.getColor(TAB_ACTIVE_MODIFIED_BORDER);
				} else if (isGroupActive && !isTabActive) {
					modifiedBorderColor = this.getColor(TAB_INACTIVE_MODIFIED_BORDER);
				} else if (!isGroupActive && isTabActive) {
					modifiedBorderColor = this.getColor(TAB_UNFOCUSED_ACTIVE_MODIFIED_BORDER);
				} else {
					modifiedBorderColor = this.getColor(TAB_UNFOCUSED_INACTIVE_MODIFIED_BORDER);
				}

				if (modifiedBorderColor) {
					hasModifiedBorderColor = true;

					tabContainer.classList.add('dirty-border-top');
					tabContainer.style.setProperty('--tab-dirty-border-top-color', modifiedBorderColor);
				}
			} else {
				tabContainer.classList.remove('dirty-border-top');
				tabContainer.style.removeProperty('--tab-dirty-border-top-color');
			}
		}

		// Tab: not dirty
		else {
			tabContainer.classList.remove('dirty', 'dirty-border-top');
			tabContainer.style.removeProperty('--tab-dirty-border-top-color');
		}

		return hasModifiedBorderColor;
	}

	private redrawTabBorders(index: number, tabContainer: HTMLElement): void {
		const isTabSticky = this.group.isSticky(index);
		const isTabLastSticky = isTabSticky && this.group.stickyCount === index + 1;

		// Borders / Outline
		const borderRightColor = ((isTabLastSticky ? this.getColor(TAB_LAST_PINNED_BORDER) : undefined) || this.getColor(TAB_BORDER) || this.getColor(contrastBorder));
		tabContainer.style.borderRight = borderRightColor ? `1px solid ${borderRightColor}` : '';
		tabContainer.style.outlineColor = this.getColor(activeContrastBorder) || '';
	}

	getDimensions(): IEditorGroupTitleDimensions {
		let height = TabsTitleControl.TAB_HEIGHT;
		if (this.breadcrumbsControl && !this.breadcrumbsControl.isHidden()) {
			height += BreadcrumbsControl.HEIGHT;
		}

		return {
			height,
			offset: TabsTitleControl.TAB_HEIGHT
		};
	}

	layout(dimension: Dimension | undefined): void {
		this.dimension = dimension;

		const activeTabAndIndex = this.group.activeEditor ? this.getTabAndIndex(this.group.activeEditor) : undefined;
		if (!activeTabAndIndex || !this.dimension) {
			return;
		}

		// The layout of tabs can be an expensive operation because we access DOM properties
		// that can result in the browser doing a full page layout to validate them. To buffer
		// this a little bit we try at least to schedule this work on the next animation frame.
		if (!this.layoutScheduled.value) {
			this.layoutScheduled.value = scheduleAtNextAnimationFrame(() => {
				const dimension = assertIsDefined(this.dimension);
				this.doLayout(dimension);

				this.layoutScheduled.clear();
			});
		}
	}

	private doLayout(dimension: Dimension): void {
		const activeTabAndIndex = this.group.activeEditor ? this.getTabAndIndex(this.group.activeEditor) : undefined;
		if (!activeTabAndIndex) {
			return; // nothing to do if not editor opened
		}

		// Breadcrumbs
		this.doLayoutBreadcrumbs(dimension);

		// Tabs
		const [activeTab, activeIndex] = activeTabAndIndex;
		this.doLayoutTabs(activeTab, activeIndex);
	}

	private doLayoutBreadcrumbs(dimension: Dimension): void {
		if (this.breadcrumbsControl && !this.breadcrumbsControl.isHidden()) {
			const tabsScrollbar = assertIsDefined(this.tabsScrollbar);

			this.breadcrumbsControl.layout(new Dimension(dimension.width, BreadcrumbsControl.HEIGHT));
			tabsScrollbar.getDomNode().style.height = `${dimension.height - BreadcrumbsControl.HEIGHT}px`;
		}
	}

	private doLayoutTabs(activeTab: HTMLElement, activeIndex: number): void {
		const [tabsContainer, tabsScrollbar] = assertAllDefined(this.tabsContainer, this.tabsScrollbar);

		//
		// Synopsis
		// - allTabsWidth:   			sum of all tab widths
		// - stickyTabsWidth:			sum of all sticky tab widths (unless `pinnedTabSizing: normal`)
		// - visibleContainerWidth: 	size of tab container
		// - availableContainerWidth: 	size of tab container minus size of sticky tabs
		//
		// [------------------------------ All tabs width ---------------------------------------]
		// [------------------- Visible container width -------------------]
		//                         [------ Available container width ------]
		// [ Sticky A ][ Sticky B ][ Tab C ][ Tab D ][ Tab E ][ Tab F ][ Tab G ][ Tab H ][ Tab I ]
		//                 Active Tab Width [-------]
		// [------- Active Tab Pos X -------]
		// [-- Sticky Tabs Width --]
		//

		const visibleTabsContainerWidth = tabsContainer.offsetWidth;
		const allTabsWidth = tabsContainer.scrollWidth;

		// Compute width of sticky tabs depending on pinned tab sizing
		// - compact: sticky-tabs * TAB_SIZES.compact
		// -  shrink: sticky-tabs * TAB_SIZES.shrink
		// -  normal: 0 (sticky tabs inherit look and feel from non-sticky tabs)
		let stickyTabsWidth = 0;
		if (this.group.stickyCount > 0) {
			let stickyTabWidth = 0;
			switch (this.accessor.partOptions.pinnedTabSizing) {
				case 'compact':
					stickyTabWidth = TabsTitleControl.TAB_WIDTH.compact;
					break;
				case 'shrink':
					stickyTabWidth = TabsTitleControl.TAB_WIDTH.shrink;
					break;
			}

			stickyTabsWidth = this.group.stickyCount * stickyTabWidth;
		}

		// Figure out if active tab is positioned static which has an
		// impact on wether to reveal the tab or not later
		let activeTabPositionStatic = this.accessor.partOptions.pinnedTabSizing !== 'normal' && this.group.isSticky(activeIndex);

		// Special case: we have sticky tabs but the available space for showing tabs
		// is little enough that we need to disable sticky tabs sticky positioning
		// so that tabs can be scrolled at naturally.
		let availableTabsContainerWidth = visibleTabsContainerWidth - stickyTabsWidth;
		if (this.group.stickyCount > 0 && availableTabsContainerWidth < TabsTitleControl.TAB_WIDTH.fit) {
			tabsContainer.classList.add('disable-sticky-tabs');

			availableTabsContainerWidth = visibleTabsContainerWidth;
			stickyTabsWidth = 0;
			activeTabPositionStatic = false;
		} else {
			tabsContainer.classList.remove('disable-sticky-tabs');
		}

		let activeTabPosX: number | undefined;
		let activeTabWidth: number | undefined;

		if (!this.blockRevealActiveTab) {
			activeTabPosX = activeTab.offsetLeft;
			activeTabWidth = activeTab.offsetWidth;
		}

		// Update scrollbar
		tabsScrollbar.setScrollDimensions({
			width: visibleTabsContainerWidth,
			scrollWidth: allTabsWidth
		});

		// Return now if we are blocked to reveal the active tab and clear flag
		// We also return if the active tab is positioned static because this
		// means it is always visible anyway.
		if (this.blockRevealActiveTab || typeof activeTabPosX !== 'number' || typeof activeTabWidth !== 'number' || activeTabPositionStatic) {
			this.blockRevealActiveTab = false;
			return;
		}

		// Reveal the active one
		const tabsContainerScrollPosX = tabsScrollbar.getScrollPosition().scrollLeft;
		const activeTabFits = activeTabWidth <= availableTabsContainerWidth;
		const adjustedActiveTabPosX = activeTabPosX - stickyTabsWidth;

		//
		// Synopsis
		// - adjustedActiveTabPosX: the adjusted tabPosX takes the width of sticky tabs into account
		//   conceptually the scrolling only begins after sticky tabs so in order to reveal a tab fully
		//   the actual position needs to be adjusted for sticky tabs.
		//
		// Tab is overflowing to the right: Scroll minimally until the element is fully visible to the right
		// Note: only try to do this if we actually have enough width to give to show the tab fully!
		//
		// Example: Tab G should be made active and needs to be fully revealed as such.
		//
		// [-------------------------------- All tabs width -----------------------------------------]
		// [-------------------- Visible container width --------------------]
		//                           [----- Available container width -------]
		//     [ Sticky A ][ Sticky B ][ Tab C ][ Tab D ][ Tab E ][ Tab F ][ Tab G ][ Tab H ][ Tab I ]
		//                     Active Tab Width [-------]
		//     [------- Active Tab Pos X -------]
		//                             [-------- Adjusted Tab Pos X -------]
		//     [-- Sticky Tabs Width --]
		//
		//
		if (activeTabFits && tabsContainerScrollPosX + availableTabsContainerWidth < adjustedActiveTabPosX + activeTabWidth) {
			tabsScrollbar.setScrollPosition({
				scrollLeft: tabsContainerScrollPosX + ((adjustedActiveTabPosX + activeTabWidth) /* right corner of tab */ - (tabsContainerScrollPosX + availableTabsContainerWidth) /* right corner of view port */)
			});
		}

		//
		// Tab is overlflowing to the left or does not fit: Scroll it into view to the left
		//
		// Example: Tab C should be made active and needs to be fully revealed as such.
		//
		// [----------------------------- All tabs width ----------------------------------------]
		//     [------------------ Visible container width ------------------]
		//                           [----- Available container width -------]
		// [ Sticky A ][ Sticky B ][ Tab C ][ Tab D ][ Tab E ][ Tab F ][ Tab G ][ Tab H ][ Tab I ]
		//                 Active Tab Width [-------]
		// [------- Active Tab Pos X -------]
		//      Adjusted Tab Pos X []
		// [-- Sticky Tabs Width --]
		//
		//
		else if (tabsContainerScrollPosX > adjustedActiveTabPosX || !activeTabFits) {
			tabsScrollbar.setScrollPosition({
				scrollLeft: adjustedActiveTabPosX
			});
		}
	}

	private getTabAndIndex(editor: IEditorInput): [HTMLElement, number /* index */] | undefined {
		const editorIndex = this.group.getIndexOfEditor(editor);
		if (editorIndex >= 0) {
			const tabsContainer = assertIsDefined(this.tabsContainer);

			return [tabsContainer.children[editorIndex] as HTMLElement, editorIndex];
		}

		return undefined;
	}

	private blockRevealActiveTabOnce(): void {

		// When closing tabs through the tab close button or gesture, the user
		// might want to rapidly close tabs in sequence and as such revealing
		// the active tab after each close would be annoying. As such we block
		// the automated revealing of the active tab once after the close is
		// triggered.
		this.blockRevealActiveTab = true;
	}

	private originatesFromTabActionBar(e: MouseEvent | GestureEvent): boolean {
		let element: HTMLElement;
		if (e instanceof MouseEvent) {
			element = (e.target || e.srcElement) as HTMLElement;
		} else {
			element = (e as GestureEvent).initialTarget as HTMLElement;
		}

		return !!findParentWithClass(element, 'action-item', 'tab');
	}

	private onDrop(e: DragEvent, targetIndex: number, tabsContainer: HTMLElement): void {
		EventHelper.stop(e, true);

		this.updateDropFeedback(tabsContainer, false);
		tabsContainer.classList.remove('scroll');

		// Local Editor DND
		if (this.editorTransfer.hasData(DraggedEditorIdentifier.prototype)) {
			const data = this.editorTransfer.getData(DraggedEditorIdentifier.prototype);
			if (Array.isArray(data)) {
				const draggedEditor = data[0].identifier;
				const sourceGroup = this.accessor.getGroup(draggedEditor.groupId);

				if (sourceGroup) {

					// Move editor to target position and index
					if (this.isMoveOperation(e, draggedEditor.groupId)) {
						sourceGroup.moveEditor(draggedEditor.editor, this.group, { index: targetIndex });
					}

					// Copy editor to target position and index
					else {
						sourceGroup.copyEditor(draggedEditor.editor, this.group, { index: targetIndex });
					}
				}

				this.group.focus();
				this.editorTransfer.clearData(DraggedEditorIdentifier.prototype);
			}
		}

		// Local Editor Group DND
		else if (this.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype)) {
			const data = this.groupTransfer.getData(DraggedEditorGroupIdentifier.prototype);
			if (data) {
				const sourceGroup = this.accessor.getGroup(data[0].identifier);

				if (sourceGroup) {
					const mergeGroupOptions: IMergeGroupOptions = { index: targetIndex };
					if (!this.isMoveOperation(e, sourceGroup.id)) {
						mergeGroupOptions.mode = MergeGroupMode.COPY_EDITORS;
					}

					this.accessor.mergeGroup(sourceGroup, this.group, mergeGroupOptions);
				}

				this.group.focus();
				this.groupTransfer.clearData(DraggedEditorGroupIdentifier.prototype);
			}
		}

		// External DND
		else {
			const dropHandler = this.instantiationService.createInstance(ResourcesDropHandler, { allowWorkspaceOpen: false /* open workspace file as file if dropped */ });
			dropHandler.handleDrop(e, () => this.group, () => this.group.focus(), targetIndex);
		}
	}

	private isMoveOperation(e: DragEvent, source: GroupIdentifier) {
		const isCopy = (e.ctrlKey && !isMacintosh) || (e.altKey && isMacintosh);

		return !isCopy || source === this.group.id;
	}

	dispose(): void {
		super.dispose();

		this.tabDisposables = dispose(this.tabDisposables);
	}
}

registerThemingParticipant((theme: IColorTheme, collector: ICssStyleCollector) => {

	// Add border between tabs and breadcrumbs in high contrast mode.
	if (theme.type === ColorScheme.HIGH_CONTRAST) {
		const borderColor = (theme.getColor(TAB_BORDER) || theme.getColor(contrastBorder));
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title.tabs > .tabs-and-actions-container {
				border-bottom: 1px solid ${borderColor};
			}
		`);
	}

	// Styling with Outline color (e.g. high contrast theme)
	const activeContrastBorderColor = theme.getColor(activeContrastBorder);
	if (activeContrastBorderColor) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active:hover  {
				outline: 1px solid;
				outline-offset: -5px;
			}

			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover  {
				outline: 1px dashed;
				outline-offset: -5px;
			}

			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active > .tab-actions .action-label,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.active:hover > .tab-actions .action-label,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.dirty > .tab-actions .action-label,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab.sticky > .tab-actions .action-label,
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover > .tab-actions .action-label {
				opacity: 1 !important;
			}
		`);
	}

	// High Contrast Border Color for Editor Actions
	const contrastBorderColor = theme.getColor(contrastBorder);
	if (contrastBorderColor) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .editor-actions {
				outline: 1px solid ${contrastBorderColor}
			}
		`);
	}

	// Hover Background
	const tabHoverBackground = theme.getColor(TAB_HOVER_BACKGROUND);
	if (tabHoverBackground) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab:hover  {
				background-color: ${tabHoverBackground} !important;
			}
		`);
	}

	const tabUnfocusedHoverBackground = theme.getColor(TAB_UNFOCUSED_HOVER_BACKGROUND);
	if (tabUnfocusedHoverBackground) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover  {
				background-color: ${tabUnfocusedHoverBackground} !important;
			}
		`);
	}

	// Hover Foreground
	const tabHoverForeground = theme.getColor(TAB_HOVER_FOREGROUND);
	if (tabHoverForeground) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab:hover  {
				color: ${tabHoverForeground} !important;
			}
		`);
	}

	const tabUnfocusedHoverForeground = theme.getColor(TAB_UNFOCUSED_HOVER_FOREGROUND);
	if (tabUnfocusedHoverForeground) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover  {
				color: ${tabUnfocusedHoverForeground} !important;
			}
		`);
	}

	// Hover Border
	const tabHoverBorder = theme.getColor(TAB_HOVER_BORDER);
	if (tabHoverBorder) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container.active > .title .tabs-container > .tab:hover  {
				box-shadow: ${tabHoverBorder} 0 -1px inset !important;
			}
		`);
	}

	const tabUnfocusedHoverBorder = theme.getColor(TAB_UNFOCUSED_HOVER_BORDER);
	if (tabUnfocusedHoverBorder) {
		collector.addRule(`
			.monaco-workbench .part.editor > .content .editor-group-container > .title .tabs-container > .tab:hover  {
				box-shadow: ${tabUnfocusedHoverBorder} 0 -1px inset !important;
			}
		`);
	}

	// Fade out styles via linear gradient (when tabs are set to shrink)
	// But not when:
	// - in high contrast theme
	// - if we have a contrast border (which draws an outline - https://github.com/microsoft/vscode/issues/109117)
	// - on Safari (https://github.com/microsoft/vscode/issues/108996)
	if (theme.type !== 'hc' && !isSafari && !activeContrastBorderColor) {
		const workbenchBackground = WORKBENCH_BACKGROUND(theme);
		const editorBackgroundColor = theme.getColor(editorBackground);
		const editorGroupHeaderTabsBackground = theme.getColor(EDITOR_GROUP_HEADER_TABS_BACKGROUND);
		const editorDragAndDropBackground = theme.getColor(EDITOR_DRAG_AND_DROP_BACKGROUND);

		let adjustedTabBackground: Color | undefined;
		if (editorGroupHeaderTabsBackground && editorBackgroundColor) {
			adjustedTabBackground = editorGroupHeaderTabsBackground.flatten(editorBackgroundColor, editorBackgroundColor, workbenchBackground);
		}

		let adjustedTabDragBackground: Color | undefined;
		if (editorGroupHeaderTabsBackground && editorBackgroundColor && editorDragAndDropBackground && editorBackgroundColor) {
			adjustedTabDragBackground = editorGroupHeaderTabsBackground.flatten(editorBackgroundColor, editorDragAndDropBackground, editorBackgroundColor, workbenchBackground);
		}

		// Adjust gradient for focused and unfocused hover background
		const makeTabHoverBackgroundRule = (color: Color, colorDrag: Color, hasFocus = false) => `
			.monaco-workbench .part.editor > .content:not(.dragged-over) .editor-group-container${hasFocus ? '.active' : ''} > .title .tabs-container > .tab.sizing-shrink:not(.dragged):not(.sticky-compact):hover > .tab-label::after {
				background: linear-gradient(to left, ${color}, transparent) !important;
			}

			.monaco-workbench .part.editor > .content.dragged-over .editor-group-container${hasFocus ? '.active' : ''} > .title .tabs-container > .tab.sizing-shrink:not(.dragged):not(.sticky-compact):hover > .tab-label::after {
				background: linear-gradient(to left, ${colorDrag}, transparent) !important;
			}
		`;

		// Adjust gradient for (focused) hover background
		if (tabHoverBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabHoverBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabHoverBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabHoverBackgroundRule(adjustedColor, adjustedColorDrag, true));
		}

		// Adjust gradient for unfocused hover background
		if (tabUnfocusedHoverBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabUnfocusedHoverBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabUnfocusedHoverBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabHoverBackgroundRule(adjustedColor, adjustedColorDrag));
		}

		// Adjust gradient for drag and drop background
		if (editorDragAndDropBackground && adjustedTabDragBackground) {
			const adjustedColorDrag = editorDragAndDropBackground.flatten(adjustedTabDragBackground);
			collector.addRule(`
				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container.active > .title .tabs-container > .tab.sizing-shrink.dragged-over:not(.active):not(.dragged):not(.sticky-compact) > .tab-label::after,
				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container:not(.active) > .title .tabs-container > .tab.sizing-shrink.dragged-over:not(.dragged):not(.sticky-compact) > .tab-label::after {
					background: linear-gradient(to left, ${adjustedColorDrag}, transparent) !important;
				}
		`);
		}

		const makeTabBackgroundRule = (color: Color, colorDrag: Color, focused: boolean, active: boolean) => `
				.monaco-workbench .part.editor > .content:not(.dragged-over) .editor-group-container${focused ? '.active' : ':not(.active)'} > .title .tabs-container > .tab.sizing-shrink${active ? '.active' : ''}:not(.dragged):not(.sticky-compact) > .tab-label::after {
					background: linear-gradient(to left, ${color}, transparent);
				}

				.monaco-workbench .part.editor > .content.dragged-over .editor-group-container${focused ? '.active' : ':not(.active)'} > .title .tabs-container > .tab.sizing-shrink${active ? '.active' : ''}:not(.dragged):not(.sticky-compact) > .tab-label::after {
					background: linear-gradient(to left, ${colorDrag}, transparent);
				}
		`;

		// Adjust gradient for focused active tab background
		const tabActiveBackground = theme.getColor(TAB_ACTIVE_BACKGROUND);
		if (tabActiveBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabActiveBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabActiveBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabBackgroundRule(adjustedColor, adjustedColorDrag, true, true));
		}

		// Adjust gradient for unfocused active tab background
		const tabUnfocusedActiveBackground = theme.getColor(TAB_UNFOCUSED_ACTIVE_BACKGROUND);
		if (tabUnfocusedActiveBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabUnfocusedActiveBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabUnfocusedActiveBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabBackgroundRule(adjustedColor, adjustedColorDrag, false, true));
		}

		// Adjust gradient for focused inactive tab background
		const tabInactiveBackground = theme.getColor(TAB_INACTIVE_BACKGROUND);
		if (tabInactiveBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabInactiveBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabInactiveBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabBackgroundRule(adjustedColor, adjustedColorDrag, true, false));
		}

		// Adjust gradient for unfocused inactive tab background
		const tabUnfocusedInactiveBackground = theme.getColor(TAB_UNFOCUSED_INACTIVE_BACKGROUND);
		if (tabUnfocusedInactiveBackground && adjustedTabBackground && adjustedTabDragBackground) {
			const adjustedColor = tabUnfocusedInactiveBackground.flatten(adjustedTabBackground);
			const adjustedColorDrag = tabUnfocusedInactiveBackground.flatten(adjustedTabDragBackground);
			collector.addRule(makeTabBackgroundRule(adjustedColor, adjustedColorDrag, false, false));
		}
	}
});
