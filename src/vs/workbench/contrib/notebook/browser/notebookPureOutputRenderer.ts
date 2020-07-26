/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, UriComponents } from 'vs/base/common/uri';
import { INotebookRendererInfo, IOutputRenderResponse, IOutputRenderRequest } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { joinPath } from 'vs/base/common/resources';

/**
 * A 'stub' output renderer used when the contribution has an `entrypoint`
 * property. Include the entrypoint as its reload and renders an empty string.
 */
export class PureNotebookOutputRenderer implements INotebookRendererInfo {

	public readonly extensionId: ExtensionIdentifier;
	public readonly extensionLocation: URI;
	public readonly preloads: URI[];


	constructor(public readonly id: string, extension: IExtensionDescription, entrypoint: string) {
		this.extensionId = extension.identifier;
		this.extensionLocation = extension.extensionLocation;
		this.preloads = [joinPath(extension.extensionLocation, entrypoint)];
	}

	public render(uri: URI, request: IOutputRenderRequest<UriComponents>): Promise<IOutputRenderResponse<UriComponents> | undefined> {
		return this.render2(uri, request);
	}

	public render2<T>(_uri: URI, request: IOutputRenderRequest<T>): Promise<IOutputRenderResponse<T> | undefined> {
		return Promise.resolve({
			items: request.items.map(cellInfo => ({
				key: cellInfo.key,
				outputs: cellInfo.outputs.map(output => ({
					index: output.index,
					outputId: output.outputId,
					mimeType: output.mimeType,
					handlerId: this.id,
					// todo@connor4312: temp approach exploring this API:
					transformedOutput: `<script class="vscode-pure-data" type="application/json">
						${JSON.stringify({ mimeType: output.mimeType, output: output.output })}
					</script>`
				}))
			}))
		});
	}
}
