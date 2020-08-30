/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const path = require('path');
const parseSemver = require('parse-semver');
const cp = require('child_process');
const _ = require('underscore');

function asYarnDependency(prefix, tree) {
	let parseResult;

	try {
		parseResult = parseSemver(tree.name);
	} catch (err) {
		err.message += `: ${tree.name}`;
		console.warn(`Could not parse semver: ${tree.name}`);
		return null;
	}

	// not an actual dependency in disk
	if (parseResult.version !== parseResult.range) {
		return null;
	}

	const name = parseResult.name;
	const version = parseResult.version;
	const dependencyPath = path.join(prefix, name);
	const children = [];

	for (const child of (tree.children || [])) {
		const dep = asYarnDependency(path.join(prefix, name, 'node_modules'), child);

		if (dep) {
			children.push(dep);
		}
	}

	return { name, version, path: dependencyPath, children };
}

function getYarnProductionDependencies(cwd) {
	const raw = cp.execSync('yarn list --json', { cwd, encoding: 'utf8', env: { ...process.env, NODE_ENV: 'production' }, stdio: [null, null, 'inherit'] });
	const match = /^{"type":"tree".*$/m.exec(raw);

	if (!match || match.length !== 1) {
		throw new Error('Could not parse result of `yarn list --json`');
	}

	const trees = JSON.parse(match[0]).data.trees;

	return trees
		.map(tree => asYarnDependency(path.join(cwd, 'node_modules'), tree))
		.filter(dep => !!dep);
}

function getProductionDependencies(cwd) {
	const result = [];
	const deps = getYarnProductionDependencies(cwd);
	const flatten = dep => { result.push({ name: dep.name, version: dep.version, path: dep.path }); dep.children.forEach(flatten); };
	deps.forEach(flatten);

	return _.uniq(result);
}

module.exports.getProductionDependencies = getProductionDependencies;

if (require.main === module) {
	const root = path.dirname(__dirname);
	console.log(JSON.stringify(getProductionDependencies(root), null, '  '));
}
