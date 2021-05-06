/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IUndoRedoService, IWorkspaceUndoRedoElement, UndoRedoElementType, IUndoRedoElement, IPastFutureElements, ResourceEditStackSnapshot, UriComparisonKeyComputer, IResourceUndoRedoElement, UndoRedoGroup, UndoRedoSource } from 'vs/platform/undoRedo/common/undoRedo';
import { URI } from 'vs/base/common/uri';
import { onUnexpectedError } from 'vs/base/common/errors';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import Severity from 'vs/base/common/severity';
import { Schemas } from 'vs/base/common/network';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IDisposable, Disposable, isDisposable } from 'vs/base/common/lifecycle';

const DEBUG = false;

function getResourceLabel(resource: URI): string {
	return resource.scheme === Schemas.file ? resource.fsPath : resource.path;
}

let stackElementCounter = 0;

class ResourceStackElement {
	public readonly id = (++stackElementCounter);
	public readonly type = UndoRedoElementType.Resource;
	public readonly actual: IUndoRedoElement;
	public readonly label: string;
	public readonly confirmBeforeUndo: boolean;

	public readonly resourceLabel: string;
	public readonly strResource: string;
	public readonly resourceLabels: string[];
	public readonly strResources: string[];
	public readonly groupId: number;
	public readonly groupOrder: number;
	public readonly sourceId: number;
	public readonly sourceOrder: number;
	public isValid: boolean;

	constructor(actual: IUndoRedoElement, resourceLabel: string, strResource: string, groupId: number, groupOrder: number, sourceId: number, sourceOrder: number) {
		this.actual = actual;
		this.label = actual.label;
		this.confirmBeforeUndo = actual.confirmBeforeUndo || false;
		this.resourceLabel = resourceLabel;
		this.strResource = strResource;
		this.resourceLabels = [this.resourceLabel];
		this.strResources = [this.strResource];
		this.groupId = groupId;
		this.groupOrder = groupOrder;
		this.sourceId = sourceId;
		this.sourceOrder = sourceOrder;
		this.isValid = true;
	}

	public setValid(isValid: boolean): void {
		this.isValid = isValid;
	}

	public toString(): string {
		return `[id:${this.id}] [group:${this.groupId}] [${this.isValid ? '  VALID' : 'INVALID'}] ${this.actual.constructor.name} - ${this.actual}`;
	}
}

const enum RemovedResourceReason {
	ExternalRemoval = 0,
	NoParallelUniverses = 1
}

class ResourceReasonPair {
	constructor(
		public readonly resourceLabel: string,
		public readonly reason: RemovedResourceReason
	) { }
}

class RemovedResources {
	private readonly elements = new Map<string, ResourceReasonPair>();

	public createMessage(): string {
		const externalRemoval: string[] = [];
		const noParallelUniverses: string[] = [];
		for (const [, element] of this.elements) {
			const dest = (
				element.reason === RemovedResourceReason.ExternalRemoval
					? externalRemoval
					: noParallelUniverses
			);
			dest.push(element.resourceLabel);
		}

		let messages: string[] = [];
		if (externalRemoval.length > 0) {
			messages.push(
				nls.localize(
					{ key: 'externalRemoval', comment: ['{0} is a list of filenames'] },
					"The following files have been closed and modified on disk: {0}.", externalRemoval.join(', ')
				)
			);
		}
		if (noParallelUniverses.length > 0) {
			messages.push(
				nls.localize(
					{ key: 'noParallelUniverses', comment: ['{0} is a list of filenames'] },
					"The following files have been modified in an incompatible way: {0}.", noParallelUniverses.join(', ')
				));
		}
		return messages.join('\n');
	}

	public get size(): number {
		return this.elements.size;
	}

	public has(strResource: string): boolean {
		return this.elements.has(strResource);
	}

	public set(strResource: string, value: ResourceReasonPair): void {
		this.elements.set(strResource, value);
	}

	public delete(strResource: string): boolean {
		return this.elements.delete(strResource);
	}
}

class WorkspaceStackElement {
	public readonly id = (++stackElementCounter);
	public readonly type = UndoRedoElementType.Workspace;
	public readonly actual: IWorkspaceUndoRedoElement;
	public readonly label: string;
	public readonly confirmBeforeUndo: boolean;

	public readonly resourceLabels: string[];
	public readonly strResources: string[];
	public readonly groupId: number;
	public readonly groupOrder: number;
	public readonly sourceId: number;
	public readonly sourceOrder: number;
	public removedResources: RemovedResources | null;
	public invalidatedResources: RemovedResources | null;

	constructor(actual: IWorkspaceUndoRedoElement, resourceLabels: string[], strResources: string[], groupId: number, groupOrder: number, sourceId: number, sourceOrder: number) {
		this.actual = actual;
		this.label = actual.label;
		this.confirmBeforeUndo = actual.confirmBeforeUndo || false;
		this.resourceLabels = resourceLabels;
		this.strResources = strResources;
		this.groupId = groupId;
		this.groupOrder = groupOrder;
		this.sourceId = sourceId;
		this.sourceOrder = sourceOrder;
		this.removedResources = null;
		this.invalidatedResources = null;
	}

	public canSplit(): this is WorkspaceStackElement & { actual: { split(): IResourceUndoRedoElement[]; } } {
		return (typeof this.actual.split === 'function');
	}

	public removeResource(resourceLabel: string, strResource: string, reason: RemovedResourceReason): void {
		if (!this.removedResources) {
			this.removedResources = new RemovedResources();
		}
		if (!this.removedResources.has(strResource)) {
			this.removedResources.set(strResource, new ResourceReasonPair(resourceLabel, reason));
		}
	}

