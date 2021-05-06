/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';

export type PerfName = 'startTime' | 'extensionActivated' | 'inputLoaded' | 'webviewCommLoaded' | 'customMarkdownLoaded' | 'editorLoaded';

type PerformanceMark = { [key in PerfName]?: number };

const perfMarks = new Map<string, PerformanceMark>();

export function mark(resource: URI, name: PerfName): void {
	const key = resource.toString();
	if (!perfMarks.has(key)) {
		let perfMark: PerformanceMark = {};
		perfMark[name] = Date.now();
		perfMarks.set(key, perfMark);
	} else {
		if (perfMarks.get(key)![name]) {
			console.error(`Skipping overwrite of notebook perf value: ${name}`);
			return;
		}
		perfMarks.get(key)![name] = Date.now();
	}
}

export function clearMarks(resource: URI): void {
	const key = resource.toString();

	perfMarks.delete(key);
}

export function getAndClearMarks(resource: URI): PerformanceMark | null {
	const key = resource.toString();

	const perfMark = perfMarks.get(key) || null;
	perfMarks.delete(key);
	return perfMark;
}
