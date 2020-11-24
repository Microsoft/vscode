/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./gettingStarted';
import 'vs/workbench/contrib/welcome/gettingStarted/browser/vs_code_editor_getting_started';
import { localize } from 'vs/nls';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { WalkThroughInput } from 'vs/workbench/contrib/welcome/walkThrough/browser/walkThroughInput';
import { FileAccess, Schemas } from 'vs/base/common/network';
import { IEditorInputFactory, EditorInput } from 'vs/workbench/common/editor';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IEditorOptions } from 'vs/platform/editor/common/editor';
import { assertIsDefined } from 'vs/base/common/types';
import { $, addDisposableListener } from 'vs/base/browser/dom';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { IProductService } from 'vs/platform/product/common/productService';
import { IGettingStartedCategoryWithProgress, IGettingStartedService } from 'vs/workbench/services/gettingStarted/common/gettingStartedService';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { buttonBackground as welcomeButtonBackground, buttonHoverBackground as welcomeButtonHoverBackground, welcomePageBackground } from 'vs/workbench/contrib/welcome/page/browser/welcomePage';
import { activeContrastBorder, buttonBackground, buttonForeground, buttonHoverBackground, contrastBorder, descriptionForeground, focusBorder, foreground, textLinkActiveForeground, textLinkForeground } from 'vs/platform/theme/common/colorRegistry';
import { getExtraColor } from 'vs/workbench/contrib/welcome/walkThrough/common/walkThroughUtils';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { EditorWalkThroughAction } from 'vs/workbench/contrib/welcome/walkThrough/browser/editor/editorWalkThrough';
import { isMacintosh } from 'vs/base/common/platform';
import { OpenFileFolderAction, OpenFolderAction } from 'vs/workbench/browser/actions/workspaceActions';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';

export const gettingStartedInputTypeId = 'workbench.editors.gettingStartedInput';
const telemetryFrom = 'gettingStartedPage';

export class GettingStartedPage extends Disposable {
	readonly editorInput: WalkThroughInput;
	private inProgressScroll = Promise.resolve();

	private dispatchListeners = new DisposableStore();

	private gettingStartedCategories: IGettingStartedCategoryWithProgress[];
	private currentCategory: IGettingStartedCategoryWithProgress | undefined;