	public setValid(resourceLabel: string, strResource: string, isValid: boolean): void {
		if (isValid) {
			if (this.invalidatedResources) {
				this.invalidatedResources.delete(strResource);
				if (this.invalidatedResources.size === 0) {
					this.invalidatedResources = null;
				}
			}
		} else {
			if (!this.invalidatedResources) {
				this.invalidatedResources = new RemovedResources();
			}
			if (!this.invalidatedResources.has(strResource)) {
				this.invalidatedResources.set(strResource, new ResourceReasonPair(resourceLabel, RemovedResourceReason.ExternalRemoval));
			}
		}
	}

	public toString(): string {
		return `[id:${this.id}] [group:${this.groupId}] [${this.invalidatedResources ? 'INVALID' : '  VALID'}] ${this.actual.constructor.name} - ${this.actual}`;
	}
}

type StackElement = ResourceStackElement | WorkspaceStackElement;

class ResourceEditStack {
	public readonly resourceLabel: string;
	private readonly strResource: string;
	private _past: StackElement[];
	private _future: StackElement[];
	public locked: boolean;
	public versionId: number;

	constructor(resourceLabel: string, strResource: string) {
		this.resourceLabel = resourceLabel;
		this.strResource = strResource;
		this._past = [];
		this._future = [];
		this.locked = false;
		this.versionId = 1;
	}

	public dispose(): void {
		for (const element of this._past) {
			if (element.type === UndoRedoElementType.Workspace) {
				element.removeResource(this.resourceLabel, this.strResource, RemovedResourceReason.ExternalRemoval);
			}
		}
		for (const element of this._future) {
			if (element.type === UndoRedoElementType.Workspace) {
				element.removeResource(this.resourceLabel, this.strResource, RemovedResourceReason.ExternalRemoval);
			}
		}
		this.versionId++;
	}

	public toString(): string {
		let result: string[] = [];
		result.push(`* ${this.strResource}:`);
		for (let i = 0; i < this._past.length; i++) {
			result.push(`   * [UNDO] ${this._past[i]}`);
		}
		for (let i = this._future.length - 1; i >= 0; i--) {
			result.push(`   * [REDO] ${this._future[i]}`);
		}
		return result.join('\n');
	}

	public flushAllElements(): void {
		this._past = [];
		this._future = [];
		this.versionId++;
	}

	public setElementsIsValid(isValid: boolean): void {
		for (const element of this._past) {
			if (element.type === UndoRedoElementType.Workspace) {
				element.setValid(this.resourceLabel, this.strResource, isValid);
			} else {
				element.setValid(isValid);
			}
		}
		for (const element of this._future) {
			if (element.type === UndoRedoElementType.Workspace) {
				element.setValid(this.resourceLabel, this.strResource, isValid);
			} else {
				element.setValid(isValid);
			}
		}
	}

	private _setElementValidFlag(element: StackElement, isValid: boolean): void {
		if (element.type === UndoRedoElementType.Workspace) {
			element.setValid(this.resourceLabel, this.strResource, isValid);
		} else {
			element.setValid(isValid);
		}
	}

	public setElementsValidFlag(isValid: boolean, filter: (element: IUndoRedoElement) => boolean): void {
		for (const element of this._past) {
			if (filter(element.actual)) {
				this._setElementValidFlag(element, isValid);
			}
		}
		for (const element of this._future) {
			if (filter(element.actual)) {
				this._setElementValidFlag(element, isValid);
			}
		}
	}

	public pushElement(element: StackElement): void {
		// remove the future
		for (const futureElement of this._future) {
			if (futureElement.type === UndoRedoElementType.Workspace) {
				futureElement.removeResource(this.resourceLabel, this.strResource, RemovedResourceReason.NoParallelUniverses);
			}
		}
		this._future = [];
		this._past.push(element);
		this.versionId++;
	}

	public createSnapshot(resource: URI): ResourceEditStackSnapshot {
		const elements: number[] = [];

		for (let i = 0, len = this._past.length; i < len; i++) {
			elements.push(this._past[i].id);
		}
		for (let i = this._future.length - 1; i >= 0; i--) {
			elements.push(this._future[i].id);
		}

		return new ResourceEditStackSnapshot(resource, elements);
	}

	public restoreSnapshot(snapshot: ResourceEditStackSnapshot): void {
		const snapshotLength = snapshot.elements.length;
		let isOK = true;
		let snapshotIndex = 0;
		let removePastAfter = -1;
		for (let i = 0, len = this._past.length; i < len; i++, snapshotIndex++) {
			const element = this._past[i];
			if (isOK && (snapshotIndex >= snapshotLength || element.id !== snapshot.elements[snapshotIndex])) {
				isOK = false;
				removePastAfter = 0;
			}
			if (!isOK && element.type === UndoRedoElementType.Workspace) {
				element.removeResource(this.resourceLabel, this.strResource, RemovedResourceReason.ExternalRemoval);
			}
		}
		let removeFutureBefore = -1;
		for (let i = this._future.length - 1; i >= 0; i--, snapshotIndex++) {
			const element = this._future[i];
			if (isOK && (snapshotIndex >= snapshotLength || element.id !== snapshot.elements[snapshotIndex])) {
				isOK = false;
				removeFutureBefore = i;
			}
			if (!isOK && element.type === UndoRedoElementType.Workspace) {
				element.removeResource(this.resourceLabel, this.strResource, RemovedResourceReason.ExternalRemoval);
			}
		}
		if (removePastAfter !== -1) {
			this._past = this._past.slice(0, removePastAfter);
		}
		if (removeFutureBefore !== -1) {
			this._future = this._future.slice(removeFutureBefore + 1);
		}
		this.versionId++;
	}

	public getElements(): IPastFutureElements {
		const past: IUndoRedoElement[] = [];
		const future: IUndoRedoElement[] = [];

		for (const element of this._past) {
			past.push(element.actual);
		}
		for (const element of this._future) {
			future.push(element.actual);
		}

		return { past, future };
	}

	public getClosestPastElement(): StackElement | null {
		if (this._past.length === 0) {
			return null;
		}
		return this._past[this._past.length - 1];
	}

	public getSecondClosestPastElement(): StackElement | null {
		if (this._past.length < 2) {
			return null;
		}
		return this._past[this._past.length - 2];
	}

