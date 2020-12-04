/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/scm';
import { Event, Emitter } from 'vs/base/common/event';
import { basename, dirname } from 'vs/base/common/resources';
import { IDisposable, Disposable, DisposableStore, combinedDisposable, dispose, toDisposable } from 'vs/base/common/lifecycle';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { append, $, Dimension, asCSSUrl } from 'vs/base/browser/dom';
import { IListVirtualDelegate, IIdentityProvider } from 'vs/base/browser/ui/list/list';
import { ISCMResourceGroup, ISCMResource, InputValidationType, ISCMRepository, ISCMInput, IInputValidation, ISCMViewService, ISCMViewVisibleRepositoryChangeEvent, ISCMService, SCMInputChangeReason } from 'vs/workbench/contrib/scm/common/scm';
import { ResourceLabels, IResourceLabel } from 'vs/workbench/browser/labels';
import { CountBadge } from 'vs/base/browser/ui/countBadge/countBadge';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IContextViewService, IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { MenuItemAction, IMenuService } from 'vs/platform/actions/common/actions';
import { IAction, IActionViewItem, ActionRunner, Action, RadioGroup, Separator, SubmenuAction, IActionViewItemProvider } from 'vs/base/common/actions';
import { ActionBar } from 'vs/base/browser/ui/actionbar/actionbar';
import { IThemeService, registerThemingParticipant, IFileIconTheme, ThemeIcon } from 'vs/platform/theme/common/themeService';
import { isSCMResource, isSCMResourceGroup, connectPrimaryMenuToInlineActionBar, isSCMRepository, isSCMInput, collectContextMenuActions, StatusBarAction, StatusBarActionViewItem, getRepositoryVisibilityActions } from './util';
import { attachBadgeStyler } from 'vs/platform/theme/common/styler';
import { WorkbenchCompressibleObjectTree, IOpenEvent } from 'vs/platform/list/browser/listService';
import { IConfigurationService, ConfigurationTarget, IConfigurationChangeEvent } from 'vs/platform/configuration/common/configuration';
import { disposableTimeout, ThrottledDelayer } from 'vs/base/common/async';
import { ITreeNode, ITreeFilter, ITreeSorter, ITreeContextMenuEvent } from 'vs/base/browser/ui/tree/tree';
import { ResourceTree, IResourceNode } from 'vs/base/common/resourceTree';
import { ISplice } from 'vs/base/common/sequence';
import { ICompressibleTreeRenderer, ICompressibleKeyboardNavigationLabelProvider } from 'vs/base/browser/ui/tree/objectTree';
import { Iterable } from 'vs/base/common/iterator';
import { ICompressedTreeNode, ICompressedTreeElement } from 'vs/base/browser/ui/tree/compressedObjectTreeModel';
import { URI } from 'vs/base/common/uri';
import { FileKind } from 'vs/platform/files/common/files';
import { compareFileNames, comparePaths } from 'vs/base/common/comparers';
import { FuzzyScore, createMatches, IMatch } from 'vs/base/common/filters';
import { IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';
import { localize } from 'vs/nls';
import { coalesce, flatten } from 'vs/base/common/arrays';
import { memoize } from 'vs/base/common/decorators';
import { IStorageService, StorageScope, StorageTarget, WillSaveStateReason } from 'vs/platform/storage/common/storage';
import { EditorResourceAccessor, SideBySideEditor } from 'vs/workbench/common/editor';
import { SIDE_BAR_BACKGROUND, SIDE_BAR_BORDER, PANEL_BACKGROUND, PANEL_INPUT_BORDER } from 'vs/workbench/common/theme';
import { CodeEditorWidget, ICodeEditorWidgetOptions } from 'vs/editor/browser/widget/codeEditorWidget';
import { ITextModel } from 'vs/editor/common/model';
import { IEditorConstructionOptions } from 'vs/editor/browser/editorBrowser';
import { getSimpleEditorOptions } from 'vs/workbench/contrib/codeEditor/browser/simpleEditorOptions';
import { IModelService } from 'vs/editor/common/services/modelService';
import { EditorExtensionsRegistry } from 'vs/editor/browser/editorExtensions';
import { MenuPreventer } from 'vs/workbench/contrib/codeEditor/browser/menuPreventer';
import { SelectionClipboardContributionID } from 'vs/workbench/contrib/codeEditor/browser/selectionClipboard';
import { ContextMenuController } from 'vs/editor/contrib/contextmenu/contextmenu';
import * as platform from 'vs/base/common/platform';
import { compare, format } from 'vs/base/common/strings';
import { inputPlaceholderForeground, inputValidationInfoBorder, inputValidationWarningBorder, inputValidationErrorBorder, inputValidationInfoBackground, inputValidationInfoForeground, inputValidationWarningBackground, inputValidationWarningForeground, inputValidationErrorBackground, inputValidationErrorForeground, inputBackground, inputForeground, inputBorder, focusBorder, registerColor, contrastBorder } from 'vs/platform/theme/common/colorRegistry';
import { SuggestController } from 'vs/editor/contrib/suggest/suggestController';
import { SnippetController2 } from 'vs/editor/contrib/snippet/snippetController2';
import { Schemas } from 'vs/base/common/network';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { ModesHoverController } from 'vs/editor/contrib/hover/hover';
import { ColorDetector } from 'vs/editor/contrib/colorPicker/colorDetector';
import { LinkDetector } from 'vs/editor/contrib/links/links';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IListAccessibilityProvider } from 'vs/base/browser/ui/list/listWidget';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ILabelService } from 'vs/platform/label/common/label';
import { KeyCode } from 'vs/base/common/keyCodes';
import { DEFAULT_FONT_FAMILY } from 'vs/workbench/browser/style';
import { Codicon } from 'vs/base/common/codicons';
import { AnchorAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { RepositoryRenderer } from 'vs/workbench/contrib/scm/browser/scmRepositoryRenderer';
import { ColorScheme } from 'vs/platform/theme/common/theme';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { LabelFuzzyScore } from 'vs/base/browser/ui/tree/abstractTree';
import { Selection } from 'vs/editor/common/core/selection';
import { API_OPEN_DIFF_EDITOR_COMMAND_ID, API_OPEN_EDITOR_COMMAND_ID } from 'vs/workbench/browser/parts/editor/editorCommands';

type TreeElement = ISCMRepository | ISCMInput | ISCMResourceGroup | IResourceNode<ISCMResource, ISCMResourceGroup> | ISCMResource;

interface ISCMLayout {
	height: number | undefined;
	width: number | undefined;
	readonly onDidChange: Event<void>;
}

interface InputTemplate {
	readonly inputWidget: SCMInputWidget;
	disposable: IDisposable;
	readonly templateDisposable: IDisposable;
}

class InputRenderer implements ICompressibleTreeRenderer<ISCMInput, FuzzyScore, InputTemplate> {

	static readonly DEFAULT_HEIGHT = 26;

	static readonly TEMPLATE_ID = 'input';
	get templateId(): string { return InputRenderer.TEMPLATE_ID; }

	private inputWidgets = new Map<ISCMInput, SCMInputWidget>();
	private contentHeights = new WeakMap<ISCMInput, number>();
	private editorSelections = new WeakMap<ISCMInput, Selection[]>();

	constructor(
		private outerLayout: ISCMLayout,
		private overflowWidgetsDomNode: HTMLElement,
		private updateHeight: (input: ISCMInput, height: number) => void,
		@IInstantiationService private instantiationService: IInstantiationService,
	) { }

	renderTemplate(container: HTMLElement): InputTemplate {
		// hack
		(container.parentElement!.parentElement!.querySelector('.monaco-tl-twistie')! as HTMLElement).classList.add('force-no-twistie');

		const disposables = new DisposableStore();
		const inputElement = append(container, $('.scm-input'));
		const inputWidget = this.instantiationService.createInstance(SCMInputWidget, inputElement, this.overflowWidgetsDomNode);
		disposables.add(inputWidget);

		return { inputWidget, disposable: Disposable.None, templateDisposable: disposables };
	}

	renderElement(node: ITreeNode<ISCMInput, FuzzyScore>, index: number, templateData: InputTemplate): void {
		templateData.disposable.dispose();

		const disposables = new DisposableStore();
		const input = node.element;
		templateData.inputWidget.input = input;

		// Remember widget
		this.inputWidgets.set(input, templateData.inputWidget);
		disposables.add({ dispose: () => this.inputWidgets.delete(input) });

		// Widget cursor selections
		const selections = this.editorSelections.get(input);

		if (selections) {
			templateData.inputWidget.selections = selections;
		}

		disposables.add(toDisposable(() => {
			const selections = templateData.inputWidget.selections;

			if (selections) {
				this.editorSelections.set(input, selections);
			}
		}));

		// Rerender the element whenever the editor content height changes
		const onDidChangeContentHeight = () => {
			const contentHeight = templateData.inputWidget.getContentHeight();
			const lastContentHeight = this.contentHeights.get(input)!;
			this.contentHeights.set(input, contentHeight);

			if (lastContentHeight !== contentHeight) {
				this.updateHeight(input, contentHeight + 10);
				templateData.inputWidget.layout();
			}
		};

		const startListeningContentHeightChange = () => {
			disposables.add(templateData.inputWidget.onDidChangeContentHeight(onDidChangeContentHeight));
			onDidChangeContentHeight();
		};

		// Setup height change listener on next tick
		const timeout = disposableTimeout(startListeningContentHeightChange, 0);
		disposables.add(timeout);

		// Layout the editor whenever the outer layout happens
		const layoutEditor = () => templateData.inputWidget.layout();
		disposables.add(this.outerLayout.onDidChange(layoutEditor));
		layoutEditor();

		templateData.disposable = disposables;
	}

	renderCompressedElements(): void {
		throw new Error('Should never happen since node is incompressible');
	}

	disposeElement(group: ITreeNode<ISCMInput, FuzzyScore>, index: number, template: InputTemplate): void {
		template.disposable.dispose();
	}

	disposeTemplate(templateData: InputTemplate): void {
		templateData.disposable.dispose();
		templateData.templateDisposable.dispose();
	}

	getHeight(input: ISCMInput): number {
		return (this.contentHeights.get(input) ?? InputRenderer.DEFAULT_HEIGHT) + 10;
	}

	getRenderedInputWidget(input: ISCMInput): SCMInputWidget | undefined {
		return this.inputWidgets.get(input);
	}

	getFocusedInput(): ISCMInput | undefined {
		for (const [input, inputWidget] of this.inputWidgets) {
			if (inputWidget.hasFocus()) {
				return input;
			}
		}

		return undefined;
	}

	clearValidation(): void {
		for (const [, inputWidget] of this.inputWidgets) {
			inputWidget.clearValidation();
		}
	}
}

interface ResourceGroupTemplate {
	readonly name: HTMLElement;
	readonly count: CountBadge;
	readonly actionBar: ActionBar;
	elementDisposables: IDisposable;
	readonly disposables: IDisposable;
}

class ResourceGroupRenderer implements ICompressibleTreeRenderer<ISCMResourceGroup, FuzzyScore, ResourceGroupTemplate> {

	static readonly TEMPLATE_ID = 'resource group';
	get templateId(): string { return ResourceGroupRenderer.TEMPLATE_ID; }

	constructor(
		private actionViewItemProvider: IActionViewItemProvider,
		@ISCMViewService private scmViewService: ISCMViewService,
		@IThemeService private themeService: IThemeService,
	) { }

	renderTemplate(container: HTMLElement): ResourceGroupTemplate {
		// hack
		(container.parentElement!.parentElement!.querySelector('.monaco-tl-twistie')! as HTMLElement).classList.add('force-twistie');

		const element = append(container, $('.resource-group'));
		const name = append(element, $('.name'));
		const actionsContainer = append(element, $('.actions'));
		const actionBar = new ActionBar(actionsContainer, { actionViewItemProvider: this.actionViewItemProvider });
		const countContainer = append(element, $('.count'));
		const count = new CountBadge(countContainer);
		const styler = attachBadgeStyler(count, this.themeService);
		const elementDisposables = Disposable.None;
		const disposables = combinedDisposable(actionBar, styler);

		return { name, count, actionBar, elementDisposables, disposables };
	}

	renderElement(node: ITreeNode<ISCMResourceGroup, FuzzyScore>, index: number, template: ResourceGroupTemplate): void {
		template.elementDisposables.dispose();

		const group = node.element;
		template.name.textContent = group.label;
		template.actionBar.clear();
		template.actionBar.context = group;
		template.count.setCount(group.elements.length);

		const disposables = new DisposableStore();
		const menus = this.scmViewService.menus.getRepositoryMenus(group.provider);
		disposables.add(connectPrimaryMenuToInlineActionBar(menus.getResourceGroupMenu(group), template.actionBar));

		template.elementDisposables = disposables;
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<ISCMResourceGroup>, FuzzyScore>, index: number, templateData: ResourceGroupTemplate, height: number | undefined): void {
		throw new Error('Should never happen since node is incompressible');
	}

	disposeElement(group: ITreeNode<ISCMResourceGroup, FuzzyScore>, index: number, template: ResourceGroupTemplate): void {
		template.elementDisposables.dispose();
	}

	disposeTemplate(template: ResourceGroupTemplate): void {
		template.elementDisposables.dispose();
		template.disposables.dispose();
	}
}

interface ResourceTemplate {
	element: HTMLElement;
	name: HTMLElement;
	fileLabel: IResourceLabel;
	decorationIcon: HTMLElement;
	actionBar: ActionBar;
	elementDisposables: IDisposable;
	disposables: IDisposable;
}

class RepositoryPaneActionRunner extends ActionRunner {

	constructor(private getSelectedResources: () => (ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>)[]) {
		super();
	}

	async runAction(action: IAction, context: ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>): Promise<any> {
		if (!(action instanceof MenuItemAction)) {
			return super.runAction(action, context);
		}

		const selection = this.getSelectedResources();
		const contextIsSelected = selection.some(s => s === context);
		const actualContext = contextIsSelected ? selection : [context];
		const args = flatten(actualContext.map(e => ResourceTree.isResourceNode(e) ? ResourceTree.collect(e) : [e]));
		await action.run(...args);
	}
}

class ResourceRenderer implements ICompressibleTreeRenderer<ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>, FuzzyScore | LabelFuzzyScore, ResourceTemplate> {

	static readonly TEMPLATE_ID = 'resource';
	get templateId(): string { return ResourceRenderer.TEMPLATE_ID; }

	constructor(
		private viewModelProvider: () => ViewModel,
		private labels: ResourceLabels,
		private actionViewItemProvider: IActionViewItemProvider,
		private actionRunner: ActionRunner,
		@ISCMViewService private scmViewService: ISCMViewService,
		@IThemeService private themeService: IThemeService
	) { }

	renderTemplate(container: HTMLElement): ResourceTemplate {
		const element = append(container, $('.resource'));
		const name = append(element, $('.name'));
		const fileLabel = this.labels.create(name, { supportDescriptionHighlights: true, supportHighlights: true });
		const actionsContainer = append(fileLabel.element, $('.actions'));
		const actionBar = new ActionBar(actionsContainer, {
			actionViewItemProvider: this.actionViewItemProvider,
			actionRunner: this.actionRunner
		});

		const decorationIcon = append(element, $('.decoration-icon'));
		const disposables = combinedDisposable(actionBar, fileLabel);

		return { element, name, fileLabel, decorationIcon, actionBar, elementDisposables: Disposable.None, disposables };
	}

	renderElement(node: ITreeNode<ISCMResource, FuzzyScore | LabelFuzzyScore> | ITreeNode<ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>, FuzzyScore | LabelFuzzyScore>, index: number, template: ResourceTemplate): void {
		template.elementDisposables.dispose();

		const elementDisposables = new DisposableStore();
		const resourceOrFolder = node.element;
		const iconResource = ResourceTree.isResourceNode(resourceOrFolder) ? resourceOrFolder.element : resourceOrFolder;
		const uri = ResourceTree.isResourceNode(resourceOrFolder) ? resourceOrFolder.uri : resourceOrFolder.sourceUri;
		const fileKind = ResourceTree.isResourceNode(resourceOrFolder) ? FileKind.FOLDER : FileKind.FILE;
		const viewModel = this.viewModelProvider();
		const tooltip = !ResourceTree.isResourceNode(resourceOrFolder) && resourceOrFolder.decorations.tooltip || '';

		template.actionBar.clear();
		template.actionBar.context = resourceOrFolder;

		let matches: IMatch[] | undefined;
		let descriptionMatches: IMatch[] | undefined;

		if (ResourceTree.isResourceNode(resourceOrFolder)) {
			if (resourceOrFolder.element) {
				const menus = this.scmViewService.menus.getRepositoryMenus(resourceOrFolder.element.resourceGroup.provider);
				elementDisposables.add(connectPrimaryMenuToInlineActionBar(menus.getResourceMenu(resourceOrFolder.element), template.actionBar));
				template.name.classList.toggle('strike-through', resourceOrFolder.element.decorations.strikeThrough);
				template.element.classList.toggle('faded', resourceOrFolder.element.decorations.faded);
			} else {
				matches = createMatches(node.filterData as FuzzyScore | undefined);
				const menus = this.scmViewService.menus.getRepositoryMenus(resourceOrFolder.context.provider);
				elementDisposables.add(connectPrimaryMenuToInlineActionBar(menus.getResourceFolderMenu(resourceOrFolder.context), template.actionBar));
				template.name.classList.remove('strike-through');
				template.element.classList.remove('faded');
			}
		} else {
			[matches, descriptionMatches] = this._processFilterData(uri, node.filterData);
			const menus = this.scmViewService.menus.getRepositoryMenus(resourceOrFolder.resourceGroup.provider);
			elementDisposables.add(connectPrimaryMenuToInlineActionBar(menus.getResourceMenu(resourceOrFolder), template.actionBar));
			template.name.classList.toggle('strike-through', resourceOrFolder.decorations.strikeThrough);
			template.element.classList.toggle('faded', resourceOrFolder.decorations.faded);
		}

		const render = () => {
			const theme = this.themeService.getColorTheme();
			const icon = iconResource && (theme.type === ColorScheme.LIGHT ? iconResource.decorations.icon : iconResource.decorations.iconDark);

			template.fileLabel.setFile(uri, {
				fileDecorations: { colors: false, badges: !icon },
				hidePath: viewModel.mode === ViewModelMode.Tree,
				fileKind,
				matches,
				descriptionMatches
			});

			if (icon) {
				template.decorationIcon.style.display = '';
				template.decorationIcon.style.backgroundImage = asCSSUrl(icon);
				template.decorationIcon.title = tooltip;
			} else {
				template.decorationIcon.style.display = 'none';
				template.decorationIcon.style.backgroundImage = '';
				template.decorationIcon.title = '';
			}
		};

		elementDisposables.add(this.themeService.onDidColorThemeChange(render));
		render();

		template.element.setAttribute('data-tooltip', tooltip);
		template.elementDisposables = elementDisposables;
	}

	disposeElement(resource: ITreeNode<ISCMResource, FuzzyScore | LabelFuzzyScore> | ITreeNode<IResourceNode<ISCMResource, ISCMResourceGroup>, FuzzyScore | LabelFuzzyScore>, index: number, template: ResourceTemplate): void {
		template.elementDisposables.dispose();
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<ISCMResource> | ICompressedTreeNode<IResourceNode<ISCMResource, ISCMResourceGroup>>, FuzzyScore | LabelFuzzyScore>, index: number, template: ResourceTemplate, height: number | undefined): void {
		template.elementDisposables.dispose();

		const elementDisposables = new DisposableStore();
		const compressed = node.element as ICompressedTreeNode<IResourceNode<ISCMResource, ISCMResourceGroup>>;
		const folder = compressed.elements[compressed.elements.length - 1];

		const label = compressed.elements.map(e => e.name).join('/');
		const fileKind = FileKind.FOLDER;

		const matches = createMatches(node.filterData as FuzzyScore | undefined);
		template.fileLabel.setResource({ resource: folder.uri, name: label }, {
			fileDecorations: { colors: false, badges: true },
			fileKind,
			matches
		});

		template.actionBar.clear();
		template.actionBar.context = folder;

		const menus = this.scmViewService.menus.getRepositoryMenus(folder.context.provider);
		elementDisposables.add(connectPrimaryMenuToInlineActionBar(menus.getResourceFolderMenu(folder.context), template.actionBar));

		template.name.classList.remove('strike-through');
		template.element.classList.remove('faded');
		template.decorationIcon.style.display = 'none';
		template.decorationIcon.style.backgroundImage = '';

		template.element.setAttribute('data-tooltip', '');
		template.elementDisposables = elementDisposables;
	}

	disposeCompressedElements(node: ITreeNode<ICompressedTreeNode<ISCMResource> | ICompressedTreeNode<IResourceNode<ISCMResource, ISCMResourceGroup>>, FuzzyScore | LabelFuzzyScore>, index: number, template: ResourceTemplate, height: number | undefined): void {
		template.elementDisposables.dispose();
	}

	disposeTemplate(template: ResourceTemplate): void {
		template.elementDisposables.dispose();
		template.disposables.dispose();
	}

	private _processFilterData(uri: URI, filterData: FuzzyScore | LabelFuzzyScore | undefined): [IMatch[] | undefined, IMatch[] | undefined] {
		if (!filterData) {
			return [undefined, undefined];
		}

		if (!(filterData as LabelFuzzyScore).label) {
			const matches = createMatches(filterData as FuzzyScore);
			return [matches, undefined];
		}

		const fileName = basename(uri);
		const label = (filterData as LabelFuzzyScore).label;
		const pathLength = label.length - fileName.length;
		const matches = createMatches((filterData as LabelFuzzyScore).score);

		// FileName match
		if (label === fileName) {
			return [matches, undefined];
		}

		// FilePath match
		let labelMatches: IMatch[] = [];
		let descriptionMatches: IMatch[] = [];

		for (const match of matches) {
			if (match.start > pathLength) {
				// Label match
				labelMatches.push({
					start: match.start - pathLength,
					end: match.end - pathLength
				});
			} else if (match.end < pathLength) {
				// Description match
				descriptionMatches.push(match);
			} else {
				// Spanning match
				labelMatches.push({
					start: 0,
					end: match.end - pathLength
				});
				descriptionMatches.push({
					start: match.start,
					end: pathLength
				});
			}
		}

		return [labelMatches, descriptionMatches];
	}
}

class ListDelegate implements IListVirtualDelegate<TreeElement> {

	constructor(private readonly inputRenderer: InputRenderer) { }

	getHeight(element: TreeElement) {
		if (isSCMInput(element)) {
			return this.inputRenderer.getHeight(element);
		} else {
			return 22;
		}
	}

	getTemplateId(element: TreeElement) {
		if (isSCMRepository(element)) {
			return RepositoryRenderer.TEMPLATE_ID;
		} else if (isSCMInput(element)) {
			return InputRenderer.TEMPLATE_ID;
		} else if (ResourceTree.isResourceNode(element) || isSCMResource(element)) {
			return ResourceRenderer.TEMPLATE_ID;
		} else {
			return ResourceGroupRenderer.TEMPLATE_ID;
		}
	}
}

class SCMTreeFilter implements ITreeFilter<TreeElement> {

	filter(element: TreeElement): boolean {
		if (ResourceTree.isResourceNode(element)) {
			return true;
		} else if (isSCMResourceGroup(element)) {
			return element.elements.length > 0 || !element.hideWhenEmpty;
		} else {
			return true;
		}
	}
}

export class SCMTreeSorter implements ITreeSorter<TreeElement> {

	@memoize
	private get viewModel(): ViewModel { return this.viewModelProvider(); }

	constructor(private viewModelProvider: () => ViewModel) { }

	compare(one: TreeElement, other: TreeElement): number {
		if (isSCMRepository(one)) {
			if (!isSCMRepository(other)) {
				throw new Error('Invalid comparison');
			}

			return 0;
		}

		if (isSCMInput(one)) {
			return -1;
		} else if (isSCMInput(other)) {
			return 1;
		}

		if (isSCMResourceGroup(one)) {
			if (!isSCMResourceGroup(other)) {
				throw new Error('Invalid comparison');
			}

			return 0;
		}

		// List
		if (this.viewModel.mode === ViewModelMode.List) {
			// FileName
			if (this.viewModel.sortKey === ViewModelSortKey.Name) {
				const oneName = basename((one as ISCMResource).sourceUri);
				const otherName = basename((other as ISCMResource).sourceUri);

				return compareFileNames(oneName, otherName);
			}

			// Status
			if (this.viewModel.sortKey === ViewModelSortKey.Status) {
				const oneTooltip = (one as ISCMResource).decorations.tooltip ?? '';
				const otherTooltip = (other as ISCMResource).decorations.tooltip ?? '';

				if (oneTooltip !== otherTooltip) {
					return compare(oneTooltip, otherTooltip);
				}
			}

			// Path (default)
			const onePath = (one as ISCMResource).sourceUri.fsPath;
			const otherPath = (other as ISCMResource).sourceUri.fsPath;

			return comparePaths(onePath, otherPath);
		}

		// Tree
		const oneIsDirectory = ResourceTree.isResourceNode(one);
		const otherIsDirectory = ResourceTree.isResourceNode(other);

		if (oneIsDirectory !== otherIsDirectory) {
			return oneIsDirectory ? -1 : 1;
		}

		const oneName = ResourceTree.isResourceNode(one) ? one.name : basename((one as ISCMResource).sourceUri);
		const otherName = ResourceTree.isResourceNode(other) ? other.name : basename((other as ISCMResource).sourceUri);

		return compareFileNames(oneName, otherName);
	}
}

export class SCMTreeKeyboardNavigationLabelProvider implements ICompressibleKeyboardNavigationLabelProvider<TreeElement> {

	constructor(
		private viewModelProvider: () => ViewModel,
		@ILabelService private readonly labelService: ILabelService,
	) { }

	getKeyboardNavigationLabel(element: TreeElement): { toString(): string; } | { toString(): string; }[] | undefined {
		if (ResourceTree.isResourceNode(element)) {
			return element.name;
		} else if (isSCMRepository(element)) {
			return undefined;
		} else if (isSCMInput(element)) {
			return undefined;
		} else if (isSCMResourceGroup(element)) {
			return element.label;
		} else {
			const viewModel = this.viewModelProvider();
			if (viewModel.mode === ViewModelMode.List) {
				// In List mode match using the file name and the path.
				// Since we want to match both on the file name and the
				// full path we return an array of labels. A match in the
				// file name takes precedence over a match in the path.
				const fileName = basename(element.sourceUri);
				const filePath = this.labelService.getUriLabel(element.sourceUri, { relative: true });

				return [fileName, filePath];
			} else {
				// In Tree mode only match using the file name
				return basename(element.sourceUri);
			}
		}
	}

	getCompressedNodeKeyboardNavigationLabel(elements: TreeElement[]): { toString(): string | undefined; } | undefined {
		const folders = elements as IResourceNode<ISCMResource, ISCMResourceGroup>[];
		return folders.map(e => e.name).join('/');
	}
}

function getSCMResourceId(element: TreeElement): string {
	if (ResourceTree.isResourceNode(element)) {
		const group = element.context;
		return `folder:${group.provider.id}/${group.id}/$FOLDER/${element.uri.toString()}`;
	} else if (isSCMRepository(element)) {
		const provider = element.provider;
		return `repo:${provider.id}`;
	} else if (isSCMInput(element)) {
		const provider = element.repository.provider;
		return `input:${provider.id}`;
	} else if (isSCMResource(element)) {
		const group = element.resourceGroup;
		const provider = group.provider;
		return `resource:${provider.id}/${group.id}/${element.sourceUri.toString()}`;
	} else {
		const provider = element.provider;
		return `group:${provider.id}/${element.id}`;
	}
}

class SCMResourceIdentityProvider implements IIdentityProvider<TreeElement> {

	getId(element: TreeElement): string {
		return getSCMResourceId(element);
	}
}

export class SCMAccessibilityProvider implements IListAccessibilityProvider<TreeElement> {

	constructor(@ILabelService private readonly labelService: ILabelService) { }

	getWidgetAriaLabel(): string {
		return localize('scm', "Source Control Management");
	}

	getAriaLabel(element: TreeElement): string {
		if (ResourceTree.isResourceNode(element)) {
			return this.labelService.getUriLabel(element.uri, { relative: true, noPrefix: true }) || element.name;
		} else if (isSCMRepository(element)) {
			return element.provider.label;
		} else if (isSCMInput(element)) {
			return localize('input', "Source Control Input");
		} else if (isSCMResourceGroup(element)) {
			return element.label;
		} else {
			const result: string[] = [];

			result.push(basename(element.sourceUri));

			if (element.decorations.tooltip) {
				result.push(element.decorations.tooltip);
			}

			const path = this.labelService.getUriLabel(dirname(element.sourceUri), { relative: true, noPrefix: true });

			if (path) {
				result.push(path);
			}

			return result.join(', ');
		}
	}
}

interface IGroupItem {
	readonly element: ISCMResourceGroup;
	readonly resources: ISCMResource[];
	readonly tree: ResourceTree<ISCMResource, ISCMResourceGroup>;
	dispose(): void;
}

interface IRepositoryItem {
	readonly element: ISCMRepository;
	readonly groupItems: IGroupItem[];
	dispose(): void;
}

interface ITreeViewState {
	readonly collapsed: string[];
}

function isRepositoryItem(item: IRepositoryItem | IGroupItem): item is IRepositoryItem {
	return Array.isArray((item as IRepositoryItem).groupItems);
}

function asTreeElement(node: IResourceNode<ISCMResource, ISCMResourceGroup>, forceIncompressible: boolean, viewState?: ITreeViewState): ICompressedTreeElement<TreeElement> {
	const element = (node.childrenCount === 0 && node.element) ? node.element : node;
	const collapsed = viewState ? viewState.collapsed.indexOf(getSCMResourceId(element)) > -1 : false;

	return {
		element,
		children: Iterable.map(node.children, node => asTreeElement(node, false, viewState)),
		incompressible: !!node.element || forceIncompressible,
		collapsed,
		collapsible: node.childrenCount > 0
	};
}

const enum ViewModelMode {
	List = 'list',
	Tree = 'tree'
}

const enum ViewModelSortKey {
	Path,
	Name,
	Status
}

class ViewModel {

	private readonly _onDidChangeMode = new Emitter<ViewModelMode>();
	readonly onDidChangeMode = this._onDidChangeMode.event;

	private _onDidChangeRepositoryCollapseState = new Emitter<void>();
	readonly onDidChangeRepositoryCollapseState: Event<void>;
	private visible: boolean = false;

	get mode(): ViewModelMode { return this._mode; }
	set mode(mode: ViewModelMode) {
		this._mode = mode;

		for (const [, item] of this.items) {
			for (const groupItem of item.groupItems) {
				groupItem.tree.clear();

				if (mode === ViewModelMode.Tree) {
					for (const resource of groupItem.resources) {
						groupItem.tree.add(resource.sourceUri, resource);
					}
				}
			}
		}

		this.refresh();
		this._onDidChangeMode.fire(mode);
	}

	get sortKey(): ViewModelSortKey { return this._sortKey; }
	set sortKey(sortKey: ViewModelSortKey) {
		if (sortKey !== this._sortKey) {
			this._sortKey = sortKey;
			this.refresh();
		}
	}

	private _treeViewStateIsStale = false;
	get treeViewState(): ITreeViewState | undefined {
		if (this.visible && this._treeViewStateIsStale) {
			this.updateViewState();
			this._treeViewStateIsStale = false;
		}

		return this._treeViewState;
	}

	private items = new Map<ISCMRepository, IRepositoryItem>();
	private visibilityDisposables = new DisposableStore();
	private scrollTop: number | undefined;
	private alwaysShowRepositories = false;
	private firstVisible = true;
	private viewSubMenuAction: SCMViewSubMenuAction | undefined;
	private disposables = new DisposableStore();

	constructor(
		private tree: WorkbenchCompressibleObjectTree<TreeElement, FuzzyScore>,
		private inputRenderer: InputRenderer,
		private _mode: ViewModelMode,
		private _sortKey: ViewModelSortKey,
		private _treeViewState: ITreeViewState | undefined,
		@IInstantiationService protected instantiationService: IInstantiationService,
		@IEditorService protected editorService: IEditorService,
		@IConfigurationService protected configurationService: IConfigurationService,
		@ISCMViewService private scmViewService: ISCMViewService,
		@IUriIdentityService private uriIdentityService: IUriIdentityService
	) {
		this.onDidChangeRepositoryCollapseState = Event.any(
			this._onDidChangeRepositoryCollapseState.event,
			Event.signal(Event.filter(this.tree.onDidChangeCollapseState, e => isSCMRepository(e.node.element)))
		);

		configurationService.onDidChangeConfiguration(this.onDidChangeConfiguration, this, this.disposables);
		this.onDidChangeConfiguration();

		this.disposables.add(this.tree.onDidChangeCollapseState(() => this._treeViewStateIsStale = true));
	}

	private onDidChangeConfiguration(e?: IConfigurationChangeEvent): void {
		if (!e || e.affectsConfiguration('scm.alwaysShowRepositories')) {
			this.alwaysShowRepositories = this.configurationService.getValue<boolean>('scm.alwaysShowRepositories');
			this.refresh();
		}
	}

	private _onDidChangeVisibleRepositories({ added, removed }: ISCMViewVisibleRepositoryChangeEvent): void {
		for (const repository of added) {
			const disposable = combinedDisposable(
				repository.provider.groups.onDidSplice(splice => this._onDidSpliceGroups(item, splice)),
				repository.input.onDidChangeVisibility(() => this.refresh(item))
			);
			const groupItems = repository.provider.groups.elements.map(group => this.createGroupItem(group));
			const item: IRepositoryItem = {
				element: repository, groupItems, dispose() {
					dispose(this.groupItems);
					disposable.dispose();
				}
			};

			this.items.set(repository, item);
		}

		for (const repository of removed) {
			const item = this.items.get(repository)!;
			item.dispose();
			this.items.delete(repository);
		}

		this.refresh();
	}

	private _onDidSpliceGroups(item: IRepositoryItem, { start, deleteCount, toInsert }: ISplice<ISCMResourceGroup>): void {
		const itemsToInsert: IGroupItem[] = toInsert.map(group => this.createGroupItem(group));
		const itemsToDispose = item.groupItems.splice(start, deleteCount, ...itemsToInsert);

		for (const item of itemsToDispose) {
			item.dispose();
		}

		this.refresh();
	}

	private createGroupItem(group: ISCMResourceGroup): IGroupItem {
		const tree = new ResourceTree<ISCMResource, ISCMResourceGroup>(group, group.provider.rootUri || URI.file('/'), this.uriIdentityService.extUri);
		const resources: ISCMResource[] = [...group.elements];
		const disposable = combinedDisposable(
			group.onDidChange(() => this.tree.refilter()),
			group.onDidSplice(splice => this._onDidSpliceGroup(item, splice))
		);

		const item: IGroupItem = { element: group, resources, tree, dispose() { disposable.dispose(); } };

		if (this._mode === ViewModelMode.Tree) {
			for (const resource of resources) {
				item.tree.add(resource.sourceUri, resource);
			}
		}

		return item;
	}

	private _onDidSpliceGroup(item: IGroupItem, { start, deleteCount, toInsert }: ISplice<ISCMResource>): void {
		const before = item.resources.length;
		const deleted = item.resources.splice(start, deleteCount, ...toInsert);
		const after = item.resources.length;

		if (this._mode === ViewModelMode.Tree) {
			for (const resource of deleted) {
				item.tree.delete(resource.sourceUri);
			}

			for (const resource of toInsert) {
				item.tree.add(resource.sourceUri, resource);
			}
		}

		if (before !== after && (before === 0 || after === 0)) {
			this.refresh();
		} else {
			this.refresh(item);
		}
	}

	setVisible(visible: boolean): void {
		if (visible) {
			this.visibilityDisposables = new DisposableStore();
			this.scmViewService.onDidChangeVisibleRepositories(this._onDidChangeVisibleRepositories, this, this.visibilityDisposables);
			this._onDidChangeVisibleRepositories({ added: this.scmViewService.visibleRepositories, removed: Iterable.empty() });

			if (typeof this.scrollTop === 'number') {
				this.tree.scrollTop = this.scrollTop;
				this.scrollTop = undefined;
			}

			this.editorService.onDidActiveEditorChange(this.onDidActiveEditorChange, this, this.visibilityDisposables);
			this.onDidActiveEditorChange();
		} else {
			this.updateViewState();

			this.visibilityDisposables.dispose();
			this._onDidChangeVisibleRepositories({ added: Iterable.empty(), removed: [...this.items.keys()] });
			this.scrollTop = this.tree.scrollTop;
		}

		this.visible = visible;
		this._onDidChangeRepositoryCollapseState.fire();
	}

	private refresh(item?: IRepositoryItem | IGroupItem): void {
		const focusedInput = this.inputRenderer.getFocusedInput();

		if (!this.alwaysShowRepositories && (this.items.size === 1 && (!item || isRepositoryItem(item)))) {
			const item = Iterable.first(this.items.values())!;
			this.tree.setChildren(null, this.render(item, this._treeViewState).children);
		} else if (item) {
			this.tree.setChildren(item.element, this.render(item, this._treeViewState).children);
		} else {
			const items = coalesce(this.scmViewService.visibleRepositories.map(r => this.items.get(r)));
			this.tree.setChildren(null, items.map(item => this.render(item, this._treeViewState)));
		}

		if (focusedInput) {
			const inputWidget = this.inputRenderer.getRenderedInputWidget(focusedInput);

			if (inputWidget) {
				inputWidget.focus();
			}
		}

		this._onDidChangeRepositoryCollapseState.fire();
	}

	private render(item: IRepositoryItem | IGroupItem, treeViewState?: ITreeViewState): ICompressedTreeElement<TreeElement> {
		if (isRepositoryItem(item)) {
			const children: ICompressedTreeElement<TreeElement>[] = [];
			const hasSomeChanges = item.groupItems.some(item => item.element.elements.length > 0);

			if (this.items.size === 1 || hasSomeChanges) {
				if (item.element.input.visible) {
					children.push({ element: item.element.input, incompressible: true, collapsible: false });
				}

				children.push(...item.groupItems.map(i => this.render(i, treeViewState)));
			}

			const collapsed = treeViewState ? treeViewState.collapsed.indexOf(getSCMResourceId(item.element)) > -1 : false;

			return { element: item.element, children, incompressible: true, collapsed, collapsible: true };
		} else {
			const children = this.mode === ViewModelMode.List
				? Iterable.map(item.resources, element => ({ element, incompressible: true }))
				: Iterable.map(item.tree.root.children, node => asTreeElement(node, true, treeViewState));

			const collapsed = treeViewState ? treeViewState.collapsed.indexOf(getSCMResourceId(item.element)) > -1 : false;

			return { element: item.element, children, incompressible: true, collapsed, collapsible: true };
		}
	}

	private updateViewState(): void {
		const collapsed: string[] = [];
		const visit = (node: ITreeNode<TreeElement | null, FuzzyScore>) => {
			if (node.element && node.collapsible && node.collapsed) {
				collapsed.push(getSCMResourceId(node.element));
			}

			for (const child of node.children) {
				visit(child);
			}
		};

		visit(this.tree.getNode());

		this._treeViewState = { collapsed };
	}

	private onDidActiveEditorChange(): void {
		if (!this.configurationService.getValue<boolean>('scm.autoReveal')) {
			return;
		}

		if (this.firstVisible) {
			this.firstVisible = false;
			this.visibilityDisposables.add(disposableTimeout(() => this.onDidActiveEditorChange(), 250));
			return;
		}

		const uri = EditorResourceAccessor.getOriginalUri(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });

		if (!uri) {
			return;
		}

		for (const repository of this.scmViewService.visibleRepositories) {
			const item = this.items.get(repository);

			if (!item) {
				continue;
			}

			// go backwards from last group
			for (let j = item.groupItems.length - 1; j >= 0; j--) {
				const groupItem = item.groupItems[j];
				const resource = this.mode === ViewModelMode.Tree
					? groupItem.tree.getNode(uri)?.element
					: groupItem.resources.find(r => this.uriIdentityService.extUri.isEqual(r.sourceUri, uri));

				if (resource) {
					this.tree.reveal(resource);
					this.tree.setSelection([resource]);
					this.tree.setFocus([resource]);
					return;
				}
			}
		}
	}

	focus() {
		if (this.tree.getFocus().length === 0) {
			for (const repository of this.scmViewService.visibleRepositories) {
				const widget = this.inputRenderer.getRenderedInputWidget(repository.input);

				if (widget) {
					widget.focus();
					return;
				}
			}
		}

		this.tree.domFocus();
	}

	getViewActions(): IAction[] {
		if (this.scmViewService.visibleRepositories.length === 0) {
			return this.scmViewService.menus.titleMenu.actions;
		}

		if (this.alwaysShowRepositories || this.scmViewService.visibleRepositories.length !== 1) {
			return [];
		}

		const menus = this.scmViewService.menus.getRepositoryMenus(this.scmViewService.visibleRepositories[0].provider);
		return menus.titleMenu.actions;
	}

	getViewSecondaryActions(): IAction[] {
		if (this.scmViewService.visibleRepositories.length === 0) {
			return this.scmViewService.menus.titleMenu.secondaryActions;
		}

		if (!this.viewSubMenuAction) {
			this.viewSubMenuAction = this.instantiationService.createInstance(SCMViewSubMenuAction, this);
			this.disposables.add(this.viewSubMenuAction);
		}

		if (this.alwaysShowRepositories || this.scmViewService.visibleRepositories.length !== 1) {
			return this.viewSubMenuAction.actions;
		}

		const menus = this.scmViewService.menus.getRepositoryMenus(this.scmViewService.visibleRepositories[0].provider);
		const secondaryActions = menus.titleMenu.secondaryActions;

		if (secondaryActions.length === 0) {
			return [this.viewSubMenuAction];
		}

		return [this.viewSubMenuAction, new Separator(), ...secondaryActions];
	}

	getViewActionsContext(): any {
		if (this.scmViewService.visibleRepositories.length === 0) {
			return [];
		}

		if (this.alwaysShowRepositories || this.scmViewService.visibleRepositories.length !== 1) {
			return undefined;
		}

		return this.scmViewService.visibleRepositories[0].provider;
	}

	collapseAllProviders(): void {
		for (const repository of this.scmViewService.visibleRepositories) {
			if (this.tree.isCollapsible(repository)) {
				this.tree.collapse(repository);
			}
		}
	}

	expandAllProviders(): void {
		for (const repository of this.scmViewService.visibleRepositories) {
			if (this.tree.isCollapsible(repository)) {
				this.tree.expand(repository);
			}
		}
	}

	isAnyProviderCollapsible(): boolean {
		if (!this.visible || this.scmViewService.visibleRepositories.length === 1) {
			return false;
		}

		return this.scmViewService.visibleRepositories.some(r => this.tree.hasElement(r) && this.tree.isCollapsible(r));
	}

	areAllProvidersCollapsed(): boolean {
		if (!this.visible || this.scmViewService.visibleRepositories.length === 1) {
			return false;
		}

		return this.scmViewService.visibleRepositories.every(r => this.tree.hasElement(r) && (!this.tree.isCollapsible(r) || this.tree.isCollapsed(r)));
	}

	dispose(): void {
		this.visibilityDisposables.dispose();
		this.disposables.dispose();
		dispose(this.items.values());
		this.items.clear();
	}
}

