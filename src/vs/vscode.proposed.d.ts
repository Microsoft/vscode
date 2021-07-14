/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This is the place for API experiments and proposals.
 * These API are NOT stable and subject to change. They are only available in the Insiders
 * distribution and CANNOT be used in published extensions.
 *
 * To test these API in local environment:
 * - Use Insiders release of 'VS Code'.
 * - Add `"enableProposedApi": true` to your package.json.
 * - Copy this file to your project.
 */

declare module 'vscode' {

	// eslint-disable-next-line vscode-dts-region-comments
	//#region @alexdima - resolvers

	export interface MessageOptions {
		/**
		 * Do not render a native message box.
		 */
		useCustom?: boolean;
	}

	export interface RemoteAuthorityResolverContext {
		resolveAttempt: number;
	}

	export class ResolvedAuthority {
		readonly host: string;
		readonly port: number;
		readonly connectionToken: string | undefined;

		constructor(host: string, port: number, connectionToken?: string);
	}

	export interface ResolvedOptions {
		extensionHostEnv?: { [key: string]: string | null; };

		isTrusted?: boolean;
	}

	export interface TunnelOptions {
		remoteAddress: { port: number, host: string; };
		// The desired local port. If this port can't be used, then another will be chosen.
		localAddressPort?: number;
		label?: string;
		public?: boolean;
		protocol?: string;
	}

	export interface TunnelDescription {
		remoteAddress: { port: number, host: string; };
		//The complete local address(ex. localhost:1234)
		localAddress: { port: number, host: string; } | string;
		public?: boolean;
		// If protocol is not provided it is assumed to be http, regardless of the localAddress.
		protocol?: string;
	}

	export interface Tunnel extends TunnelDescription {
		// Implementers of Tunnel should fire onDidDispose when dispose is called.
		onDidDispose: Event<void>;
		dispose(): void | Thenable<void>;
	}

	/**
	 * Used as part of the ResolverResult if the extension has any candidate,
	 * published, or forwarded ports.
	 */
	export interface TunnelInformation {
		/**
		 * Tunnels that are detected by the extension. The remotePort is used for display purposes.
		 * The localAddress should be the complete local address (ex. localhost:1234) for connecting to the port. Tunnels provided through
		 * detected are read-only from the forwarded ports UI.
		 */
		environmentTunnels?: TunnelDescription[];

	}

	export interface TunnelCreationOptions {
		/**
		 * True when the local operating system will require elevation to use the requested local port.
		 */
		elevationRequired?: boolean;
	}

	export enum CandidatePortSource {
		None = 0,
		Process = 1,
		Output = 2
	}

	export type ResolverResult = ResolvedAuthority & ResolvedOptions & TunnelInformation;

	export class RemoteAuthorityResolverError extends Error {
		static NotAvailable(message?: string, handled?: boolean): RemoteAuthorityResolverError;
		static TemporarilyNotAvailable(message?: string): RemoteAuthorityResolverError;

		constructor(message?: string);
	}

	export interface RemoteAuthorityResolver {
		/**
		 * Resolve the authority part of the current opened `vscode-remote://` URI.
		 *
		 * This method will be invoked once during the startup of the editor and again each time
		 * the editor detects a disconnection.
		 *
		 * @param authority The authority part of the current opened `vscode-remote://` URI.
		 * @param context A context indicating if this is the first call or a subsequent call.
		 */
		resolve(authority: string, context: RemoteAuthorityResolverContext): ResolverResult | Thenable<ResolverResult>;

		/**
		 * Get the canonical URI (if applicable) for a `vscode-remote://` URI.
		 *
		 * @returns The canonical URI or undefined if the uri is already canonical.
		 */
		getCanonicalURI?(uri: Uri): ProviderResult<Uri>;

		/**
		 * Can be optionally implemented if the extension can forward ports better than the core.
		 * When not implemented, the core will use its default forwarding logic.
		 * When implemented, the core will use this to forward ports.
		 *
		 * To enable the "Change Local Port" action on forwarded ports, make sure to set the `localAddress` of
		 * the returned `Tunnel` to a `{ port: number, host: string; }` and not a string.
		 */
		tunnelFactory?: (tunnelOptions: TunnelOptions, tunnelCreationOptions: TunnelCreationOptions) => Thenable<Tunnel> | undefined;

		/**p
		 * Provides filtering for candidate ports.
		 */
		showCandidatePort?: (host: string, port: number, detail: string) => Thenable<boolean>;

		/**
		 * Lets the resolver declare which tunnel factory features it supports.
		 * UNDER DISCUSSION! MAY CHANGE SOON.
		 */
		tunnelFeatures?: {
			elevation: boolean;
			public: boolean;
		};

		candidatePortSource?: CandidatePortSource;
	}

	export namespace workspace {
		/**
		 * Forwards a port. If the current resolver implements RemoteAuthorityResolver:forwardPort then that will be used to make the tunnel.
		 * By default, openTunnel only support localhost; however, RemoteAuthorityResolver:tunnelFactory can be used to support other ips.
		 *
		 * @throws When run in an environment without a remote.
		 *
		 * @param tunnelOptions The `localPort` is a suggestion only. If that port is not available another will be chosen.
		 */
		export function openTunnel(tunnelOptions: TunnelOptions): Thenable<Tunnel>;

		/**
		 * Gets an array of the currently available tunnels. This does not include environment tunnels, only tunnels that have been created by the user.
		 * Note that these are of type TunnelDescription and cannot be disposed.
		 */
		export let tunnels: Thenable<TunnelDescription[]>;

		/**
		 * Fired when the list of tunnels has changed.
		 */
		export const onDidChangeTunnels: Event<void>;
	}

	export interface ResourceLabelFormatter {
		scheme: string;
		authority?: string;
		formatting: ResourceLabelFormatting;
	}

	export interface ResourceLabelFormatting {
		label: string; // myLabel:/${path}
		// For historic reasons we use an or string here. Once we finalize this API we should start using enums instead and adopt it in extensions.
		// eslint-disable-next-line vscode-dts-literal-or-types
		separator: '/' | '\\' | '';
		tildify?: boolean;
		normalizeDriveLetter?: boolean;
		workspaceSuffix?: string;
		workspaceTooltip?: string;
		authorityPrefix?: string;
		stripPathStartingSeparator?: boolean;
	}

	export namespace workspace {
		export function registerRemoteAuthorityResolver(authorityPrefix: string, resolver: RemoteAuthorityResolver): Disposable;
		export function registerResourceLabelFormatter(formatter: ResourceLabelFormatter): Disposable;
	}

	//#endregion

	//#region editor insets: https://github.com/microsoft/vscode/issues/85682

	export interface WebviewEditorInset {
		readonly editor: TextEditor;
		readonly line: number;
		readonly height: number;
		readonly webview: Webview;
		readonly onDidDispose: Event<void>;
		dispose(): void;
	}

	export namespace window {
		export function createWebviewTextEditorInset(editor: TextEditor, line: number, height: number, options?: WebviewOptions): WebviewEditorInset;
	}

	//#endregion

	//#region read/write in chunks: https://github.com/microsoft/vscode/issues/84515

	export interface FileSystemProvider {
		open?(resource: Uri, options: { create: boolean; }): number | Thenable<number>;
		close?(fd: number): void | Thenable<void>;
		read?(fd: number, pos: number, data: Uint8Array, offset: number, length: number): number | Thenable<number>;
		write?(fd: number, pos: number, data: Uint8Array, offset: number, length: number): number | Thenable<number>;
	}

	//#endregion

	//#region TextSearchProvider: https://github.com/microsoft/vscode/issues/59921

	/**
	 * The parameters of a query for text search.
	 */
	export interface TextSearchQuery {
		/**
		 * The text pattern to search for.
		 */
		pattern: string;

		/**
		 * Whether or not `pattern` should match multiple lines of text.
		 */
		isMultiline?: boolean;

		/**
		 * Whether or not `pattern` should be interpreted as a regular expression.
		 */
		isRegExp?: boolean;

		/**
		 * Whether or not the search should be case-sensitive.
		 */
		isCaseSensitive?: boolean;

		/**
		 * Whether or not to search for whole word matches only.
		 */
		isWordMatch?: boolean;
	}

	/**
	 * A file glob pattern to match file paths against.
	 * TODO@roblourens merge this with the GlobPattern docs/definition in vscode.d.ts.
	 * @see {@link GlobPattern}
	 */
	export type GlobString = string;

	/**
	 * Options common to file and text search
	 */
	export interface SearchOptions {
		/**
		 * The root folder to search within.
		 */
		folder: Uri;

		/**
		 * Files that match an `includes` glob pattern should be included in the search.
		 */
		includes: GlobString[];

		/**
		 * Files that match an `excludes` glob pattern should be excluded from the search.
		 */
		excludes: GlobString[];

		/**
		 * Whether external files that exclude files, like .gitignore, should be respected.
		 * See the vscode setting `"search.useIgnoreFiles"`.
		 */
		useIgnoreFiles: boolean;

		/**
		 * Whether symlinks should be followed while searching.
		 * See the vscode setting `"search.followSymlinks"`.
		 */
		followSymlinks: boolean;

		/**
		 * Whether global files that exclude files, like .gitignore, should be respected.
		 * See the vscode setting `"search.useGlobalIgnoreFiles"`.
		 */
		useGlobalIgnoreFiles: boolean;
	}

	/**
	 * Options to specify the size of the result text preview.
	 * These options don't affect the size of the match itself, just the amount of preview text.
	 */
	export interface TextSearchPreviewOptions {
		/**
		 * The maximum number of lines in the preview.
		 * Only search providers that support multiline search will ever return more than one line in the match.
		 */
		matchLines: number;

		/**
		 * The maximum number of characters included per line.
		 */
		charsPerLine: number;
	}

	/**
	 * Options that apply to text search.
	 */
	export interface TextSearchOptions extends SearchOptions {
		/**
		 * The maximum number of results to be returned.
		 */
		maxResults: number;

		/**
		 * Options to specify the size of the result text preview.
		 */
		previewOptions?: TextSearchPreviewOptions;

		/**
		 * Exclude files larger than `maxFileSize` in bytes.
		 */
		maxFileSize?: number;

		/**
		 * Interpret files using this encoding.
		 * See the vscode setting `"files.encoding"`
		 */
		encoding?: string;

		/**
		 * Number of lines of context to include before each match.
		 */
		beforeContext?: number;

		/**
		 * Number of lines of context to include after each match.
		 */
		afterContext?: number;
	}

	/**
	 * Represents the severiry of a TextSearchComplete message.
	 */
	export enum TextSearchCompleteMessageType {
		Information = 1,
		Warning = 2,
	}

	/**
	 * A message regarding a completed search.
	 */
	export interface TextSearchCompleteMessage {
		/**
		 * Markdown text of the message.
		 */
		text: string,
		/**
		 * Whether the source of the message is trusted, command links are disabled for untrusted message sources.
		 * Messaged are untrusted by default.
		 */
		trusted?: boolean,
		/**
		 * The message type, this affects how the message will be rendered.
		 */
		type: TextSearchCompleteMessageType,
	}

