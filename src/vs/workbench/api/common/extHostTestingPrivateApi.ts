/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { TestItemImpl } from 'vs/workbench/api/common/extHostTypes';
import * as vscode from 'vscode';

export const enum ExtHostTestItemEventType {
	NewChild,
	Disposed,
	Invalidated,
	SetProp,
}

export type ExtHostTestItemEvent =
	| [evt: ExtHostTestItemEventType.NewChild, item: TestItemImpl]
	| [evt: ExtHostTestItemEventType.Disposed]
	| [evt: ExtHostTestItemEventType.Invalidated]
	| [evt: ExtHostTestItemEventType.SetProp, key: keyof vscode.TestItem<never>, value: any];

export interface IExtHostTestItemApi {
	children: Map<string, TestItemImpl>;
	parent?: TestItemImpl;
	bus: Emitter<ExtHostTestItemEvent>;
}

const eventPrivateApis = new WeakMap<TestItemImpl, IExtHostTestItemApi>();

/**
 * Gets the private API for a test item implementation. This implementation
 * is a managed object, but we keep a weakmap to avoid exposing any of the
 * internals to extensions.
 */
export const getPrivateApiFor = (impl: TestItemImpl) => {
	let api = eventPrivateApis.get(impl);
	if (!api) {
		api = { children: new Map(), bus: new Emitter() };
		eventPrivateApis.set(impl, api);
	}

	return api;
};
