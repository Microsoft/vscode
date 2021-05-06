/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { IDisposable } from 'vs/base/common/lifecycle';
import { ExtensionDescriptionRegistry } from 'vs/workbench/services/extensions/common/extensionDescriptionRegistry';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { MissingExtensionDependency } from 'vs/workbench/services/extensions/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';

const NO_OP_VOID_PROMISE = Promise.resolve<void>(undefined);

/**
 * Represents the source code (module) of an extension.
 */
export interface IExtensionModule {
	activate?(ctx: vscode.ExtensionContext): Promise<IExtensionAPI>;
	deactivate?(): void;
}

/**
 * Represents the API of an extension (return value of `activate`).
 */
export interface IExtensionAPI {
	// _extensionAPIBrand: any;
}

export type ExtensionActivationTimesFragment = {
	startup?: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
	codeLoadingTime?: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
	activateCallTime?: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
	activateResolvedTime?: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
};

export class ExtensionActivationTimes {

	public static readonly NONE = new ExtensionActivationTimes(false, -1, -1, -1);

	public readonly startup: boolean;
	public readonly codeLoadingTime: number;
	public readonly activateCallTime: number;
	public readonly activateResolvedTime: number;

	constructor(startup: boolean, codeLoadingTime: number, activateCallTime: number, activateResolvedTime: number) {
		this.startup = startup;
		this.codeLoadingTime = codeLoadingTime;
		this.activateCallTime = activateCallTime;
		this.activateResolvedTime = activateResolvedTime;
	}
}

export class ExtensionActivationTimesBuilder {

	private readonly _startup: boolean;
	private _codeLoadingStart: number;
	private _codeLoadingStop: number;
	private _activateCallStart: number;
	private _activateCallStop: number;
	private _activateResolveStart: number;
	private _activateResolveStop: number;

	constructor(startup: boolean) {
		this._startup = startup;
		this._codeLoadingStart = -1;
		this._codeLoadingStop = -1;
		this._activateCallStart = -1;
		this._activateCallStop = -1;
		this._activateResolveStart = -1;
		this._activateResolveStop = -1;
	}

	private _delta(start: number, stop: number): number {
		if (start === -1 || stop === -1) {
			return -1;
		}
		return stop - start;
	}

	public build(): ExtensionActivationTimes {
		return new ExtensionActivationTimes(
			this._startup,
			this._delta(this._codeLoadingStart, this._codeLoadingStop),
			this._delta(this._activateCallStart, this._activateCallStop),
			this._delta(this._activateResolveStart, this._activateResolveStop)
		);
	}

	public codeLoadingStart(): void {
		this._codeLoadingStart = Date.now();
	}

	public codeLoadingStop(): void {
		this._codeLoadingStop = Date.now();
	}

	public activateCallStart(): void {
		this._activateCallStart = Date.now();
	}

	public activateCallStop(): void {
		this._activateCallStop = Date.now();
	}

	public activateResolveStart(): void {
		this._activateResolveStart = Date.now();
	}

	public activateResolveStop(): void {
		this._activateResolveStop = Date.now();
	}
}

export class ActivatedExtension {

	public readonly activationFailed: boolean;
	public readonly activationFailedError: Error | null;
	public readonly activationTimes: ExtensionActivationTimes;
	public readonly module: IExtensionModule;
	public readonly exports: IExtensionAPI | undefined;
	public readonly subscriptions: IDisposable[];

	constructor(
		activationFailed: boolean,
		activationFailedError: Error | null,
		activationTimes: ExtensionActivationTimes,
		module: IExtensionModule,
		exports: IExtensionAPI | undefined,
		subscriptions: IDisposable[]
	) {
		this.activationFailed = activationFailed;
		this.activationFailedError = activationFailedError;
		this.activationTimes = activationTimes;
		this.module = module;
		this.exports = exports;
		this.subscriptions = subscriptions;
	}
}

export class EmptyExtension extends ActivatedExtension {
	constructor(activationTimes: ExtensionActivationTimes) {
		super(false, null, activationTimes, { activate: undefined, deactivate: undefined }, undefined, []);
	}
}

export class HostExtension extends ActivatedExtension {
	constructor() {
		super(false, null, ExtensionActivationTimes.NONE, { activate: undefined, deactivate: undefined }, undefined, []);
	}
}

export class FailedExtension extends ActivatedExtension {
	constructor(activationError: Error) {
		super(true, activationError, ExtensionActivationTimes.NONE, { activate: undefined, deactivate: undefined }, undefined, []);
	}
}

export interface IExtensionsActivatorHost {
	onExtensionActivationError(extensionId: ExtensionIdentifier, error: Error | null, missingExtensionDependency: MissingExtensionDependency | null): void;
	actualActivateExtension(extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<ActivatedExtension>;
}

export interface ExtensionActivationReason {
	readonly startup: boolean;
	readonly extensionId: ExtensionIdentifier;
	readonly activationEvent: string;
}

type ActivationIdAndReason = { id: ExtensionIdentifier, reason: ExtensionActivationReason };

export class ExtensionsActivator {

