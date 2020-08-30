/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

var path = require('path');
var fs = require('fs');
var plist = require('fast-plist');

var mappings = {
	"background": ["editor.background"],
	"foreground": ["editor.foreground"],
	"hoverHighlight": ["editor.hoverHighlightBackground"],
	"linkForeground": ["editorLink.foreground"],
	"selection": ["editor.selectionBackground"],
	"inactiveSelection": ["editor.inactiveSelectionBackground"],
	"selectionHighlightColor": ["editor.selectionHighlightBackground"],
	"wordHighlight": ["editor.wordHighlightBackground"],
	"wordHighlightStrong": ["editor.wordHighlightStrongBackground"],
	"findMatchHighlight": ["editor.findMatchHighlightBackground", "peekViewResult.matchHighlightBackground"],
	"currentFindMatchHighlight": ["editor.findMatchBackground"],
	"findRangeHighlight": ["editor.findRangeHighlightBackground"],
	"referenceHighlight": ["peekViewEditor.matchHighlightBackground"],
	"lineHighlight": ["editor.lineHighlightBackground"],
	"rangeHighlight": ["editor.rangeHighlightBackground"],
	"caret": ["editorCursor.foreground"],
	"invisibles": ["editorWhitespace.foreground"],
	"guide": ["editorIndentGuide.background"],
	"ansiBlack": ["terminal.ansiBlack"], "ansiRed": ["terminal.ansiRed"], "ansiGreen": ["terminal.ansiGreen"], "ansiYellow": ["terminal.ansiYellow"],
	"ansiBlue": ["terminal.ansiBlue"], "ansiMagenta": ["terminal.ansiMagenta"], "ansiCyan": ["terminal.ansiCyan"], "ansiWhite": ["terminal.ansiWhite"],
	"ansiBrightBlack": ["terminal.ansiBrightBlack"], "ansiBrightRed": ["terminal.ansiBrightRed"], "ansiBrightGreen": ["terminal.ansiBrightGreen"],
	"ansiBrightYellow": ["terminal.ansiBrightYellow"], "ansiBrightBlue": ["terminal.ansiBrightBlue"], "ansiBrightMagenta": ["terminal.ansiBrightMagenta"],
	"ansiBrightCyan": ["terminal.ansiBrightCyan"], "ansiBrightWhite": ["terminal.ansiBrightWhite"]
};

exports.update = function (srcName, destName) {
	try {
		console.log('reading ', srcName);
		let result = {};
		let plistContent = fs.readFileSync(srcName).toString();
		let theme = plist.parse(plistContent);
		let settings = theme.settings;
		if (Array.isArray(settings)) {
			let colorMap = {};
			for (let entry of settings) {
				let scope = entry.scope;
				if (scope) {
					let parts = scope.split(',').map(p => p.trim());
					if (parts.length > 1) {
						entry.scope = parts;
					}
				} else {
					var entrySettings = entry.settings;
					for (let entry in entrySettings) {
						let mapping = mappings[entry];
						if (mapping) {
							for (let newKey of mapping) {
								colorMap[newKey] = entrySettings[entry];
							}
							if (entry !== 'foreground' && entry !== 'background') {
								delete entrySettings[entry];
							}
						}
					}

				}
			}
			result.name = theme.name;
			result.tokenColors = settings;
			result.colors = colorMap;
		}
		fs.writeFileSync(destName, JSON.stringify(result, null, '\t'));
	} catch (e) {
		console.log(e);
	}
};

if (path.basename(process.argv[1]) === 'update-theme.js') {
	exports.update(process.argv[2], process.argv[3]);
}