	public getClosestFutureElement(): StackElement | null {
		if (this._future.length === 0) {
			return null;
		}
		return this._future[this._future.length - 1];
	}

	public hasPastElements(): boolean {
		return (this._past.length > 0);
	}

	public hasFutureElements(): boolean {
		return (this._future.length > 0);
	}

	public splitPastWorkspaceElement(toRemove: WorkspaceStackElement, individualMap: Map<string, ResourceStackElement>): void {
		for (let j = this._past.length - 1; j >= 0; j--) {
			if (this._past[j] === toRemove) {
				if (individualMap.has(this.strResource)) {
					// gets replaced
					this._past[j] = individualMap.get(this.strResource)!;
				} else {
					// gets deleted
					this._past.splice(j, 1);
				}
				break;
			}
		}
		this.versionId++;
	}

	public splitFutureWorkspaceElement(toRemove: WorkspaceStackElement, individualMap: Map<string, ResourceStackElement>): void {
		for (let j = this._future.length - 1; j >= 0; j--) {
			if (this._future[j] === toRemove) {
				if (individualMap.has(this.strResource)) {
					// gets replaced
					this._future[j] = individualMap.get(this.strResource)!;
				} else {
					// gets deleted
					this._future.splice(j, 1);
				}
				break;
			}
		}
		this.versionId++;
	}

	public moveBackward(element: StackElement): void {
		this._past.pop();
		this._future.push(element);
		this.versionId++;
	}

	public moveForward(element: StackElement): void {
		this._future.pop();
		this._past.push(element);
		this.versionId++;
	}
}

class EditStackSnapshot {

	public readonly editStacks: ResourceEditStack[];
	private readonly _versionIds: number[];

	constructor(editStacks: ResourceEditStack[]) {
		this.editStacks = editStacks;
		this._versionIds = [];
		for (let i = 0, len = this.editStacks.length; i < len; i++) {
			this._versionIds[i] = this.editStacks[i].versionId;
		}
	}

	public isValid(): boolean {
		for (let i = 0, len = this.editStacks.length; i < len; i++) {
			if (this._versionIds[i] !== this.editStacks[i].versionId) {
				return false;
			}
		}
		return true;
	}
}

const missingEditStack = new ResourceEditStack('', '');
missingEditStack.locked = true;

export class UndoRedoService implements IUndoRedoService {
	declare readonly _serviceBrand: undefined;

	private readonly _editStacks: Map<string, ResourceEditStack>;
	private readonly _uriComparisonKeyComputers: [string, UriComparisonKeyComputer][];

	constructor(
		@IDialogService private readonly _dialogService: IDialogService,
		@INotificationService private readonly _notificationService: INotificationService,
	) {
		this._editStacks = new Map<string, ResourceEditStack>();
		this._uriComparisonKeyComputers = [];
	}

	public registerUriComparisonKeyComputer(scheme: string, uriComparisonKeyComputer: UriComparisonKeyComputer): IDisposable {
		this._uriComparisonKeyComputers.push([scheme, uriComparisonKeyComputer]);
		return {
			dispose: () => {
				for (let i = 0, len = this._uriComparisonKeyComputers.length; i < len; i++) {
					if (this._uriComparisonKeyComputers[i][1] === uriComparisonKeyComputer) {
						this._uriComparisonKeyComputers.splice(i, 1);
						return;
					}
				}
			}
		};
	}

	public getUriComparisonKey(resource: URI): string {
		for (const uriComparisonKeyComputer of this._uriComparisonKeyComputers) {
			if (uriComparisonKeyComputer[0] === resource.scheme) {
				return uriComparisonKeyComputer[1].getComparisonKey(resource);
			}
		}
		return resource.toString();
	}

	private _print(label: string): void {
		console.log(`------------------------------------`);
		console.log(`AFTER ${label}: `);
		let str: string[] = [];
		for (const element of this._editStacks) {
			str.push(element[1].toString());
		}
		console.log(str.join('\n'));
	}

	public pushElement(element: IUndoRedoElement, group: UndoRedoGroup = UndoRedoGroup.None, source: UndoRedoSource = UndoRedoSource.None): void {
		if (element.type === UndoRedoElementType.Resource) {
			const resourceLabel = getResourceLabel(element.resource);
			const strResource = this.getUriComparisonKey(element.resource);
			this._pushElement(new ResourceStackElement(element, resourceLabel, strResource, group.id, group.nextOrder(), source.id, source.nextOrder()));
		} else {
			const seen = new Set<string>();
			const resourceLabels: string[] = [];
			const strResources: string[] = [];
			for (const resource of element.resources) {
				const resourceLabel = getResourceLabel(resource);
				const strResource = this.getUriComparisonKey(resource);

				if (seen.has(strResource)) {
					continue;
				}
				seen.add(strResource);
				resourceLabels.push(resourceLabel);
				strResources.push(strResource);
			}

			if (resourceLabels.length === 1) {
				this._pushElement(new ResourceStackElement(element, resourceLabels[0], strResources[0], group.id, group.nextOrder(), source.id, source.nextOrder()));
			} else {
				this._pushElement(new WorkspaceStackElement(element, resourceLabels, strResources, group.id, group.nextOrder(), source.id, source.nextOrder()));
			}
		}
		if (DEBUG) {
			this._print('pushElement');
		}
	}

	private _pushElement(element: StackElement): void {
		for (let i = 0, len = element.strResources.length; i < len; i++) {
			const resourceLabel = element.resourceLabels[i];
			const strResource = element.strResources[i];

			let editStack: ResourceEditStack;
			if (this._editStacks.has(strResource)) {
				editStack = this._editStacks.get(strResource)!;
			} else {
				editStack = new ResourceEditStack(resourceLabel, strResource);
				this._editStacks.set(strResource, editStack);
			}

			editStack.pushElement(element);
		}
	}

