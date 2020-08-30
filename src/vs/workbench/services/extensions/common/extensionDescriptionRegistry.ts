/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { Emitter } from 'vs/base/common/event';
import * as path from 'vs/base/common/path';

export class DeltaExtensionsResult {
	constructor(
		public readonly removedDueToLooping: IExtensionDescription[]
	) { }
}

export class ExtensionDescriptionRegistry {
	private readonly _onDidChange = new Emitter<void>();
	public readonly onDidChange = this._onDidChange.event;

	private _extensionDescriptions: IExtensionDescription[];
	private _extensionsMap!: Map<string, IExtensionDescription>;
	private _extensionsArr!: IExtensionDescription[];
	private _activationMap!: Map<string, IExtensionDescription[]>;

	constructor(extensionDescriptions: IExtensionDescription[]) {
		this._extensionDescriptions = extensionDescriptions;
		this._initialize();
	}

	private _initialize(): void {
		// Ensure extensions are stored in the order: builtin, user, under development
		this._extensionDescriptions.sort(extensionCmp);

		this._extensionsMap = new Map<string, IExtensionDescription>();
		this._extensionsArr = [];
		this._activationMap = new Map<string, IExtensionDescription[]>();

		for (const extensionDescription of this._extensionDescriptions) {
			if (this._extensionsMap.has(ExtensionIdentifier.toKey(extensionDescription.identifier))) {
				// No overwriting allowed!
				console.error('Extension `' + extensionDescription.identifier.value + '` is already registered');
				continue;
			}

			this._extensionsMap.set(ExtensionIdentifier.toKey(extensionDescription.identifier), extensionDescription);
			this._extensionsArr.push(extensionDescription);

			if (Array.isArray(extensionDescription.activationEvents)) {
				for (let activationEvent of extensionDescription.activationEvents) {
					// TODO@joao: there's no easy way to contribute this
					if (activationEvent === 'onUri') {
						activationEvent = `onUri:${ExtensionIdentifier.toKey(extensionDescription.identifier)}`;
					}

					if (!this._activationMap.has(activationEvent)) {
						this._activationMap.set(activationEvent, []);
					}
					this._activationMap.get(activationEvent)!.push(extensionDescription);
				}
			}
		}
	}

	public keepOnly(extensionIds: ExtensionIdentifier[]): void {
		const toKeep = new Set<string>();
		extensionIds.forEach(extensionId => toKeep.add(ExtensionIdentifier.toKey(extensionId)));
		this._extensionDescriptions = this._extensionDescriptions.filter(extension => toKeep.has(ExtensionIdentifier.toKey(extension.identifier)));
		this._initialize();
		this._onDidChange.fire(undefined);
	}

	public deltaExtensions(toAdd: IExtensionDescription[], toRemove: ExtensionIdentifier[]): DeltaExtensionsResult {
		if (toAdd.length > 0) {
			this._extensionDescriptions = this._extensionDescriptions.concat(toAdd);
		}

		// Immediately remove looping extensions!
		const looping = ExtensionDescriptionRegistry._findLoopingExtensions(this._extensionDescriptions);
		toRemove = toRemove.concat(looping.map(ext => ext.identifier));

		if (toRemove.length > 0) {
			const toRemoveSet = new Set<string>();
			toRemove.forEach(extensionId => toRemoveSet.add(ExtensionIdentifier.toKey(extensionId)));
			this._extensionDescriptions = this._extensionDescriptions.filter(extension => !toRemoveSet.has(ExtensionIdentifier.toKey(extension.identifier)));
		}

		this._initialize();
		this._onDidChange.fire(undefined);
		return new DeltaExtensionsResult(looping);
	}

