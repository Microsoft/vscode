/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RunOnceScheduler } from 'vs/base/common/async';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { CharCode } from 'vs/base/common/charCode';
import * as errors from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IURITransformer, transformIncomingURIs } from 'vs/base/common/uriIpc';
import { IMessagePassingProtocol } from 'vs/base/parts/ipc/common/ipc';
import { LazyPromise } from 'vs/workbench/services/extensions/common/lazyPromise';
import { IRPCProtocol, ProxyIdentifier, getStringIdentifierForProxy } from 'vs/workbench/services/extensions/common/proxyIdentifier';
import { VSBuffer } from 'vs/base/common/buffer';

export interface JSONStringifyReplacer {
	(key: string, value: any): any;
}

function safeStringify(obj: any, replacer: JSONStringifyReplacer | null): string {
	try {
		return JSON.stringify(obj, <(key: string, value: any) => any>replacer);
	} catch (err) {
		return 'null';
	}
}

function stringify(obj: any, replacer: JSONStringifyReplacer | null): string {
	return JSON.stringify(obj, <(key: string, value: any) => any>replacer);
}

function createURIReplacer(transformer: IURITransformer | null): JSONStringifyReplacer | null {
	if (!transformer) {
		return null;
	}
	return (key: string, value: any): any => {
		if (value && value.$mid === 1) {
			return transformer.transformOutgoing(value);
		}
		return value;
	};
}

export const enum RequestInitiator {
	LocalSide = 0,
	OtherSide = 1
}

export const enum ResponsiveState {
	Responsive = 0,
	Unresponsive = 1
}

export interface IRPCProtocolLogger {
	logIncoming(msgLength: number, req: number, initiator: RequestInitiator, str: string, data?: any): void;
	logOutgoing(msgLength: number, req: number, initiator: RequestInitiator, str: string, data?: any): void;
}

const noop = () => { };

const _RPCProtocolSymbol = Symbol.for('rpcProtocol');
const _RPCProxySymbol = Symbol.for('rpcProxy');

export class RPCProtocol extends Disposable implements IRPCProtocol {

	[_RPCProtocolSymbol] = true;

	private static readonly UNRESPONSIVE_TIME = 3 * 1000; // 3s

	private readonly _onDidChangeResponsiveState: Emitter<ResponsiveState> = this._register(new Emitter<ResponsiveState>());
	public readonly onDidChangeResponsiveState: Event<ResponsiveState> = this._onDidChangeResponsiveState.event;

	private readonly _protocol: IMessagePassingProtocol;
	private readonly _logger: IRPCProtocolLogger | null;
	private readonly _uriTransformer: IURITransformer | null;
	private readonly _uriReplacer: JSONStringifyReplacer | null;
	private _isDisposed: boolean;
	private readonly _locals: any[];
	private readonly _proxies: any[];
	private _lastMessageId: number;
	private readonly _cancelInvokedHandlers: { [req: string]: () => void; };
	private readonly _pendingRPCReplies: { [msgId: string]: LazyPromise; };
	private _responsiveState: ResponsiveState;
	private _unacknowledgedCount: number;
	private _unresponsiveTime: number;
	private _asyncCheckUresponsive: RunOnceScheduler;

	constructor(protocol: IMessagePassingProtocol, logger: IRPCProtocolLogger | null = null, transformer: IURITransformer | null = null) {
		super();
		this._protocol = protocol;
		this._logger = logger;
		this._uriTransformer = transformer;
		this._uriReplacer = createURIReplacer(this._uriTransformer);
		this._isDisposed = false;
		this._locals = [];
		this._proxies = [];
		for (let i = 0, len = ProxyIdentifier.count; i < len; i++) {
			this._locals[i] = null;
			this._proxies[i] = null;
		}
		this._lastMessageId = 0;
		this._cancelInvokedHandlers = Object.create(null);
		this._pendingRPCReplies = {};
		this._responsiveState = ResponsiveState.Responsive;
		this._unacknowledgedCount = 0;
		this._unresponsiveTime = 0;
		this._asyncCheckUresponsive = this._register(new RunOnceScheduler(() => this._checkUnresponsive(), 1000));
		this._protocol.onMessage((msg) => this._receiveOneMessage(msg));
	}

