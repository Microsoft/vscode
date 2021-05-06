/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { EditorsOrder, IEditorIdentifier, IEditorInput } from 'vs/workbench/common/editor';
import { IWorkingCopy, IWorkingCopyIdentifier } from 'vs/workbench/services/workingCopy/common/workingCopy';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

export const IWorkingCopyEditorService = createDecorator<IWorkingCopyEditorService>('workingCopyEditorService');

export interface IWorkingCopyEditorHandler {

	/**
	 * Whether the handler is capable of opening the specific backup in
	 * an editor.
	 */
	handles(workingCopy: IWorkingCopyIdentifier): boolean;

	/**
	 * Whether the provided working copy is opened in the provided editor.
	 */
	isOpen(workingCopy: IWorkingCopyIdentifier, editor: IEditorInput): boolean;

	/**
	 * Create an editor that is suitable of opening the provided working copy.
	 */
	createEditor(workingCopy: IWorkingCopyIdentifier): IEditorInput;
}

export interface IWorkingCopyEditorService {

	readonly _serviceBrand: undefined;

	/**
	 * An event fired whenever a handler is registered.
	 */
	readonly onDidRegisterHandler: Event<IWorkingCopyEditorHandler>;

	/**
	 * Register a handler to the working copy editor service.
	 */
	registerHandler(handler: IWorkingCopyEditorHandler): IDisposable;

	/**
	 * Finds the first editor that can handle the provided working copy.
	 */
	findEditor(workingCopy: IWorkingCopy): IEditorIdentifier | undefined;
}

export class WorkingCopyEditorService extends Disposable implements IWorkingCopyEditorService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidRegisterHandler = this._register(new Emitter<IWorkingCopyEditorHandler>());
	readonly onDidRegisterHandler = this._onDidRegisterHandler.event;

	private readonly handlers = new Set<IWorkingCopyEditorHandler>();

	constructor(@IEditorService private readonly editorService: IEditorService) {
		super();
	}

	registerHandler(handler: IWorkingCopyEditorHandler): IDisposable {

		// Add to registry and emit as event
		this.handlers.add(handler);
		this._onDidRegisterHandler.fire(handler);

		return toDisposable(() => this.handlers.delete(handler));
	}

	findEditor(workingCopy: IWorkingCopy): IEditorIdentifier | undefined {
		for (const editorIdentifier of this.editorService.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)) {
			if (this.isOpen(workingCopy, editorIdentifier.editor)) {
				return editorIdentifier;
			}
		}

		return undefined;
	}

	private isOpen(workingCopy: IWorkingCopy, editor: IEditorInput): boolean {
		for (const handler of this.handlers) {
			if (handler.handles(workingCopy) && handler.isOpen(workingCopy, editor)) {
				return true;
			}
		}

		return false;
	}
}

// Register Service
registerSingleton(IWorkingCopyEditorService, WorkingCopyEditorService);
