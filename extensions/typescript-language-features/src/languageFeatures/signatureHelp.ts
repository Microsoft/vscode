/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import type * as Proto from '../protocol';
import { ClientCapability, ITypeScriptServiceClient } from '../typescriptService';
import { conditionalRegistration, requireSomeCapability } from '../utils/dependentRegistration';
import { DocumentSelector } from '../utils/documentSelector';
import * as Previewer from '../utils/previewer';
import * as typeConverters from '../utils/typeConverters';

class TypeScriptSignatureHelpProvider implements vscode.SignatureHelpProvider {

	public static readonly triggerCharacters = ['(', ',', '<'];
	public static readonly retriggerCharacters = [')'];

	public constructor(
		private readonly client: ITypeScriptServiceClient
	) { }

	public async provideSignatureHelp(
		document: vscode.TextDocument,
		position: vscode.Position,
		token: vscode.CancellationToken,
		context: vscode.SignatureHelpContext,
	): Promise<vscode.SignatureHelp | undefined> {
		const filepath = this.client.toOpenedFilePath(document);
		if (!filepath) {
			return undefined;
		}

		const args: Proto.SignatureHelpRequestArgs = {
			...typeConverters.Position.toFileLocationRequestArgs(filepath, position),
			triggerReason: toTsTriggerReason(context)
		};
		const response = await this.client.interruptGetErr(() => this.client.execute('signatureHelp', args, token));
		if (response.type !== 'response' || !response.body) {
			return undefined;
		}

		const info = response.body;
		const result = new vscode.SignatureHelp();
		result.signatures = info.items.map(signature => this.convertSignature(signature));
		result.activeSignature = this.getActiveSignature(context, info, result.signatures);
		result.activeParameter = this.getActiveParameter(info);

		return result;
	}

	private getActiveSignature(context: vscode.SignatureHelpContext, info: Proto.SignatureHelpItems, signatures: readonly vscode.SignatureInformation[]): number {
		// Try matching the previous active signature's label to keep it selected
		const previouslyActiveSignature = context.activeSignatureHelp?.signatures[context.activeSignatureHelp.activeSignature];
		if (previouslyActiveSignature && context.isRetrigger) {
			const existingIndex = signatures.findIndex(other => other.label === previouslyActiveSignature?.label);
			if (existingIndex >= 0) {
				return existingIndex;
			}
		}

		return info.selectedItemIndex;
	}

	private getActiveParameter(info: Proto.SignatureHelpItems): number {
		const activeSignature = info.items[info.selectedItemIndex];
		if (activeSignature && activeSignature.isVariadic) {
			return Math.min(info.argumentIndex, activeSignature.parameters.length - 1);
		}
		return info.argumentIndex;
	}

	private convertSignature(item: Proto.SignatureHelpItem) {
		const signature = new vscode.SignatureInformation(
			Previewer.plainWithLinks(item.prefixDisplayParts, this.client),
			Previewer.markdownDocumentation(item.documentation, item.tags.filter(x => x.name !== 'param'), this.client));

		let textIndex = signature.label.length;
		const separatorLabel = Previewer.plainWithLinks(item.separatorDisplayParts, this.client);
		for (let i = 0; i < item.parameters.length; ++i) {
			const parameter = item.parameters[i];
			const label = Previewer.plainWithLinks(parameter.displayParts, this.client);

			signature.parameters.push(
				new vscode.ParameterInformation(
					[textIndex, textIndex + label.length],
					Previewer.markdownDocumentation(parameter.documentation, [], this.client)));

			textIndex += label.length;
			signature.label += label;

			if (i !== item.parameters.length - 1) {
				signature.label += separatorLabel;
				textIndex += separatorLabel.length;
			}
		}

		signature.label += Previewer.plainWithLinks(item.suffixDisplayParts, this.client);
		return signature;
	}
}

function toTsTriggerReason(context: vscode.SignatureHelpContext): Proto.SignatureHelpTriggerReason {
	switch (context.triggerKind) {
		case vscode.SignatureHelpTriggerKind.TriggerCharacter:
			if (context.triggerCharacter) {
				if (context.isRetrigger) {
					return { kind: 'retrigger', triggerCharacter: context.triggerCharacter as any };
				} else {
					return { kind: 'characterTyped', triggerCharacter: context.triggerCharacter as any };
				}
			} else {
				return { kind: 'invoked' };
			}

		case vscode.SignatureHelpTriggerKind.ContentChange:
			return context.isRetrigger ? { kind: 'retrigger' } : { kind: 'invoked' };

		case vscode.SignatureHelpTriggerKind.Invoke:
		default:
			return { kind: 'invoked' };
	}
}
export function register(
	selector: DocumentSelector,
	client: ITypeScriptServiceClient,
) {
	return conditionalRegistration([
		requireSomeCapability(client, ClientCapability.EnhancedSyntax, ClientCapability.Semantic),
	], () => {
		return vscode.languages.registerSignatureHelpProvider(selector.syntax,
			new TypeScriptSignatureHelpProvider(client), {
			triggerCharacters: TypeScriptSignatureHelpProvider.triggerCharacters,
			retriggerCharacters: TypeScriptSignatureHelpProvider.retriggerCharacters
		});
	});
}
