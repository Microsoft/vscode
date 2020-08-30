/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const gulp = require('gulp');

const noop = () => { return Promise.resolve(); };

gulp.task('minify-vscode-web', noop);
gulp.task('vscode-web', noop);
gulp.task('vscode-web-min', noop);
gulp.task('vscode-web-ci', noop);
gulp.task('vscode-web-min-ci', noop);
