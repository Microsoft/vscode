/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { MarkdownString } from 'vs/base/common/htmlContent';

suite('MarkdownString', () => {

	test('appendText', () => {

		const mds = new MarkdownString();
		mds.appendText('# foo\n*bar*');

		assert.equal(mds.value, '\\# foo\n\n\\*bar\\*');
	});

	suite('ThemeIcons', () => {

		suite('Support On', () => {

			test('appendText', () => {
				const mds = new MarkdownString(undefined, { supportThemeIcons: true });
				mds.appendText('$(zap) $(not a theme icon) $(add)');

				assert.equal(mds.value, '\\\\$\\(zap\\) $\\(not a theme icon\\) \\\\$\\(add\\)');
			});

			test('appendMarkdown', () => {
				const mds = new MarkdownString(undefined, { supportThemeIcons: true });
				mds.appendMarkdown('$(zap) $(not a theme icon) $(add)');

				assert.equal(mds.value, '$(zap) $(not a theme icon) $(add)');
			});

			test('appendMarkdown with escaped icon', () => {
				const mds = new MarkdownString(undefined, { supportThemeIcons: true });
				mds.appendMarkdown('\\$(zap) $(not a theme icon) $(add)');

				assert.equal(mds.value, '\\$(zap) $(not a theme icon) $(add)');
			});

		});

		suite('Support Off', () => {

			test('appendText', () => {
				const mds = new MarkdownString(undefined, { supportThemeIcons: false });
				mds.appendText('$(zap) $(not a theme icon) $(add)');

				assert.equal(mds.value, '$\\(zap\\) $\\(not a theme icon\\) $\\(add\\)');
			});

			test('appendMarkdown', () => {
				const mds = new MarkdownString(undefined, { supportThemeIcons: false });
				mds.appendMarkdown('$(zap) $(not a theme icon) $(add)');

				assert.equal(mds.value, '$(zap) $(not a theme icon) $(add)');
			});

			test('appendMarkdown with escaped icon', () => {
				const mds = new MarkdownString(undefined, { supportThemeIcons: true });
				mds.appendMarkdown('\\$(zap) $(not a theme icon) $(add)');

				assert.equal(mds.value, '\\$(zap) $(not a theme icon) $(add)');
			});

		});

	});
});
