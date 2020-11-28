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
import { RemoteAuthorityResolverErrorCode, ResolverResult, TunnelDescription, IRemoteConnectionData } from 'vs/platform/remote/common/remoteAuthorityResolver';
import * as statusbar from 'vs/workbench/services/statusbar/common/statusbar';
import { ClassifiedEvent, GDPRClassification, StrictPropertyCheck } from 'vs/platform/telemetry/common/gdprTypings';
import { ITelemetryInfo } from 'vs/platform/telemetry/common/telemetry';
import { ThemeColor } from 'vs/platform/theme/common/themeService';
import * as tasks from 'vs/workbench/api/common/shared/tasks';
import { IRevealOptions, ITreeItem } from 'vs/workbench/common/views';
import { IAdapterDescriptor, IConfig, IDebugSessionReplMode } from 'vs/workbench/contrib/debug/common/debug';
import { ITextQueryBuilderOptions } from 'vs/workbench/contrib/search/common/queryBuilder';
import { ITerminalDimensions, IShellLaunchConfig, ITerminalLaunchError } from 'vs/workbench/contrib/terminal/common/terminal';
import { ActivationKind, ExtensionActivationError } from 'vs/workbench/services/extensions/common/extensions';
import { createExtHostContextProxyIdentifier as createExtId, createMainContextProxyIdentifier as createMainId, IRPCProtocol } from 'vs/workbench/services/extensions/common/proxyIdentifier';
import * as search from 'vs/workbench/services/search/common/search';
import { EditorGroupColumn, SaveReason } from 'vs/workbench/common/editor';
import { ExtensionActivationReason } from 'vs/workbench/api/common/extHostExtensionActivator';
import { TunnelDto } from 'vs/workbench/api/common/extHostTunnelService';
import { TunnelCreationOptions, TunnelOptions } from 'vs/platform/remote/common/tunnel';
import { Timeline, TimelineChangeEvent, TimelineOptions, TimelineProviderDescriptor, InternalTimelineOptions } from 'vs/workbench/contrib/timeline/common/timeline';
import { revive } from 'vs/base/common/marshalling';
import { IProcessedOutput, INotebookDisplayOrder, NotebookCellMetadata, NotebookDocumentMetadata, ICellEditOperation, NotebookCellsChangedEventDto, NotebookDataDto, IMainCellDto, INotebookDocumentFilter, INotebookKernelInfoDto2, TransientMetadata, INotebookCellStatusBarEntry, ICellRange, INotebookDecorationRenderOptions, INotebookExclusiveDocumentFilter } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { CallHierarchyItem } from 'vs/workbench/contrib/callHierarchy/common/callHierarchy';
import { Dto } from 'vs/base/common/types';
import { ISerializableEnvironmentVariableCollection } from 'vs/workbench/contrib/terminal/common/environmentVariable';
import { DebugConfigurationProviderTriggerKind } from 'vs/workbench/api/common/extHostTypes';
import { IAccessibilityInformation } from 'vs/platform/accessibility/common/accessibility';
import { IExtensionIdWithVersion } from 'vs/platform/userDataSync/common/extensionsStorageSync';
import { RunTestForProviderRequest, RunTestsRequest, RunTestsResult, TestsDiff } from 'vs/workbench/contrib/testing/common/testCollection';

export interface IEnvironment {
	isExtensionDevelopmentDebug: boolean;
	appName: string;
	appRoot?: URI;
	appLanguage: string;
	appUriScheme: string;
	extensionDevelopmentLocationURI?: URI[];
	extensionTestsLocationURI?: URI;
	globalStorageHome: URI;
	workspaceStorageHome: URI;
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
	remote: { isRemote: boolean; authority: string | undefined; connectionData: IRemoteConnectionData | null; };
	uiKind: UIKind;
}

export interface IConfigurationInitData extends IConfigurationData {
	configurationScopes: [string, ConfigurationScope | undefined][];
}

export interface IExtHostContext extends IRPCProtocol {
	remoteAuthority: string | null;
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
	options?: modes.CommentOptions;
}