	/**
	 * Information collected when text search is complete.
	 */
	export interface TextSearchComplete {
		/**
		 * Whether the search hit the limit on the maximum number of search results.
		 * `maxResults` on {@link TextSearchOptions `TextSearchOptions`} specifies the max number of results.
		 * - If exactly that number of matches exist, this should be false.
		 * - If `maxResults` matches are returned and more exist, this should be true.
		 * - If search hits an internal limit which is less than `maxResults`, this should be true.
		 */
		limitHit?: boolean;

		/**
		 * Additional information regarding the state of the completed search.
		 *
		 * Messages with "Information" style support links in markdown syntax:
		 * - Click to [run a command](command:workbench.action.OpenQuickPick)
		 * - Click to [open a website](https://aka.ms)
		 *
		 * Commands may optionally return { triggerSearch: true } to signal to the editor that the original search should run be again.
		 */
		message?: TextSearchCompleteMessage | TextSearchCompleteMessage[];
	}

	/**
	 * A preview of the text result.
	 */
	export interface TextSearchMatchPreview {
		/**
		 * The matching lines of text, or a portion of the matching line that contains the match.
		 */
		text: string;

		/**
		 * The Range within `text` corresponding to the text of the match.
		 * The number of matches must match the TextSearchMatch's range property.
		 */
		matches: Range | Range[];
	}

	/**
	 * A match from a text search
	 */
	export interface TextSearchMatch {
		/**
		 * The uri for the matching document.
		 */
		uri: Uri;

		/**
		 * The range of the match within the document, or multiple ranges for multiple matches.
		 */
		ranges: Range | Range[];

		/**
		 * A preview of the text match.
		 */
		preview: TextSearchMatchPreview;
	}

	/**
	 * A line of context surrounding a TextSearchMatch.
	 */
	export interface TextSearchContext {
		/**
		 * The uri for the matching document.
		 */
		uri: Uri;

		/**
		 * One line of text.
		 * previewOptions.charsPerLine applies to this
		 */
		text: string;

		/**
		 * The line number of this line of context.
		 */
		lineNumber: number;
	}

	export type TextSearchResult = TextSearchMatch | TextSearchContext;

	/**
	 * A TextSearchProvider provides search results for text results inside files in the workspace.
	 */
	export interface TextSearchProvider {
		/**
		 * Provide results that match the given text pattern.
		 * @param query The parameters for this query.
		 * @param options A set of options to consider while searching.
		 * @param progress A progress callback that must be invoked for all results.
		 * @param token A cancellation token.
		 */
		provideTextSearchResults(query: TextSearchQuery, options: TextSearchOptions, progress: Progress<TextSearchResult>, token: CancellationToken): ProviderResult<TextSearchComplete>;
	}

	//#endregion

	//#region FileSearchProvider: https://github.com/microsoft/vscode/issues/73524

	/**
	 * The parameters of a query for file search.
	 */
	export interface FileSearchQuery {
		/**
		 * The search pattern to match against file paths.
		 */
		pattern: string;
	}

	/**
	 * Options that apply to file search.
	 */
	export interface FileSearchOptions extends SearchOptions {
		/**
		 * The maximum number of results to be returned.
		 */
		maxResults?: number;

		/**
		 * A CancellationToken that represents the session for this search query. If the provider chooses to, this object can be used as the key for a cache,
		 * and searches with the same session object can search the same cache. When the token is cancelled, the session is complete and the cache can be cleared.
		 */
		session?: CancellationToken;
	}

	/**
	 * A FileSearchProvider provides search results for files in the given folder that match a query string. It can be invoked by quickopen or other extensions.
	 *
	 * A FileSearchProvider is the more powerful of two ways to implement file search in the editor. Use a FileSearchProvider if you wish to search within a folder for
	 * all files that match the user's query.
	 *
	 * The FileSearchProvider will be invoked on every keypress in quickopen. When `workspace.findFiles` is called, it will be invoked with an empty query string,
	 * and in that case, every file in the folder should be returned.
	 */
	export interface FileSearchProvider {
		/**
		 * Provide the set of files that match a certain file path pattern.
		 * @param query The parameters for this query.
		 * @param options A set of options to consider while searching files.
		 * @param token A cancellation token.
		 */
		provideFileSearchResults(query: FileSearchQuery, options: FileSearchOptions, token: CancellationToken): ProviderResult<Uri[]>;
	}

	export namespace workspace {
		/**
		 * Register a search provider.
		 *
		 * Only one provider can be registered per scheme.
		 *
		 * @param scheme The provider will be invoked for workspace folders that have this file scheme.
		 * @param provider The provider.
		 * @return A {@link Disposable} that unregisters this provider when being disposed.
		 */
		export function registerFileSearchProvider(scheme: string, provider: FileSearchProvider): Disposable;

		/**
		 * Register a text search provider.
		 *
		 * Only one provider can be registered per scheme.
		 *
		 * @param scheme The provider will be invoked for workspace folders that have this file scheme.
		 * @param provider The provider.
		 * @return A {@link Disposable} that unregisters this provider when being disposed.
		 */
		export function registerTextSearchProvider(scheme: string, provider: TextSearchProvider): Disposable;
	}

	//#endregion

	//#region findTextInFiles: https://github.com/microsoft/vscode/issues/59924

	/**
	 * Options that can be set on a findTextInFiles search.
	 */
	export interface FindTextInFilesOptions {
		/**
		 * A {@link GlobPattern glob pattern} that defines the files to search for. The glob pattern
		 * will be matched against the file paths of files relative to their workspace. Use a {@link RelativePattern relative pattern}
		 * to restrict the search results to a {@link WorkspaceFolder workspace folder}.
		 */
		include?: GlobPattern;

		/**
		 * A {@link GlobPattern glob pattern} that defines files and folders to exclude. The glob pattern
		 * will be matched against the file paths of resulting matches relative to their workspace. When `undefined`, default excludes will
		 * apply.
		 */
		exclude?: GlobPattern;

		/**
		 * Whether to use the default and user-configured excludes. Defaults to true.
		 */
		useDefaultExcludes?: boolean;

		/**
		 * The maximum number of results to search for
		 */
		maxResults?: number;

		/**
		 * Whether external files that exclude files, like .gitignore, should be respected.
		 * See the vscode setting `"search.useIgnoreFiles"`.
		 */
		useIgnoreFiles?: boolean;

		/**
		 * Whether global files that exclude files, like .gitignore, should be respected.
		 * See the vscode setting `"search.useGlobalIgnoreFiles"`.
		 */
		useGlobalIgnoreFiles?: boolean;

		/**
		 * Whether symlinks should be followed while searching.
		 * See the vscode setting `"search.followSymlinks"`.
		 */
		followSymlinks?: boolean;

		/**
		 * Interpret files using this encoding.
		 * See the vscode setting `"files.encoding"`
		 */
		encoding?: string;

		/**
		 * Options to specify the size of the result text preview.
		 */
		previewOptions?: TextSearchPreviewOptions;

		/**
		 * Number of lines of context to include before each match.
		 */
		beforeContext?: number;

		/**
		 * Number of lines of context to include after each match.
		 */
		afterContext?: number;
	}

	export namespace workspace {
		/**
		 * Search text in files across all {@link workspace.workspaceFolders workspace folders} in the workspace.
		 * @param query The query parameters for the search - the search string, whether it's case-sensitive, or a regex, or matches whole words.
		 * @param callback A callback, called for each result
		 * @param token A token that can be used to signal cancellation to the underlying search engine.
		 * @return A thenable that resolves when the search is complete.
		 */
		export function findTextInFiles(query: TextSearchQuery, callback: (result: TextSearchResult) => void, token?: CancellationToken): Thenable<TextSearchComplete>;

		/**
		 * Search text in files across all {@link workspace.workspaceFolders workspace folders} in the workspace.
		 * @param query The query parameters for the search - the search string, whether it's case-sensitive, or a regex, or matches whole words.
		 * @param options An optional set of query options. Include and exclude patterns, maxResults, etc.
		 * @param callback A callback, called for each result
		 * @param token A token that can be used to signal cancellation to the underlying search engine.
		 * @return A thenable that resolves when the search is complete.
		 */
		export function findTextInFiles(query: TextSearchQuery, options: FindTextInFilesOptions, callback: (result: TextSearchResult) => void, token?: CancellationToken): Thenable<TextSearchComplete>;
	}

	//#endregion

	//#region diff command: https://github.com/microsoft/vscode/issues/84899

	/**
	 * The contiguous set of modified lines in a diff.
	 */
	export interface LineChange {
		readonly originalStartLineNumber: number;
		readonly originalEndLineNumber: number;
		readonly modifiedStartLineNumber: number;
		readonly modifiedEndLineNumber: number;
	}

	export namespace commands {

		/**
		 * Registers a diff information command that can be invoked via a keyboard shortcut,
		 * a menu item, an action, or directly.
		 *
		 * Diff information commands are different from ordinary {@link commands.registerCommand commands} as
		 * they only execute when there is an active diff editor when the command is called, and the diff
		 * information has been computed. Also, the command handler of an editor command has access to
		 * the diff information.
		 *
		 * @param command A unique identifier for the command.
		 * @param callback A command handler function with access to the {@link LineChange diff information}.
		 * @param thisArg The `this` context used when invoking the handler function.
		 * @return Disposable which unregisters this command on disposal.
		 */
		export function registerDiffInformationCommand(command: string, callback: (diff: LineChange[], ...args: any[]) => any, thisArg?: any): Disposable;
	}

	//#endregion

	// eslint-disable-next-line vscode-dts-region-comments
	//#region @weinand: new debug session option 'managedByParent' (see https://github.com/microsoft/vscode/issues/128058)

	/**
	 * Options for {@link debug.startDebugging starting a debug session}.
	 */
	export interface DebugSessionOptions {

		/**
		 * Controls whether lifecycle requests like 'restart' are sent to the newly created session or its parent session.
		 * By default (if the property is false or missing), lifecycle requests are sent to the new session.
		 * This property is ignored if the session has no parent session.
		 */
		lifecycleManagedByParent?: boolean;
	}

	//#endregion

	// eslint-disable-next-line vscode-dts-region-comments
	//#region @weinand: variables view action contributions

	/**
	 * A DebugProtocolVariableContainer is an opaque stand-in type for the intersection of the Scope and Variable types defined in the Debug Adapter Protocol.
	 * See https://microsoft.github.io/debug-adapter-protocol/specification#Types_Scope and https://microsoft.github.io/debug-adapter-protocol/specification#Types_Variable.
	 */
	export interface DebugProtocolVariableContainer {
		// Properties: the intersection of DAP's Scope and Variable types.
	}

	/**
	 * A DebugProtocolVariable is an opaque stand-in type for the Variable type defined in the Debug Adapter Protocol.
	 * See https://microsoft.github.io/debug-adapter-protocol/specification#Types_Variable.
	 */
	export interface DebugProtocolVariable {
		// Properties: see details [here](https://microsoft.github.io/debug-adapter-protocol/specification#Base_Protocol_Variable).
	}

	//#endregion

	// eslint-disable-next-line vscode-dts-region-comments
	//#region @joaomoreno: SCM validation

	/**
	 * Represents the validation type of the Source Control input.
	 */
	export enum SourceControlInputBoxValidationType {