class SCMViewRepositoriesSubMenuAction extends SubmenuAction {

	get actions(): IAction[] {
		return getRepositoryVisibilityActions(this.scmService, this.scmViewService);
	}

	constructor(
		@ISCMService private readonly scmService: ISCMService,
		@ISCMViewService private readonly scmViewService: ISCMViewService,
	) {
		super('scm.repositories', localize('repositories', "Repositories"), []);
	}
}

class SCMViewSubMenuAction extends SubmenuAction {

	constructor(
		viewModel: ViewModel,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		const listAction = new SCMViewModeListAction(viewModel);
		const treeAction = new SCMViewModeTreeAction(viewModel);
		const sortByNameAction = new SCMSortByNameAction(viewModel);
		const sortByPathAction = new SCMSortByPathAction(viewModel);
		const sortByStatusAction = new SCMSortByStatusAction(viewModel);
		const actions = [
			instantiationService.createInstance(SCMViewRepositoriesSubMenuAction),
			new Separator(),
			...new RadioGroup([listAction, treeAction]).actions,
			new Separator(),
			...new RadioGroup([sortByNameAction, sortByPathAction, sortByStatusAction]).actions
		];

		super(
			'scm.viewsort',
			localize('sortAction', "View & Sort"),
			actions
		);

		this._register(combinedDisposable(listAction, treeAction, sortByNameAction, sortByPathAction, sortByStatusAction));
	}
}

