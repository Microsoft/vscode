/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';

export const IAccessibilityService = createDecorator<IAccessibilityService>('accessibilityService');

export interface IAccessibilityService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeScreenReaderOptimized: Event<void>;

	alwaysUnderlineAccessKeys(): Promise<boolean>;
	isScreenReaderOptimized(): boolean;
	getAccessibilitySupport(): AccessibilitySupport;
	setAccessibilitySupport(accessibilitySupport: AccessibilitySupport): void;
}

export const enum AccessibilitySupport {
	/**
	 * This should be the browser case where it is not known if a screen reader is attached or no.
	 */
	Unknown = 0,

	Disabled = 1,

	Enabled = 2
}

export const CONTEXT_ACCESSIBILITY_MODE_ENABLED = new RawContextKey<boolean>('accessibilityModeEnabled', false);

export interface IAccessibilityInformation {
	label: string;
	role?: string;
}