		/**
		 * Something not allowed by the rules of a language or other means.
		 */
		Error = 0,

		/**
		 * Something suspicious but allowed.
		 */
		Warning = 1,

		/**
		 * Something to inform about but not a problem.
		 */
		Information = 2
	}

	export interface SourceControlInputBoxValidation {

		/**
		 * The validation message to display.
		 */
		readonly message: string;

		/**
		 * The validation type.
		 */
		readonly type: SourceControlInputBoxValidationType;
	}

	/**
	 * Represents the input box in the Source Control viewlet.
	 */
	export interface SourceControlInputBox {

		/**
		 * Shows a transient contextual message on the input.
		 */
		showValidationMessage(message: string, type: SourceControlInputBoxValidationType): void;

		/**
		 * A validation function for the input box. It's possible to change
		 * the validation provider simply by setting this property to a different function.
		 */
		validateInput?(value: string, cursorPosition: number): ProviderResult<SourceControlInputBoxValidation>;
	}

	//#endregion

	// eslint-disable-next-line vscode-dts-region-comments
	//#region @joaomoreno: SCM selected provider

	export interface SourceControl {

		/**
		 * Whether the source control is selected.
		 */
		readonly selected: boolean;

		/**
		 * An event signaling when the selection state changes.
		 */
		readonly onDidChangeSelection: Event<boolean>;
	}

	//#endregion

	//#region Terminal data write event https://github.com/microsoft/vscode/issues/78502

	export interface TerminalDataWriteEvent {
		/**
		 * The {@link Terminal} for which the data was written.
		 */
		readonly terminal: Terminal;
		/**
		 * The data being written.
		 */
		readonly data: string;
	}

	namespace window {
		/**
		 * An event which fires when the terminal's child pseudo-device is written to (the shell).
		 * In other words, this provides access to the raw data stream from the process running
		 * within the terminal, including VT sequences.
		 */
		export const onDidWriteTerminalData: Event<TerminalDataWriteEvent>;
	}

	//#endregion

	//#region Terminal dimensions property and change event https://github.com/microsoft/vscode/issues/55718

	/**
	 * An {@link Event} which fires when a {@link Terminal}'s dimensions change.
	 */
	export interface TerminalDimensionsChangeEvent {
		/**
		 * The {@link Terminal} for which the dimensions have changed.
		 */
		readonly terminal: Terminal;
		/**
		 * The new value for the {@link Terminal.dimensions terminal's dimensions}.
		 */
		readonly dimensions: TerminalDimensions;
	}

	export namespace window {
		/**
		 * An event which fires when the {@link Terminal.dimensions dimensions} of the terminal change.
		 */
		export const onDidChangeTerminalDimensions: Event<TerminalDimensionsChangeEvent>;
	}

	export interface Terminal {
		/**
		 * The current dimensions of the terminal. This will be `undefined` immediately after the
		 * terminal is created as the dimensions are not known until shortly after the terminal is
		 * created.
		 */
		readonly dimensions: TerminalDimensions | undefined;
	}

	//#endregion

	//#region Terminal name change event https://github.com/microsoft/vscode/issues/114898

	export interface Pseudoterminal {
		/**
		 * An event that when fired allows changing the name of the terminal.
		 *
		 * **Example:** Change the terminal name to "My new terminal".
		 * ```typescript
		 * const writeEmitter = new vscode.EventEmitter<string>();
		 * const changeNameEmitter = new vscode.EventEmitter<string>();
		 * const pty: vscode.Pseudoterminal = {
		 *   onDidWrite: writeEmitter.event,
		 *   onDidChangeName: changeNameEmitter.event,
		 *   open: () => changeNameEmitter.fire('My new terminal'),
		 *   close: () => {}
		 * };
		 * vscode.window.createTerminal({ name: 'My terminal', pty });
		 * ```
		 */
		onDidChangeName?: Event<string>;
	}

	//#endregion

	// eslint-disable-next-line vscode-dts-region-comments
	//#region @jrieken -> exclusive document filters

	export interface DocumentFilter {
		readonly exclusive?: boolean;
	}

	//#endregion

	//#region Tree View: https://github.com/microsoft/vscode/issues/61313 @alexr00
	export interface TreeView<T> extends Disposable {
		reveal(element: T | undefined, options?: { select?: boolean, focus?: boolean, expand?: boolean | number; }): Thenable<void>;
	}
	//#endregion

	//#region Custom Tree View Drag and Drop https://github.com/microsoft/vscode/issues/32592
	/**
	 * A data provider that provides tree data
	 */
	export interface TreeDataProvider<T> {
		/**
		 * An optional event to signal that an element or root has changed.
		 * This will trigger the view to update the changed element/root and its children recursively (if shown).
		 * To signal that root has changed, do not pass any argument or pass `undefined` or `null`.
		 */
		onDidChangeTreeData2?: Event<T | T[] | undefined | null | void>;
	}

	export interface TreeViewOptions<T> {
		/**
		* An optional interface to implement drag and drop in the tree view.
		*/
		dragAndDropController?: DragAndDropController<T>;
	}

	export interface DragAndDropController<T> extends Disposable {
		/**
		 * Extensions should fire `TreeDataProvider.onDidChangeTreeData` for any elements that need to be refreshed.
		 *
		 * @param source
		 * @param target
		 */
		onDrop(source: T[], target: T): Thenable<void>;
	}
	//#endregion

	//#region Task presentation group: https://github.com/microsoft/vscode/issues/47265
	export interface TaskPresentationOptions {
		/**
		 * Controls whether the task is executed in a specific terminal group using split panes.
		 */
		group?: string;
	}
	//#endregion

	export class TaskGroup2 {
		static Clean: TaskGroup2;
		static Build: TaskGroup2;
		static Rebuild: TaskGroup2;
		static Test: TaskGroup2;
		readonly isDefault?: boolean;
		readonly id: string;
		private constructor(id: string, label: string);
	}

	export class Task2 extends Task {
		group?: TaskGroup2;
	}

	//#region Custom editor move https://github.com/microsoft/vscode/issues/86146

	// TODO: Also for custom editor

	export interface CustomTextEditorProvider {

		/**
		 * Handle when the underlying resource for a custom editor is renamed.
		 *
		 * This allows the webview for the editor be preserved throughout the rename. If this method is not implemented,
		 * the editor will destroy the previous custom editor and create a replacement one.
		 *
		 * @param newDocument New text document to use for the custom editor.
		 * @param existingWebviewPanel Webview panel for the custom editor.
		 * @param token A cancellation token that indicates the result is no longer needed.
		 *
		 * @return Thenable indicating that the webview editor has been moved.
		 */
		// eslint-disable-next-line vscode-dts-provider-naming
		moveCustomTextEditor?(newDocument: TextDocument, existingWebviewPanel: WebviewPanel, token: CancellationToken): Thenable<void>;
	}

	//#endregion

	//#region allow QuickPicks to skip sorting: https://github.com/microsoft/vscode/issues/73904

	export interface QuickPick<T extends QuickPickItem> extends QuickInput {
		/**
		 * An optional flag to sort the final results by index of first query match in label. Defaults to true.
		 */
		sortByLabel: boolean;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/124970, Cell Execution State

	/**
	 * The execution state of a notebook cell.
	 */
	export enum NotebookCellExecutionState {
		/**
		 * The cell is idle.
		 */
		Idle = 1,
		/**
		 * Execution for the cell is pending.
		 */
		Pending = 2,
		/**
		 * The cell is currently executing.
		 */
		Executing = 3,
	}

	/**
	 * An event describing a cell execution state change.
	 */
	export interface NotebookCellExecutionStateChangeEvent {
		/**
		 * The {@link NotebookCell cell} for which the execution state has changed.
		 */
		readonly cell: NotebookCell;

		/**
		 * The new execution state of the cell.
		 */
		readonly state: NotebookCellExecutionState;
	}

	export namespace notebooks {

		/**
		 * An {@link Event} which fires when the execution state of a cell has changed.
		 */
		// todo@API this is an event that is fired for a property that cells don't have and that makes me wonder
		// how a correct consumer works, e.g the consumer could have been late and missed an event?
		export const onDidChangeNotebookCellExecutionState: Event<NotebookCellExecutionStateChangeEvent>;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/106744, Notebook, deprecated & misc

	export interface NotebookCellOutput {
		id: string;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/106744, NotebookEditor

	/**
	 * Represents a notebook editor that is attached to a {@link NotebookDocument notebook}.
	 */
	export enum NotebookEditorRevealType {
		/**
		 * The range will be revealed with as little scrolling as possible.
		 */
		Default = 0,

		/**
		 * The range will always be revealed in the center of the viewport.
		 */
		InCenter = 1,

		/**
		 * If the range is outside the viewport, it will be revealed in the center of the viewport.
		 * Otherwise, it will be revealed with as little scrolling as possible.
		 */
		InCenterIfOutsideViewport = 2,

		/**
		 * The range will always be revealed at the top of the viewport.
		 */
		AtTop = 3
	}

	/**
	 * Represents a notebook editor that is attached to a {@link NotebookDocument notebook}.
	 */
	export interface NotebookEditor {
		/**
		 * The document associated with this notebook editor.
		 */
		//todo@api rename to notebook?
		readonly document: NotebookDocument;

		/**
		 * The selections on this notebook editor.
		 *
		 * The primary selection (or focused range) is `selections[0]`. When the document has no cells, the primary selection is empty `{ start: 0, end: 0 }`;
		 */
		selections: NotebookRange[];

		/**
		 * The current visible ranges in the editor (vertically).
		 */
		readonly visibleRanges: NotebookRange[];

		/**
		 * Scroll as indicated by `revealType` in order to reveal the given range.
		 *
		 * @param range A range.
		 * @param revealType The scrolling strategy for revealing `range`.
		 */
		revealRange(range: NotebookRange, revealType?: NotebookEditorRevealType): void;

		/**
		 * The column in which this editor shows.
		 */
		readonly viewColumn?: ViewColumn;
	}

	export interface NotebookDocumentMetadataChangeEvent {
		/**
		 * The {@link NotebookDocument notebook document} for which the document metadata have changed.
		 */
		//todo@API rename to notebook?
		readonly document: NotebookDocument;
	}

	export interface NotebookCellsChangeData {
		readonly start: number;
		// todo@API end? Use NotebookCellRange instead?
		readonly deletedCount: number;
		// todo@API removedCells, deletedCells?
		readonly deletedItems: NotebookCell[];
		// todo@API addedCells, insertedCells, newCells?
		readonly items: NotebookCell[];
	}

	export interface NotebookCellsChangeEvent {
		/**
		 * The {@link NotebookDocument notebook document} for which the cells have changed.
		 */
		//todo@API rename to notebook?
		readonly document: NotebookDocument;
		readonly changes: ReadonlyArray<NotebookCellsChangeData>;
	}

	export interface NotebookCellOutputsChangeEvent {
		/**
		 * The {@link NotebookDocument notebook document} for which the cell outputs have changed.
		 */
		//todo@API remove? use cell.notebook instead?
		readonly document: NotebookDocument;
		// NotebookCellOutputsChangeEvent.cells vs NotebookCellMetadataChangeEvent.cell
		readonly cells: NotebookCell[];
	}