export class ToggleViewModeAction extends Action {

	static readonly ID = 'workbench.scm.action.toggleViewMode';
	static readonly LABEL = localize('toggleViewMode', "Toggle View Mode");

	constructor(id: string = ToggleViewModeAction.ID, label: string = ToggleViewModeAction.LABEL, private viewModel: ViewModel, private mode?: ViewModelMode) {
		super(id, label);
		this._register(this.viewModel.onDidChangeMode(this.onDidChangeMode, this));
		this.onDidChangeMode(this.viewModel.mode);
	}

	async run(): Promise<void> {
		if (typeof this.mode === 'undefined') {
			this.viewModel.mode = this.viewModel.mode === ViewModelMode.List ? ViewModelMode.Tree : ViewModelMode.List;
		} else {
			this.viewModel.mode = this.mode;
		}
	}

	private onDidChangeMode(mode: ViewModelMode): void {
		const iconClass = ThemeIcon.asClassName(mode === ViewModelMode.List ? Codicon.listTree : Codicon.listFlat);
		this.class = `scm-action toggle-view-mode ${iconClass}`;
		this.checked = this.viewModel.mode === this.mode;
	}
}

class SCMViewModeListAction extends ToggleViewModeAction {
	constructor(viewModel: ViewModel) {
		super('workbench.scm.action.viewModeList', localize('viewModeList', "View as List"), viewModel, ViewModelMode.List);
	}
}