	private additionalTopLevelItems = [
		{
			id: 'OpenFolder',
			title: localize('gettingStarted.openFolder.title', "Open Folder"),
			icon: 'folder-opened',
			description: localize('gettingStarted.openFolder.description', "Open a project and start working"),
			command: isMacintosh ? OpenFileFolderAction.ID : OpenFolderAction.ID
		},
		{
			id: 'InteractivePlayground',
			title: localize('gettingStarted.playground.title', "Interactive Playground"),
			icon: 'library',
			description: localize('gettingStarted.interactivePlayground.description', "Learn essential editor features"),
			command: EditorWalkThroughAction.ID
		}
	];


	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@ICommandService private readonly commandService: ICommandService,
		@IProductService private readonly productService: IProductService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IGettingStartedService private readonly gettingStartedService: IGettingStartedService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IInstantiationService private readonly instantiationService: IInstantiationService) {
		super();

		const resource = FileAccess.asBrowserUri('./vs_code_editor_getting_started.md', require)
			.with({
				scheme: Schemas.walkThrough,
				query: JSON.stringify({ moduleId: 'vs/workbench/contrib/welcome/gettingStarted/browser/vs_code_editor_getting_started' })
			});


		this.editorInput = this.instantiationService.createInstance(WalkThroughInput, {
			typeId: gettingStartedInputTypeId,
			name: localize('editorGettingStarted.title', "Getting Started"),
			resource,
			telemetryFrom,
			onReady: (container: HTMLElement) => this.onReady(container)
		});

		this.gettingStartedCategories = this.gettingStartedService.getCategories();
		this._register(this.dispatchListeners);
		this._register(this.gettingStartedService.onDidAddTask(task => console.log('added new task', task, 'that isnt being rendered yet')));
		this._register(this.gettingStartedService.onDidAddCategory(category => console.log('added new category', category, 'that isnt being rendered yet')));
		this._register(this.gettingStartedService.onDidProgressTask(task => {
			const category = this.gettingStartedCategories.find(category => category.id === task.category);
			if (!category) {
				throw Error('Could not find category with ID: ' + task.category);
			}
			const ourTask = category.tasks.find(_task => _task.id === task.id);
			if (!ourTask) {
				throw Error('Could not find task with ID: ' + task.id);
			}
			ourTask.done = task.done;
			if (category.id === this.currentCategory?.id) {
				const badgeelement = assertIsDefined(document.getElementById('done-task-' + task.id));
				if (task.done) { badgeelement.classList.remove('hidden'); }
				else { badgeelement.classList.add('hidden'); }
			}
			this.updateCategoryProgress();
		}));
	}

	public openEditor(options: IEditorOptions = { pinned: true }) {
		return this.editorService.openEditor(this.editorInput, options);
	}

	private registerDispatchListeners(container: HTMLElement) {
		this.dispatchListeners.clear();

		container.querySelectorAll('[x-dispatch]').forEach(element => {
			const [command, argument] = (element.getAttribute('x-dispatch') ?? '').split(':');
			if (command) {
				this.dispatchListeners.add(addDisposableListener(element, 'click', () => {

					type GettingStartedActionClassification = {
						command: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
						argument: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
					};
					type GettingStartedActionEvent = {
						command: string;
						argument: string | undefined;
					};
					this.telemetryService.publicLog2<GettingStartedActionEvent, GettingStartedActionClassification>('gettingStarted.ActionExecuted', { command, argument });

					switch (command) {
						case 'scrollPrev': {
							this.scrollPrev(container);
							break;
						}
						case 'skip': {
							this.commandService.executeCommand('workbench.action.closeActiveEditor');
							break;
						}
						case 'selectCategory': {
							const additionalElementCommand = this.additionalTopLevelItems.find(item => item.id === argument)?.command;
							if (additionalElementCommand) {
								this.commandService.executeCommand(additionalElementCommand);
							} else {
								this.scrollToCategory(container, argument);
							}
							break;
						}
						case 'runTaskAction': {
							const taskToRun = assertIsDefined(this.currentCategory?.tasks.find(task => task.id === argument));
							const commandToRun = assertIsDefined(taskToRun.button?.command);
							this.commandService.executeCommand(commandToRun);
							break;
						}
						default: {
							console.error('Dispatch to', command, argument, 'not defined');
							break;
						}
					}
				}));
			}
		});
	}

	private onReady(container: HTMLElement) {
		const categoryElements = this.gettingStartedCategories.map(
			category =>
				$('button.getting-started-category',
					{ 'x-dispatch': 'selectCategory:' + category.id },
					$('.codicon.codicon-' + category.icon, {}),
					$('.category-description-container', {},
						$('h3.category-title', {}, category.title),
						$('.category-description', {}, category.description),
						$('.category-progress', { 'x-data-category-id': category.id, }, $('.message'), $('progress'))
					)));

		const additionalElements = this.additionalTopLevelItems.map(category =>
			$('button.getting-started-category',
				{ 'x-dispatch': 'selectCategory:' + category.id },
				$('.codicon.codicon-' + category.icon, {}),
				$('.category-description-container', {},
					$('h3.category-title', {}, category.title),
					$('.category-description', {}, category.description),
				)));

		[...categoryElements, ...additionalElements].forEach(element => {
			assertIsDefined(document.getElementById('getting-started-categories-container')).appendChild(element);
		});

		this.updateCategoryProgress();

		assertIsDefined(document.getElementById('product-name')).textContent = this.productService.nameLong;
		this.registerDispatchListeners(container);
	}

	private updateCategoryProgress() {
		document.querySelectorAll('.category-progress').forEach(element => {
			const categoryID = element.getAttribute('x-data-category-id');
			const category = this.gettingStartedCategories.find(category => category.id === categoryID);
			if (!category) { throw Error('Could not find caategory with ID ' + categoryID); }
			const numDone = category.tasks.filter(task => task.done).length;
			const numTotal = category.tasks.length;

			const message = assertIsDefined(element.firstChild);
			const bar = assertIsDefined(element.lastChild) as HTMLProgressElement;
			bar.value = numDone;
			bar.max = numTotal;
			if (numTotal === numDone) {
				message.textContent = `All items complete!`;
			}
			else {
				message.textContent = `${numDone} of ${numTotal} items complete`;
			}
		});
	}

	private async scrollToCategory(container: HTMLElement, categoryID: string) {
		this.inProgressScroll = this.inProgressScroll.then(async () => {
			this.clearDetialView();
			this.currentCategory = this.gettingStartedCategories.find(category => category.id === categoryID);
			if (!this.currentCategory) { throw Error('could not find category with ID ' + categoryID); }
			const slides = [...container.querySelectorAll('.gettingStartedSlide').values()];
			const currentSlide = slides.findIndex(element =>
				!element.classList.contains('prev') && !element.classList.contains('next'));
			if (currentSlide < slides.length - 1) {
				slides[currentSlide].classList.add('prev');

				const detailSlide = assertIsDefined(slides[currentSlide + 1]);
				detailSlide.classList.remove('next');
				const detailTitle = assertIsDefined(document.getElementById('getting-started-detail-title'));
				detailTitle.appendChild(
					$('.getting-started-category',
						{},
						$('.codicon.codicon-' + this.currentCategory.icon, {}),
						$('.category-description-container', {},
							$('h2.category-title', {}, this.currentCategory.title),
							$('.category-description', {}, this.currentCategory.description))));

				const categoryElements = this.currentCategory.tasks.map(
					task =>
						$('button.getting-started-task',
							{},
							$('.task-description-container', {},
								$('.codicon.codicon-pass' + (task.done ? '' : '.hidden'), { id: 'done-task-' + task.id },),
								$('h3.task-title', {}, task.title),
								$('.task-description', {}, task.description),
								...(
									task.button
										? [$('button.emphasis.getting-started-task-action', { 'x-dispatch': 'runTaskAction:' + task.id },
											task.button.title + this.getKeybindingLabel(task.button.command)
										)]
										: []))));

				const detailContainer = assertIsDefined(document.getElementById('getting-started-detail-container'));
				categoryElements.forEach(element => detailContainer.appendChild(element));
				this.registerDispatchListeners(container);
			}
		});
	}

	private clearDetialView() {
		const detailContainer = assertIsDefined(document.getElementById('getting-started-detail-container'));
		while (detailContainer.firstChild) { detailContainer.removeChild(detailContainer.firstChild); }
		const detailTitle = assertIsDefined(document.getElementById('getting-started-detail-title'));
		while (detailTitle.firstChild) { detailTitle.removeChild(detailTitle.firstChild); }
	}

	private getKeybindingLabel(command: string) {
		const binding = this.keybindingService.lookupKeybinding(command);
		if (!binding) { return ''; }
		else { return ` (${binding.getLabel()})`; }
	}

	private async scrollPrev(container: HTMLElement) {
		this.inProgressScroll = this.inProgressScroll.then(async () => {
			this.currentCategory = undefined;
			const slides = [...container.querySelectorAll('.gettingStartedSlide').values()];
			const currentSlide = slides.findIndex(element =>
				!element.classList.contains('prev') && !element.classList.contains('next'));
			if (currentSlide > 0) {
				slides[currentSlide].classList.add('next');
				assertIsDefined(slides[currentSlide - 1]).classList.remove('prev');
			}
		});
	}
}