	export interface NotebookCellMetadataChangeEvent {
		/**
		 * The {@link NotebookDocument notebook document} for which the cell metadata have changed.
		 */
		//todo@API remove? use cell.notebook instead?
		readonly document: NotebookDocument;
		// NotebookCellOutputsChangeEvent.cells vs NotebookCellMetadataChangeEvent.cell
		readonly cell: NotebookCell;
	}

	export interface NotebookEditorSelectionChangeEvent {
		/**
		 * The {@link NotebookEditor notebook editor} for which the selections have changed.
		 */
		readonly notebookEditor: NotebookEditor;
		readonly selections: ReadonlyArray<NotebookRange>
	}

	export interface NotebookEditorVisibleRangesChangeEvent {
		/**
		 * The {@link NotebookEditor notebook editor} for which the visible ranges have changed.
		 */
		readonly notebookEditor: NotebookEditor;
		readonly visibleRanges: ReadonlyArray<NotebookRange>;
	}


	export interface NotebookDocumentShowOptions {
		viewColumn?: ViewColumn;
		preserveFocus?: boolean;
		preview?: boolean;
		selections?: NotebookRange[];
	}

	export namespace notebooks {



		export const onDidSaveNotebookDocument: Event<NotebookDocument>;

		export const onDidChangeNotebookDocumentMetadata: Event<NotebookDocumentMetadataChangeEvent>;
		export const onDidChangeNotebookCells: Event<NotebookCellsChangeEvent>;

		// todo@API add onDidChangeNotebookCellOutputs
		export const onDidChangeCellOutputs: Event<NotebookCellOutputsChangeEvent>;

		// todo@API add onDidChangeNotebookCellMetadata
		export const onDidChangeCellMetadata: Event<NotebookCellMetadataChangeEvent>;
	}

	export namespace window {
		export const visibleNotebookEditors: NotebookEditor[];
		export const onDidChangeVisibleNotebookEditors: Event<NotebookEditor[]>;
		export const activeNotebookEditor: NotebookEditor | undefined;
		export const onDidChangeActiveNotebookEditor: Event<NotebookEditor | undefined>;
		export const onDidChangeNotebookEditorSelection: Event<NotebookEditorSelectionChangeEvent>;
		export const onDidChangeNotebookEditorVisibleRanges: Event<NotebookEditorVisibleRangesChangeEvent>;

		export function showNotebookDocument(uri: Uri, options?: NotebookDocumentShowOptions): Thenable<NotebookEditor>;
		export function showNotebookDocument(document: NotebookDocument, options?: NotebookDocumentShowOptions): Thenable<NotebookEditor>;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/106744, NotebookEditorEdit

	// todo@API add NotebookEdit-type which handles all these cases?
	// export class NotebookEdit {
	// 	range: NotebookRange;
	// 	newCells: NotebookCellData[];
	// 	newMetadata?: NotebookDocumentMetadata;
	// 	constructor(range: NotebookRange, newCells: NotebookCellData)
	// }

	// export class NotebookCellEdit {
	// 	newMetadata?: NotebookCellMetadata;
	// }

	// export interface WorkspaceEdit {
	// 	set(uri: Uri, edits: TextEdit[] | NotebookEdit[]): void
	// }

	export interface WorkspaceEdit {
		// todo@API add NotebookEdit-type which handles all these cases?
		replaceNotebookMetadata(uri: Uri, value: { [key: string]: any }): void;
		replaceNotebookCells(uri: Uri, range: NotebookRange, cells: NotebookCellData[], metadata?: WorkspaceEditEntryMetadata): void;
		replaceNotebookCellMetadata(uri: Uri, index: number, cellMetadata: { [key: string]: any }, metadata?: WorkspaceEditEntryMetadata): void;
	}

	export interface NotebookEditorEdit {
		replaceMetadata(value: { [key: string]: any }): void;
		replaceCells(start: number, end: number, cells: NotebookCellData[]): void;
		replaceCellMetadata(index: number, metadata: { [key: string]: any }): void;
	}

	export interface NotebookEditor {
		/**
		 * Perform an edit on the notebook associated with this notebook editor.
		 *
		 * The given callback-function is invoked with an {@link NotebookEditorEdit edit-builder} which must
		 * be used to make edits. Note that the edit-builder is only valid while the
		 * callback executes.
		 *
		 * @param callback A function which can create edits using an {@link NotebookEditorEdit edit-builder}.
		 * @return A promise that resolves with a value indicating if the edits could be applied.
		 */
		// @jrieken REMOVE maybe
		edit(callback: (editBuilder: NotebookEditorEdit) => void): Thenable<boolean>;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/106744, NotebookEditorDecorationType

	export interface NotebookEditor {
		setDecorations(decorationType: NotebookEditorDecorationType, range: NotebookRange): void;
	}

	export interface NotebookDecorationRenderOptions {
		backgroundColor?: string | ThemeColor;
		borderColor?: string | ThemeColor;
		top: ThemableDecorationAttachmentRenderOptions;
	}

	export interface NotebookEditorDecorationType {
		readonly key: string;
		dispose(): void;
	}

	export namespace notebooks {
		export function createNotebookEditorDecorationType(options: NotebookDecorationRenderOptions): NotebookEditorDecorationType;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/106744, NotebookConcatTextDocument

	export namespace notebooks {
		/**
		 * Create a document that is the concatenation of all  notebook cells. By default all code-cells are included
		 * but a selector can be provided to narrow to down the set of cells.
		 *
		 * @param notebook
		 * @param selector
		 */
		// todo@API really needed? we didn't find a user here
		export function createConcatTextDocument(notebook: NotebookDocument, selector?: DocumentSelector): NotebookConcatTextDocument;
	}

	export interface NotebookConcatTextDocument {
		readonly uri: Uri;
		readonly isClosed: boolean;
		dispose(): void;
		readonly onDidChange: Event<void>;
		readonly version: number;
		getText(): string;
		getText(range: Range): string;

		offsetAt(position: Position): number;
		positionAt(offset: number): Position;
		validateRange(range: Range): Range;
		validatePosition(position: Position): Position;

		locationAt(positionOrRange: Position | Range): Location;
		positionAt(location: Location): Position;
		contains(uri: Uri): boolean;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/106744, NotebookContentProvider


	interface NotebookDocumentBackup {
		/**
		 * Unique identifier for the backup.
		 *
		 * This id is passed back to your extension in `openNotebook` when opening a notebook editor from a backup.
		 */
		readonly id: string;

		/**
		 * Delete the current backup.
		 *
		 * This is called by the editor when it is clear the current backup is no longer needed, such as when a new backup
		 * is made or when the file is saved.
		 */
		delete(): void;
	}

	interface NotebookDocumentBackupContext {
		readonly destination: Uri;
	}

	interface NotebookDocumentOpenContext {
		readonly backupId?: string;
		readonly untitledDocumentData?: Uint8Array;
	}

	// todo@API use openNotebookDOCUMENT to align with openCustomDocument etc?
	// todo@API rename to NotebookDocumentContentProvider
	export interface NotebookContentProvider {

		readonly options?: NotebookDocumentContentOptions;
		readonly onDidChangeNotebookContentOptions?: Event<NotebookDocumentContentOptions>;

		/**
		 * Content providers should always use {@link FileSystemProvider file system providers} to
		 * resolve the raw content for `uri` as the resouce is not necessarily a file on disk.
		 */
		openNotebook(uri: Uri, openContext: NotebookDocumentOpenContext, token: CancellationToken): NotebookData | Thenable<NotebookData>;

		// todo@API use NotebookData instead
		saveNotebook(document: NotebookDocument, token: CancellationToken): Thenable<void>;

		// todo@API use NotebookData instead
		saveNotebookAs(targetResource: Uri, document: NotebookDocument, token: CancellationToken): Thenable<void>;

		// todo@API use NotebookData instead
		backupNotebook(document: NotebookDocument, context: NotebookDocumentBackupContext, token: CancellationToken): Thenable<NotebookDocumentBackup>;
	}

	export namespace workspace {

		// TODO@api use NotebookDocumentFilter instead of just notebookType:string?
		// TODO@API options duplicates the more powerful variant on NotebookContentProvider
		export function registerNotebookContentProvider(notebookType: string, provider: NotebookContentProvider, options?: NotebookDocumentContentOptions): Disposable;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/106744, LiveShare

	export interface NotebookRegistrationData {
		displayName: string;
		filenamePattern: (GlobPattern | { include: GlobPattern; exclude: GlobPattern; })[];
		exclusive?: boolean;
	}

	export namespace workspace {
		// SPECIAL overload with NotebookRegistrationData
		export function registerNotebookContentProvider(notebookType: string, provider: NotebookContentProvider, options?: NotebookDocumentContentOptions, registrationData?: NotebookRegistrationData): Disposable;
		// SPECIAL overload with NotebookRegistrationData
		export function registerNotebookSerializer(notebookType: string, serializer: NotebookSerializer, options?: NotebookDocumentContentOptions, registration?: NotebookRegistrationData): Disposable;
	}

	//#endregion

	//#region @https://github.com/microsoft/vscode/issues/123601, notebook messaging

	export interface NotebookRendererMessage<T> {
		/**
		 * Editor that sent the message.
		 */
		editor: NotebookEditor;

		/**
		 * Message sent from the webview.
		 */
		message: T;
	}

	/**
	 * Renderer messaging is used to communicate with a single renderer. It's
	 * returned from {@link notebooks.createRendererMessaging}.
	 */
	export interface NotebookRendererMessaging<TSend = any, TReceive = TSend> {
		/**
		 * Events that fires when a message is received from a renderer.
		 */
		onDidReceiveMessage: Event<NotebookRendererMessage<TReceive>>;

		/**
		 * Sends a message to the renderer.
		 * @param editor Editor to target with the message
		 * @param message Message to send
		 */
		postMessage(editor: NotebookEditor, message: TSend): void;
	}

	/**
	 * Represents a script that is loaded into the notebook renderer before rendering output. This allows
	 * to provide and share functionality for notebook markup and notebook output renderers.
	 */
	export class NotebookRendererScript {

		/**
		 * APIs that the preload provides to the renderer. These are matched
		 * against the `dependencies` and `optionalDependencies` arrays in the
		 * notebook renderer contribution point.
		 */
		provides: string[];

		/**
		 * URI for the file to preload
		 */
		uri: Uri;

		/**
		 * @param uri URI for the file to preload
		 * @param provides Value for the `provides` property
		 */
		constructor(uri: Uri, provides?: string | string[]);
	}

	export interface NotebookController {

		// todo@API allow add, not remove
		readonly rendererScripts: NotebookRendererScript[];

		/**
		 * An event that fires when a {@link NotebookController.rendererScripts renderer script} has send a message to
		 * the controller.
		 */
		readonly onDidReceiveMessage: Event<{ editor: NotebookEditor, message: any }>;

		/**
		 * Send a message to the renderer of notebook editors.
		 *
		 * Note that only editors showing documents that are bound to this controller
		 * are receiving the message.
		 *
		 * @param message The message to send.
		 * @param editor A specific editor to send the message to. When `undefined` all applicable editors are receiving the message.
		 * @returns A promise that resolves to a boolean indicating if the message has been send or not.
		 */
		postMessage(message: any, editor?: NotebookEditor): Thenable<boolean>;