class SCMViewModeTreeAction extends ToggleViewModeAction {
	constructor(viewModel: ViewModel) {
		super('workbench.scm.action.viewModeTree', localize('viewModeTree', "View as Tree"), viewModel, ViewModelMode.Tree);
	}
}

abstract class SCMSortAction extends Action {

	private readonly _listener: IDisposable;

	constructor(id: string, label: string, private viewModel: ViewModel, private sortKey: ViewModelSortKey) {
		super(id, label);

		this.checked = this.sortKey === ViewModelSortKey.Path;
		this.enabled = this.viewModel?.mode === ViewModelMode.List ?? false;
		this._listener = viewModel?.onDidChangeMode(e => this.enabled = e === ViewModelMode.List);
	}

	async run(): Promise<void> {
		if (this.sortKey !== this.viewModel.sortKey) {
			this.checked = !this.checked;
			this.viewModel.sortKey = this.sortKey;
		}
	}

	dispose(): void {
		this._listener.dispose();
		super.dispose();
	}
}

class SCMSortByNameAction extends SCMSortAction {
	static readonly ID = 'workbench.scm.action.sortByName';
	static readonly LABEL = localize('sortByName', "Sort by Name");

	constructor(viewModel: ViewModel) {
		super(SCMSortByNameAction.ID, SCMSortByNameAction.LABEL, viewModel, ViewModelSortKey.Name);
	}
}

