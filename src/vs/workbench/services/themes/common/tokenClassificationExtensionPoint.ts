/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { ExtensionsRegistry, ExtensionMessageCollector } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { getTokenClassificationRegistry, ITokenClassificationRegistry, typeAndModifierIdPattern } from 'vs/platform/theme/common/tokenClassificationRegistry';

interface ITokenTypeExtensionPoint {
	id: string;
	description: string;
	superType?: string;
}

interface ITokenModifierExtensionPoint {
	id: string;
	description: string;
}

interface ITokenStyleDefaultExtensionPoint {
	language?: string;
	scopes: { [selector: string]: string[] };
}

const tokenClassificationRegistry: ITokenClassificationRegistry = getTokenClassificationRegistry();

const tokenTypeExtPoint = ExtensionsRegistry.registerExtensionPoint<ITokenTypeExtensionPoint[]>({
	extensionPoint: 'semanticTokenTypes',
	jsonSchema: {
		description: nls.localize('contributes.semanticTokenTypes', 'Contributes semantic token types.'),
		type: 'array',
		items: {
			type: 'object',
			properties: {
				id: {
					type: 'string',
					description: nls.localize('contributes.semanticTokenTypes.id', 'The identifier of the semantic token type'),
					pattern: typeAndModifierIdPattern,
					patternErrorMessage: nls.localize('contributes.semanticTokenTypes.id.format', 'Identifiers should be in the form letterOrDigit[_-letterOrDigit]*'),
				},
				superType: {
					type: 'string',
					description: nls.localize('contributes.semanticTokenTypes.superType', 'The super type of the semantic token type'),
					pattern: typeAndModifierIdPattern,
					patternErrorMessage: nls.localize('contributes.semanticTokenTypes.superType.format', 'Super types should be in the form letterOrDigit[_-letterOrDigit]*'),
				},
				description: {
					type: 'string',
					description: nls.localize('contributes.color.description', 'The description of the semantic token type'),
				}
			}
		}
	}
});

const tokenModifierExtPoint = ExtensionsRegistry.registerExtensionPoint<ITokenModifierExtensionPoint[]>({
	extensionPoint: 'semanticTokenModifiers',
	jsonSchema: {
		description: nls.localize('contributes.semanticTokenModifiers', 'Contributes semantic token modifiers.'),
		type: 'array',
		items: {
			type: 'object',
			properties: {
				id: {
					type: 'string',
					description: nls.localize('contributes.semanticTokenModifiers.id', 'The identifier of the semantic token modifier'),
					pattern: typeAndModifierIdPattern,
					patternErrorMessage: nls.localize('contributes.semanticTokenModifiers.id.format', 'Identifiers should be in the form letterOrDigit[_-letterOrDigit]*')
				},
				description: {
					description: nls.localize('contributes.semanticTokenModifiers.description', 'The description of the semantic token modifier')
				}
			}
		}
	}
});

const tokenStyleDefaultsExtPoint = ExtensionsRegistry.registerExtensionPoint<ITokenStyleDefaultExtensionPoint[]>({
	extensionPoint: 'semanticTokenScopes',
	jsonSchema: {
		description: nls.localize('contributes.semanticTokenScopes', 'Contributes semantic token scope maps.'),
		type: 'array',
		items: {
			type: 'object',
			properties: {
				language: {
					description: nls.localize('contributes.semanticTokenScopes.languages', 'Lists the languge for which the defaults are.'),
					type: 'string'
				},
				scopes: {
					description: nls.localize('contributes.semanticTokenScopes.scopes', 'Maps a semantic token (described by semantic token selector) to one or more textMate scopes used to represent that token.'),
					type: 'object',
					additionalProperties: {
						type: 'array',
						items: {
							type: 'string'
						}
					}
				}
			}
		}
	}
});


export class TokenClassificationExtensionPoints {

