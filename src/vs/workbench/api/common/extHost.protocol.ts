/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from 'vs/base/common/buffer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IRemoteConsoleLog } from 'vs/base/common/console';
import { SerializedError } from 'vs/base/common/errors';
import { IRelativePattern } from 'vs/base/common/glob';
import { IMarkdownString } from 'vs/base/common/htmlContent';
import { IDisposable } from 'vs/base/common/lifecycle';
import Severity from 'vs/base/common/severity';
import { URI, UriComponents } from 'vs/base/common/uri';
import { RenderLineNumbersType, TextEditorCursorStyle } from 'vs/editor/common/config/editorOptions';
import { IPosition } from 'vs/editor/common/core/position';
import { IRange } from 'vs/editor/common/core/range';
import { ISelection, Selection } from 'vs/editor/common/core/selection';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { EndOfLineSequence, ISingleEditOperation } from 'vs/editor/common/model';
import { IModelChangedEvent } from 'vs/editor/common/model/mirrorTextModel';
import * as modes from 'vs/editor/common/modes';
import { CharacterPair, CommentRule, EnterAction } from 'vs/editor/common/modes/languageConfiguration';
import { ICommandHandlerDescription } from 'vs/platform/commands/common/commands';
import { ConfigurationTarget, IConfigurationData, IConfigurationChange, IConfigurationOverrides } from 'vs/platform/configuration/common/configuration';
import { ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import * as files from 'vs/platform/files/common/files';
import { ResourceLabelFormatter } from 'vs/platform/label/common/label';
import { LogLevel } from 'vs/platform/log/common/log';
import { IMarkerData } from 'vs/platform/markers/common/markers';
import { IProgressOptions, IProgressStep } from 'vs/platform/progress/common/progress';
import * as quickInput from 'vs/platform/quickinput/common/quickInput';
import { RemoteAuthorityResolverErrorCode, ResolverResult, TunnelDescription } from 'vs/platform/remote/common/remoteAuthorityResolver';
import * as statusbar from 'vs/workbench/services/statusbar/common/statusbar';
import { ClassifiedEvent, GDPRClassification, StrictPropertyCheck } from 'vs/platform/telemetry/common/gdprTypings';
import { ITelemetryInfo } from 'vs/platform/telemetry/common/telemetry';
import { ThemeColor } from 'vs/platform/theme/common/themeService';
import { EditorViewColumn } from 'vs/workbench/api/common/shared/editor';
import * as tasks from 'vs/workbench/api/common/shared/tasks';
import { IRevealOptions, ITreeItem } from 'vs/workbench/common/views';
import { IAdapterDescriptor, IConfig, IDebugSessionReplMode } from 'vs/workbench/contrib/debug/common/debug';
import { ITextQueryBuilderOptions } from 'vs/workbench/contrib/search/common/queryBuilder';
import { ITerminalDimensions, IShellLaunchConfig } from 'vs/workbench/contrib/terminal/common/terminal';
import { ExtensionActivationError } from 'vs/workbench/services/extensions/common/extensions';
import { createExtHostContextProxyIdentifier as createExtId, createMainContextProxyIdentifier as createMainId, IRPCProtocol } from 'vs/workbench/services/extensions/common/proxyIdentifier';
import * as search from 'vs/workbench/services/search/common/search';
import { SaveReason } from 'vs/workbench/common/editor';
import { ExtensionActivationReason } from 'vs/workbench/api/common/extHostExtensionActivator';
import { TunnelDto } from 'vs/workbench/api/common/extHostTunnelService';
import { TunnelOptions } from 'vs/platform/remote/common/tunnel';
import { Timeline, TimelineChangeEvent, TimelineOptions, TimelineProviderDescriptor, InternalTimelineOptions } from 'vs/workbench/contrib/timeline/common/timeline';
import { revive } from 'vs/base/common/marshalling';
import { INotebookMimeTypeSelector, IOutput, INotebookDisplayOrder, NotebookCellMetadata, NotebookDocumentMetadata, ICellEditOperation, NotebookCellsChangedEvent } from 'vs/workbench/services/notebook/common/notebookCommon';
import { CallHierarchyItem } from 'vs/workbench/contrib/callHierarchy/common/callHierarchy';
import { Dto } from 'vs/base/common/types';
import { ISerializableEnvironmentVariableCollection } from 'vs/workbench/contrib/terminal/common/environmentVariable';

export interface IEnvironment {
	isExtensionDevelopmentDebug: boolean;
	appName: string;
	appRoot?: URI;
	appLanguage: string;
	appUriScheme: string;
	appSettingsHome?: URI;
	extensionDevelopmentLocationURI?: URI[];
	extensionTestsLocationURI?: URI;
	globalStorageHome: URI;
	userHome: URI;
	webviewResourceRoot: string;
	webviewCspSource: string;
	useHostProxy?: boolean;
}

export interface IStaticWorkspaceData {
	id: string;
	name: string;
	configuration?: UriComponents | null;
	isUntitled?: boolean | null;
}

export interface IWorkspaceData extends IStaticWorkspaceData {
	folders: { uri: UriComponents, name: string, index: number; }[];
}

export interface IInitData {
	version: string;
	commit?: string;
	parentPid: number;
	environment: IEnvironment;
	workspace?: IStaticWorkspaceData | null;
	resolvedExtensions: ExtensionIdentifier[];
	hostExtensions: ExtensionIdentifier[];
	extensions: IExtensionDescription[];
	telemetryInfo: ITelemetryInfo;
	logLevel: LogLevel;
	logsLocation: URI;
	logFile: URI;
	autoStart: boolean;
	remote: { isRemote: boolean; authority: string | undefined; };
	uiKind: UIKind;
}

export interface IConfigurationInitData extends IConfigurationData {
	configurationScopes: [string, ConfigurationScope | undefined][];
}

export interface IExtHostContext extends IRPCProtocol {
	remoteAuthority: string;
}

export interface IMainContext extends IRPCProtocol {
}

export enum UIKind {
	Desktop = 1,
	Web = 2
}

// --- main thread

export interface MainThreadClipboardShape extends IDisposable {
	$readText(): Promise<string>;
	$writeText(value: string): Promise<void>;
}

export interface MainThreadCommandsShape extends IDisposable {
	$registerCommand(id: string): void;
	$unregisterCommand(id: string): void;
	$executeCommand<T>(id: string, args: any[], retry: boolean): Promise<T | undefined>;
	$getCommands(): Promise<string[]>;
}

export interface CommentProviderFeatures {
	reactionGroup?: modes.CommentReaction[];
	reactionHandler?: boolean;
}

export type CommentThreadChanges = Partial<{
	range: IRange,
	label: string,
	contextValue: string,
	comments: modes.Comment[],
	collapseState: modes.CommentThreadCollapsibleState;
}>;

export interface MainThreadCommentsShape extends IDisposable {
	$registerCommentController(handle: number, id: string, label: string): void;
	$unregisterCommentController(handle: number): void;
	$updateCommentControllerFeatures(handle: number, features: CommentProviderFeatures): void;
	$createCommentThread(handle: number, commentThreadHandle: number, threadId: string, resource: UriComponents, range: IRange, extensionId: ExtensionIdentifier): modes.CommentThread | undefined;
	$updateCommentThread(handle: number, commentThreadHandle: number, threadId: string, resource: UriComponents, changes: CommentThreadChanges): void;
	$deleteCommentThread(handle: number, commentThreadHandle: number): void;
	$onDidCommentThreadsChange(handle: number, event: modes.CommentThreadChangedEvent): void;
}

export interface MainThreadAuthenticationShape extends IDisposable {
	$registerAuthenticationProvider(id: string, displayName: string): void;
	$unregisterAuthenticationProvider(id: string): void;
	$onDidChangeSessions(providerId: string, event: modes.AuthenticationSessionsChangeEvent): void;
	$getSessionsPrompt(providerId: string, accountName: string, providerName: string, extensionId: string, extensionName: string): Promise<boolean>;
	$loginPrompt(providerName: string, extensionName: string): Promise<boolean>;
	$setTrustedExtension(providerId: string, accountName: string, extensionId: string, extensionName: string): Promise<void>;
}

export interface MainThreadConfigurationShape extends IDisposable {
	$updateConfigurationOption(target: ConfigurationTarget | null, key: string, value: any, overrides: IConfigurationOverrides | undefined, scopeToLanguage: boolean | undefined): Promise<void>;
	$removeConfigurationOption(target: ConfigurationTarget | null, key: string, overrides: IConfigurationOverrides | undefined, scopeToLanguage: boolean | undefined): Promise<void>;
}

export interface MainThreadDiagnosticsShape extends IDisposable {
	$changeMany(owner: string, entries: [UriComponents, IMarkerData[] | undefined][]): void;
	$clear(owner: string): void;
}

export interface MainThreadDialogOpenOptions {
	defaultUri?: UriComponents;
	openLabel?: string;
	canSelectFiles?: boolean;
	canSelectFolders?: boolean;
	canSelectMany?: boolean;
	filters?: { [name: string]: string[]; };
	title?: string;
}

export interface MainThreadDialogSaveOptions {
	defaultUri?: UriComponents;
	saveLabel?: string;
	filters?: { [name: string]: string[]; };
	title?: string;
}

export interface MainThreadDiaglogsShape extends IDisposable {
	$showOpenDialog(options: MainThreadDialogOpenOptions): Promise<UriComponents[] | undefined>;
	$showSaveDialog(options: MainThreadDialogSaveOptions): Promise<UriComponents | undefined>;
}

export interface MainThreadDecorationsShape extends IDisposable {
	$registerDecorationProvider(handle: number, label: string): void;
	$unregisterDecorationProvider(handle: number): void;
	$onDidChange(handle: number, resources: UriComponents[] | null): void;
}

export interface MainThreadDocumentContentProvidersShape extends IDisposable {
	$registerTextContentProvider(handle: number, scheme: string): void;
	$unregisterTextContentProvider(handle: number): void;
	$onVirtualDocumentChange(uri: UriComponents, value: string): void;
}

export interface MainThreadDocumentsShape extends IDisposable {
	$tryCreateDocument(options?: { language?: string; content?: string; }): Promise<UriComponents>;
	$tryOpenDocument(uri: UriComponents): Promise<void>;
	$trySaveDocument(uri: UriComponents): Promise<boolean>;
}

export interface ITextEditorConfigurationUpdate {
	tabSize?: number | 'auto';
	indentSize?: number | 'tabSize';
	insertSpaces?: boolean | 'auto';
	cursorStyle?: TextEditorCursorStyle;
	lineNumbers?: RenderLineNumbersType;
}

export interface IResolvedTextEditorConfiguration {
	tabSize: number;
	indentSize: number;
	insertSpaces: boolean;
	cursorStyle: TextEditorCursorStyle;
	lineNumbers: RenderLineNumbersType;
}

export enum TextEditorRevealType {
	Default = 0,
	InCenter = 1,
	InCenterIfOutsideViewport = 2,
	AtTop = 3
}

export interface IUndoStopOptions {
	undoStopBefore: boolean;
	undoStopAfter: boolean;
}

export interface IApplyEditsOptions extends IUndoStopOptions {
	setEndOfLine?: EndOfLineSequence;
}

export interface ITextDocumentShowOptions {
	position?: EditorViewColumn;
	preserveFocus?: boolean;
	pinned?: boolean;
	selection?: IRange;
}

export interface MainThreadTextEditorsShape extends IDisposable {
	$tryShowTextDocument(resource: UriComponents, options: ITextDocumentShowOptions): Promise<string | undefined>;
	$registerTextEditorDecorationType(key: string, options: editorCommon.IDecorationRenderOptions): void;
	$removeTextEditorDecorationType(key: string): void;
	$tryShowEditor(id: string, position: EditorViewColumn): Promise<void>;
	$tryHideEditor(id: string): Promise<void>;
	$trySetOptions(id: string, options: ITextEditorConfigurationUpdate): Promise<void>;
	$trySetDecorations(id: string, key: string, ranges: editorCommon.IDecorationOptions[]): Promise<void>;
	$trySetDecorationsFast(id: string, key: string, ranges: number[]): Promise<void>;
	$tryRevealRange(id: string, range: IRange, revealType: TextEditorRevealType): Promise<void>;
	$trySetSelections(id: string, selections: ISelection[]): Promise<void>;
	$tryApplyEdits(id: string, modelVersionId: number, edits: ISingleEditOperation[], opts: IApplyEditsOptions): Promise<boolean>;
	$tryApplyWorkspaceEdit(workspaceEditDto: IWorkspaceEditDto): Promise<boolean>;
	$tryInsertSnippet(id: string, template: string, selections: readonly IRange[], opts: IUndoStopOptions): Promise<boolean>;
	$getDiffInformation(id: string): Promise<editorCommon.ILineChange[]>;
}

export interface MainThreadTreeViewsShape extends IDisposable {
	$registerTreeViewDataProvider(treeViewId: string, options: { showCollapseAll: boolean, canSelectMany: boolean; }): void;
	$refresh(treeViewId: string, itemsToRefresh?: { [treeItemHandle: string]: ITreeItem; }): Promise<void>;
	$reveal(treeViewId: string, treeItem: ITreeItem, parentChain: ITreeItem[], options: IRevealOptions): Promise<void>;
	$setMessage(treeViewId: string, message: string): void;
	$setTitle(treeViewId: string, title: string): void;
}

export interface MainThreadDownloadServiceShape extends IDisposable {
	$download(uri: UriComponents, to: UriComponents): Promise<void>;
}

export interface MainThreadErrorsShape extends IDisposable {
	$onUnexpectedError(err: any | SerializedError): void;
}

export interface MainThreadConsoleShape extends IDisposable {
	$logExtensionHostMessage(msg: IRemoteConsoleLog): void;
}

export interface MainThreadKeytarShape extends IDisposable {
	$getPassword(service: string, account: string): Promise<string | null>;
	$setPassword(service: string, account: string, password: string): Promise<void>;
	$deletePassword(service: string, account: string): Promise<boolean>;
	$findPassword(service: string): Promise<string | null>;
	$findCredentials(service: string): Promise<Array<{ account: string, password: string; }>>;
}

export interface IRegExpDto {
	pattern: string;
	flags?: string;
}
export interface IIndentationRuleDto {
	decreaseIndentPattern: IRegExpDto;
	increaseIndentPattern: IRegExpDto;
	indentNextLinePattern?: IRegExpDto;
	unIndentedLinePattern?: IRegExpDto;
}
export interface IOnEnterRuleDto {
	beforeText: IRegExpDto;
	afterText?: IRegExpDto;
	oneLineAboveText?: IRegExpDto;
	action: EnterAction;
}
export interface ILanguageConfigurationDto {
	comments?: CommentRule;
	brackets?: CharacterPair[];
	wordPattern?: IRegExpDto;
	indentationRules?: IIndentationRuleDto;
	onEnterRules?: IOnEnterRuleDto[];
	__electricCharacterSupport?: {
		brackets?: any;
		docComment?: {
			scope: string;
			open: string;
			lineStart: string;
			close?: string;
		};
	};
	__characterPairSupport?: {
		autoClosingPairs: {
			open: string;
			close: string;
			notIn?: string[];
		}[];
	};
}

export type GlobPattern = string | { base: string; pattern: string; };

export interface IDocumentFilterDto {
	$serialized: true;
	language?: string;
	scheme?: string;
	pattern?: string | IRelativePattern;
	exclusive?: boolean;
}

export interface ISignatureHelpProviderMetadataDto {
	readonly triggerCharacters: readonly string[];
	readonly retriggerCharacters: readonly string[];
}

export interface MainThreadLanguageFeaturesShape extends IDisposable {
	$unregister(handle: number): void;
	$registerDocumentSymbolProvider(handle: number, selector: IDocumentFilterDto[], label: string): void;
	$registerCodeLensSupport(handle: number, selector: IDocumentFilterDto[], eventHandle: number | undefined): void;
	$emitCodeLensEvent(eventHandle: number, event?: any): void;
	$registerDefinitionSupport(handle: number, selector: IDocumentFilterDto[]): void;
	$registerDeclarationSupport(handle: number, selector: IDocumentFilterDto[]): void;
	$registerImplementationSupport(handle: number, selector: IDocumentFilterDto[]): void;
	$registerTypeDefinitionSupport(handle: number, selector: IDocumentFilterDto[]): void;
	$registerHoverProvider(handle: number, selector: IDocumentFilterDto[]): void;
	$registerEvaluatableExpressionProvider(handle: number, selector: IDocumentFilterDto[]): void;
	$registerDocumentHighlightProvider(handle: number, selector: IDocumentFilterDto[]): void;
	$registerOnTypeRenameProvider(handle: number, selector: IDocumentFilterDto[], stopPattern: IRegExpDto | undefined): void;
	$registerReferenceSupport(handle: number, selector: IDocumentFilterDto[]): void;
	$registerQuickFixSupport(handle: number, selector: IDocumentFilterDto[], metadata: ICodeActionProviderMetadataDto, displayName: string): void;
	$registerDocumentFormattingSupport(handle: number, selector: IDocumentFilterDto[], extensionId: ExtensionIdentifier, displayName: string): void;
	$registerRangeFormattingSupport(handle: number, selector: IDocumentFilterDto[], extensionId: ExtensionIdentifier, displayName: string): void;
	$registerOnTypeFormattingSupport(handle: number, selector: IDocumentFilterDto[], autoFormatTriggerCharacters: string[], extensionId: ExtensionIdentifier): void;
	$registerNavigateTypeSupport(handle: number): void;
	$registerRenameSupport(handle: number, selector: IDocumentFilterDto[], supportsResolveInitialValues: boolean): void;
	$registerDocumentSemanticTokensProvider(handle: number, selector: IDocumentFilterDto[], legend: modes.SemanticTokensLegend, eventHandle: number | undefined): void;
	$emitDocumentSemanticTokensEvent(eventHandle: number): void;
	$registerDocumentRangeSemanticTokensProvider(handle: number, selector: IDocumentFilterDto[], legend: modes.SemanticTokensLegend): void;
	$registerSuggestSupport(handle: number, selector: IDocumentFilterDto[], triggerCharacters: string[], supportsResolveDetails: boolean, extensionId: ExtensionIdentifier): void;
	$registerSignatureHelpProvider(handle: number, selector: IDocumentFilterDto[], metadata: ISignatureHelpProviderMetadataDto): void;
	$registerDocumentLinkProvider(handle: number, selector: IDocumentFilterDto[], supportsResolve: boolean): void;
	$registerDocumentColorProvider(handle: number, selector: IDocumentFilterDto[]): void;
	$registerFoldingRangeProvider(handle: number, selector: IDocumentFilterDto[]): void;
	$registerSelectionRangeProvider(handle: number, selector: IDocumentFilterDto[]): void;
	$registerCallHierarchyProvider(handle: number, selector: IDocumentFilterDto[]): void;
	$setLanguageConfiguration(handle: number, languageId: string, configuration: ILanguageConfigurationDto): void;
}

export interface MainThreadLanguagesShape extends IDisposable {
	$getLanguages(): Promise<string[]>;
	$changeLanguage(resource: UriComponents, languageId: string): Promise<void>;
}

export interface MainThreadMessageOptions {
	extension?: IExtensionDescription;
	modal?: boolean;
}

export interface MainThreadMessageServiceShape extends IDisposable {
	$showMessage(severity: Severity, message: string, options: MainThreadMessageOptions, commands: { title: string; isCloseAffordance: boolean; handle: number; }[]): Promise<number | undefined>;
}

export interface MainThreadOutputServiceShape extends IDisposable {
	$register(label: string, log: boolean, file?: UriComponents): Promise<string>;
	$append(channelId: string, value: string): Promise<void> | undefined;
	$update(channelId: string): Promise<void> | undefined;
	$clear(channelId: string, till: number): Promise<void> | undefined;
	$reveal(channelId: string, preserveFocus: boolean): Promise<void> | undefined;
	$close(channelId: string): Promise<void> | undefined;
	$dispose(channelId: string): Promise<void> | undefined;
}

export interface MainThreadProgressShape extends IDisposable {

	$startProgress(handle: number, options: IProgressOptions, extension?: IExtensionDescription): void;
	$progressReport(handle: number, message: IProgressStep): void;
	$progressEnd(handle: number): void;
}

export interface TerminalLaunchConfig {
	name?: string;
	shellPath?: string;
	shellArgs?: string[] | string;
	cwd?: string | UriComponents;
	env?: { [key: string]: string | null; };
	waitOnExit?: boolean;
	strictEnv?: boolean;
	hideFromUser?: boolean;
	isExtensionTerminal?: boolean;
}

export interface MainThreadTerminalServiceShape extends IDisposable {
	$createTerminal(config: TerminalLaunchConfig): Promise<{ id: number, name: string; }>;
	$dispose(terminalId: number): void;
	$hide(terminalId: number): void;
	$sendText(terminalId: number, text: string, addNewLine: boolean): void;
	$show(terminalId: number, preserveFocus: boolean): void;
	$startSendingDataEvents(): void;
	$stopSendingDataEvents(): void;
	$startHandlingLinks(): void;
	$stopHandlingLinks(): void;
	$setEnvironmentVariableCollection(extensionIdentifier: string, persistent: boolean, collection: ISerializableEnvironmentVariableCollection | undefined): void;

	// Process
	$sendProcessTitle(terminalId: number, title: string): void;
	$sendProcessData(terminalId: number, data: string): void;
	$sendProcessReady(terminalId: number, pid: number, cwd: string): void;
	$sendProcessExit(terminalId: number, exitCode: number | undefined): void;
	$sendProcessInitialCwd(terminalId: number, cwd: string): void;
	$sendProcessCwd(terminalId: number, initialCwd: string): void;
	$sendOverrideDimensions(terminalId: number, dimensions: ITerminalDimensions | undefined): void;
	$sendResolvedLaunchConfig(terminalId: number, shellLaunchConfig: IShellLaunchConfig): void;
}

export interface TransferQuickPickItems extends quickInput.IQuickPickItem {
	handle: number;
}

export interface TransferQuickInputButton {
	handle: number;
	iconPath: { dark: URI; light?: URI; } | { id: string; };
	tooltip?: string;
}

export type TransferQuickInput = TransferQuickPick | TransferInputBox;

export interface BaseTransferQuickInput {

	[key: string]: any;

	id: number;

	type?: 'quickPick' | 'inputBox';

	enabled?: boolean;

	busy?: boolean;

	visible?: boolean;
}

export interface TransferQuickPick extends BaseTransferQuickInput {

	type?: 'quickPick';

	value?: string;

	placeholder?: string;

	buttons?: TransferQuickInputButton[];

	items?: TransferQuickPickItems[];

	activeItems?: number[];

	selectedItems?: number[];

	canSelectMany?: boolean;

	ignoreFocusOut?: boolean;

	matchOnDescription?: boolean;

	matchOnDetail?: boolean;

	sortByLabel?: boolean;
}

export interface TransferInputBox extends BaseTransferQuickInput {

	type?: 'inputBox';

	value?: string;

	placeholder?: string;

	password?: boolean;

	buttons?: TransferQuickInputButton[];

	prompt?: string;

	validationMessage?: string;
}

export interface IInputBoxOptions {
	value?: string;
	valueSelection?: [number, number];
	prompt?: string;
	placeHolder?: string;
	password?: boolean;
	ignoreFocusOut?: boolean;
}

export interface MainThreadQuickOpenShape extends IDisposable {
	$show(instance: number, options: quickInput.IPickOptions<TransferQuickPickItems>, token: CancellationToken): Promise<number | number[] | undefined>;
	$setItems(instance: number, items: TransferQuickPickItems[]): Promise<void>;
	$setError(instance: number, error: Error): Promise<void>;
	$input(options: IInputBoxOptions | undefined, validateInput: boolean, token: CancellationToken): Promise<string>;
	$createOrUpdate(params: TransferQuickInput): Promise<void>;
	$dispose(id: number): Promise<void>;
}

export interface MainThreadStatusBarShape extends IDisposable {
	$setEntry(id: number, statusId: string, statusName: string, text: string, tooltip: string | undefined, command: ICommandDto | undefined, color: string | ThemeColor | undefined, alignment: statusbar.StatusbarAlignment, priority: number | undefined): void;
	$dispose(id: number): void;
}

export interface MainThreadStorageShape extends IDisposable {
	$getValue<T>(shared: boolean, key: string): Promise<T | undefined>;
	$setValue(shared: boolean, key: string, value: object): Promise<void>;
}

export interface MainThreadTelemetryShape extends IDisposable {
	$publicLog(eventName: string, data?: any): void;
	$publicLog2<E extends ClassifiedEvent<T> = never, T extends GDPRClassification<T> = never>(eventName: string, data?: StrictPropertyCheck<T, E>): void;
}

export interface MainThreadEditorInsetsShape extends IDisposable {
	$createEditorInset(handle: number, id: string, uri: UriComponents, line: number, height: number, options: modes.IWebviewOptions, extensionId: ExtensionIdentifier, extensionLocation: UriComponents): Promise<void>;
	$disposeEditorInset(handle: number): void;

	$setHtml(handle: number, value: string): void;
	$setOptions(handle: number, options: modes.IWebviewOptions): void;
	$postMessage(handle: number, value: any): Promise<boolean>;
}

export interface ExtHostEditorInsetsShape {
	$onDidDispose(handle: number): void;
	$onDidReceiveMessage(handle: number, message: any): void;
}

export type WebviewPanelHandle = string;

export interface WebviewPanelShowOptions {
	readonly viewColumn?: EditorViewColumn;
	readonly preserveFocus?: boolean;
}

export interface WebviewExtensionDescription {
	readonly id: ExtensionIdentifier;
	readonly location: UriComponents;
}

export interface NotebookExtensionDescription {
	readonly id: ExtensionIdentifier;
	readonly location: UriComponents;
}

export enum WebviewEditorCapabilities {
	Editable,
	SupportsHotExit,
}

export interface CustomTextEditorCapabilities {
	readonly supportsMove?: boolean;
}

export interface MainThreadWebviewsShape extends IDisposable {
	$createWebviewPanel(extension: WebviewExtensionDescription, handle: WebviewPanelHandle, viewType: string, title: string, showOptions: WebviewPanelShowOptions, options: modes.IWebviewPanelOptions & modes.IWebviewOptions): void;
	$disposeWebview(handle: WebviewPanelHandle): void;
	$reveal(handle: WebviewPanelHandle, showOptions: WebviewPanelShowOptions): void;
	$setTitle(handle: WebviewPanelHandle, value: string): void;
	$setIconPath(handle: WebviewPanelHandle, value: { light: UriComponents, dark: UriComponents; } | undefined): void;

	$setHtml(handle: WebviewPanelHandle, value: string): void;
	$setOptions(handle: WebviewPanelHandle, options: modes.IWebviewOptions): void;

	$postMessage(handle: WebviewPanelHandle, value: any): Promise<boolean>;

	$registerSerializer(viewType: string): void;
	$unregisterSerializer(viewType: string): void;

	$registerTextEditorProvider(extension: WebviewExtensionDescription, viewType: string, options: modes.IWebviewPanelOptions, capabilities: CustomTextEditorCapabilities): void;
	$registerCustomEditorProvider(extension: WebviewExtensionDescription, viewType: string, options: modes.IWebviewPanelOptions): void;
	$unregisterEditorProvider(viewType: string): void;

	$onDidEdit(resource: UriComponents, viewType: string, editId: number, label: string | undefined): void;
}

export interface WebviewPanelViewStateData {
	[handle: string]: {
		readonly active: boolean;
		readonly visible: boolean;
		readonly position: EditorViewColumn;
	};
}

export interface CustomDocumentEditState {
	readonly allEdits: readonly number[];
	readonly currentIndex: number;
	readonly saveIndex: number;
}

export interface ExtHostWebviewsShape {
	$onMessage(handle: WebviewPanelHandle, message: any): void;
	$onMissingCsp(handle: WebviewPanelHandle, extensionId: string): void;
	$onDidChangeWebviewPanelViewStates(newState: WebviewPanelViewStateData): void;
	$onDidDisposeWebviewPanel(handle: WebviewPanelHandle): Promise<void>;

	$deserializeWebviewPanel(newWebviewHandle: WebviewPanelHandle, viewType: string, title: string, state: any, position: EditorViewColumn, options: modes.IWebviewOptions & modes.IWebviewPanelOptions): Promise<void>;

	$resolveWebviewEditor(resource: UriComponents, newWebviewHandle: WebviewPanelHandle, viewType: string, title: string, position: EditorViewColumn, options: modes.IWebviewOptions & modes.IWebviewPanelOptions, cancellation: CancellationToken): Promise<void>;
	$createWebviewCustomEditorDocument(resource: UriComponents, viewType: string, cancellation: CancellationToken): Promise<{ editable: boolean }>;
	$disposeWebviewCustomEditorDocument(resource: UriComponents, viewType: string): Promise<void>;

	$undo(resource: UriComponents, viewType: string, editId: number, state: CustomDocumentEditState): Promise<void>;
	$redo(resource: UriComponents, viewType: string, editId: number, state: CustomDocumentEditState): Promise<void>;
	$revert(resource: UriComponents, viewType: string, changes: { undoneEdits: number[], redoneEdits: number[] }, state: CustomDocumentEditState): Promise<void>;
	$disposeEdits(resourceComponents: UriComponents, viewType: string, editIds: number[]): void;

	$onSave(resource: UriComponents, viewType: string, cancellation: CancellationToken): Promise<void>;
	$onSaveAs(resource: UriComponents, viewType: string, targetResource: UriComponents): Promise<void>;

	$backup(resource: UriComponents, viewType: string, cancellation: CancellationToken): Promise<void>;

	$onMoveCustomEditor(handle: WebviewPanelHandle, newResource: UriComponents, viewType: string): Promise<void>;
}

export enum CellKind {
	Markdown = 1,
	Code = 2
}

export enum CellOutputKind {
	Text = 1,
	Error = 2,
	Rich = 3
}

export interface ICellDto {
	handle: number;
	uri: UriComponents,
	source: string[];
	language: string;
	cellKind: CellKind;
	outputs: IOutput[];
	metadata?: NotebookCellMetadata;
}

export type NotebookCellsSplice = [
	number /* start */,
	number /* delete count */,
	ICellDto[]
];

export type NotebookCellOutputsSplice = [
	number /* start */,
	number /* delete count */,
	IOutput[]
];

export interface MainThreadNotebookShape extends IDisposable {
	$registerNotebookProvider(extension: NotebookExtensionDescription, viewType: string): Promise<void>;
	$unregisterNotebookProvider(viewType: string): Promise<void>;
	$registerNotebookRenderer(extension: NotebookExtensionDescription, type: string, selectors: INotebookMimeTypeSelector, handle: number, preloads: UriComponents[]): Promise<void>;
	$unregisterNotebookRenderer(handle: number): Promise<void>;
	$createNotebookDocument(handle: number, viewType: string, resource: UriComponents): Promise<void>;
	$tryApplyEdits(viewType: string, resource: UriComponents, modelVersionId: number, edits: ICellEditOperation[], renderers: number[]): Promise<boolean>;
	$updateNotebookLanguages(viewType: string, resource: UriComponents, languages: string[]): Promise<void>;
	$updateNotebookMetadata(viewType: string, resource: UriComponents, metadata: NotebookDocumentMetadata): Promise<void>;
	$updateNotebookCellMetadata(viewType: string, resource: UriComponents, handle: number, metadata: NotebookCellMetadata | undefined): Promise<void>;
	$spliceNotebookCellOutputs(viewType: string, resource: UriComponents, cellHandle: number, splices: NotebookCellOutputsSplice[], renderers: number[]): Promise<void>;
	$postMessage(handle: number, value: any): Promise<boolean>;
}

export interface MainThreadUrlsShape extends IDisposable {
	$registerUriHandler(handle: number, extensionId: ExtensionIdentifier): Promise<void>;
	$unregisterUriHandler(handle: number): Promise<void>;
	$createAppUri(uri: UriComponents): Promise<UriComponents>;
}

export interface ExtHostUrlsShape {
	$handleExternalUri(handle: number, uri: UriComponents): Promise<void>;
}

export interface ITextSearchComplete {
	limitHit?: boolean;
}

export interface MainThreadWorkspaceShape extends IDisposable {
	$startFileSearch(includePattern: string | null, includeFolder: UriComponents | null, excludePatternOrDisregardExcludes: string | false | null, maxResults: number | null, token: CancellationToken): Promise<UriComponents[] | null>;
	$startTextSearch(query: search.IPatternInfo, folder: UriComponents | null, options: ITextQueryBuilderOptions, requestId: number, token: CancellationToken): Promise<ITextSearchComplete | null>;
	$checkExists(folders: UriComponents[], includes: string[], token: CancellationToken): Promise<boolean>;
	$saveAll(includeUntitled?: boolean): Promise<boolean>;
	$updateWorkspaceFolders(extensionName: string, index: number, deleteCount: number, workspaceFoldersToAdd: { uri: UriComponents, name?: string; }[]): Promise<void>;
	$resolveProxy(url: string): Promise<string | undefined>;
}

export interface IFileChangeDto {
	resource: UriComponents;
	type: files.FileChangeType;
}

export interface MainThreadFileSystemShape extends IDisposable {
	$registerFileSystemProvider(handle: number, scheme: string, capabilities: files.FileSystemProviderCapabilities): void;
	$unregisterProvider(handle: number): void;
	$onFileSystemChange(handle: number, resource: IFileChangeDto[]): void;

	$stat(uri: UriComponents): Promise<files.IStat>;
	$readdir(resource: UriComponents): Promise<[string, files.FileType][]>;
	$readFile(resource: UriComponents): Promise<VSBuffer>;
	$writeFile(resource: UriComponents, content: VSBuffer): Promise<void>;
	$rename(resource: UriComponents, target: UriComponents, opts: files.FileOverwriteOptions): Promise<void>;
	$copy(resource: UriComponents, target: UriComponents, opts: files.FileOverwriteOptions): Promise<void>;
	$mkdir(resource: UriComponents): Promise<void>;
	$delete(resource: UriComponents, opts: files.FileDeleteOptions): Promise<void>;
}

export interface MainThreadLabelServiceShape extends IDisposable {
	$registerResourceLabelFormatter(handle: number, formatter: ResourceLabelFormatter): void;
	$unregisterResourceLabelFormatter(handle: number): void;
}

export interface MainThreadSearchShape extends IDisposable {
	$registerFileSearchProvider(handle: number, scheme: string): void;
	$registerTextSearchProvider(handle: number, scheme: string): void;
	$unregisterProvider(handle: number): void;
	$handleFileMatch(handle: number, session: number, data: UriComponents[]): void;
	$handleTextMatch(handle: number, session: number, data: search.IRawFileMatch2[]): void;
	$handleTelemetry(eventName: string, data: any): void;
}

export interface MainThreadTaskShape extends IDisposable {
	$createTaskId(task: tasks.TaskDTO): Promise<string>;
	$registerTaskProvider(handle: number, type: string): Promise<void>;
	$unregisterTaskProvider(handle: number): Promise<void>;
	$fetchTasks(filter?: tasks.TaskFilterDTO): Promise<tasks.TaskDTO[]>;
	$executeTask(task: tasks.TaskHandleDTO | tasks.TaskDTO): Promise<tasks.TaskExecutionDTO>;
	$terminateTask(id: string): Promise<void>;
	$registerTaskSystem(scheme: string, info: tasks.TaskSystemInfoDTO): void;
	$customExecutionComplete(id: string, result?: number): Promise<void>;
}

export interface MainThreadExtensionServiceShape extends IDisposable {
	$activateExtension(extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<void>;
	$onWillActivateExtension(extensionId: ExtensionIdentifier): void;
	$onDidActivateExtension(extensionId: ExtensionIdentifier, codeLoadingTime: number, activateCallTime: number, activateResolvedTime: number, activationReason: ExtensionActivationReason): void;
	$onExtensionActivationError(extensionId: ExtensionIdentifier, error: ExtensionActivationError): Promise<void>;
	$onExtensionRuntimeError(extensionId: ExtensionIdentifier, error: SerializedError): void;
	$onExtensionHostExit(code: number): void;
}

export interface SCMProviderFeatures {
	hasQuickDiffProvider?: boolean;
	count?: number;
	commitTemplate?: string;
	acceptInputCommand?: modes.Command;
	statusBarCommands?: ICommandDto[];
}

export interface SCMGroupFeatures {
	hideWhenEmpty?: boolean;
}

export type SCMRawResource = [
	number /*handle*/,
	UriComponents /*resourceUri*/,
	UriComponents[] /*icons: light, dark*/,
	string /*tooltip*/,
	boolean /*strike through*/,
	boolean /*faded*/
];

export type SCMRawResourceSplice = [
	number /* start */,
	number /* delete count */,
	SCMRawResource[]
];

export type SCMRawResourceSplices = [
	number, /*handle*/
	SCMRawResourceSplice[]
];

export interface MainThreadSCMShape extends IDisposable {
	$registerSourceControl(handle: number, id: string, label: string, rootUri: UriComponents | undefined): void;
	$updateSourceControl(handle: number, features: SCMProviderFeatures): void;
	$unregisterSourceControl(handle: number): void;

	$registerGroup(sourceControlHandle: number, handle: number, id: string, label: string): void;
	$updateGroup(sourceControlHandle: number, handle: number, features: SCMGroupFeatures): void;
	$updateGroupLabel(sourceControlHandle: number, handle: number, label: string): void;
	$unregisterGroup(sourceControlHandle: number, handle: number): void;

	$spliceResourceStates(sourceControlHandle: number, splices: SCMRawResourceSplices[]): void;

	$setInputBoxValue(sourceControlHandle: number, value: string): void;
	$setInputBoxPlaceholder(sourceControlHandle: number, placeholder: string): void;
	$setInputBoxVisibility(sourceControlHandle: number, visible: boolean): void;
	$setValidationProviderIsEnabled(sourceControlHandle: number, enabled: boolean): void;
}

export type DebugSessionUUID = string;

export interface IDebugConfiguration {
	type: string;
	name: string;
	request: string;
	[key: string]: any;
}

export interface IStartDebuggingOptions {
	parentSessionID?: DebugSessionUUID;
	repl?: IDebugSessionReplMode;
}

export interface MainThreadDebugServiceShape extends IDisposable {
	$registerDebugTypes(debugTypes: string[]): void;
	$sessionCached(sessionID: string): void;
	$acceptDAMessage(handle: number, message: DebugProtocol.ProtocolMessage): void;
	$acceptDAError(handle: number, name: string, message: string, stack: string | undefined): void;
	$acceptDAExit(handle: number, code: number | undefined, signal: string | undefined): void;
	$registerDebugConfigurationProvider(type: string, hasProvideMethod: boolean, hasResolveMethod: boolean, hasResolve2Method: boolean, hasProvideDaMethod: boolean, handle: number): Promise<void>;
	$registerDebugAdapterDescriptorFactory(type: string, handle: number): Promise<void>;
	$unregisterDebugConfigurationProvider(handle: number): void;
	$unregisterDebugAdapterDescriptorFactory(handle: number): void;
	$startDebugging(folder: UriComponents | undefined, nameOrConfig: string | IDebugConfiguration, options: IStartDebuggingOptions): Promise<boolean>;
	$setDebugSessionName(id: DebugSessionUUID, name: string): void;
	$customDebugAdapterRequest(id: DebugSessionUUID, command: string, args: any): Promise<any>;
	$appendDebugConsole(value: string): void;
	$startBreakpointEvents(): void;
	$registerBreakpoints(breakpoints: Array<ISourceMultiBreakpointDto | IFunctionBreakpointDto | IDataBreakpointDto>): Promise<void>;
	$unregisterBreakpoints(breakpointIds: string[], functionBreakpointIds: string[], dataBreakpointIds: string[]): Promise<void>;
}

export interface IOpenUriOptions {
	readonly allowTunneling?: boolean;
}

export interface MainThreadWindowShape extends IDisposable {
	$getWindowVisibility(): Promise<boolean>;
	$openUri(uri: UriComponents, uriString: string | undefined, options: IOpenUriOptions): Promise<boolean>;
	$asExternalUri(uri: UriComponents, options: IOpenUriOptions): Promise<UriComponents>;
}

export interface MainThreadTunnelServiceShape extends IDisposable {
	$openTunnel(tunnelOptions: TunnelOptions): Promise<TunnelDto | undefined>;
	$closeTunnel(remote: { host: string, port: number }): Promise<void>;
	$getTunnels(): Promise<TunnelDescription[]>;
	$registerCandidateFinder(): Promise<void>;
	$setTunnelProvider(): Promise<void>;
	$setCandidateFilter(): Promise<void>;
	$tunnelServiceReady(): Promise<void>;
}

export interface MainThreadTimelineShape extends IDisposable {
	$registerTimelineProvider(provider: TimelineProviderDescriptor): void;
	$unregisterTimelineProvider(source: string): void;
	$emitTimelineChangeEvent(e: TimelineChangeEvent): void;
}

// -- extension host

export interface ExtHostCommandsShape {
	$executeContributedCommand<T>(id: string, ...args: any[]): Promise<T>;
	$getContributedCommandHandlerDescriptions(): Promise<{ [id: string]: string | ICommandHandlerDescription; }>;
}

export interface ExtHostConfigurationShape {
	$initializeConfiguration(data: IConfigurationInitData): void;
	$acceptConfigurationChanged(data: IConfigurationInitData, change: IConfigurationChange): void;
}

export interface ExtHostDiagnosticsShape {
	$acceptMarkersChange(data: [UriComponents, IMarkerData[]][]): void;
}

export interface ExtHostDocumentContentProvidersShape {
	$provideTextDocumentContent(handle: number, uri: UriComponents): Promise<string | null | undefined>;
}

export interface IModelAddedData {
	uri: UriComponents;
	versionId: number;
	lines: string[];
	EOL: string;
	modeId: string;
	isDirty: boolean;
}
export interface ExtHostDocumentsShape {
	$acceptModelModeChanged(strURL: UriComponents, oldModeId: string, newModeId: string): void;
	$acceptModelSaved(strURL: UriComponents): void;
	$acceptDirtyStateChanged(strURL: UriComponents, isDirty: boolean): void;
	$acceptModelChanged(strURL: UriComponents, e: IModelChangedEvent, isDirty: boolean): void;
}

export interface ExtHostDocumentSaveParticipantShape {
	$participateInSave(resource: UriComponents, reason: SaveReason): Promise<boolean[]>;
}

export interface ITextEditorAddData {
	id: string;
	documentUri: UriComponents;
	options: IResolvedTextEditorConfiguration;
	selections: ISelection[];
	visibleRanges: IRange[];
	editorPosition: EditorViewColumn | undefined;
}
export interface ITextEditorPositionData {
	[id: string]: EditorViewColumn;
}
export interface IEditorPropertiesChangeData {
	options: IResolvedTextEditorConfiguration | null;
	selections: ISelectionChangeEvent | null;
	visibleRanges: IRange[] | null;
}
export interface ISelectionChangeEvent {
	selections: Selection[];
	source?: string;
}

export interface ExtHostEditorsShape {
	$acceptEditorPropertiesChanged(id: string, props: IEditorPropertiesChangeData): void;
	$acceptEditorPositionData(data: ITextEditorPositionData): void;
}

export interface IDocumentsAndEditorsDelta {
	removedDocuments?: UriComponents[];
	addedDocuments?: IModelAddedData[];
	removedEditors?: string[];
	addedEditors?: ITextEditorAddData[];
	newActiveEditor?: string | null;
}

export interface ExtHostDocumentsAndEditorsShape {
	$acceptDocumentsAndEditorsDelta(delta: IDocumentsAndEditorsDelta): void;
}

export interface ExtHostTreeViewsShape {
	$getChildren(treeViewId: string, treeItemHandle?: string): Promise<ITreeItem[]>;
	$setExpanded(treeViewId: string, treeItemHandle: string, expanded: boolean): void;
	$setSelection(treeViewId: string, treeItemHandles: string[]): void;
	$setVisible(treeViewId: string, visible: boolean): void;
}

export interface ExtHostWorkspaceShape {
	$initializeWorkspace(workspace: IWorkspaceData | null): void;
	$acceptWorkspaceData(workspace: IWorkspaceData | null): void;
	$handleTextSearchResult(result: search.IRawFileMatch2, requestId: number): void;
}

export interface ExtHostFileSystemShape {
	$stat(handle: number, resource: UriComponents): Promise<files.IStat>;
	$readdir(handle: number, resource: UriComponents): Promise<[string, files.FileType][]>;
	$readFile(handle: number, resource: UriComponents): Promise<VSBuffer>;
	$writeFile(handle: number, resource: UriComponents, content: VSBuffer, opts: files.FileWriteOptions): Promise<void>;
	$rename(handle: number, resource: UriComponents, target: UriComponents, opts: files.FileOverwriteOptions): Promise<void>;
	$copy(handle: number, resource: UriComponents, target: UriComponents, opts: files.FileOverwriteOptions): Promise<void>;
	$mkdir(handle: number, resource: UriComponents): Promise<void>;
	$delete(handle: number, resource: UriComponents, opts: files.FileDeleteOptions): Promise<void>;
	$watch(handle: number, session: number, resource: UriComponents, opts: files.IWatchOptions): void;
	$unwatch(handle: number, session: number): void;
	$open(handle: number, resource: UriComponents, opts: files.FileOpenOptions): Promise<number>;
	$close(handle: number, fd: number): Promise<void>;
	$read(handle: number, fd: number, pos: number, length: number): Promise<VSBuffer>;
	$write(handle: number, fd: number, pos: number, data: VSBuffer): Promise<number>;
}

export interface ExtHostLabelServiceShape {
	$registerResourceLabelFormatter(formatter: ResourceLabelFormatter): IDisposable;
}

export interface ExtHostAuthenticationShape {
	$getSessions(id: string): Promise<ReadonlyArray<modes.AuthenticationSession>>;
	$getSessionAccessToken(id: string, sessionId: string): Promise<string>;
	$login(id: string, scopes: string[]): Promise<modes.AuthenticationSession>;
	$logout(id: string, sessionId: string): Promise<void>;
}

export interface ExtHostSearchShape {
	$provideFileSearchResults(handle: number, session: number, query: search.IRawQuery, token: CancellationToken): Promise<search.ISearchCompleteStats>;
	$provideTextSearchResults(handle: number, session: number, query: search.IRawTextQuery, token: CancellationToken): Promise<search.ISearchCompleteStats>;
	$clearCache(cacheKey: string): Promise<void>;
}

export interface IResolveAuthorityErrorResult {
	type: 'error';
	error: {
		message: string | undefined;
		code: RemoteAuthorityResolverErrorCode;
		detail: any;
	};
}

export interface IResolveAuthorityOKResult {
	type: 'ok';
	value: ResolverResult;
}

export type IResolveAuthorityResult = IResolveAuthorityErrorResult | IResolveAuthorityOKResult;

export interface ExtHostExtensionServiceShape {
	$resolveAuthority(remoteAuthority: string, resolveAttempt: number): Promise<IResolveAuthorityResult>;
	$startExtensionHost(enabledExtensionIds: ExtensionIdentifier[]): Promise<void>;
	$activateByEvent(activationEvent: string): Promise<void>;
	$activate(extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<boolean>;
	$setRemoteEnvironment(env: { [key: string]: string | null; }): Promise<void>;

	$deltaExtensions(toAdd: IExtensionDescription[], toRemove: ExtensionIdentifier[]): Promise<void>;

	$test_latency(n: number): Promise<number>;
	$test_up(b: VSBuffer): Promise<number>;
	$test_down(size: number): Promise<VSBuffer>;
}

export interface FileSystemEvents {
	created: UriComponents[];
	changed: UriComponents[];
	deleted: UriComponents[];
}

export interface ExtHostFileSystemEventServiceShape {
	$onFileEvent(events: FileSystemEvents): void;
	$onWillRunFileOperation(operation: files.FileOperation, target: UriComponents, source: UriComponents | undefined, timeout: number, token: CancellationToken): Promise<any>;
	$onDidRunFileOperation(operation: files.FileOperation, target: UriComponents, source: UriComponents | undefined): void;
}

export interface ObjectIdentifier {
	$ident?: number;
}

export namespace ObjectIdentifier {
	export const name = '$ident';
	export function mixin<T>(obj: T, id: number): T & ObjectIdentifier {
		Object.defineProperty(obj, name, { value: id, enumerable: true });
		return <T & ObjectIdentifier>obj;
	}
	export function of(obj: any): number {
		return obj[name];
	}
}

export interface ExtHostHeapServiceShape {
	$onGarbageCollection(ids: number[]): void;
}
export interface IRawColorInfo {
	color: [number, number, number, number];
	range: IRange;
}

export class IdObject {
	_id?: number;
	private static _n = 0;
	static mixin<T extends object>(object: T): T & IdObject {
		(<any>object)._id = IdObject._n++;
		return <any>object;
	}
}

export const enum ISuggestDataDtoField {
	label = 'a',
	kind = 'b',
	detail = 'c',
	documentation = 'd',
	sortText = 'e',
	filterText = 'f',
	preselect = 'g',
	insertText = 'h',
	insertTextRules = 'i',
	range = 'j',
	commitCharacters = 'k',
	additionalTextEdits = 'l',
	command = 'm',
	kindModifier = 'n',

	// to merge into label
	label2 = 'o',
}

export interface ISuggestDataDto {
	[ISuggestDataDtoField.label]: string;
	[ISuggestDataDtoField.label2]?: string | modes.CompletionItemLabel;
	[ISuggestDataDtoField.kind]: modes.CompletionItemKind;
	[ISuggestDataDtoField.detail]?: string;
	[ISuggestDataDtoField.documentation]?: string | IMarkdownString;
	[ISuggestDataDtoField.sortText]?: string;
	[ISuggestDataDtoField.filterText]?: string;
	[ISuggestDataDtoField.preselect]?: true;
	[ISuggestDataDtoField.insertText]?: string;
	[ISuggestDataDtoField.insertTextRules]?: modes.CompletionItemInsertTextRule;
	[ISuggestDataDtoField.range]?: IRange | { insert: IRange, replace: IRange; };
	[ISuggestDataDtoField.commitCharacters]?: string[];
	[ISuggestDataDtoField.additionalTextEdits]?: ISingleEditOperation[];
	[ISuggestDataDtoField.command]?: modes.Command;
	[ISuggestDataDtoField.kindModifier]?: modes.CompletionItemTag[];
	// not-standard
	x?: ChainedCacheId;
}

export const enum ISuggestResultDtoField {
	defaultRanges = 'a',
	completions = 'b',
	isIncomplete = 'c'
}

export interface ISuggestResultDto {
	[ISuggestResultDtoField.defaultRanges]: { insert: IRange, replace: IRange; };
	[ISuggestResultDtoField.completions]: ISuggestDataDto[];
	[ISuggestResultDtoField.isIncomplete]: undefined | true;
	x?: number;
}

export interface ISignatureHelpDto {
	id: CacheId;
	signatures: modes.SignatureInformation[];
	activeSignature: number;
	activeParameter: number;
}

export interface ISignatureHelpContextDto {
	readonly triggerKind: modes.SignatureHelpTriggerKind;
	readonly triggerCharacter?: string;
	readonly isRetrigger: boolean;
	readonly activeSignatureHelp?: ISignatureHelpDto;
}

export interface ILocationDto {
	uri: UriComponents;
	range: IRange;
}

export interface IDefinitionLinkDto {
	originSelectionRange?: IRange;
	uri: UriComponents;
	range: IRange;
	targetSelectionRange?: IRange;
}

export interface IWorkspaceSymbolDto extends IdObject {
	name: string;
	containerName?: string;
	kind: modes.SymbolKind;
	location: ILocationDto;
}

export interface IWorkspaceSymbolsDto extends IdObject {
	symbols: IWorkspaceSymbolDto[];
}

export interface IWorkspaceEditEntryMetadataDto {
	needsConfirmation: boolean;
	label: string;
	description?: string;
	iconPath?: { id: string } | UriComponents | { light: UriComponents, dark: UriComponents };
}

export interface IWorkspaceFileEditDto {
	oldUri?: UriComponents;
	newUri?: UriComponents;
	options?: modes.WorkspaceFileEditOptions
	metadata?: IWorkspaceEditEntryMetadataDto;
}

export interface IWorkspaceTextEditDto {
	resource: UriComponents;
	edit: modes.TextEdit;
	modelVersionId?: number;
	metadata?: IWorkspaceEditEntryMetadataDto;
}

export interface IWorkspaceEditDto {
	edits: Array<IWorkspaceFileEditDto | IWorkspaceTextEditDto>;

	// todo@joh reject should go into rename
	rejectReason?: string;
}

export function reviveWorkspaceEditDto(data: IWorkspaceEditDto | undefined): modes.WorkspaceEdit {
	if (data && data.edits) {
		for (const edit of data.edits) {
			if (typeof (<IWorkspaceTextEditDto>edit).resource === 'object') {
				(<IWorkspaceTextEditDto>edit).resource = URI.revive((<IWorkspaceTextEditDto>edit).resource);
			} else {
				(<IWorkspaceFileEditDto>edit).newUri = URI.revive((<IWorkspaceFileEditDto>edit).newUri);
				(<IWorkspaceFileEditDto>edit).oldUri = URI.revive((<IWorkspaceFileEditDto>edit).oldUri);
			}
			if (edit.metadata && edit.metadata.iconPath) {
				edit.metadata = revive(edit.metadata);
			}
		}
	}
	return <modes.WorkspaceEdit>data;
}

export type ICommandDto = ObjectIdentifier & modes.Command;

export interface ICodeActionDto {
	title: string;
	edit?: IWorkspaceEditDto;
	diagnostics?: IMarkerData[];
	command?: ICommandDto;
	kind?: string;
	isPreferred?: boolean;
	disabled?: string;
}

export interface ICodeActionListDto {
	cacheId: number;
	actions: ReadonlyArray<ICodeActionDto>;
}

export interface ICodeActionProviderMetadataDto {
	readonly providedKinds?: readonly string[];
	readonly documentation?: ReadonlyArray<{ readonly kind: string, readonly command: ICommandDto }>;
}

export type CacheId = number;
export type ChainedCacheId = [CacheId, CacheId];

export interface ILinksListDto {
	id?: CacheId;
	links: ILinkDto[];
}

export interface ILinkDto {
	cacheId?: ChainedCacheId;
	range: IRange;
	url?: string | UriComponents;
	tooltip?: string;
}

export interface ICodeLensListDto {
	cacheId?: number;
	lenses: ICodeLensDto[];
}

export interface ICodeLensDto {
	cacheId?: ChainedCacheId;
	range: IRange;
	command?: ICommandDto;
}

export type ICallHierarchyItemDto = Dto<CallHierarchyItem>;

export interface IIncomingCallDto {
	from: ICallHierarchyItemDto;
	fromRanges: IRange[];
}

export interface IOutgoingCallDto {
	fromRanges: IRange[];
	to: ICallHierarchyItemDto;
}

export interface ILanguageWordDefinitionDto {
	languageId: string;
	regexSource: string;
	regexFlags: string
}

export interface ExtHostLanguageFeaturesShape {
	$provideDocumentSymbols(handle: number, resource: UriComponents, token: CancellationToken): Promise<modes.DocumentSymbol[] | undefined>;
	$provideCodeLenses(handle: number, resource: UriComponents, token: CancellationToken): Promise<ICodeLensListDto | undefined>;
	$resolveCodeLens(handle: number, symbol: ICodeLensDto, token: CancellationToken): Promise<ICodeLensDto | undefined>;
	$releaseCodeLenses(handle: number, id: number): void;
	$provideDefinition(handle: number, resource: UriComponents, position: IPosition, token: CancellationToken): Promise<IDefinitionLinkDto[]>;
	$provideDeclaration(handle: number, resource: UriComponents, position: IPosition, token: CancellationToken): Promise<IDefinitionLinkDto[]>;
	$provideImplementation(handle: number, resource: UriComponents, position: IPosition, token: CancellationToken): Promise<IDefinitionLinkDto[]>;
	$provideTypeDefinition(handle: number, resource: UriComponents, position: IPosition, token: CancellationToken): Promise<IDefinitionLinkDto[]>;
	$provideHover(handle: number, resource: UriComponents, position: IPosition, token: CancellationToken): Promise<modes.Hover | undefined>;
	$provideEvaluatableExpression(handle: number, resource: UriComponents, position: IPosition, token: CancellationToken): Promise<modes.EvaluatableExpression | undefined>;
	$provideDocumentHighlights(handle: number, resource: UriComponents, position: IPosition, token: CancellationToken): Promise<modes.DocumentHighlight[] | undefined>;
	$provideOnTypeRenameRanges(handle: number, resource: UriComponents, position: IPosition, token: CancellationToken): Promise<IRange[] | undefined>;
	$provideReferences(handle: number, resource: UriComponents, position: IPosition, context: modes.ReferenceContext, token: CancellationToken): Promise<ILocationDto[] | undefined>;
	$provideCodeActions(handle: number, resource: UriComponents, rangeOrSelection: IRange | ISelection, context: modes.CodeActionContext, token: CancellationToken): Promise<ICodeActionListDto | undefined>;
	$releaseCodeActions(handle: number, cacheId: number): void;
	$provideDocumentFormattingEdits(handle: number, resource: UriComponents, options: modes.FormattingOptions, token: CancellationToken): Promise<ISingleEditOperation[] | undefined>;
	$provideDocumentRangeFormattingEdits(handle: number, resource: UriComponents, range: IRange, options: modes.FormattingOptions, token: CancellationToken): Promise<ISingleEditOperation[] | undefined>;
	$provideOnTypeFormattingEdits(handle: number, resource: UriComponents, position: IPosition, ch: string, options: modes.FormattingOptions, token: CancellationToken): Promise<ISingleEditOperation[] | undefined>;
	$provideWorkspaceSymbols(handle: number, search: string, token: CancellationToken): Promise<IWorkspaceSymbolsDto>;
	$resolveWorkspaceSymbol(handle: number, symbol: IWorkspaceSymbolDto, token: CancellationToken): Promise<IWorkspaceSymbolDto | undefined>;
	$releaseWorkspaceSymbols(handle: number, id: number): void;
	$provideRenameEdits(handle: number, resource: UriComponents, position: IPosition, newName: string, token: CancellationToken): Promise<IWorkspaceEditDto | undefined>;
	$resolveRenameLocation(handle: number, resource: UriComponents, position: IPosition, token: CancellationToken): Promise<modes.RenameLocation | undefined>;
	$provideDocumentSemanticTokens(handle: number, resource: UriComponents, previousResultId: number, token: CancellationToken): Promise<VSBuffer | null>;
	$releaseDocumentSemanticTokens(handle: number, semanticColoringResultId: number): void;
	$provideDocumentRangeSemanticTokens(handle: number, resource: UriComponents, range: IRange, token: CancellationToken): Promise<VSBuffer | null>;
	$provideCompletionItems(handle: number, resource: UriComponents, position: IPosition, context: modes.CompletionContext, token: CancellationToken): Promise<ISuggestResultDto | undefined>;
	$resolveCompletionItem(handle: number, resource: UriComponents, position: IPosition, id: ChainedCacheId, token: CancellationToken): Promise<ISuggestDataDto | undefined>;
	$releaseCompletionItems(handle: number, id: number): void;
	$provideSignatureHelp(handle: number, resource: UriComponents, position: IPosition, context: modes.SignatureHelpContext, token: CancellationToken): Promise<ISignatureHelpDto | undefined>;
	$releaseSignatureHelp(handle: number, id: number): void;
	$provideDocumentLinks(handle: number, resource: UriComponents, token: CancellationToken): Promise<ILinksListDto | undefined>;
	$resolveDocumentLink(handle: number, id: ChainedCacheId, token: CancellationToken): Promise<ILinkDto | undefined>;
	$releaseDocumentLinks(handle: number, id: number): void;
	$provideDocumentColors(handle: number, resource: UriComponents, token: CancellationToken): Promise<IRawColorInfo[]>;
	$provideColorPresentations(handle: number, resource: UriComponents, colorInfo: IRawColorInfo, token: CancellationToken): Promise<modes.IColorPresentation[] | undefined>;
	$provideFoldingRanges(handle: number, resource: UriComponents, context: modes.FoldingContext, token: CancellationToken): Promise<modes.FoldingRange[] | undefined>;
	$provideSelectionRanges(handle: number, resource: UriComponents, positions: IPosition[], token: CancellationToken): Promise<modes.SelectionRange[][]>;
	$prepareCallHierarchy(handle: number, resource: UriComponents, position: IPosition, token: CancellationToken): Promise<ICallHierarchyItemDto[] | undefined>;
	$provideCallHierarchyIncomingCalls(handle: number, sessionId: string, itemId: string, token: CancellationToken): Promise<IIncomingCallDto[] | undefined>;
	$provideCallHierarchyOutgoingCalls(handle: number, sessionId: string, itemId: string, token: CancellationToken): Promise<IOutgoingCallDto[] | undefined>;
	$releaseCallHierarchy(handle: number, sessionId: string): void;
	$setWordDefinitions(wordDefinitions: ILanguageWordDefinitionDto[]): void;
}

export interface ExtHostQuickOpenShape {
	$onItemSelected(handle: number): void;
	$validateInput(input: string): Promise<string | null | undefined>;
	$onDidChangeActive(sessionId: number, handles: number[]): void;
	$onDidChangeSelection(sessionId: number, handles: number[]): void;
	$onDidAccept(sessionId: number): void;
	$onDidChangeValue(sessionId: number, value: string): void;
	$onDidTriggerButton(sessionId: number, handle: number): void;
	$onDidHide(sessionId: number): void;
}

export interface IShellLaunchConfigDto {
	name?: string;
	executable?: string;
	args?: string[] | string;
	cwd?: string | UriComponents;
	env?: { [key: string]: string | null; };
}

export interface IShellDefinitionDto {
	label: string;
	path: string;
}

export interface IShellAndArgsDto {
	shell: string;
	args: string[] | string | undefined;
}

export interface ITerminalDimensionsDto {
	columns: number;
	rows: number;
}

export interface ExtHostTerminalServiceShape {
	$acceptTerminalClosed(id: number, exitCode: number | undefined): void;
	$acceptTerminalOpened(id: number, name: string, shellLaunchConfig: IShellLaunchConfigDto): void;
	$acceptActiveTerminalChanged(id: number | null): void;
	$acceptTerminalProcessId(id: number, processId: number): void;
	$acceptTerminalProcessData(id: number, data: string): void;
	$acceptTerminalTitleChange(id: number, name: string): void;
	$acceptTerminalDimensions(id: number, cols: number, rows: number): void;
	$acceptTerminalMaximumDimensions(id: number, cols: number, rows: number): void;
	$spawnExtHostProcess(id: number, shellLaunchConfig: IShellLaunchConfigDto, activeWorkspaceRootUri: UriComponents | undefined, cols: number, rows: number, isWorkspaceShellAllowed: boolean): void;
	$startExtensionTerminal(id: number, initialDimensions: ITerminalDimensionsDto | undefined): void;
	$acceptProcessInput(id: number, data: string): void;
	$acceptProcessResize(id: number, cols: number, rows: number): void;
	$acceptProcessShutdown(id: number, immediate: boolean): void;
	$acceptProcessRequestInitialCwd(id: number): void;
	$acceptProcessRequestCwd(id: number): void;
	$acceptProcessRequestLatency(id: number): number;
	$acceptWorkspacePermissionsChanged(isAllowed: boolean): void;
	$getAvailableShells(): Promise<IShellDefinitionDto[]>;
	$getDefaultShellAndArgs(useAutomationShell: boolean): Promise<IShellAndArgsDto>;
	$handleLink(id: number, link: string): Promise<boolean>;
	$initEnvironmentVariableCollections(collections: [string, ISerializableEnvironmentVariableCollection][]): void;
}

export interface ExtHostSCMShape {
	$provideOriginalResource(sourceControlHandle: number, uri: UriComponents, token: CancellationToken): Promise<UriComponents | null>;
	$onInputBoxValueChange(sourceControlHandle: number, value: string): void;
	$executeResourceCommand(sourceControlHandle: number, groupHandle: number, handle: number): Promise<void>;
	$validateInput(sourceControlHandle: number, value: string, cursorPosition: number): Promise<[string, number] | undefined>;
	$setSelectedSourceControls(selectedSourceControlHandles: number[]): Promise<void>;
}

export interface ExtHostTaskShape {
	$provideTasks(handle: number, validTypes: { [key: string]: boolean; }): Thenable<tasks.TaskSetDTO>;
	$resolveTask(handle: number, taskDTO: tasks.TaskDTO): Thenable<tasks.TaskDTO | undefined>;
	$onDidStartTask(execution: tasks.TaskExecutionDTO, terminalId: number): void;
	$onDidStartTaskProcess(value: tasks.TaskProcessStartedDTO): void;
	$onDidEndTaskProcess(value: tasks.TaskProcessEndedDTO): void;
	$OnDidEndTask(execution: tasks.TaskExecutionDTO): void;
	$resolveVariables(workspaceFolder: UriComponents, toResolve: { process?: { name: string; cwd?: string; }, variables: string[]; }): Promise<{ process?: string; variables: { [key: string]: string; }; }>;
	$getDefaultShellAndArgs(): Thenable<{ shell: string, args: string[] | string | undefined; }>;
	$jsonTasksSupported(): Thenable<boolean>;
}

export interface IBreakpointDto {
	type: string;
	id?: string;
	enabled: boolean;
	condition?: string;
	hitCondition?: string;
	logMessage?: string;
}

export interface IFunctionBreakpointDto extends IBreakpointDto {
	type: 'function';
	functionName: string;
}

export interface IDataBreakpointDto extends IBreakpointDto {
	type: 'data';
	dataId: string;
	canPersist: boolean;
	label: string;
	accessTypes?: DebugProtocol.DataBreakpointAccessType[];
}

export interface ISourceBreakpointDto extends IBreakpointDto {
	type: 'source';
	uri: UriComponents;
	line: number;
	character: number;
}

export interface IBreakpointsDeltaDto {
	added?: Array<ISourceBreakpointDto | IFunctionBreakpointDto | IDataBreakpointDto>;
	removed?: string[];
	changed?: Array<ISourceBreakpointDto | IFunctionBreakpointDto | IDataBreakpointDto>;
}

export interface ISourceMultiBreakpointDto {
	type: 'sourceMulti';
	uri: UriComponents;
	lines: {
		id: string;
		enabled: boolean;
		condition?: string;
		hitCondition?: string;
		logMessage?: string;
		line: number;
		character: number;
	}[];
}

export interface IDebugSessionFullDto {
	id: DebugSessionUUID;
	type: string;
	name: string;
	folderUri: UriComponents | undefined;
	configuration: IConfig;
}

export type IDebugSessionDto = IDebugSessionFullDto | DebugSessionUUID;

export interface ExtHostDebugServiceShape {
	$substituteVariables(folder: UriComponents | undefined, config: IConfig): Promise<IConfig>;
	$runInTerminal(args: DebugProtocol.RunInTerminalRequestArguments): Promise<number | undefined>;
	$startDASession(handle: number, session: IDebugSessionDto): Promise<void>;
	$stopDASession(handle: number): Promise<void>;
	$sendDAMessage(handle: number, message: DebugProtocol.ProtocolMessage): void;
	$resolveDebugConfiguration(handle: number, folder: UriComponents | undefined, debugConfiguration: IConfig, token: CancellationToken): Promise<IConfig | null | undefined>;
	$resolveDebugConfigurationWithSubstitutedVariables(handle: number, folder: UriComponents | undefined, debugConfiguration: IConfig, token: CancellationToken): Promise<IConfig | null | undefined>;
	$provideDebugConfigurations(handle: number, folder: UriComponents | undefined, token: CancellationToken): Promise<IConfig[]>;
	$legacyDebugAdapterExecutable(handle: number, folderUri: UriComponents | undefined): Promise<IAdapterDescriptor>; // TODO@AW legacy
	$provideDebugAdapter(handle: number, session: IDebugSessionDto): Promise<IAdapterDescriptor>;
	$acceptDebugSessionStarted(session: IDebugSessionDto): void;
	$acceptDebugSessionTerminated(session: IDebugSessionDto): void;
	$acceptDebugSessionActiveChanged(session: IDebugSessionDto | undefined): void;
	$acceptDebugSessionCustomEvent(session: IDebugSessionDto, event: any): void;
	$acceptBreakpointsDelta(delta: IBreakpointsDeltaDto): void;
	$acceptDebugSessionNameChanged(session: IDebugSessionDto, name: string): void;
}


export interface DecorationRequest {
	readonly id: number;
	readonly handle: number;
	readonly uri: UriComponents;
}

export type DecorationData = [number, boolean, string, string, ThemeColor];
export type DecorationReply = { [id: number]: DecorationData; };

export interface ExtHostDecorationsShape {
	$provideDecorations(requests: DecorationRequest[], token: CancellationToken): Promise<DecorationReply>;
}

export interface ExtHostWindowShape {
	$onDidChangeWindowFocus(value: boolean): void;
}

export interface ExtHostLogServiceShape {
	$setLevel(level: LogLevel): void;
}

export interface MainThreadLogShape {
	$log(file: UriComponents, level: LogLevel, args: any[]): void;
}

export interface ExtHostOutputServiceShape {
	$setVisibleChannel(channelId: string | null): void;
}

export interface ExtHostProgressShape {
	$acceptProgressCanceled(handle: number): void;
}

export interface ExtHostCommentsShape {
	$createCommentThreadTemplate(commentControllerHandle: number, uriComponents: UriComponents, range: IRange): void;
	$updateCommentThreadTemplate(commentControllerHandle: number, threadHandle: number, range: IRange): Promise<void>;
	$deleteCommentThread(commentControllerHandle: number, commentThreadHandle: number): void;
	$provideCommentingRanges(commentControllerHandle: number, uriComponents: UriComponents, token: CancellationToken): Promise<IRange[] | undefined>;
	$toggleReaction(commentControllerHandle: number, threadHandle: number, uri: UriComponents, comment: modes.Comment, reaction: modes.CommentReaction): Promise<void>;
}

export interface ExtHostNotebookShape {
	$resolveNotebook(viewType: string, uri: UriComponents): Promise<number | undefined>;
	$executeNotebook(viewType: string, uri: UriComponents, cellHandle: number | undefined): Promise<void>;
	$saveNotebook(viewType: string, uri: UriComponents): Promise<boolean>;
	$updateActiveEditor(viewType: string, uri: UriComponents): Promise<void>;
	$destoryNotebookDocument(viewType: string, uri: UriComponents): Promise<boolean>;
	$acceptDisplayOrder(displayOrder: INotebookDisplayOrder): void;
	$onDidReceiveMessage(uri: UriComponents, message: any): void;
	$acceptModelChanged(uriComponents: UriComponents, event: NotebookCellsChangedEvent): void;
}

export interface ExtHostStorageShape {
	$acceptValue(shared: boolean, key: string, value: object | undefined): void;
}

export interface ExtHostThemingShape {
	$onColorThemeChange(themeType: string): void;
}

export interface MainThreadThemingShape extends IDisposable {
}

export interface ExtHostTunnelServiceShape {
	$findCandidatePorts(): Promise<{ host: string, port: number, detail: string }[]>;
	$filterCandidates(candidates: { host: string, port: number, detail: string }[]): Promise<boolean[]>;
	$forwardPort(tunnelOptions: TunnelOptions): Promise<TunnelDto> | undefined;
	$closeTunnel(remote: { host: string, port: number }): Promise<void>;
	$onDidTunnelsChange(): Promise<void>;
}

export interface ExtHostTimelineShape {
	$getTimeline(source: string, uri: UriComponents, options: TimelineOptions, token: CancellationToken, internalOptions?: InternalTimelineOptions): Promise<Timeline | undefined>;
}

// --- proxy identifiers

export const MainContext = {
	MainThreadAuthentication: createMainId<MainThreadAuthenticationShape>('MainThreadAuthentication'),
	MainThreadClipboard: createMainId<MainThreadClipboardShape>('MainThreadClipboard'),
	MainThreadCommands: createMainId<MainThreadCommandsShape>('MainThreadCommands'),
	MainThreadComments: createMainId<MainThreadCommentsShape>('MainThreadComments'),
	MainThreadConfiguration: createMainId<MainThreadConfigurationShape>('MainThreadConfiguration'),
	MainThreadConsole: createMainId<MainThreadConsoleShape>('MainThreadConsole'),
	MainThreadDebugService: createMainId<MainThreadDebugServiceShape>('MainThreadDebugService'),
	MainThreadDecorations: createMainId<MainThreadDecorationsShape>('MainThreadDecorations'),
	MainThreadDiagnostics: createMainId<MainThreadDiagnosticsShape>('MainThreadDiagnostics'),
	MainThreadDialogs: createMainId<MainThreadDiaglogsShape>('MainThreadDiaglogs'),
	MainThreadDocuments: createMainId<MainThreadDocumentsShape>('MainThreadDocuments'),
	MainThreadDocumentContentProviders: createMainId<MainThreadDocumentContentProvidersShape>('MainThreadDocumentContentProviders'),
	MainThreadTextEditors: createMainId<MainThreadTextEditorsShape>('MainThreadTextEditors'),
	MainThreadEditorInsets: createMainId<MainThreadEditorInsetsShape>('MainThreadEditorInsets'),
	MainThreadErrors: createMainId<MainThreadErrorsShape>('MainThreadErrors'),
	MainThreadTreeViews: createMainId<MainThreadTreeViewsShape>('MainThreadTreeViews'),
	MainThreadDownloadService: createMainId<MainThreadDownloadServiceShape>('MainThreadDownloadService'),
	MainThreadKeytar: createMainId<MainThreadKeytarShape>('MainThreadKeytar'),
	MainThreadLanguageFeatures: createMainId<MainThreadLanguageFeaturesShape>('MainThreadLanguageFeatures'),
	MainThreadLanguages: createMainId<MainThreadLanguagesShape>('MainThreadLanguages'),
	MainThreadLog: createMainId<MainThreadLogShape>('MainThread'),
	MainThreadMessageService: createMainId<MainThreadMessageServiceShape>('MainThreadMessageService'),
	MainThreadOutputService: createMainId<MainThreadOutputServiceShape>('MainThreadOutputService'),
	MainThreadProgress: createMainId<MainThreadProgressShape>('MainThreadProgress'),
	MainThreadQuickOpen: createMainId<MainThreadQuickOpenShape>('MainThreadQuickOpen'),
	MainThreadStatusBar: createMainId<MainThreadStatusBarShape>('MainThreadStatusBar'),
	MainThreadStorage: createMainId<MainThreadStorageShape>('MainThreadStorage'),
	MainThreadTelemetry: createMainId<MainThreadTelemetryShape>('MainThreadTelemetry'),
	MainThreadTerminalService: createMainId<MainThreadTerminalServiceShape>('MainThreadTerminalService'),
	MainThreadWebviews: createMainId<MainThreadWebviewsShape>('MainThreadWebviews'),
	MainThreadUrls: createMainId<MainThreadUrlsShape>('MainThreadUrls'),
	MainThreadWorkspace: createMainId<MainThreadWorkspaceShape>('MainThreadWorkspace'),
	MainThreadFileSystem: createMainId<MainThreadFileSystemShape>('MainThreadFileSystem'),
	MainThreadExtensionService: createMainId<MainThreadExtensionServiceShape>('MainThreadExtensionService'),
	MainThreadSCM: createMainId<MainThreadSCMShape>('MainThreadSCM'),
	MainThreadSearch: createMainId<MainThreadSearchShape>('MainThreadSearch'),
	MainThreadTask: createMainId<MainThreadTaskShape>('MainThreadTask'),
	MainThreadWindow: createMainId<MainThreadWindowShape>('MainThreadWindow'),
	MainThreadLabelService: createMainId<MainThreadLabelServiceShape>('MainThreadLabelService'),
	MainThreadNotebook: createMainId<MainThreadNotebookShape>('MainThreadNotebook'),
	MainThreadTheming: createMainId<MainThreadThemingShape>('MainThreadTheming'),
	MainThreadTunnelService: createMainId<MainThreadTunnelServiceShape>('MainThreadTunnelService'),
	MainThreadTimeline: createMainId<MainThreadTimelineShape>('MainThreadTimeline')
};

export const ExtHostContext = {
	ExtHostCommands: createExtId<ExtHostCommandsShape>('ExtHostCommands'),
	ExtHostConfiguration: createExtId<ExtHostConfigurationShape>('ExtHostConfiguration'),
	ExtHostDiagnostics: createExtId<ExtHostDiagnosticsShape>('ExtHostDiagnostics'),
	ExtHostDebugService: createExtId<ExtHostDebugServiceShape>('ExtHostDebugService'),
	ExtHostDecorations: createExtId<ExtHostDecorationsShape>('ExtHostDecorations'),
	ExtHostDocumentsAndEditors: createExtId<ExtHostDocumentsAndEditorsShape>('ExtHostDocumentsAndEditors'),
	ExtHostDocuments: createExtId<ExtHostDocumentsShape>('ExtHostDocuments'),
	ExtHostDocumentContentProviders: createExtId<ExtHostDocumentContentProvidersShape>('ExtHostDocumentContentProviders'),
	ExtHostDocumentSaveParticipant: createExtId<ExtHostDocumentSaveParticipantShape>('ExtHostDocumentSaveParticipant'),
	ExtHostEditors: createExtId<ExtHostEditorsShape>('ExtHostEditors'),
	ExtHostTreeViews: createExtId<ExtHostTreeViewsShape>('ExtHostTreeViews'),
	ExtHostFileSystem: createExtId<ExtHostFileSystemShape>('ExtHostFileSystem'),
	ExtHostFileSystemEventService: createExtId<ExtHostFileSystemEventServiceShape>('ExtHostFileSystemEventService'),
	ExtHostLanguageFeatures: createExtId<ExtHostLanguageFeaturesShape>('ExtHostLanguageFeatures'),
	ExtHostQuickOpen: createExtId<ExtHostQuickOpenShape>('ExtHostQuickOpen'),
	ExtHostExtensionService: createExtId<ExtHostExtensionServiceShape>('ExtHostExtensionService'),
	ExtHostLogService: createExtId<ExtHostLogServiceShape>('ExtHostLogService'),
	ExtHostTerminalService: createExtId<ExtHostTerminalServiceShape>('ExtHostTerminalService'),
	ExtHostSCM: createExtId<ExtHostSCMShape>('ExtHostSCM'),
	ExtHostSearch: createExtId<ExtHostSearchShape>('ExtHostSearch'),
	ExtHostTask: createExtId<ExtHostTaskShape>('ExtHostTask'),
	ExtHostWorkspace: createExtId<ExtHostWorkspaceShape>('ExtHostWorkspace'),
	ExtHostWindow: createExtId<ExtHostWindowShape>('ExtHostWindow'),
	ExtHostWebviews: createExtId<ExtHostWebviewsShape>('ExtHostWebviews'),
	ExtHostEditorInsets: createExtId<ExtHostEditorInsetsShape>('ExtHostEditorInsets'),
	ExtHostProgress: createMainId<ExtHostProgressShape>('ExtHostProgress'),
	ExtHostComments: createMainId<ExtHostCommentsShape>('ExtHostComments'),
	ExtHostStorage: createMainId<ExtHostStorageShape>('ExtHostStorage'),
	ExtHostUrls: createExtId<ExtHostUrlsShape>('ExtHostUrls'),
	ExtHostOutputService: createMainId<ExtHostOutputServiceShape>('ExtHostOutputService'),
	ExtHosLabelService: createMainId<ExtHostLabelServiceShape>('ExtHostLabelService'),
	ExtHostNotebook: createMainId<ExtHostNotebookShape>('ExtHostNotebook'),
	ExtHostTheming: createMainId<ExtHostThemingShape>('ExtHostTheming'),
	ExtHostTunnelService: createMainId<ExtHostTunnelServiceShape>('ExtHostTunnelService'),
	ExtHostAuthentication: createMainId<ExtHostAuthenticationShape>('ExtHostAuthentication'),
	ExtHostTimeline: createMainId<ExtHostTimelineShape>('ExtHostTimeline')
};
