/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TestResultState } from 'vs/workbench/api/common/extHostTypes';
import { maxPriority, statePriority } from 'vs/workbench/contrib/testing/common/testingStates';

/**
 * Accessor for nodes in get and refresh computed state.
 */
export interface IComputedStateAccessor<T> {
	getOwnState(item: T): TestResultState | undefined;
	getCurrentComputedState(item: T): TestResultState;
	setComputedState(item: T, state: TestResultState): void;
	getChildren(item: T): Iterable<T>;
	getParents(item: T): Iterable<T>;
}

/**
 * Gets the computed state for the node.
 * @param force whether to refresh the computed state for this node, even
 * if it was previously set.
 */

export const getComputedState = <T>(accessor: IComputedStateAccessor<T>, node: T, force = false) => {
	let computed = accessor.getCurrentComputedState(node);
	if (computed === undefined || force) {
		computed = accessor.getOwnState(node) ?? TestResultState.Unset;
		for (const child of accessor.getChildren(node)) {
			computed = maxPriority(computed, getComputedState(accessor, child));
		}

		accessor.setComputedState(node, computed);
	}

	return computed;
};
/**
 * Refreshes the computed state for the node and its parents. Any changes
 * elements cause `addUpdated` to be called.
 */

export const refreshComputedState = <T>(
	accessor: IComputedStateAccessor<T>,
	node: T,
	addUpdated: (node: T) => void,
	explicitNewComputedState?: TestResultState,
) => {
	const oldState = accessor.getCurrentComputedState(node);
	const oldPriority = statePriority[oldState];
	const newState = explicitNewComputedState ?? getComputedState(accessor, node, true);
	const newPriority = statePriority[newState];
	if (newPriority === oldPriority) {
		return;
	}

	accessor.setComputedState(node, newState);
	addUpdated(node);

	if (newPriority > oldPriority) {
		// Update all parents to ensure they're at least this priority.
		for (const parent of accessor.getParents(node)) {
			const prev = accessor.getCurrentComputedState(parent);
			if (prev !== undefined && statePriority[prev] >= newPriority) {
				break;
			}

			accessor.setComputedState(parent, newState);
			addUpdated(parent);
		}
	} else if (newPriority < oldPriority) {
		// Re-render all parents of this node whose computed priority might have come from this node
		for (const parent of accessor.getParents(node)) {
			const prev = accessor.getCurrentComputedState(parent);
			if (prev === undefined || statePriority[prev] > oldPriority) {
				break;
			}

			accessor.setComputedState(parent, getComputedState(accessor, parent, true));
			addUpdated(parent);
		}
	}
};