		//todo@API validate this works
		asWebviewUri(localResource: Uri): Uri;
	}

	export namespace notebooks {

		export function createNotebookController(id: string, viewType: string, label: string, handler?: (cells: NotebookCell[], notebook: NotebookDocument, controller: NotebookController) => void | Thenable<void>, rendererScripts?: NotebookRendererScript[]): NotebookController;

		/**
		 * Creates a new messaging instance used to communicate with a specific
		 * renderer. The renderer only has access to messaging if `requiresMessaging`
		 * is set to `always` or `optional` in its `notebookRenderer ` contribution.
		 *
		 * @see https://github.com/microsoft/vscode/issues/123601
		 * @param rendererId The renderer ID to communicate with
		*/
		// todo@API can ANY extension talk to renderer or is there a check that the calling extension
		// declared the renderer in its package.json?
		export function createRendererMessaging<TSend = any, TReceive = TSend>(rendererId: string): NotebookRendererMessaging<TSend, TReceive>;
	}

	//#endregion

	//#region @eamodio - timeline: https://github.com/microsoft/vscode/issues/84297

	export class TimelineItem {
		/**
		 * A timestamp (in milliseconds since 1 January 1970 00:00:00) for when the timeline item occurred.
		 */
		timestamp: number;

		/**
		 * A human-readable string describing the timeline item.
		 */
		label: string;

		/**
		 * Optional id for the timeline item. It must be unique across all the timeline items provided by this source.
		 *
		 * If not provided, an id is generated using the timeline item's timestamp.
		 */
		id?: string;

		/**
		 * The icon path or {@link ThemeIcon} for the timeline item.
		 */
		iconPath?: Uri | { light: Uri; dark: Uri; } | ThemeIcon;

		/**
		 * A human readable string describing less prominent details of the timeline item.
		 */
		description?: string;

		/**
		 * The tooltip text when you hover over the timeline item.
		 */
		detail?: string;

		/**
		 * The {@link Command} that should be executed when the timeline item is selected.
		 */
		command?: Command;

		/**
		 * Context value of the timeline item. This can be used to contribute specific actions to the item.
		 * For example, a timeline item is given a context value as `commit`. When contributing actions to `timeline/item/context`
		 * using `menus` extension point, you can specify context value for key `timelineItem` in `when` expression like `timelineItem == commit`.
		 * ```
		 *	"contributes": {
		 *		"menus": {
		 *			"timeline/item/context": [
		 *				{
		 *					"command": "extension.copyCommitId",
		 *					"when": "timelineItem == commit"
		 *				}
		 *			]
		 *		}
		 *	}
		 * ```
		 * This will show the `extension.copyCommitId` action only for items where `contextValue` is `commit`.
		 */
		contextValue?: string;

		/**
		 * Accessibility information used when screen reader interacts with this timeline item.
		 */
		accessibilityInformation?: AccessibilityInformation;

		/**
		 * @param label A human-readable string describing the timeline item
		 * @param timestamp A timestamp (in milliseconds since 1 January 1970 00:00:00) for when the timeline item occurred
		 */
		constructor(label: string, timestamp: number);
	}

	export interface TimelineChangeEvent {
		/**
		 * The {@link Uri} of the resource for which the timeline changed.
		 */
		uri: Uri;

		/**
		 * A flag which indicates whether the entire timeline should be reset.
		 */
		reset?: boolean;
	}

	export interface Timeline {
		readonly paging?: {
			/**
			 * A provider-defined cursor specifying the starting point of timeline items which are after the ones returned.
			 * Use `undefined` to signal that there are no more items to be returned.
			 */
			readonly cursor: string | undefined;
		};

		/**
		 * An array of {@link TimelineItem timeline items}.
		 */
		readonly items: readonly TimelineItem[];
	}

	export interface TimelineOptions {
		/**
		 * A provider-defined cursor specifying the starting point of the timeline items that should be returned.
		 */
		cursor?: string;

		/**
		 * An optional maximum number timeline items or the all timeline items newer (inclusive) than the timestamp or id that should be returned.
		 * If `undefined` all timeline items should be returned.
		 */
		limit?: number | { timestamp: number; id?: string; };
	}

	export interface TimelineProvider {
		/**
		 * An optional event to signal that the timeline for a source has changed.
		 * To signal that the timeline for all resources (uris) has changed, do not pass any argument or pass `undefined`.
		 */
		onDidChange?: Event<TimelineChangeEvent | undefined>;

		/**
		 * An identifier of the source of the timeline items. This can be used to filter sources.
		 */
		readonly id: string;

		/**
		 * A human-readable string describing the source of the timeline items. This can be used as the display label when filtering sources.
		 */
		readonly label: string;

		/**
		 * Provide {@link TimelineItem timeline items} for a {@link Uri}.
		 *
		 * @param uri The {@link Uri} of the file to provide the timeline for.
		 * @param options A set of options to determine how results should be returned.
		 * @param token A cancellation token.
		 * @return The {@link TimelineResult timeline result} or a thenable that resolves to such. The lack of a result
		 * can be signaled by returning `undefined`, `null`, or an empty array.
		 */
		provideTimeline(uri: Uri, options: TimelineOptions, token: CancellationToken): ProviderResult<Timeline>;
	}

	export namespace workspace {
		/**
		 * Register a timeline provider.
		 *
		 * Multiple providers can be registered. In that case, providers are asked in
		 * parallel and the results are merged. A failing provider (rejected promise or exception) will
		 * not cause a failure of the whole operation.
		 *
		 * @param scheme A scheme or schemes that defines which documents this provider is applicable to. Can be `*` to target all documents.
		 * @param provider A timeline provider.
		 * @return A {@link Disposable} that unregisters this provider when being disposed.
		*/
		export function registerTimelineProvider(scheme: string | string[], provider: TimelineProvider): Disposable;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/91555

	export enum StandardTokenType {
		Other = 0,
		Comment = 1,
		String = 2,
		RegEx = 4
	}

	export interface TokenInformation {
		type: StandardTokenType;
		range: Range;
	}

	export namespace languages {
		export function getTokenInformationAtPosition(document: TextDocument, position: Position): Thenable<TokenInformation>;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/16221

	// todo@API Split between Inlay- and OverlayHints (InlayHint are for a position, OverlayHints for a non-empty range)
	// todo@API add "mini-markdown" for links and styles
	// (done) remove description
	// (done) rename to InlayHint
	// (done)  add InlayHintKind with type, argument, etc

	export namespace languages {
		/**
		 * Register a inlay hints provider.
		 *
		 * Multiple providers can be registered for a language. In that case providers are asked in
		 * parallel and the results are merged. A failing provider (rejected promise or exception) will
		 * not cause a failure of the whole operation.
		 *
		 * @param selector A selector that defines the documents this provider is applicable to.
		 * @param provider An inlay hints provider.
		 * @return A {@link Disposable} that unregisters this provider when being disposed.
		 */
		export function registerInlayHintsProvider(selector: DocumentSelector, provider: InlayHintsProvider): Disposable;
	}

	export enum InlayHintKind {
		Other = 0,
		Type = 1,
		Parameter = 2,
	}

	/**
	 * Inlay hint information.
	 */
	export class InlayHint {
		/**
		 * The text of the hint.
		 */
		text: string;
		/**
		 * The position of this hint.
		 */
		position: Position;
		/**
		 * The kind of this hint.
		 */
		kind?: InlayHintKind;
		/**
		 * Whitespace before the hint.
		 */
		whitespaceBefore?: boolean;
		/**
		 * Whitespace after the hint.
		 */
		whitespaceAfter?: boolean;

		// todo@API make range first argument
		constructor(text: string, position: Position, kind?: InlayHintKind);
	}

	/**
	 * The inlay hints provider interface defines the contract between extensions and
	 * the inlay hints feature.
	 */
	export interface InlayHintsProvider {

		/**
		 * An optional event to signal that inlay hints have changed.
		 * @see {@link EventEmitter}
		 */
		onDidChangeInlayHints?: Event<void>;

		/**
		 *
		 * @param model The document in which the command was invoked.
		 * @param range The range for which inlay hints should be computed.
		 * @param token A cancellation token.
		 * @return A list of inlay hints or a thenable that resolves to such.
		 */
		provideInlayHints(model: TextDocument, range: Range, token: CancellationToken): ProviderResult<InlayHint[]>;
	}
	//#endregion

	//#region https://github.com/microsoft/vscode/issues/104436

	export enum ExtensionRuntime {
		/**
		 * The extension is running in a NodeJS extension host. Runtime access to NodeJS APIs is available.
		 */
		Node = 1,
		/**
		 * The extension is running in a Webworker extension host. Runtime access is limited to Webworker APIs.
		 */
		Webworker = 2
	}

	export interface ExtensionContext {
		readonly extensionRuntime: ExtensionRuntime;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/102091

	export interface TextDocument {

		/**
		 * The {@link NotebookDocument notebook} that contains this document as a notebook cell or `undefined` when
		 * the document is not contained by a notebook (this should be the more frequent case).
		 */
		notebook: NotebookDocument | undefined;
	}
	//#endregion

	//#region https://github.com/microsoft/vscode/issues/107467
	export namespace test {
		/**
		 * Creates a new test controller.
		 *
		 * @param id Identifier for the controller, must be globally unique.
		 */
		export function createTestController(id: string, label: string): TestController;

		/**
		 * Requests that tests be run by their controller.
		 * @param run Run options to use.
		 * @param token Cancellation token for the test run
		 * @stability experimental
		 */
		export function runTests(run: TestRunRequest, token?: CancellationToken): Thenable<void>;

		/**
		 * Returns an observer that watches and can request tests.
		 * @stability experimental
		 */
		export function createTestObserver(): TestObserver;

		/**
		 * List of test results stored by the editor, sorted in descending
		 * order by their `completedAt` time.
		 * @stability experimental
		 */
		export const testResults: ReadonlyArray<TestRunResult>;

		/**
		 * Event that fires when the {@link testResults} array is updated.
		 * @stability experimental
		 */
		export const onDidChangeTestResults: Event<void>;
	}

	/**
	 * @stability experimental
	 */
	export interface TestObserver {
		/**
		 * List of tests returned by test provider for files in the workspace.
		 */
		readonly tests: ReadonlyArray<TestItem>;

		/**
		 * An event that fires when an existing test in the collection changes, or
		 * null if a top-level test was added or removed. When fired, the consumer
		 * should check the test item and all its children for changes.
		 */
		readonly onDidChangeTest: Event<TestsChangeEvent>;

		/**
		 * Dispose of the observer, allowing the editor to eventually tell test
		 * providers that they no longer need to update tests.
		 */
		dispose(): void;
	}

	/**
	 * @stability experimental
	 */
	export interface TestsChangeEvent {
		/**
		 * List of all tests that are newly added.
		 */
		readonly added: ReadonlyArray<TestItem>;

		/**
		 * List of existing tests that have updated.
		 */
		readonly updated: ReadonlyArray<TestItem>;

		/**
		 * List of existing tests that have been removed.
		 */
		readonly removed: ReadonlyArray<TestItem>;
	}

