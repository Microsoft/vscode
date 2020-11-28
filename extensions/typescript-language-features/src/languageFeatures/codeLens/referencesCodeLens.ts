/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import type * as Proto from '../../protocol';
import * as PConst from '../../protocol.const';
import { CachedResponse } from '../../tsServer/cachedResponse';
import { ExectuionTarget } from '../../tsServer/server';
import { ClientCapability, ITypeScriptServiceClient } from '../../typescriptService';
import { conditionalRegistration, requireConfiguration, requireSomeCapability } from '../../utils/dependentRegistration';
import { DocumentSelector } from '../../utils/documentSelector';
import * as typeConverters from '../../utils/typeConverters';
import { getSymbolRange, ReferencesCodeLens, TypeScriptBaseCodeLensProvider } from './baseCodeLensProvider';

const localize = nls.loadMessageBundle();

export class TypeScriptReferencesCodeLensProvider extends TypeScriptBaseCodeLensProvider {
	public constructor(
		protected client: ITypeScriptServiceClient,
		protected _cachedResponse: CachedResponse<Proto.NavTreeResponse>,
		private modeId: string
	) {
		super(client, _cachedResponse);
	}

	public async resolveCodeLens(codeLens: ReferencesCodeLens, token: vscode.CancellationToken): Promise<vscode.CodeLens> {
		const args = typeConverters.Position.toFileLocationRequestArgs(codeLens.file, codeLens.range.start);
		const response = await this.client.execute('references', args, token, {
			lowPriority: true,
			executionTarget: ExectuionTarget.Semantic,
			cancelOnResourceChange: codeLens.document,
		});
		if (response.type !== 'response' || !response.body) {
			codeLens.command = response.type === 'cancelled'
				? TypeScriptBaseCodeLensProvider.cancelledCommand
				: TypeScriptBaseCodeLensProvider.errorCommand;
			return codeLens;
		}

		const locations = response.body.refs
			.filter(reference => !reference.isDefinition)
			.map(reference =>
				typeConverters.Location.fromTextSpan(this.client.toResource(reference.file), reference));

		codeLens.command = {
			title: this.getCodeLensLabel(locations),
			command: locations.length ? 'editor.action.showReferences' : '',
			arguments: [codeLens.document, codeLens.range.start, locations]
		};
		return codeLens;
	}

	private getCodeLensLabel(locations: ReadonlyArray<vscode.Location>): string {
		return locations.length === 1
			? localize('oneReferenceLabel', '1 reference')
			: localize('manyReferenceLabel', '{0} references', locations.length);
	}

	protected extractSymbol(
		document: vscode.TextDocument,
		item: Proto.NavigationTree,
		parent: Proto.NavigationTree | null
	): vscode.Range | null {
		if (parent && parent.kind === PConst.Kind.enum) {
			return getSymbolRange(document, item);
		}

		switch (item.kind) {
			case PConst.Kind.function:
				const showOnAllFunctions = vscode.workspace.getConfiguration(this.modeId).get<boolean>('referencesCodeLens.showOnAllFunctions');
				if (showOnAllFunctions) {
					return getSymbolRange(document, item);
				}
			// fallthrough

			case PConst.Kind.const:
			case PConst.Kind.let:
			case PConst.Kind.variable:
				// Only show references for exported variables
				if (/\bexport\b/.test(item.kindModifiers)) {
					return getSymbolRange(document, item);
				}
				break;

			case PConst.Kind.class:
				if (item.text === '<class>') {
					break;
				}
				return getSymbolRange(document, item);

			case PConst.Kind.interface:
			case PConst.Kind.type:
			case PConst.Kind.enum:
				return getSymbolRange(document, item);

			case PConst.Kind.method:
			case PConst.Kind.memberGetAccessor:
			case PConst.Kind.memberSetAccessor:
			case PConst.Kind.constructorImplementation:
			case PConst.Kind.memberVariable:
				// Don't show if child and parent have same start
				// For https://github.com/microsoft/vscode/issues/90396
				if (parent &&
					typeConverters.Position.fromLocation(parent.spans[0].start).isEqual(typeConverters.Position.fromLocation(item.spans[0].start))
				) {
					return null;
				}

				// Only show if parent is a class type object (not a literal)
				switch (parent?.kind) {
					case PConst.Kind.class:
					case PConst.Kind.interface:
					case PConst.Kind.type:
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
		requireConfiguration(modeId, 'referencesCodeLens.enabled'),
		requireSomeCapability(client, ClientCapability.Semantic),
	], () => {
		return vscode.languages.registerCodeLensProvider(selector.semantic,
			new TypeScriptReferencesCodeLensProvider(client, cachedResponse, modeId));
	});
}
