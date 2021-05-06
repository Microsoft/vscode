/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBufferReadableStream } from 'vs/base/common/buffer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { isUNC } from 'vs/base/common/extpath';
import { Schemas } from 'vs/base/common/network';
import { sep } from 'vs/base/common/path';
import { URI } from 'vs/base/common/uri';
import { IHeaders } from 'vs/base/parts/request/common/request';
import { FileOperationError, FileOperationResult, IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { IRemoteConnectionData } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { IRequestService } from 'vs/platform/request/common/request';
import { getWebviewContentMimeType } from 'vs/platform/webview/common/mimeTypes';

export namespace WebviewResourceResponse {
	export enum Type { Success, Failed, AccessDenied, NotModified }

	export class StreamSuccess {
		readonly type = Type.Success;

		constructor(
			public readonly stream: VSBufferReadableStream,
			public readonly etag: string | undefined,
			public readonly mimeType: string,
		) { }
	}

	export const Failed = { type: Type.Failed } as const;
	export const AccessDenied = { type: Type.AccessDenied } as const;

	export class NotModified {
		readonly type = Type.NotModified;

		constructor(
			public readonly mimeType: string,
		) { }
	}

	export type StreamResponse = StreamSuccess | typeof Failed | typeof AccessDenied | NotModified;
}

export async function loadLocalResource(
	requestUri: URI,
	ifNoneMatch: string | undefined,
	options: {
		extensionLocation: URI | undefined;
		roots: ReadonlyArray<URI>;
		remoteConnectionData?: IRemoteConnectionData | null;
		useRootAuthority?: boolean;
	},
	fileService: IFileService,
	requestService: IRequestService,
	logService: ILogService,
	token: CancellationToken,
): Promise<WebviewResourceResponse.StreamResponse> {
	logService.debug(`loadLocalResource - being. requestUri=${requestUri}`);

	const resourceToLoad = getResourceToLoad(requestUri, options.roots, options.extensionLocation, options.useRootAuthority);

	logService.debug(`loadLocalResource - found resource to load. requestUri=${requestUri}, resourceToLoad=${resourceToLoad}`);

	if (!resourceToLoad) {
		return WebviewResourceResponse.AccessDenied;
	}

	const mime = getWebviewContentMimeType(requestUri); // Use the original path for the mime

	if (resourceToLoad.scheme === Schemas.http || resourceToLoad.scheme === Schemas.https) {
		const headers: IHeaders = {};
		if (ifNoneMatch) {
			headers['If-None-Match'] = ifNoneMatch;
		}

		const response = await requestService.request({
			url: resourceToLoad.toString(true),
			headers: headers
		}, token);

		logService.debug(`loadLocalResource - Loaded over http(s). requestUri=${requestUri}, response=${response.res.statusCode}`);

		switch (response.res.statusCode) {
			case 200:
				return new WebviewResourceResponse.StreamSuccess(response.stream, response.res.headers['etag'], mime);

			case 304: // Not modified
				return new WebviewResourceResponse.NotModified(mime);

			default:
				return WebviewResourceResponse.Failed;
		}
	}

	try {
		const result = await fileService.readFileStream(resourceToLoad, { etag: ifNoneMatch });
		return new WebviewResourceResponse.StreamSuccess(result.value, result.etag, mime);
	} catch (err) {
		if (err instanceof FileOperationError) {
			const result = err.fileOperationResult;

			// NotModified status is expected and can be handled gracefully
			if (result === FileOperationResult.FILE_NOT_MODIFIED_SINCE) {
				return new WebviewResourceResponse.NotModified(mime);
			}
		}

		// Otherwise the error is unexpected.
		logService.debug(`loadLocalResource - Error using fileReader. requestUri=${requestUri}`);
		console.log(err);

		return WebviewResourceResponse.Failed;
	}
}

function getResourceToLoad(
	requestUri: URI,
	roots: ReadonlyArray<URI>,
	extensionLocation: URI | undefined,
	useRootAuthority: boolean | undefined
): URI | undefined {
	for (const root of roots) {
		if (containsResource(root, requestUri)) {
			return normalizeResourcePath(requestUri, extensionLocation, useRootAuthority ? root.authority : undefined);
		}
	}

	return undefined;
}

function normalizeResourcePath(resource: URI, extensionLocation: URI | undefined, useRemoteAuthority: string | undefined): URI {
	// If we are loading a file resource from a webview created by a remote extension, rewrite the uri to go remote
	if (useRemoteAuthority || (resource.scheme === Schemas.file && extensionLocation?.scheme === Schemas.vscodeRemote)) {
		return URI.from({
			scheme: Schemas.vscodeRemote,
			authority: useRemoteAuthority ?? extensionLocation!.authority,
			path: '/vscode-resource',
			query: JSON.stringify({
				requestResourcePath: resource.path
			})
		});
	}
	return resource;
}

function containsResource(root: URI, resource: URI): boolean {
	let rootPath = root.fsPath + (root.fsPath.endsWith(sep) ? '' : sep);
	let resourceFsPath = resource.fsPath;

	if (isUNC(root.fsPath) && isUNC(resource.fsPath)) {
		rootPath = rootPath.toLowerCase();
		resourceFsPath = resourceFsPath.toLowerCase();
	}

	return resourceFsPath.startsWith(rootPath);
}