	public getLastElement(resource: URI): IUndoRedoElement | null {
		const strResource = this.getUriComparisonKey(resource);
		if (this._editStacks.has(strResource)) {
			const editStack = this._editStacks.get(strResource)!;
			if (editStack.hasFutureElements()) {
				return null;
			}
			const closestPastElement = editStack.getClosestPastElement();
			return closestPastElement ? closestPastElement.actual : null;
		}
		return null;
	}

	private _splitPastWorkspaceElement(toRemove: WorkspaceStackElement & { actual: { split(): IResourceUndoRedoElement[]; } }, ignoreResources: RemovedResources | null): void {
		const individualArr = toRemove.actual.split();
		const individualMap = new Map<string, ResourceStackElement>();
		for (const _element of individualArr) {
			const resourceLabel = getResourceLabel(_element.resource);
			const strResource = this.getUriComparisonKey(_element.resource);
			const element = new ResourceStackElement(_element, resourceLabel, strResource, 0, 0, 0, 0);
			individualMap.set(element.strResource, element);
		}

		for (const strResource of toRemove.strResources) {
			if (ignoreResources && ignoreResources.has(strResource)) {
				continue;
			}
			const editStack = this._editStacks.get(strResource)!;
			editStack.splitPastWorkspaceElement(toRemove, individualMap);
		}
	}

	private _splitFutureWorkspaceElement(toRemove: WorkspaceStackElement & { actual: { split(): IResourceUndoRedoElement[]; } }, ignoreResources: RemovedResources | null): void {
		const individualArr = toRemove.actual.split();
		const individualMap = new Map<string, ResourceStackElement>();
		for (const _element of individualArr) {
			const resourceLabel = getResourceLabel(_element.resource);
			const strResource = this.getUriComparisonKey(_element.resource);
			const element = new ResourceStackElement(_element, resourceLabel, strResource, 0, 0, 0, 0);
			individualMap.set(element.strResource, element);
		}

		for (const strResource of toRemove.strResources) {
			if (ignoreResources && ignoreResources.has(strResource)) {
				continue;
			}
			const editStack = this._editStacks.get(strResource)!;
			editStack.splitFutureWorkspaceElement(toRemove, individualMap);
		}
	}

	public removeElements(resource: URI | string): void {
		const strResource = typeof resource === 'string' ? resource : this.getUriComparisonKey(resource);
		if (this._editStacks.has(strResource)) {
			const editStack = this._editStacks.get(strResource)!;
			editStack.dispose();
			this._editStacks.delete(strResource);
		}
		if (DEBUG) {
			this._print('removeElements');
		}
	}

	public setElementsValidFlag(resource: URI, isValid: boolean, filter: (element: IUndoRedoElement) => boolean): void {
		const strResource = this.getUriComparisonKey(resource);
		if (this._editStacks.has(strResource)) {
			const editStack = this._editStacks.get(strResource)!;
			editStack.setElementsValidFlag(isValid, filter);
		}
		if (DEBUG) {
			this._print('setElementsValidFlag');
		}
	}

	public hasElements(resource: URI): boolean {
		const strResource = this.getUriComparisonKey(resource);
		if (this._editStacks.has(strResource)) {
			const editStack = this._editStacks.get(strResource)!;
			return (editStack.hasPastElements() || editStack.hasFutureElements());
		}
		return false;
	}

	public createSnapshot(resource: URI): ResourceEditStackSnapshot {
		const strResource = this.getUriComparisonKey(resource);
		if (this._editStacks.has(strResource)) {
			const editStack = this._editStacks.get(strResource)!;
			return editStack.createSnapshot(resource);
		}
		return new ResourceEditStackSnapshot(resource, []);
	}

	public restoreSnapshot(snapshot: ResourceEditStackSnapshot): void {
		const strResource = this.getUriComparisonKey(snapshot.resource);
		if (this._editStacks.has(strResource)) {
			const editStack = this._editStacks.get(strResource)!;
			editStack.restoreSnapshot(snapshot);

			if (!editStack.hasPastElements() && !editStack.hasFutureElements()) {
				// the edit stack is now empty, just remove it entirely
				editStack.dispose();
				this._editStacks.delete(strResource);
			}
		}
		if (DEBUG) {
			this._print('restoreSnapshot');
		}
	}

	public getElements(resource: URI): IPastFutureElements {
		const strResource = this.getUriComparisonKey(resource);
		if (this._editStacks.has(strResource)) {
			const editStack = this._editStacks.get(strResource)!;
			return editStack.getElements();
		}
		return { past: [], future: [] };
	}

	private _findClosestUndoElementWithSource(sourceId: number): [StackElement | null, string | null] {
		if (!sourceId) {
			return [null, null];
		}

		// find an element with the sourceId and with the highest sourceOrder ready to be undone
		let matchedElement: StackElement | null = null;
		let matchedStrResource: string | null = null;

		for (const [strResource, editStack] of this._editStacks) {
			const candidate = editStack.getClosestPastElement();
			if (!candidate) {
				continue;
			}
			if (candidate.sourceId === sourceId) {
				if (!matchedElement || candidate.sourceOrder > matchedElement.sourceOrder) {
					matchedElement = candidate;
					matchedStrResource = strResource;
				}
			}
		}

		return [matchedElement, matchedStrResource];
	}

	public canUndo(resourceOrSource: URI | UndoRedoSource): boolean {
		if (resourceOrSource instanceof UndoRedoSource) {
			const [, matchedStrResource] = this._findClosestUndoElementWithSource(resourceOrSource.id);
			return matchedStrResource ? true : false;
		}
		const strResource = this.getUriComparisonKey(resourceOrSource);
		if (this._editStacks.has(strResource)) {
			const editStack = this._editStacks.get(strResource)!;
			return editStack.hasPastElements();
		}
		return false;
	}

	private _onError(err: Error, element: StackElement): void {
		onUnexpectedError(err);
		// An error occured while undoing or redoing => drop the undo/redo stack for all affected resources
		for (const strResource of element.strResources) {
			this.removeElements(strResource);
		}
		this._notificationService.error(err);
	}

