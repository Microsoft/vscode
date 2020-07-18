/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { Command } from 'vs/editor/common/modes';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IAccessibilityInformation } from 'vs/platform/accessibility/common/accessibility';

export function toKey(extension: ExtensionIdentifier | string, source: string) {
	return `${typeof extension === 'string' ? extension : ExtensionIdentifier.toKey(extension)}|${source}`;
}

export const TimelinePaneId = 'timeline';

export interface TimelineItem {
	handle: string;
	source: string;

	id?: string;
	timestamp: number;
	label: string;
	accessibilityInformation?: IAccessibilityInformation;
	icon?: URI,
	iconDark?: URI,
	themeIcon?: { id: string },
	description?: string;
	detail?: string;
	command?: Command;
	contextValue?: string;

	relativeTime?: string;
	hideRelativeTime?: boolean;
}

export interface TimelineChangeEvent {
	id: string;
	uri: URI | undefined;
	reset: boolean
}

export interface TimelineOptions {
	cursor?: string;
	limit?: number | { timestamp: number; id?: string };
}

export interface InternalTimelineOptions {
	cacheResults: boolean;
	resetCache: boolean;
}

export interface Timeline {
	source: string;
	items: TimelineItem[];

	paging?: {
		cursor: string | undefined;
	}
}

export interface TimelineProvider extends TimelineProviderDescriptor, IDisposable {
	onDidChange?: Event<TimelineChangeEvent>;

	provideTimeline(uri: URI, options: TimelineOptions, token: CancellationToken, internalOptions?: InternalTimelineOptions): Promise<Timeline | undefined>;
}

export interface TimelineSource {
	id: string;
	label: string;
}

export interface TimelineProviderDescriptor {
	id: string;
	label: string;
	scheme: string | string[];
}

export interface TimelineProvidersChangeEvent {
	readonly added?: string[];
	readonly removed?: string[];
}

export interface TimelineRequest {
	readonly result: Promise<Timeline | undefined>;
	readonly options: TimelineOptions;
	readonly source: string;
	readonly tokenSource: CancellationTokenSource;
	readonly uri: URI;
}

export interface ITimelineService {
	readonly _serviceBrand: undefined;

	onDidChangeProviders: Event<TimelineProvidersChangeEvent>;
	onDidChangeTimeline: Event<TimelineChangeEvent>;
	onDidChangeUri: Event<URI>;

	registerTimelineProvider(provider: TimelineProvider): IDisposable;
	unregisterTimelineProvider(id: string): void;

	getSources(): TimelineSource[];

	getTimeline(id: string, uri: URI, options: TimelineOptions, tokenSource: CancellationTokenSource, internalOptions?: InternalTimelineOptions): TimelineRequest | undefined;

	setUri(uri: URI): void;
}

const TIMELINE_SERVICE_ID = 'timeline';
export const ITimelineService = createDecorator<ITimelineService>(TIMELINE_SERVICE_ID);