export type CommentThreadChanges = Partial<{
	range: IRange,
	label: string,
	contextValue: string,
	comments: modes.Comment[],
	collapseState: modes.CommentThreadCollapsibleState;
	canReply: boolean;
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
	$registerAuthenticationProvider(id: string, label: string, supportsMultipleAccounts: boolean): void;
	$unregisterAuthenticationProvider(id: string): void;
	$ensureProvider(id: string): Promise<void>;
	$getProviderIds(): Promise<string[]>;
	$sendDidChangeSessions(providerId: string, event: modes.AuthenticationSessionsChangeEvent): void;
	$getSession(providerId: string, scopes: string[], extensionId: string, extensionName: string, options: { createIfNone?: boolean, clearSessionPreference?: boolean }): Promise<modes.AuthenticationSession | undefined>;
	$selectSession(providerId: string, providerName: string, extensionId: string, extensionName: string, potentialSessions: modes.AuthenticationSession[], scopes: string[], clearSessionPreference: boolean): Promise<modes.AuthenticationSession>;
	$getSessionsPrompt(providerId: string, accountName: string, providerName: string, extensionId: string, extensionName: string): Promise<boolean>;
	$loginPrompt(providerName: string, extensionName: string): Promise<boolean>;
	$setTrustedExtensionAndAccountPreference(providerId: string, accountName: string, extensionId: string, extensionName: string, sessionId: string): Promise<void>;
	$requestNewSession(providerId: string, scopes: string[], extensionId: string, extensionName: string): Promise<void>;

	$getSessions(providerId: string): Promise<ReadonlyArray<modes.AuthenticationSession>>;
	$login(providerId: string, scopes: string[]): Promise<modes.AuthenticationSession>;
	$logout(providerId: string, sessionId: string): Promise<void>;

	$getPassword(extensionId: string, key: string): Promise<string | undefined>;
	$setPassword(extensionId: string, key: string, value: string): Promise<void>;
	$deletePassword(extensionId: string, key: string): Promise<void>;
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
	$showOpenDialog(options?: MainThreadDialogOpenOptions): Promise<UriComponents[] | undefined>;
	$showSaveDialog(options?: MainThreadDialogSaveOptions): Promise<UriComponents | undefined>;
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
	$tryOpenDocument(uri: UriComponents): Promise<UriComponents>;
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
	position?: EditorGroupColumn;
	preserveFocus?: boolean;
	pinned?: boolean;
	selection?: IRange;
}

export interface MainThreadBulkEditsShape extends IDisposable {
	$tryApplyWorkspaceEdit(workspaceEditDto: IWorkspaceEditDto, undoRedoGroupId?: number): Promise<boolean>;
}

export interface MainThreadTextEditorsShape extends IDisposable {
	$tryShowTextDocument(resource: UriComponents, options: ITextDocumentShowOptions): Promise<string | undefined>;
	$registerTextEditorDecorationType(key: string, options: editorCommon.IDecorationRenderOptions): void;
	$removeTextEditorDecorationType(key: string): void;
	$tryShowEditor(id: string, position: EditorGroupColumn): Promise<void>;
	$tryHideEditor(id: string): Promise<void>;
	$trySetOptions(id: string, options: ITextEditorConfigurationUpdate): Promise<void>;
	$trySetDecorations(id: string, key: string, ranges: editorCommon.IDecorationOptions[]): Promise<void>;
	$trySetDecorationsFast(id: string, key: string, ranges: number[]): Promise<void>;
	$tryRevealRange(id: string, range: IRange, revealType: TextEditorRevealType): Promise<void>;
	$trySetSelections(id: string, selections: ISelection[]): Promise<void>;
	$tryApplyEdits(id: string, modelVersionId: number, edits: ISingleEditOperation[], opts: IApplyEditsOptions): Promise<boolean>;
	$tryInsertSnippet(id: string, template: string, selections: readonly IRange[], opts: IUndoStopOptions): Promise<boolean>;
	$getDiffInformation(id: string): Promise<editorCommon.ILineChange[]>;
}

export interface MainThreadTreeViewsShape extends IDisposable {
	$registerTreeViewDataProvider(treeViewId: string, options: { showCollapseAll: boolean, canSelectMany: boolean; }): void;
	$refresh(treeViewId: string, itemsToRefresh?: { [treeItemHandle: string]: ITreeItem; }): Promise<void>;
	$reveal(treeViewId: string, itemInfo: { item: ITreeItem, parentChain: ITreeItem[] } | undefined, options: IRevealOptions): Promise<void>;
	$setMessage(treeViewId: string, message: string): void;
	$setTitle(treeViewId: string, title: string, description: string | undefined): void;
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
	$registerLinkedEditingRangeProvider(handle: number, selector: IDocumentFilterDto[]): void;
	$registerReferenceSupport(handle: number, selector: IDocumentFilterDto[]): void;
	$registerQuickFixSupport(handle: number, selector: IDocumentFilterDto[], metadata: ICodeActionProviderMetadataDto, displayName: string, supportsResolve: boolean): void;
	$registerDocumentFormattingSupport(handle: number, selector: IDocumentFilterDto[], extensionId: ExtensionIdentifier, displayName: string): void;
	$registerRangeFormattingSupport(handle: number, selector: IDocumentFilterDto[], extensionId: ExtensionIdentifier, displayName: string): void;
	$registerOnTypeFormattingSupport(handle: number, selector: IDocumentFilterDto[], autoFormatTriggerCharacters: string[], extensionId: ExtensionIdentifier): void;
	$registerNavigateTypeSupport(handle: number): void;
	$registerRenameSupport(handle: number, selector: IDocumentFilterDto[], supportsResolveInitialValues: boolean): void;
	$registerDocumentSemanticTokensProvider(handle: number, selector: IDocumentFilterDto[], legend: modes.SemanticTokensLegend, eventHandle: number | undefined): void;
	$emitDocumentSemanticTokensEvent(eventHandle: number): void;
	$registerDocumentRangeSemanticTokensProvider(handle: number, selector: IDocumentFilterDto[], legend: modes.SemanticTokensLegend): void;
	$registerSuggestSupport(handle: number, selector: IDocumentFilterDto[], triggerCharacters: string[], supportsResolveDetails: boolean, displayName: string): void;
	$registerSignatureHelpProvider(handle: number, selector: IDocumentFilterDto[], metadata: ISignatureHelpProviderMetadataDto): void;
	$registerDocumentLinkProvider(handle: number, selector: IDocumentFilterDto[], supportsResolve: boolean): void;
	$registerDocumentColorProvider(handle: number, selector: IDocumentFilterDto[]): void;
	$registerFoldingRangeProvider(handle: number, selector: IDocumentFilterDto[], eventHandle: number | undefined): void;
	$emitFoldingRangeEvent(eventHandle: number, event?: any): void;
	$registerSelectionRangeProvider(handle: number, selector: IDocumentFilterDto[]): void;
	$registerCallHierarchyProvider(handle: number, selector: IDocumentFilterDto[]): void;
	$setLanguageConfiguration(handle: number, languageId: string, configuration: ILanguageConfigurationDto): void;
}