	private _acquireLocks(editStackSnapshot: EditStackSnapshot): () => void {
		// first, check if all locks can be acquired
		for (const editStack of editStackSnapshot.editStacks) {
			if (editStack.locked) {
				throw new Error('Cannot acquire edit stack lock');
			}
		}

		// can acquire all locks
		for (const editStack of editStackSnapshot.editStacks) {
			editStack.locked = true;
		}

		return () => {
			// release all locks
			for (const editStack of editStackSnapshot.editStacks) {
				editStack.locked = false;
			}
		};
	}

	private _safeInvokeWithLocks(element: StackElement, invoke: () => Promise<void> | void, editStackSnapshot: EditStackSnapshot, cleanup: IDisposable, continuation: () => Promise<void> | void): Promise<void> | void {
		const releaseLocks = this._acquireLocks(editStackSnapshot);

		let result: Promise<void> | void;
		try {
			result = invoke();
		} catch (err) {
			releaseLocks();
			cleanup.dispose();
			return this._onError(err, element);
		}

		if (result) {
			// result is Promise<void>
			return result.then(
				() => {
					releaseLocks();
					cleanup.dispose();
					return continuation();
				},
				(err) => {
					releaseLocks();
					cleanup.dispose();
					return this._onError(err, element);
				}
			);
		} else {
			// result is void
			releaseLocks();
			cleanup.dispose();
			return continuation();
		}
	}

	private async _invokeWorkspacePrepare(element: WorkspaceStackElement): Promise<IDisposable> {
		if (typeof element.actual.prepareUndoRedo === 'undefined') {
			return Disposable.None;
		}
		const result = element.actual.prepareUndoRedo();
		if (typeof result === 'undefined') {
			return Disposable.None;
		}
		return result;
	}

	private _invokeResourcePrepare(element: ResourceStackElement, callback: (disposable: IDisposable) => Promise<void> | void): void | Promise<void> {
		if (element.actual.type !== UndoRedoElementType.Workspace || typeof element.actual.prepareUndoRedo === 'undefined') {
			// no preparation needed
			return callback(Disposable.None);
		}

		const r = element.actual.prepareUndoRedo();
		if (!r) {
			// nothing to clean up
			return callback(Disposable.None);
		}

		if (isDisposable(r)) {
			return callback(r);
		}

		return r.then((disposable) => {
			return callback(disposable);
		});
	}

	private _getAffectedEditStacks(element: WorkspaceStackElement): EditStackSnapshot {
		const affectedEditStacks: ResourceEditStack[] = [];
		for (const strResource of element.strResources) {
			affectedEditStacks.push(this._editStacks.get(strResource) || missingEditStack);
		}
		return new EditStackSnapshot(affectedEditStacks);
	}

	private _tryToSplitAndUndo(strResource: string, element: WorkspaceStackElement, ignoreResources: RemovedResources | null, message: string): WorkspaceVerificationError {
		if (element.canSplit()) {
			this._splitPastWorkspaceElement(element, ignoreResources);
			this._notificationService.warn(message);
			return new WorkspaceVerificationError(this._undo(strResource, 0, true));
		} else {
			// Cannot safely split this workspace element => flush all undo/redo stacks
			for (const strResource of element.strResources) {
				this.removeElements(strResource);
			}
			this._notificationService.warn(message);
			return new WorkspaceVerificationError();
		}
	}

	private _checkWorkspaceUndo(strResource: string, element: WorkspaceStackElement, editStackSnapshot: EditStackSnapshot, checkInvalidatedResources: boolean): WorkspaceVerificationError | null {
		if (element.removedResources) {
			return this._tryToSplitAndUndo(
				strResource,
				element,
				element.removedResources,
				nls.localize(
					{ key: 'cannotWorkspaceUndo', comment: ['{0} is a label for an operation. {1} is another message.'] },
					"Could not undo '{0}' across all files. {1}", element.label, element.removedResources.createMessage()
				)
			);
		}
		if (checkInvalidatedResources && element.invalidatedResources) {
			return this._tryToSplitAndUndo(
				strResource,
				element,
				element.invalidatedResources,
				nls.localize(
					{ key: 'cannotWorkspaceUndo', comment: ['{0} is a label for an operation. {1} is another message.'] },
					"Could not undo '{0}' across all files. {1}", element.label, element.invalidatedResources.createMessage()
				)
			);
		}

		// this must be the last past element in all the impacted resources!
		const cannotUndoDueToResources: string[] = [];
		for (const editStack of editStackSnapshot.editStacks) {
			if (editStack.getClosestPastElement() !== element) {
				cannotUndoDueToResources.push(editStack.resourceLabel);
			}
		}
		if (cannotUndoDueToResources.length > 0) {
			return this._tryToSplitAndUndo(
				strResource,
				element,
				null,
				nls.localize(
					{ key: 'cannotWorkspaceUndoDueToChanges', comment: ['{0} is a label for an operation. {1} is a list of filenames.'] },
					"Could not undo '{0}' across all files because changes were made to {1}", element.label, cannotUndoDueToResources.join(', ')
				)
			);
		}

		const cannotLockDueToResources: string[] = [];
		for (const editStack of editStackSnapshot.editStacks) {
			if (editStack.locked) {
				cannotLockDueToResources.push(editStack.resourceLabel);
			}
		}
		if (cannotLockDueToResources.length > 0) {
			return this._tryToSplitAndUndo(
				strResource,
				element,
				null,
				nls.localize(
					{ key: 'cannotWorkspaceUndoDueToInProgressUndoRedo', comment: ['{0} is a label for an operation. {1} is a list of filenames.'] },
					"Could not undo '{0}' across all files because there is already an undo or redo operation running on {1}", element.label, cannotLockDueToResources.join(', ')
				)
			);
		}

		// check if new stack elements were added in the meantime...
		if (!editStackSnapshot.isValid()) {
			return this._tryToSplitAndUndo(
				strResource,
				element,
				null,
				nls.localize(
					{ key: 'cannotWorkspaceUndoDueToInMeantimeUndoRedo', comment: ['{0} is a label for an operation. {1} is a list of filenames.'] },
					"Could not undo '{0}' across all files because an undo or redo operation occurred in the meantime", element.label
				)
			);
		}

		return null;
	}