	public override dispose(): void {
		this._isDisposed = true;

		// Release all outstanding promises with a canceled error
		Object.keys(this._pendingRPCReplies).forEach((msgId) => {
			const pending = this._pendingRPCReplies[msgId];
			pending.resolveErr(errors.canceled());
		});
	}

	public drain(): Promise<void> {
		if (typeof this._protocol.drain === 'function') {
			return this._protocol.drain();
		}
		return Promise.resolve();
	}

	private _onWillSendRequest(req: number): void {
		if (this._unacknowledgedCount === 0) {
			// Since this is the first request we are sending in a while,
			// mark this moment as the start for the countdown to unresponsive time
			this._unresponsiveTime = Date.now() + RPCProtocol.UNRESPONSIVE_TIME;
		}
		this._unacknowledgedCount++;
		if (!this._asyncCheckUresponsive.isScheduled()) {
			this._asyncCheckUresponsive.schedule();
		}
	}

	private _onDidReceiveAcknowledge(req: number): void {
		// The next possible unresponsive time is now + delta.
		this._unresponsiveTime = Date.now() + RPCProtocol.UNRESPONSIVE_TIME;
		this._unacknowledgedCount--;
		if (this._unacknowledgedCount === 0) {
			// No more need to check for unresponsive
			this._asyncCheckUresponsive.cancel();
		}
		// The ext host is responsive!
		this._setResponsiveState(ResponsiveState.Responsive);
	}

	private _checkUnresponsive(): void {
		if (this._unacknowledgedCount === 0) {
			// Not waiting for anything => cannot say if it is responsive or not
			return;
		}

		if (Date.now() > this._unresponsiveTime) {
			// Unresponsive!!
			this._setResponsiveState(ResponsiveState.Unresponsive);
		} else {
			// Not (yet) unresponsive, be sure to check again soon
			this._asyncCheckUresponsive.schedule();
		}
	}

	private _setResponsiveState(newResponsiveState: ResponsiveState): void {
		if (this._responsiveState === newResponsiveState) {
			// no change
			return;
		}
		this._responsiveState = newResponsiveState;
		this._onDidChangeResponsiveState.fire(this._responsiveState);
	}

	public get responsiveState(): ResponsiveState {
		return this._responsiveState;
	}

	public transformIncomingURIs<T>(obj: T): T {
		if (!this._uriTransformer) {
			return obj;
		}
		return transformIncomingURIs(obj, this._uriTransformer);
	}

	public getProxy<T>(identifier: ProxyIdentifier<T>): T {
		const { nid: rpcId, sid } = identifier;
		if (!this._proxies[rpcId]) {
			this._proxies[rpcId] = this._createProxy(rpcId, sid);
		}
		return this._proxies[rpcId];
	}

	private _createProxy<T>(rpcId: number, debugName: string): T {
		let handler = {
			get: (target: any, name: PropertyKey) => {
				if (typeof name === 'string' && !target[name] && name.charCodeAt(0) === CharCode.DollarSign) {
					target[name] = (...myArgs: any[]) => {
						return this._remoteCall(rpcId, name, myArgs);
					};
				}
				if (name === _RPCProxySymbol) {
					return debugName;
				}
				return target[name];
			}
		};
		return new Proxy(Object.create(null), handler);
	}

	public set<T, R extends T>(identifier: ProxyIdentifier<T>, value: R): R {
		this._locals[identifier.nid] = value;
		return value;
	}

	public assertRegistered(identifiers: ProxyIdentifier<any>[]): void {
		for (let i = 0, len = identifiers.length; i < len; i++) {
			const identifier = identifiers[i];
			if (!this._locals[identifier.nid]) {
				throw new Error(`Missing actor ${identifier.sid} (isMain: ${identifier.isMain})`);
			}
		}
	}

