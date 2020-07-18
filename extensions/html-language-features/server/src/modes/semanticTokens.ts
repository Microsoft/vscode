/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SemanticTokenData, Range, TextDocument, LanguageModes, Position } from './languageModes';
import { beforeOrSame } from '../utils/positions';

interface LegendMapping {
	types: number[] | undefined;
	modifiers: number[] | undefined;
}

export interface SemanticTokenProvider {
	readonly legend: { types: string[]; modifiers: string[] };
	getSemanticTokens(document: TextDocument, ranges?: Range[]): Promise<number[]>;
}


export function newSemanticTokenProvider(languageModes: LanguageModes): SemanticTokenProvider {

	// combined legend across modes
	const legend: { types: string[], modifiers: string[] } = { types: [], modifiers: [] };
	const legendMappings: { [modeId: string]: LegendMapping } = {};

	for (let mode of languageModes.getAllModes()) {
		if (mode.getSemanticTokenLegend && mode.getSemanticTokens) {
			const modeLegend = mode.getSemanticTokenLegend();
			legendMappings[mode.getId()] = { types: createMapping(modeLegend.types, legend.types), modifiers: createMapping(modeLegend.modifiers, legend.modifiers) };
		}
	}

	return {
		legend,
		async getSemanticTokens(document: TextDocument, ranges?: Range[]): Promise<number[]> {
			const allTokens: SemanticTokenData[] = [];
			for (let mode of languageModes.getAllModesInDocument(document)) {
				if (mode.getSemanticTokens) {
					const mapping = legendMappings[mode.getId()];
					const tokens = await mode.getSemanticTokens(document);
					applyTypesMapping(tokens, mapping.types);
					applyModifiersMapping(tokens, mapping.modifiers);
					for (let token of tokens) {
						allTokens.push(token);
					}
				}
			}
			return encodeTokens(allTokens, ranges);
		}
	};
}

function createMapping(origLegend: string[], newLegend: string[]): number[] | undefined {
	const mapping: number[] = [];
	let needsMapping = false;
	for (let origIndex = 0; origIndex < origLegend.length; origIndex++) {
		const entry = origLegend[origIndex];
		let newIndex = newLegend.indexOf(entry);
		if (newIndex === -1) {
			newIndex = newLegend.length;
			newLegend.push(entry);
		}
		mapping.push(newIndex);
		needsMapping = needsMapping || (newIndex !== origIndex);
	}
	return needsMapping ? mapping : undefined;
}

function applyTypesMapping(tokens: SemanticTokenData[], typesMapping: number[] | undefined): void {
	if (typesMapping) {
		for (let token of tokens) {
			token.typeIdx = typesMapping[token.typeIdx];
		}
	}
}

function applyModifiersMapping(tokens: SemanticTokenData[], modifiersMapping: number[] | undefined): void {
	if (modifiersMapping) {
		for (let token of tokens) {
			let modifierSet = token.modifierSet;
			if (modifierSet) {
				let index = 0;
				let result = 0;
				while (modifierSet > 0) {
					if ((modifierSet & 1) !== 0) {
						result = result + (1 << modifiersMapping[index]);
					}
					index++;
					modifierSet = modifierSet >> 1;
				}
				token.modifierSet = result;
			}
		}
	}
}

const fullRange = [Range.create(Position.create(0, 0), Position.create(Number.MAX_VALUE, 0))];

function encodeTokens(tokens: SemanticTokenData[], ranges?: Range[]): number[] {

	const resultTokens = tokens.sort((d1, d2) => d1.start.line - d2.start.line || d1.start.character - d2.start.character);
	if (ranges) {
		ranges = ranges.sort((d1, d2) => d1.start.line - d2.start.line || d1.start.character - d2.start.character);
	} else {
		ranges = fullRange;
	}

	let rangeIndex = 0;
	let currRange = ranges[rangeIndex++];

	let prefLine = 0;
	let prevChar = 0;

	let encodedResult: number[] = [];

	for (let k = 0; k < resultTokens.length && currRange; k++) {
		const curr = resultTokens[k];
		const start = curr.start;
		while (currRange && beforeOrSame(currRange.end, start)) {
			currRange = ranges[rangeIndex++];
		}
		if (currRange && beforeOrSame(currRange.start, start) && beforeOrSame({ line: start.line, character: start.character + curr.length }, currRange.end)) {
			// token inside a range

			if (prefLine !== start.line) {
				prevChar = 0;
			}
			encodedResult.push(start.line - prefLine); // line delta
			encodedResult.push(start.character - prevChar); // line delta
			encodedResult.push(curr.length); // length
			encodedResult.push(curr.typeIdx); // tokenType
			encodedResult.push(curr.modifierSet); // tokenModifier

			prefLine = start.line;
			prevChar = start.character;
		}
	}
	return encodedResult;
}
