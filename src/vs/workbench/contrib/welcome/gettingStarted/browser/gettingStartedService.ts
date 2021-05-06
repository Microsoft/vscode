/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator, IInstantiationService, optional, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { Emitter, Event } from 'vs/base/common/event';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { Memento } from 'vs/workbench/common/memento';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { ContextKeyExpr, ContextKeyExpression, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { Disposable } from 'vs/base/common/lifecycle';
import { IUserDataAutoSyncEnablementService } from 'vs/platform/userDataSync/common/userDataSync';
import { IExtensionDescription, IStartEntry } from 'vs/platform/extensions/common/extensions';
import { URI } from 'vs/base/common/uri';
import { joinPath } from 'vs/base/common/resources';
import { FileAccess } from 'vs/base/common/network';
import { DefaultIconPath, IExtensionManagementService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IProductService } from 'vs/platform/product/common/productService';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { BuiltinGettingStartedCategory, BuiltinGettingStartedStep, BuiltinGettingStartedStartEntry, startEntries, walkthroughs } from 'vs/workbench/contrib/welcome/gettingStarted/common/gettingStartedContent';
import { ITASExperimentService } from 'vs/workbench/services/experiment/common/experimentService';
import { assertIsDefined } from 'vs/base/common/types';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IEditorService, SIDE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { GettingStartedInput } from 'vs/workbench/contrib/welcome/gettingStarted/browser/gettingStartedInput';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { GettingStartedPage } from 'vs/workbench/contrib/welcome/gettingStarted/browser/gettingStarted';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { LinkedText, parseLinkedText } from 'vs/base/common/linkedText';
import { walkthroughsExtensionPoint } from 'vs/workbench/contrib/welcome/gettingStarted/browser/gettingStartedExtensionPoint';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { dirname } from 'vs/base/common/path';

export const IGettingStartedService = createDecorator<IGettingStartedService>('gettingStartedService');

export const enum GettingStartedCategory {
	Beginner = 'Beginner',
	Intermediate = 'Intermediate',
	Advanced = 'Advanced'
}

type LegacyButtonConfig =
	| { title: string, command?: never, link: string }
	| { title: string, command: string, link?: never, sideBySide?: boolean };

export interface IGettingStartedStep {
	id: string
	title: string
	description: LinkedText[]
	category: GettingStartedCategory | string
	when: ContextKeyExpression
	order: number
	doneOn: { commandExecuted: string, eventFired?: never } | { eventFired: string, commandExecuted?: never }
	media:
	| { type: 'image', path: { hc: URI, light: URI, dark: URI }, altText: string }
	| { type: 'markdown', path: URI, base: URI, }
}

export interface IGettingStartedWalkthroughDescriptor {
	id: GettingStartedCategory | string
	title: string
	description: string
	order: number
	icon:
	| { type: 'icon', icon: ThemeIcon }
	| { type: 'image', path: string }
	when: ContextKeyExpression
	content:
	| { type: 'steps' }
}

export interface IGettingStartedStartEntryDescriptor {
	id: GettingStartedCategory | string
	title: string
	description: string
	order: number
	icon:
	| { type: 'icon', icon: ThemeIcon }
	| { type: 'image', path: string }
	when: ContextKeyExpression
	content:
	| { type: 'startEntry', command: string }
}

export interface IGettingStartedCategory {
	id: GettingStartedCategory | string
	title: string
	description: string
	order: number
	icon:
	| { type: 'icon', icon: ThemeIcon }
	| { type: 'image', path: string }
	when: ContextKeyExpression
	content:
	| { type: 'steps', steps: IGettingStartedStep[] }
	| { type: 'startEntry', command: string }
}

type StepProgress = { done?: boolean; };
export interface IGettingStartedStepWithProgress extends IGettingStartedStep, Required<StepProgress> { }

export interface IGettingStartedCategoryWithProgress extends Omit<IGettingStartedCategory, 'content'> {
	content:
	| {
		type: 'steps',
		steps: IGettingStartedStepWithProgress[],
		done: boolean;
		stepsComplete: number
		stepsTotal: number
	}
	| { type: 'startEntry', command: string }
}

export interface IGettingStartedService {
	_serviceBrand: undefined,

	readonly onDidAddCategory: Event<IGettingStartedCategoryWithProgress>
	readonly onDidRemoveCategory: Event<string>
	readonly onDidChangeStep: Event<IGettingStartedStepWithProgress>
	readonly onDidChangeCategory: Event<IGettingStartedCategoryWithProgress>

	readonly onDidProgressStep: Event<IGettingStartedStepWithProgress>

	getCategories(): IGettingStartedCategoryWithProgress[]

	progressByEvent(eventName: string): void;
	progressStep(id: string): void;
	deprogressStep(id: string): void;
}

export class GettingStartedService extends Disposable implements IGettingStartedService {
	declare readonly _serviceBrand: undefined;

	private readonly _onDidAddCategory = new Emitter<IGettingStartedCategoryWithProgress>();
	onDidAddCategory: Event<IGettingStartedCategoryWithProgress> = this._onDidAddCategory.event;

	private readonly _onDidRemoveCategory = new Emitter<string>();
	onDidRemoveCategory: Event<string> = this._onDidRemoveCategory.event;

	private readonly _onDidChangeCategory = new Emitter<IGettingStartedCategoryWithProgress>();
	onDidChangeCategory: Event<IGettingStartedCategoryWithProgress> = this._onDidChangeCategory.event;

	private readonly _onDidChangeStep = new Emitter<IGettingStartedStepWithProgress>();
	onDidChangeStep: Event<IGettingStartedStepWithProgress> = this._onDidChangeStep.event;

	private readonly _onDidProgressStep = new Emitter<IGettingStartedStepWithProgress>();
	onDidProgressStep: Event<IGettingStartedStepWithProgress> = this._onDidProgressStep.event;

	private memento: Memento;
	private stepProgress: Record<string, StepProgress>;

	private commandListeners = new Map<string, string[]>();
	private eventListeners = new Map<string, string[]>();

	private gettingStartedContributions = new Map<string, IGettingStartedCategory>();
	private steps = new Map<string, IGettingStartedStep>();

	private tasExperimentService?: ITASExperimentService;
	private sessionInstalledExtensions = new Set<string>();

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ICommandService private readonly commandService: ICommandService,
		@IContextKeyService private readonly contextService: IContextKeyService,
		@IUserDataAutoSyncEnablementService  readonly userDataAutoSyncEnablementService: IUserDataAutoSyncEnablementService,
		@IProductService private readonly productService: IProductService,
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IHostService private readonly hostService: IHostService,
		@optional(ITASExperimentService) tasExperimentService: ITASExperimentService,
	) {
		super();

		this.tasExperimentService = tasExperimentService;

		this.memento = new Memento('gettingStartedService', this.storageService);
		this.stepProgress = this.memento.getMemento(StorageScope.GLOBAL, StorageTarget.USER);

		walkthroughsExtensionPoint.setHandler((_, { added, removed }) => {
			added.forEach(e => this.registerExtensionContributions(e.description));
			removed.forEach(e => this.unregisterExtensionContributions(e.description));
		});

		this._register(this.commandService.onDidExecuteCommand(command => this.progressByCommand(command.commandId)));

		this._register(this.extensionManagementService.onDidInstallExtension(async e => {
			if (await this.hostService.hadLastFocus()) {
				this.sessionInstalledExtensions.add(e.identifier.id);
			}
		}));

		if (userDataAutoSyncEnablementService.isEnabled()) { this.progressByEvent('sync-enabled'); }
		this._register(userDataAutoSyncEnablementService.onDidChangeEnablement(() => {
			if (userDataAutoSyncEnablementService.isEnabled()) { this.progressByEvent('sync-enabled'); }
		}));

		startEntries.forEach(async (entry, index) => {
			this.getCategoryOverrides(entry);
			this.registerStartEntry({
				...entry,
				icon: { type: 'icon', icon: entry.icon },
				order: index,
				when: ContextKeyExpr.deserialize(entry.when) ?? ContextKeyExpr.true()
			});
		});

		walkthroughs.forEach(async (category, index) => {
			this.getCategoryOverrides(category);
			this.registerWalkthrough({
				...category,
				icon: { type: 'icon', icon: category.icon },
				order: index,
				when: ContextKeyExpr.deserialize(category.when) ?? ContextKeyExpr.true()
			},
				category.content.steps.map((step, index) => {
					this.getStepOverrides(step, category.id);
					return ({
						...step,
						description: parseDescription(step.description),
						category: category.id,
						order: index,
						when: ContextKeyExpr.deserialize(step.when) ?? ContextKeyExpr.true(),
						media: step.media.type === 'image'
							? { type: 'image', altText: step.media.altText, path: convertInternalMediaPathsToBrowserURIs(step.media.path) }
							: { type: 'markdown', path: convertInternalMediaPathToFileURI(step.media.path), base: FileAccess.asFileUri('vs/workbench/contrib/welcome/gettingStarted/common/media/', require) },
					});
				}));
		});
	}

	private async getCategoryOverrides(category: BuiltinGettingStartedCategory | BuiltinGettingStartedStartEntry) {
		if (!this.tasExperimentService) { return; }

		const [title, description] = await Promise.all([
			this.tasExperimentService.getTreatment<string>(`gettingStarted.overrideCategory.${category.id}.title`),
			this.tasExperimentService.getTreatment<string>(`gettingStarted.overrideCategory.${category.id}.description`),
		]);

		if (!(title || description)) { return; }

		const existing = assertIsDefined(this.gettingStartedContributions.get(category.id));
		existing.title = title ?? existing.title;
		existing.description = description ?? existing.description;
		this._onDidChangeCategory.fire(this.getCategoryProgress(existing));
	}

	private async getStepOverrides(step: BuiltinGettingStartedStep, categoryId: string) {
		if (!this.tasExperimentService) { return; }

		const [title, description, media] = await Promise.all([
			this.tasExperimentService.getTreatment<string>(`gettingStarted.overrideStep.${step.id}.title`),
			this.tasExperimentService.getTreatment<string>(`gettingStarted.overrideStep.${step.id}.description`),
			this.tasExperimentService.getTreatment<string>(`gettingStarted.overrideStep.${step.id}.media`),
		]);

		if (!(title || description || media)) { return; }

		const existingCategory = assertIsDefined(this.gettingStartedContributions.get(categoryId));
		if (existingCategory.content.type === 'startEntry') { throw Error('Unexpected content type'); }
		const existingStep = assertIsDefined(existingCategory.content.steps.find(_step => _step.id === step.id));

		existingStep.title = title ?? existingStep.title;
		existingStep.description = description ? parseDescription(description) : existingStep.description;
		existingStep.media.path = media ? convertInternalMediaPathsToBrowserURIs(media) : existingStep.media.path;
		this._onDidChangeStep.fire(this.getStepProgress(existingStep));
	}

	private registerExtensionContributions(extension: IExtensionDescription) {
		const convertExtensionPathToFileURI = (path: string) => path.startsWith('https://')
			? URI.parse(path, true)
			: FileAccess.asFileUri(joinPath(extension.extensionLocation, path));

		const convertExtensionRelativePathsToBrowserURIs = (path: string | { hc: string, dark: string, light: string }): { hc: URI, dark: URI, light: URI } => {
			const convertPath = (path: string) => path.startsWith('https://')
				? URI.parse(path, true)
				: FileAccess.asBrowserUri(joinPath(extension.extensionLocation, path));

			if (typeof path === 'string') {
				const converted = convertPath(path);
				return { hc: converted, dark: converted, light: converted };
			} else {
				return {
					hc: convertPath(path.hc),
					light: convertPath(path.light),
					dark: convertPath(path.dark)
				};
			}
		};

		let sectionToOpen: string | undefined;

		if (!(extension.contributes?.walkthroughs?.length)) {
			return;
		}

		if (this.productService.quality === 'stable') {
			console.warn('Extension', extension.identifier.value, 'contributes welcome page content but this is a Stable build and extension contributions are only available in Insiders. The contributed content will be disregarded.');
			return;
		}

		if (!this.configurationService.getValue<string>('workbench.welcomePage.experimental.extensionContributions')) {
			console.warn('Extension', extension.identifier.value, 'contributes welcome page content but the welcome page extension contribution feature flag has not been set. Set `workbench.welcomePage.experimental.extensionContributions` to begin using this experimental feature.');
			return;
		}

		extension.contributes.startEntries?.forEach(entry => {
			const entryID = extension.identifier.value + '#startEntry#' + idForStartEntry(entry);
			this.registerStartEntry({
				content: {
					type: 'startEntry',
					command: entry.command,
				},
				description: entry.description,
				title: entry.title,
				id: entryID,
				order: 0,
				when: ContextKeyExpr.deserialize(entry.when) ?? ContextKeyExpr.true(),
				icon: {
					type: 'image',
					path: extension.icon
						? FileAccess.asBrowserUri(joinPath(extension.extensionLocation, extension.icon)).toString(true)
						: DefaultIconPath
				}
			});
		});


		extension.contributes?.walkthroughs?.forEach(walkthrough => {
			const categoryID = extension.identifier.value + '#walkthrough#' + walkthrough.id;
			if (
				this.sessionInstalledExtensions.has(extension.identifier.value)
				&& walkthrough.primary
				&& this.contextService.contextMatchesRules(ContextKeyExpr.deserialize(walkthrough.when) ?? ContextKeyExpr.true())
			) {
				this.sessionInstalledExtensions.delete(extension.identifier.value);
				sectionToOpen = categoryID;
			}
			this.registerWalkthrough({
				content: { type: 'steps' },
				description: walkthrough.description,
				title: walkthrough.title,
				id: categoryID,
				order: Math.min(),
				icon: {
					type: 'image',
					path: extension.icon
						? FileAccess.asBrowserUri(joinPath(extension.extensionLocation, extension.icon)).toString(true)
						: DefaultIconPath
				},
				when: ContextKeyExpr.deserialize(walkthrough.when) ?? ContextKeyExpr.true(),
			},
				(walkthrough.steps ?? (walkthrough as any).tasks).map((step, index) => {
					const description = parseDescription(step.description);
					const buttonDescription = (step as any as { button: LegacyButtonConfig }).button;
					if (buttonDescription) {
						description.push({ nodes: [{ href: buttonDescription.link ?? `command:${buttonDescription.command}`, label: buttonDescription.title }] });
					}
					const fullyQualifiedID = extension.identifier.value + '#' + walkthrough.id + '#' + step.id;

					let media: IGettingStartedStep['media'];
					if (typeof step.media.path === 'string' && step.media.path.endsWith('.md')) {
						media = {
							type: 'markdown',
							path: convertExtensionPathToFileURI(step.media.path),
							base: convertExtensionPathToFileURI(dirname(step.media.path))
						};
					} else {
						const altText = (step.media as any).altText;
						if (!altText) {
							console.error('Getting Started: item', fullyQualifiedID, 'is missing altText for its media element.');
						}
						media = { type: 'image', altText, path: convertExtensionRelativePathsToBrowserURIs(step.media.path) };
					}

					return ({
						description, media,
						doneOn: step.doneOn?.command
							? { commandExecuted: step.doneOn.command }
							: { eventFired: 'markDone:' + fullyQualifiedID },
						id: fullyQualifiedID,
						title: step.title,
						when: ContextKeyExpr.deserialize(step.when) ?? ContextKeyExpr.true(),
						category: categoryID,
						order: index,
					});
				}));
		});

		if (sectionToOpen) {
			for (const group of this.editorGroupsService.groups) {
				if (group.activeEditor instanceof GettingStartedInput) {
					(group.activeEditorPane as GettingStartedPage).makeCategoryVisibleWhenAvailable(sectionToOpen);
					return;
				}
			}

			if (this.configurationService.getValue<string>('workbench.welcomePage.experimental.extensionContributions') === 'openToSide') {
				this.editorService.openEditor(this.instantiationService.createInstance(GettingStartedInput, { selectedCategory: sectionToOpen }), {}, SIDE_GROUP);
			} else if (this.configurationService.getValue<string>('workbench.welcomePage.experimental.extensionContributions') === 'open') {
				this.editorService.openEditor(this.instantiationService.createInstance(GettingStartedInput, { selectedCategory: sectionToOpen }), {});
			} else if (this.configurationService.getValue<string>('workbench.welcomePage.experimental.extensionContributions') === 'openInBackground') {
				this.editorService.openEditor(this.instantiationService.createInstance(GettingStartedInput, { selectedCategory: sectionToOpen }), { inactive: true });
			}
		}
	}

	private unregisterExtensionContributions(extension: IExtensionDescription) {
		if (!(extension.contributes?.walkthroughs?.length)) {
			return;
		}

		extension.contributes?.startEntries?.forEach(section => {
			const categoryID = extension.identifier.value + '#startEntry#' + idForStartEntry(section);
			this.gettingStartedContributions.delete(categoryID);
			this._onDidRemoveCategory.fire(categoryID);
		});

		extension.contributes?.walkthroughs?.forEach(section => {
			const categoryID = extension.identifier.value + '#walkthrough#' + section.id;
			section.steps.forEach(step => {
				const fullyQualifiedID = extension.identifier.value + '#' + section.id + '#' + step.id;
				this.steps.delete(fullyQualifiedID);
			});
			this.gettingStartedContributions.delete(categoryID);
			this._onDidRemoveCategory.fire(categoryID);
		});
	}

	private registerDoneListeners(step: IGettingStartedStep) {
		if (step.doneOn.commandExecuted) {
			const existing = this.commandListeners.get(step.doneOn.commandExecuted);
			if (existing) { existing.push(step.id); }
			else {
				this.commandListeners.set(step.doneOn.commandExecuted, [step.id]);
			}
		}
		if (step.doneOn.eventFired) {
			const existing = this.eventListeners.get(step.doneOn.eventFired);
			if (existing) { existing.push(step.id); }
			else {
				this.eventListeners.set(step.doneOn.eventFired, [step.id]);
			}
		}
	}

	getCategories(): IGettingStartedCategoryWithProgress[] {
		const registeredCategories = [...this.gettingStartedContributions.values()];
		const categoriesWithCompletion = registeredCategories
			.sort((a, b) => a.order - b.order)
			.filter(category => this.contextService.contextMatchesRules(category.when))
			.map(category => {
				if (category.content.type === 'steps') {
					return {
						...category,
						content: {
							type: 'steps' as const,
							steps: category.content.steps.filter(step => this.contextService.contextMatchesRules(step.when))
						}
					};
				}
				return category;
			})
			.filter(category => category.content.type !== 'steps' || category.content.steps.length)
			.map(category => this.getCategoryProgress(category));
		return categoriesWithCompletion;
	}

	private getCategoryProgress(category: IGettingStartedCategory): IGettingStartedCategoryWithProgress {
		if (category.content.type === 'startEntry') {
			return { ...category, content: category.content };
		}

		const stepsWithProgress = category.content.steps.map(step => this.getStepProgress(step));
		const stepsComplete = stepsWithProgress.filter(step => step.done);

		return {
			...category,
			content: {
				type: 'steps',
				steps: stepsWithProgress,
				stepsComplete: stepsComplete.length,
				stepsTotal: stepsWithProgress.length,
				done: stepsComplete.length === stepsWithProgress.length,
			}
		};
	}

	private getStepProgress(step: IGettingStartedStep): IGettingStartedStepWithProgress {
		return {
			...step,
			done: false,
			...this.stepProgress[step.id]
		};
	}

	progressStep(id: string) {
		const oldProgress = this.stepProgress[id];
		if (!oldProgress || oldProgress.done !== true) {
			this.stepProgress[id] = { done: true };
			this.memento.saveMemento();
			const step = this.getStep(id);
			this._onDidProgressStep.fire(this.getStepProgress(step));
		}
	}

	deprogressStep(id: string) {
		delete this.stepProgress[id];
		this.memento.saveMemento();
		const step = this.getStep(id);
		this._onDidProgressStep.fire(this.getStepProgress(step));
	}

	private progressByCommand(command: string) {
		const listening = this.commandListeners.get(command) ?? [];
		listening.forEach(id => this.progressStep(id));
	}

	progressByEvent(event: string): void {
		const listening = this.eventListeners.get(event) ?? [];
		listening.forEach(id => this.progressStep(id));
	}

	private registerStartEntry(categoryDescriptor: IGettingStartedStartEntryDescriptor): void {
		const oldCategory = this.gettingStartedContributions.get(categoryDescriptor.id);
		if (oldCategory) {
			console.error(`Skipping attempt to overwrite getting started category. (${categoryDescriptor})`);
			return;
		}

		const category: IGettingStartedCategory = { ...categoryDescriptor };

		this.gettingStartedContributions.set(categoryDescriptor.id, category);
		this._onDidAddCategory.fire(this.getCategoryProgress(category));
	}

	private registerWalkthrough(categoryDescriptor: IGettingStartedWalkthroughDescriptor, steps: IGettingStartedStep[]): void {
		const oldCategory = this.gettingStartedContributions.get(categoryDescriptor.id);
		if (oldCategory) {
			console.error(`Skipping attempt to overwrite getting started category. (${categoryDescriptor.id})`);
			return;
		}

		const category: IGettingStartedCategory = { ...categoryDescriptor, content: { type: 'steps', steps } };
		this.gettingStartedContributions.set(categoryDescriptor.id, category);
		steps.forEach(step => {
			if (this.steps.has(step.id)) { throw Error('Attempting to register step with id ' + step.id + ' twice. Second is dropped.'); }
			this.steps.set(step.id, step);
			this.registerDoneListeners(step);
		});
		this._onDidAddCategory.fire(this.getCategoryProgress(category));
	}

	private getStep(id: string): IGettingStartedStep {
		const step = this.steps.get(id);
		if (!step) { throw Error('Attempting to access step which does not exist in registry ' + id); }
		return step;
	}
}