	private _workspaceUndo(strResource: string, element: WorkspaceStackElement, undoConfirmed: boolean): Promise<void> | void {
		const affectedEditStacks = this._getAffectedEditStacks(element);
		const verificationError = this._checkWorkspaceUndo(strResource, element, affectedEditStacks, /*invalidated resources will be checked after the prepare call*/false);
		if (verificationError) {
			return verificationError.returnValue;
		}
		return this._confirmAndExecuteWorkspaceUndo(strResource, element, affectedEditStacks, undoConfirmed);
	}

	private _isPartOfUndoGroup(element: WorkspaceStackElement): boolean {
		if (!element.groupId) {
			return false;
		}
		// check that there is at least another element with the same groupId ready to be undone
		for (const [, editStack] of this._editStacks) {
			const pastElement = editStack.getClosestPastElement();
			if (!pastElement) {
				continue;
			}
			if (pastElement === element) {
				const secondPastElement = editStack.getSecondClosestPastElement();
				if (secondPastElement && secondPastElement.groupId === element.groupId) {
					// there is another element with the same group id in the same stack!
					return true;
				}
			}
			if (pastElement.groupId === element.groupId) {
				// there is another element with the same group id in another stack!
				return true;
			}
		}
		return false;
	}

	private async _confirmAndExecuteWorkspaceUndo(strResource: string, element: WorkspaceStackElement, editStackSnapshot: EditStackSnapshot, undoConfirmed: boolean): Promise<void> {

		if (element.canSplit() && !this._isPartOfUndoGroup(element)) {
			// this element can be split

			const result = await this._dialogService.show(
				Severity.Info,
				nls.localize('confirmWorkspace', "Would you like to undo '{0}' across all files?", element.label),
				[
					nls.localize({ key: 'ok', comment: ['{0} denotes a number that is > 1'] }, "Undo in {0} Files", editStackSnapshot.editStacks.length),
					nls.localize('nok', "Undo this File"),
					nls.localize('cancel', "Cancel"),
				],
				{
					cancelId: 2
				}
			);

			if (result.choice === 2) {
				// choice: cancel
				return;
			}

			if (result.choice === 1) {
				// choice: undo this file
				this._splitPastWorkspaceElement(element, null);
				return this._undo(strResource, 0, true);
			}

			// choice: undo in all files

			// At this point, it is possible that the element has been made invalid in the meantime (due to the confirmation await)
			const verificationError1 = this._checkWorkspaceUndo(strResource, element, editStackSnapshot, /*invalidated resources will be checked after the prepare call*/false);
			if (verificationError1) {
				return verificationError1.returnValue;
			}

			undoConfirmed = true;
		}

		// prepare
		let cleanup: IDisposable;
		try {
			cleanup = await this._invokeWorkspacePrepare(element);
		} catch (err) {
			return this._onError(err, element);
		}

		// At this point, it is possible that the element has been made invalid in the meantime (due to the prepare await)
		const verificationError2 = this._checkWorkspaceUndo(strResource, element, editStackSnapshot, /*now also check that there are no more invalidated resources*/true);
		if (verificationError2) {
			cleanup.dispose();
			return verificationError2.returnValue;
		}

		for (const editStack of editStackSnapshot.editStacks) {
			editStack.moveBackward(element);
		}
		return this._safeInvokeWithLocks(element, () => element.actual.undo(), editStackSnapshot, cleanup, () => this._continueUndoInGroup(element.groupId, undoConfirmed));
	}

	private _resourceUndo(editStack: ResourceEditStack, element: ResourceStackElement, undoConfirmed: boolean): Promise<void> | void {
		if (!element.isValid) {
			// invalid element => immediately flush edit stack!
			editStack.flushAllElements();
			return;
		}
		if (editStack.locked) {
			const message = nls.localize(
				{ key: 'cannotResourceUndoDueToInProgressUndoRedo', comment: ['{0} is a label for an operation.'] },
				"Could not undo '{0}' because there is already an undo or redo operation running.", element.label
			);
			this._notificationService.warn(message);
			return;
		}
		return this._invokeResourcePrepare(element, (cleanup) => {
			editStack.moveBackward(element);
			return this._safeInvokeWithLocks(element, () => element.actual.undo(), new EditStackSnapshot([editStack]), cleanup, () => this._continueUndoInGroup(element.groupId, undoConfirmed));
		});
	}

	private _findClosestUndoElementInGroup(groupId: number): [StackElement | null, string | null] {
		if (!groupId) {
			return [null, null];
		}

		// find another element with the same groupId and with the highest groupOrder ready to be undone
		let matchedElement: StackElement | null = null;
		let matchedStrResource: string | null = null;

		for (const [strResource, editStack] of this._editStacks) {
			const candidate = editStack.getClosestPastElement();
			if (!candidate) {
				continue;
			}
			if (candidate.groupId === groupId) {
				if (!matchedElement || candidate.groupOrder > matchedElement.groupOrder) {
					matchedElement = candidate;
					matchedStrResource = strResource;
				}
			}
		}

		return [matchedElement, matchedStrResource];
	}

	private _continueUndoInGroup(groupId: number, undoConfirmed: boolean): Promise<void> | void {
		if (!groupId) {
			return;
		}

		const [, matchedStrResource] = this._findClosestUndoElementInGroup(groupId);
		if (matchedStrResource) {
			return this._undo(matchedStrResource, 0, undoConfirmed);
		}
	}

