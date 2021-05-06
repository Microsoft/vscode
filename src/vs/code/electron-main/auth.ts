/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { hash } from 'vs/base/common/hash';
import { app, AuthInfo, WebContents, Event as ElectronEvent, AuthenticationResponseDetails } from 'electron';
import { ILogService } from 'vs/platform/log/common/log';
import { IWindowsMainService } from 'vs/platform/windows/electron-main/windows';
import { INativeHostMainService } from 'vs/platform/native/electron-main/nativeHostMainService';
import { IEncryptionMainService } from 'vs/platform/encryption/electron-main/encryptionMainService';
import { generateUuid } from 'vs/base/common/uuid';
import { IProductService } from 'vs/platform/product/common/productService';
import { CancellationToken } from 'vs/base/common/cancellation';

interface ElectronAuthenticationResponseDetails extends AuthenticationResponseDetails {
	firstAuthAttempt?: boolean; // https://github.com/electron/electron/blob/84a42a050e7d45225e69df5bd2d2bf9f1037ea41/shell/browser/login_handler.cc#L70
}

type LoginEvent = {
	event: ElectronEvent;
	authInfo: AuthInfo;
	req: ElectronAuthenticationResponseDetails;

	callback: (username?: string, password?: string) => void;
};

type Credentials = {
	username: string;
	password: string;
};

enum ProxyAuthState {

	/**
	 * Initial state: we will try to use stored credentials
	 * first to reply to the auth challenge.
	 */
	Initial = 1,

	/**
	 * We used stored credentials and are still challenged,
	 * so we will show a login dialog next.
	 */
	StoredCredentialsUsed,

	/**
	 * Finally, if we showed a login dialog already, we will
	 * not show any more login dialogs until restart to reduce
	 * the UI noise.
	 */
	LoginDialogShown
}

export class ProxyAuthHandler extends Disposable {

	private readonly PROXY_CREDENTIALS_SERVICE_KEY = `${this.productService.urlProtocol}.proxy-credentials`;

	private pendingProxyResolve: Promise<Credentials | undefined> | undefined = undefined;

	private state = ProxyAuthState.Initial;

	private sessionCredentials: Credentials | undefined = undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@IWindowsMainService private readonly windowsMainService: IWindowsMainService,
		@INativeHostMainService private readonly nativeHostMainService: INativeHostMainService,
		@IEncryptionMainService private readonly encryptionMainService: IEncryptionMainService,
		@IProductService private readonly productService: IProductService
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {
		const onLogin = Event.fromNodeEventEmitter<LoginEvent>(app, 'login', (event: ElectronEvent, webContents: WebContents, req: ElectronAuthenticationResponseDetails, authInfo: AuthInfo, callback) => ({ event, webContents, req, authInfo, callback }));
		this._register(onLogin(this.onLogin, this));
	}

	private async onLogin({ event, authInfo, req, callback }: LoginEvent): Promise<void> {
		if (!authInfo.isProxy) {
			return; // only for proxy
		}

		if (!this.pendingProxyResolve && this.state === ProxyAuthState.LoginDialogShown && req.firstAuthAttempt) {
			this.logService.trace('auth#onLogin (proxy) - exit - proxy dialog already shown');

			return; // only one dialog per session at max (except when firstAuthAttempt: false which indicates a login problem)
		}

		// Signal we handle this event on our own, otherwise
		// Electron will ignore our provided credentials.
		event.preventDefault();

		let credentials: Credentials | undefined = undefined;
		if (!this.pendingProxyResolve) {
			this.logService.trace('auth#onLogin (proxy) - no pending proxy handling found, starting new');

			this.pendingProxyResolve = this.resolveProxyCredentials(authInfo);
			try {
				credentials = await this.pendingProxyResolve;
			} finally {
				this.pendingProxyResolve = undefined;
			}
		} else {
			this.logService.trace('auth#onLogin (proxy) - pending proxy handling found');

			credentials = await this.pendingProxyResolve;
		}

		// According to Electron docs, it is fine to call back without
		// username or password to signal that the authentication was handled
		// by us, even though without having credentials received:
		//
		// > If `callback` is called without a username or password, the authentication
		// > request will be cancelled and the authentication error will be returned to the
		// > page.
		callback(credentials?.username, credentials?.password);
	}

	private async resolveProxyCredentials(authInfo: AuthInfo): Promise<Credentials | undefined> {
		this.logService.trace('auth#resolveProxyCredentials (proxy) - enter');

		try {
			const credentials = await this.doResolveProxyCredentials(authInfo);
			if (credentials) {
				this.logService.trace('auth#resolveProxyCredentials (proxy) - got credentials');

				return credentials;
			} else {
				this.logService.trace('auth#resolveProxyCredentials (proxy) - did not get credentials');
			}
		} finally {
			this.logService.trace('auth#resolveProxyCredentials (proxy) - exit');
		}

		return undefined;
	}

