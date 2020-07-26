/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import * as glob from 'vs/base/common/glob';
import { IDisposable } from 'vs/base/common/lifecycle';
import { isWindows } from 'vs/base/common/platform';
import { ISplice } from 'vs/base/common/sequence';
import { URI, UriComponents } from 'vs/base/common/uri';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IEditorModel } from 'vs/platform/editor/common/editor';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Schemas } from 'vs/base/common/network';
import { IRevertOptions } from 'vs/workbench/common/editor';
import { basename } from 'vs/base/common/path';

export enum CellKind {
	Markdown = 1,
	Code = 2
}

export enum CellOutputKind {
	Text = 1,
	Error = 2,
	Rich = 3
}

export const NOTEBOOK_DISPLAY_ORDER = [
	'application/json',
	'application/javascript',
	'text/html',
	'image/svg+xml',
	'text/markdown',
	'image/png',
	'image/jpeg',
	'text/plain'
];

export const ACCESSIBLE_NOTEBOOK_DISPLAY_ORDER = [
	'text/markdown',
	'application/json',
	'text/plain',
	'text/html',
	'image/svg+xml',
	'image/png',
	'image/jpeg',
];

export const BUILTIN_RENDERER_ID = '_builtin';

export enum NotebookRunState {
	Running = 1,
	Idle = 2
}

export const notebookDocumentMetadataDefaults: Required<NotebookDocumentMetadata> = {
	editable: true,
	runnable: true,
	cellEditable: true,
	cellRunnable: true,
	cellHasExecutionOrder: true,
	displayOrder: NOTEBOOK_DISPLAY_ORDER,
	custom: {},
	runState: NotebookRunState.Idle
};

export interface NotebookDocumentMetadata {
	editable: boolean;
	runnable: boolean;
	cellEditable: boolean;
	cellRunnable: boolean;
	cellHasExecutionOrder: boolean;
	displayOrder?: (string | glob.IRelativePattern)[];
	custom?: { [key: string]: unknown };
	runState?: NotebookRunState;
}

export enum NotebookCellRunState {
	Running = 1,
	Idle = 2,
	Success = 3,
	Error = 4
}

export interface NotebookCellMetadata {
	editable?: boolean;
	runnable?: boolean;
	breakpointMargin?: boolean;
	hasExecutionOrder?: boolean;
	executionOrder?: number;
	statusMessage?: string;
	runState?: NotebookCellRunState;
	runStartTime?: number;
	lastRunDuration?: number;
	custom?: { [key: string]: unknown };
}

export interface INotebookDisplayOrder {
	defaultOrder: string[];
	userOrder?: string[];
}

export interface INotebookMimeTypeSelector {
	mimeTypes?: string[];
}

export interface INotebookRendererInfo {
	id: string;
	extensionId: ExtensionIdentifier;
	extensionLocation: URI,
	preloads: URI[],
	render(uri: URI, request: IOutputRenderRequest<UriComponents>): Promise<IOutputRenderResponse<UriComponents> | undefined>;
	render2<T>(uri: URI, request: IOutputRenderRequest<T>): Promise<IOutputRenderResponse<T> | undefined>;
}

export interface INotebookKernelInfo {
	id: string;
	label: string,
	selectors: (string | glob.IRelativePattern)[],
	extension: ExtensionIdentifier;
	extensionLocation: URI,
	preloads: URI[];
	providerHandle?: number;
	executeNotebook(viewType: string, uri: URI, handle: number | undefined): Promise<void>;

}

export interface INotebookKernelInfoDto {
	id: string;
	label: string,
	extensionLocation: URI;
	preloads?: UriComponents[];
}

export interface INotebookSelectors {
	readonly filenamePattern?: string;
}

export interface IStreamOutput {
	outputKind: CellOutputKind.Text;
	text: string;
}

export interface IErrorOutput {
	outputKind: CellOutputKind.Error;
	/**
	 * Exception Name
	 */
	ename?: string;
	/**
	 * Exception Value
	 */
	evalue?: string;
	/**
	 * Exception call stacks
	 */
	traceback?: string[];
}

export interface NotebookCellOutputMetadata {
	/**
	 * Additional attributes of a cell metadata.
	 */
	custom?: { [key: string]: unknown };
}

export interface IDisplayOutput {
	outputKind: CellOutputKind.Rich;
	/**
	 * { mime_type: value }
	 */
	data: { [key: string]: unknown; }

	metadata?: NotebookCellOutputMetadata;
}

export enum MimeTypeRendererResolver {
	Core,
	Active,
	Lazy
}