export interface MainThreadLanguagesShape extends IDisposable {
	$getLanguages(): Promise<string[]>;
	$changeLanguage(resource: UriComponents, languageId: string): Promise<void>;
	$tokensAtPosition(resource: UriComponents, position: IPosition): Promise<undefined | { type: modes.StandardTokenType, range: IRange }>;
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
	isFeatureTerminal?: boolean;
}

export interface MainThreadTerminalServiceShape extends IDisposable {
	$createTerminal(config: TerminalLaunchConfig): Promise<{ id: number, name: string; }>;
	$dispose(terminalId: number): void;
	$hide(terminalId: number): void;
	$sendText(terminalId: number, text: string, addNewLine: boolean): void;
	$show(terminalId: number, preserveFocus: boolean): void;
	$startSendingDataEvents(): void;
	$stopSendingDataEvents(): void;
	$startLinkProvider(): void;
	$stopLinkProvider(): void;
	$registerProcessSupport(isSupported: boolean): void;
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
	$input(options: IInputBoxOptions | undefined, validateInput: boolean, token: CancellationToken): Promise<string | undefined>;
	$createOrUpdate(params: TransferQuickInput): Promise<void>;
	$dispose(id: number): Promise<void>;
}

export interface MainThreadStatusBarShape extends IDisposable {
	$setEntry(id: number, statusId: string, statusName: string, text: string, tooltip: string | undefined, command: ICommandDto | undefined, color: string | ThemeColor | undefined, backgroundColor: string | ThemeColor | undefined, alignment: statusbar.StatusbarAlignment, priority: number | undefined, accessibilityInformation: IAccessibilityInformation | undefined): void;
	$dispose(id: number): void;
}

export interface MainThreadStorageShape extends IDisposable {
	$getValue<T>(shared: boolean, key: string): Promise<T | undefined>;
	$setValue(shared: boolean, key: string, value: object): Promise<void>;
	$registerExtensionStorageKeysToSync(extension: IExtensionIdWithVersion, keys: string[]): void;
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

export type WebviewHandle = string;

export interface WebviewPanelShowOptions {
	readonly viewColumn?: EditorGroupColumn;
	readonly preserveFocus?: boolean;
}

export interface WebviewExtensionDescription {
	readonly id: ExtensionIdentifier;
	readonly location: UriComponents;
}

export interface NotebookExtensionDescription {
	readonly id: ExtensionIdentifier;
	readonly location: UriComponents;
	readonly description?: string;
}

export enum WebviewEditorCapabilities {
	Editable,
	SupportsHotExit,
}

export interface CustomTextEditorCapabilities {
	readonly supportsMove?: boolean;
}

export interface MainThreadWebviewsShape extends IDisposable {
	$setHtml(handle: WebviewHandle, value: string): void;
	$setOptions(handle: WebviewHandle, options: modes.IWebviewOptions): void;
	$postMessage(handle: WebviewHandle, value: any): Promise<boolean>
}

export interface MainThreadWebviewPanelsShape extends IDisposable {
	$createWebviewPanel(extension: WebviewExtensionDescription, handle: WebviewHandle, viewType: string, title: string, showOptions: WebviewPanelShowOptions, options: modes.IWebviewPanelOptions & modes.IWebviewOptions): void;
	$disposeWebview(handle: WebviewHandle): void;
	$reveal(handle: WebviewHandle, showOptions: WebviewPanelShowOptions): void;
	$setTitle(handle: WebviewHandle, value: string): void;
	$setIconPath(handle: WebviewHandle, value: { light: UriComponents, dark: UriComponents; } | undefined): void;

	$registerSerializer(viewType: string): void;
	$unregisterSerializer(viewType: string): void;
}

export interface MainThreadCustomEditorsShape extends IDisposable {
	$registerTextEditorProvider(extension: WebviewExtensionDescription, viewType: string, options: modes.IWebviewPanelOptions, capabilities: CustomTextEditorCapabilities): void;
	$registerCustomEditorProvider(extension: WebviewExtensionDescription, viewType: string, options: modes.IWebviewPanelOptions, supportsMultipleEditorsPerDocument: boolean): void;
	$unregisterEditorProvider(viewType: string): void;

	$onDidEdit(resource: UriComponents, viewType: string, editId: number, label: string | undefined): void;
	$onContentChange(resource: UriComponents, viewType: string): void;
}

export interface MainThreadWebviewViewsShape extends IDisposable {
	$registerWebviewViewProvider(extension: WebviewExtensionDescription, viewType: string, options?: { retainContextWhenHidden?: boolean }): void;
	$unregisterWebviewViewProvider(viewType: string): void;

