/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Command } from 'vs/editor/common/modes';
import { ISequence } from 'vs/base/common/sequence';
import { IAction } from 'vs/base/common/actions';
import { IMenu } from 'vs/platform/actions/common/actions';

export const VIEWLET_ID = 'workbench.view.scm';
export const VIEW_PANE_ID = 'workbench.scm';
export const REPOSITORIES_VIEW_PANE_ID = 'workbench.scm.repositories';

export interface IBaselineResourceProvider {
	getBaselineResource(resource: URI): Promise<URI>;
}

export const ISCMService = createDecorator<ISCMService>('scm');

export interface ISCMResourceDecorations {
	icon?: URI;
	iconDark?: URI;
	tooltip?: string;
	strikeThrough?: boolean;
	faded?: boolean;
}

export interface ISCMResource {
	readonly resourceGroup: ISCMResourceGroup;
	readonly sourceUri: URI;
	readonly decorations: ISCMResourceDecorations;
	readonly contextValue?: string;
	open(preserveFocus: boolean): Promise<void>;
}

export interface ISCMResourceGroup extends ISequence<ISCMResource> {
	readonly provider: ISCMProvider;
	readonly label: string;
	readonly id: string;
	readonly hideWhenEmpty: boolean;
	readonly onDidChange: Event<void>;
}

export interface ISCMProvider extends IDisposable {
	readonly label: string;
	readonly id: string;
	readonly contextValue: string;

	readonly groups: ISequence<ISCMResourceGroup>;

	// TODO@Joao: remove
	readonly onDidChangeResources: Event<void>;

	readonly rootUri?: URI;
	readonly count?: number;
	readonly commitTemplate: string;
	readonly visibleName: string;
	readonly onDidChangeCommitTemplate: Event<string>;
	readonly onDidChangeVisibleName: Event<string>;
	readonly onDidChangeStatusBarCommands?: Event<Command[]>;
	readonly acceptInputCommand?: Command;
	readonly statusBarCommands?: Command[];
	readonly onDidChange: Event<void>;

	getOriginalResource(uri: URI): Promise<URI | null>;
}

export const enum InputValidationType {
	Error = 0,
	Warning = 1,
	Information = 2
}

export interface IInputValidation {
	message: string;
	type: InputValidationType;
}

export interface IInputValidator {
	(value: string, cursorPosition: number): Promise<IInputValidation | undefined>;
}

export interface ISCMInput {
	readonly repository: ISCMRepository;

	value: string;
	readonly onDidChange: Event<string>;

	placeholder: string;
	readonly onDidChangePlaceholder: Event<string>;

	validateInput: IInputValidator;
	readonly onDidChangeValidateInput: Event<void>;

	visible: boolean;
	readonly onDidChangeVisibility: Event<boolean>;
}

export interface ISCMRepository extends IDisposable {
	readonly selected: boolean;
	readonly onDidChangeSelection: Event<boolean>;
	readonly provider: ISCMProvider;
	readonly input: ISCMInput;
	setSelected(selected: boolean): void;
}

export interface ISCMService {

	readonly _serviceBrand: undefined;
	readonly onDidAddRepository: Event<ISCMRepository>;
	readonly onDidRemoveRepository: Event<ISCMRepository>;
	readonly repositories: ISCMRepository[];

	registerSCMProvider(provider: ISCMProvider): ISCMRepository;
}

export interface ISCMTitleMenu {
	readonly actions: IAction[];
	readonly secondaryActions: IAction[];
	readonly onDidChangeTitle: Event<void>;
	readonly menu: IMenu;
}

export interface ISCMRepositoryMenus {
	readonly titleMenu: ISCMTitleMenu;
	readonly repositoryMenu: IMenu;
	getResourceGroupMenu(group: ISCMResourceGroup): IMenu;
	getResourceMenu(resource: ISCMResource): IMenu;
	getResourceFolderMenu(group: ISCMResourceGroup): IMenu;
}

export interface ISCMMenus {
	readonly titleMenu: ISCMTitleMenu;
	getRepositoryMenus(provider: ISCMProvider): ISCMRepositoryMenus;
}

export const ISCMViewService = createDecorator<ISCMViewService>('scmView');

export interface ISCMViewVisibleRepositoryChangeEvent {
	readonly added: Iterable<ISCMRepository>;
	readonly removed: Iterable<ISCMRepository>;
}

export interface ISCMViewService {
	readonly _serviceBrand: undefined;

	readonly menus: ISCMMenus;

	visibleRepositories: ISCMRepository[];
	readonly onDidChangeVisibleRepositories: Event<ISCMViewVisibleRepositoryChangeEvent>;

	isVisible(repository: ISCMRepository): boolean;
	toggleVisibility(repository: ISCMRepository, visible?: boolean): void;
}