	// Todo: this is basically the same as the TaskGroup, which is a class that
	// allows custom groups to be created. However I don't anticipate having any
	// UI for that, so enum for now?
	export enum TestRunConfigurationGroup {
		Run = 1,
		Debug = 2,
		Coverage = 3,
	}

	/**
	 * Handler called to start a test run. When invoked, the function should
	 * {@link TestController.createTestRun} at least once, and all tasks
	 * associated with the run should be created before the function returns
	 * or the reutrned promise is resolved.
	 *
	 * @param request Request information for the test run
	 * @param cancellationToken Token that signals the used asked to abort the
	 * test run. If cancellation is requested on this token, all {@link TestRun}
	 * instances associated with the request will be
	 * automatically cancelled as well.
	 */
	export type TestRunHandler = (request: TestRunRequest, token: CancellationToken) => Thenable<void> | void;

	export interface TestRunConfiguration {
		/**
		 * Label shown to the user in the UI.
		 *
		 * Note that the label has some significance if the user requests that
		 * tests be re-run in a certain way. For example, if tests were run
		 * normally and the user requests to re-run them in debug mode, the editor
		 * will attempt use a configuration with the same label in the `Debug`
		 * group. If there is no such configuration, the default will be used.
		 */
		label: string;

		/**
		 * Configures where this configuration is grouped in the UI. If there
		 * are no configurations for a group, it will not be available in the UI.
		 */
		readonly group: TestRunConfigurationGroup;

		/**
		 * Controls whether this configuration is the default action that will
		 * be taken when its group is actions. For example, if the user clicks
		 * the generic "run all" button, then the default configuration for
		 * {@link TestRunConfigurationGroup.Run} will be executed.
		 */
		isDefault: boolean;

		/**
		 * If this method is present a configuration gear will be present in the
		 * UI, and this method will be invoked when it's clicked. When called,
		 * you can take other editor actions, such as showing a quick pick or
		 * opening a configuration file.
		 */
		configureHandler?: () => void;

		/**
		 * Starts a test run. When called, the controller should call
		 * {@link TestController.createTestRun}. All tasks associated with the
		 * run should be created before the function returns or the reutrned
		 * promise is resolved.
		 *
		 * @param request Request information for the test run
		 * @param cancellationToken Token that signals the used asked to abort the
		 * test run. If cancellation is requested on this token, all {@link TestRun}
		 * instances associated with the request will be
		 * automatically cancelled as well.
		 */
		runHandler: TestRunHandler;

		/**
		 * Deletes the run configuration.
		 */
		dispose(): void;
	}

	/**
	 * Interface to discover and execute tests.
	 */
	export interface TestController {
		/**
		 * The ID of the controller, passed in {@link vscode.test.createTestController}
		 */
		readonly id: string;

		/**
		 * Human-readable label for the test controller.
		 */
		label: string;

		/**
		 * Root test item. Tests in the workspace should be added as children of
		 * the root. The extension controls when to add these, although the
		 * editor may request children using the {@link resolveChildrenHandler},
		 * and the extension should add tests for a file when
		 * {@link vscode.workspace.onDidOpenTextDocument} fires in order for
		 * decorations for tests within the file to be visible.
		 *
		 * Tests in this collection should be watched and updated by the extension
		 * as files change. See  {@link resolveChildrenHandler} for details around
		 * for the lifecycle of watches.
		 */
		// todo@API a little weird? what is its label, id, busy state etc? Can I dispose this?
		// todo@API allow createTestItem-calls without parent and simply treat them as root (similar to createSourceControlResourceGroup)
		readonly root: TestItem;

		/**
		 * Creates a configuration used for running tests. Extensions must create
		 * at least one configuration in order for tests to be run.
		 * @param label Human-readable label for this configuration
		 * @param group Configures where this configuration is grouped in the UI.
		 * @param runHandler Function called to start a test run
		 * @param isDefault Whether this is the default action for the group
		 */
		createRunConfiguration(label: string, group: TestRunConfigurationGroup, runHandler: TestRunHandler, isDefault?: boolean): TestRunConfiguration;

		/**
		 * Creates a new managed {@link TestItem} instance as a child of this
		 * one.
		 * @param id Unique identifier for the TestItem.
		 * @param label Human-readable label of the test item.
		 * @param parent Parent of the item. This is required; top-level items
		 * should be created as children of the {@link root}.
		 * @param uri URI this TestItem is associated with. May be a file or directory.
		 * @param data Custom data to be stored in {@link TestItem.data}
		 */
		createTestItem(
			id: string,
			label: string,
			parent: TestItem,
			uri?: Uri,
		): TestItem;

		/**
		 * A function provided by the extension that the editor may call to request
		 * children of a test item, if the {@link TestItem.canExpand} is `true`.
		 * When called, the item should discover children and call
		 * {@link TestController.createTestItem} as children are discovered.
		 *
		 * The item in the explorer will automatically be marked as "busy" until
		 * the function returns or the returned thenable resolves.
		 *
		 * The controller may wish to set up listeners or watchers to update the
		 * children as files and documents change.
		 *
		 * @param item An unresolved test item for which
		 * children are being requested
		 */
		resolveChildrenHandler?: (item: TestItem) => Thenable<void> | void;

		/**
		 * Creates a {@link TestRun<T>}. This should be called by the
		 * {@link TestRunner} when a request is made to execute tests, and may also
		 * be called if a test run is detected externally. Once created, tests
		 * that are included in the results will be moved into the
		 * {@link TestResultState.Pending} state.
		 *
		 * All runs created using the same `request` instance will be grouped
		 * together. This is useful if, for example, a single suite of tests is
		 * run on multiple platforms.
		 *
		 * @param request Test run request. Only tests inside the `include` may be
		 * modified, and tests in its `exclude` are ignored.
		 * @param name The human-readable name of the run. This can be used to
		 * disambiguate multiple sets of results in a test run. It is useful if
		 * tests are run across multiple platforms, for example.
		 * @param persist Whether the results created by the run should be
		 * persisted in the editor. This may be false if the results are coming from
		 * a file already saved externally, such as a coverage information file.
		 */
		createTestRun(request: TestRunRequest, name?: string, persist?: boolean): TestRun;

		/**
		 * Unregisters the test controller, disposing of its associated tests
		 * and unpersisted results.
		 */
		dispose(): void;
	}

	/**
	 * Options given to {@link test.runTests}.
	 */
	export class TestRunRequest {
		/**
		 * Array of specific tests to run. The controllers should run all of the
		 * given tests and all children of the given tests, excluding any tests
		 * that appear in {@link TestRunRequest.exclude}.
		 */
		tests: TestItem[];

		/**
		 * An array of tests the user has marked as excluded in the editor. May be
		 * omitted if no exclusions were requested. Test controllers should not run
		 * excluded tests or any children of excluded tests.
		 */
		exclude?: TestItem[];

		/**
		 * The configuration used for this request. This will always be defined
		 * for requests issued from the editor UI, though extensions may
		 * programmatically create requests not associated with any configuration.
		 */
		configuration?: TestRunConfiguration;

		/**
		 * @param tests Array of specific tests to run.
		 * @param exclude Tests to exclude from the run
		 * @param configuration The run configuration used for this request.
		 */
		constructor(tests: readonly TestItem[], exclude?: readonly TestItem[], configuration?: TestRunConfiguration);
	}

	/**
	 * Options given to {@link TestController.runTests}
	 */
	export interface TestRun {
		/**
		 * The human-readable name of the run. This can be used to
		 * disambiguate multiple sets of results in a test run. It is useful if
		 * tests are run across multiple platforms, for example.
		 */
		readonly name?: string;

		/**
		 * A cancellation token which will be triggered when the test run is
		 * canceled from the UI.
		 */
		readonly token: CancellationToken;

		/**
		 * Updates the state of the test in the run. Calling with method with nodes
		 * outside the {@link TestRunRequest.tests} or in the
		 * {@link TestRunRequest.exclude} array will no-op.
		 *
		 * @param test The test to update
		 * @param state The state to assign to the test
		 * @param duration Optionally sets how long the test took to run, in milliseconds
		 */
		//todo@API is this "update" state or set final state? should this be called setTestResult?
		setState(test: TestItem, state: TestResultState, duration?: number): void;

		/**
		 * Appends a message, such as an assertion error, to the test item.
		 *
		 * Calling with method with nodes outside the {@link TestRunRequest.tests}
		 * or in the {@link TestRunRequest.exclude} array will no-op.
		 *
		 * @param test The test to update
		 * @param message The message to add
		 */
		appendMessage(test: TestItem, message: TestMessage): void;

		/**
		 * Appends raw output from the test runner. On the user's request, the
		 * output will be displayed in a terminal. ANSI escape sequences,
		 * such as colors and text styles, are supported.
		 *
		 * @param output Output text to append
		 * @param associateTo Optionally, associate the given segment of output
		 */
		appendOutput(output: string): void;

		/**
		 * Signals that the end of the test run. Any tests whose states have not
		 * been updated will be moved into the {@link TestResultState.Unset} state.
		 */
		end(): void;
	}

	/**
	 * A test item is an item shown in the "test explorer" view. It encompasses
	 * both a suite and a test, since they have almost or identical capabilities.
	 */
	export interface TestItem {
		/**
		 * Unique identifier for the TestItem. This is used to correlate
		 * test results and tests in the document with those in the workspace
		 * (test explorer). This must not change for the lifetime of the TestItem.
		 */
		readonly id: string;

		/**
		 * URI this TestItem is associated with. May be a file or directory.
		 */
		readonly uri?: Uri;

		/**
		 * A mapping of children by ID to the associated TestItem instances.
		 */
		//todo@API use array over es6-map
		readonly children: ReadonlyMap<string, TestItem>;

		/**
		 * The parent of this item, given in {@link TestController.createTestItem}.
		 * This is undefined only for the {@link TestController.root}.
		 */
		readonly parent?: TestItem;

		/**
		 * Indicates whether this test item may have children discovered by resolving.
		 * If so, it will be shown as expandable in the Test Explorer  view, and
		 * expanding the item will cause {@link TestController.resolveChildrenHandler}
		 * to be invoked with the item.
		 *
		 * Default to false.
		 */
		canResolveChildren: boolean;

		/**
		 * Controls whether the item is shown as "busy" in the Test Explorer view.
		 * This is useful for showing status while discovering children. Defaults
		 * to false.
		 */
		busy: boolean;

		/**
		 * Display name describing the test case.
		 */
		label: string;

		/**
		 * Optional description that appears next to the label.
		 */
		description?: string;

		/**
		 * Location of the test item in its `uri`. This is only meaningful if the
		 * `uri` points to a file.
		 */
		range?: Range;

		/**
		 * May be set to an error associated with loading the test. Note that this
		 * is not a test result and should only be used to represent errors in
		 * discovery, such as syntax errors.
		 */
		error?: string | MarkdownString;

		/**
		 * Marks the test as outdated. This can happen as a result of file changes,
		 * for example. In "auto run" mode, tests that are outdated will be
		 * automatically rerun after a short delay. Invoking this on a
		 * test with children will mark the entire subtree as outdated.
		 *
		 * Extensions should generally not override this method.
		 */
		invalidateResults(): void;

