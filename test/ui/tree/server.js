/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const fs = require('mz/fs');
const path = require('path');
const Koa = require('koa');
const _ = require('koa-route');
const serve = require('koa-static');
const mount = require('koa-mount');

const app = new Koa();
const root = path.dirname(path.dirname(__dirname));

async function getTree(fsPath, level) {
	const element = path.basename(fsPath);
	const stat = await fs.stat(fsPath);

	if (!stat.isDirectory() || element === '.git' || element === '.build' || level >= 4) {
		return { element };
	}

	const childNames = await fs.readdir(fsPath);
	const children = await Promise.all(childNames.map(async childName => await getTree(path.join(fsPath, childName), level + 1)));
	return { element, collapsible: true, collapsed: false, children };
}

async function readdir(relativePath) {
	const absolutePath = relativePath ? path.join(root, relativePath) : root;
	const childNames = await fs.readdir(absolutePath);
	const childStats = await Promise.all(childNames.map(async name => await fs.stat(path.join(absolutePath, name))));
	const result = [];

	for (let i = 0; i < childNames.length; i++) {
		const name = childNames[i];
		const path = relativePath ? `${relativePath}/${name}` : name;
		const stat = childStats[i];

		if (stat.isFile()) {
			result.push({ type: 'file', name, path });
		} else if (!stat.isDirectory() || name === '.git' || name === '.build') {
			continue;
		} else {
			result.push({ type: 'dir', name, path });
		}
	}

	return result;
}

app.use(serve('public'));
app.use(mount('/static', serve('../../out')));
app.use(_.get('/api/ls', async ctx => {
	const relativePath = ctx.query.path;
	const absolutePath = path.join(root, relativePath);

	ctx.body = await getTree(absolutePath, 0);
}));

app.use(_.get('/api/readdir', async ctx => {
	const relativePath = ctx.query.path;

	ctx.body = await readdir(relativePath);
}));

app.listen(3000);
console.log('http://localhost:3000');