	private _receiveOneMessage(rawmsg: VSBuffer): void {
		if (this._isDisposed) {
			return;
		}

		const msgLength = rawmsg.byteLength;
		const buff = MessageBuffer.read(rawmsg, 0);
		const messageType = <MessageType>buff.readUInt8();
		const req = buff.readUInt32();

		switch (messageType) {
			case MessageType.RequestJSONArgs:
			case MessageType.RequestJSONArgsWithCancellation: {
				let { rpcId, method, args } = MessageIO.deserializeRequestJSONArgs(buff);
				if (this._uriTransformer) {
					args = transformIncomingURIs(args, this._uriTransformer);
				}
				this._receiveRequest(msgLength, req, rpcId, method, args, (messageType === MessageType.RequestJSONArgsWithCancellation));
				break;
			}
			case MessageType.RequestMixedArgs:
			case MessageType.RequestMixedArgsWithCancellation: {
				let { rpcId, method, args } = MessageIO.deserializeRequestMixedArgs(buff);
				if (this._uriTransformer) {
					args = transformIncomingURIs(args, this._uriTransformer);
				}
				this._receiveRequest(msgLength, req, rpcId, method, args, (messageType === MessageType.RequestMixedArgsWithCancellation));
				break;
			}
			case MessageType.Acknowledged: {
				if (this._logger) {
					this._logger.logIncoming(msgLength, req, RequestInitiator.LocalSide, `ack`);
				}
				this._onDidReceiveAcknowledge(req);
				break;
			}
			case MessageType.Cancel: {
				this._receiveCancel(msgLength, req);
				break;
			}
			case MessageType.ReplyOKEmpty: {
				this._receiveReply(msgLength, req, undefined);
				break;
			}
			case MessageType.ReplyOKJSON: {
				let value = MessageIO.deserializeReplyOKJSON(buff);
				if (this._uriTransformer) {
					value = transformIncomingURIs(value, this._uriTransformer);
				}
				this._receiveReply(msgLength, req, value);
				break;
			}
			case MessageType.ReplyOKVSBuffer: {
				let value = MessageIO.deserializeReplyOKVSBuffer(buff);
				this._receiveReply(msgLength, req, value);
				break;
			}
			case MessageType.ReplyErrError: {
				let err = MessageIO.deserializeReplyErrError(buff);
				if (this._uriTransformer) {
					err = transformIncomingURIs(err, this._uriTransformer);
				}
				this._receiveReplyErr(msgLength, req, err);
				break;
			}
			case MessageType.ReplyErrEmpty: {
				this._receiveReplyErr(msgLength, req, undefined);
				break;
			}
			default:
				console.error(`received unexpected message`);
				console.error(rawmsg);
		}
	}

	private _receiveRequest(msgLength: number, req: number, rpcId: number, method: string, args: any[], usesCancellationToken: boolean): void {
		if (this._logger) {
			this._logger.logIncoming(msgLength, req, RequestInitiator.OtherSide, `receiveRequest ${getStringIdentifierForProxy(rpcId)}.${method}(`, args);
		}
		const callId = String(req);

		let promise: Promise<any>;
		let cancel: () => void;
		if (usesCancellationToken) {
			const cancellationTokenSource = new CancellationTokenSource();
			args.push(cancellationTokenSource.token);
			promise = this._invokeHandler(rpcId, method, args);
			cancel = () => cancellationTokenSource.cancel();
		} else {
			// cannot be cancelled
			promise = this._invokeHandler(rpcId, method, args);
			cancel = noop;
		}

		this._cancelInvokedHandlers[callId] = cancel;

		// Acknowledge the request
		const msg = MessageIO.serializeAcknowledged(req);
		if (this._logger) {
			this._logger.logOutgoing(msg.byteLength, req, RequestInitiator.OtherSide, `ack`);
		}
		this._protocol.send(msg);

		promise.then((r) => {
			delete this._cancelInvokedHandlers[callId];
			const msg = MessageIO.serializeReplyOK(req, r, this._uriReplacer);
			if (this._logger) {
				this._logger.logOutgoing(msg.byteLength, req, RequestInitiator.OtherSide, `reply:`, r);
			}
			this._protocol.send(msg);
		}, (err) => {
			delete this._cancelInvokedHandlers[callId];
			const msg = MessageIO.serializeReplyErr(req, err);
			if (this._logger) {
				this._logger.logOutgoing(msg.byteLength, req, RequestInitiator.OtherSide, `replyErr:`, err);
			}
			this._protocol.send(msg);
		});
	}