export interface IOrderedMimeType {
	mimeType: string;
	isResolved: boolean;
	rendererId?: string;
	output?: string;
}

export interface ITransformedDisplayOutputDto {
	outputKind: CellOutputKind.Rich;
	outputId: string;
	data: { [key: string]: unknown; }
	metadata?: NotebookCellOutputMetadata;

	orderedMimeTypes?: IOrderedMimeType[];
	pickedMimeTypeIndex?: number;
}

export interface IGenericOutput {
	outputKind: CellOutputKind;
	pickedMimeType?: string;
	pickedRenderer?: number;
	transformedOutput?: { [key: string]: IDisplayOutput };
}

export type IProcessedOutput = ITransformedDisplayOutputDto | IStreamOutput | IErrorOutput;

export type IRawOutput = IDisplayOutput | IStreamOutput | IErrorOutput;

export interface IOutputRenderRequestOutputInfo {
	index: number;
	outputId: string;
	handlerId: string;
	mimeType: string;
	output?: IRawOutput;
}

export interface IOutputRenderRequestCellInfo<T> {
	key: T;
	outputs: IOutputRenderRequestOutputInfo[];
}

export interface IOutputRenderRequest<T> {
	items: IOutputRenderRequestCellInfo<T>[];
}

export interface IOutputRenderResponseOutputInfo {
	index: number;
	outputId: string;
	mimeType: string;
	handlerId: string;
	transformedOutput: string;
}

export interface IOutputRenderResponseCellInfo<T> {
	key: T;
	outputs: IOutputRenderResponseOutputInfo[];
}


export interface IOutputRenderResponse<T> {
	items: IOutputRenderResponseCellInfo<T>[];
}


export interface ICell {
	readonly uri: URI;
	handle: number;
	language: string;
	cellKind: CellKind;
	outputs: IProcessedOutput[];
	metadata?: NotebookCellMetadata;
	onDidChangeOutputs?: Event<NotebookCellOutputsSplice[]>;
	onDidChangeLanguage: Event<string>;
	onDidChangeMetadata: Event<void>;
}

export interface LanguageInfo {
	file_extension: string;
}

export interface IMetadata {
	language_info: LanguageInfo;
}

export interface INotebookTextModel {
	handle: number;
	viewType: string;
	metadata: NotebookDocumentMetadata
	readonly uri: URI;
	readonly versionId: number;
	languages: string[];
	cells: ICell[];
	renderers: Set<string>;
	onDidChangeCells?: Event<{ synchronous: boolean, splices: NotebookCellTextModelSplice[] }>;
	onDidChangeContent: Event<void>;
	onWillDispose(listener: () => void): IDisposable;
}

export interface IRenderOutput {
	shadowContent?: string;
	hasDynamicHeight: boolean;
}

export type NotebookCellTextModelSplice = [
	number /* start */,
	number,
	ICell[]
];

export type NotebookCellOutputsSplice = [
	number /* start */,
	number /* delete count */,
	IProcessedOutput[]
];

export interface IMainCellDto {
	handle: number;
	uri: UriComponents,
	source: string[];
	eol: string;
	language: string;
	cellKind: CellKind;
	outputs: IProcessedOutput[];
	metadata?: NotebookCellMetadata;
}

export type NotebookCellsSplice2 = [
	number /* start */,
	number /* delete count */,
	IMainCellDto[]
];

export enum NotebookCellsChangeType {
	ModelChange = 1,
	Move = 2,
	CellClearOutput = 3,
	CellsClearOutput = 4,
	ChangeLanguage = 5,
	Initialize = 6
}

export interface NotebookCellsInitializeEvent {
	readonly kind: NotebookCellsChangeType.Initialize;
	readonly changes: NotebookCellsSplice2[];
	readonly versionId: number;
}

export interface NotebookCellsModelChangedEvent {
	readonly kind: NotebookCellsChangeType.ModelChange;
	readonly changes: NotebookCellsSplice2[];
	readonly versionId: number;
}

export interface NotebookCellsModelMoveEvent {
	readonly kind: NotebookCellsChangeType.Move;
	readonly index: number;
	readonly newIdx: number;
	readonly versionId: number;
}

export interface NotebookCellClearOutputEvent {
	readonly kind: NotebookCellsChangeType.CellClearOutput;
	readonly index: number;
	readonly versionId: number;
}

export interface NotebookCellsClearOutputEvent {
	readonly kind: NotebookCellsChangeType.CellsClearOutput;
	readonly versionId: number;
}