	$setWebviewViewTitle(handle: WebviewHandle, value: string | undefined): void;
	$setWebviewViewDescription(handle: WebviewHandle, value: string | undefined): void;

	$show(handle: WebviewHandle, preserveFocus: boolean): void;
}

export interface WebviewPanelViewStateData {
	[handle: string]: {
		readonly active: boolean;
		readonly visible: boolean;
		readonly position: EditorGroupColumn;
	};
}

export interface ExtHostWebviewsShape {
	$onMessage(handle: WebviewHandle, message: any): void;
	$onMissingCsp(handle: WebviewHandle, extensionId: string): void;
}

export interface ExtHostWebviewPanelsShape {
	$onDidChangeWebviewPanelViewStates(newState: WebviewPanelViewStateData): void;
	$onDidDisposeWebviewPanel(handle: WebviewHandle): Promise<void>;
	$deserializeWebviewPanel(newWebviewHandle: WebviewHandle, viewType: string, title: string, state: any, position: EditorGroupColumn, options: modes.IWebviewOptions & modes.IWebviewPanelOptions): Promise<void>;
}

export interface ExtHostCustomEditorsShape {
	$resolveWebviewEditor(resource: UriComponents, newWebviewHandle: WebviewHandle, viewType: string, title: string, position: EditorGroupColumn, options: modes.IWebviewOptions & modes.IWebviewPanelOptions, cancellation: CancellationToken): Promise<void>;
	$createCustomDocument(resource: UriComponents, viewType: string, backupId: string | undefined, cancellation: CancellationToken): Promise<{ editable: boolean }>;
	$disposeCustomDocument(resource: UriComponents, viewType: string): Promise<void>;

	$undo(resource: UriComponents, viewType: string, editId: number, isDirty: boolean): Promise<void>;
	$redo(resource: UriComponents, viewType: string, editId: number, isDirty: boolean): Promise<void>;
	$revert(resource: UriComponents, viewType: string, cancellation: CancellationToken): Promise<void>;
	$disposeEdits(resourceComponents: UriComponents, viewType: string, editIds: number[]): void;

	$onSave(resource: UriComponents, viewType: string, cancellation: CancellationToken): Promise<void>;
	$onSaveAs(resource: UriComponents, viewType: string, targetResource: UriComponents, cancellation: CancellationToken): Promise<void>;

	$backup(resource: UriComponents, viewType: string, cancellation: CancellationToken): Promise<string>;

	$onMoveCustomEditor(handle: WebviewHandle, newResource: UriComponents, viewType: string): Promise<void>;
}

export interface ExtHostWebviewViewsShape {
	$resolveWebviewView(webviewHandle: WebviewHandle, viewType: string, title: string | undefined, state: any, cancellation: CancellationToken): Promise<void>;

	$onDidChangeWebviewViewVisibility(webviewHandle: WebviewHandle, visible: boolean): void;

