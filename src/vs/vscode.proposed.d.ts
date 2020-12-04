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
 * - Use Insiders release of VS Code.
 * - Add `"enableProposedApi": true` to your package.json.
 * - Copy this file to your project.
 */

declare module 'vscode' {

	// #region auth provider: https://github.com/microsoft/vscode/issues/88309

	/**
	 * An [event](#Event) which fires when an [AuthenticationProvider](#AuthenticationProvider) is added or removed.
	 */
	export interface AuthenticationProvidersChangeEvent {
		/**
		 * The ids of the [authenticationProvider](#AuthenticationProvider)s that have been added.
		 */
		readonly added: ReadonlyArray<AuthenticationProviderInformation>;

		/**
		 * The ids of the [authenticationProvider](#AuthenticationProvider)s that have been removed.
		 */
		readonly removed: ReadonlyArray<AuthenticationProviderInformation>;
	}

	/**
	* An [event](#Event) which fires when an [AuthenticationSession](#AuthenticationSession) is added, removed, or changed.
	*/
	export interface AuthenticationProviderAuthenticationSessionsChangeEvent {
		/**
		 * The ids of the [AuthenticationSession](#AuthenticationSession)s that have been added.
		*/
		readonly added: ReadonlyArray<string>;

		/**
		 * The ids of the [AuthenticationSession](#AuthenticationSession)s that have been removed.
		 */
		readonly removed: ReadonlyArray<string>;

		/**
		 * The ids of the [AuthenticationSession](#AuthenticationSession)s that have been changed.
		 */
		readonly changed: ReadonlyArray<string>;
	}

	/**
	 * **WARNING** When writing an AuthenticationProvider, `id` should be treated as part of your extension's
	 * API, changing it is a breaking change for all extensions relying on the provider. The id is
	 * treated case-sensitively.
	 */
	export interface AuthenticationProvider {
		/**
		 * Used as an identifier for extensions trying to work with a particular
		 * provider: 'microsoft', 'github', etc. id must be unique, registering
		 * another provider with the same id will fail.
		 */
		readonly id: string;

		/**
		 * The human-readable name of the provider.
		 */
		readonly label: string;

		/**
		 * Whether it is possible to be signed into multiple accounts at once with this provider
		*/
		readonly supportsMultipleAccounts: boolean;

		/**
		 * An [event](#Event) which fires when the array of sessions has changed, or data
		 * within a session has changed.
		 */
		readonly onDidChangeSessions: Event<AuthenticationProviderAuthenticationSessionsChangeEvent>;

		/**
		 * Returns an array of current sessions.
		 */
		getSessions(): Thenable<ReadonlyArray<AuthenticationSession>>;

		/**
		 * Prompts a user to login.
		 */
		login(scopes: string[]): Thenable<AuthenticationSession>;

		/**
		 * Removes the session corresponding to session id.
		 * @param sessionId The session id to log out of
		 */
		logout(sessionId: string): Thenable<void>;
	}

	export namespace authentication {
		/**
		 * Register an authentication provider.
		 *
		 * There can only be one provider per id and an error is being thrown when an id
		 * has already been used by another provider.
		 *
		 * @param provider The authentication provider provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerAuthenticationProvider(provider: AuthenticationProvider): Disposable;

		/**
		 * @deprecated - getSession should now trigger extension activation.
		 * Fires with the provider id that was registered or unregistered.
		 */
		export const onDidChangeAuthenticationProviders: Event<AuthenticationProvidersChangeEvent>;

		/**
		 * @deprecated
		 * The ids of the currently registered authentication providers.
		 * @returns An array of the ids of authentication providers that are currently registered.
		 */
		export function getProviderIds(): Thenable<ReadonlyArray<string>>;

		/**
		 * @deprecated
		 * An array of the ids of authentication providers that are currently registered.
		 */
		export const providerIds: ReadonlyArray<string>;

		/**
		 * An array of the information of authentication providers that are currently registered.
		 */
		export const providers: ReadonlyArray<AuthenticationProviderInformation>;

		/**
		 * @deprecated
		* Logout of a specific session.
		* @param providerId The id of the provider to use
		* @param sessionId The session id to remove
		* provider
		*/
		export function logout(providerId: string, sessionId: string): Thenable<void>;

		/**
		 * Retrieve a password that was stored with key. Returns undefined if there
		 * is no password matching that key.
		 * @param key The key the password was stored under.
		 */
		export function getPassword(key: string): Thenable<string | undefined>;

		/**
		 * Store a password under a given key.
		 * @param key The key to store the password under
		 * @param value The password
		 */
		export function setPassword(key: string, value: string): Thenable<void>;

		/**
		 * Remove a password from storage.
		 * @param key The key the password was stored under.
		 */
		export function deletePassword(key: string): Thenable<void>;

		/**
		 * Fires when a password is set or deleted.
		 */
		export const onDidChangePassword: Event<void>;
	}

	//#endregion

