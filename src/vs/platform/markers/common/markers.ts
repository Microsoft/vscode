/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { localize } from 'vs/nls';
import Severity from 'vs/base/common/severity';

export interface IMarkerService {
	readonly _serviceBrand: undefined;

	getStatistics(): MarkerStatistics;

	changeOne(owner: string, resource: URI, markers: IMarkerData[]): void;

	changeAll(owner: string, data: IResourceMarker[]): void;

	remove(owner: string, resources: URI[]): void;

	read(filter?: { owner?: string; resource?: URI; severities?: number, take?: number; }): IMarker[];

	readonly onMarkerChanged: Event<readonly URI[]>;
}

/**
 *
 */
export interface IRelatedInformation {
	resource: URI;
	message: string;
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
}

export const enum MarkerTag {
	Unnecessary = 1,
	Deprecated = 2
}

export enum MarkerSeverity {
	Hint = 1,
	Info = 2,
	Warning = 4,
	Error = 8,
}

export namespace MarkerSeverity {

	export function compare(a: MarkerSeverity, b: MarkerSeverity): number {
		return b - a;
	}

	const _displayStrings: { [value: number]: string; } = Object.create(null);
	_displayStrings[MarkerSeverity.Error] = localize('sev.error', "Error");
	_displayStrings[MarkerSeverity.Warning] = localize('sev.warning', "Warning");
	_displayStrings[MarkerSeverity.Info] = localize('sev.info', "Info");

	export function toString(a: MarkerSeverity): string {
		return _displayStrings[a] || '';
	}

	export function fromSeverity(severity: Severity): MarkerSeverity {
		switch (severity) {
			case Severity.Error: return MarkerSeverity.Error;
			case Severity.Warning: return MarkerSeverity.Warning;
			case Severity.Info: return MarkerSeverity.Info;
			case Severity.Ignore: return MarkerSeverity.Hint;
		}
	}

	export function toSeverity(severity: MarkerSeverity): Severity {
		switch (severity) {
			case MarkerSeverity.Error: return Severity.Error;
			case MarkerSeverity.Warning: return Severity.Warning;
			case MarkerSeverity.Info: return Severity.Info;
			case MarkerSeverity.Hint: return Severity.Ignore;
		}
	}
}

/**
 * A structure defining a problem/warning/etc.
 */
export interface IMarkerData {
	code?: string | { value: string; target: URI };
	severity: MarkerSeverity;
	message: string;
	source?: string;
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
	relatedInformation?: IRelatedInformation[];
	tags?: MarkerTag[];
}

export interface IResourceMarker {
	resource: URI;
	marker: IMarkerData;
}

export interface IMarker {
	owner: string;
	resource: URI;
	severity: MarkerSeverity;
	code?: string | { value: string; target: URI };
	message: string;
	source?: string;
	startLineNumber: number;
	startColumn: number;
	endLineNumber: number;
	endColumn: number;
	relatedInformation?: IRelatedInformation[];
	tags?: MarkerTag[];
}

export interface MarkerStatistics {
	errors: number;
	warnings: number;
	infos: number;
	unknowns: number;
}

export namespace IMarkerData {
	const emptyString = '';
	export function makeKey(markerData: IMarkerData): string {
		return makeKeyOptionalMessage(markerData, true);
	}

	export function makeKeyOptionalMessage(markerData: IMarkerData, useMessage: boolean): string {
		let result: string[] = [emptyString];
		if (markerData.source) {
			result.push(markerData.source.replace('¦', '\\¦'));
		} else {
			result.push(emptyString);
		}
		if (markerData.code) {
			if (typeof markerData.code === 'string') {
				result.push(markerData.code.replace('¦', '\\¦'));
			} else {
				result.push(markerData.code.value.replace('¦', '\\¦'));
			}
		} else {
			result.push(emptyString);
		}
		if (markerData.severity !== undefined && markerData.severity !== null) {
			result.push(MarkerSeverity.toString(markerData.severity));
		} else {
			result.push(emptyString);
		}

		// Modifed to not include the message as part of the marker key to work around
		// https://github.com/microsoft/vscode/issues/77475
		if (markerData.message && useMessage) {
			result.push(markerData.message.replace('¦', '\\¦'));
		} else {
			result.push(emptyString);
		}
		if (markerData.startLineNumber !== undefined && markerData.startLineNumber !== null) {
			result.push(markerData.startLineNumber.toString());
		} else {
			result.push(emptyString);
		}
		if (markerData.startColumn !== undefined && markerData.startColumn !== null) {
			result.push(markerData.startColumn.toString());
		} else {
			result.push(emptyString);
		}
		if (markerData.endLineNumber !== undefined && markerData.endLineNumber !== null) {
			result.push(markerData.endLineNumber.toString());
		} else {
			result.push(emptyString);
		}
		if (markerData.endColumn !== undefined && markerData.endColumn !== null) {
			result.push(markerData.endColumn.toString());
		} else {
			result.push(emptyString);
		}
		result.push(emptyString);
		return result.join('¦');
	}
}

export const IMarkerService = createDecorator<IMarkerService>('markerService');
