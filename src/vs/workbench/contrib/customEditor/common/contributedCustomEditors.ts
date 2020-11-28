/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import * as nls from 'vs/nls';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { Memento } from 'vs/workbench/common/memento';
import { CustomEditorDescriptor, CustomEditorInfo, CustomEditorPriority } from 'vs/workbench/contrib/customEditor/common/customEditor';
import { customEditorsExtensionPoint, ICustomEditorsExtensionPoint } from 'vs/workbench/contrib/customEditor/common/extensionPoint';
import { DEFAULT_EDITOR_ID } from 'vs/workbench/services/editor/common/editorOpenWith';
import { IExtensionPointUser } from 'vs/workbench/services/extensions/common/extensionsRegistry';

const builtinProviderDisplayName = nls.localize('builtinProviderDisplayName', "Built-in");

export const defaultCustomEditor = new CustomEditorInfo({
	id: DEFAULT_EDITOR_ID,
	displayName: nls.localize('promptOpenWith.defaultEditor.displayName', "Text Editor"),
	providerDisplayName: builtinProviderDisplayName,
	selector: [
		{ filenamePattern: '*' }
	],
	priority: CustomEditorPriority.default,
});

export class ContributedCustomEditors extends Disposable {

	private static readonly CUSTOM_EDITORS_STORAGE_ID = 'customEditors';
	private static readonly CUSTOM_EDITORS_ENTRY_ID = 'editors';

	private readonly _editors = new Map<string, CustomEditorInfo>();
	private readonly _memento: Memento;

	constructor(storageService: IStorageService) {
		super();

		this._memento = new Memento(ContributedCustomEditors.CUSTOM_EDITORS_STORAGE_ID, storageService);

		const mementoObject = this._memento.getMemento(StorageScope.GLOBAL, StorageTarget.MACHINE);
		for (const info of (mementoObject[ContributedCustomEditors.CUSTOM_EDITORS_ENTRY_ID] || []) as CustomEditorDescriptor[]) {
			this.add(new CustomEditorInfo(info));
		}

		customEditorsExtensionPoint.setHandler(extensions => {
			this.update(extensions);
		});
	}

	private readonly _onChange = this._register(new Emitter<void>());
	public readonly onChange = this._onChange.event;

	private update(extensions: readonly IExtensionPointUser<ICustomEditorsExtensionPoint[]>[]) {
		this._editors.clear();

		for (const extension of extensions) {
			for (const webviewEditorContribution of extension.value) {
				this.add(new CustomEditorInfo({
					id: webviewEditorContribution.viewType,
					displayName: webviewEditorContribution.displayName,
					providerDisplayName: extension.description.isBuiltin ? builtinProviderDisplayName : extension.description.displayName || extension.description.identifier.value,
					selector: webviewEditorContribution.selector || [],
					priority: getPriorityFromContribution(webviewEditorContribution, extension.description),
				}));
			}
		}

		const mementoObject = this._memento.getMemento(StorageScope.GLOBAL, StorageTarget.MACHINE);
		mementoObject[ContributedCustomEditors.CUSTOM_EDITORS_ENTRY_ID] = Array.from(this._editors.values());
		this._memento.saveMemento();

		this._onChange.fire();
	}

	public [Symbol.iterator](): Iterator<CustomEditorInfo> {
		return this._editors.values();
	}

	public get(viewType: string): CustomEditorInfo | undefined {
		return viewType === defaultCustomEditor.id
			? defaultCustomEditor
			: this._editors.get(viewType);
	}

	public getContributedEditors(resource: URI): readonly CustomEditorInfo[] {
		return Array.from(this._editors.values())
			.filter(customEditor => customEditor.matches(resource));
	}

	private add(info: CustomEditorInfo): void {
		if (info.id === defaultCustomEditor.id || this._editors.has(info.id)) {
			console.error(`Custom editor with id '${info.id}' already registered`);
			return;
		}
		this._editors.set(info.id, info);
	}
}

function getPriorityFromContribution(
	contribution: ICustomEditorsExtensionPoint,
	extension: IExtensionDescription,
): CustomEditorPriority {
	switch (contribution.priority) {
		case CustomEditorPriority.default:
		case CustomEditorPriority.option:
			return contribution.priority;

		case CustomEditorPriority.builtin:
			// Builtin is only valid for builtin extensions
			return extension.isBuiltin ? CustomEditorPriority.builtin : CustomEditorPriority.default;

		default:
			return CustomEditorPriority.default;
	}
}