	private _receiveCancel(msgLength: number, req: number): void {
		if (this._logger) {
			this._logger.logIncoming(msgLength, req, RequestInitiator.OtherSide, `receiveCancel`);
		}
		const callId = String(req);
		if (this._cancelInvokedHandlers[callId]) {
			this._cancelInvokedHandlers[callId]();
		}
	}

	private _receiveReply(msgLength: number, req: number, value: any): void {
		if (this._logger) {
			this._logger.logIncoming(msgLength, req, RequestInitiator.LocalSide, `receiveReply:`, value);
		}
		const callId = String(req);
		if (!this._pendingRPCReplies.hasOwnProperty(callId)) {
			return;
		}

		const pendingReply = this._pendingRPCReplies[callId];
		delete this._pendingRPCReplies[callId];

		pendingReply.resolveOk(value);
	}

	private _receiveReplyErr(msgLength: number, req: number, value: any): void {
		if (this._logger) {
			this._logger.logIncoming(msgLength, req, RequestInitiator.LocalSide, `receiveReplyErr:`, value);
		}

		const callId = String(req);
		if (!this._pendingRPCReplies.hasOwnProperty(callId)) {
			return;
		}

		const pendingReply = this._pendingRPCReplies[callId];
		delete this._pendingRPCReplies[callId];

		let err: any = undefined;
		if (value) {
			if (value.$isError) {
				err = new Error();
				err.name = value.name;
				err.message = value.message;
				err.stack = value.stack;
			} else {
				err = value;
			}
		}
		pendingReply.resolveErr(err);
	}

	private _invokeHandler(rpcId: number, methodName: string, args: any[]): Promise<any> {
		try {
			return Promise.resolve(this._doInvokeHandler(rpcId, methodName, args));
		} catch (err) {
			return Promise.reject(err);
		}
	}

	private _doInvokeHandler(rpcId: number, methodName: string, args: any[]): any {
		const actor = this._locals[rpcId];
		if (!actor) {
			throw new Error('Unknown actor ' + getStringIdentifierForProxy(rpcId));
		}
		let method = actor[methodName];
		if (typeof method !== 'function') {
			throw new Error('Unknown method ' + methodName + ' on actor ' + getStringIdentifierForProxy(rpcId));
		}
		return method.apply(actor, args);
	}

	private _remoteCall(rpcId: number, methodName: string, args: any[]): Promise<any> {
		if (this._isDisposed) {
			return Promise.reject<any>(errors.canceled());
		}
		let cancellationToken: CancellationToken | null = null;
		if (args.length > 0 && CancellationToken.isCancellationToken(args[args.length - 1])) {
			cancellationToken = args.pop();
		}

		if (cancellationToken && cancellationToken.isCancellationRequested) {
			// No need to do anything...
			return Promise.reject<any>(errors.canceled());
		}

		const serializedRequestArguments = MessageIO.serializeRequestArguments(args, this._uriReplacer);

		const req = ++this._lastMessageId;
		const callId = String(req);
		const result = new LazyPromise();

		if (cancellationToken) {
			cancellationToken.onCancellationRequested(() => {
				const msg = MessageIO.serializeCancel(req);
				if (this._logger) {
					this._logger.logOutgoing(msg.byteLength, req, RequestInitiator.LocalSide, `cancel`);
				}
				this._protocol.send(MessageIO.serializeCancel(req));
			});
		}

		this._pendingRPCReplies[callId] = result;
		this._onWillSendRequest(req);
		const msg = MessageIO.serializeRequest(req, rpcId, methodName, serializedRequestArguments, !!cancellationToken);
		if (this._logger) {
			this._logger.logOutgoing(msg.byteLength, req, RequestInitiator.LocalSide, `request: ${getStringIdentifierForProxy(rpcId)}.${methodName}(`, args);
		}
		this._protocol.send(msg);
		return result;
	}
}

class MessageBuffer {

	public static alloc(type: MessageType, req: number, messageSize: number): MessageBuffer {
		let result = new MessageBuffer(VSBuffer.alloc(messageSize + 1 /* type */ + 4 /* req */), 0);
		result.writeUInt8(type);
		result.writeUInt32(req);
		return result;
	}

	public static read(buff: VSBuffer, offset: number): MessageBuffer {
		return new MessageBuffer(buff, offset);
	}

	private _buff: VSBuffer;
	private _offset: number;