export interface NotebookCellsChangeLanguageEvent {
	readonly kind: NotebookCellsChangeType.ChangeLanguage;
	readonly versionId: number;
	readonly index: number;
	readonly language: string;
}

export type NotebookCellsChangedEvent = NotebookCellsInitializeEvent | NotebookCellsModelChangedEvent | NotebookCellsModelMoveEvent | NotebookCellClearOutputEvent | NotebookCellsClearOutputEvent | NotebookCellsChangeLanguageEvent;
export enum CellEditType {
	Insert = 1,
	Delete = 2
}

export interface ICellDto2 {
	source: string | string[];
	language: string;
	cellKind: CellKind;
	outputs: IProcessedOutput[];
	metadata?: NotebookCellMetadata;
}

export interface ICellInsertEdit {
	editType: CellEditType.Insert;
	index: number;
	cells: ICellDto2[];
}

export interface ICellDeleteEdit {
	editType: CellEditType.Delete;
	index: number;
	count: number;
}

export type ICellEditOperation = ICellInsertEdit | ICellDeleteEdit;

export interface INotebookEditData {
	documentVersionId: number;
	edits: ICellEditOperation[];
	renderers: number[];
}

export interface NotebookDataDto {
	readonly cells: ICellDto2[];
	readonly languages: string[];
	readonly metadata: NotebookDocumentMetadata;
}


export namespace CellUri {

	export const scheme = 'vscode-notebook-cell';
	const _regex = /^\d{7,}/;

	export function generate(notebook: URI, handle: number): URI {
		return notebook.with({
			scheme,
			fragment: `${handle.toString().padStart(7, '0')}${notebook.scheme !== Schemas.file ? notebook.scheme : ''}`
		});
	}

	export function parse(cell: URI): { notebook: URI, handle: number } | undefined {
		if (cell.scheme !== scheme) {
			return undefined;
		}
		const match = _regex.exec(cell.fragment);
		if (!match) {
			return undefined;
		}
		const handle = Number(match[0]);
		return {
			handle,
			notebook: cell.with({
				scheme: cell.fragment.substr(match[0].length) || Schemas.file,
				fragment: null
			})
		};
	}
}

export function mimeTypeSupportedByCore(mimeType: string) {
	if ([
		'application/json',
		'application/javascript',
		'text/html',
		'image/svg+xml',
		'text/markdown',
		'image/png',
		'image/jpeg',
		'text/plain',
		'text/x-javascript'
	].indexOf(mimeType) > -1) {
		return true;
	}

	return false;
}

// if (isWindows) {
// 	value = value.replace(/\//g, '\\');
// }

