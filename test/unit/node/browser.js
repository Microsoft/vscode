/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

const yaserver = require('yaserver');
const http = require('http');
const glob = require('glob');
const path = require('path');
const fs = require('fs');

const REPO_ROOT = path.join(__dirname, '../../../');
const PORT = 8887;

function template(str, env) {
	return str.replace(/{{\s*([\w_\-]+)\s*}}/g, function (all, part) {
		return env[part];
	});
}

yaserver.createServer({ rootDir: REPO_ROOT }).then((staticServer) => {
	const server = http.createServer((req, res) => {
		if (req.url === '' || req.url === '/') {
			glob('**/vs/{base,platform,editor}/**/test/{common,browser}/**/*.test.js', {
				cwd: path.join(REPO_ROOT, 'out'),
				// ignore: ['**/test/{node,electron*}/**/*.js']
			}, function (err, files) {
				if (err) { console.log(err); process.exit(0); }

				var modules = files
					.map(function (file) { return file.replace(/\.js$/, ''); });

				fs.readFile(path.join(__dirname, 'index.html'), 'utf8', function (err, templateString) {
					if (err) { console.log(err); process.exit(0); }

					res.end(template(templateString, {
						modules: JSON.stringify(modules)
					}));
				});
			});
		} else {
			return staticServer.handle(req, res);
		}
	});

	server.listen(PORT, () => {
		console.log(`http://localhost:${PORT}/`);
	});
});