	//#region @alexdima - resolvers

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
	}

	export interface TunnelOptions {
		remoteAddress: { port: number, host: string; };
		// The desired local port. If this port can't be used, then another will be chosen.
		localAddressPort?: number;
		label?: string;
	}

	export interface TunnelDescription {
		remoteAddress: { port: number, host: string; };
		//The complete local address(ex. localhost:1234)
		localAddress: { port: number, host: string; } | string;
	}

	export interface Tunnel extends TunnelDescription {
		// Implementers of Tunnel should fire onDidDispose when dispose is called.
		onDidDispose: Event<void>;
		dispose(): void;
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

	export type ResolverResult = ResolvedAuthority & ResolvedOptions & TunnelInformation;

	export class RemoteAuthorityResolverError extends Error {
		static NotAvailable(message?: string, handled?: boolean): RemoteAuthorityResolverError;
		static TemporarilyNotAvailable(message?: string): RemoteAuthorityResolverError;

		constructor(message?: string);
	}

	export interface RemoteAuthorityResolver {
		resolve(authority: string, context: RemoteAuthorityResolverContext): ResolverResult | Thenable<ResolverResult>;
		/**
		 * Can be optionally implemented if the extension can forward ports better than the core.
		 * When not implemented, the core will use its default forwarding logic.
		 * When implemented, the core will use this to forward ports.
		 *
		 * To enable the "Change Local Port" action on forwarded ports, make sure to set the `localAddress` of
		 * the returned `Tunnel` to a `{ port: number, host: string; }` and not a string.
		 */
		tunnelFactory?: (tunnelOptions: TunnelOptions, tunnelCreationOptions: TunnelCreationOptions) => Thenable<Tunnel> | undefined;

		/**
		 * Provides filtering for candidate ports.
		 */
		showCandidatePort?: (host: string, port: number, detail: string) => Thenable<boolean>;
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
	 * @see [GlobPattern](#GlobPattern)
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
	 * Information collected when text search is complete.
	 */
	export interface TextSearchComplete {
		/**
		 * Whether the search hit the limit on the maximum number of search results.
		 * `maxResults` on [`TextSearchOptions`](#TextSearchOptions) specifies the max number of results.
		 * - If exactly that number of matches exist, this should be false.
		 * - If `maxResults` matches are returned and more exist, this should be true.
		 * - If search hits an internal limit which is less than `maxResults`, this should be true.
		 */
		limitHit?: boolean;
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
	 * A FileSearchProvider is the more powerful of two ways to implement file search in VS Code. Use a FileSearchProvider if you wish to search within a folder for
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
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
		 */
		export function registerFileSearchProvider(scheme: string, provider: FileSearchProvider): Disposable;

		/**
		 * Register a text search provider.
		 *
		 * Only one provider can be registered per scheme.
		 *
		 * @param scheme The provider will be invoked for workspace folders that have this file scheme.
		 * @param provider The provider.
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
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
		 * A [glob pattern](#GlobPattern) that defines the files to search for. The glob pattern
		 * will be matched against the file paths of files relative to their workspace. Use a [relative pattern](#RelativePattern)
		 * to restrict the search results to a [workspace folder](#WorkspaceFolder).
		 */
		include?: GlobPattern;

		/**
		 * A [glob pattern](#GlobPattern) that defines files and folders to exclude. The glob pattern
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
		 * Search text in files across all [workspace folders](#workspace.workspaceFolders) in the workspace.
		 * @param query The query parameters for the search - the search string, whether it's case-sensitive, or a regex, or matches whole words.
		 * @param callback A callback, called for each result
		 * @param token A token that can be used to signal cancellation to the underlying search engine.
		 * @return A thenable that resolves when the search is complete.
		 */
		export function findTextInFiles(query: TextSearchQuery, callback: (result: TextSearchResult) => void, token?: CancellationToken): Thenable<TextSearchComplete>;

		/**
		 * Search text in files across all [workspace folders](#workspace.workspaceFolders) in the workspace.
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
		 * Diff information commands are different from ordinary [commands](#commands.registerCommand) as
		 * they only execute when there is an active diff editor when the command is called, and the diff
		 * information has been computed. Also, the command handler of an editor command has access to
		 * the diff information.
		 *
		 * @param command A unique identifier for the command.
		 * @param callback A command handler function with access to the [diff information](#LineChange).
		 * @param thisArg The `this` context used when invoking the handler function.
		 * @return Disposable which unregisters this command on disposal.
		 */
		export function registerDiffInformationCommand(command: string, callback: (diff: LineChange[], ...args: any[]) => any, thisArg?: any): Disposable;
	}

	//#endregion

	//#region debug

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
		 * A validation function for the input box. It's possible to change
		 * the validation provider simply by setting this property to a different function.
		 */
		validateInput?(value: string, cursorPosition: number): ProviderResult<SourceControlInputBoxValidation | undefined | null>;
	}

	//#endregion

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
		 * The [terminal](#Terminal) for which the data was written.
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
	 * An [event](#Event) which fires when a [Terminal](#Terminal)'s dimensions change.
	 */
	export interface TerminalDimensionsChangeEvent {
		/**
		 * The [terminal](#Terminal) for which the dimensions have changed.
		 */
		readonly terminal: Terminal;
		/**
		 * The new value for the [terminal's dimensions](#Terminal.dimensions).
		 */
		readonly dimensions: TerminalDimensions;
	}

	export namespace window {
		/**
		 * An event which fires when the [dimensions](#Terminal.dimensions) of the terminal change.
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

	//#region @jrieken -> exclusive document filters

	export interface DocumentFilter {
		readonly exclusive?: boolean;
	}

	//#endregion

	//#region @alexdima - OnEnter enhancement
	export interface OnEnterRule {
		/**
		 * This rule will only execute if the text above the this line matches this regular expression.
		 */
		oneLineAboveText?: RegExp;
	}
	//#endregion

	//#region Tree View: https://github.com/microsoft/vscode/issues/61313
	export interface TreeView<T> extends Disposable {
		reveal(element: T | undefined, options?: { select?: boolean, focus?: boolean, expand?: boolean | number }): Thenable<void>;
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

	//#region Status bar item with ID and Name: https://github.com/microsoft/vscode/issues/74972

	export namespace window {

		/**
		 * Options to configure the status bar item.
		 */
		export interface StatusBarItemOptions {

			/**
			 * A unique identifier of the status bar item. The identifier
			 * is for example used to allow a user to show or hide the
			 * status bar item in the UI.
			 */
			id: string;

			/**
			 * A human readable name of the status bar item. The name is
			 * for example used as a label in the UI to show or hide the
			 * status bar item.
			 */
			name: string;

			/**
			 * Accessibility information used when screen reader interacts with this status bar item.
			 */
			accessibilityInformation?: AccessibilityInformation;

			/**
			 * The alignment of the status bar item.
			 */
			alignment?: StatusBarAlignment;

			/**
			 * The priority of the status bar item. Higher value means the item should
			 * be shown more to the left.
			 */
			priority?: number;
		}

		/**
		 * Creates a status bar [item](#StatusBarItem).
		 *
		 * @param options The options of the item. If not provided, some default values
		 * will be assumed. For example, the `StatusBarItemOptions.id` will be the id
		 * of the extension and the `StatusBarItemOptions.name` will be the extension name.
		 * @return A new status bar item.
		 */
		export function createStatusBarItem(options?: StatusBarItemOptions): StatusBarItem;
	}

	//#endregion

	//#region Custom editor move https://github.com/microsoft/vscode/issues/86146

	// TODO: Also for custom editor

	export interface CustomTextEditorProvider {

		/**
		 * Handle when the underlying resource for a custom editor is renamed.
		 *
		 * This allows the webview for the editor be preserved throughout the rename. If this method is not implemented,
		 * VS Code will destory the previous custom editor and create a replacement one.
		 *
		 * @param newDocument New text document to use for the custom editor.
		 * @param existingWebviewPanel Webview panel for the custom editor.
		 * @param token A cancellation token that indicates the result is no longer needed.
		 *
		 * @return Thenable indicating that the webview editor has been moved.
		 */
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

	//#region @rebornix: Notebook

	export enum CellKind {
		Markdown = 1,
		Code = 2
	}

	export enum CellOutputKind {
		Text = 1,
		Error = 2,
		Rich = 3
	}

	export interface CellStreamOutput {
		outputKind: CellOutputKind.Text;
		text: string;
	}

	export interface CellErrorOutput {
		outputKind: CellOutputKind.Error;
		/**
		 * Exception Name
		 */
		ename: string;
		/**
		 * Exception Value
		 */
		evalue: string;
		/**
		 * Exception call stack
		 */
		traceback: string[];
	}

	export interface NotebookCellOutputMetadata {
		/**
		 * Additional attributes of a cell metadata.
		 */
		custom?: { [key: string]: any };
	}

	export interface CellDisplayOutput {
		outputKind: CellOutputKind.Rich;
		/**
		 * { mime_type: value }
		 *
		 * Example:
		 * ```json
		 * {
		 *   "outputKind": vscode.CellOutputKind.Rich,
		 *   "data": {
		 *      "text/html": [
		 *          "<h1>Hello</h1>"
		 *       ],
		 *      "text/plain": [
		 *        "<IPython.lib.display.IFrame at 0x11dee3e80>"
		 *      ]
		 *   }
		 * }
		 */
		data: { [key: string]: any; };

		readonly metadata?: NotebookCellOutputMetadata;
	}

	export type CellOutput = CellStreamOutput | CellErrorOutput | CellDisplayOutput;

	export class NotebookCellOutputItem {

		readonly mime: string;
		readonly value: unknown;
		readonly metadata?: Record<string, string | number | boolean>;

		constructor(mime: string, value: unknown, metadata?: Record<string, string | number | boolean>);
	}

	//TODO@jrieken add id?
	export class NotebookCellOutput {

		readonly outputs: NotebookCellOutputItem[];
		readonly metadata?: Record<string, string | number | boolean>;

		constructor(outputs: NotebookCellOutputItem[], metadata?: Record<string, string | number | boolean>);

		//TODO@jrieken HACK to workaround dependency issues...
		toJSON(): any;
	}

	export enum NotebookCellRunState {
		Running = 1,
		Idle = 2,
		Success = 3,
		Error = 4
	}

	export enum NotebookRunState {
		Running = 1,
		Idle = 2
	}

	export interface NotebookCellMetadata {
		/**
		 * Controls whether a cell's editor is editable/readonly.
		 */
		editable?: boolean;

		/**
		 * Controls if the cell is executable.
		 * This metadata is ignored for markdown cell.
		 */
		runnable?: boolean;

		/**
		 * Controls if the cell has a margin to support the breakpoint UI.
		 * This metadata is ignored for markdown cell.
		 */
		breakpointMargin?: boolean;

		/**
		 * Whether the [execution order](#NotebookCellMetadata.executionOrder) indicator will be displayed.
		 * Defaults to true.
		 */
		hasExecutionOrder?: boolean;

		/**
		 * The order in which this cell was executed.
		 */
		executionOrder?: number;

		/**
		 * A status message to be shown in the cell's status bar
		 */
		statusMessage?: string;

		/**
		 * The cell's current run state
		 */
		runState?: NotebookCellRunState;

		/**
		 * If the cell is running, the time at which the cell started running
		 */
		runStartTime?: number;

		/**
		 * The total duration of the cell's last run
		 */
		lastRunDuration?: number;

		/**
		 * Whether a code cell's editor is collapsed
		 */
		inputCollapsed?: boolean;

		/**
		 * Whether a code cell's outputs are collapsed
		 */
		outputCollapsed?: boolean;

		/**
		 * Additional attributes of a cell metadata.
		 */
		custom?: { [key: string]: any };
	}

	export interface NotebookCell {
		readonly index: number;
		readonly notebook: NotebookDocument;
		readonly uri: Uri;
		readonly cellKind: CellKind;
		readonly document: TextDocument;
		readonly language: string;
		outputs: CellOutput[];
		metadata: NotebookCellMetadata;
	}

	export interface NotebookDocumentMetadata {
		/**
		 * Controls if users can add or delete cells
		 * Defaults to true
		 */
		editable?: boolean;

		/**
		 * Controls whether the full notebook can be run at once.
		 * Defaults to true
		 */
		runnable?: boolean;

		/**
		 * Default value for [cell editable metadata](#NotebookCellMetadata.editable).
		 * Defaults to true.
		 */
		cellEditable?: boolean;

		/**
		 * Default value for [cell runnable metadata](#NotebookCellMetadata.runnable).
		 * Defaults to true.
		 */
		cellRunnable?: boolean;

		/**
		 * Default value for [cell hasExecutionOrder metadata](#NotebookCellMetadata.hasExecutionOrder).
		 * Defaults to true.
		 */
		cellHasExecutionOrder?: boolean;

		displayOrder?: GlobPattern[];

		/**
		 * Additional attributes of the document metadata.
		 */
		custom?: { [key: string]: any };

		/**
		 * The document's current run state
		 */
		runState?: NotebookRunState;

		/**
		 * Whether the document is trusted, default to true
		 * When false, insecure outputs like HTML, JavaScript, SVG will not be rendered.
		 */
		trusted?: boolean;
	}

	export interface NotebookDocumentContentOptions {
		/**
		 * Controls if outputs change will trigger notebook document content change and if it will be used in the diff editor
		 * Default to false. If the content provider doesn't persisit the outputs in the file document, this should be set to true.
		 */
		transientOutputs: boolean;

		/**
		 * Controls if a meetadata property change will trigger notebook document content change and if it will be used in the diff editor
		 * Default to false. If the content provider doesn't persisit a metadata property in the file document, it should be set to true.
		 */
		transientMetadata: { [K in keyof NotebookCellMetadata]?: boolean };
	}

	export interface NotebookDocument {
		readonly uri: Uri;
		readonly version: number;
		readonly fileName: string;
		readonly viewType: string;
		readonly isDirty: boolean;
		readonly isUntitled: boolean;
		readonly cells: ReadonlyArray<NotebookCell>;
		readonly contentOptions: NotebookDocumentContentOptions;
		languages: string[];
		metadata: NotebookDocumentMetadata;
	}

	export interface NotebookConcatTextDocument {
		uri: Uri;
		isClosed: boolean;
		dispose(): void;
		onDidChange: Event<void>;
		version: number;
		getText(): string;
		getText(range: Range): string;

		offsetAt(position: Position): number;
		positionAt(offset: number): Position;
		validateRange(range: Range): Range;
		validatePosition(position: Position): Position;

		locationAt(positionOrRange: Position | Range): Location;
		positionAt(location: Location): Position;
		contains(uri: Uri): boolean
	}

	export interface WorkspaceEdit {
		replaceNotebookMetadata(uri: Uri, value: NotebookDocumentMetadata): void;
		replaceNotebookCells(uri: Uri, start: number, end: number, cells: NotebookCellData[], metadata?: WorkspaceEditEntryMetadata): void;
		replaceNotebookCellOutput(uri: Uri, index: number, outputs: (NotebookCellOutput | CellOutput)[], metadata?: WorkspaceEditEntryMetadata): void;
		replaceNotebookCellMetadata(uri: Uri, index: number, cellMetadata: NotebookCellMetadata, metadata?: WorkspaceEditEntryMetadata): void;
	}

	export interface NotebookEditorEdit {
		replaceMetadata(value: NotebookDocumentMetadata): void;
		replaceCells(start: number, end: number, cells: NotebookCellData[]): void;
		replaceCellOutput(index: number, outputs: (NotebookCellOutput | CellOutput)[]): void;
		replaceCellMetadata(index: number, metadata: NotebookCellMetadata): void;
	}

	export interface NotebookCellRange {
		readonly start: number;
		/**
		 * exclusive
		 */
		readonly end: number;
	}

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
	}

	export interface NotebookEditor {
		/**
		 * The document associated with this notebook editor.
		 */
		readonly document: NotebookDocument;

		/**
		 * The primary selected cell on this notebook editor.
		 */
		readonly selection?: NotebookCell;


		/**
		 * The current visible ranges in the editor (vertically).
		 */
		readonly visibleRanges: NotebookCellRange[];

		/**
		 * The column in which this editor shows.
		 */
		readonly viewColumn?: ViewColumn;

		/**
		 * Fired when the panel is disposed.
		 */
		readonly onDidDispose: Event<void>;

		/**
		 * Active kernel used in the editor
		 */
		readonly kernel?: NotebookKernel;

		/**
		 * Fired when the output hosting webview posts a message.
		 */
		readonly onDidReceiveMessage: Event<any>;
		/**
		 * Post a message to the output hosting webview.
		 *
		 * Messages are only delivered if the editor is live.
		 *
		 * @param message Body of the message. This must be a string or other json serializable object.
		 */
		postMessage(message: any): Thenable<boolean>;

		/**
		 * Convert a uri for the local file system to one that can be used inside outputs webview.
		 */
		asWebviewUri(localResource: Uri): Uri;

		/**
		 * Perform an edit on the notebook associated with this notebook editor.
		 *
		 * The given callback-function is invoked with an [edit-builder](#NotebookEditorEdit) which must
		 * be used to make edits. Note that the edit-builder is only valid while the
		 * callback executes.
		 *
		 * @param callback A function which can create edits using an [edit-builder](#NotebookEditorEdit).
		 * @return A promise that resolves with a value indicating if the edits could be applied.
		 */
		edit(callback: (editBuilder: NotebookEditorEdit) => void): Thenable<boolean>;

		setDecorations(decorationType: NotebookEditorDecorationType, range: NotebookCellRange): void;

		revealRange(range: NotebookCellRange, revealType?: NotebookEditorRevealType): void;
	}

	export interface NotebookOutputSelector {
		mimeTypes?: string[];
	}

	export interface NotebookRenderRequest {
		output: CellDisplayOutput;
		mimeType: string;
		outputId: string;
	}

	export interface NotebookDocumentMetadataChangeEvent {
		readonly document: NotebookDocument;
	}

	export interface NotebookCellsChangeData {
		readonly start: number;
		readonly deletedCount: number;
		readonly deletedItems: NotebookCell[];
		readonly items: NotebookCell[];
	}

	export interface NotebookCellsChangeEvent {

		/**
		 * The affected document.
		 */
		readonly document: NotebookDocument;
		readonly changes: ReadonlyArray<NotebookCellsChangeData>;
	}

	export interface NotebookCellMoveEvent {

		/**
		 * The affected document.
		 */
		readonly document: NotebookDocument;
		readonly index: number;
		readonly newIndex: number;
	}

	export interface NotebookCellOutputsChangeEvent {

		/**
		 * The affected document.
		 */
		readonly document: NotebookDocument;
		readonly cells: NotebookCell[];
	}

	export interface NotebookCellLanguageChangeEvent {

		/**
		 * The affected document.
		 */
		readonly document: NotebookDocument;
		readonly cell: NotebookCell;
		readonly language: string;
	}

	export interface NotebookCellMetadataChangeEvent {
		readonly document: NotebookDocument;
		readonly cell: NotebookCell;
	}

	export interface NotebookEditorSelectionChangeEvent {
		readonly notebookEditor: NotebookEditor;
		readonly selection?: NotebookCell;
	}

	export interface NotebookEditorVisibleRangesChangeEvent {
		readonly notebookEditor: NotebookEditor;
		readonly visibleRanges: ReadonlyArray<NotebookCellRange>;
	}

	export interface NotebookCellData {
		readonly cellKind: CellKind;
		readonly source: string;
		readonly language: string;
		readonly outputs: CellOutput[];
		readonly metadata: NotebookCellMetadata | undefined;
	}

	export interface NotebookData {
		readonly cells: NotebookCellData[];
		readonly languages: string[];
		readonly metadata: NotebookDocumentMetadata;
	}

	interface NotebookDocumentContentChangeEvent {

		/**
		 * The document that the edit is for.
		 */
		readonly document: NotebookDocument;
	}

	interface NotebookDocumentEditEvent {

		/**
		 * The document that the edit is for.
		 */
		readonly document: NotebookDocument;

		/**
		 * Undo the edit operation.
		 *
		 * This is invoked by VS Code when the user undoes this edit. To implement `undo`, your
		 * extension should restore the document and editor to the state they were in just before this
		 * edit was added to VS Code's internal edit stack by `onDidChangeCustomDocument`.
		 */
		undo(): Thenable<void> | void;

		/**
		 * Redo the edit operation.
		 *
		 * This is invoked by VS Code when the user redoes this edit. To implement `redo`, your
		 * extension should restore the document and editor to the state they were in just after this
		 * edit was added to VS Code's internal edit stack by `onDidChangeCustomDocument`.
		 */
		redo(): Thenable<void> | void;

		/**
		 * Display name describing the edit.
		 *
		 * This will be shown to users in the UI for undo/redo operations.
		 */
		readonly label?: string;
	}

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
		 * This is called by VS Code when it is clear the current backup is no longer needed, such as when a new backup
		 * is made or when the file is saved.
		 */
		delete(): void;
	}

	interface NotebookDocumentBackupContext {
		readonly destination: Uri;
	}

	interface NotebookDocumentOpenContext {
		readonly backupId?: string;
	}

	/**
	 * Communication object passed to the {@link NotebookContentProvider} and
	 * {@link NotebookOutputRenderer} to communicate with the webview.
	 */
	export interface NotebookCommunication {
		/**
		 * ID of the editor this object communicates with. A single notebook
		 * document can have multiple attached webviews and editors, when the
		 * notebook is split for instance. The editor ID lets you differentiate
		 * between them.
		 */
		readonly editorId: string;

		/**
		 * Fired when the output hosting webview posts a message.
		 */
		readonly onDidReceiveMessage: Event<any>;
		/**
		 * Post a message to the output hosting webview.
		 *
		 * Messages are only delivered if the editor is live.
		 *
		 * @param message Body of the message. This must be a string or other json serializable object.
		 */
		postMessage(message: any): Thenable<boolean>;

		/**
		 * Convert a uri for the local file system to one that can be used inside outputs webview.
		 */
		asWebviewUri(localResource: Uri): Uri;
	}

	export interface NotebookContentProvider {
		readonly options?: NotebookDocumentContentOptions;
		readonly onDidChangeNotebookContentOptions?: Event<NotebookDocumentContentOptions>;
		readonly onDidChangeNotebook: Event<NotebookDocumentContentChangeEvent | NotebookDocumentEditEvent>;

		/**
		 * Content providers should always use [file system providers](#FileSystemProvider) to
		 * resolve the raw content for `uri` as the resouce is not necessarily a file on disk.
		 */
		openNotebook(uri: Uri, openContext: NotebookDocumentOpenContext): NotebookData | Promise<NotebookData>;
		resolveNotebook(document: NotebookDocument, webview: NotebookCommunication): Promise<void>;
		saveNotebook(document: NotebookDocument, cancellation: CancellationToken): Promise<void>;
		saveNotebookAs(targetResource: Uri, document: NotebookDocument, cancellation: CancellationToken): Promise<void>;
		backupNotebook(document: NotebookDocument, context: NotebookDocumentBackupContext, cancellation: CancellationToken): Promise<NotebookDocumentBackup>;
	}

	export interface NotebookKernel {
		readonly id?: string;
		label: string;
		description?: string;
		detail?: string;
		isPreferred?: boolean;
		preloads?: Uri[];
		executeCell(document: NotebookDocument, cell: NotebookCell): void;
		cancelCellExecution(document: NotebookDocument, cell: NotebookCell): void;
		executeAllCells(document: NotebookDocument): void;
		cancelAllCellsExecution(document: NotebookDocument): void;
	}

	export type NotebookFilenamePattern = GlobPattern | { include: GlobPattern; exclude: GlobPattern };

	export interface NotebookDocumentFilter {
		viewType?: string | string[];
		filenamePattern?: NotebookFilenamePattern;
	}

	export interface NotebookKernelProvider<T extends NotebookKernel = NotebookKernel> {
		onDidChangeKernels?: Event<NotebookDocument | undefined>;
		provideKernels(document: NotebookDocument, token: CancellationToken): ProviderResult<T[]>;
		resolveKernel?(kernel: T, document: NotebookDocument, webview: NotebookCommunication, token: CancellationToken): ProviderResult<void>;
	}

	/**
	 * Represents the alignment of status bar items.
	 */
	export enum NotebookCellStatusBarAlignment {

		/**
		 * Aligned to the left side.
		 */
		Left = 1,

		/**
		 * Aligned to the right side.
		 */
		Right = 2
	}

	export interface NotebookCellStatusBarItem {
		readonly cell: NotebookCell;
		readonly alignment: NotebookCellStatusBarAlignment;
		readonly priority?: number;
		text: string;
		tooltip: string | undefined;
		command: string | Command | undefined;
		accessibilityInformation?: AccessibilityInformation;
		show(): void;
		hide(): void;
		dispose(): void;
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

	export interface NotebookDocumentShowOptions {
		viewColumn?: ViewColumn;
		preserveFocus?: boolean;
		preview?: boolean;
		selection?: NotebookCellRange;
	}


	export namespace notebook {
		export function registerNotebookContentProvider(
			notebookType: string,
			provider: NotebookContentProvider,
			options?: NotebookDocumentContentOptions & {
				/**
				 * Not ready for production or development use yet.
				 */
				viewOptions?: {
					displayName: string;
					filenamePattern: NotebookFilenamePattern[];
					exclusive?: boolean;
				};
			}
		): Disposable;

		export function registerNotebookKernelProvider(
			selector: NotebookDocumentFilter,
			provider: NotebookKernelProvider
		): Disposable;

		export function createNotebookEditorDecorationType(options: NotebookDecorationRenderOptions): NotebookEditorDecorationType;
		export function openNotebookDocument(uri: Uri, viewType?: string): Promise<NotebookDocument>;
		export const onDidOpenNotebookDocument: Event<NotebookDocument>;
		export const onDidCloseNotebookDocument: Event<NotebookDocument>;
		export const onDidSaveNotebookDocument: Event<NotebookDocument>;

		/**
		 * All currently known notebook documents.
		 */
		export const notebookDocuments: ReadonlyArray<NotebookDocument>;
		export const onDidChangeNotebookDocumentMetadata: Event<NotebookDocumentMetadataChangeEvent>;
		export const onDidChangeNotebookCells: Event<NotebookCellsChangeEvent>;
		export const onDidChangeCellOutputs: Event<NotebookCellOutputsChangeEvent>;
		export const onDidChangeCellLanguage: Event<NotebookCellLanguageChangeEvent>;
		export const onDidChangeCellMetadata: Event<NotebookCellMetadataChangeEvent>;
		/**
		 * Create a document that is the concatenation of all  notebook cells. By default all code-cells are included
		 * but a selector can be provided to narrow to down the set of cells.
		 *
		 * @param notebook
		 * @param selector
		 */
		export function createConcatTextDocument(notebook: NotebookDocument, selector?: DocumentSelector): NotebookConcatTextDocument;

		export const onDidChangeActiveNotebookKernel: Event<{ document: NotebookDocument, kernel: NotebookKernel | undefined }>;

		/**
		 * Creates a notebook cell status bar [item](#NotebookCellStatusBarItem).
		 * It will be disposed automatically when the notebook document is closed or the cell is deleted.
		 *
		 * @param cell The cell on which this item should be shown.
		 * @param alignment The alignment of the item.
		 * @param priority The priority of the item. Higher values mean the item should be shown more to the left.
		 * @return A new status bar item.
		 */
		export function createCellStatusBarItem(cell: NotebookCell, alignment?: NotebookCellStatusBarAlignment, priority?: number): NotebookCellStatusBarItem;
	}

	export namespace window {
		export const visibleNotebookEditors: NotebookEditor[];
		export const onDidChangeVisibleNotebookEditors: Event<NotebookEditor[]>;
		export const activeNotebookEditor: NotebookEditor | undefined;
		export const onDidChangeActiveNotebookEditor: Event<NotebookEditor | undefined>;
		export const onDidChangeNotebookEditorSelection: Event<NotebookEditorSelectionChangeEvent>;
		export const onDidChangeNotebookEditorVisibleRanges: Event<NotebookEditorVisibleRangesChangeEvent>;
		export function showNotebookDocument(document: NotebookDocument, options?: NotebookDocumentShowOptions): Promise<NotebookEditor>;
	}

	//#endregion

	//#region https://github.com/microsoft/vscode/issues/39441

	export interface CompletionItem {
		/**
		 * Will be merged into CompletionItem#label
		 */
		label2?: CompletionItemLabel;
	}

	export interface CompletionItemLabel {
		/**
		 * The function or variable. Rendered leftmost.
		 */
		name: string;

		/**
		 * The parameters without the return type. Render after `name`.
		 */
		parameters?: string;

		/**
		 * The fully qualified name, like package name or file path. Rendered after `signature`.
		 */
		qualifier?: string;

		/**
		 * The return-type of a function or type of a property/variable. Rendered rightmost.
		 */
		type?: string;
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
		 * The icon path or [ThemeIcon](#ThemeIcon) for the timeline item.
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
		 * The [command](#Command) that should be executed when the timeline item is selected.
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
		 * The [uri](#Uri) of the resource for which the timeline changed.
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
		 * An array of [timeline items](#TimelineItem).
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
		 * Provide [timeline items](#TimelineItem) for a [Uri](#Uri).
		 *
		 * @param uri The [uri](#Uri) of the file to provide the timeline for.
		 * @param options A set of options to determine how results should be returned.
		 * @param token A cancellation token.
		 * @return The [timeline result](#TimelineResult) or a thenable that resolves to such. The lack of a result
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
		 * @return A [disposable](#Disposable) that unregisters this provider when being disposed.
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
		export function getTokenInformationAtPosition(document: TextDocument, position: Position): Promise<TokenInformation>;
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
		 * The [notebook](#NotebookDocument) that contains this document as a notebook cell or `undefined` when
		 * the document is not contained by a notebook (this should be the more frequent case).
		 */
		notebook: NotebookDocument | undefined;
	}
	//#endregion

	//#region https://github.com/microsoft/vscode/issues/107467
	/*
		General activation events:
			- `onLanguage:*` most test extensions will want to activate when their
				language is opened to provide code lenses.
			- `onTests:*` new activation event very simiular to `workspaceContains`,
				but only fired when the user wants to run tests or opens the test explorer.
	*/
	export namespace test {
		/**
		 * Registers a provider that discovers tests for the given document
		 * selectors. It is activated when either tests need to be enumerated, or
		 * a document matching the selector is opened.
		 */
		export function registerTestProvider<T extends TestItem>(testProvider: TestProvider<T>): Disposable;

		/**
		 * Runs tests with the given options. If no options are given, then
		 * all tests are run. Returns the resulting test run.
		 */
		export function runTests<T extends TestItem>(options: TestRunOptions<T>): Thenable<void>;

		/**
		 * Returns an observer that retrieves tests in the given workspace folder.
		 */
		export function createWorkspaceTestObserver(workspaceFolder: WorkspaceFolder): TestObserver;

		/**
		 * Returns an observer that retrieves tests in the given text document.
		 */
		export function createDocumentTestObserver(document: TextDocument): TestObserver;
	}

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
		readonly onDidChangeTest: Event<TestChangeEvent>;

		/**
		 * An event the fires when all test providers have signalled that the tests
		 * the observer references have been discovered. Providers may continue to
		 * watch for changes and cause {@link onDidChangeTest} to fire as files
		 * change, until the observer is disposed.
		 *
		 * @todo as below
		 */
		readonly onDidDiscoverInitialTests: Event<void>;

		/**
		 * Dispose of the observer, allowing VS Code to eventually tell test
		 * providers that they no longer need to update tests.
		 */
		dispose(): void;
	}

	export interface TestChangeEvent {
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

		/**
		 * Highest node in the test tree under which changes were made. This can
		 * be easily plugged into events like the TreeDataProvider update event.
		 */
		readonly commonChangeAncestor: TestItem | null;
	}

	/**
	 * Tree of tests returned from the provide methods in the {@link TestProvider}.
	 */
	export interface TestHierarchy<T extends TestItem> {
		/**
		 * Root node for tests. The `testRoot` instance must not be replaced over
		 * the lifespan of the TestHierarchy, since you will need to reference it
		 * in `onDidChangeTest` when a test is added or removed.
		 */
		readonly root: T;

		/**
		 * An event that fires when an existing test under the `root` changes.
		 * This can be a result of a state change in a test run, a property update,
		 * or an update to its children. Changes made to tests will not be visible
		 * to {@link TestObserver} instances until this event is fired.
		 *
		 * This will signal a change recursively to all children of the given node.
		 * For example, firing the event with the {@link testRoot} will refresh
		 * all tests.
		 */
		readonly onDidChangeTest: Event<T>;

		/**
		 * An event that should be fired when all tests that are currently defined
		 * have been discovered. The provider should continue to watch for changes
		 * and fire `onDidChangeTest` until the hierarchy is disposed.
		 *
		 * @todo can this be covered by existing progress apis? Or return a promise
		 */
		readonly onDidDiscoverInitialTests: Event<void>;

		/**
		 * Dispose will be called when there are no longer observers interested
		 * in the hierarchy.
		 */
		dispose(): void;
	}

	/**
	 * Discovers and provides tests. It's expected that the TestProvider will
	 * ambiently listen to {@link vscode.window.onDidChangeVisibleTextEditors} to
	 * provide test information about the open files for use in code lenses and
	 * other file-specific UI.
	 *
	 * Additionally, the UI may request it to discover tests for the workspace
	 * via `addWorkspaceTests`.
	 *
	 * @todo rename from provider
	 */
	export interface TestProvider<T extends TestItem = TestItem> {
		/**
		 * Requests that tests be provided for the given workspace. This will
		 * generally be called when tests need to be enumerated for the
		 * workspace.
		 *
		 * It's guaranteed that this method will not be called again while
		 * there is a previous undisposed watcher for the given workspace folder.
		 */
		createWorkspaceTestHierarchy?(workspace: WorkspaceFolder): TestHierarchy<T>;

		/**
		 * Requests that tests be provided for the given document. This will
		 * be called when tests need to be enumerated for a single open file,
		 * for instance by code lens UI.
		 */
		createDocumentTestHierarchy?(document: TextDocument): TestHierarchy<T>;

		/**
		 * Starts a test run. This should cause {@link onDidChangeTest} to
		 * fire with update test states during the run.
		 * @todo this will eventually need to be able to return a summary report, coverage for example.
		 */
		runTests?(options: TestRunOptions<T>, cancellationToken: CancellationToken): ProviderResult<void>;
	}

	/**
	 * Options given to `TestProvider.runTests`
	 */
	export interface TestRunOptions<T extends TestItem = TestItem> {
		/**
		 * Array of specific tests to run. The {@link TestProvider.testRoot} may
		 * be provided as an indication to run all tests.
		 */
		tests: T[];

		/**
		 * Whether or not tests in this run should be debugged.
		 */
		debug: boolean;
	}

	/**
	 * A test item is an item shown in the "test explorer" view. It encompasses
	 * both a suite and a test, since they have almost or identical capabilities.
	 */
	export interface TestItem {
		/**
		 * Display name describing the test case.
		 */
		label: string;

		/**
		 * Optional description that appears next to the label.
		 */
		description?: string;

		/**
		 * Whether this test item can be run individually, defaults to `true`
		 * if not provided.
		 *
		 * In some cases, like Go's tests, test can have children but these
		 * children cannot be run independently.
		 */
		runnable?: boolean;

		/**
		 * Whether this test item can be debugged. Defaults to `false` if not provided.
		 */
		debuggable?: boolean;

		/**
		 * VS Code location.
		 */
		location?: Location;

		/**
		 * Optional list of nested tests for this item.
		 */
		children?: TestItem[];

		/**
		 * Test run state. Will generally be {@link TestRunState.Unset} by
		 * default.
		 */
		state: TestState;
	}

	export enum TestRunState {
		// Initial state
		Unset = 0,
		// Test is currently running
		Running = 1,
		// Test run has passed
		Passed = 2,
		// Test run has failed (on an assertion)
		Failed = 3,
		// Test run has been skipped
		Skipped = 4,
		// Test run failed for some other reason (compilation error, timeout, etc)
		Errored = 5
	}

	/**
	 * TestState includes a test and its run state. This is included in the
	 * {@link TestItem} and is immutable; it should be replaced in th TestItem
	 * in order to update it. This allows consumers to quickly and easily check
	 * for changes via object identity.
	 */
	export class TestState {
		/**
		 * Current state of the test.
		 */
		readonly runState: TestRunState;

		/**
		 * Optional duration of the test run, in milliseconds.
		 */
		readonly duration?: number;

		/**
		 * Associated test run message. Can, for example, contain assertion
		 * failure information if the test fails.
		 */
		readonly messages: ReadonlyArray<Readonly<TestMessage>>;

		/**
		 * @param state Run state to hold in the test state
		 * @param messages List of associated messages for the test
		 * @param duration Length of time the test run took, if appropriate.
		 */
		constructor(runState: TestRunState, messages?: TestMessage[], duration?: number);
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
	export interface TestMessage {
		/**
		 * Human-readable message text to display.
		 */
		message: string | MarkdownString;

		/**
		 * Message severity. Defaults to "Error", if not provided.
		 */
		severity?: TestMessageSeverity;

		/**
		 * Expected test output. If given with `actual`, a diff view will be shown.
		 */
		expectedOutput?: string;

		/**
		 * Actual test output. If given with `actual`, a diff view will be shown.
		 */
		actualOutput?: string;

		/**
		 * Associated file location.
		 */
		location?: Location;
	}
	//#endregion

	//#region Statusbar Item Background Color (https://github.com/microsoft/vscode/issues/110214)

	/**
	 * A status bar item is a status bar contribution that can
	 * show text and icons and run a command on click.
	 */
	export interface StatusBarItem {

		/**
		 * The background color for this entry.
		 *
		 * Note: only `new ThemeColor('statusBarItem.errorBackground')` is
		 * supported for now. More background colors may be supported in the
		 * future.
		 *
		 * Note: when a background color is set, the statusbar may override
		 * the `color` choice to ensure the entry is readable in all themes.
		 */
		backgroundColor: ThemeColor | undefined;
	}

	//#endregion
}
