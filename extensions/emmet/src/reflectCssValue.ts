/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Range, window, TextEditor } from 'vscode';
import { getCssPropertyFromRule, getCssPropertyFromDocument } from './util';
import { Property, Rule } from 'EmmetNode';

const vendorPrefixes = ['-webkit-', '-moz-', '-ms-', '-o-', ''];

export function reflectCssValue(): Thenable<boolean> | undefined {
	let editor = window.activeTextEditor;
	if (!editor) {
		window.showInformationMessage('No editor is active.');
		return;
	}

	let node = getCssPropertyFromDocument(editor, editor.selection.active);
	if (!node) {
		return;
	}

	return updateCSSNode(editor, node);
}

function updateCSSNode(editor: TextEditor, property: Property): Thenable<boolean> {
	const rule: Rule = property.parent;
	let currentPrefix = '';

	// Find vendor prefix of given property node
	for (const prefix of vendorPrefixes) {
		if (property.name.startsWith(prefix)) {
			currentPrefix = prefix;
			break;
		}
	}

	const propertyName = property.name.substr(currentPrefix.length);
	const propertyValue = property.value;

	return editor.edit(builder => {
		// Find properties with vendor prefixes, update each
		vendorPrefixes.forEach(prefix => {
			if (prefix === currentPrefix) {
				return;
			}
			let vendorProperty = getCssPropertyFromRule(rule, prefix + propertyName);
			if (vendorProperty) {
				builder.replace(new Range(vendorProperty.valueToken.start, vendorProperty.valueToken.end), propertyValue);
			}
		});
	});
}