class SCMSortByPathAction extends SCMSortAction {
	static readonly ID = 'workbench.scm.action.sortByPath';
	static readonly LABEL = localize('sortByPath', "Sort by Path");

	constructor(viewModel: ViewModel) {
		super(SCMSortByPathAction.ID, SCMSortByPathAction.LABEL, viewModel, ViewModelSortKey.Path);
	}
}

class SCMSortByStatusAction extends SCMSortAction {
	static readonly ID = 'workbench.scm.action.sortByStatus';
	static readonly LABEL = localize('sortByStatus', "Sort by Status");

	constructor(viewModel: ViewModel) {
		super(SCMSortByStatusAction.ID, SCMSortByStatusAction.LABEL, viewModel, ViewModelSortKey.Status);
	}
}

class SCMInputWidget extends Disposable {

	private readonly defaultInputFontFamily = DEFAULT_FONT_FAMILY;

	private element: HTMLElement;
	private editorContainer: HTMLElement;
	private placeholderTextContainer: HTMLElement;
	private inputEditor: CodeEditorWidget;

	private model: { readonly input: ISCMInput; readonly textModel: ITextModel; } | undefined;
	private repositoryContextKey: IContextKey<ISCMRepository | undefined>;
	private repositoryDisposables = new DisposableStore();

	private validation: IInputValidation | undefined;
	private validationDisposable: IDisposable = Disposable.None;

	// This is due to "Setup height change listener on next tick" above
	// https://github.com/microsoft/vscode/issues/108067
	private lastLayoutWasTrash = false;
	private shouldFocusAfterLayout = false;

	readonly onDidChangeContentHeight: Event<void>;

	get input(): ISCMInput | undefined {
		return this.model?.input;
	}

