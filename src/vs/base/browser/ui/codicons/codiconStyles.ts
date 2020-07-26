/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./codicon/codicon';
import 'vs/css!./codicon/codicon-modifications';
import 'vs/css!./codicon/codicon-animations';

import { Codicon, iconRegistry } from 'vs/base/common/codicons';
import { createStyleSheet } from 'vs/base/browser/dom';
import { RunOnceScheduler } from 'vs/base/common/async';

function initialize() {
	let codiconStyleSheet = createStyleSheet();
	codiconStyleSheet.id = 'codiconStyles';

	function updateAll() {
		const rules = [];
		for (let c of iconRegistry.all) {
			rules.push(formatRule(c));
		}
		codiconStyleSheet.innerHTML = rules.join('\n');
	}

	const delayer = new RunOnceScheduler(updateAll, 0);
	iconRegistry.onDidRegister(() => delayer.schedule());
	delayer.schedule();
}

export function formatRule(c: Codicon) {
	let def = c.definition;
	while (def instanceof Codicon) {
		def = def.definition;
	}
	return `.codicon-${c.id}:before { content: '${def.character}'; }`;
}

initialize();