	private readonly _registry: ExtensionDescriptionRegistry;
	private readonly _resolvedExtensionsSet: Set<string>;
	private readonly _hostExtensionsMap: Map<string, ExtensionIdentifier>;
	private readonly _host: IExtensionsActivatorHost;
	private readonly _activatingExtensions: Map<string, Promise<void>>;
	private readonly _activatedExtensions: Map<string, ActivatedExtension>;
	/**
	 * A map of already activated events to speed things up if the same activation event is triggered multiple times.
	 */
	private readonly _alreadyActivatedEvents: { [activationEvent: string]: boolean; };

	constructor(
		registry: ExtensionDescriptionRegistry,
		resolvedExtensions: ExtensionIdentifier[],
		hostExtensions: ExtensionIdentifier[],
		host: IExtensionsActivatorHost,
		@ILogService private readonly _logService: ILogService
	) {
		this._registry = registry;
		this._resolvedExtensionsSet = new Set<string>();
		resolvedExtensions.forEach((extensionId) => this._resolvedExtensionsSet.add(ExtensionIdentifier.toKey(extensionId)));
		this._hostExtensionsMap = new Map<string, ExtensionIdentifier>();
		hostExtensions.forEach((extensionId) => this._hostExtensionsMap.set(ExtensionIdentifier.toKey(extensionId), extensionId));
		this._host = host;
		this._activatingExtensions = new Map<string, Promise<void>>();
		this._activatedExtensions = new Map<string, ActivatedExtension>();
		this._alreadyActivatedEvents = Object.create(null);
	}

	public isActivated(extensionId: ExtensionIdentifier): boolean {
		const extensionKey = ExtensionIdentifier.toKey(extensionId);

		return this._activatedExtensions.has(extensionKey);
	}

	public getActivatedExtension(extensionId: ExtensionIdentifier): ActivatedExtension {
		const extensionKey = ExtensionIdentifier.toKey(extensionId);

		const activatedExtension = this._activatedExtensions.get(extensionKey);
		if (!activatedExtension) {
			throw new Error('Extension `' + extensionId.value + '` is not known or not activated');
		}
		return activatedExtension;
	}

	public activateByEvent(activationEvent: string, startup: boolean): Promise<void> {
		if (this._alreadyActivatedEvents[activationEvent]) {
			return NO_OP_VOID_PROMISE;
		}
		const activateExtensions = this._registry.getExtensionDescriptionsForActivationEvent(activationEvent);
		return this._activateExtensions(activateExtensions.map(e => ({
			id: e.identifier,
			reason: { startup, extensionId: e.identifier, activationEvent }
		}))).then(() => {
			this._alreadyActivatedEvents[activationEvent] = true;
		});
	}