	set input(input: ISCMInput | undefined) {
		if (input === this.input) {
			return;
		}

		this.validationDisposable.dispose();
		this.editorContainer.classList.remove('synthetic-focus');

		this.repositoryDisposables.dispose();
		this.repositoryDisposables = new DisposableStore();
		this.repositoryContextKey.set(input?.repository);

		if (!input) {
			this.model?.textModel.dispose();
			this.inputEditor.setModel(undefined);
			this.model = undefined;
			return;
		}

		let query: string | undefined;

		if (input.repository.provider.rootUri) {
			query = `rootUri=${encodeURIComponent(input.repository.provider.rootUri.toString())}`;
		}

		const uri = URI.from({
			scheme: Schemas.vscode,
			path: `scm/${input.repository.provider.contextValue}/${input.repository.provider.id}/input`,
			query
		});

		this.configurationService.updateValue('editor.wordBasedSuggestions', false, { resource: uri }, ConfigurationTarget.MEMORY);

		const mode = this.modeService.create('scminput');
		const textModel = this.modelService.getModel(uri) || this.modelService.createModel('', mode, uri);
		this.inputEditor.setModel(textModel);

		// Validation
		const validationDelayer = new ThrottledDelayer<any>(200);
		const validate = async () => {
			const position = this.inputEditor.getSelection()?.getStartPosition();
			const offset = position && textModel.getOffsetAt(position);
			const value = textModel.getValue();

			this.validation = await input.validateInput(value, offset || 0);
			this.renderValidation();
		};

		const triggerValidation = () => validationDelayer.trigger(validate);
		this.repositoryDisposables.add(validationDelayer);
		this.repositoryDisposables.add(this.inputEditor.onDidChangeCursorPosition(triggerValidation));

		// Adaptive indentation rules
		const opts = this.modelService.getCreationOptions(textModel.getLanguageIdentifier().language, textModel.uri, textModel.isForSimpleWidget);
		const onEnter = Event.filter(this.inputEditor.onKeyDown, e => e.keyCode === KeyCode.Enter);
		this.repositoryDisposables.add(onEnter(() => textModel.detectIndentation(opts.insertSpaces, opts.tabSize)));

		// Keep model in sync with API
		textModel.setValue(input.value);
		this.repositoryDisposables.add(input.onDidChange(({ value, reason }) => {
			if (value === textModel.getValue()) { // circuit breaker
				return;
			}
			textModel.setValue(value);

			const position = reason === SCMInputChangeReason.HistoryPrevious
				? textModel.getFullModelRange().getStartPosition()
				: textModel.getFullModelRange().getEndPosition();
			this.inputEditor.setPosition(position);
			this.inputEditor.revealPositionInCenterIfOutsideViewport(position);
		}));

		// Keep API in sync with model, update placeholder visibility and validate
		const updatePlaceholderVisibility = () => this.placeholderTextContainer.classList.toggle('hidden', textModel.getValueLength() > 0);
		this.repositoryDisposables.add(textModel.onDidChangeContent(() => {
			input.setValue(textModel.getValue(), true);
			updatePlaceholderVisibility();
			triggerValidation();
		}));
		updatePlaceholderVisibility();

		// Update placeholder text
		const updatePlaceholderText = () => {
			const binding = this.keybindingService.lookupKeybinding('scm.acceptInput');
			const label = binding ? binding.getLabel() : (platform.isMacintosh ? 'Cmd+Enter' : 'Ctrl+Enter');
			const placeholderText = format(input.placeholder, label);

			this.inputEditor.updateOptions({ ariaLabel: placeholderText });
			this.placeholderTextContainer.textContent = placeholderText;
		};
		this.repositoryDisposables.add(input.onDidChangePlaceholder(updatePlaceholderText));
		this.repositoryDisposables.add(this.keybindingService.onDidUpdateKeybindings(updatePlaceholderText));
		updatePlaceholderText();

		// Update input template
		let commitTemplate = '';
		const updateTemplate = () => {
			if (typeof input.repository.provider.commitTemplate === 'undefined' || !input.visible) {
				return;
			}

			const oldCommitTemplate = commitTemplate;
			commitTemplate = input.repository.provider.commitTemplate;

			const value = textModel.getValue();

			if (value && value !== oldCommitTemplate) {
				return;
			}

			textModel.setValue(commitTemplate);
		};
		this.repositoryDisposables.add(input.repository.provider.onDidChangeCommitTemplate(updateTemplate, this));
		updateTemplate();

		// Save model
		this.model = { input, textModel };
	}

	get selections(): Selection[] | null {
		return this.inputEditor.getSelections();
	}

	set selections(selections: Selection[] | null) {
		if (selections) {
			this.inputEditor.setSelections(selections);
		}
	}

	constructor(
		container: HTMLElement,
		overflowWidgetsDomNode: HTMLElement,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IModelService private modelService: IModelService,
		@IModeService private modeService: IModeService,
		@IKeybindingService private keybindingService: IKeybindingService,
		@IConfigurationService private configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@ISCMViewService private readonly scmViewService: ISCMViewService,
		@IContextViewService private readonly contextViewService: IContextViewService
	) {
		super();

		this.element = append(container, $('.scm-editor'));
		this.editorContainer = append(this.element, $('.scm-editor-container'));
		this.placeholderTextContainer = append(this.editorContainer, $('.scm-editor-placeholder'));

		const contextKeyService2 = contextKeyService.createScoped(this.element);
		this.repositoryContextKey = contextKeyService2.createKey('scmRepository', undefined);

		const editorOptions: IEditorConstructionOptions = {
			...getSimpleEditorOptions(),
			lineDecorationsWidth: 4,
			dragAndDrop: false,
			cursorWidth: 1,
			fontSize: 13,
			lineHeight: 20,
			fontFamily: this.getInputEditorFontFamily(),
			wrappingStrategy: 'advanced',
			wrappingIndent: 'none',
			padding: { top: 3, bottom: 3 },
			quickSuggestions: false,
			scrollbar: { alwaysConsumeMouseWheel: false },
			overflowWidgetsDomNode,
			renderWhitespace: 'none'
		};

		const codeEditorWidgetOptions: ICodeEditorWidgetOptions = {
			isSimpleWidget: true,
			contributions: EditorExtensionsRegistry.getSomeEditorContributions([
				SuggestController.ID,
				SnippetController2.ID,
				MenuPreventer.ID,
				SelectionClipboardContributionID,
				ContextMenuController.ID,
				ColorDetector.ID,
				ModesHoverController.ID,
				LinkDetector.ID
			])
		};

		const services = new ServiceCollection([IContextKeyService, contextKeyService2]);
		const instantiationService2 = instantiationService.createChild(services);
		this.inputEditor = instantiationService2.createInstance(CodeEditorWidget, this.editorContainer, editorOptions, codeEditorWidgetOptions);
		this._register(this.inputEditor);

		this._register(this.inputEditor.onDidFocusEditorText(() => {
			if (this.input?.repository) {
				this.scmViewService.focus(this.input.repository);
			}

			this.editorContainer.classList.add('synthetic-focus');
			this.renderValidation();
		}));
		this._register(this.inputEditor.onDidBlurEditorText(() => {
			this.editorContainer.classList.remove('synthetic-focus');
			this.validationDisposable.dispose();
		}));

		const firstLineKey = contextKeyService2.createKey('scmInputIsInFirstPosition', false);
		const lastLineKey = contextKeyService2.createKey('scmInputIsInLastPosition', false);

		this._register(this.inputEditor.onDidChangeCursorPosition(({ position }) => {
			const viewModel = this.inputEditor._getViewModel()!;
			const lastLineNumber = viewModel.getLineCount();
			const lastLineCol = viewModel.getLineContent(lastLineNumber).length + 1;
			const viewPosition = viewModel.coordinatesConverter.convertModelPositionToViewPosition(position);
			firstLineKey.set(viewPosition.lineNumber === 1 && viewPosition.column === 1);
			lastLineKey.set(viewPosition.lineNumber === lastLineNumber && viewPosition.column === lastLineCol);
		}));

		const onInputFontFamilyChanged = Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('scm.inputFontFamily'));
		this._register(onInputFontFamilyChanged(() => this.inputEditor.updateOptions({ fontFamily: this.getInputEditorFontFamily() })));

		this.onDidChangeContentHeight = Event.signal(Event.filter(this.inputEditor.onDidContentSizeChange, e => e.contentHeightChanged));
	}

	getContentHeight(): number {
		const editorContentHeight = this.inputEditor.getContentHeight();
		return Math.min(editorContentHeight, 134);
	}

	layout(): void {
		const editorHeight = this.getContentHeight();
		const dimension = new Dimension(this.element.clientWidth - 2, editorHeight);

		if (dimension.width < 0) {
			this.lastLayoutWasTrash = true;
			return;
		}

		this.lastLayoutWasTrash = false;
		this.inputEditor.layout(dimension);
		this.renderValidation();

		if (this.shouldFocusAfterLayout) {
			this.shouldFocusAfterLayout = false;
			this.focus();
		}
	}

	focus(): void {
		if (this.lastLayoutWasTrash) {
			this.lastLayoutWasTrash = false;
			this.shouldFocusAfterLayout = true;
			return;
		}

		this.inputEditor.focus();
		this.editorContainer.classList.add('synthetic-focus');
	}

	hasFocus(): boolean {
		return this.inputEditor.hasTextFocus();
	}

	private renderValidation(): void {
		this.validationDisposable.dispose();

		this.editorContainer.classList.toggle('validation-info', this.validation?.type === InputValidationType.Information);
		this.editorContainer.classList.toggle('validation-warning', this.validation?.type === InputValidationType.Warning);
		this.editorContainer.classList.toggle('validation-error', this.validation?.type === InputValidationType.Error);

		if (!this.validation || !this.inputEditor.hasTextFocus()) {
			return;
		}

		this.validationDisposable = this.contextViewService.showContextView({
			getAnchor: () => this.editorContainer,
			render: container => {
				const element = append(container, $('.scm-editor-validation'));
				element.classList.toggle('validation-info', this.validation!.type === InputValidationType.Information);
				element.classList.toggle('validation-warning', this.validation!.type === InputValidationType.Warning);
				element.classList.toggle('validation-error', this.validation!.type === InputValidationType.Error);
				element.style.width = `${this.editorContainer.clientWidth}px`;
				element.textContent = this.validation!.message;
				return Disposable.None;
			},
			anchorAlignment: AnchorAlignment.LEFT
		});
	}

	private getInputEditorFontFamily(): string {
		const inputFontFamily = this.configurationService.getValue<string>('scm.inputFontFamily').trim();

		if (inputFontFamily.toLowerCase() === 'editor') {
			return this.configurationService.getValue<string>('editor.fontFamily').trim();
		}

		if (inputFontFamily.length !== 0 && inputFontFamily.toLowerCase() !== 'default') {
			return inputFontFamily;
		}

		return this.defaultInputFontFamily;
	}

	clearValidation(): void {
		this.validationDisposable.dispose();
	}

	dispose(): void {
		this.input = undefined;
		this.repositoryDisposables.dispose();
		this.validationDisposable.dispose();
		super.dispose();
	}
}

