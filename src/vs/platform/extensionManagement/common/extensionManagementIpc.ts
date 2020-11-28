/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel, IServerChannel } from 'vs/base/parts/ipc/common/ipc';
import { IExtensionManagementService, ILocalExtension, InstallExtensionEvent, DidInstallExtensionEvent, IGalleryExtension, DidUninstallExtensionEvent, IExtensionIdentifier, IGalleryMetadata, IReportedExtension, IExtensionTipsService, InstallOptions, UninstallOptions } from 'vs/platform/extensionManagement/common/extensionManagement';
import { Emitter, Event } from 'vs/base/common/event';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IURITransformer, DefaultURITransformer, transformAndReviveIncomingURIs } from 'vs/base/common/uriIpc';
import { cloneAndChange } from 'vs/base/common/objects';
import { ExtensionType, IExtensionManifest } from 'vs/platform/extensions/common/extensions';
import { Disposable } from 'vs/base/common/lifecycle';

function transformIncomingURI(uri: UriComponents, transformer: IURITransformer | null): URI {
	return URI.revive(transformer ? transformer.transformIncoming(uri) : uri);
}

function transformOutgoingURI(uri: URI, transformer: IURITransformer | null): URI {
	return transformer ? transformer.transformOutgoingURI(uri) : uri;
}

function transformIncomingExtension(extension: ILocalExtension, transformer: IURITransformer | null): ILocalExtension {
	transformer = transformer ? transformer : DefaultURITransformer;
	const manifest = extension.manifest;
	const transformed = transformAndReviveIncomingURIs({ ...extension, ...{ manifest: undefined } }, transformer);
	return { ...transformed, ...{ manifest } };
}

function transformOutgoingExtension(extension: ILocalExtension, transformer: IURITransformer | null): ILocalExtension {
	return transformer ? cloneAndChange(extension, value => value instanceof URI ? transformer.transformOutgoingURI(value) : undefined) : extension;
}

export class ExtensionManagementChannel implements IServerChannel {

	onInstallExtension: Event<InstallExtensionEvent>;
	onDidInstallExtension: Event<DidInstallExtensionEvent>;
	onUninstallExtension: Event<IExtensionIdentifier>;
	onDidUninstallExtension: Event<DidUninstallExtensionEvent>;

	constructor(private service: IExtensionManagementService, private getUriTransformer: (requestContext: any) => IURITransformer | null) {
		this.onInstallExtension = Event.buffer(service.onInstallExtension, true);
		this.onDidInstallExtension = Event.buffer(service.onDidInstallExtension, true);
		this.onUninstallExtension = Event.buffer(service.onUninstallExtension, true);
		this.onDidUninstallExtension = Event.buffer(service.onDidUninstallExtension, true);
	}

	listen(context: any, event: string): Event<any> {
		const uriTransformer = this.getUriTransformer(context);
		switch (event) {
			case 'onInstallExtension': return this.onInstallExtension;
			case 'onDidInstallExtension': return Event.map(this.onDidInstallExtension, i => ({ ...i, local: i.local ? transformOutgoingExtension(i.local, uriTransformer) : i.local }));
			case 'onUninstallExtension': return this.onUninstallExtension;
			case 'onDidUninstallExtension': return this.onDidUninstallExtension;
		}

		throw new Error('Invalid listen');
	}

	call(context: any, command: string, args?: any): Promise<any> {
		const uriTransformer: IURITransformer | null = this.getUriTransformer(context);
		switch (command) {
			case 'zip': return this.service.zip(transformIncomingExtension(args[0], uriTransformer)).then(uri => transformOutgoingURI(uri, uriTransformer));
			case 'unzip': return this.service.unzip(transformIncomingURI(args[0], uriTransformer));
			case 'install': return this.service.install(transformIncomingURI(args[0], uriTransformer));
			case 'getManifest': return this.service.getManifest(transformIncomingURI(args[0], uriTransformer));
			case 'canInstall': return this.service.canInstall(args[0]);
			case 'installFromGallery': return this.service.installFromGallery(args[0], args[1]);
			case 'uninstall': return this.service.uninstall(transformIncomingExtension(args[0], uriTransformer), args[1]);
			case 'reinstallFromGallery': return this.service.reinstallFromGallery(transformIncomingExtension(args[0], uriTransformer));
			case 'getInstalled': return this.service.getInstalled(args[0]).then(extensions => extensions.map(e => transformOutgoingExtension(e, uriTransformer)));
			case 'updateMetadata': return this.service.updateMetadata(transformIncomingExtension(args[0], uriTransformer), args[1]).then(e => transformOutgoingExtension(e, uriTransformer));
			case 'updateExtensionScope': return this.service.updateExtensionScope(transformIncomingExtension(args[0], uriTransformer), args[1]).then(e => transformOutgoingExtension(e, uriTransformer));
			case 'getExtensionsReport': return this.service.getExtensionsReport();
		}

		throw new Error('Invalid call');
	}
}