	public activateById(extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<void> {
		const desc = this._registry.getExtensionDescription(extensionId);
		if (!desc) {
			throw new Error('Extension `' + extensionId + '` is not known');
		}

		return this._activateExtensions([{
			id: desc.identifier,
			reason
		}]);
	}

	/**
	 * Handle semantics related to dependencies for `currentExtension`.
	 * semantics: `redExtensions` must wait for `greenExtensions`.
	 */
	private _handleActivateRequest(currentActivation: ActivationIdAndReason, greenExtensions: { [id: string]: ActivationIdAndReason; }, redExtensions: ActivationIdAndReason[]): void {
		if (this._hostExtensionsMap.has(ExtensionIdentifier.toKey(currentActivation.id))) {
			greenExtensions[ExtensionIdentifier.toKey(currentActivation.id)] = currentActivation;
			return;
		}

		const currentExtension = this._registry.getExtensionDescription(currentActivation.id);
		if (!currentExtension) {
			// Error condition 0: unknown extension
			const error = new Error(`Cannot activate unknown extension '${currentActivation.id.value}'`);
			this._host.onExtensionActivationError(
				currentActivation.id,
				error,
				new MissingExtensionDependency(currentActivation.id.value)
			);
			this._activatedExtensions.set(ExtensionIdentifier.toKey(currentActivation.id), new FailedExtension(error));
			return;
		}

		const depIds = (typeof currentExtension.extensionDependencies === 'undefined' ? [] : currentExtension.extensionDependencies);
		let currentExtensionGetsGreenLight = true;

		for (let j = 0, lenJ = depIds.length; j < lenJ; j++) {
			const depId = depIds[j];

			if (this._resolvedExtensionsSet.has(ExtensionIdentifier.toKey(depId))) {
				// This dependency is already resolved
				continue;
			}

			const dep = this._activatedExtensions.get(ExtensionIdentifier.toKey(depId));
			if (dep && !dep.activationFailed) {
				// the dependency is already activated OK
				continue;
			}

			if (dep && dep.activationFailed) {
				// Error condition 2: a dependency has already failed activation
				const currentExtensionFriendlyName = currentExtension.displayName || currentExtension.identifier.value;
				const depDesc = this._registry.getExtensionDescription(depId);
				const depFriendlyName = (depDesc ? depDesc.displayName || depId : depId);
				const error = new Error(`Cannot activate the '${currentExtensionFriendlyName}' extension because its dependency '${depFriendlyName}' failed to activate`);
				(<any>error).detail = dep.activationFailedError;
				this._host.onExtensionActivationError(
					currentExtension.identifier,
					error,
					null
				);
				this._activatedExtensions.set(ExtensionIdentifier.toKey(currentExtension.identifier), new FailedExtension(error));
				return;
			}

			if (this._hostExtensionsMap.has(ExtensionIdentifier.toKey(depId))) {
				// must first wait for the dependency to activate
				currentExtensionGetsGreenLight = false;
				greenExtensions[ExtensionIdentifier.toKey(depId)] = {
					id: this._hostExtensionsMap.get(ExtensionIdentifier.toKey(depId))!,
					reason: currentActivation.reason
				};
				continue;
			}

			const depDesc = this._registry.getExtensionDescription(depId);
			if (depDesc) {
				// must first wait for the dependency to activate
				currentExtensionGetsGreenLight = false;
				greenExtensions[ExtensionIdentifier.toKey(depId)] = {
					id: depDesc.identifier,
					reason: currentActivation.reason
				};
				continue;
			}

			// Error condition 1: unknown dependency
			const currentExtensionFriendlyName = currentExtension.displayName || currentExtension.identifier.value;
			const error = new Error(`Cannot activate the '${currentExtensionFriendlyName}' extension because it depends on unknown extension '${depId}'`);
			this._host.onExtensionActivationError(
				currentExtension.identifier,
				error,
				new MissingExtensionDependency(depId)
			);
			this._activatedExtensions.set(ExtensionIdentifier.toKey(currentExtension.identifier), new FailedExtension(error));
			return;
		}

		if (currentExtensionGetsGreenLight) {
			greenExtensions[ExtensionIdentifier.toKey(currentExtension.identifier)] = currentActivation;
		} else {
			redExtensions.push(currentActivation);
		}
	}

	private _activateExtensions(extensions: ActivationIdAndReason[]): Promise<void> {
		if (extensions.length === 0) {
			return Promise.resolve(undefined);
		}

		extensions = extensions.filter((p) => !this._activatedExtensions.has(ExtensionIdentifier.toKey(p.id)));
		if (extensions.length === 0) {
			return Promise.resolve(undefined);
		}

		const greenMap: { [id: string]: ActivationIdAndReason; } = Object.create(null),
			red: ActivationIdAndReason[] = [];

		for (let i = 0, len = extensions.length; i < len; i++) {
			this._handleActivateRequest(extensions[i], greenMap, red);
		}

		// Make sure no red is also green
		for (let i = 0, len = red.length; i < len; i++) {
			const redExtensionKey = ExtensionIdentifier.toKey(red[i].id);
			if (greenMap[redExtensionKey]) {
				delete greenMap[redExtensionKey];
			}
		}

		const green = Object.keys(greenMap).map(id => greenMap[id]);

		if (red.length === 0) {
			// Finally reached only leafs!
			return Promise.all(green.map((p) => this._activateExtension(p.id, p.reason))).then(_ => undefined);
		}

		return this._activateExtensions(green).then(_ => {
			return this._activateExtensions(red);
		});
	}

	private _activateExtension(extensionId: ExtensionIdentifier, reason: ExtensionActivationReason): Promise<void> {
		const extensionKey = ExtensionIdentifier.toKey(extensionId);

		if (this._activatedExtensions.has(extensionKey)) {
			return Promise.resolve(undefined);
		}

		const currentlyActivatingExtension = this._activatingExtensions.get(extensionKey);
		if (currentlyActivatingExtension) {
			return currentlyActivatingExtension;
		}

		const newlyActivatingExtension = this._host.actualActivateExtension(extensionId, reason).then(undefined, (err) => {

			const error = new Error();
			if (err && err.name) {
				error.name = err.name;
			}
			if (err && err.message) {
				error.message = `Activating extension '${extensionId.value}' failed: ${err.message}.`;
			} else {
				error.message = `Activating extension '${extensionId.value}' failed: ${err}.`;
			}
			if (err && err.stack) {
				error.stack = err.stack;
			}

			this._host.onExtensionActivationError(
				extensionId,
				error,
				null
			);
			this._logService.error(`Activating extension ${extensionId.value} failed due to an error:`);
			this._logService.error(err);
			// Treat the extension as being empty
			return new FailedExtension(err);
		}).then((x: ActivatedExtension) => {
			this._activatedExtensions.set(extensionKey, x);
			this._activatingExtensions.delete(extensionKey);
		});

		this._activatingExtensions.set(extensionKey, newlyActivatingExtension);
		return newlyActivatingExtension;
	}
}