class SCMCollapseAction extends Action {

	private allCollapsed = false;

	constructor(private viewModel: ViewModel) {
		super('scm.collapse', undefined, undefined, true);
		this._register(viewModel.onDidChangeRepositoryCollapseState(this.update, this));
		this.update();
	}

	async run(): Promise<void> {
		if (this.allCollapsed) {
			this.viewModel.expandAllProviders();
		} else {
			this.viewModel.collapseAllProviders();
		}
	}

	private update(): void {
		const isAnyProviderCollapsible = this.viewModel.isAnyProviderCollapsible();

		this.enabled = isAnyProviderCollapsible;
		this.allCollapsed = isAnyProviderCollapsible && this.viewModel.areAllProvidersCollapsed();
		this.label = this.allCollapsed ? localize('expand all', "Expand All Repositories") : localize('collapse all', "Collapse All Repositories");
		this.class = ThemeIcon.asClassName(this.allCollapsed ? Codicon.expandAll : Codicon.collapseAll);
	}
}

export class SCMViewPane extends ViewPane {

	private _onDidLayout = new Emitter<void>();
	private layoutCache: ISCMLayout = {
		height: undefined,
		width: undefined,
		onDidChange: this._onDidLayout.event
	};

	private listContainer!: HTMLElement;
	private tree!: WorkbenchCompressibleObjectTree<TreeElement, FuzzyScore>;
	private viewModel!: ViewModel;
	private listLabels!: ResourceLabels;
	private inputRenderer!: InputRenderer;
	private toggleViewModelModeAction: ToggleViewModeAction | undefined;

	constructor(
		options: IViewPaneOptions,
		@ISCMService private scmService: ISCMService,
		@ISCMViewService private scmViewService: ISCMViewService,
		@IKeybindingService protected keybindingService: IKeybindingService,
		@IThemeService protected themeService: IThemeService,
		@IContextMenuService protected contextMenuService: IContextMenuService,
		@IContextViewService protected contextViewService: IContextViewService,
		@ICommandService protected commandService: ICommandService,
		@IEditorService protected editorService: IEditorService,
		@IInstantiationService protected instantiationService: IInstantiationService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IConfigurationService protected configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IMenuService protected menuService: IMenuService,
		@IStorageService private storageService: IStorageService,
		@IOpenerService openerService: IOpenerService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, telemetryService);
		this._register(Event.any(this.scmService.onDidAddRepository, this.scmService.onDidRemoveRepository)(() => this._onDidChangeViewWelcomeState.fire()));

		this._register(this.scmViewService.menus.titleMenu.onDidChangeTitle(this.updateActions, this));
	}

	protected renderBody(container: HTMLElement): void {
		super.renderBody(container);

		// List
		this.listContainer = append(container, $('.scm-view.show-file-icons'));

		const overflowWidgetsDomNode = $('.scm-overflow-widgets-container.monaco-editor');

		const updateActionsVisibility = () => this.listContainer.classList.toggle('show-actions', this.configurationService.getValue<boolean>('scm.alwaysShowActions'));
		this._register(Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('scm.alwaysShowActions'))(updateActionsVisibility));
		updateActionsVisibility();

		const updateProviderCountVisibility = () => {
			const value = this.configurationService.getValue<'hidden' | 'auto' | 'visible'>('scm.providerCountBadge');
			this.listContainer.classList.toggle('hide-provider-counts', value === 'hidden');
			this.listContainer.classList.toggle('auto-provider-counts', value === 'auto');
		};
		this._register(Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('scm.providerCountBadge'))(updateProviderCountVisibility));
		updateProviderCountVisibility();

		this._register(this.scmViewService.onDidChangeVisibleRepositories(() => this.updateActions()));

		this.inputRenderer = this.instantiationService.createInstance(InputRenderer, this.layoutCache, overflowWidgetsDomNode, (input, height) => this.tree.updateElementHeight(input, height));
		const delegate = new ListDelegate(this.inputRenderer);

		const actionViewItemProvider = (action: IAction) => this.getActionViewItem(action);

		this.listLabels = this.instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: this.onDidChangeBodyVisibility });
		this._register(this.listLabels);

		const actionRunner = new RepositoryPaneActionRunner(() => this.getSelectedResources());
		this._register(actionRunner);
		this._register(actionRunner.onBeforeRun(() => this.tree.domFocus()));

		const renderers: ICompressibleTreeRenderer<any, any, any>[] = [
			this.instantiationService.createInstance(RepositoryRenderer, actionViewItemProvider),
			this.inputRenderer,
			this.instantiationService.createInstance(ResourceGroupRenderer, actionViewItemProvider),
			this.instantiationService.createInstance(ResourceRenderer, () => this.viewModel, this.listLabels, actionViewItemProvider, actionRunner)
		];

		const filter = new SCMTreeFilter();
		const sorter = new SCMTreeSorter(() => this.viewModel);
		const keyboardNavigationLabelProvider = this.instantiationService.createInstance(SCMTreeKeyboardNavigationLabelProvider, () => this.viewModel);
		const identityProvider = new SCMResourceIdentityProvider();

		this.tree = this.instantiationService.createInstance(
			WorkbenchCompressibleObjectTree,
			'SCM Tree Repo',
			this.listContainer,
			delegate,
			renderers,
			{
				identityProvider,
				horizontalScrolling: false,
				setRowLineHeight: false,
				filter,
				sorter,
				keyboardNavigationLabelProvider,
				overrideStyles: {
					listBackground: this.viewDescriptorService.getViewLocationById(this.id) === ViewContainerLocation.Sidebar ? SIDE_BAR_BACKGROUND : PANEL_BACKGROUND
				},
				accessibilityProvider: this.instantiationService.createInstance(SCMAccessibilityProvider)
			}) as WorkbenchCompressibleObjectTree<TreeElement, FuzzyScore>;

		this._register(this.tree.onDidOpen(this.open, this));

		this._register(this.tree.onContextMenu(this.onListContextMenu, this));
		this._register(this.tree.onDidScroll(this.inputRenderer.clearValidation, this.inputRenderer));
		this._register(this.tree);

		append(this.listContainer, overflowWidgetsDomNode);

		let viewMode = this.configurationService.getValue<'tree' | 'list'>('scm.defaultViewMode') === 'list' ? ViewModelMode.List : ViewModelMode.Tree;

		const storageMode = this.storageService.get(`scm.viewMode`, StorageScope.WORKSPACE) as ViewModelMode;
		if (typeof storageMode === 'string') {
			viewMode = storageMode;
		}

		let viewState: ITreeViewState | undefined;

		const storageViewState = this.storageService.get(`scm.viewState`, StorageScope.WORKSPACE);
		if (storageViewState) {
			try {
				viewState = JSON.parse(storageViewState);
			} catch {/* noop */ }
		}

		this.viewModel = this.instantiationService.createInstance(ViewModel, this.tree, this.inputRenderer, viewMode, ViewModelSortKey.Path, viewState);
		this._register(this.viewModel);

		this.listContainer.classList.add('file-icon-themable-tree');
		this.listContainer.classList.add('show-file-icons');

		this.updateIndentStyles(this.themeService.getFileIconTheme());
		this._register(this.themeService.onDidFileIconThemeChange(this.updateIndentStyles, this));
		this._register(this.viewModel.onDidChangeMode(this.onDidChangeMode, this));

		this.toggleViewModelModeAction = new ToggleViewModeAction(ToggleViewModeAction.ID, ToggleViewModeAction.LABEL, this.viewModel);
		this._register(this.toggleViewModelModeAction);

		this._register(this.onDidChangeBodyVisibility(this.viewModel.setVisible, this.viewModel));

		this._register(Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('scm.alwaysShowRepositories'))(this.updateActions, this));
		this.updateActions();

		this._register(this.storageService.onWillSaveState(e => {
			if (e.reason === WillSaveStateReason.SHUTDOWN) {
				this.storageService.store(`scm.viewState`, JSON.stringify(this.viewModel.treeViewState), StorageScope.WORKSPACE, StorageTarget.MACHINE);
			}
		}));
	}

	private updateIndentStyles(theme: IFileIconTheme): void {
		this.listContainer.classList.toggle('list-view-mode', this.viewModel.mode === ViewModelMode.List);
		this.listContainer.classList.toggle('tree-view-mode', this.viewModel.mode === ViewModelMode.Tree);
		this.listContainer.classList.toggle('align-icons-and-twisties', (this.viewModel.mode === ViewModelMode.List && theme.hasFileIcons) || (theme.hasFileIcons && !theme.hasFolderIcons));
		this.listContainer.classList.toggle('hide-arrows', this.viewModel.mode === ViewModelMode.Tree && theme.hidesExplorerArrows === true);
	}

	private onDidChangeMode(): void {
		this.updateIndentStyles(this.themeService.getFileIconTheme());
		this.storageService.store(`scm.viewMode`, this.viewModel.mode, StorageScope.WORKSPACE, StorageTarget.USER);
	}

	layoutBody(height: number | undefined = this.layoutCache.height, width: number | undefined = this.layoutCache.width): void {
		if (height === undefined) {
			return;
		}

		if (width !== undefined) {
			super.layoutBody(height, width);
		}

		this.layoutCache.height = height;
		this.layoutCache.width = width;
		this._onDidLayout.fire();

		this.listContainer.style.height = `${height}px`;
		this.tree.layout(height, width);
	}

	focus(): void {
		super.focus();

		if (this.isExpanded()) {
			this.viewModel.focus();
		}
	}

	getActions(): IAction[] {
		const result = [];

		if (this.toggleViewModelModeAction) {
			result.push(this.toggleViewModelModeAction);
		}

		if (!this.viewModel) {
			return result;
		}

		if (this.scmViewService.visibleRepositories.length < 2) {
			return [...result, ...this.viewModel.getViewActions()];
		}

		return [
			...result,
			new SCMCollapseAction(this.viewModel),
			...this.viewModel.getViewActions()
		];
	}

	getSecondaryActions(): IAction[] {
		if (!this.viewModel) {
			return [];
		}

		return this.viewModel.getViewSecondaryActions();
	}

	getActionViewItem(action: IAction): IActionViewItem | undefined {
		if (action instanceof StatusBarAction) {
			return new StatusBarActionViewItem(action);
		}

		return super.getActionViewItem(action);
	}

	getActionsContext(): any {
		if (!this.viewModel) {
			return [];
		}

		return this.viewModel.getViewActionsContext();
	}

	private async open(e: IOpenEvent<TreeElement | undefined>): Promise<void> {
		if (!e.element) {
			return;
		} else if (isSCMRepository(e.element)) {
			this.scmViewService.focus(e.element);
			return;
		} else if (isSCMResourceGroup(e.element)) {
			const provider = e.element.provider;
			const repository = this.scmService.repositories.find(r => r.provider === provider);
			if (repository) {
				this.scmViewService.focus(repository);
			}
			return;
		} else if (ResourceTree.isResourceNode(e.element)) {
			const provider = e.element.context.provider;
			const repository = this.scmService.repositories.find(r => r.provider === provider);
			if (repository) {
				this.scmViewService.focus(repository);
			}
			return;
		} else if (isSCMInput(e.element)) {
			this.scmViewService.focus(e.element.repository);

			const widget = this.inputRenderer.getRenderedInputWidget(e.element);

			if (widget) {
				widget.focus();

				const selection = this.tree.getSelection();

				if (selection.length === 1 && selection[0] === e.element) {
					setTimeout(() => this.tree.setSelection([]));
				}
			}

			return;
		}

		// ISCMResource
		if (e.element.command?.id === API_OPEN_EDITOR_COMMAND_ID || e.element.command?.id === API_OPEN_DIFF_EDITOR_COMMAND_ID) {
			await this.commandService.executeCommand(e.element.command.id, ...(e.element.command.arguments || []), e);
		} else {
			await e.element.open(!!e.editorOptions.preserveFocus);

			if (e.editorOptions.pinned) {
				const activeEditorPane = this.editorService.activeEditorPane;

				if (activeEditorPane) {
					activeEditorPane.group.pinEditor(activeEditorPane.input);
				}
			}
		}

		const provider = e.element.resourceGroup.provider;
		const repository = this.scmService.repositories.find(r => r.provider === provider);

		if (repository) {
			this.scmViewService.focus(repository);
		}
	}

	private onListContextMenu(e: ITreeContextMenuEvent<TreeElement | null>): void {
		if (!e.element) {
			return this.contextMenuService.showContextMenu({
				getAnchor: () => e.anchor,
				getActions: () => getRepositoryVisibilityActions(this.scmService, this.scmViewService)
			});
		}

		const element = e.element;
		let context: any = element;
		let actions: IAction[] = [];
		let disposable: IDisposable = Disposable.None;

		if (isSCMRepository(element)) {
			const menus = this.scmViewService.menus.getRepositoryMenus(element.provider);
			const menu = menus.repositoryMenu;
			context = element.provider;
			[actions, disposable] = collectContextMenuActions(menu);
		} else if (isSCMInput(element)) {
			// noop
		} else if (isSCMResourceGroup(element)) {
			const menus = this.scmViewService.menus.getRepositoryMenus(element.provider);
			const menu = menus.getResourceGroupMenu(element);
			[actions, disposable] = collectContextMenuActions(menu);
		} else if (ResourceTree.isResourceNode(element)) {
			if (element.element) {
				const menus = this.scmViewService.menus.getRepositoryMenus(element.element.resourceGroup.provider);
				const menu = menus.getResourceMenu(element.element);
				[actions, disposable] = collectContextMenuActions(menu);
			} else {
				const menus = this.scmViewService.menus.getRepositoryMenus(element.context.provider);
				const menu = menus.getResourceFolderMenu(element.context);
				[actions, disposable] = collectContextMenuActions(menu);
			}
		} else {
			const menus = this.scmViewService.menus.getRepositoryMenus(element.resourceGroup.provider);
			const menu = menus.getResourceMenu(element);
			[actions, disposable] = collectContextMenuActions(menu);
		}

		const actionRunner = new RepositoryPaneActionRunner(() => this.getSelectedResources());
		actionRunner.onBeforeRun(() => this.tree.domFocus());

		this.contextMenuService.showContextMenu({
			getAnchor: () => e.anchor,
			getActions: () => actions,
			getActionsContext: () => context,
			actionRunner,
			onHide() {
				disposable.dispose();
			}
		});
	}

	private getSelectedResources(): (ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>)[] {
		return this.tree.getSelection()
			.filter(r => !!r && !isSCMResourceGroup(r))! as any;
	}

	shouldShowWelcome(): boolean {
		return this.scmService.repositories.length === 0;
	}
}