export class ExtensionManagementChannelClient extends Disposable implements IExtensionManagementService {

	declare readonly _serviceBrand: undefined;

	private readonly _onInstallExtension = this._register(new Emitter<InstallExtensionEvent>());
	readonly onInstallExtension = this._onInstallExtension.event;

	private readonly _onDidInstallExtension = this._register(new Emitter<DidInstallExtensionEvent>());
	readonly onDidInstallExtension = this._onDidInstallExtension.event;

	private readonly _onUninstallExtension = this._register(new Emitter<IExtensionIdentifier>());
	readonly onUninstallExtension = this._onUninstallExtension.event;

	private readonly _onDidUninstallExtension = this._register(new Emitter<DidUninstallExtensionEvent>());
	readonly onDidUninstallExtension = this._onDidUninstallExtension.event;

	constructor(
		private readonly channel: IChannel,
	) {
		super();
		this._register(this.channel.listen<InstallExtensionEvent>('onInstallExtension')(e => this._onInstallExtension.fire(e)));
		this._register(this.channel.listen<DidInstallExtensionEvent>('onDidInstallExtension')(e => this._onDidInstallExtension.fire({ ...e, local: e.local ? transformIncomingExtension(e.local, null) : e.local })));
		this._register(this.channel.listen<IExtensionIdentifier>('onUninstallExtension')(e => this._onUninstallExtension.fire(e)));
		this._register(this.channel.listen<DidUninstallExtensionEvent>('onDidUninstallExtension')(e => this._onDidUninstallExtension.fire(e)));
	}

	zip(extension: ILocalExtension): Promise<URI> {
		return Promise.resolve(this.channel.call('zip', [extension]).then(result => URI.revive(<UriComponents>result)));
	}

	unzip(zipLocation: URI): Promise<IExtensionIdentifier> {
		return Promise.resolve(this.channel.call('unzip', [zipLocation]));
	}

	install(vsix: URI): Promise<ILocalExtension> {
		return Promise.resolve(this.channel.call<ILocalExtension>('install', [vsix])).then(local => transformIncomingExtension(local, null));
	}

	getManifest(vsix: URI): Promise<IExtensionManifest> {
		return Promise.resolve(this.channel.call<IExtensionManifest>('getManifest', [vsix]));
	}

	async canInstall(extension: IGalleryExtension): Promise<boolean> {
		return true;
	}

	installFromGallery(extension: IGalleryExtension, installOptions?: InstallOptions): Promise<ILocalExtension> {
		return Promise.resolve(this.channel.call<ILocalExtension>('installFromGallery', [extension, installOptions])).then(local => transformIncomingExtension(local, null));
	}

	uninstall(extension: ILocalExtension, options?: UninstallOptions): Promise<void> {
		return Promise.resolve(this.channel.call('uninstall', [extension!, options]));
	}

	reinstallFromGallery(extension: ILocalExtension): Promise<void> {
		return Promise.resolve(this.channel.call('reinstallFromGallery', [extension]));
	}

	getInstalled(type: ExtensionType | null = null): Promise<ILocalExtension[]> {
		return Promise.resolve(this.channel.call<ILocalExtension[]>('getInstalled', [type]))
			.then(extensions => extensions.map(extension => transformIncomingExtension(extension, null)));
	}

	updateMetadata(local: ILocalExtension, metadata: IGalleryMetadata): Promise<ILocalExtension> {
		return Promise.resolve(this.channel.call<ILocalExtension>('updateMetadata', [local, metadata]))
			.then(extension => transformIncomingExtension(extension, null));
	}

	updateExtensionScope(local: ILocalExtension, isMachineScoped: boolean): Promise<ILocalExtension> {
		return Promise.resolve(this.channel.call<ILocalExtension>('updateExtensionScope', [local, isMachineScoped]))
			.then(extension => transformIncomingExtension(extension, null));
	}

	getExtensionsReport(): Promise<IReportedExtension[]> {
		return Promise.resolve(this.channel.call('getExtensionsReport'));
	}
}

export class ExtensionTipsChannel implements IServerChannel {

	constructor(private service: IExtensionTipsService) {
	}

	listen(context: any, event: string): Event<any> {
		throw new Error('Invalid listen');
	}

	call(context: any, command: string, args?: any): Promise<any> {
		switch (command) {
			case 'getConfigBasedTips': return this.service.getConfigBasedTips(URI.revive(args[0]));
			case 'getImportantExecutableBasedTips': return this.service.getImportantExecutableBasedTips();
			case 'getOtherExecutableBasedTips': return this.service.getOtherExecutableBasedTips();
			case 'getAllWorkspacesTips': return this.service.getAllWorkspacesTips();
		}

		throw new Error('Invalid call');
	}
}
