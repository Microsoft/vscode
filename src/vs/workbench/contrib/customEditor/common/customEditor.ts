/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { distinct, mergeSort } from 'vs/base/common/arrays';
import { Event } from 'vs/base/common/event';
import * as glob from 'vs/base/common/glob';
import { IDisposable, IReference } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { posix } from 'vs/base/common/path';
import { basename } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { GroupIdentifier, IEditorInput, IEditorPane, IRevertOptions, ISaveOptions } from 'vs/workbench/common/editor';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';

export const ICustomEditorService = createDecorator<ICustomEditorService>('customEditorService');

export const CONTEXT_CUSTOM_EDITORS = new RawContextKey<string>('customEditors', '');
export const CONTEXT_FOCUSED_CUSTOM_EDITOR_IS_EDITABLE = new RawContextKey<boolean>('focusedCustomEditorIsEditable', false);

export interface CustomEditorCapabilities {
	readonly supportsMultipleEditorsPerDocument?: boolean;
}

export interface ICustomEditorService {
	_serviceBrand: any;

	readonly models: ICustomEditorModelManager;

	getCustomEditor(viewType: string): CustomEditorInfo | undefined;
	getAllCustomEditors(resource: URI): CustomEditorInfoCollection;
	getContributedCustomEditors(resource: URI): CustomEditorInfoCollection;
	getUserConfiguredCustomEditors(resource: URI): CustomEditorInfoCollection;

	createInput(resource: URI, viewType: string, group: GroupIdentifier | undefined, options?: { readonly customClasses: string }): IEditorInput;

	openWith(resource: URI, customEditorViewType: string, options?: ITextEditorOptions, group?: IEditorGroup): Promise<IEditorPane | undefined>;
	promptOpenWith(resource: URI, options?: ITextEditorOptions, group?: IEditorGroup): Promise<IEditorPane | undefined>;

	registerCustomEditorCapabilities(viewType: string, options: CustomEditorCapabilities): IDisposable;
}

export interface ICustomEditorModelManager {
	get(resource: URI, viewType: string): Promise<ICustomEditorModel | undefined>;

	tryRetain(resource: URI, viewType: string): Promise<IReference<ICustomEditorModel>> | undefined;

	add(resource: URI, viewType: string, model: Promise<ICustomEditorModel>): Promise<IReference<ICustomEditorModel>>;

	disposeAllModelsForView(viewType: string): void;
}

export interface ICustomEditorModel extends IDisposable {
	readonly viewType: string;
	readonly resource: URI;
	readonly backupId: string | undefined;

	isReadonly(): boolean;

	isDirty(): boolean;
	readonly onDidChangeDirty: Event<void>;

	revert(options?: IRevertOptions): Promise<void>;

	saveCustomEditor(options?: ISaveOptions): Promise<URI | undefined>;
	saveCustomEditorAs(resource: URI, targetResource: URI, currentOptions?: ISaveOptions): Promise<boolean>;
}

export const enum CustomEditorPriority {
	default = 'default',
	builtin = 'builtin',
	option = 'option',
}

export interface CustomEditorSelector {
	readonly filenamePattern?: string;
}

export interface CustomEditorDescriptor {
	readonly id: string;
	readonly displayName: string;
	readonly providerDisplayName: string;
	readonly priority: CustomEditorPriority;
	readonly selector: readonly CustomEditorSelector[];
}

export class CustomEditorInfo implements CustomEditorDescriptor {

	private static readonly excludedSchemes = new Set([
		Schemas.extension,
		Schemas.webviewPanel,
	]);

	public readonly id: string;
	public readonly displayName: string;
	public readonly providerDisplayName: string;
	public readonly priority: CustomEditorPriority;
	public readonly selector: readonly CustomEditorSelector[];

	constructor(descriptor: CustomEditorDescriptor) {
		this.id = descriptor.id;
		this.displayName = descriptor.displayName;
		this.providerDisplayName = descriptor.providerDisplayName;
		this.priority = descriptor.priority;
		this.selector = descriptor.selector;
	}

	matches(resource: URI): boolean {
		return this.selector.some(selector => CustomEditorInfo.selectorMatches(selector, resource));
	}

	static selectorMatches(selector: CustomEditorSelector, resource: URI): boolean {
		if (CustomEditorInfo.excludedSchemes.has(resource.scheme)) {
			return false;
		}

		if (selector.filenamePattern) {
			const matchOnPath = selector.filenamePattern.indexOf(posix.sep) >= 0;
			const target = matchOnPath ? resource.path : basename(resource);
			if (glob.match(selector.filenamePattern.toLowerCase(), target.toLowerCase())) {
				return true;
			}
		}
		return false;
	}
}

export class CustomEditorInfoCollection {

	public readonly allEditors: readonly CustomEditorInfo[];

	constructor(
		editors: readonly CustomEditorInfo[],
	) {
		this.allEditors = distinct(editors, editor => editor.id);
	}

	public get length(): number { return this.allEditors.length; }

	/**
	 * Find the single default editor to use (if any) by looking at the editor's priority and the
	 * other contributed editors.
	 */
	public get defaultEditor(): CustomEditorInfo | undefined {
		return this.allEditors.find(editor => {
			switch (editor.priority) {
				case CustomEditorPriority.default:
				case CustomEditorPriority.builtin:
					// A default editor must have higher priority than all other contributed editors.
					return this.allEditors.every(otherEditor =>
						otherEditor === editor || isLowerPriority(otherEditor, editor));

				default:
					return false;
			}
		});
	}

	/**
	 * Find the best available editor to use.
	 *
	 * Unlike the `defaultEditor`, a bestAvailableEditor can exist even if there are other editors with
	 * the same priority.
	 */
	public get bestAvailableEditor(): CustomEditorInfo | undefined {
		const editors = mergeSort(Array.from(this.allEditors), (a, b) => {
			return priorityToRank(a.priority) - priorityToRank(b.priority);
		});
		return editors[0];
	}
}

function isLowerPriority(otherEditor: CustomEditorInfo, editor: CustomEditorInfo): unknown {
	return priorityToRank(otherEditor.priority) < priorityToRank(editor.priority);
}

function priorityToRank(priority: CustomEditorPriority): number {
	switch (priority) {
		case CustomEditorPriority.default: return 3;
		case CustomEditorPriority.builtin: return 2;
		case CustomEditorPriority.option: return 1;
	}
}