	public undo(resourceOrSource: URI | UndoRedoSource): Promise<void> | void {
		if (resourceOrSource instanceof UndoRedoSource) {
			const [, matchedStrResource] = this._findClosestUndoElementWithSource(resourceOrSource.id);
			return matchedStrResource ? this._undo(matchedStrResource, resourceOrSource.id, false) : undefined;
		}
		if (typeof resourceOrSource === 'string') {
			return this._undo(resourceOrSource, 0, false);
		}
		return this._undo(this.getUriComparisonKey(resourceOrSource), 0, false);
	}

	private _undo(strResource: string, sourceId: number = 0, undoConfirmed: boolean): Promise<void> | void {
		if (!this._editStacks.has(strResource)) {
			return;
		}

		const editStack = this._editStacks.get(strResource)!;
		const element = editStack.getClosestPastElement();
		if (!element) {
			return;
		}

		if (element.groupId) {
			// this element is a part of a group, we need to make sure undoing in a group is in order
			const [matchedElement, matchedStrResource] = this._findClosestUndoElementInGroup(element.groupId);
			if (element !== matchedElement && matchedStrResource) {
				// there is an element in the same group that should be undone before this one
				return this._undo(matchedStrResource, sourceId, undoConfirmed);
			}
		}

		const shouldPromptForConfirmation = (element.sourceId !== sourceId || element.confirmBeforeUndo);
		if (shouldPromptForConfirmation && !undoConfirmed) {
			// Hit a different source or the element asks for prompt before undo, prompt for confirmation
			return this._confirmAndContinueUndo(strResource, sourceId, element);
		}

		try {
			if (element.type === UndoRedoElementType.Workspace) {
				return this._workspaceUndo(strResource, element, undoConfirmed);
			} else {
				return this._resourceUndo(editStack, element, undoConfirmed);
			}
		} finally {
			if (DEBUG) {
				this._print('undo');
			}
		}
	}

	private async _confirmAndContinueUndo(strResource: string, sourceId: number, element: StackElement): Promise<void> {
		const result = await this._dialogService.show(
			Severity.Info,
			nls.localize('confirmDifferentSource', "Would you like to undo '{0}'?", element.label),
			[
				nls.localize('confirmDifferentSource.ok', "Undo"),
				nls.localize('cancel', "Cancel"),
			],
			{
				cancelId: 1
			}
		);

		if (result.choice === 1) {
			// choice: cancel
			return;
		}

		// choice: undo
		return this._undo(strResource, sourceId, true);
	}

	private _findClosestRedoElementWithSource(sourceId: number): [StackElement | null, string | null] {
		if (!sourceId) {
			return [null, null];
		}

		// find an element with sourceId and with the lowest sourceOrder ready to be redone
		let matchedElement: StackElement | null = null;
		let matchedStrResource: string | null = null;

		for (const [strResource, editStack] of this._editStacks) {
			const candidate = editStack.getClosestFutureElement();
			if (!candidate) {
				continue;
			}
			if (candidate.sourceId === sourceId) {
				if (!matchedElement || candidate.sourceOrder < matchedElement.sourceOrder) {
					matchedElement = candidate;
					matchedStrResource = strResource;
				}
			}
		}

		return [matchedElement, matchedStrResource];
	}

	public canRedo(resourceOrSource: URI | UndoRedoSource): boolean {
		if (resourceOrSource instanceof UndoRedoSource) {
			const [, matchedStrResource] = this._findClosestRedoElementWithSource(resourceOrSource.id);
			return matchedStrResource ? true : false;
		}
		const strResource = this.getUriComparisonKey(resourceOrSource);
		if (this._editStacks.has(strResource)) {
			const editStack = this._editStacks.get(strResource)!;
			return editStack.hasFutureElements();
		}
		return false;
	}

	private _tryToSplitAndRedo(strResource: string, element: WorkspaceStackElement, ignoreResources: RemovedResources | null, message: string): WorkspaceVerificationError {
		if (element.canSplit()) {
			this._splitFutureWorkspaceElement(element, ignoreResources);
			this._notificationService.warn(message);
			return new WorkspaceVerificationError(this._redo(strResource));
		} else {
			// Cannot safely split this workspace element => flush all undo/redo stacks
			for (const strResource of element.strResources) {
				this.removeElements(strResource);
			}
			this._notificationService.warn(message);
			return new WorkspaceVerificationError();
		}
	}

	private _checkWorkspaceRedo(strResource: string, element: WorkspaceStackElement, editStackSnapshot: EditStackSnapshot, checkInvalidatedResources: boolean): WorkspaceVerificationError | null {
		if (element.removedResources) {
			return this._tryToSplitAndRedo(
				strResource,
				element,
				element.removedResources,
				nls.localize(
					{ key: 'cannotWorkspaceRedo', comment: ['{0} is a label for an operation. {1} is another message.'] },
					"Could not redo '{0}' across all files. {1}", element.label, element.removedResources.createMessage()
				)
			);
		}
		if (checkInvalidatedResources && element.invalidatedResources) {
			return this._tryToSplitAndRedo(
				strResource,
				element,
				element.invalidatedResources,
				nls.localize(
					{ key: 'cannotWorkspaceRedo', comment: ['{0} is a label for an operation. {1} is another message.'] },
					"Could not redo '{0}' across all files. {1}", element.label, element.invalidatedResources.createMessage()
				)
			);
		}

		// this must be the last future element in all the impacted resources!
		const cannotRedoDueToResources: string[] = [];
		for (const editStack of editStackSnapshot.editStacks) {
			if (editStack.getClosestFutureElement() !== element) {
				cannotRedoDueToResources.push(editStack.resourceLabel);
			}
		}
		if (cannotRedoDueToResources.length > 0) {
			return this._tryToSplitAndRedo(
				strResource,
				element,
				null,
				nls.localize(
					{ key: 'cannotWorkspaceRedoDueToChanges', comment: ['{0} is a label for an operation. {1} is a list of filenames.'] },
					"Could not redo '{0}' across all files because changes were made to {1}", element.label, cannotRedoDueToResources.join(', ')
				)
			);
		}

		const cannotLockDueToResources: string[] = [];
		for (const editStack of editStackSnapshot.editStacks) {
			if (editStack.locked) {
				cannotLockDueToResources.push(editStack.resourceLabel);
			}
		}
		if (cannotLockDueToResources.length > 0) {
			return this._tryToSplitAndRedo(
				strResource,
				element,
				null,
				nls.localize(
					{ key: 'cannotWorkspaceRedoDueToInProgressUndoRedo', comment: ['{0} is a label for an operation. {1} is a list of filenames.'] },
					"Could not redo '{0}' across all files because there is already an undo or redo operation running on {1}", element.label, cannotLockDueToResources.join(', ')
				)
			);
		}

		// check if new stack elements were added in the meantime...
		if (!editStackSnapshot.isValid()) {
			return this._tryToSplitAndRedo(
				strResource,
				element,
				null,
				nls.localize(
					{ key: 'cannotWorkspaceRedoDueToInMeantimeUndoRedo', comment: ['{0} is a label for an operation. {1} is a list of filenames.'] },
					"Could not redo '{0}' across all files because an undo or redo operation occurred in the meantime", element.label
				)
			);
		}

		return null;
	}