	constructor() {
		function validateTypeOrModifier(contribution: ITokenTypeExtensionPoint | ITokenModifierExtensionPoint, extensionPoint: string, collector: ExtensionMessageCollector): boolean {
			if (typeof contribution.id !== 'string' || contribution.id.length === 0) {
				collector.error(nls.localize('invalid.id', "'configuration.{0}.id' must be defined and can not be empty", extensionPoint));
				return false;
			}
			if (!contribution.id.match(typeAndModifierIdPattern)) {
				collector.error(nls.localize('invalid.id.format', "'configuration.{0}.id' must follow the pattern letterOrDigit[-_letterOrDigit]*", extensionPoint));
				return false;
			}
			const superType = (contribution as ITokenTypeExtensionPoint).superType;
			if (superType && !superType.match(typeAndModifierIdPattern)) {
				collector.error(nls.localize('invalid.superType.format', "'configuration.{0}.superType' must follow the pattern letterOrDigit[-_letterOrDigit]*", extensionPoint));
				return false;
			}
			if (typeof contribution.description !== 'string' || contribution.id.length === 0) {
				collector.error(nls.localize('invalid.description', "'configuration.{0}.description' must be defined and can not be empty", extensionPoint));
				return false;
			}
			return true;
		}

		tokenTypeExtPoint.setHandler((extensions, delta) => {
			for (const extension of delta.added) {
				const extensionValue = <ITokenTypeExtensionPoint[]>extension.value;
				const collector = extension.collector;

				if (!extensionValue || !Array.isArray(extensionValue)) {
					collector.error(nls.localize('invalid.semanticTokenTypeConfiguration', "'configuration.semanticTokenType' must be an array"));
					return;
				}
				for (const contribution of extensionValue) {
					if (validateTypeOrModifier(contribution, 'semanticTokenType', collector)) {
						tokenClassificationRegistry.registerTokenType(contribution.id, contribution.description, contribution.superType);
					}
				}
			}
			for (const extension of delta.removed) {
				const extensionValue = <ITokenTypeExtensionPoint[]>extension.value;
				for (const contribution of extensionValue) {
					tokenClassificationRegistry.deregisterTokenType(contribution.id);
				}
			}
		});
		tokenModifierExtPoint.setHandler((extensions, delta) => {
			for (const extension of delta.added) {
				const extensionValue = <ITokenModifierExtensionPoint[]>extension.value;
				const collector = extension.collector;

				if (!extensionValue || !Array.isArray(extensionValue)) {
					collector.error(nls.localize('invalid.semanticTokenModifierConfiguration', "'configuration.semanticTokenModifier' must be an array"));
					return;
				}
				for (const contribution of extensionValue) {
					if (validateTypeOrModifier(contribution, 'semanticTokenModifier', collector)) {
						tokenClassificationRegistry.registerTokenModifier(contribution.id, contribution.description);
					}
				}
			}
			for (const extension of delta.removed) {
				const extensionValue = <ITokenModifierExtensionPoint[]>extension.value;
				for (const contribution of extensionValue) {
					tokenClassificationRegistry.deregisterTokenModifier(contribution.id);
				}
			}
		});
		tokenStyleDefaultsExtPoint.setHandler((extensions, delta) => {
			for (const extension of delta.added) {
				const extensionValue = <ITokenStyleDefaultExtensionPoint[]>extension.value;
				const collector = extension.collector;

				if (!extensionValue || !Array.isArray(extensionValue)) {
					collector.error(nls.localize('invalid.semanticTokenScopes.configuration', "'configuration.semanticTokenScopes' must be an array"));
					return;
				}
				for (const contribution of extensionValue) {
					if (contribution.language && typeof contribution.language !== 'string') {
						collector.error(nls.localize('invalid.semanticTokenScopes.language', "'configuration.semanticTokenScopes.language' must be a string"));
						continue;
					}
					if (!contribution.scopes || typeof contribution.scopes !== 'object') {
						collector.error(nls.localize('invalid.semanticTokenScopes.scopes', "'configuration.semanticTokenScopes.scopes' must be defined as an object"));
						continue;
					}
					for (let selectorString in contribution.scopes) {
						const tmScopes = contribution.scopes[selectorString];
						if (!Array.isArray(tmScopes) || tmScopes.some(l => typeof l !== 'string')) {
							collector.error(nls.localize('invalid.semanticTokenScopes.scopes.value', "'configuration.semanticTokenScopes.scopes' values must be an array of strings"));
							continue;
						}
						try {
							const selector = tokenClassificationRegistry.parseTokenSelector(selectorString, contribution.language);
							tokenClassificationRegistry.registerTokenStyleDefault(selector, { scopesToProbe: tmScopes.map(s => s.split(' ')) });
						} catch (e) {
							collector.error(nls.localize('invalid.semanticTokenScopes.scopes.selector', "configuration.semanticTokenScopes.scopes': Problems parsing selector {0}.", selectorString));
							// invalid selector, ignore
						}
					}
				}
			}
			for (const extension of delta.removed) {
				const extensionValue = <ITokenStyleDefaultExtensionPoint[]>extension.value;
				for (const contribution of extensionValue) {
					for (let selectorString in contribution.scopes) {
						const tmScopes = contribution.scopes[selectorString];
						try {
							const selector = tokenClassificationRegistry.parseTokenSelector(selectorString, contribution.language);
							tokenClassificationRegistry.registerTokenStyleDefault(selector, { scopesToProbe: tmScopes.map(s => s.split(' ')) });
						} catch (e) {
							// invalid selector, ignore
						}
					}
				}
			}
		});
	}
}