	private async doResolveProxyCredentials(authInfo: AuthInfo): Promise<Credentials | undefined> {
		this.logService.trace('auth#doResolveProxyCredentials - enter', authInfo);

		// Compute a hash over the authentication info to be used
		// with the credentials store to return the right credentials
		// given the properties of the auth request
		// (see https://github.com/microsoft/vscode/issues/109497)
		const authInfoHash = String(hash({ scheme: authInfo.scheme, host: authInfo.host, port: authInfo.port }));

		// Find any previously stored credentials
		let storedUsername: string | undefined = undefined;
		let storedPassword: string | undefined = undefined;
		try {
			const encryptedSerializedProxyCredentials = await this.nativeHostMainService.getPassword(undefined, this.PROXY_CREDENTIALS_SERVICE_KEY, authInfoHash);
			if (encryptedSerializedProxyCredentials) {
				const credentials: Credentials = JSON.parse(await this.encryptionMainService.decrypt(encryptedSerializedProxyCredentials));

				storedUsername = credentials.username;
				storedPassword = credentials.password;
			}
		} catch (error) {
			this.logService.error(error); // handle errors by asking user for login via dialog
		}

		// Reply with stored credentials unless we used them already.
		// In that case we need to show a login dialog again because
		// they seem invalid.
		if (this.state !== ProxyAuthState.StoredCredentialsUsed && typeof storedUsername === 'string' && typeof storedPassword === 'string') {
			this.logService.trace('auth#doResolveProxyCredentials (proxy) - exit - found stored credentials to use');
			this.state = ProxyAuthState.StoredCredentialsUsed;

			return { username: storedUsername, password: storedPassword };
		}

		// Find suitable window to show dialog: prefer to show it in the
		// active window because any other network request will wait on
		// the credentials and we want the user to present the dialog.
		const window = this.windowsMainService.getFocusedWindow() || this.windowsMainService.getLastActiveWindow();
		if (!window) {
			this.logService.trace('auth#doResolveProxyCredentials (proxy) - exit - no opened window found to show dialog in');

			return undefined; // unexpected
		}

		this.logService.trace(`auth#doResolveProxyCredentials (proxy) - asking window ${window.id} to handle proxy login`);

		// Open proxy dialog
		const payload = {
			authInfo,
			username: this.sessionCredentials?.username ?? storedUsername, // prefer to show already used username (if any) over stored
			password: this.sessionCredentials?.password ?? storedPassword, // prefer to show already used password (if any) over stored
			replyChannel: `vscode:proxyAuthResponse:${generateUuid()}`
		};
		window.sendWhenReady('vscode:openProxyAuthenticationDialog', CancellationToken.None, payload);
		this.state = ProxyAuthState.LoginDialogShown;

		// Handle reply
		const loginDialogCredentials = await new Promise<Credentials | undefined>(resolve => {
			const proxyAuthResponseHandler = async (event: ElectronEvent, channel: string, reply: Credentials & { remember: boolean } | undefined /* canceled */) => {
				if (channel === payload.replyChannel) {
					this.logService.trace(`auth#doResolveProxyCredentials - exit - received credentials from window ${window.id}`);
					window.win?.webContents.off('ipc-message', proxyAuthResponseHandler);

					// We got credentials from the window
					if (reply) {
						const credentials: Credentials = { username: reply.username, password: reply.password };

						// Update stored credentials based on `remember` flag
						try {
							if (reply.remember) {
								const encryptedSerializedCredentials = await this.encryptionMainService.encrypt(JSON.stringify(credentials));
								await this.nativeHostMainService.setPassword(undefined, this.PROXY_CREDENTIALS_SERVICE_KEY, authInfoHash, encryptedSerializedCredentials);
							} else {
								await this.nativeHostMainService.deletePassword(undefined, this.PROXY_CREDENTIALS_SERVICE_KEY, authInfoHash);
							}
						} catch (error) {
							this.logService.error(error); // handle gracefully
						}

						resolve({ username: credentials.username, password: credentials.password });
					}

					// We did not get any credentials from the window (e.g. cancelled)
					else {
						resolve(undefined);
					}
				}
			};

			window.win?.webContents.on('ipc-message', proxyAuthResponseHandler);
		});

		// Remember credentials for the session in case
		// the credentials are wrong and we show the dialog
		// again
		this.sessionCredentials = loginDialogCredentials;

		return loginDialogCredentials;
	}
}
