/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { distinct } from 'vs/base/common/arrays';
import { Event } from 'vs/base/common/event';
import { IDisposable, IReference } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import * as nls from 'vs/nls';
import { IRevertOptions, ISaveOptions } from 'vs/workbench/common/editor';
import { ContributedEditorPriority, globMatchesResource, priorityToRank } from 'vs/workbench/services/editor/common/editorOverrideService';

export const ICustomEditorService = createDecorator<ICustomEditorService>('customEditorService');

export const CONTEXT_ACTIVE_CUSTOM_EDITOR_ID = new RawContextKey<string>('activeCustomEditorId', '', {
	type: 'string',
	description: nls.localize('context.customEditor', "The viewType of the currently active custom editor."),
});

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

	registerCustomEditorCapabilities(viewType: string, options: CustomEditorCapabilities): IDisposable;
	getCustomEditorCapabilities(viewType: string): CustomEditorCapabilities | undefined
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

	isEditable(): boolean;
	isOnReadonlyFileSystem(): boolean;

	isOrphaned(): boolean;
	readonly onDidChangeOrphaned: Event<void>;

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
	readonly priority: ContributedEditorPriority;
	readonly selector: readonly CustomEditorSelector[];
}

export class CustomEditorInfo implements CustomEditorDescriptor {

	public readonly id: string;
	public readonly displayName: string;
	public readonly providerDisplayName: string;
	public readonly priority: ContributedEditorPriority;
	public readonly selector: readonly CustomEditorSelector[];

	constructor(descriptor: CustomEditorDescriptor) {
		this.id = descriptor.id;
		this.displayName = descriptor.displayName;
		this.providerDisplayName = descriptor.providerDisplayName;
		this.priority = descriptor.priority;
		this.selector = descriptor.selector;
	}

	matches(resource: URI): boolean {
		return this.selector.some(selector => selector.filenamePattern && globMatchesResource(selector.filenamePattern, resource));
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
				case ContributedEditorPriority.default:
				case ContributedEditorPriority.builtin:
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
		const editors = Array.from(this.allEditors).sort((a, b) => {
			return priorityToRank(a.priority) - priorityToRank(b.priority);
		});
		return editors[0];
	}
}

function isLowerPriority(otherEditor: CustomEditorInfo, editor: CustomEditorInfo): unknown {
	return priorityToRank(otherEditor.priority) < priorityToRank(editor.priority);
}
