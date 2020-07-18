/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/scm';
import { Event, Emitter } from 'vs/base/common/event';
import { basename, dirname, isEqual } from 'vs/base/common/resources';
import { IDisposable, Disposable, DisposableStore, combinedDisposable } from 'vs/base/common/lifecycle';
import { ViewPane, IViewPaneOptions } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { append, $, addClass, toggleClass, removeClass, Dimension } from 'vs/base/browser/dom';
import { IListVirtualDelegate, IIdentityProvider } from 'vs/base/browser/ui/list/list';
import { ISCMResourceGroup, ISCMResource, InputValidationType, ISCMService, ISCMRepository, ISCMInput, IInputValidation } from 'vs/workbench/contrib/scm/common/scm';
import { ResourceLabels, IResourceLabel } from 'vs/workbench/browser/labels';
import { CountBadge } from 'vs/base/browser/ui/countBadge/countBadge';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IContextViewService, IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IContextKeyService, IContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { MenuItemAction, IMenuService } from 'vs/platform/actions/common/actions';
import { IAction, IActionViewItem, ActionRunner, Action, RadioGroup } from 'vs/base/common/actions';
import { ContextAwareMenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { SCMMenus } from './menus';
import { ActionBar, IActionViewItemProvider, Separator, ActionViewItem } from 'vs/base/browser/ui/actionbar/actionbar';
import { IThemeService, LIGHT, registerThemingParticipant, IFileIconTheme } from 'vs/platform/theme/common/themeService';
import { isSCMResource, isSCMResourceGroup, connectPrimaryMenuToInlineActionBar, isSCMRepository, isSCMInput, connectPrimaryMenu } from './util';
import { attachBadgeStyler } from 'vs/platform/theme/common/styler';
import { WorkbenchCompressibleObjectTree, IOpenEvent } from 'vs/platform/list/browser/listService';
import { IConfigurationService, ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { disposableTimeout, ThrottledDelayer } from 'vs/base/common/async';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ITreeNode, ITreeFilter, ITreeSorter, ITreeContextMenuEvent } from 'vs/base/browser/ui/tree/tree';
import { ResourceTree, IResourceNode } from 'vs/base/common/resourceTree';
import { ISequence, ISplice, SimpleSequence } from 'vs/base/common/sequence';
import { ICompressibleTreeRenderer, ICompressibleKeyboardNavigationLabelProvider } from 'vs/base/browser/ui/tree/objectTree';
import { Iterable } from 'vs/base/common/iterator';
import { ICompressedTreeNode, ICompressedTreeElement } from 'vs/base/browser/ui/tree/compressedObjectTreeModel';
import { URI } from 'vs/base/common/uri';
import { FileKind } from 'vs/platform/files/common/files';
import { compareFileNames, comparePaths } from 'vs/base/common/comparers';
import { FuzzyScore, createMatches, IMatch } from 'vs/base/common/filters';
import { IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';
import { localize } from 'vs/nls';
import { flatten } from 'vs/base/common/arrays';
import { memoize } from 'vs/base/common/decorators';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { toResource, SideBySideEditor } from 'vs/workbench/common/editor';
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
import { escape, compare, format } from 'vs/base/common/strings';
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
import { ContextSubMenu } from 'vs/base/browser/contextmenu';
import { KeyCode } from 'vs/base/common/keyCodes';
import { DEFAULT_FONT_FAMILY } from 'vs/workbench/browser/style';
import { Command } from 'vs/editor/common/modes';
import { renderCodicons, Codicon } from 'vs/base/common/codicons';
import { ToolBar } from 'vs/base/browser/ui/toolbar/toolbar';
import { AnchorAlignment } from 'vs/base/browser/ui/contextview/contextview';
import { domEvent } from 'vs/base/browser/event';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';

type TreeElement = ISCMRepository | ISCMInput | ISCMResourceGroup | IResourceNode<ISCMResource, ISCMResourceGroup> | ISCMResource;

function splitMatches(uri: URI, filterData: FuzzyScore | undefined): [IMatch[] | undefined, IMatch[] | undefined] {
	let matches: IMatch[] | undefined;
	let descriptionMatches: IMatch[] | undefined;

	if (filterData) {
		matches = [];
		descriptionMatches = [];

		const fileName = basename(uri);
		const allMatches = createMatches(filterData);

		for (const match of allMatches) {
			if (match.start < fileName.length) {
				matches!.push(
					{
						start: match.start,
						end: Math.min(match.end, fileName.length)
					}
				);
			} else {
				descriptionMatches!.push(
					{
						start: match.start - (fileName.length + 1),
						end: match.end - (fileName.length + 1)
					}
				);
			}
		}
	}

	return [matches, descriptionMatches];
}

class StatusBarAction extends Action {

	constructor(
		private command: Command,
		private commandService: ICommandService
	) {
		super(`statusbaraction{${command.id}}`, command.title, '', true);
		this.tooltip = command.tooltip || '';
	}

	run(): Promise<void> {
		return this.commandService.executeCommand(this.command.id, ...(this.command.arguments || []));
	}
}

class StatusBarActionViewItem extends ActionViewItem {

	constructor(action: StatusBarAction) {
		super(null, action, {});
	}

	updateLabel(): void {
		if (this.options.label && this.label) {
			this.label.innerHTML = renderCodicons(escape(this.getAction().label));
		}
	}
}

interface ISCMLayout {
	height: number | undefined;
	width: number | undefined;
	readonly onDidChange: Event<void>;
}

interface RepositoryTemplate {
	readonly label: HTMLElement;
	readonly name: HTMLElement;
	readonly description: HTMLElement;
	readonly countContainer: HTMLElement;
	readonly count: CountBadge;
	readonly toolBar: ToolBar;
	disposable: IDisposable;
	readonly templateDisposable: IDisposable;
}

class RepositoryRenderer implements ICompressibleTreeRenderer<ISCMRepository, FuzzyScore, RepositoryTemplate> {

	static readonly TEMPLATE_ID = 'repository';
	get templateId(): string { return RepositoryRenderer.TEMPLATE_ID; }

	constructor(
		private actionViewItemProvider: IActionViewItemProvider,
		private menus: SCMMenus,
		@ICommandService private commandService: ICommandService,
		@IContextMenuService private contextMenuService: IContextMenuService,
		@IThemeService private themeService: IThemeService
	) { }

	renderTemplate(container: HTMLElement): RepositoryTemplate {
		// hack
		addClass(container.parentElement!.parentElement!.querySelector('.monaco-tl-twistie')! as HTMLElement, 'force-twistie');

		const provider = append(container, $('.scm-provider'));
		const label = append(provider, $('.label'));
		const name = append(label, $('span.name'));
		const description = append(label, $('span.description'));
		const actions = append(provider, $('.actions'));
		const toolBar = new ToolBar(actions, this.contextMenuService, { actionViewItemProvider: this.actionViewItemProvider });
		const countContainer = append(provider, $('.count'));
		const count = new CountBadge(countContainer);
		const badgeStyler = attachBadgeStyler(count, this.themeService);
		const visibilityDisposable = toolBar.onDidChangeDropdownVisibility(e => toggleClass(provider, 'active', e));

		const disposable = Disposable.None;
		const templateDisposable = combinedDisposable(visibilityDisposable, toolBar, badgeStyler);

		return { label, name, description, countContainer, count, toolBar, disposable, templateDisposable };
	}

	renderElement(node: ITreeNode<ISCMRepository, FuzzyScore>, index: number, templateData: RepositoryTemplate, height: number | undefined): void {
		templateData.disposable.dispose();

		const disposables = new DisposableStore();
		const repository = node.element;

		if (repository.provider.rootUri) {
			templateData.label.title = `${repository.provider.label}: ${repository.provider.rootUri.fsPath}`;
			templateData.name.textContent = basename(repository.provider.rootUri);
			templateData.description.textContent = repository.provider.label;
		} else {
			templateData.label.title = repository.provider.label;
			templateData.name.textContent = repository.provider.label;
			templateData.description.textContent = '';
		}

		let statusPrimaryActions: IAction[] = [];
		let menuPrimaryActions: IAction[] = [];
		let menuSecondaryActions: IAction[] = [];
		const updateToolbar = () => {
			templateData.toolBar.setActions([...statusPrimaryActions, ...menuPrimaryActions], menuSecondaryActions);
		};

		const onDidChangeProvider = () => {
			const commands = repository.provider.statusBarCommands || [];
			statusPrimaryActions = commands.map(c => new StatusBarAction(c, this.commandService));
			updateToolbar();

			const count = repository.provider.count || 0;
			templateData.countContainer.setAttribute('data-count', String(count));
			templateData.count.setCount(count);
		};
		disposables.add(repository.provider.onDidChange(onDidChangeProvider, null));
		onDidChangeProvider();

		const menus = this.menus.getRepositoryMenus(repository.provider);
		disposables.add(connectPrimaryMenu(menus.titleMenu, (primary, secondary) => {
			menuPrimaryActions = primary;
			menuSecondaryActions = secondary;
			updateToolbar();
		}));
		templateData.toolBar.context = repository.provider;

		templateData.disposable = disposables;
	}

	renderCompressedElements(): void {
		throw new Error('Should never happen since node is incompressible');
	}

	disposeElement(group: ITreeNode<ISCMRepository, FuzzyScore>, index: number, template: RepositoryTemplate): void {
		template.disposable.dispose();
	}

	disposeTemplate(templateData: RepositoryTemplate): void {
		templateData.disposable.dispose();
		templateData.templateDisposable.dispose();
	}
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

	constructor(
		private outerLayout: ISCMLayout,
		private updateHeight: (input: ISCMInput, height: number) => void,
		private focusTree: () => void,
		@IInstantiationService private instantiationService: IInstantiationService,
	) { }

	renderTemplate(container: HTMLElement): InputTemplate {
		// hack
		addClass(container.parentElement!.parentElement!.querySelector('.monaco-tl-twistie')! as HTMLElement, 'force-no-twistie');

		const disposables = new DisposableStore();
		const inputElement = append(container, $('.scm-input'));
		const inputWidget = this.instantiationService.createInstance(SCMInputWidget, inputElement);
		disposables.add(inputWidget);

		const onKeyDown = Event.map(domEvent(container, 'keydown'), e => new StandardKeyboardEvent(e));
		const onEscape = Event.filter(onKeyDown, e => e.keyCode === KeyCode.Escape);
		disposables.add(onEscape(this.focusTree));

		return { inputWidget, disposable: Disposable.None, templateDisposable: disposables };
	}

	renderElement(node: ITreeNode<ISCMInput, FuzzyScore>, index: number, templateData: InputTemplate): void {
		templateData.disposable.dispose();

		const disposables = new DisposableStore();
		const input = node.element;
		templateData.inputWidget.input = input;
		disposables.add({ dispose: () => templateData.inputWidget.input = undefined });

		// Remember widget
		this.inputWidgets.set(input, templateData.inputWidget);
		disposables.add({ dispose: () => this.inputWidgets.delete(input) });

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
		private menus: SCMMenus,
		@IThemeService private themeService: IThemeService,
	) { }

	renderTemplate(container: HTMLElement): ResourceGroupTemplate {
		// hack
		addClass(container.parentElement!.parentElement!.querySelector('.monaco-tl-twistie')! as HTMLElement, 'force-twistie');

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
		const menus = this.menus.getRepositoryMenus(group.provider);
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

class ResourceRenderer implements ICompressibleTreeRenderer<ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>, FuzzyScore, ResourceTemplate> {

	static readonly TEMPLATE_ID = 'resource';
	get templateId(): string { return ResourceRenderer.TEMPLATE_ID; }

	constructor(
		private viewModelProvider: () => ViewModel,
		private labels: ResourceLabels,
		private actionViewItemProvider: IActionViewItemProvider,
		private actionRunner: ActionRunner,
		private menus: SCMMenus,
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

	renderElement(node: ITreeNode<ISCMResource, FuzzyScore> | ITreeNode<ISCMResource | IResourceNode<ISCMResource, ISCMResourceGroup>, FuzzyScore>, index: number, template: ResourceTemplate): void {
		template.elementDisposables.dispose();

		const elementDisposables = new DisposableStore();
		const resourceOrFolder = node.element;
		const theme = this.themeService.getColorTheme();
		const iconResource = ResourceTree.isResourceNode(resourceOrFolder) ? resourceOrFolder.element : resourceOrFolder;
		const icon = iconResource && (theme.type === LIGHT ? iconResource.decorations.icon : iconResource.decorations.iconDark);

		const uri = ResourceTree.isResourceNode(resourceOrFolder) ? resourceOrFolder.uri : resourceOrFolder.sourceUri;
		const fileKind = ResourceTree.isResourceNode(resourceOrFolder) ? FileKind.FOLDER : FileKind.FILE;
		const viewModel = this.viewModelProvider();

		const [matches, descriptionMatches] = splitMatches(uri, node.filterData);
		template.fileLabel.setFile(uri, {
			fileDecorations: { colors: false, badges: !icon },
			hidePath: viewModel.mode === ViewModelMode.Tree,
			fileKind,
			matches,
			descriptionMatches
		});

		template.actionBar.clear();
		template.actionBar.context = resourceOrFolder;

		if (ResourceTree.isResourceNode(resourceOrFolder)) {
			if (resourceOrFolder.element) {
				const menus = this.menus.getRepositoryMenus(resourceOrFolder.element.resourceGroup.provider);
				elementDisposables.add(connectPrimaryMenuToInlineActionBar(menus.getResourceMenu(resourceOrFolder.element.resourceGroup), template.actionBar));
				toggleClass(template.name, 'strike-through', resourceOrFolder.element.decorations.strikeThrough);
				toggleClass(template.element, 'faded', resourceOrFolder.element.decorations.faded);
			} else {
				const menus = this.menus.getRepositoryMenus(resourceOrFolder.context.provider);
				elementDisposables.add(connectPrimaryMenuToInlineActionBar(menus.getResourceFolderMenu(resourceOrFolder.context), template.actionBar));
				removeClass(template.name, 'strike-through');
				removeClass(template.element, 'faded');
			}
		} else {
			const menus = this.menus.getRepositoryMenus(resourceOrFolder.resourceGroup.provider);
			elementDisposables.add(connectPrimaryMenuToInlineActionBar(menus.getResourceMenu(resourceOrFolder.resourceGroup), template.actionBar));
			toggleClass(template.name, 'strike-through', resourceOrFolder.decorations.strikeThrough);
			toggleClass(template.element, 'faded', resourceOrFolder.decorations.faded);
		}

		const tooltip = !ResourceTree.isResourceNode(resourceOrFolder) && resourceOrFolder.decorations.tooltip || '';

		if (icon) {
			template.decorationIcon.style.display = '';
			template.decorationIcon.style.backgroundImage = `url('${icon}')`;
			template.decorationIcon.title = tooltip;
		} else {
			template.decorationIcon.style.display = 'none';
			template.decorationIcon.style.backgroundImage = '';
			template.decorationIcon.title = '';
		}

		template.element.setAttribute('data-tooltip', tooltip);
		template.elementDisposables = elementDisposables;
	}

	disposeElement(resource: ITreeNode<ISCMResource, FuzzyScore> | ITreeNode<IResourceNode<ISCMResource, ISCMResourceGroup>, FuzzyScore>, index: number, template: ResourceTemplate): void {
		template.elementDisposables.dispose();
	}

	renderCompressedElements(node: ITreeNode<ICompressedTreeNode<ISCMResource> | ICompressedTreeNode<IResourceNode<ISCMResource, ISCMResourceGroup>>, FuzzyScore>, index: number, template: ResourceTemplate, height: number | undefined): void {
		template.elementDisposables.dispose();

		const elementDisposables = new DisposableStore();
		const compressed = node.element as ICompressedTreeNode<IResourceNode<ISCMResource, ISCMResourceGroup>>;
		const folder = compressed.elements[compressed.elements.length - 1];

		const label = compressed.elements.map(e => e.name).join('/');
		const fileKind = FileKind.FOLDER;

		const [matches, descriptionMatches] = splitMatches(folder.uri, node.filterData);
		template.fileLabel.setResource({ resource: folder.uri, name: label }, {
			fileDecorations: { colors: false, badges: true },
			fileKind,
			matches,
			descriptionMatches
		});

		template.actionBar.clear();
		template.actionBar.context = folder;

		const menus = this.menus.getRepositoryMenus(folder.context.provider);
		elementDisposables.add(connectPrimaryMenuToInlineActionBar(menus.getResourceFolderMenu(folder.context), template.actionBar));

		removeClass(template.name, 'strike-through');
		removeClass(template.element, 'faded');
		template.decorationIcon.style.display = 'none';
		template.decorationIcon.style.backgroundImage = '';

		template.element.setAttribute('data-tooltip', '');
		template.elementDisposables = elementDisposables;
	}

	disposeCompressedElements(node: ITreeNode<ICompressedTreeNode<ISCMResource> | ICompressedTreeNode<IResourceNode<ISCMResource, ISCMResourceGroup>>, FuzzyScore>, index: number, template: ResourceTemplate, height: number | undefined): void {
		template.elementDisposables.dispose();
	}

	disposeTemplate(template: ResourceTemplate): void {
		template.elementDisposables.dispose();
		template.disposables.dispose();
	}
}

class ProviderListDelegate implements IListVirtualDelegate<TreeElement> {

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

	constructor(@ILabelService private readonly labelService: ILabelService) { }

	getKeyboardNavigationLabel(element: TreeElement): { toString(): string; } | undefined {
		if (ResourceTree.isResourceNode(element)) {
			return element.name;
		} else if (isSCMRepository(element)) {
			return undefined;
		} else if (isSCMInput(element)) {
			return undefined;
		} else if (isSCMResourceGroup(element)) {
			return element.label;
		} else {
			// Since a match in the file name takes precedence over a match
			// in the folder name we are returning the label as file/folder.
			const fileName = basename(element.sourceUri);
			const filePath = this.labelService.getUriLabel(dirname(element.sourceUri), { relative: true });

			return filePath.length !== 0 ? `${fileName} ${filePath}` : fileName;
		}
	}

	getCompressedNodeKeyboardNavigationLabel(elements: TreeElement[]): { toString(): string | undefined; } | undefined {
		const folders = elements as IResourceNode<ISCMResource, ISCMResourceGroup>[];
		return folders.map(e => e.name).join('/');
	}
}

class SCMResourceIdentityProvider implements IIdentityProvider<TreeElement> {

	getId(element: TreeElement): string {
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
	readonly disposable: IDisposable;
}

interface IRepositoryItem {
	readonly element: ISCMRepository;
	readonly groupItems: IGroupItem[];
	readonly disposable: IDisposable;
}

function isRepositoryItem(item: IRepositoryItem | IGroupItem): item is IRepositoryItem {
	return Array.isArray((item as IRepositoryItem).groupItems);
}

function asTreeElement(node: IResourceNode<ISCMResource, ISCMResourceGroup>, forceIncompressible: boolean): ICompressedTreeElement<TreeElement> {
	return {
		element: (node.childrenCount === 0 && node.element) ? node.element : node,
		children: Iterable.map(node.children, node => asTreeElement(node, false)),
		incompressible: !!node.element || forceIncompressible
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

		for (const item of this.items) {
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

	private items: IRepositoryItem[] = [];
	private visibilityDisposables = new DisposableStore();
	private scrollTop: number | undefined;
	private firstVisible = true;
	private repositoryCollapseStates: Map<ISCMRepository, boolean> | undefined;
	private disposables = new DisposableStore();

	constructor(
		readonly repositories: ISequence<ISCMRepository>,
		private tree: WorkbenchCompressibleObjectTree<TreeElement, FuzzyScore>,
		private menus: SCMMenus,
		private inputRenderer: InputRenderer,
		private _mode: ViewModelMode,
		private _sortKey: ViewModelSortKey,
		@IEditorService protected editorService: IEditorService,
		@IConfigurationService protected configurationService: IConfigurationService,
	) {
		this.onDidChangeRepositoryCollapseState = Event.any(
			this._onDidChangeRepositoryCollapseState.event,
			Event.signal(Event.filter(this.tree.onDidChangeCollapseState, e => isSCMRepository(e.node.element)))
		);
	}

	private _onDidSpliceRepositories({ start, deleteCount, toInsert }: ISplice<ISCMRepository>): void {
		const itemsToInsert = toInsert.map(repository => {
			const disposable = combinedDisposable(
				repository.provider.groups.onDidSplice(splice => this._onDidSpliceGroups(item, splice)),
				repository.input.onDidChangeVisibility(() => this.refresh(item))
			);
			const groupItems = repository.provider.groups.elements.map(group => this.createGroupItem(group));
			const item: IRepositoryItem = { element: repository, groupItems, disposable };

			return item;
		});

		const itemsToDispose = this.items.splice(start, deleteCount, ...itemsToInsert);

		for (const item of itemsToDispose) {
			for (const groupItem of item.groupItems) {
				groupItem.disposable.dispose();
			}

			item.disposable.dispose();
		}

		this.refresh();
	}

	private _onDidSpliceGroups(item: IRepositoryItem, { start, deleteCount, toInsert }: ISplice<ISCMResourceGroup>): void {
		const itemsToInsert: IGroupItem[] = toInsert.map(group => this.createGroupItem(group));
		const itemsToDispose = item.groupItems.splice(start, deleteCount, ...itemsToInsert);

		for (const item of itemsToDispose) {
			item.disposable.dispose();
		}

		this.refresh();
	}

	private createGroupItem(group: ISCMResourceGroup): IGroupItem {
		const tree = new ResourceTree<ISCMResource, ISCMResourceGroup>(group, group.provider.rootUri || URI.file('/'));
		const resources: ISCMResource[] = [...group.elements];
		const disposable = combinedDisposable(
			group.onDidChange(() => this.tree.refilter()),
			group.onDidSplice(splice => this._onDidSpliceGroup(item, splice))
		);

		const item: IGroupItem = { element: group, resources, tree, disposable };

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
			this.repositories.onDidSplice(this._onDidSpliceRepositories, this, this.visibilityDisposables);
			this._onDidSpliceRepositories({ start: 0, deleteCount: 0, toInsert: this.repositories.elements });
			this.repositoryCollapseStates = undefined;

			if (typeof this.scrollTop === 'number') {
				this.tree.scrollTop = this.scrollTop;
				this.scrollTop = undefined;
			}

			this.editorService.onDidActiveEditorChange(this.onDidActiveEditorChange, this, this.visibilityDisposables);
			this.onDidActiveEditorChange();
		} else {
			if (this.items.length > 1) {
				this.repositoryCollapseStates = new Map();

				for (const item of this.items) {
					this.repositoryCollapseStates.set(item.element, this.tree.isCollapsed(item.element));
				}
			}

			this.visibilityDisposables.dispose();
			this._onDidSpliceRepositories({ start: 0, deleteCount: this.items.length, toInsert: [] });
			this.scrollTop = this.tree.scrollTop;
		}

		this.visible = visible;
		this._onDidChangeRepositoryCollapseState.fire();
	}

	private refresh(item?: IRepositoryItem | IGroupItem): void {
		if (this.items.length === 1 && (!item || isRepositoryItem(item))) {
			this.tree.setChildren(null, this.render(this.items[0]).children);
		} else if (item) {
			this.tree.setChildren(item.element, this.render(item).children);
		} else {
			this.tree.setChildren(null, this.items.map(item => this.render(item)));
		}

		this._onDidChangeRepositoryCollapseState.fire();
	}

	private render(item: IRepositoryItem | IGroupItem): ICompressedTreeElement<TreeElement> {
		if (isRepositoryItem(item)) {
			const children: ICompressedTreeElement<TreeElement>[] = [];
			const hasSomeChanges = item.groupItems.some(item => item.element.elements.length > 0);

			if (this.items.length === 1 || hasSomeChanges) {
				if (item.element.input.visible) {
					children.push({ element: item.element.input, incompressible: true, collapsible: false });
				}

				children.push(...item.groupItems.map(i => this.render(i)));
			}

			const collapsed = this.repositoryCollapseStates?.get(item.element);
			return { element: item.element, children, incompressible: true, collapsed, collapsible: true };
		} else {
			const children = this.mode === ViewModelMode.List
				? Iterable.map(item.resources, element => ({ element, incompressible: true }))
				: Iterable.map(item.tree.root.children, node => asTreeElement(node, true));

			return { element: item.element, children, incompressible: true, collapsible: true };
		}
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

		const editor = this.editorService.activeEditor;

		if (!editor) {
			return;
		}

		const uri = toResource(editor, { supportSideBySide: SideBySideEditor.PRIMARY });

		if (!uri) {
			return;
		}

		for (let i = 0; i < this.items.length; i++) {
			const item = this.items[i];
			// go backwards from last group
			for (let j = item.groupItems.length - 1; j >= 0; j--) {
				const groupItem = item.groupItems[j];
				const resource = this.mode === ViewModelMode.Tree
					? groupItem.tree.getNode(uri)?.element
					: groupItem.resources.find(r => isEqual(r.sourceUri, uri));

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
		for (const repository of this.repositories.elements) {
			const widget = this.inputRenderer.getRenderedInputWidget(repository.input);

			if (widget) {
				widget.focus();
				return;
			}
		}

		this.tree.domFocus();
	}

	getViewActions(): IAction[] {
		if (this.repositories.elements.length !== 1) {
			return [];
		}

		const menus = this.menus.getRepositoryMenus(this.repositories.elements[0].provider);
		return menus.getTitleActions();
	}

	getViewSecondaryActions(): IAction[] {
		if (this.repositories.elements.length === 0) {
			return [];
		}

		const viewAction = new SCMViewSubMenuAction(this);

		if (this.repositories.elements.length !== 1) {
			return viewAction.entries;
		}

		const menus = this.menus.getRepositoryMenus(this.repositories.elements[0].provider);
		const secondaryActions = menus.getTitleSecondaryActions();

		if (secondaryActions.length === 0) {
			return [viewAction];
		}

		return [viewAction, new Separator(), ...secondaryActions];
	}

	getViewActionsContext(): any {
		if (this.repositories.elements.length !== 1) {
			return undefined;
		}

		return this.repositories.elements[0].provider;
	}

	collapseAllProviders(): void {
		for (const repository of this.repositories.elements) {
			if (this.tree.isCollapsible(repository)) {
				this.tree.collapse(repository);
			}
		}
	}

	expandAllProviders(): void {
		for (const repository of this.repositories.elements) {
			if (this.tree.isCollapsible(repository)) {
				this.tree.expand(repository);
			}
		}
	}

	isAnyProviderCollapsible(): boolean {
		if (!this.visible || this.repositories.elements.length === 1) {
			return false;
		}

		return this.repositories.elements.some(r => this.tree.hasElement(r) && this.tree.isCollapsible(r));
	}

	areAllProvidersCollapsed(): boolean {
		if (!this.visible || this.repositories.elements.length === 1) {
			return false;
		}

		return this.repositories.elements.every(r => this.tree.hasElement(r) && (!this.tree.isCollapsible(r) || this.tree.isCollapsed(r)));
	}

	dispose(): void {
		this.visibilityDisposables.dispose();
		this.disposables.dispose();

		for (const item of this.items) {
			item.disposable.dispose();
		}

		this.items = [];
	}
}

class SCMViewSubMenuAction extends ContextSubMenu {
	constructor(viewModel: ViewModel) {
		super(localize('sortAction', "View & Sort"),
			[
				...new RadioGroup([
					new SCMViewModeListAction(viewModel),
					new SCMViewModeTreeAction(viewModel)
				]).actions,
				new Separator(),
				...new RadioGroup([
					new SCMSortByNameAction(viewModel),
					new SCMSortByPathAction(viewModel),
					new SCMSortByStatusAction(viewModel)
				]).actions
			]
		);
	}
}

abstract class SCMViewModeAction extends Action {
	constructor(id: string, label: string, private viewModel: ViewModel, private viewMode: ViewModelMode) {
		super(id, label);

		this.checked = this.viewModel.mode === this.viewMode;
	}

	async run(): Promise<void> {
		if (this.viewMode !== this.viewModel.mode) {
			this.checked = !this.checked;
			this.viewModel.mode = this.viewMode;
		}
	}
}

class SCMViewModeListAction extends SCMViewModeAction {
	static readonly ID = 'workbench.scm.action.viewModeList';
	static readonly LABEL = localize('viewModeList', "View as List");

	constructor(viewModel: ViewModel) {
		super(SCMViewModeListAction.ID, SCMViewModeListAction.LABEL, viewModel, ViewModelMode.List);
	}
}

class SCMViewModeTreeAction extends SCMViewModeAction {
	static readonly ID = 'workbench.scm.action.viewModeTree';
	static readonly LABEL = localize('viewModeTree', "View as Tree");

	constructor(viewModel: ViewModel) {
		super(SCMViewModeTreeAction.ID, SCMViewModeTreeAction.LABEL, viewModel, ViewModelMode.Tree);
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

	readonly onDidChangeContentHeight: Event<void>;

	get input(): ISCMInput | undefined {
		return this.model?.input;
	}

	set input(input: ISCMInput | undefined) {
		this.validationDisposable.dispose();
		removeClass(this.editorContainer, 'synthetic-focus');

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
		this.repositoryDisposables.add(input.onDidChange(value => {
			if (value === textModel.getValue()) { // circuit breaker
				return;
			}
			textModel.setValue(value);
			this.inputEditor.setPosition(textModel.getFullModelRange().getEndPosition());
		}));

		// Keep API in sync with model, update placeholder visibility and validate
		const updatePlaceholderVisibility = () => toggleClass(this.placeholderTextContainer, 'hidden', textModel.getValueLength() > 0);
		this.repositoryDisposables.add(textModel.onDidChangeContent(() => {
			input.value = textModel.getValue();
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

	constructor(
		container: HTMLElement,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IModelService private modelService: IModelService,
		@IModeService private modeService: IModeService,
		@IKeybindingService private keybindingService: IKeybindingService,
		@IConfigurationService private configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IContextViewService private readonly contextViewService: IContextViewService,
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
			quickSuggestions: false
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
			this.input?.repository.setSelected(true); // TODO@joao: remove
			addClass(this.editorContainer, 'synthetic-focus');
			this.renderValidation();
		}));
		this._register(this.inputEditor.onDidBlurEditorText(() => {
			removeClass(this.editorContainer, 'synthetic-focus');
			this.validationDisposable.dispose();
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
		const dimension: Dimension = {
			width: this.element.clientWidth - 2,
			height: editorHeight,
		};

		this.inputEditor.layout(dimension);
		this.renderValidation();
	}

	focus(): void {
		this.inputEditor.focus();
		addClass(this.editorContainer, 'synthetic-focus');
	}

	private renderValidation(): void {
		this.validationDisposable.dispose();

		toggleClass(this.editorContainer, 'validation-info', this.validation?.type === InputValidationType.Information);
		toggleClass(this.editorContainer, 'validation-warning', this.validation?.type === InputValidationType.Warning);
		toggleClass(this.editorContainer, 'validation-error', this.validation?.type === InputValidationType.Error);

		if (!this.validation || !this.inputEditor.hasTextFocus()) {
			return;
		}

		this.validationDisposable = this.contextViewService.showContextView({
			getAnchor: () => this.editorContainer,
			render: container => {
				const element = append(container, $('.scm-editor-validation'));
				toggleClass(element, 'validation-info', this.validation!.type === InputValidationType.Information);
				toggleClass(element, 'validation-warning', this.validation!.type === InputValidationType.Warning);
				toggleClass(element, 'validation-error', this.validation!.type === InputValidationType.Error);
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

	dispose(): void {
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
		this.label = this.allCollapsed ? localize('expand all', "Expand All Providers") : localize('collapse all', "Collapse All Providers");
		this.class = this.allCollapsed ? Codicon.expandAll.classNames : Codicon.collapseAll.classNames;
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
	private menus!: SCMMenus;
	private inputRenderer!: InputRenderer;

	constructor(
		options: IViewPaneOptions,
		@ISCMService private scmService: ISCMService,
		@IKeybindingService protected keybindingService: IKeybindingService,
		@IThemeService protected themeService: IThemeService,
		@IContextMenuService protected contextMenuService: IContextMenuService,
		@IContextViewService protected contextViewService: IContextViewService,
		@ICommandService protected commandService: ICommandService,
		@INotificationService private readonly notificationService: INotificationService,
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
	}

	protected renderBody(container: HTMLElement): void {
		super.renderBody(container);

		// List
		this.listContainer = append(container, $('.scm-view.show-file-icons'));

		const updateActionsVisibility = () => toggleClass(this.listContainer, 'show-actions', this.configurationService.getValue<boolean>('scm.alwaysShowActions'));
		Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('scm.alwaysShowActions'))(updateActionsVisibility);
		updateActionsVisibility();

		const updateProviderCountVisibility = () => {
			const value = this.configurationService.getValue<'hidden' | 'auto' | 'visible'>('scm.providerCountBadge');
			toggleClass(this.listContainer, 'hide-provider-counts', value === 'hidden');
			toggleClass(this.listContainer, 'auto-provider-counts', value === 'auto');
		};
		Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('scm.providerCountBadge'))(updateProviderCountVisibility);
		updateProviderCountVisibility();

		const repositories = new SimpleSequence(this.scmService.repositories, this.scmService.onDidAddRepository, this.scmService.onDidRemoveRepository);
		this._register(repositories);

		this.menus = this.instantiationService.createInstance(SCMMenus, repositories);
		this._register(this.menus);

		this._register(repositories.onDidSplice(() => this.updateActions()));

		this.inputRenderer = this.instantiationService.createInstance(InputRenderer, this.layoutCache, (input, height) => this.tree.updateElementHeight(input, height), () => this.tree.domFocus());
		const delegate = new ProviderListDelegate(this.inputRenderer);

		const actionViewItemProvider = (action: IAction) => this.getActionViewItem(action);

		this.listLabels = this.instantiationService.createInstance(ResourceLabels, { onDidChangeVisibility: this.onDidChangeBodyVisibility });
		this._register(this.listLabels);

		const actionRunner = new RepositoryPaneActionRunner(() => this.getSelectedResources());
		this._register(actionRunner);
		this._register(actionRunner.onDidBeforeRun(() => this.tree.domFocus()));

		const renderers = [
			this.instantiationService.createInstance(RepositoryRenderer, actionViewItemProvider, this.menus),
			this.inputRenderer,
			this.instantiationService.createInstance(ResourceGroupRenderer, actionViewItemProvider, this.menus),
			this.instantiationService.createInstance(ResourceRenderer, () => this.viewModel, this.listLabels, actionViewItemProvider, actionRunner, this.menus)
		];

		const filter = new SCMTreeFilter();
		const sorter = new SCMTreeSorter(() => this.viewModel);
		const keyboardNavigationLabelProvider = this.instantiationService.createInstance(SCMTreeKeyboardNavigationLabelProvider);
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
				transformOptimization: false,
				overrideStyles: {
					listBackground: this.viewDescriptorService.getViewLocationById(this.id) === ViewContainerLocation.Sidebar ? SIDE_BAR_BACKGROUND : PANEL_BACKGROUND
				},
				accessibilityProvider: this.instantiationService.createInstance(SCMAccessibilityProvider)
			}) as WorkbenchCompressibleObjectTree<TreeElement, FuzzyScore>;

		this._register(this.tree.onDidOpen(this.open, this));

		this._register(this.tree.onContextMenu(this.onListContextMenu, this));
		this._register(this.tree);

		let viewMode = this.configurationService.getValue<'tree' | 'list'>('scm.defaultViewMode') === 'list' ? ViewModelMode.List : ViewModelMode.Tree;
		const storageMode = this.storageService.get(`scm.viewMode`, StorageScope.WORKSPACE) as ViewModelMode;

		if (typeof storageMode === 'string') {
			viewMode = storageMode;
		}

		this.viewModel = this.instantiationService.createInstance(ViewModel, repositories, this.tree, this.menus, this.inputRenderer, viewMode, ViewModelSortKey.Path);
		this._register(this.viewModel);

		addClass(this.listContainer, 'file-icon-themable-tree');
		addClass(this.listContainer, 'show-file-icons');

		this.updateIndentStyles(this.themeService.getFileIconTheme());
		this._register(this.themeService.onDidFileIconThemeChange(this.updateIndentStyles, this));
		this._register(this.viewModel.onDidChangeMode(this.onDidChangeMode, this));

		this._register(this.onDidChangeBodyVisibility(this.viewModel.setVisible, this.viewModel));

		this.updateActions();
	}

	private updateIndentStyles(theme: IFileIconTheme): void {
		toggleClass(this.listContainer, 'list-view-mode', this.viewModel.mode === ViewModelMode.List);
		toggleClass(this.listContainer, 'tree-view-mode', this.viewModel.mode === ViewModelMode.Tree);
		toggleClass(this.listContainer, 'align-icons-and-twisties', (this.viewModel.mode === ViewModelMode.List && theme.hasFileIcons) || (theme.hasFileIcons && !theme.hasFolderIcons));
		toggleClass(this.listContainer, 'hide-arrows', this.viewModel.mode === ViewModelMode.Tree && theme.hidesExplorerArrows === true);
	}

	private onDidChangeMode(): void {
		this.updateIndentStyles(this.themeService.getFileIconTheme());
		this.storageService.store(`scm.viewMode`, this.viewModel.mode, StorageScope.WORKSPACE);
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
		if (!this.viewModel) {
			return [];
		}

		if (this.viewModel.repositories.elements.length < 2) {
			return this.viewModel.getViewActions();
		}

		return [
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

		if (!(action instanceof MenuItemAction)) {
			return undefined;
		}

		return new ContextAwareMenuEntryActionViewItem(action, this.keybindingService, this.notificationService, this.contextMenuService);
	}

	getActionsContext(): any {
		if (!this.viewModel) {
			return [];
		}

		return this.viewModel.getViewActionsContext();
	}

	private async open(e: IOpenEvent<TreeElement | null>): Promise<void> {
		if (!e.element) {
			return;
		} else if (isSCMRepository(e.element)) { // TODO@joao: remove
			e.element.setSelected(true);
			return;
		} else if (isSCMResourceGroup(e.element)) { // TODO@joao: remove
			const provider = e.element.provider;
			const repository = this.scmService.repositories.find(r => r.provider === provider);
			repository?.setSelected(true);
			return;
		} else if (ResourceTree.isResourceNode(e.element)) { // TODO@joao: remove
			const provider = e.element.context.provider;
			const repository = this.scmService.repositories.find(r => r.provider === provider);
			repository?.setSelected(true);
			return;
		} else if (isSCMInput(e.element)) {
			e.element.repository.setSelected(true); // TODO@joao: remove

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
		await e.element.open(!!e.editorOptions.preserveFocus);

		if (e.editorOptions.pinned) {
			const activeEditorPane = this.editorService.activeEditorPane;

			if (activeEditorPane) {
				activeEditorPane.group.pinEditor(activeEditorPane.input);
			}
		}

		// TODO@joao: remove
		const provider = e.element.resourceGroup.provider;
		const repository = this.scmService.repositories.find(r => r.provider === provider);
		repository?.setSelected(true);
	}

	private onListContextMenu(e: ITreeContextMenuEvent<TreeElement | null>): void {
		if (!e.element) {
			return;
		}

		const element = e.element;
		let context: any = element;
		let actions: IAction[] = [];

		if (isSCMRepository(element)) {
			const menus = this.menus.getRepositoryMenus(element.provider);
			context = element.provider;
			actions = menus.getRepositoryContextActions();
		} else if (isSCMInput(element)) {
			// noop
		} else if (isSCMResourceGroup(element)) {
			const menus = this.menus.getRepositoryMenus(element.provider);
			actions = menus.getResourceGroupContextActions(element);
		} else if (ResourceTree.isResourceNode(element)) {
			if (element.element) {
				const menus = this.menus.getRepositoryMenus(element.element.resourceGroup.provider);
				actions = menus.getResourceContextActions(element.element);
			} else {
				const menus = this.menus.getRepositoryMenus(element.context.provider);
				actions = menus.getResourceFolderContextActions(element.context);
			}
		} else {
			const menus = this.menus.getRepositoryMenus(element.resourceGroup.provider);
			actions = menus.getResourceContextActions(element);
		}

		const actionRunner = new RepositoryPaneActionRunner(() => this.getSelectedResources());
		actionRunner.onDidBeforeRun(() => this.tree.domFocus());

		this.contextMenuService.showContextMenu({
			getAnchor: () => e.anchor,
			getActions: () => actions,
			getActionsContext: () => context,
			actionRunner
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
