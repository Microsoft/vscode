/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'mocha';
import * as assert from 'assert';
import { commands, Uri } from 'vscode';
import { join, basename, normalize, dirname } from 'path';
import * as fs from 'fs';

function assertUnchangedTokens(testFixurePath: string, done: any) {
	let fileName = basename(testFixurePath);

	return commands.executeCommand('_workbench.captureSyntaxTokens', Uri.file(testFixurePath)).then(data => {
		try {
			let resultsFolderPath = join(dirname(dirname(testFixurePath)), 'colorize-results');
			if (!fs.existsSync(resultsFolderPath)) {
				fs.mkdirSync(resultsFolderPath);
			}
			let resultPath = join(resultsFolderPath, fileName.replace('.', '_') + '.json');
			if (fs.existsSync(resultPath)) {
				let previousData = JSON.parse(fs.readFileSync(resultPath).toString());
				try {
					assert.deepEqual(data, previousData);
				} catch (e) {
					fs.writeFileSync(resultPath, JSON.stringify(data, null, '\t'), { flag: 'w' });
					if (Array.isArray(data) && Array.isArray(previousData) && data.length === previousData.length) {
						for (let i= 0; i < data.length; i++) {
							let d = data[i];
							let p = previousData[i];
							if (d.c !== p.c || hasThemeChange(d.r, p.r)) {
								throw e;
							}
						}
						// different but no tokenization ot color change: no failure
					} else {
						throw e;
					}
				}
			} else {
				fs.writeFileSync(resultPath, JSON.stringify(data, null, '\t'));
			}
			done();
		} catch (e) {
			done(e);
		}
	}, done);
}

function hasThemeChange(d: any, p: any) : boolean {
	let keys = Object.keys(d);
	for (let key of keys) {
		if (d[key] !== p[key]) {
			return true;
		}
	}
	return false;
}

suite('colorization', () => {
	let extensionsFolder = normalize(join(__dirname, '../../'));
	let extensions = fs.readdirSync(extensionsFolder);
	extensions.forEach(extension => {
		let extensionColorizeFixturePath = join(extensionsFolder, extension, 'test', 'colorize-fixtures');
		if (fs.existsSync(extensionColorizeFixturePath)) {
			let fixturesFiles = fs.readdirSync(extensionColorizeFixturePath);
			fixturesFiles.forEach(fixturesFile => {
				// define a test for each fixture
				test(extension + '-' + fixturesFile, function (done) {
					assertUnchangedTokens(join(extensionColorizeFixturePath, fixturesFile), done);
				});
			});
		}
	});
});
