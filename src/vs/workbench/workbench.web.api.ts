/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/workbench/workbench.web.main';
import { main } from 'vs/workbench/browser/web.main';
import { UriComponents, URI } from 'vs/base/common/uri';
import { IFileSystemProvider, FileSystemProviderCapabilities, IFileChange, FileChangeType } from 'vs/platform/files/common/files';
import { IWebSocketFactory, IWebSocket } from 'vs/platform/remote/browser/browserSocketFactory';
import { ICredentialsProvider } from 'vs/workbench/services/credentials/browser/credentialsService';
import { IExtensionManifest } from 'vs/platform/extensions/common/extensions';
import { IURLCallbackProvider } from 'vs/workbench/services/url/browser/urlService';
import { LogLevel } from 'vs/platform/log/common/log';
import { IUpdateProvider, IUpdate } from 'vs/workbench/services/update/browser/updateService';
import { Event, Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { IWorkspaceProvider, IWorkspace } from 'vs/workbench/services/host/browser/browserHostService';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';

interface IResourceUriProvider {
	(uri: URI): URI;
}

interface IStaticExtension {
	packageJSON: IExtensionManifest;
	extensionLocation: URI;
}

interface ICommontTelemetryPropertiesResolver {
	(): { [key: string]: any };
}

interface IExternalUriResolver {
	(uri: URI): Promise<URI>;
}

interface ITunnelFactory {
	(tunnelOptions: ITunnelOptions): Promise<ITunnel> | undefined;
}

interface ITunnelOptions {
	remoteAddress: { port: number, host: string };

	/**
	 * The desired local port. If this port can't be used, then another will be chosen.
	 */
	localAddressPort?: number;

	label?: string;
}

interface ITunnel extends IDisposable {
	remoteAddress: { port: number, host: string };

	/**
	 * The complete local address(ex. localhost:1234)
	 */
	localAddress: string;

	/**
	 * Implementers of Tunnel should fire onDidDispose when dispose is called.
	 */
	onDidDispose: Event<void>;
}

interface IShowPortCandidate {
	(host: string, port: number, detail: string): Promise<boolean>;
}

interface ICommand {

	/**
	 * An identifier for the command. Commands can be executed from extensions
	 * using the `vscode.commands.executeCommand` API using that command ID.
	 */
	id: string,

	/**
	 * A function that is being executed with any arguments passed over. The
	 * return type will be send back to the caller.
	 *
	 * Note: arguments and return type should be serializable so that they can
	 * be exchanged across processes boundaries.
	 */
	handler: (...args: any[]) => unknown;
}

interface IHomeIndicator {

	/**
	 * The identifier of the command to run when clicking the home indicator.
	 */
	command: string;

	/**
	 * The icon name for the home indicator. This needs to be one of the existing
	 * icons from our Codicon icon set. For example `sync`.
	 */
	icon: string;

	/**
	 * A tooltip that will appear while hovering over the home indicator.
	 */
	title: string;
}

interface IDefaultSideBarLayout {
	visible?: boolean;
	containers?: ({
		id: 'explorer' | 'run' | 'scm' | 'search' | 'extensions' | 'remote' | string;
		active: true;
		order?: number;
		views?: {
			id: string;
			order?: number;
			visible?: boolean;
			collapsed?: boolean;
		}[];
	} | {
		id: 'explorer' | 'run' | 'scm' | 'search' | 'extensions' | 'remote' | string;
		active?: false;
		order?: number;
		visible?: boolean;
		views?: {
			id: string;
			order?: number;
			visible?: boolean;
			collapsed?: boolean;
		}[];
	})[];
}

interface IDefaultPanelLayout {
	visible?: boolean;
	containers?: ({
		id: 'terminal' | 'debug' | 'problems' | 'output' | 'comments' | string;
		order?: number;
		active: true;
	} | {
		id: 'terminal' | 'debug' | 'problems' | 'output' | 'comments' | string;
		order?: number;
		active?: false;
		visible?: boolean;
	})[];
}

interface IDefaultEditor {
	readonly uri: UriComponents;
	readonly openOnlyIfExists?: boolean;
}

interface IDefaultLayout {
	readonly sidebar?: IDefaultSideBarLayout;
	readonly panel?: IDefaultPanelLayout;
	readonly editors?: IDefaultEditor[];
}

interface IWorkbenchConstructionOptions {

	//#region Connection related configuration

	/**
	 * The remote authority is the IP:PORT from where the workbench is served
	 * from. It is for example being used for the websocket connections as address.
	 */
	readonly remoteAuthority?: string;

	/**
	 * The connection token to send to the server.
	 */
	readonly connectionToken?: string;

	/**
	 * An endpoint to serve iframe content ("webview") from. This is required
	 * to provide full security isolation from the workbench host.
	 */
	readonly webviewEndpoint?: string;

	/**
	 * A factory for web sockets.
	 */
	readonly webSocketFactory?: IWebSocketFactory;

	/**
	 * A provider for resource URIs.
	 */
	readonly resourceUriProvider?: IResourceUriProvider;

	/**
	 * Resolves an external uri before it is opened.
	 */
	readonly resolveExternalUri?: IExternalUriResolver;

	/**
	 * Support for creating tunnels.
	 */
	readonly tunnelFactory?: ITunnelFactory;

	/**
	 * Support for filtering candidate ports
	 */
	readonly showCandidate?: IShowPortCandidate;

	//#endregion


	//#region Workbench configuration

	/**
	 * A handler for opening workspaces and providing the initial workspace.
	 */
	readonly workspaceProvider?: IWorkspaceProvider;

	/**
	 * The user data provider is used to handle user specific application
	 * state like settings, keybindings, UI state (e.g. opened editors) and snippets.
	 */
	userDataProvider?: IFileSystemProvider;

	/**
	 * Session id of the current authenticated user
	 */
	readonly authenticationSessionId?: string;

	/**
	 * Enables user data sync by default and syncs into the current authenticated user account using the provided [authenticationSessionId}(#authenticationSessionId).
	 */
	readonly enableSyncByDefault?: boolean;

	/**
	 * The credentials provider to store and retrieve secrets.
	 */
	readonly credentialsProvider?: ICredentialsProvider;

	/**
	 * Add static extensions that cannot be uninstalled but only be disabled.
	 */
	readonly staticExtensions?: ReadonlyArray<IStaticExtension>;

	/**
	 * Support for URL callbacks.
	 */
	readonly urlCallbackProvider?: IURLCallbackProvider;

	/**
	 * Support for update reporting.
	 */
	readonly updateProvider?: IUpdateProvider;

	/**
	 * Support adding additional properties to telemetry.
	 */
	readonly resolveCommonTelemetryProperties?: ICommontTelemetryPropertiesResolver;

	/**
	 * A set of optional commands that should be registered with the commands
	 * registry.
	 *
	 * Note: commands can be called from extensions if the identifier is known!
	 */
	readonly commands?: readonly ICommand[];

	/**
	 * Optional home indicator to appear above the hamburger menu in the activity bar.
	 */
	readonly homeIndicator?: IHomeIndicator;

	/**
	 * Optional default layout to apply on first time the workspace is opened.
	 */
	readonly defaultLayout?: IDefaultLayout;

	//#endregion


	//#region Diagnostics

	/**
	 * Current logging level. Default is `LogLevel.Info`.
	 */
	readonly logLevel?: LogLevel;

	/**
	 * Whether to enable the smoke test driver.
	 */
	readonly driver?: boolean;

	//#endregion
}

interface IWorkbench {
	commands: {
		executeCommand(command: string, ...args: any[]): Promise<unknown>;
	}
}

/**
 * Creates the workbench with the provided options in the provided container.
 *
 * @param domElement the container to create the workbench in
 * @param options for setting up the workbench
 */
let created = false;
let workbenchPromiseResolve: Function;
const workbenchPromise = new Promise<IWorkbench>(resolve => workbenchPromiseResolve = resolve);
async function create(domElement: HTMLElement, options: IWorkbenchConstructionOptions): Promise<void> {

	// Assert that the workbench is not created more than once. We currently
	// do not support this and require a full context switch to clean-up.
	if (created) {
		throw new Error('Unable to create the VSCode workbench more than once.');
	} else {
		created = true;
	}

	// Startup workbench and resolve waiters
	const workbench = await main(domElement, options);
	workbenchPromiseResolve(workbench);

	// Register commands if any
	if (Array.isArray(options.commands)) {
		for (const command of options.commands) {
			CommandsRegistry.registerCommand(command.id, (accessor, ...args) => {
				// we currently only pass on the arguments but not the accessor
				// to the command to reduce our exposure of internal API.
				return command.handler(...args);
			});
		}
	}
}


//#region API Facade

namespace commands {

	/**
	* Allows to execute any command if known with the provided arguments.
	*
	* @param command Identifier of the command to execute.
	* @param rest Parameters passed to the command function.
	* @return A promise that resolves to the returned value of the given command.
	*/
	export async function executeCommand(command: string, ...args: any[]): Promise<unknown> {
		const workbench = await workbenchPromise;

		return workbench.commands.executeCommand(command, ...args);
	}
}

export {

	// Factory
	create,
	IWorkbenchConstructionOptions,
	IWorkbench,

	// Basic Types
	URI,
	UriComponents,
	Event,
	Emitter,
	IDisposable,
	Disposable,

	// Workspace
	IWorkspace,
	IWorkspaceProvider,

	// FileSystem
	IFileSystemProvider,
	FileSystemProviderCapabilities,
	IFileChange,
	FileChangeType,

	// WebSockets
	IWebSocketFactory,
	IWebSocket,

	// Resources
	IResourceUriProvider,

	// Credentials
	ICredentialsProvider,

	// Static Extensions
	IStaticExtension,
	IExtensionManifest,

	// Callbacks
	IURLCallbackProvider,

	// LogLevel
	LogLevel,

	// Updates
	IUpdateProvider,
	IUpdate,

	// Telemetry
	ICommontTelemetryPropertiesResolver,

	// External Uris
	IExternalUriResolver,

	// Tunnel
	ITunnelFactory,
	ITunnel,
	ITunnelOptions,

	// Ports
	IShowPortCandidate,

	// Commands
	ICommand,
	commands,

	// Home Indicator
	IHomeIndicator,

	// Default layout
	IDefaultEditor,
	IDefaultLayout,
	IDefaultPanelLayout,
	IDefaultSideBarLayout,
};

//#endregion
