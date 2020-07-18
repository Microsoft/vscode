/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface PerformanceEntry {
	readonly name: string;
	readonly startTime: number;
}

export function mark(name: string): void;

/**
 * All entries filtered by type and sorted by `startTime`.
 */
export function getEntries(): PerformanceEntry[];

export function getDuration(from: string, to: string): number;

type ExportData = any[];
export function importEntries(data: ExportData): void;
export function exportEntries(): ExportData;