	public get buffer(): VSBuffer {
		return this._buff;
	}

	private constructor(buff: VSBuffer, offset: number) {
		this._buff = buff;
		this._offset = offset;
	}

	public static sizeUInt8(): number {
		return 1;
	}

	public writeUInt8(n: number): void {
		this._buff.writeUInt8(n, this._offset); this._offset += 1;
	}

	public readUInt8(): number {
		const n = this._buff.readUInt8(this._offset); this._offset += 1;
		return n;
	}

	public writeUInt32(n: number): void {
		this._buff.writeUInt32BE(n, this._offset); this._offset += 4;
	}

	public readUInt32(): number {
		const n = this._buff.readUInt32BE(this._offset); this._offset += 4;
		return n;
	}

	public static sizeShortString(str: VSBuffer): number {
		return 1 /* string length */ + str.byteLength /* actual string */;
	}

	public writeShortString(str: VSBuffer): void {
		this._buff.writeUInt8(str.byteLength, this._offset); this._offset += 1;
		this._buff.set(str, this._offset); this._offset += str.byteLength;
	}

	public readShortString(): string {
		const strByteLength = this._buff.readUInt8(this._offset); this._offset += 1;
		const strBuff = this._buff.slice(this._offset, this._offset + strByteLength);
		const str = strBuff.toString(); this._offset += strByteLength;
		return str;
	}

	public static sizeLongString(str: VSBuffer): number {
		return 4 /* string length */ + str.byteLength /* actual string */;
	}

	public writeLongString(str: VSBuffer): void {
		this._buff.writeUInt32BE(str.byteLength, this._offset); this._offset += 4;
		this._buff.set(str, this._offset); this._offset += str.byteLength;
	}

	public readLongString(): string {
		const strByteLength = this._buff.readUInt32BE(this._offset); this._offset += 4;
		const strBuff = this._buff.slice(this._offset, this._offset + strByteLength);
		const str = strBuff.toString(); this._offset += strByteLength;
		return str;
	}

	public writeBuffer(buff: VSBuffer): void {
		this._buff.writeUInt32BE(buff.byteLength, this._offset); this._offset += 4;
		this._buff.set(buff, this._offset); this._offset += buff.byteLength;
	}

	public static sizeVSBuffer(buff: VSBuffer): number {
		return 4 /* buffer length */ + buff.byteLength /* actual buffer */;
	}

	public writeVSBuffer(buff: VSBuffer): void {
		this._buff.writeUInt32BE(buff.byteLength, this._offset); this._offset += 4;
		this._buff.set(buff, this._offset); this._offset += buff.byteLength;
	}

	public readVSBuffer(): VSBuffer {
		const buffLength = this._buff.readUInt32BE(this._offset); this._offset += 4;
		const buff = this._buff.slice(this._offset, this._offset + buffLength); this._offset += buffLength;
		return buff;
	}

	public static sizeMixedArray(arr: VSBuffer[], arrType: ArgType[]): number {
		let size = 0;
		size += 1; // arr length
		for (let i = 0, len = arr.length; i < len; i++) {
			const el = arr[i];
			const elType = arrType[i];
			size += 1; // arg type
			switch (elType) {
				case ArgType.String:
					size += this.sizeLongString(el);
					break;
				case ArgType.VSBuffer:
					size += this.sizeVSBuffer(el);
					break;
				case ArgType.Undefined:
					// empty...
					break;
			}
		}
		return size;
	}

	public writeMixedArray(arr: VSBuffer[], arrType: ArgType[]): void {
		this._buff.writeUInt8(arr.length, this._offset); this._offset += 1;
		for (let i = 0, len = arr.length; i < len; i++) {
			const el = arr[i];
			const elType = arrType[i];
			switch (elType) {
				case ArgType.String:
					this.writeUInt8(ArgType.String);
					this.writeLongString(el);
					break;
				case ArgType.VSBuffer:
					this.writeUInt8(ArgType.VSBuffer);
					this.writeVSBuffer(el);
					break;
				case ArgType.Undefined:
					this.writeUInt8(ArgType.Undefined);
					break;
			}
		}
	}