		/**
		 * Removes the test and its children from the tree.
		 */
		dispose(): void;
	}

	/**
	 * Possible states of tests in a test run.
	 */
	export enum TestResultState {
		// Initial state
		Unset = 0,
		// Test will be run, but is not currently running.
		Queued = 1,
		// Test is currently running
		Running = 2,
		// Test run has passed
		Passed = 3,
		// Test run has failed (on an assertion)
		Failed = 4,
		// Test run has been skipped
		Skipped = 5,
		// Test run failed for some other reason (compilation error, timeout, etc)
		Errored = 6
	}

	/**
	 * Represents the severity of test messages.
	 */
	export enum TestMessageSeverity {
		Error = 0,
		Warning = 1,
		Information = 2,
		Hint = 3
	}

	/**
	 * Message associated with the test state. Can be linked to a specific
	 * source range -- useful for assertion failures, for example.
	 */
	export class TestMessage {
		/**
		 * Human-readable message text to display.
		 */
		message: string | MarkdownString;

		/**
		 * Message severity. Defaults to "Error".
		 */
		severity: TestMessageSeverity;

		/**
		 * Expected test output. If given with `actualOutput`, a diff view will be shown.
		 */
		expectedOutput?: string;

		/**
		 * Actual test output. If given with `expectedOutput`, a diff view will be shown.
		 */
		actualOutput?: string;

		/**
		 * Associated file location.
		 */
		location?: Location;

		/**
		 * Creates a new TestMessage that will present as a diff in the editor.
		 * @param message Message to display to the user.
		 * @param expected Expected output.
		 * @param actual Actual output.
		 */
		static diff(message: string | MarkdownString, expected: string, actual: string): TestMessage;

		/**
		 * Creates a new TestMessage instance.
		 * @param message The message to show to the user.
		 */
		constructor(message: string | MarkdownString);
	}

	/**
	 * TestResults can be provided to the editor in {@link test.publishTestResult},
	 * or read from it in {@link test.testResults}.
	 *
	 * The results contain a 'snapshot' of the tests at the point when the test
	 * run is complete. Therefore, information such as its {@link Range} may be
	 * out of date. If the test still exists in the workspace, consumers can use
	 * its `id` to correlate the result instance with the living test.
	 *
	 * @todo coverage and other info may eventually be provided here
	 */
	export interface TestRunResult {
		/**
		 * Unix milliseconds timestamp at which the test run was completed.
		 */
		completedAt: number;

		/**
		 * Optional raw output from the test run.
		 */
		output?: string;

		/**
		 * List of test results. The items in this array are the items that
		 * were passed in the {@link test.runTests} method.
		 */
		results: ReadonlyArray<Readonly<TestResultSnapshot>>;
	}

	/**
	 * A {@link TestItem}-like interface with an associated result, which appear
	 * or can be provided in {@link TestResult} interfaces.
	 */
	export interface TestResultSnapshot {
		/**
		 * Unique identifier that matches that of the associated TestItem.
		 * This is used to correlate test results and tests in the document with
		 * those in the workspace (test explorer).
		 */
		readonly id: string;

		/**
		 * URI this TestItem is associated with. May be a file or file.
		 */
		readonly uri?: Uri;

		/**
		 * Display name describing the test case.
		 */
		readonly label: string;

		/**
		 * Optional description that appears next to the label.
		 */
		readonly description?: string;

		/**
		 * Location of the test item in its `uri`. This is only meaningful if the
		 * `uri` points to a file.
		 */
		readonly range?: Range;

		/**
		 * State of the test in each task. In the common case, a test will only
		 * be executed in a single task and the length of this array will be 1.
		 */
		readonly taskStates: ReadonlyArray<TestSnapshoptTaskState>;

		/**
		 * Optional list of nested tests for this item.
		 */
		readonly children: Readonly<TestResultSnapshot>[];
	}

	export interface TestSnapshoptTaskState {
		/**
		 * Current result of the test.
		 */
		readonly state: TestResultState;

		/**
		 * The number of milliseconds the test took to run. This is set once the
		 * `state` is `Passed`, `Failed`, or `Errored`.
		 */
		readonly duration?: number;

		/**
		 * Associated test run message. Can, for example, contain assertion
		 * failure information if the test fails.
		 */
		readonly messages: ReadonlyArray<TestMessage>;
	}

	//#endregion

	//#region Opener service (https://github.com/microsoft/vscode/issues/109277)

	/**
	 * Details if an `ExternalUriOpener` can open a uri.
	 *
	 * The priority is also used to rank multiple openers against each other and determine
	 * if an opener should be selected automatically or if the user should be prompted to
	 * select an opener.
	 *
	 * The editor will try to use the best available opener, as sorted by `ExternalUriOpenerPriority`.
	 * If there are multiple potential "best" openers for a URI, then the user will be prompted
	 * to select an opener.
	 */
	export enum ExternalUriOpenerPriority {
		/**
		 * The opener is disabled and will never be shown to users.
		 *
		 * Note that the opener can still be used if the user specifically
		 * configures it in their settings.
		 */
		None = 0,

		/**
		 * The opener can open the uri but will not cause a prompt on its own
		 * since the editor always contributes a built-in `Default` opener.
		 */
		Option = 1,

		/**
		 * The opener can open the uri.
		 *
		 * The editor's built-in opener has `Default` priority. This means that any additional `Default`
		 * openers will cause the user to be prompted to select from a list of all potential openers.
		 */
		Default = 2,

		/**
		 * The opener can open the uri and should be automatically selected over any
		 * default openers, include the built-in one from the editor.
		 *
		 * A preferred opener will be automatically selected if no other preferred openers
		 * are available. If multiple preferred openers are available, then the user
		 * is shown a prompt with all potential openers (not just preferred openers).
		 */
		Preferred = 3,
	}

	/**
	 * Handles opening uris to external resources, such as http(s) links.
	 *
	 * Extensions can implement an `ExternalUriOpener` to open `http` links to a webserver
	 * inside of the editor instead of having the link be opened by the web browser.
	 *
	 * Currently openers may only be registered for `http` and `https` uris.
	 */
	export interface ExternalUriOpener {

		/**
		 * Check if the opener can open a uri.
		 *
		 * @param uri The uri being opened. This is the uri that the user clicked on. It has
		 * not yet gone through port forwarding.
		 * @param token Cancellation token indicating that the result is no longer needed.
		 *
		 * @return Priority indicating if the opener can open the external uri.
		 */
		canOpenExternalUri(uri: Uri, token: CancellationToken): ExternalUriOpenerPriority | Thenable<ExternalUriOpenerPriority>;

		/**
		 * Open a uri.
		 *
		 * This is invoked when:
		 *
		 * - The user clicks a link which does not have an assigned opener. In this case, first `canOpenExternalUri`
		 *   is called and if the user selects this opener, then `openExternalUri` is called.
		 * - The user sets the default opener for a link in their settings and then visits a link.
		 *
		 * @param resolvedUri The uri to open. This uri may have been transformed by port forwarding, so it
		 * may not match the original uri passed to `canOpenExternalUri`. Use `ctx.originalUri` to check the
		 * original uri.
		 * @param ctx Additional information about the uri being opened.
		 * @param token Cancellation token indicating that opening has been canceled.
		 *
		 * @return Thenable indicating that the opening has completed.
		 */
		openExternalUri(resolvedUri: Uri, ctx: OpenExternalUriContext, token: CancellationToken): Thenable<void> | void;
	}

	/**
	 * Additional information about the uri being opened.
	 */
	interface OpenExternalUriContext {
		/**
		 * The uri that triggered the open.
		 *
		 * This is the original uri that the user clicked on or that was passed to `openExternal.`
		 * Due to port forwarding, this may not match the `resolvedUri` passed to `openExternalUri`.
		 */
		readonly sourceUri: Uri;
	}

	/**
	 * Additional metadata about a registered `ExternalUriOpener`.
	 */
	interface ExternalUriOpenerMetadata {

		/**
		 * List of uri schemes the opener is triggered for.
		 *
		 * Currently only `http` and `https` are supported.
		 */
		readonly schemes: readonly string[]

		/**
		 * Text displayed to the user that explains what the opener does.
		 *
		 * For example, 'Open in browser preview'
		 */
		readonly label: string;
	}

	namespace window {
		/**
		 * Register a new `ExternalUriOpener`.
		 *
		 * When a uri is about to be opened, an `onOpenExternalUri:SCHEME` activation event is fired.
		 *
		 * @param id Unique id of the opener, such as `myExtension.browserPreview`. This is used in settings
		 *   and commands to identify the opener.
		 * @param opener Opener to register.
		 * @param metadata Additional information about the opener.
		 *
		* @returns Disposable that unregisters the opener.
		*/
		export function registerExternalUriOpener(id: string, opener: ExternalUriOpener, metadata: ExternalUriOpenerMetadata): Disposable;
	}

	interface OpenExternalOptions {
		/**
		 * Allows using openers contributed by extensions through  `registerExternalUriOpener`
		 * when opening the resource.
		 *
		 * If `true`, the editor will check if any contributed openers can handle the
		 * uri, and fallback to the default opener behavior.
		 *
		 * If it is string, this specifies the id of the `ExternalUriOpener`
		 * that should be used if it is available. Use `'default'` to force the editor's
		 * standard external opener to be used.
		 */
		readonly allowContributedOpeners?: boolean | string;
	}

	namespace env {
		export function openExternal(target: Uri, options?: OpenExternalOptions): Thenable<boolean>;
	}

	//#endregion

	//#region https://github.com/Microsoft/vscode/issues/15178

	// TODO@API must be a class
	export interface OpenEditorInfo {
		name: string;
		resource: Uri;
		isActive: boolean;
	}

	export namespace window {
		export const openEditors: ReadonlyArray<OpenEditorInfo>;

		// todo@API proper event type
		export const onDidChangeOpenEditors: Event<void>;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/120173
	/**
	 * The object describing the properties of the workspace trust request
	 */
	export interface WorkspaceTrustRequestOptions {
		/**
		 * Custom message describing the user action that requires workspace
		 * trust. If omitted, a generic message will be displayed in the workspace
		 * trust request dialog.
		 */
		readonly message?: string;
	}

	export namespace workspace {
		/**
		 * Prompt the user to chose whether to trust the current workspace
		 * @param options Optional object describing the properties of the
		 * workspace trust request.
		 */
		export function requestWorkspaceTrust(options?: WorkspaceTrustRequestOptions): Thenable<boolean | undefined>;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/115616 @alexr00
	export enum PortAutoForwardAction {
		Notify = 1,
		OpenBrowser = 2,
		OpenPreview = 3,
		Silent = 4,
		Ignore = 5,
		OpenBrowserOnce = 6
	}

	export class PortAttributes {
		/**
		 * The port number associated with this this set of attributes.
		 */
		port: number;

		/**
		 * The action to be taken when this port is detected for auto forwarding.
		 */
		autoForwardAction: PortAutoForwardAction;

		/**
		 * Creates a new PortAttributes object
		 * @param port the port number
		 * @param autoForwardAction the action to take when this port is detected
		 */
		constructor(port: number, autoForwardAction: PortAutoForwardAction);
	}