	private _workspaceRedo(strResource: string, element: WorkspaceStackElement): Promise<void> | void {
		const affectedEditStacks = this._getAffectedEditStacks(element);
		const verificationError = this._checkWorkspaceRedo(strResource, element, affectedEditStacks, /*invalidated resources will be checked after the prepare call*/false);
		if (verificationError) {
			return verificationError.returnValue;
		}
		return this._executeWorkspaceRedo(strResource, element, affectedEditStacks);
	}

	private async _executeWorkspaceRedo(strResource: string, element: WorkspaceStackElement, editStackSnapshot: EditStackSnapshot): Promise<void> {
		// prepare
		let cleanup: IDisposable;
		try {
			cleanup = await this._invokeWorkspacePrepare(element);
		} catch (err) {
			return this._onError(err, element);
		}

		// At this point, it is possible that the element has been made invalid in the meantime (due to the prepare await)
		const verificationError = this._checkWorkspaceRedo(strResource, element, editStackSnapshot, /*now also check that there are no more invalidated resources*/true);
		if (verificationError) {
			cleanup.dispose();
			return verificationError.returnValue;
		}

		for (const editStack of editStackSnapshot.editStacks) {
			editStack.moveForward(element);
		}
		return this._safeInvokeWithLocks(element, () => element.actual.redo(), editStackSnapshot, cleanup, () => this._continueRedoInGroup(element.groupId));
	}

	private _resourceRedo(editStack: ResourceEditStack, element: ResourceStackElement): Promise<void> | void {
		if (!element.isValid) {
			// invalid element => immediately flush edit stack!
			editStack.flushAllElements();
			return;
		}
		if (editStack.locked) {
			const message = nls.localize(
				{ key: 'cannotResourceRedoDueToInProgressUndoRedo', comment: ['{0} is a label for an operation.'] },
				"Could not redo '{0}' because there is already an undo or redo operation running.", element.label
			);
			this._notificationService.warn(message);
			return;
		}

		return this._invokeResourcePrepare(element, (cleanup) => {
			editStack.moveForward(element);
			return this._safeInvokeWithLocks(element, () => element.actual.redo(), new EditStackSnapshot([editStack]), cleanup, () => this._continueRedoInGroup(element.groupId));
		});
	}

	private _findClosestRedoElementInGroup(groupId: number): [StackElement | null, string | null] {
		if (!groupId) {
			return [null, null];
		}

		// find another element with the same groupId and with the lowest groupOrder ready to be redone
		let matchedElement: StackElement | null = null;
		let matchedStrResource: string | null = null;

		for (const [strResource, editStack] of this._editStacks) {
			const candidate = editStack.getClosestFutureElement();
			if (!candidate) {
				continue;
			}
			if (candidate.groupId === groupId) {
				if (!matchedElement || candidate.groupOrder < matchedElement.groupOrder) {
					matchedElement = candidate;
					matchedStrResource = strResource;
				}
			}
		}

		return [matchedElement, matchedStrResource];
	}

	private _continueRedoInGroup(groupId: number): Promise<void> | void {
		if (!groupId) {
			return;
		}

		const [, matchedStrResource] = this._findClosestRedoElementInGroup(groupId);
		if (matchedStrResource) {
			return this._redo(matchedStrResource);
		}
	}

	public redo(resourceOrSource: URI | UndoRedoSource | string): Promise<void> | void {
		if (resourceOrSource instanceof UndoRedoSource) {
			const [, matchedStrResource] = this._findClosestRedoElementWithSource(resourceOrSource.id);
			return matchedStrResource ? this._redo(matchedStrResource) : undefined;
		}
		if (typeof resourceOrSource === 'string') {
			return this._redo(resourceOrSource);
		}
		return this._redo(this.getUriComparisonKey(resourceOrSource));
	}

	private _redo(strResource: string): Promise<void> | void {
		if (!this._editStacks.has(strResource)) {
			return;
		}

		const editStack = this._editStacks.get(strResource)!;
		const element = editStack.getClosestFutureElement();
		if (!element) {
			return;
		}

		if (element.groupId) {
			// this element is a part of a group, we need to make sure redoing in a group is in order
			const [matchedElement, matchedStrResource] = this._findClosestRedoElementInGroup(element.groupId);
			if (element !== matchedElement && matchedStrResource) {
				// there is an element in the same group that should be redone before this one
				return this._redo(matchedStrResource);
			}
		}

		try {
			if (element.type === UndoRedoElementType.Workspace) {
				return this._workspaceRedo(strResource, element);
			} else {
				return this._resourceRedo(editStack, element);
			}
		} finally {
			if (DEBUG) {
				this._print('redo');
			}
		}
	}
}

class WorkspaceVerificationError {
	constructor(public readonly returnValue: Promise<void> | void) { }
}

registerSingleton(IUndoRedoService, UndoRedoService);
