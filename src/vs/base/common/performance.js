/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

//@ts-check

function _factory(sharedObj) {

	sharedObj.MonacoPerformanceMarks = sharedObj.MonacoPerformanceMarks || [];

	const _dataLen = 2;
	const _timeStamp = typeof console.timeStamp === 'function' ? console.timeStamp.bind(console) : () => { };

	function importEntries(entries) {
		sharedObj.MonacoPerformanceMarks.splice(0, 0, ...entries);
	}

	function exportEntries() {
		return sharedObj.MonacoPerformanceMarks.slice(0);
	}

	function getEntries() {
		const result = [];
		const entries = sharedObj.MonacoPerformanceMarks;
		for (let i = 0; i < entries.length; i += _dataLen) {
			result.push({
				name: entries[i],
				startTime: entries[i + 1],
			});
		}
		return result;
	}

	function getDuration(from, to) {
		const entries = sharedObj.MonacoPerformanceMarks;
		let target = to;
		let endIndex = 0;
		for (let i = entries.length - _dataLen; i >= 0; i -= _dataLen) {
			if (entries[i] === target) {
				if (target === to) {
					// found `to` (end of interval)
					endIndex = i;
					target = from;
				} else {
					// found `from` (start of interval)
					return entries[endIndex + 1] - entries[i + 1];
				}
			}
		}
		return 0;
	}

	function mark(name) {
		sharedObj.MonacoPerformanceMarks.push(name, Date.now());
		_timeStamp(name);
	}

	const exports = {
		mark: mark,
		getEntries: getEntries,
		getDuration: getDuration,
		importEntries: importEntries,
		exportEntries: exportEntries
	};

	return exports;
}

// This module can be loaded in an amd and commonjs-context.
// Because we want both instances to use the same perf-data
// we store them globally

// eslint-disable-next-line no-var
var sharedObj;
if (typeof global === 'object') {
	// nodejs
	sharedObj = global;
} else if (typeof self === 'object') {
	// browser
	sharedObj = self;
} else {
	sharedObj = {};
}

if (typeof define === 'function') {
	// amd
	define([], function () { return _factory(sharedObj); });
} else if (typeof module === 'object' && typeof module.exports === 'object') {
	// commonjs
	module.exports = _factory(sharedObj);
} else {
	sharedObj.perf = _factory(sharedObj);
}
