/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

let err = false;

const majorNodeVersion = parseInt(/^(\d+)\./.exec(process.versions.node)[1]);

if (majorNodeVersion < 10 || majorNodeVersion >= 16) {
	console.error('\033[1;31m*** Please use node >=10 and <=16.\033[0;0m');
	err = true;
}

const cp = require('child_process');
const yarnVersion = cp.execSync('yarn -v', { encoding: 'utf8' }).trim();
const parsedYarnVersion = /^(\d+)\.(\d+)\./.exec(yarnVersion);
const majorYarnVersion = parseInt(parsedYarnVersion[1]);
const minorYarnVersion = parseInt(parsedYarnVersion[2]);

if (majorYarnVersion < 1 || minorYarnVersion < 10) {
	console.error('\033[1;31m*** Please use yarn >=1.10.1.\033[0;0m');
	err = true;
}

if (!/yarn[\w-.]*\.js$|yarnpkg$/.test(process.env['npm_execpath'])) {
	console.error('\033[1;31m*** Please use yarn to install dependencies.\033[0;0m');
	err = true;
}

if (err) {
	console.error('');
	process.exit(1);
}
