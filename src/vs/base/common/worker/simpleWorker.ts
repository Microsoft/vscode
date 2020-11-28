/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { transformErrorForSerialization } from 'vs/base/common/errors';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { isWeb } from 'vs/base/common/platform';
import * as types from 'vs/base/common/types';

const INITIALIZE = '$initialize';

export interface IWorker extends IDisposable {
	getId(): number;
	postMessage(message: any, transfer: ArrayBuffer[]): void;
}

export interface IWorkerCallback {
	(message: any): void;
}

export interface IWorkerFactory {
	create(moduleId: string, callback: IWorkerCallback, onErrorCallback: (err: any) => void): IWorker;
}

let webWorkerWarningLogged = false;
export function logOnceWebWorkerWarning(err: any): void {
	if (!isWeb) {
		// running tests
		return;
	}
	if (!webWorkerWarningLogged) {
		webWorkerWarningLogged = true;
		console.warn('Could not create web worker(s). Falling back to loading web worker code in main thread, which might cause UI freezes. Please see https://github.com/microsoft/monaco-editor#faq');
	}
	console.warn(err.message);
}

interface IMessage {
	vsWorker: number;
	req?: string;
	seq?: string;
}

interface IRequestMessage extends IMessage {
	req: string;
	method: string;
	args: any[];
}

interface IReplyMessage extends IMessage {
	seq: string;
	err: any;
	res: any;
}

interface IMessageReply {
	resolve: (value?: any) => void;
	reject: (error?: any) => void;
}

interface IMessageHandler {
	sendMessage(msg: any, transfer?: ArrayBuffer[]): void;
	handleMessage(method: string, args: any[]): Promise<any>;
}

class SimpleWorkerProtocol {

	private _workerId: number;
	private _lastSentReq: number;
	private _pendingReplies: { [req: string]: IMessageReply; };
	private _handler: IMessageHandler;

	constructor(handler: IMessageHandler) {
		this._workerId = -1;
		this._handler = handler;
		this._lastSentReq = 0;
		this._pendingReplies = Object.create(null);
	}

	public setWorkerId(workerId: number): void {
		this._workerId = workerId;
	}

	public sendMessage(method: string, args: any[]): Promise<any> {
		let req = String(++this._lastSentReq);
		return new Promise<any>((resolve, reject) => {
			this._pendingReplies[req] = {
				resolve: resolve,
				reject: reject
			};
			this._send({
				vsWorker: this._workerId,
				req: req,
				method: method,
				args: args
			});
		});
	}

	public handleMessage(message: IMessage): void {
		if (!message || !message.vsWorker) {
			return;
		}
		if (this._workerId !== -1 && message.vsWorker !== this._workerId) {
			return;
		}
		this._handleMessage(message);
	}

	private _handleMessage(msg: IMessage): void {
		if (msg.seq) {
			let replyMessage = <IReplyMessage>msg;
			if (!this._pendingReplies[replyMessage.seq]) {
				console.warn('Got reply to unknown seq');
				return;
			}

			let reply = this._pendingReplies[replyMessage.seq];
			delete this._pendingReplies[replyMessage.seq];

			if (replyMessage.err) {
				let err = replyMessage.err;
				if (replyMessage.err.$isError) {
					err = new Error();
					err.name = replyMessage.err.name;
					err.message = replyMessage.err.message;
					err.stack = replyMessage.err.stack;
				}
				reply.reject(err);
				return;
			}

			reply.resolve(replyMessage.res);
			return;
		}

		let requestMessage = <IRequestMessage>msg;
		let req = requestMessage.req;
		let result = this._handler.handleMessage(requestMessage.method, requestMessage.args);
		result.then((r) => {
			this._send({
				vsWorker: this._workerId,
				seq: req,
				res: r,
				err: undefined
			});
		}, (e) => {
			if (e.detail instanceof Error) {
				// Loading errors have a detail property that points to the actual error
				e.detail = transformErrorForSerialization(e.detail);
			}
			this._send({
				vsWorker: this._workerId,
				seq: req,
				res: undefined,
				err: transformErrorForSerialization(e)
			});
		});
	}

