/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');
const util = require('./lib/util');
const task = require('./lib/task');
const compilation = require('./lib/compilation');

// Full compile, including nls and inline sources in sourcemaps, for build
const compileBuildTask = task.define('compile-build', task.series(util.rimraf('out-build'), compilation.compileTask('src', 'out-build', true)));
gulp.task(compileBuildTask);
exports.compileBuildTask = compileBuildTask;
