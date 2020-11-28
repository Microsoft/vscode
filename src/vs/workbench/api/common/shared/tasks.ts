/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UriComponents } from 'vs/base/common/uri';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';

export interface TaskDefinitionDTO {
	type: string;
	[name: string]: any;
}

export interface TaskPresentationOptionsDTO {
	reveal?: number;
	echo?: boolean;
	focus?: boolean;
	panel?: number;
	showReuseMessage?: boolean;
	clear?: boolean;
	group?: string;
}

export interface RunOptionsDTO {
	reevaluateOnRerun?: boolean;
}

export interface ExecutionOptionsDTO {
	cwd?: string;
	env?: { [key: string]: string };
}

export interface ProcessExecutionOptionsDTO extends ExecutionOptionsDTO {
}

export interface ProcessExecutionDTO {
	process: string;
	args: string[];
	options?: ProcessExecutionOptionsDTO;
}

export interface ShellQuotingOptionsDTO {
	escape?: string | {
		escapeChar: string;
		charsToEscape: string;
	};
	strong?: string;
	weak?: string;
}

export interface ShellExecutionOptionsDTO extends ExecutionOptionsDTO {
	executable?: string;
	shellArgs?: string[];
	shellQuoting?: ShellQuotingOptionsDTO;
}

export interface ShellQuotedStringDTO {
	value: string;
	quoting: number;
}

export interface ShellExecutionDTO {
	commandLine?: string;
	command?: string | ShellQuotedStringDTO;
	args?: Array<string | ShellQuotedStringDTO>;
	options?: ShellExecutionOptionsDTO;
}

export interface CustomExecutionDTO {
	customExecution: 'customExecution';
}

export interface TaskSourceDTO {
	label: string;
	extensionId?: string;
	scope?: number | UriComponents;
}

export interface TaskHandleDTO {
	id: string;
	workspaceFolder: UriComponents | string;
}

export interface TaskDTO {
	_id: string;
	name?: string;
	execution: ProcessExecutionDTO | ShellExecutionDTO | CustomExecutionDTO | undefined;
	definition: TaskDefinitionDTO;
	isBackground?: boolean;
	source: TaskSourceDTO;
	group?: string;
	detail?: string;
	presentationOptions?: TaskPresentationOptionsDTO;
	problemMatchers: string[];
	hasDefinedMatchers: boolean;
	runOptions?: RunOptionsDTO;
}

export interface TaskSetDTO {
	tasks: TaskDTO[];
	extension: IExtensionDescription;
}

export interface TaskExecutionDTO {
	id: string;
	task: TaskDTO | undefined;
}

export interface TaskProcessStartedDTO {
	id: string;
	processId: number;
}

export interface TaskProcessEndedDTO {
	id: string;
	exitCode: number | undefined;
}


export interface TaskFilterDTO {
	version?: string;
	type?: string;
}

export interface TaskSystemInfoDTO {
	scheme: string;
	authority: string;
	platform: string;
}