	public readMixedArray(): Array<string | VSBuffer | undefined> {
		const arrLen = this._buff.readUInt8(this._offset); this._offset += 1;
		let arr: Array<string | VSBuffer | undefined> = new Array(arrLen);
		for (let i = 0; i < arrLen; i++) {
			const argType = <ArgType>this.readUInt8();
			switch (argType) {
				case ArgType.String:
					arr[i] = this.readLongString();
					break;
				case ArgType.VSBuffer:
					arr[i] = this.readVSBuffer();
					break;
				case ArgType.Undefined:
					arr[i] = undefined;
					break;
			}
		}
		return arr;
	}
}

type SerializedRequestArguments = { type: 'mixed'; args: VSBuffer[]; argsType: ArgType[]; } | { type: 'simple'; args: string; };

class MessageIO {

	private static _arrayContainsBufferOrUndefined(arr: any[]): boolean {
		for (let i = 0, len = arr.length; i < len; i++) {
			if (arr[i] instanceof VSBuffer) {
				return true;
			}
			if (typeof arr[i] === 'undefined') {
				return true;
			}
		}
		return false;
	}

	public static serializeRequestArguments(args: any[], replacer: JSONStringifyReplacer | null): SerializedRequestArguments {
		if (this._arrayContainsBufferOrUndefined(args)) {
			let massagedArgs: VSBuffer[] = [];
			let massagedArgsType: ArgType[] = [];
			for (let i = 0, len = args.length; i < len; i++) {
				const arg = args[i];
				if (arg instanceof VSBuffer) {
					massagedArgs[i] = arg;
					massagedArgsType[i] = ArgType.VSBuffer;
				} else if (typeof arg === 'undefined') {
					massagedArgs[i] = VSBuffer.alloc(0);
					massagedArgsType[i] = ArgType.Undefined;
				} else {
					massagedArgs[i] = VSBuffer.fromString(stringify(arg, replacer));
					massagedArgsType[i] = ArgType.String;
				}
			}
			return {
				type: 'mixed',
				args: massagedArgs,
				argsType: massagedArgsType
			};
		}
		return {
			type: 'simple',
			args: stringify(args, replacer)
		};
	}

	public static serializeRequest(req: number, rpcId: number, method: string, serializedArgs: SerializedRequestArguments, usesCancellationToken: boolean): VSBuffer {
		if (serializedArgs.type === 'mixed') {
			return this._requestMixedArgs(req, rpcId, method, serializedArgs.args, serializedArgs.argsType, usesCancellationToken);
		}
		return this._requestJSONArgs(req, rpcId, method, serializedArgs.args, usesCancellationToken);
	}

	private static _requestJSONArgs(req: number, rpcId: number, method: string, args: string, usesCancellationToken: boolean): VSBuffer {
		const methodBuff = VSBuffer.fromString(method);
		const argsBuff = VSBuffer.fromString(args);

		let len = 0;
		len += MessageBuffer.sizeUInt8();
		len += MessageBuffer.sizeShortString(methodBuff);
		len += MessageBuffer.sizeLongString(argsBuff);

		let result = MessageBuffer.alloc(usesCancellationToken ? MessageType.RequestJSONArgsWithCancellation : MessageType.RequestJSONArgs, req, len);
		result.writeUInt8(rpcId);
		result.writeShortString(methodBuff);
		result.writeLongString(argsBuff);
		return result.buffer;
	}

	public static deserializeRequestJSONArgs(buff: MessageBuffer): { rpcId: number; method: string; args: any[]; } {
		const rpcId = buff.readUInt8();
		const method = buff.readShortString();
		const args = buff.readLongString();
		return {
			rpcId: rpcId,
			method: method,
			args: JSON.parse(args)
		};
	}

	private static _requestMixedArgs(req: number, rpcId: number, method: string, args: VSBuffer[], argsType: ArgType[], usesCancellationToken: boolean): VSBuffer {
		const methodBuff = VSBuffer.fromString(method);

		let len = 0;
		len += MessageBuffer.sizeUInt8();
		len += MessageBuffer.sizeShortString(methodBuff);
		len += MessageBuffer.sizeMixedArray(args, argsType);

		let result = MessageBuffer.alloc(usesCancellationToken ? MessageType.RequestMixedArgsWithCancellation : MessageType.RequestMixedArgs, req, len);
		result.writeUInt8(rpcId);
		result.writeShortString(methodBuff);
		result.writeMixedArray(args, argsType);
		return result.buffer;
	}