	private _send(msg: IRequestMessage | IReplyMessage): void {
		let transfer: ArrayBuffer[] = [];
		if (msg.req) {
			const m = <IRequestMessage>msg;
			for (let i = 0; i < m.args.length; i++) {
				if (m.args[i] instanceof ArrayBuffer) {
					transfer.push(m.args[i]);
				}
			}
		} else {
			const m = <IReplyMessage>msg;
			if (m.res instanceof ArrayBuffer) {
				transfer.push(m.res);
			}
		}
		this._handler.sendMessage(msg, transfer);
	}
}

export interface IWorkerClient<W> {
	getProxyObject(): Promise<W>;
	dispose(): void;
}

/**
 * Main thread side
 */
export class SimpleWorkerClient<W extends object, H extends object> extends Disposable implements IWorkerClient<W> {

	private readonly _worker: IWorker;
	private readonly _onModuleLoaded: Promise<string[]>;
	private readonly _protocol: SimpleWorkerProtocol;
	private readonly _lazyProxy: Promise<W>;

	constructor(workerFactory: IWorkerFactory, moduleId: string, host: H) {
		super();

		let lazyProxyReject: ((err: any) => void) | null = null;

		this._worker = this._register(workerFactory.create(
			'vs/base/common/worker/simpleWorker',
			(msg: any) => {
				this._protocol.handleMessage(msg);
			},
			(err: any) => {
				// in Firefox, web workers fail lazily :(
				// we will reject the proxy
				if (lazyProxyReject) {
					lazyProxyReject(err);
				}
			}
		));

		this._protocol = new SimpleWorkerProtocol({
			sendMessage: (msg: any, transfer: ArrayBuffer[]): void => {
				this._worker.postMessage(msg, transfer);
			},
			handleMessage: (method: string, args: any[]): Promise<any> => {
				if (typeof (host as any)[method] !== 'function') {
					return Promise.reject(new Error('Missing method ' + method + ' on main thread host.'));
				}

				try {
					return Promise.resolve((host as any)[method].apply(host, args));
				} catch (e) {
					return Promise.reject(e);
				}
			}
		});
		this._protocol.setWorkerId(this._worker.getId());

		// Gather loader configuration
		let loaderConfiguration: any = null;
		if (typeof (<any>self).require !== 'undefined' && typeof (<any>self).require.getConfig === 'function') {
			// Get the configuration from the Monaco AMD Loader
			loaderConfiguration = (<any>self).require.getConfig();
		} else if (typeof (<any>self).requirejs !== 'undefined') {
			// Get the configuration from requirejs
			loaderConfiguration = (<any>self).requirejs.s.contexts._.config;
		}

		const hostMethods = types.getAllMethodNames(host);

		// Send initialize message
		this._onModuleLoaded = this._protocol.sendMessage(INITIALIZE, [
			this._worker.getId(),
			JSON.parse(JSON.stringify(loaderConfiguration)),
			moduleId,
			hostMethods,
		]);

		// Create proxy to loaded code
		const proxyMethodRequest = (method: string, args: any[]): Promise<any> => {
			return this._request(method, args);
		};

		this._lazyProxy = new Promise<W>((resolve, reject) => {
			lazyProxyReject = reject;
			this._onModuleLoaded.then((availableMethods: string[]) => {
				resolve(types.createProxyObject<W>(availableMethods, proxyMethodRequest));
			}, (e) => {
				reject(e);
				this._onError('Worker failed to load ' + moduleId, e);
			});
		});
	}

	public getProxyObject(): Promise<W> {
		return this._lazyProxy;
	}