export const scmProviderSeparatorBorderColor = registerColor('scm.providerBorder', { dark: '#454545', light: '#C8C8C8', hc: contrastBorder }, localize('scm.providerBorder', "SCM Provider separator border."));

registerThemingParticipant((theme, collector) => {
	const inputBackgroundColor = theme.getColor(inputBackground);
	if (inputBackgroundColor) {
		collector.addRule(`.scm-view .scm-editor-container .monaco-editor-background,
		.scm-view .scm-editor-container .monaco-editor,
		.scm-view .scm-editor-container .monaco-editor .margin
		{ background-color: ${inputBackgroundColor} !important; }`);
	}

	const inputForegroundColor = theme.getColor(inputForeground);
	if (inputForegroundColor) {
		collector.addRule(`.scm-view .scm-editor-container .mtk1 { color: ${inputForegroundColor}; }`);
	}

	const inputBorderColor = theme.getColor(inputBorder);
	if (inputBorderColor) {
		collector.addRule(`.scm-view .scm-editor-container { outline: 1px solid ${inputBorderColor}; }`);
	}

	const panelInputBorder = theme.getColor(PANEL_INPUT_BORDER);
	if (panelInputBorder) {
		collector.addRule(`.monaco-workbench .part.panel .scm-view .scm-editor-container { outline: 1px solid ${panelInputBorder}; }`);
	}

	const focusBorderColor = theme.getColor(focusBorder);
	if (focusBorderColor) {
		collector.addRule(`.scm-view .scm-editor-container.synthetic-focus { outline: 1px solid ${focusBorderColor}; }`);
	}

	const inputPlaceholderForegroundColor = theme.getColor(inputPlaceholderForeground);
	if (inputPlaceholderForegroundColor) {
		collector.addRule(`.scm-view .scm-editor-placeholder { color: ${inputPlaceholderForegroundColor}; }`);
	}

	const inputValidationInfoBorderColor = theme.getColor(inputValidationInfoBorder);
	if (inputValidationInfoBorderColor) {
		collector.addRule(`.scm-view .scm-editor-container.validation-info { outline: 1px solid ${inputValidationInfoBorderColor} !important; }`);
		collector.addRule(`.scm-editor-validation.validation-info { border-color: ${inputValidationInfoBorderColor}; }`);
	}

	const inputValidationInfoBackgroundColor = theme.getColor(inputValidationInfoBackground);
	if (inputValidationInfoBackgroundColor) {
		collector.addRule(`.scm-editor-validation.validation-info { background-color: ${inputValidationInfoBackgroundColor}; }`);
	}

	const inputValidationInfoForegroundColor = theme.getColor(inputValidationInfoForeground);
	if (inputValidationInfoForegroundColor) {
		collector.addRule(`.scm-editor-validation.validation-info { color: ${inputValidationInfoForegroundColor}; }`);
	}

	const inputValidationWarningBorderColor = theme.getColor(inputValidationWarningBorder);
	if (inputValidationWarningBorderColor) {
		collector.addRule(`.scm-view .scm-editor-container.validation-warning { outline: 1px solid ${inputValidationWarningBorderColor} !important; }`);
		collector.addRule(`.scm-editor-validation.validation-warning { border-color: ${inputValidationWarningBorderColor}; }`);
	}

	const inputValidationWarningBackgroundColor = theme.getColor(inputValidationWarningBackground);
	if (inputValidationWarningBackgroundColor) {
		collector.addRule(`.scm-editor-validation.validation-warning { background-color: ${inputValidationWarningBackgroundColor}; }`);
	}

	const inputValidationWarningForegroundColor = theme.getColor(inputValidationWarningForeground);
	if (inputValidationWarningForegroundColor) {
		collector.addRule(`.scm-editor-validation.validation-warning { color: ${inputValidationWarningForegroundColor}; }`);
	}

	const inputValidationErrorBorderColor = theme.getColor(inputValidationErrorBorder);
	if (inputValidationErrorBorderColor) {
		collector.addRule(`.scm-view .scm-editor-container.validation-error { outline: 1px solid ${inputValidationErrorBorderColor} !important; }`);
		collector.addRule(`.scm-editor-validation.validation-error { border-color: ${inputValidationErrorBorderColor}; }`);
	}

	const inputValidationErrorBackgroundColor = theme.getColor(inputValidationErrorBackground);
	if (inputValidationErrorBackgroundColor) {
		collector.addRule(`.scm-editor-validation.validation-error { background-color: ${inputValidationErrorBackgroundColor}; }`);
	}

	const inputValidationErrorForegroundColor = theme.getColor(inputValidationErrorForeground);
	if (inputValidationErrorForegroundColor) {
		collector.addRule(`.scm-editor-validation.validation-error { color: ${inputValidationErrorForegroundColor}; }`);
	}

	const repositoryStatusActionsBorderColor = theme.getColor(SIDE_BAR_BORDER);
	if (repositoryStatusActionsBorderColor) {
		collector.addRule(`.scm-view .scm-provider > .status > .monaco-action-bar > .actions-container { border-color: ${repositoryStatusActionsBorderColor}; }`);
	}
});