export class GettingStartedInputFactory implements IEditorInputFactory {

	static readonly ID = gettingStartedInputTypeId;

	public canSerialize(editorInput: EditorInput): boolean {
		return true;
	}

	public serialize(editorInput: EditorInput): string {
		return '{}';
	}

	public deserialize(instantiationService: IInstantiationService, serializedEditorInput: string): WalkThroughInput {
		return instantiationService.createInstance(GettingStartedPage).editorInput;
	}
}

registerThemingParticipant((theme, collector) => {
	const backgroundColor = theme.getColor(welcomePageBackground);
	if (backgroundColor) {
		collector.addRule(`.monaco-workbench .part.editor > .content .welcomePageContainer { background-color: ${backgroundColor}; }`);
	}
	const foregroundColor = theme.getColor(foreground);
	if (foregroundColor) {
		collector.addRule(`.monaco-workbench .part.editor > .content .walkThroughContent .gettingStartedContainer { color: ${foregroundColor}; }`);
	}
	const descriptionColor = theme.getColor(descriptionForeground);
	if (descriptionColor) {
		collector.addRule(`.monaco-workbench .part.editor > .content .walkThroughContent .gettingStartedContainer .detail { color: ${descriptionColor}; }`);
	}
	const buttonColor = getExtraColor(theme, welcomeButtonBackground, { dark: 'rgba(0, 0, 0, .2)', extra_dark: 'rgba(200, 235, 255, .042)', light: 'rgba(0,0,0,.04)', hc: 'black' });
	if (buttonColor) {
		collector.addRule(`.monaco-workbench .part.editor > .content .walkThroughContent .gettingStartedContainer button { background: ${buttonColor}; }`);
	}

	const buttonHoverColor = getExtraColor(theme, welcomeButtonHoverBackground, { dark: 'rgba(200, 235, 255, .072)', extra_dark: 'rgba(200, 235, 255, .072)', light: 'rgba(0,0,0,.10)', hc: null });
	if (buttonHoverColor) {
		collector.addRule(`.monaco-workbench .part.editor > .content .walkThroughContent .gettingStartedContainer button:hover { background: ${buttonHoverColor}; }`);
	}

	const emphasisButtonForeground = theme.getColor(buttonForeground);
	if (emphasisButtonForeground) {
		collector.addRule(`.monaco-workbench .part.editor > .content .walkThroughContent .gettingStartedContainer button.emphasis { color: ${emphasisButtonForeground}; }`);
	}

	const emphasisButtonBackground = theme.getColor(buttonBackground);
	if (emphasisButtonBackground) {
		collector.addRule(`.monaco-workbench .part.editor > .content .walkThroughContent .gettingStartedContainer button.emphasis { background: ${emphasisButtonBackground}; }`);
		collector.addRule(`.monaco-workbench .part.editor > .content .walkThroughContent .gettingStartedContainer .getting-started-category .codicon { color: ${emphasisButtonBackground} }`);
		collector.addRule(`.monaco-workbench .part.editor > .content .walkThroughContent .gettingStartedContainer .gettingStartedSlide.detail .getting-started-task .codicon-pass { color: ${emphasisButtonBackground} } `);
	}

	const emphasisButtonHoverBackground = theme.getColor(buttonHoverBackground);
	if (emphasisButtonHoverBackground) {
		collector.addRule(`.monaco-workbench .part.editor > .content .walkThroughContent .gettingStartedContainer button.emphasis:hover { background: ${emphasisButtonHoverBackground}; }`);
	}

	const link = theme.getColor(textLinkForeground);
	if (link) {
		collector.addRule(`.monaco-workbench .part.editor > .content .walkThroughContent .gettingStartedContainer a { color: ${link}; }`);
	}
	const activeLink = theme.getColor(textLinkActiveForeground);
	if (activeLink) {
		collector.addRule(`.monaco-workbench .part.editor > .content .walkThroughContent .gettingStartedContainer a:hover,
			.monaco-workbench .part.editor > .content .walkThroughContent .gettingStartedContainer a:active { color: ${activeLink}; }`);
	}
	const focusColor = theme.getColor(focusBorder);
	if (focusColor) {
		collector.addRule(`.monaco-workbench .part.editor > .content .walkThroughContent .gettingStartedContainer a:focus { outline-color: ${focusColor}; }`);
	}
	const border = theme.getColor(contrastBorder);
	if (border) {
		collector.addRule(`.monaco-workbench .part.editor > .content .walkThroughContent .gettingStartedContainer button { border-color: ${border}; border: 1px solid; }`);
	}
	const activeBorder = theme.getColor(activeContrastBorder);
	if (activeBorder) {
		collector.addRule(`.monaco-workbench .part.editor > .content .walkThroughContent .gettingStartedContainer button:hover { outline-color: ${activeBorder}; }`);
	}
});