	private static _findLoopingExtensions(extensionDescriptions: IExtensionDescription[]): IExtensionDescription[] {
		const G = new class {

			private _arcs = new Map<string, string[]>();
			private _nodesSet = new Set<string>();
			private _nodesArr: string[] = [];

			addNode(id: string): void {
				if (!this._nodesSet.has(id)) {
					this._nodesSet.add(id);
					this._nodesArr.push(id);
				}
			}

			addArc(from: string, to: string): void {
				this.addNode(from);
				this.addNode(to);
				if (this._arcs.has(from)) {
					this._arcs.get(from)!.push(to);
				} else {
					this._arcs.set(from, [to]);
				}
			}

			getArcs(id: string): string[] {
				if (this._arcs.has(id)) {
					return this._arcs.get(id)!;
				}
				return [];
			}

			hasOnlyGoodArcs(id: string, good: Set<string>): boolean {
				const dependencies = G.getArcs(id);
				for (let i = 0; i < dependencies.length; i++) {
					if (!good.has(dependencies[i])) {
						return false;
					}
				}
				return true;
			}

			getNodes(): string[] {
				return this._nodesArr;
			}
		};

		let descs = new Map<string, IExtensionDescription>();
		for (let extensionDescription of extensionDescriptions) {
			const extensionId = ExtensionIdentifier.toKey(extensionDescription.identifier);
			descs.set(extensionId, extensionDescription);
			if (extensionDescription.extensionDependencies) {
				for (let _depId of extensionDescription.extensionDependencies) {
					const depId = ExtensionIdentifier.toKey(_depId);
					G.addArc(extensionId, depId);
				}
			}
		}

		// initialize with all extensions with no dependencies.
		let good = new Set<string>();
		G.getNodes().filter(id => G.getArcs(id).length === 0).forEach(id => good.add(id));

		// all other extensions will be processed below.
		let nodes = G.getNodes().filter(id => !good.has(id));

		let madeProgress: boolean;
		do {
			madeProgress = false;

			// find one extension which has only good deps
			for (let i = 0; i < nodes.length; i++) {
				const id = nodes[i];

				if (G.hasOnlyGoodArcs(id, good)) {
					nodes.splice(i, 1);
					i--;
					good.add(id);
					madeProgress = true;
				}
			}
		} while (madeProgress);

		// The remaining nodes are bad and have loops
		return nodes.map(id => descs.get(id)!);
	}

	public containsActivationEvent(activationEvent: string): boolean {
		return this._activationMap.has(activationEvent);
	}

	public containsExtension(extensionId: ExtensionIdentifier): boolean {
		return this._extensionsMap.has(ExtensionIdentifier.toKey(extensionId));
	}

	public getExtensionDescriptionsForActivationEvent(activationEvent: string): IExtensionDescription[] {
		const extensions = this._activationMap.get(activationEvent);
		return extensions ? extensions.slice(0) : [];
	}

	public getAllExtensionDescriptions(): IExtensionDescription[] {
		return this._extensionsArr.slice(0);
	}

	public getExtensionDescription(extensionId: ExtensionIdentifier | string): IExtensionDescription | undefined {
		const extension = this._extensionsMap.get(ExtensionIdentifier.toKey(extensionId));
		return extension ? extension : undefined;
	}
}

const enum SortBucket {
	Builtin = 0,
	User = 1,
	Dev = 2
}

/**
 * Ensure that:
 * - first are builtin extensions
 * - second are user extensions
 * - third are extensions under development
 *
 * In each bucket, extensions must be sorted alphabetically by their folder name.
 */
function extensionCmp(a: IExtensionDescription, b: IExtensionDescription): number {
	const aSortBucket = (a.isBuiltin ? SortBucket.Builtin : a.isUnderDevelopment ? SortBucket.Dev : SortBucket.User);
	const bSortBucket = (b.isBuiltin ? SortBucket.Builtin : b.isUnderDevelopment ? SortBucket.Dev : SortBucket.User);
	if (aSortBucket !== bSortBucket) {
		return aSortBucket - bSortBucket;
	}
	const aLastSegment = path.posix.basename(a.extensionLocation.path);
	const bLastSegment = path.posix.basename(b.extensionLocation.path);
	if (aLastSegment < bLastSegment) {
		return -1;
	}
	if (aLastSegment > bLastSegment) {
		return 1;
	}
	return 0;
}
