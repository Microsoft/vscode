/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { URI } from 'vs/base/common/uri';
import { IDisposable } from 'vs/base/common/lifecycle';

export const IUndoRedoService = createDecorator<IUndoRedoService>('undoRedoService');

export const enum UndoRedoElementType {
	Resource,
	Workspace
}

export interface IResourceUndoRedoElement {
	readonly type: UndoRedoElementType.Resource;
	readonly resource: URI;
	readonly label: string;
	undo(): Promise<void> | void;
	redo(): Promise<void> | void;
}

export interface IWorkspaceUndoRedoElement {
	readonly type: UndoRedoElementType.Workspace;
	readonly resources: readonly URI[];
	readonly label: string;
	undo(): Promise<void> | void;
	redo(): Promise<void> | void;

	/**
	 * If implemented, indicates that this undo/redo element can be split into multiple per resource elements.
	 */
	split?(): IResourceUndoRedoElement[];

	/**
	 * If implemented, will be invoked before calling `undo()` or `redo()`.
	 * This is a good place to prepare everything such that the calls to `undo()` or `redo()` are synchronous.
	 * If a disposable is returned, it will be invoked to clean things up.
	 */
	prepareUndoRedo?(): Promise<IDisposable> | IDisposable | void;
}

export type IUndoRedoElement = IResourceUndoRedoElement | IWorkspaceUndoRedoElement;

export interface IPastFutureElements {
	past: IUndoRedoElement[];
	future: IUndoRedoElement[];
}

export interface UriComparisonKeyComputer {
	getComparisonKey(uri: URI): string;
}

export class ResourceEditStackSnapshot {
	constructor(
		public readonly resource: URI,
		public readonly elements: number[]
	) { }
}

export class UndoRedoGroup {
	private static _ID = 0;

	public readonly id: number;
	private order: number;

	constructor() {
		this.id = UndoRedoGroup._ID++;
		this.order = 1;
	}

	public nextOrder(): number {
		if (this.id === 0) {
			return 0;
		}
		return this.order++;
	}

	public static None = new UndoRedoGroup();
}

export class UndoRedoSource {
	private static _ID = 0;

	public readonly id: number;
	private order: number;

	constructor() {
		this.id = UndoRedoSource._ID++;
		this.order = 1;
	}

	public nextOrder(): number {
		if (this.id === 0) {
			return 0;
		}
		return this.order++;
	}

	public static None = new UndoRedoSource();
}

export interface IUndoRedoService {
	readonly _serviceBrand: undefined;

	/**
	 * Register an URI -> string hasher.
	 * This is useful for making multiple URIs share the same undo-redo stack.
	 */
	registerUriComparisonKeyComputer(scheme: string, uriComparisonKeyComputer: UriComparisonKeyComputer): IDisposable;

	/**
	 * Get the hash used internally for a certain URI.
	 * This uses any registered `UriComparisonKeyComputer`.
	 */
	getUriComparisonKey(resource: URI): string;

	/**
	 * Add a new element to the `undo` stack.
	 * This will destroy the `redo` stack.
	 */
	pushElement(element: IUndoRedoElement, group?: UndoRedoGroup, source?: UndoRedoSource): void;

	/**
	 * Get the last pushed element for a resource.
	 * If the last pushed element has been undone, returns null.
	 */
	getLastElement(resource: URI): IUndoRedoElement | null;

	/**
	 * Get all the elements associated with a resource.
	 * This includes the past and the future.
	 */
	getElements(resource: URI): IPastFutureElements;

	/**
	 * Validate or invalidate stack elements associated with a resource.
	 */
	setElementsValidFlag(resource: URI, isValid: boolean, filter: (element: IUndoRedoElement) => boolean): void;

	/**
	 * Remove elements that target `resource`.
	 */
	removeElements(resource: URI): void;

	/**
	 * Create a snapshot of the current elements on the undo-redo stack for a resource.
	 */
	createSnapshot(resource: URI): ResourceEditStackSnapshot;
	/**
	 * Attempt (as best as possible) to restore a certain snapshot previously created with `createSnapshot` for a resource.
	 */
	restoreSnapshot(snapshot: ResourceEditStackSnapshot): void;

	canUndo(resource: URI | UndoRedoSource): boolean;
	undo(resource: URI | UndoRedoSource): Promise<void> | void;

	canRedo(resource: URI | UndoRedoSource): boolean;
	redo(resource: URI | UndoRedoSource): Promise<void> | void;
}