	export interface PortAttributesProvider {
		/**
		 * Provides attributes for the given port. For ports that your extension doesn't know about, simply
		 * return undefined. For example, if `providePortAttributes` is called with ports 3000 but your
		 * extension doesn't know anything about 3000 you should return undefined.
		 */
		providePortAttributes(port: number, pid: number | undefined, commandLine: string | undefined, token: CancellationToken): ProviderResult<PortAttributes>;
	}

	export namespace workspace {
		/**
		 * If your extension listens on ports, consider registering a PortAttributesProvider to provide information
		 * about the ports. For example, a debug extension may know about debug ports in it's debuggee. By providing
		 * this information with a PortAttributesProvider the extension can tell the editor that these ports should be
		 * ignored, since they don't need to be user facing.
		 *
		 * @param portSelector If registerPortAttributesProvider is called after you start your process then you may already
		 * know the range of ports or the pid of your process. All properties of a the portSelector must be true for your
		 * provider to get called.
		 * The `portRange` is start inclusive and end exclusive.
		 * @param provider The PortAttributesProvider
		 */
		export function registerPortAttributesProvider(portSelector: { pid?: number, portRange?: [number, number], commandMatcher?: RegExp }, provider: PortAttributesProvider): Disposable;
	}
	//#endregion

	//#region https://github.com/microsoft/vscode/issues/119904 @eamodio

	export interface SourceControlInputBox {

		/**
		 * Sets focus to the input.
		 */
		focus(): void;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/124024 @hediet @alexdima

	export namespace languages {
		/**
		 * Registers an inline completion provider.
		 */
		export function registerInlineCompletionItemProvider(selector: DocumentSelector, provider: InlineCompletionItemProvider): Disposable;
	}

	export interface InlineCompletionItemProvider<T extends InlineCompletionItem = InlineCompletionItem> {
		/**
		 * Provides inline completion items for the given position and document.
		 * If inline completions are enabled, this method will be called whenever the user stopped typing.
		 * It will also be called when the user explicitly triggers inline completions or asks for the next or previous inline completion.
		 * Use `context.triggerKind` to distinguish between these scenarios.
		*/
		provideInlineCompletionItems(document: TextDocument, position: Position, context: InlineCompletionContext, token: CancellationToken): ProviderResult<InlineCompletionList<T> | T[]>;
	}

	export interface InlineCompletionContext {
		/**
		 * How the completion was triggered.
		 */
		readonly triggerKind: InlineCompletionTriggerKind;
	}

	/**
	 * How an {@link InlineCompletionItemProvider inline completion provider} was triggered.
	 */
	export enum InlineCompletionTriggerKind {
		/**
		 * Completion was triggered automatically while editing.
		 * It is sufficient to return a single completion item in this case.
		 */
		Automatic = 0,

		/**
		 * Completion was triggered explicitly by a user gesture.
		 * Return multiple completion items to enable cycling through them.
		 */
		Explicit = 1,
	}

	export class InlineCompletionList<T extends InlineCompletionItem = InlineCompletionItem> {
		items: T[];

		constructor(items: T[]);
	}

	export class InlineCompletionItem {
		/**
		 * The text to insert.
		 * If the text contains a line break, the range must end at the end of a line.
		 * If existing text should be replaced, the existing text must be a prefix of the text to insert.
		*/
		text: string;

		/**
		 * The range to replace.
		 * Must begin and end on the same line.
		 *
		 * Prefer replacements over insertions to avoid cache invalidation.
		 * Instead of reporting a completion that extends a word,
		 * the whole word should be replaced with the extended word.
		*/
		range?: Range;

		/**
		 * An optional {@link Command} that is executed *after* inserting this completion.
		 */
		command?: Command;

		constructor(text: string, range?: Range, command?: Command);
	}


	/**
	 * Be aware that this API will not ever be finalized.
	 */
	export namespace window {
		export function getInlineCompletionItemController<T extends InlineCompletionItem>(provider: InlineCompletionItemProvider<T>): InlineCompletionController<T>;
	}

	/**
	 * Be aware that this API will not ever be finalized.
	 */
	export interface InlineCompletionController<T extends InlineCompletionItem> {
		/**
		 * Is fired when an inline completion item is shown to the user.
		 */
		// eslint-disable-next-line vscode-dts-event-naming
		readonly onDidShowCompletionItem: Event<InlineCompletionItemDidShowEvent<T>>;
	}

	/**
	 * Be aware that this API will not ever be finalized.
	 */
	export interface InlineCompletionItemDidShowEvent<T extends InlineCompletionItem> {
		completionItem: T;
	}

	//#endregion

	//#region FileSystemProvider stat readonly - https://github.com/microsoft/vscode/issues/73122

	export enum FilePermission {
		/**
		 * The file is readonly.
		 *
		 * *Note:* All `FileStat` from a `FileSystemProvider` that is registered  with
		 * the option `isReadonly: true` will be implicitly handled as if `FilePermission.Readonly`
		 * is set. As a consequence, it is not possible to have a readonly file system provider
		 * registered where some `FileStat` are not readonly.
		 */
		Readonly = 1
	}

	/**
	 * The `FileStat`-type represents metadata about a file
	 */
	export interface FileStat {

		/**
		 * The permissions of the file, e.g. whether the file is readonly.
		 *
		 * *Note:* This value might be a bitmask, e.g. `FilePermission.Readonly | FilePermission.Other`.
		 */
		permissions?: FilePermission;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/126280 @mjbvz

	export interface NotebookCellData {
		/**
		 * Mime type determines how the cell's `value` is interpreted.
		 *
		 * The mime selects which notebook renders is used to render the cell.
		 *
		 * If not set, internally the cell is treated as having a mime type of `text/plain`.
		 * Cells that set `language` to `markdown` instead are treated as `text/markdown`.
		 */
		mime?: string;
	}

	export interface NotebookCell {
		/**
		 * Mime type determines how the markup cell's `value` is interpreted.
		 *
		 * The mime selects which notebook renders is used to render the cell.
		 *
		 * If not set, internally the cell is treated as having a mime type of `text/plain`.
		 * Cells that set `language` to `markdown` instead are treated as `text/markdown`.
		 */
		mime: string | undefined;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/123713 @connor4312
	export interface TestRun {
		/**
		 * Test coverage provider for this result. An extension can defer setting
		 * this until after a run is complete and coverage is available.
		 */
		coverageProvider?: TestCoverageProvider
		// ...
	}

	/**
	 * Provides information about test coverage for a test result.
	 * Methods on the provider will not be called until the test run is complete
	 */
	export interface TestCoverageProvider<T extends FileCoverage = FileCoverage> {
		/**
		 * Returns coverage information for all files involved in the test run.
		 * @param token A cancellation token.
		 * @return Coverage metadata for all files involved in the test.
		 */
		provideFileCoverage(token: CancellationToken): ProviderResult<T[]>;

		/**
		 * Give a FileCoverage to fill in more data, namely {@link FileCoverage.detailedCoverage}.
		 * The editor will only resolve a FileCoverage once, and onyl if detailedCoverage
		 * is undefined.
		 *
		 * @param coverage A coverage object obtained from {@link provideFileCoverage}
		 * @param token A cancellation token.
		 * @return The resolved file coverage, or a thenable that resolves to one. It
		 * is OK to return the given `coverage`. When no result is returned, the
		 * given `coverage` will be used.
		 */
		resolveFileCoverage?(coverage: T, token: CancellationToken): ProviderResult<T>;
	}

	/**
	 * A class that contains information about a covered resource. A count can
	 * be give for lines, branches, and functions in a file.
	 */
	export class CoveredCount {
		/**
		 * Number of items covered in the file.
		 */
		covered: number;
		/**
		 * Total number of covered items in the file.
		 */
		total: number;

		/**
		 * @param covered Value for {@link CovereredCount.covered}
		 * @param total Value for {@link CovereredCount.total}
		 */
		constructor(covered: number, total: number);
	}

	/**
	 * Contains coverage metadata for a file.
	 */
	export class FileCoverage {
		/**
		 * File URI.
		 */
		readonly uri: Uri;

		/**
		 * Statement coverage information. If the reporter does not provide statement
		 * coverage information, this can instead be used to represent line coverage.
		 */
		statementCoverage: CoveredCount;

		/**
		 * Branch coverage information.
		 */
		branchCoverage?: CoveredCount;

		/**
		 * Function coverage information.
		 */
		functionCoverage?: CoveredCount;

		/**
		 * Detailed, per-statement coverage. If this is undefined, the editor will
		 * call {@link TestCoverageProvider.resolveFileCoverage} when necessary.
		 */
		detailedCoverage?: DetailedCoverage[];

		/**
		 * Creates a {@link FileCoverage} instance with counts filled in from
		 * the coverage details.
		 * @param uri Covered file URI
		 * @param detailed Detailed coverage information
		 */
		static fromDetails(uri: Uri, details: readonly DetailedCoverage[]): FileCoverage;

		/**
		 * @param uri Covered file URI
		 * @param statementCoverage Statement coverage information. If the reporter
		 * does not provide statement coverage information, this can instead be
		 * used to represent line coverage.
		 * @param branchCoverage Branch coverage information
		 * @param functionCoverage Function coverage information
		 */
		constructor(
			uri: Uri,
			statementCoverage: CoveredCount,
			branchCoverage?: CoveredCount,
			functionCoverage?: CoveredCount,
		);
	}

	/**
	 * Contains coverage information for a single statement or line.
	 */
	export class StatementCoverage {
		/**
		 * The number of times this statement was executed. If zero, the
		 * statement will be marked as un-covered.
		 */
		executionCount: number;

		/**
		 * Statement location.
		 */
		location: Position | Range;

		/**
		 * Coverage from branches of this line or statement. If it's not a
		 * conditional, this will be empty.
		 */
		branches: BranchCoverage[];

		/**
		 * @param location The statement position.
		 * @param executionCount The number of times this statement was
		 * executed. If zero, the statement will be marked as un-covered.
		 * @param branches Coverage from branches of this line.  If it's not a
		 * conditional, this should be omitted.
		 */
		constructor(executionCount: number, location: Position | Range, branches?: BranchCoverage[]);
	}

	/**
	 * Contains coverage information for a branch of a {@link StatementCoverage}.
	 */
	export class BranchCoverage {
		/**
		 * The number of times this branch was executed. If zero, the
		 * branch will be marked as un-covered.
		 */
		executionCount: number;

		/**
		 * Branch location.
		 */
		location?: Position | Range;

		/**
		 * @param executionCount The number of times this branch was executed.
		 * @param location The branch position.
		 */
		constructor(executionCount: number, location?: Position | Range);
	}

	/**
	 * Contains coverage information for a function or method.
	 */
	export class FunctionCoverage {
		/**
		 * The number of times this function was executed. If zero, the
		 * function will be marked as un-covered.
		 */
		executionCount: number;

		/**
		 * Function location.
		 */
		location: Position | Range;

		/**
		 * @param executionCount The number of times this function was executed.
		 * @param location The function position.
		 */
		constructor(executionCount: number, location: Position | Range);
	}

	export type DetailedCoverage = StatementCoverage | FunctionCoverage;

	//#endregion
}