const idForStartEntry = (entry: IStartEntry): string => `${entry.title}#${entry.command}`;

const parseDescription = (desc: string): LinkedText[] => desc.split('\n').filter(x => x).map(text => parseLinkedText(text));


const convertInternalMediaPathToFileURI = (path: string) => path.startsWith('https://')
	? URI.parse(path, true)
	: FileAccess.asFileUri('vs/workbench/contrib/welcome/gettingStarted/common/media/' + path, require);

const convertInternalMediaPathsToBrowserURIs = (path: string | { hc: string, dark: string, light: string }): { hc: URI, dark: URI, light: URI } => {
	const convertInternalMediaPathToBrowserURI = (path: string) => path.startsWith('https://')
		? URI.parse(path, true)
		: FileAccess.asBrowserUri('vs/workbench/contrib/welcome/gettingStarted/common/media/' + path, require);
	if (typeof path === 'string') {
		const converted = convertInternalMediaPathToBrowserURI(path);
		return { hc: converted, dark: converted, light: converted };
	} else {
		return {
			hc: convertInternalMediaPathToBrowserURI(path.hc),
			light: convertInternalMediaPathToBrowserURI(path.light),
			dark: convertInternalMediaPathToBrowserURI(path.dark)
		};
	}
};

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'resetGettingStartedProgress',
			category: 'Getting Started',
			title: 'Reset Progress',
			f1: true
		});
	}

	run(accessor: ServicesAccessor) {
		const gettingStartedService = accessor.get(IGettingStartedService);
		const memento = new Memento('gettingStartedService', accessor.get(IStorageService));
		const record = memento.getMemento(StorageScope.GLOBAL, StorageTarget.USER);
		for (const key in record) {
			if (Object.prototype.hasOwnProperty.call(record, key)) {
				try {
					gettingStartedService.deprogressStep(key);
				} catch (e) {
					console.error(e);
				}
			}
		}
		memento.saveMemento();
	}
});

registerSingleton(IGettingStartedService, GettingStartedService);
