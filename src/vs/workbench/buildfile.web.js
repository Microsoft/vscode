/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

function createModuleDescription(name, exclude) {
	const result = {};

	let excludes = ['vs/css', 'vs/nls'];
	result.name = name;
	if (Array.isArray(exclude) && exclude.length > 0) {
		excludes = excludes.concat(exclude);
	}
	result.exclude = excludes;

	return result;
}

exports.collectModules = function () {
	return [
		createModuleDescription('vs/workbench/contrib/output/common/outputLinkComputer', ['vs/base/common/worker/simpleWorker', 'vs/editor/common/services/editorSimpleWorker']),
		createModuleDescription('vs/code/browser/workbench/workbench', ['vs/workbench/workbench.web.api']),
	];
};
