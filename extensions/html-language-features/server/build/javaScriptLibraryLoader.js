/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// a webpack loader that bundles all library definitions (d.ts) for the embedded JavaScript engine.

const path = require('path');
const fs = require('fs');

const TYPESCRIPT_LIB_SOURCE = path.join(__dirname, '../../../node_modules/typescript/lib');
const JQUERY_DTS = path.join(__dirname, '../lib/jquery.d.ts');

module.exports = function () {
	function getFileName(name) {
		return (name === '' ? 'lib.d.ts' : `lib.${name}.d.ts`);
	}
	function readLibFile(name) {
		var srcPath = path.join(TYPESCRIPT_LIB_SOURCE, getFileName(name));
		return fs.readFileSync(srcPath).toString();
	}

	var queue = [];
	var in_queue = {};

	var enqueue = function (name) {
		if (in_queue[name]) {
			return;
		}
		in_queue[name] = true;
		queue.push(name);
	};

	enqueue('es6');

	var result = [];
	while (queue.length > 0) {
		var name = queue.shift();
		var contents = readLibFile(name);
		var lines = contents.split(/\r\n|\r|\n/);

		var outputLines = [];
		for (let i = 0; i < lines.length; i++) {
			let m = lines[i].match(/\/\/\/\s*<reference\s*lib="([^"]+)"/);
			if (m) {
				enqueue(m[1]);
			}
			outputLines.push(lines[i]);
		}

		result.push({
			name: getFileName(name),
			output: `"${escapeText(outputLines.join('\n'))}"`
		});
	}

	const jquerySource = fs.readFileSync(JQUERY_DTS).toString();
	var lines = jquerySource.split(/\r\n|\r|\n/);
	result.push({
		name: 'jquery',
		output: `"${escapeText(lines.join('\n'))}"`
	});

	strResult = `\nconst libs : { [name:string]: string; } = {\n`
	for (let i = result.length - 1; i >= 0; i--) {
		strResult += `"${result[i].name}": ${result[i].output},\n`;
	}
	strResult += `\n};`

	strResult += `export function loadLibrary(name: string) : string {\n return libs[name] || ''; \n}`;

	return strResult;
}

/**
 * Escape text such that it can be used in a javascript string enclosed by double quotes (")
 */
function escapeText(text) {
	// See http://www.javascriptkit.com/jsref/escapesequence.shtml
	var _backspace = '\b'.charCodeAt(0);
	var _formFeed = '\f'.charCodeAt(0);
	var _newLine = '\n'.charCodeAt(0);
	var _nullChar = 0;
	var _carriageReturn = '\r'.charCodeAt(0);
	var _tab = '\t'.charCodeAt(0);
	var _verticalTab = '\v'.charCodeAt(0);
	var _backslash = '\\'.charCodeAt(0);
	var _doubleQuote = '"'.charCodeAt(0);

	var startPos = 0, chrCode, replaceWith = null, resultPieces = [];

	for (var i = 0, len = text.length; i < len; i++) {
		chrCode = text.charCodeAt(i);
		switch (chrCode) {
			case _backspace:
				replaceWith = '\\b';
				break;
			case _formFeed:
				replaceWith = '\\f';
				break;
			case _newLine:
				replaceWith = '\\n';
				break;
			case _nullChar:
				replaceWith = '\\0';
				break;
			case _carriageReturn:
				replaceWith = '\\r';
				break;
			case _tab:
				replaceWith = '\\t';
				break;
			case _verticalTab:
				replaceWith = '\\v';
				break;
			case _backslash:
				replaceWith = '\\\\';
				break;
			case _doubleQuote:
				replaceWith = '\\"';
				break;
		}
		if (replaceWith !== null) {
			resultPieces.push(text.substring(startPos, i));
			resultPieces.push(replaceWith);
			startPos = i + 1;
			replaceWith = null;
		}
	}
	resultPieces.push(text.substring(startPos, len));
	return resultPieces.join('');
}
