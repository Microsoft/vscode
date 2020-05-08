/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEnvironmentVariableCollection, EnvironmentVariableMutatorType, IMergedEnvironmentVariableCollection, IMergedEnvironmentVariableCollectionDiff, IExtensionOwnedEnvironmentVariableMutator } from 'vs/workbench/contrib/terminal/common/environmentVariable';
import { IProcessEnvironment, isWindows } from 'vs/base/common/platform';

export class MergedEnvironmentVariableCollection implements IMergedEnvironmentVariableCollection {
	readonly map: Map<string, IExtensionOwnedEnvironmentVariableMutator[]> = new Map();

	constructor(collections: Map<string, IEnvironmentVariableCollection>) {
		collections.forEach((collection, extensionIdentifier) => {
			const it = collection.map.entries();
			let next = it.next();
			while (!next.done) {
				const variable = next.value[0];
				let entry = this.map.get(variable);
				if (!entry) {
					entry = [];
					this.map.set(variable, entry);
				}

				// If the first item in the entry is replace ignore any other entries as they would
				// just get replaced by this one.
				if (entry.length > 0 && entry[0].type === EnvironmentVariableMutatorType.Replace) {
					next = it.next();
					continue;
				}

				// Mutators get applied in the reverse order than they are created
				const mutator = next.value[1];
				entry.unshift({
					extensionIdentifier,
					value: mutator.value,
					type: mutator.type
				});

				next = it.next();
			}
		});
	}

	applyToProcessEnvironment(env: IProcessEnvironment): void {
		let lowerToActualVariableNames: { [lowerKey: string]: string | undefined } | undefined;
		if (isWindows) {
			lowerToActualVariableNames = {};
			Object.keys(env).forEach(e => lowerToActualVariableNames![e.toLowerCase()] = e);
		}
		this.map.forEach((mutators, variable) => {
			const actualVariable = isWindows ? lowerToActualVariableNames![variable.toLowerCase()] || variable : variable;
			mutators.forEach(mutator => {
				switch (mutator.type) {
					case EnvironmentVariableMutatorType.Append:
						env[actualVariable] = (env[actualVariable] || '') + mutator.value;
						break;
					case EnvironmentVariableMutatorType.Prepend:
						env[actualVariable] = mutator.value + (env[actualVariable] || '');
						break;
					case EnvironmentVariableMutatorType.Replace:
						env[actualVariable] = mutator.value;
						break;
				}
			});
		});
	}

	diff(other: IMergedEnvironmentVariableCollection): IMergedEnvironmentVariableCollectionDiff | undefined {
		const added: Map<string, IExtensionOwnedEnvironmentVariableMutator[]> = new Map();
		const changed: Map<string, IExtensionOwnedEnvironmentVariableMutator[]> = new Map();
		const removed: Map<string, IExtensionOwnedEnvironmentVariableMutator[]> = new Map();

		// Find added
		other.map.forEach((otherMutators, variable) => {
			const currentMutators = this.map.get(variable);
			const result = getMissingMutatorsFromArray(otherMutators, currentMutators);
			if (result) {
				added.set(variable, result);
			}
		});

		// Find removed
		this.map.forEach((currentMutators, variable) => {
			const otherMutators = other.map.get(variable);
			const result = getMissingMutatorsFromArray(currentMutators, otherMutators);
			if (result) {
				removed.set(variable, result);
			}
		});

		// Find changed
		this.map.forEach((currentMutators, variable) => {
			const otherMutators = other.map.get(variable);
			const result = getChangedMutatorsFromArray(currentMutators, otherMutators);
			if (result) {
				changed.set(variable, result);
			}
		});

		if (added.size === 0 && changed.size === 0 && removed.size === 0) {
			return undefined;
		}

		return { added, changed, removed };
	}
}

function getMissingMutatorsFromArray(
	current: IExtensionOwnedEnvironmentVariableMutator[],
	other: IExtensionOwnedEnvironmentVariableMutator[] | undefined
): IExtensionOwnedEnvironmentVariableMutator[] | undefined {
	// If it doesn't exist, all are removed
	if (!other) {
		return current;
	}

	// Create a map to help
	const otherMutatorExtensions = new Set<string>();
	other.forEach(m => otherMutatorExtensions.add(m.extensionIdentifier));

	// Find entries removed from other
	const result: IExtensionOwnedEnvironmentVariableMutator[] = [];
	current.forEach(mutator => {
		if (!otherMutatorExtensions.has(mutator.extensionIdentifier)) {
			result.push(mutator);
		}
	});

	return result.length === 0 ? undefined : result;
}

function getChangedMutatorsFromArray(
	current: IExtensionOwnedEnvironmentVariableMutator[],
	other: IExtensionOwnedEnvironmentVariableMutator[] | undefined
): IExtensionOwnedEnvironmentVariableMutator[] | undefined {
	// If it doesn't exist, none are changed (they are removed)
	if (!other) {
		return undefined;
	}

	// Create a map to help
	const otherMutatorExtensions = new Map<string, IExtensionOwnedEnvironmentVariableMutator>();
	other.forEach(m => otherMutatorExtensions.set(m.extensionIdentifier, m));

	// Find entries that exist in both but are not equal
	const result: IExtensionOwnedEnvironmentVariableMutator[] = [];
	current.forEach(mutator => {
		const otherMutator = otherMutatorExtensions.get(mutator.extensionIdentifier);
		if (otherMutator && (mutator.type !== otherMutator.type || mutator.value !== otherMutator.value)) {
			// Return the new result, not the old one
			result.push(otherMutator);
		}
	});

	return result.length === 0 ? undefined : result;
}