	$disposeWebviewView(webviewHandle: WebviewHandle): void;
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
	outputs: IProcessedOutput[];
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
	IProcessedOutput[]
];

export enum NotebookEditorRevealType {
	Default = 0,
	InCenter = 1,
	InCenterIfOutsideViewport = 2,
}

export interface INotebookDocumentShowOptions {
	position?: EditorGroupColumn;
	preserveFocus?: boolean;
	pinned?: boolean;
	selection?: ICellRange;
}

export type INotebookCellStatusBarEntryDto = Dto<INotebookCellStatusBarEntry>;

export interface MainThreadNotebookShape extends IDisposable {
	$registerNotebookProvider(extension: NotebookExtensionDescription, viewType: string, supportBackup: boolean, options: {
		transientOutputs: boolean;
		transientMetadata: TransientMetadata;
		viewOptions?: { displayName: string; filenamePattern: (string | IRelativePattern | INotebookExclusiveDocumentFilter)[]; exclusive: boolean; };
	}): Promise<void>;
	$updateNotebookProviderOptions(viewType: string, options?: { transientOutputs: boolean; transientMetadata: TransientMetadata; }): Promise<void>;
	$unregisterNotebookProvider(viewType: string): Promise<void>;
	$registerNotebookKernelProvider(extension: NotebookExtensionDescription, handle: number, documentFilter: INotebookDocumentFilter): Promise<void>;
	$unregisterNotebookKernelProvider(handle: number): Promise<void>;
	$onNotebookKernelChange(handle: number, uri: UriComponents | undefined): void;
	$tryApplyEdits(viewType: string, resource: UriComponents, modelVersionId: number, edits: ICellEditOperation[]): Promise<boolean>;
	$updateNotebookLanguages(viewType: string, resource: UriComponents, languages: string[]): Promise<void>;
	$spliceNotebookCellOutputs(viewType: string, resource: UriComponents, cellHandle: number, splices: NotebookCellOutputsSplice[]): Promise<void>;
	$postMessage(editorId: string, forRendererId: string | undefined, value: any): Promise<boolean>;
	$setStatusBarEntry(id: number, statusBarEntry: INotebookCellStatusBarEntryDto): Promise<void>;
	$tryOpenDocument(uriComponents: UriComponents, viewType?: string): Promise<URI>;
	$tryShowNotebookDocument(uriComponents: UriComponents, viewType: string, options: INotebookDocumentShowOptions): Promise<string>;
	$tryRevealRange(id: string, range: ICellRange, revealType: NotebookEditorRevealType): Promise<void>;
	$registerNotebookEditorDecorationType(key: string, options: INotebookDecorationRenderOptions): void;
	$removeNotebookEditorDecorationType(key: string): void;
	$trySetDecorations(id: string, range: ICellRange, decorationKey: string): void;
	$onUndoableContentChange(resource: UriComponents, viewType: string, editId: number, label: string | undefined): void;
	$onContentChange(resource: UriComponents, viewType: string): void;
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
	$checkExists(folders: readonly UriComponents[], includes: string[], token: CancellationToken): Promise<boolean>;
	$saveAll(includeUntitled?: boolean): Promise<boolean>;
	$updateWorkspaceFolders(extensionName: string, index: number, deleteCount: number, workspaceFoldersToAdd: { uri: UriComponents, name?: string; }[]): Promise<void>;
	$resolveProxy(url: string): Promise<string | undefined>;
}

export interface IFileChangeDto {
	resource: UriComponents;
	type: files.FileChangeType;
}

export interface MainThreadFileSystemShape extends IDisposable {
	$registerFileSystemProvider(handle: number, scheme: string, capabilities: files.FileSystemProviderCapabilities): Promise<void>;
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
	$getTaskExecution(value: tasks.TaskHandleDTO | tasks.TaskDTO): Promise<tasks.TaskExecutionDTO>;
	$executeTask(task: tasks.TaskHandleDTO | tasks.TaskDTO): Promise<tasks.TaskExecutionDTO>;
	$terminateTask(id: string): Promise<void>;
	$registerTaskSystem(scheme: string, info: tasks.TaskSystemInfoDTO): void;
	$customExecutionComplete(id: string, result?: number): Promise<void>;
	$registerSupportedExecutions(custom?: boolean, shell?: boolean, process?: boolean): Promise<void>;
}

export interface MainThreadExtensionServiceShape extends IDisposable {
	$activateExtension(extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<void>;
	$onWillActivateExtension(extensionId: ExtensionIdentifier): Promise<void>;
	$onDidActivateExtension(extensionId: ExtensionIdentifier, codeLoadingTime: number, activateCallTime: number, activateResolvedTime: number, activationReason: ExtensionActivationReason): void;
	$onExtensionActivationError(extensionId: ExtensionIdentifier, error: ExtensionActivationError): Promise<void>;
	$onExtensionRuntimeError(extensionId: ExtensionIdentifier, error: SerializedError): void;
	$onExtensionHostExit(code: number): Promise<void>;
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
	boolean /*faded*/,
	string /*context value*/,
	ICommandDto | undefined /*command*/
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

	$registerGroups(sourceControlHandle: number, groups: [number /*handle*/, string /*id*/, string /*label*/, SCMGroupFeatures][], splices: SCMRawResourceSplices[]): void;
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
	noDebug?: boolean;
	compact?: boolean;
}

export interface MainThreadDebugServiceShape extends IDisposable {
	$registerDebugTypes(debugTypes: string[]): void;
	$sessionCached(sessionID: string): void;
	$acceptDAMessage(handle: number, message: DebugProtocol.ProtocolMessage): void;
	$acceptDAError(handle: number, name: string, message: string, stack: string | undefined): void;
	$acceptDAExit(handle: number, code: number | undefined, signal: string | undefined): void;
	$registerDebugConfigurationProvider(type: string, triggerKind: DebugConfigurationProviderTriggerKind, hasProvideMethod: boolean, hasResolveMethod: boolean, hasResolve2Method: boolean, handle: number): Promise<void>;
	$registerDebugAdapterDescriptorFactory(type: string, handle: number): Promise<void>;
	$unregisterDebugConfigurationProvider(handle: number): void;
	$unregisterDebugAdapterDescriptorFactory(handle: number): void;
	$startDebugging(folder: UriComponents | undefined, nameOrConfig: string | IDebugConfiguration, options: IStartDebuggingOptions): Promise<boolean>;
	$stopDebugging(sessionId: DebugSessionUUID | undefined): Promise<void>;
	$setDebugSessionName(id: DebugSessionUUID, name: string): void;
	$customDebugAdapterRequest(id: DebugSessionUUID, command: string, args: any): Promise<any>;
	$getDebugProtocolBreakpoint(id: DebugSessionUUID, breakpoinId: string): Promise<DebugProtocol.Breakpoint | undefined>;
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
	$openTunnel(tunnelOptions: TunnelOptions, source: string | undefined): Promise<TunnelDto | undefined>;
	$closeTunnel(remote: { host: string, port: number }): Promise<void>;
	$getTunnels(): Promise<TunnelDescription[]>;
	$setTunnelProvider(): Promise<void>;
	$tunnelServiceReady(): Promise<void>;
	$onFoundNewCandidates(candidates: { host: string, port: number, detail: string }[]): Promise<void>;
}

export interface MainThreadTimelineShape extends IDisposable {
	$registerTimelineProvider(provider: TimelineProviderDescriptor): void;
	$unregisterTimelineProvider(source: string): void;
	$emitTimelineChangeEvent(e: TimelineChangeEvent | undefined): void;
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
	editorPosition: EditorGroupColumn | undefined;
}
export interface ITextEditorPositionData {
	[id: string]: EditorGroupColumn;
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
	$hasResolve(treeViewId: string): Promise<boolean>;
	$resolve(treeViewId: string, treeItemHandle: string): Promise<ITreeItem | undefined>;
}

export interface ExtHostWorkspaceShape {
	$initializeWorkspace(workspace: IWorkspaceData | null): void;
	$acceptWorkspaceData(workspace: IWorkspaceData | null): void;
	$handleTextSearchResult(result: search.IRawFileMatch2, requestId: number): void;
}

export interface ExtHostFileSystemInfoShape {
	$acceptProviderInfos(scheme: string, capabilities: number | null): void;
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
	$onDidChangeAuthenticationSessions(id: string, label: string, event: modes.AuthenticationSessionsChangeEvent): Promise<void>;
	$onDidChangeAuthenticationProviders(added: modes.AuthenticationProviderInformation[], removed: modes.AuthenticationProviderInformation[]): Promise<void>;
	$setProviders(providers: modes.AuthenticationProviderInformation[]): Promise<void>;
	$onDidChangePassword(): Promise<void>;
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
	$activateByEvent(activationEvent: string, activationKind: ActivationKind): Promise<void>;
	$activate(extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<boolean>;
	$setRemoteEnvironment(env: { [key: string]: string | null; }): Promise<void>;
	$updateRemoteConnectionData(connectionData: IRemoteConnectionData): Promise<void>;

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

export interface SourceTargetPair {
	source?: UriComponents;
	target: UriComponents;
}

export interface ExtHostFileSystemEventServiceShape {
	$onFileEvent(events: FileSystemEvents): void;
	$onWillRunFileOperation(operation: files.FileOperation, files: SourceTargetPair[], undoRedoGroupId: number | undefined, timeout: number, token: CancellationToken): Promise<any>;
	$onDidRunFileOperation(operation: files.FileOperation, files: SourceTargetPair[]): void;
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
	[ISuggestDataDtoField.kind]?: modes.CompletionItemKind;
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
	isIncomplete = 'c',
	duration = 'd',
}

export interface ISuggestResultDto {
	[ISuggestResultDtoField.defaultRanges]: { insert: IRange, replace: IRange; };
	[ISuggestResultDtoField.completions]: ISuggestDataDto[];
	[ISuggestResultDtoField.isIncomplete]: undefined | true;
	[ISuggestResultDtoField.duration]: number;
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

export const enum WorkspaceEditType {
	File = 1,
	Text = 2,
	Cell = 3,
}

export interface IWorkspaceFileEditDto {
	_type: WorkspaceEditType.File;
	oldUri?: UriComponents;
	newUri?: UriComponents;
	options?: modes.WorkspaceFileEditOptions
	metadata?: IWorkspaceEditEntryMetadataDto;
}

export interface IWorkspaceTextEditDto {
	_type: WorkspaceEditType.Text;
	resource: UriComponents;
	edit: modes.TextEdit;
	modelVersionId?: number;
	metadata?: IWorkspaceEditEntryMetadataDto;
}

export interface IWorkspaceCellEditDto {
	_type: WorkspaceEditType.Cell;
	resource: UriComponents;
	edit: ICellEditOperation;
	notebookVersionId?: number;
	metadata?: IWorkspaceEditEntryMetadataDto;
}

export interface IWorkspaceEditDto {
	edits: Array<IWorkspaceFileEditDto | IWorkspaceTextEditDto | IWorkspaceCellEditDto>;

	// todo@jrieken reject should go into rename
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
	cacheId?: ChainedCacheId;
	title: string;
	edit?: IWorkspaceEditDto;
	diagnostics?: IMarkerData[];
	command?: ICommandDto;
	kind?: string;
	isPreferred?: boolean;
	disabled?: string;
}

export interface ICodeActionListDto {
	cacheId: CacheId;
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

export interface ILinkedEditingRangesDto {
	ranges: IRange[];
	wordPattern?: IRegExpDto;
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
	$provideLinkedEditingRanges(handle: number, resource: UriComponents, position: IPosition, token: CancellationToken): Promise<ILinkedEditingRangesDto | undefined>;
	$provideReferences(handle: number, resource: UriComponents, position: IPosition, context: modes.ReferenceContext, token: CancellationToken): Promise<ILocationDto[] | undefined>;
	$provideCodeActions(handle: number, resource: UriComponents, rangeOrSelection: IRange | ISelection, context: modes.CodeActionContext, token: CancellationToken): Promise<ICodeActionListDto | undefined>;
	$resolveCodeAction(handle: number, id: ChainedCacheId, token: CancellationToken): Promise<IWorkspaceEditDto | undefined>;
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
	$resolveCompletionItem(handle: number, id: ChainedCacheId, token: CancellationToken): Promise<ISuggestDataDto | undefined>;
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
	hideFromUser?: boolean;
}

export interface IShellDefinitionDto {
	label: string;
	path: string;
}

export interface IShellAndArgsDto {
	shell: string;
	args: string[] | string | undefined;
}

export interface ITerminalLinkDto {
	/** The ID of the link to enable activation and disposal. */
	id: number;
	/** The startIndex of the link in the line. */
	startIndex: number;
	/** The length of the link in the line. */
	length: number;
	/** The descriptive label for what the link does when activated. */
	label?: string;
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
	$spawnExtHostProcess(id: number, shellLaunchConfig: IShellLaunchConfigDto, activeWorkspaceRootUri: UriComponents | undefined, cols: number, rows: number, isWorkspaceShellAllowed: boolean): Promise<ITerminalLaunchError | undefined>;
	$startExtensionTerminal(id: number, initialDimensions: ITerminalDimensionsDto | undefined): Promise<ITerminalLaunchError | undefined>;
	$acceptProcessInput(id: number, data: string): void;
	$acceptProcessResize(id: number, cols: number, rows: number): void;
	$acceptProcessShutdown(id: number, immediate: boolean): void;
	$acceptProcessRequestInitialCwd(id: number): void;
	$acceptProcessRequestCwd(id: number): void;
	$acceptProcessRequestLatency(id: number): number;
	$acceptWorkspacePermissionsChanged(isAllowed: boolean): void;
	$getAvailableShells(): Promise<IShellDefinitionDto[]>;
	$getDefaultShellAndArgs(useAutomationShell: boolean): Promise<IShellAndArgsDto>;
	$provideLinks(id: number, line: string): Promise<ITerminalLinkDto[]>;
	$activateLink(id: number, linkId: number): void;
	$initEnvironmentVariableCollections(collections: [string, ISerializableEnvironmentVariableCollection][]): void;
}

export interface ExtHostSCMShape {
	$provideOriginalResource(sourceControlHandle: number, uri: UriComponents, token: CancellationToken): Promise<UriComponents | null>;
	$onInputBoxValueChange(sourceControlHandle: number, value: string): void;
	$executeResourceCommand(sourceControlHandle: number, groupHandle: number, handle: number, preserveFocus: boolean): Promise<void>;
	$validateInput(sourceControlHandle: number, value: string, cursorPosition: number): Promise<[string, number] | undefined>;
	$setSelectedSourceControl(selectedSourceControlHandle: number | undefined): Promise<void>;
}

export interface ExtHostTaskShape {
	$provideTasks(handle: number, validTypes: { [key: string]: boolean; }): Thenable<tasks.TaskSetDTO>;
	$resolveTask(handle: number, taskDTO: tasks.TaskDTO): Thenable<tasks.TaskDTO | undefined>;
	$onDidStartTask(execution: tasks.TaskExecutionDTO, terminalId: number, resolvedDefinition: tasks.TaskDefinitionDTO): void;
	$onDidStartTaskProcess(value: tasks.TaskProcessStartedDTO): void;
	$onDidEndTaskProcess(value: tasks.TaskProcessEndedDTO): void;
	$OnDidEndTask(execution: tasks.TaskExecutionDTO): void;
	$resolveVariables(workspaceFolder: UriComponents, toResolve: { process?: { name: string; cwd?: string; }, variables: string[]; }): Promise<{ process?: string; variables: { [key: string]: string; }; }>;
	$getDefaultShellAndArgs(): Thenable<{ shell: string, args: string[] | string | undefined; }>;
	$jsonTasksSupported(): Thenable<boolean>;
	$findExecutable(command: string, cwd?: string, paths?: string[]): Promise<string | undefined>;
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
	readonly uri: UriComponents;
}

export type DecorationData = [boolean, string, string, ThemeColor];
export type DecorationReply = { [id: number]: DecorationData; };

export interface ExtHostDecorationsShape {
	$provideDecorations(handle: number, requests: DecorationRequest[], token: CancellationToken): Promise<DecorationReply>;
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

export interface INotebookSelectionChangeEvent {
	// handles
	selections: number[];
}

export interface INotebookCellVisibleRange {
	start: number;
	end: number;
}

export interface INotebookVisibleRangesEvent {
	ranges: INotebookCellVisibleRange[];
}

export interface INotebookEditorPropertiesChangeData {
	visibleRanges: INotebookVisibleRangesEvent | null;
	selections: INotebookSelectionChangeEvent | null;
}

export interface INotebookDocumentPropertiesChangeData {
	metadata: NotebookDocumentMetadata | null;
}

export interface INotebookModelAddedData {
	uri: UriComponents;
	versionId: number;
	cells: IMainCellDto[],
	viewType: string;
	metadata?: NotebookDocumentMetadata;
	attachedEditor?: { id: string; selections: number[]; visibleRanges: ICellRange[] }
	contentOptions: { transientOutputs: boolean; transientMetadata: TransientMetadata; }
}

export interface INotebookEditorAddData {
	id: string;
	documentUri: UriComponents;
	selections: number[];
	visibleRanges: ICellRange[];
}

export interface INotebookDocumentsAndEditorsDelta {
	removedDocuments?: UriComponents[];
	addedDocuments?: INotebookModelAddedData[];
	removedEditors?: string[];
	addedEditors?: INotebookEditorAddData[];
	newActiveEditor?: string | null;
	visibleEditors?: string[];
}

export interface ExtHostNotebookShape {
	$resolveNotebookData(viewType: string, uri: UriComponents, backupId?: string): Promise<NotebookDataDto>;
	$resolveNotebookEditor(viewType: string, uri: UriComponents, editorId: string): Promise<void>;
	$provideNotebookKernels(handle: number, uri: UriComponents, token: CancellationToken): Promise<INotebookKernelInfoDto2[]>;
	$resolveNotebookKernel(handle: number, editorId: string, uri: UriComponents, kernelId: string, token: CancellationToken): Promise<void>;
	$executeNotebookKernelFromProvider(handle: number, uri: UriComponents, kernelId: string, cellHandle: number | undefined): Promise<void>;
	$cancelNotebookKernelFromProvider(handle: number, uri: UriComponents, kernelId: string, cellHandle: number | undefined): Promise<void>;
	$saveNotebook(viewType: string, uri: UriComponents, token: CancellationToken): Promise<boolean>;
	$saveNotebookAs(viewType: string, uri: UriComponents, target: UriComponents, token: CancellationToken): Promise<boolean>;
	$backup(viewType: string, uri: UriComponents, cancellation: CancellationToken): Promise<string | undefined>;
	$acceptDisplayOrder(displayOrder: INotebookDisplayOrder): void;
	$acceptNotebookActiveKernelChange(event: { uri: UriComponents, providerHandle: number | undefined, kernelId: string | undefined }): void;
	$onDidReceiveMessage(editorId: string, rendererId: string | undefined, message: unknown): void;
	$acceptModelChanged(uriComponents: UriComponents, event: NotebookCellsChangedEventDto, isDirty: boolean): void;
	$acceptModelSaved(uriComponents: UriComponents): void;
	$acceptEditorPropertiesChanged(id: string, data: INotebookEditorPropertiesChangeData): void;
	$acceptDocumentPropertiesChanged(uriComponents: UriComponents, data: INotebookDocumentPropertiesChangeData): void;
	$acceptDocumentAndEditorsDelta(delta: INotebookDocumentsAndEditorsDelta): void;
	$undoNotebook(viewType: string, uri: UriComponents, editId: number, isDirty: boolean): Promise<void>;
	$redoNotebook(viewType: string, uri: UriComponents, editId: number, isDirty: boolean): Promise<void>;

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
	$forwardPort(tunnelOptions: TunnelOptions, tunnelCreationOptions: TunnelCreationOptions): Promise<TunnelDto> | undefined;
	$closeTunnel(remote: { host: string, port: number }, silent?: boolean): Promise<void>;
	$onDidTunnelsChange(): Promise<void>;
}

export interface ExtHostTimelineShape {
	$getTimeline(source: string, uri: UriComponents, options: TimelineOptions, token: CancellationToken, internalOptions?: InternalTimelineOptions): Promise<Timeline | undefined>;
}

export const enum ExtHostTestingResource {
	Workspace,
	TextDocument
}

export interface ExtHostTestingShape {
	$runTestsForProvider(req: RunTestForProviderRequest): Promise<RunTestsResult>;
	$subscribeToTests(resource: ExtHostTestingResource, uri: UriComponents): void;
	$unsubscribeFromTests(resource: ExtHostTestingResource, uri: UriComponents): void;

	$acceptDiff(resource: ExtHostTestingResource, uri: UriComponents, diff: TestsDiff): void;
}

export interface MainThreadTestingShape {
	$registerTestProvider(id: string): void;
	$unregisterTestProvider(id: string): void;
	$subscribeToDiffs(resource: ExtHostTestingResource, uri: UriComponents): void;
	$unsubscribeFromDiffs(resource: ExtHostTestingResource, uri: UriComponents): void;
	$publishDiff(resource: ExtHostTestingResource, uri: UriComponents, diff: TestsDiff): void;
	$runTests(req: RunTestsRequest): Promise<RunTestsResult>;
}

// --- proxy identifiers

export const MainContext = {
	MainThreadAuthentication: createMainId<MainThreadAuthenticationShape>('MainThreadAuthentication'),
	MainThreadBulkEdits: createMainId<MainThreadBulkEditsShape>('MainThreadBulkEdits'),
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
	MainThreadWebviewPanels: createMainId<MainThreadWebviewPanelsShape>('MainThreadWebviewPanels'),
	MainThreadWebviewViews: createMainId<MainThreadWebviewViewsShape>('MainThreadWebviewViews'),
	MainThreadCustomEditors: createMainId<MainThreadCustomEditorsShape>('MainThreadCustomEditors'),
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
	MainThreadTimeline: createMainId<MainThreadTimelineShape>('MainThreadTimeline'),
	MainThreadTesting: createMainId<MainThreadTestingShape>('MainThreadTesting'),
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
	ExtHostFileSystemInfo: createExtId<ExtHostFileSystemInfoShape>('ExtHostFileSystemInfo'),
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
	ExtHostWebviewPanels: createExtId<ExtHostWebviewPanelsShape>('ExtHostWebviewPanels'),
	ExtHostCustomEditors: createExtId<ExtHostCustomEditorsShape>('ExtHostCustomEditors'),
	ExtHostWebviewViews: createExtId<ExtHostWebviewViewsShape>('ExtHostWebviewViews'),
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
	ExtHostTimeline: createMainId<ExtHostTimelineShape>('ExtHostTimeline'),
	ExtHostTesting: createMainId<ExtHostTestingShape>('ExtHostTesting'),
};