	private _request(method: string, args: any[]): Promise<any> {
		return new Promise<any>((resolve, reject) => {
			this._onModuleLoaded.then(() => {
				this._protocol.sendMessage(method, args).then(resolve, reject);
			}, reject);
		});
	}

	private _onError(message: string, error?: any): void {
		console.error(message);
		console.info(error);
	}
}

export interface IRequestHandler {
	_requestHandlerBrand: any;
	[prop: string]: any;
}

export interface IRequestHandlerFactory<H> {
	(host: H): IRequestHandler;
}

/**
 * Worker side
 */
export class SimpleWorkerServer<H extends object> {

	private _requestHandlerFactory: IRequestHandlerFactory<H> | null;
	private _requestHandler: IRequestHandler | null;
	private _protocol: SimpleWorkerProtocol;

	constructor(postMessage: (msg: any, transfer?: ArrayBuffer[]) => void, requestHandlerFactory: IRequestHandlerFactory<H> | null) {
		this._requestHandlerFactory = requestHandlerFactory;
		this._requestHandler = null;
		this._protocol = new SimpleWorkerProtocol({
			sendMessage: (msg: any, transfer: ArrayBuffer[]): void => {
				postMessage(msg, transfer);
			},
			handleMessage: (method: string, args: any[]): Promise<any> => this._handleMessage(method, args)
		});
	}

	public onmessage(msg: any): void {
		this._protocol.handleMessage(msg);
	}

	private _handleMessage(method: string, args: any[]): Promise<any> {
		if (method === INITIALIZE) {
			return this.initialize(<number>args[0], <any>args[1], <string>args[2], <string[]>args[3]);
		}

		if (!this._requestHandler || typeof this._requestHandler[method] !== 'function') {
			return Promise.reject(new Error('Missing requestHandler or method: ' + method));
		}

		try {
			return Promise.resolve(this._requestHandler[method].apply(this._requestHandler, args));
		} catch (e) {
			return Promise.reject(e);
		}
	}

	private initialize(workerId: number, loaderConfig: any, moduleId: string, hostMethods: string[]): Promise<string[]> {
		this._protocol.setWorkerId(workerId);

		const proxyMethodRequest = (method: string, args: any[]): Promise<any> => {
			return this._protocol.sendMessage(method, args);
		};

		const hostProxy = types.createProxyObject<H>(hostMethods, proxyMethodRequest);

		if (this._requestHandlerFactory) {
			// static request handler
			this._requestHandler = this._requestHandlerFactory(hostProxy);
			return Promise.resolve(types.getAllMethodNames(this._requestHandler));
		}

		if (loaderConfig) {
			// Remove 'baseUrl', handling it is beyond scope for now
			if (typeof loaderConfig.baseUrl !== 'undefined') {
				delete loaderConfig['baseUrl'];
			}
			if (typeof loaderConfig.paths !== 'undefined') {
				if (typeof loaderConfig.paths.vs !== 'undefined') {
					delete loaderConfig.paths['vs'];
				}
			}
			if (typeof loaderConfig.trustedTypesPolicy !== undefined) {
				// don't use, it has been destroyed during serialize
				delete loaderConfig['trustedTypesPolicy'];
			}

			// Since this is in a web worker, enable catching errors
			loaderConfig.catchError = true;
			(<any>self).require.config(loaderConfig);
		}

		return new Promise<string[]>((resolve, reject) => {
			// Use the global require to be sure to get the global config
			(<any>self).require([moduleId], (module: { create: IRequestHandlerFactory<H> }) => {
				this._requestHandler = module.create(hostProxy);

				if (!this._requestHandler) {
					reject(new Error(`No RequestHandler!`));
					return;
				}

				resolve(types.getAllMethodNames(this._requestHandler));
			}, reject);
		});
	}
}

/**
 * Called on the worker side
 */
export function create(postMessage: (msg: string) => void): SimpleWorkerServer<any> {
	return new SimpleWorkerServer(postMessage, null);
}
