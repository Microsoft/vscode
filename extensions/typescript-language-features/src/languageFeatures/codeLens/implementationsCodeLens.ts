/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import type * as Proto from '../../protocol';
import * as PConst from '../../protocol.const';
import { CachedResponse } from '../../tsServer/cachedResponse';
import { ClientCapability, ITypeScriptServiceClient } from '../../typescriptService';
import { conditionalRegistration, requireSomeCapability, requireConfiguration } from '../../utils/dependentRegistration';
import { DocumentSelector } from '../../utils/documentSelector';
import * as typeConverters from '../../utils/typeConverters';
import { getSymbolRange, ReferencesCodeLens, TypeScriptBaseCodeLensProvider } from './baseCodeLensProvider';

const localize = nls.loadMessageBundle();

export default class TypeScriptImplementationsCodeLensProvider extends TypeScriptBaseCodeLensProvider {

	public async resolveCodeLens(
		codeLens: ReferencesCodeLens,
		token: vscode.CancellationToken,
	): Promise<vscode.CodeLens> {
		const args = typeConverters.Position.toFileLocationRequestArgs(codeLens.file, codeLens.range.start);
		const response = await this.client.execute('implementation', args, token, { lowPriority: true, cancelOnResourceChange: codeLens.document });
		if (response.type !== 'response' || !response.body) {
			codeLens.command = response.type === 'cancelled'
				? TypeScriptBaseCodeLensProvider.cancelledCommand
				: TypeScriptBaseCodeLensProvider.errorCommand;
			return codeLens;
		}

		const locations = response.body
			.map(reference =>
				// Only take first line on implementation: https://github.com/microsoft/vscode/issues/23924
				new vscode.Location(this.client.toResource(reference.file),
					reference.start.line === reference.end.line
						? typeConverters.Range.fromTextSpan(reference)
						: new vscode.Range(
							typeConverters.Position.fromLocation(reference.start),
							new vscode.Position(reference.start.line, 0))))
			// Exclude original from implementations
			.filter(location =>
				!(location.uri.toString() === codeLens.document.toString() &&
					location.range.start.line === codeLens.range.start.line &&
					location.range.start.character === codeLens.range.start.character));

		codeLens.command = this.getCommand(locations, codeLens);
		return codeLens;
	}

	private getCommand(locations: vscode.Location[], codeLens: ReferencesCodeLens): vscode.Command | undefined {
		return {
			title: this.getTitle(locations),
			command: locations.length ? 'editor.action.showReferences' : '',
			arguments: [codeLens.document, codeLens.range.start, locations]
		};
	}

	private getTitle(locations: vscode.Location[]): string {
		return locations.length === 1
			? localize('oneImplementationLabel', '1 implementation')
			: localize('manyImplementationLabel', '{0} implementations', locations.length);
	}

	protected extractSymbol(
		document: vscode.TextDocument,
		item: Proto.NavigationTree,
		_parent: Proto.NavigationTree | null
	): vscode.Range | null {
		switch (item.kind) {
			case PConst.Kind.interface:
				return getSymbolRange(document, item);

			case PConst.Kind.class:
			case PConst.Kind.method:
			case PConst.Kind.memberVariable:
			case PConst.Kind.memberGetAccessor:
			case PConst.Kind.memberSetAccessor:
				if (item.kindModifiers.match(/\babstract\b/g)) {
					return getSymbolRange(document, item);
				}
				break;
		}
		return null;
	}
}

export function register(
	selector: DocumentSelector,
	modeId: string,
	client: ITypeScriptServiceClient,
	cachedResponse: CachedResponse<Proto.NavTreeResponse>,
) {
	return conditionalRegistration([
		requireConfiguration(modeId, 'implementationsCodeLens.enabled'),
		requireSomeCapability(client, ClientCapability.Semantic),
	], () => {
		return vscode.languages.registerCodeLensProvider(selector.semantic,
			new TypeScriptImplementationsCodeLensProvider(client, cachedResponse));
	});
}