function matchGlobUniversal(pattern: string, path: string) {
	if (isWindows) {
		pattern = pattern.replace(/\//g, '\\');
		path = path.replace(/\//g, '\\');
	}

	return glob.match(pattern, path);
}


function getMimeTypeOrder(mimeType: string, userDisplayOrder: string[], documentDisplayOrder: string[], defaultOrder: string[]) {
	let order = 0;
	for (let i = 0; i < userDisplayOrder.length; i++) {
		if (matchGlobUniversal(userDisplayOrder[i], mimeType)) {
			return order;
		}
		order++;
	}

	for (let i = 0; i < documentDisplayOrder.length; i++) {
		if (matchGlobUniversal(documentDisplayOrder[i], mimeType)) {
			return order;
		}

		order++;
	}

	for (let i = 0; i < defaultOrder.length; i++) {
		if (matchGlobUniversal(defaultOrder[i], mimeType)) {
			return order;
		}

		order++;
	}

	return order;
}

export function sortMimeTypes(mimeTypes: string[], userDisplayOrder: string[], documentDisplayOrder: string[], defaultOrder: string[]) {
	const sorted = mimeTypes.sort((a, b) => {
		return getMimeTypeOrder(a, userDisplayOrder, documentDisplayOrder, defaultOrder) - getMimeTypeOrder(b, userDisplayOrder, documentDisplayOrder, defaultOrder);
	});

	return sorted;
}

interface IMutableSplice<T> extends ISplice<T> {
	deleteCount: number;
}

export function diff<T>(before: T[], after: T[], contains: (a: T) => boolean): ISplice<T>[] {
	const result: IMutableSplice<T>[] = [];

	function pushSplice(start: number, deleteCount: number, toInsert: T[]): void {
		if (deleteCount === 0 && toInsert.length === 0) {
			return;
		}

		const latest = result[result.length - 1];

		if (latest && latest.start + latest.deleteCount === start) {
			latest.deleteCount += deleteCount;
			latest.toInsert.push(...toInsert);
		} else {
			result.push({ start, deleteCount, toInsert });
		}
	}

	let beforeIdx = 0;
	let afterIdx = 0;

	while (true) {
		if (beforeIdx === before.length) {
			pushSplice(beforeIdx, 0, after.slice(afterIdx));
			break;
		}

		if (afterIdx === after.length) {
			pushSplice(beforeIdx, before.length - beforeIdx, []);
			break;
		}

		const beforeElement = before[beforeIdx];
		const afterElement = after[afterIdx];

		if (beforeElement === afterElement) {
			// equal
			beforeIdx += 1;
			afterIdx += 1;
			continue;
		}

		if (contains(afterElement)) {
			// `afterElement` exists before, which means some elements before `afterElement` are deleted
			pushSplice(beforeIdx, 1, []);
			beforeIdx += 1;
		} else {
			// `afterElement` added
			pushSplice(beforeIdx, 0, [afterElement]);
			afterIdx += 1;
		}
	}

	return result;
}

export interface ICellEditorViewState {
	selections: editorCommon.ICursorState[];
}

export const NOTEBOOK_EDITOR_CURSOR_BOUNDARY = new RawContextKey<'none' | 'top' | 'bottom' | 'both'>('notebookEditorCursorAtBoundary', 'none');


export interface INotebookEditorModel extends IEditorModel {
	readonly onDidChangeDirty: Event<void>;
	readonly resource: URI;
	readonly viewType: string;
	readonly notebook: NotebookTextModel;
	isDirty(): boolean;
	isUntitled(): boolean;
	save(): Promise<boolean>;
	saveAs(target: URI): Promise<boolean>;
	revert(options?: IRevertOptions | undefined): Promise<void>;
}

export interface INotebookTextModelBackup {
	metadata: NotebookDocumentMetadata;
	languages: string[];
	cells: ICellDto2[]
}

export interface NotebookDocumentBackupData {
	readonly viewType: string;
	readonly name: string;
	readonly backupId?: string;
	readonly mtime?: number;
}

export interface IEditor extends editorCommon.ICompositeCodeEditor {
	readonly onDidChangeModel: Event<NotebookTextModel | undefined>;
	readonly onDidFocusEditorWidget: Event<void>;
	isNotebookEditor: boolean;
	uri?: URI;
	textModel?: NotebookTextModel;
	getId(): string;
	hasFocus(): boolean;
	hasModel(): boolean;
}

export enum NotebookEditorPriority {
	default = 'default',
	option = 'option',
}

export interface INotebookSearchOptions {
	regex?: boolean;
	wholeWord?: boolean;
	caseSensitive?: boolean
	wordSeparators?: string;
}

export interface INotebookDocumentFilter {
	viewType?: string;
	filenamePattern?: string | glob.IRelativePattern;
	excludeFileNamePattern?: string | glob.IRelativePattern;
}

//TODO@rebornix test
export function notebookDocumentFilterMatch(filter: INotebookDocumentFilter, viewType: string, resource: URI): boolean {
	if (filter.viewType === viewType) {
		return true;
	}

	if (filter.filenamePattern) {
		if (glob.match(filter.filenamePattern, basename(resource.fsPath).toLowerCase())) {
			if (filter.excludeFileNamePattern) {
				if (glob.match(filter.excludeFileNamePattern, basename(resource.fsPath).toLowerCase())) {
					// should exclude

					return false;
				}
			}
			return true;
		}
	}
	return false;
}

export interface INotebookKernelInfoDto2 {
	id: string;
	label: string;
	extension: ExtensionIdentifier;
	extensionLocation: URI;
	providerHandle?: number;
	description?: string;
	isPreferred?: boolean;
	preloads?: UriComponents[];
}

export interface INotebookKernelInfo2 extends INotebookKernelInfoDto2 {
	resolve(uri: URI, editorId: string, token: CancellationToken): Promise<void>;
	executeNotebookCell?(uri: URI, handle: number | undefined): Promise<void>;
	cancelNotebookCell?(uri: URI, handle: number | undefined): Promise<void>;
}

export interface INotebookKernelProvider {
	providerExtensionId: string;
	providerDescription?: string;
	selector: INotebookDocumentFilter;
	onDidChangeKernels: Event<void>;
	provideKernels(uri: URI, token: CancellationToken): Promise<INotebookKernelInfoDto2[]>;
	resolveKernel(editorId: string, uri: UriComponents, kernelId: string, token: CancellationToken): Promise<void>;
	executeNotebook(uri: URI, kernelId: string, handle: number | undefined): Promise<void>;
}
