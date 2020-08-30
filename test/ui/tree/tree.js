/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const path = require('path');
const fs = require('fs');

function collect(location) {
	const element = { name: path.basename(location) };
	const stat = fs.statSync(location);

	if (!stat.isDirectory()) {
		return { element, incompressible: true };
	}

	const children = fs.readdirSync(location)
		.map(child => path.join(location, child))
		.map(collect);

	return { element, children };
}

console.log(JSON.stringify(collect(process.cwd())));
