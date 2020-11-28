/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Since data sent through the service is serialized to JSON, functions will be lost, so Color objects
// should not be sent as their 'toString' method will be stripped. Instead convert to strings before sending.
export interface WindowStyles {
	backgroundColor?: string;
	color?: string;
}
export interface WindowData {
	styles: WindowStyles;
	zoomLevel: number;
}

export const enum IssueType {
	Bug,
	PerformanceIssue,
	FeatureRequest
}

export interface IssueReporterStyles extends WindowStyles {
	textLinkColor?: string;
	textLinkActiveForeground?: string;
	inputBackground?: string;
	inputForeground?: string;
	inputBorder?: string;
	inputErrorBorder?: string;
	inputErrorBackground?: string;
	inputErrorForeground?: string;
	inputActiveBorder?: string;
	buttonBackground?: string;
	buttonForeground?: string;
	buttonHoverBackground?: string;
	sliderBackgroundColor?: string;
	sliderHoverColor?: string;
	sliderActiveColor?: string;
}

export interface IssueReporterExtensionData {
	name: string;
	publisher: string;
	version: string;
	id: string;
	isTheme: boolean;
	isBuiltin: boolean;
	displayName: string | undefined;
	repositoryUrl: string | undefined;
	bugsUrl: string | undefined;
}

export interface IssueReporterData extends WindowData {
	styles: IssueReporterStyles;
	enabledExtensions: IssueReporterExtensionData[];
	issueType?: IssueType;
	extensionId?: string;
	experiments?: string;
	readonly issueTitle?: string;
	readonly issueBody?: string;
}

export interface ISettingSearchResult {
	extensionId: string;
	key: string;
	score: number;
}

export interface IssueReporterFeatures {
}

export interface ProcessExplorerStyles extends WindowStyles {
	hoverBackground?: string;
	hoverForeground?: string;
	highlightForeground?: string;
}

export interface ProcessExplorerData extends WindowData {
	pid: number;
	styles: ProcessExplorerStyles;
	platform: 'win32' | 'darwin' | 'linux';
	applicationName: string;
}

export interface ICommonIssueService {
	readonly _serviceBrand: undefined;
	openReporter(data: IssueReporterData): Promise<void>;
	openProcessExplorer(data: ProcessExplorerData): Promise<void>;
	getSystemStatus(): Promise<string>;
}