	public static deserializeRequestMixedArgs(buff: MessageBuffer): { rpcId: number; method: string; args: any[]; } {
		const rpcId = buff.readUInt8();
		const method = buff.readShortString();
		const rawargs = buff.readMixedArray();
		const args: any[] = new Array(rawargs.length);
		for (let i = 0, len = rawargs.length; i < len; i++) {
			const rawarg = rawargs[i];
			if (typeof rawarg === 'string') {
				args[i] = JSON.parse(rawarg);
			} else {
				args[i] = rawarg;
			}
		}
		return {
			rpcId: rpcId,
			method: method,
			args: args
		};
	}

	public static serializeAcknowledged(req: number): VSBuffer {
		return MessageBuffer.alloc(MessageType.Acknowledged, req, 0).buffer;
	}

	public static serializeCancel(req: number): VSBuffer {
		return MessageBuffer.alloc(MessageType.Cancel, req, 0).buffer;
	}

	public static serializeReplyOK(req: number, res: any, replacer: JSONStringifyReplacer | null): VSBuffer {
		if (typeof res === 'undefined') {
			return this._serializeReplyOKEmpty(req);
		}
		if (res instanceof VSBuffer) {
			return this._serializeReplyOKVSBuffer(req, res);
		}
		return this._serializeReplyOKJSON(req, safeStringify(res, replacer));
	}

	private static _serializeReplyOKEmpty(req: number): VSBuffer {
		return MessageBuffer.alloc(MessageType.ReplyOKEmpty, req, 0).buffer;
	}

	private static _serializeReplyOKVSBuffer(req: number, res: VSBuffer): VSBuffer {
		let len = 0;
		len += MessageBuffer.sizeVSBuffer(res);

		let result = MessageBuffer.alloc(MessageType.ReplyOKVSBuffer, req, len);
		result.writeVSBuffer(res);
		return result.buffer;
	}

	public static deserializeReplyOKVSBuffer(buff: MessageBuffer): VSBuffer {
		return buff.readVSBuffer();
	}

	private static _serializeReplyOKJSON(req: number, res: string): VSBuffer {
		const resBuff = VSBuffer.fromString(res);

		let len = 0;
		len += MessageBuffer.sizeLongString(resBuff);

		let result = MessageBuffer.alloc(MessageType.ReplyOKJSON, req, len);
		result.writeLongString(resBuff);
		return result.buffer;
	}

	public static deserializeReplyOKJSON(buff: MessageBuffer): any {
		const res = buff.readLongString();
		return JSON.parse(res);
	}

	public static serializeReplyErr(req: number, err: any): VSBuffer {
		if (err) {
			return this._serializeReplyErrEror(req, err);
		}
		return this._serializeReplyErrEmpty(req);
	}

	private static _serializeReplyErrEror(req: number, _err: Error): VSBuffer {
		const errBuff = VSBuffer.fromString(safeStringify(errors.transformErrorForSerialization(_err), null));

		let len = 0;
		len += MessageBuffer.sizeLongString(errBuff);

		let result = MessageBuffer.alloc(MessageType.ReplyErrError, req, len);
		result.writeLongString(errBuff);
		return result.buffer;
	}

	public static deserializeReplyErrError(buff: MessageBuffer): Error {
		const err = buff.readLongString();
		return JSON.parse(err);
	}

	private static _serializeReplyErrEmpty(req: number): VSBuffer {
		return MessageBuffer.alloc(MessageType.ReplyErrEmpty, req, 0).buffer;
	}
}

const enum MessageType {
	RequestJSONArgs = 1,
	RequestJSONArgsWithCancellation = 2,
	RequestMixedArgs = 3,
	RequestMixedArgsWithCancellation = 4,
	Acknowledged = 5,
	Cancel = 6,
	ReplyOKEmpty = 7,
	ReplyOKVSBuffer = 8,
	ReplyOKJSON = 9,
	ReplyErrError = 10,
	ReplyErrEmpty = 11,
}

const enum ArgType {
	String = 1,
	VSBuffer = 2,
	Undefined = 3
}
