/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as vscode from 'vscode';

import MarkdownSmartSelect from '../features/smartSelect';
import { InMemoryDocument } from './inMemoryDocument';
import { createNewMarkdownEngine } from './engine';
import { joinLines } from './util';
const CURSOR = '$$CURSOR$$';

const testFileName = vscode.Uri.file('test.md');

suite('markdown.SmartSelect', () => {
	test('Smart select single word', async () => {
		const ranges = await getSelectionRangesForDocument(`Hel${CURSOR}lo`);
		assertNestedLineNumbersEqual(ranges![0], [0, 0]);
	});
	test('Smart select multi-line paragraph', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`Many of the core components and extensions to ${CURSOR}VS Code live in their own repositories on GitHub. `,
				`For example, the[node debug adapter](https://github.com/microsoft/vscode-node-debug) and the [mono debug adapter]`,
				`(https://github.com/microsoft/vscode-mono-debug) have their own repositories. For a complete list, please visit the [Related Projects](https://github.com/microsoft/vscode/wiki/Related-Projects) page on our [wiki](https://github.com/microsoft/vscode/wiki).`
			));
		assertNestedLineNumbersEqual(ranges![0], [0, 2]);
	});
	test('Smart select paragraph', async () => {
		const ranges = await getSelectionRangesForDocument(`Many of the core components and extensions to ${CURSOR}VS Code live in their own repositories on GitHub. For example, the [node debug adapter](https://github.com/microsoft/vscode-node-debug) and the [mono debug adapter](https://github.com/microsoft/vscode-mono-debug) have their own repositories. For a complete list, please visit the [Related Projects](https://github.com/microsoft/vscode/wiki/Related-Projects) page on our [wiki](https://github.com/microsoft/vscode/wiki).`);

		assertNestedLineNumbersEqual(ranges![0], [0, 0]);
	});
	test('Smart select html block', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`<p align="center">`,
				`${CURSOR}<img alt="VS Code in action" src="https://user-images.githubusercontent.com/1487073/58344409-70473b80-7e0a-11e9-8570-b2efc6f8fa44.png">`,
				`</p>`));

		assertNestedLineNumbersEqual(ranges![0], [0, 2]);
	});
	test('Smart select header on header line', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# Header${CURSOR}`,
				`Hello`));

		assertNestedLineNumbersEqual(ranges![0], [0, 1]);

	});
	test('Smart select single word w grandparent header on text line', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`## ParentHeader`,
				`# Header`,
				`${CURSOR}Hello`
			));

		assertNestedLineNumbersEqual(ranges![0], [2, 2], [1, 2]);
	});
	test('Smart select html block w parent header', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# Header`,
				`${CURSOR}<p align="center">`,
				`<img alt="VS Code in action" src="https://user-images.githubusercontent.com/1487073/58344409-70473b80-7e0a-11e9-8570-b2efc6f8fa44.png">`,
				`</p>`));

		assertNestedLineNumbersEqual(ranges![0], [1, 1], [1, 3], [0, 3]);
	});
	test('Smart select fenced code block', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`~~~`,
				`a${CURSOR}`,
				`~~~`));

		assertNestedLineNumbersEqual(ranges![0], [0, 2]);
	});
	test('Smart select list', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`- item 1`,
				`- ${CURSOR}item 2`,
				`- item 3`,
				`- item 4`));
		assertNestedLineNumbersEqual(ranges![0], [1, 1], [0, 3]);
	});
	test('Smart select list with fenced code block', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`- item 1`,
				`- ~~~`,
				`  ${CURSOR}a`,
				`  ~~~`,
				`- item 3`,
				`- item 4`));

		assertNestedLineNumbersEqual(ranges![0], [1, 3], [0, 5]);
	});
	test('Smart select multi cursor', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`- ${CURSOR}item 1`,
				`- ~~~`,
				`  a`,
				`  ~~~`,
				`- ${CURSOR}item 3`,
				`- item 4`));

		assertNestedLineNumbersEqual(ranges![0], [0, 0], [0, 5]);
		assertNestedLineNumbersEqual(ranges![1], [4, 4], [0, 5]);
	});
	test('Smart select nested block quotes', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`> item 1`,
				`> item 2`,
				`>> ${CURSOR}item 3`,
				`>> item 4`));
		assertNestedLineNumbersEqual(ranges![0], [2, 2], [2, 3], [0, 3]);
	});
	test('Smart select multi nested block quotes', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`> item 1`,
				`>> item 2`,
				`>>> ${CURSOR}item 3`,
				`>>>> item 4`));
		assertNestedLineNumbersEqual(ranges![0], [2, 2], [2, 3], [1, 3], [0, 3]);
	});
	test('Smart select subheader content', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main header 1`,
				`content 1`,
				`## sub header 1`,
				`${CURSOR}content 2`,
				`# main header 2`));

		assertNestedLineNumbersEqual(ranges![0], [3, 3], [2, 3], [1, 3], [0, 3]);
	});
	test('Smart select subheader line', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main header 1`,
				`content 1`,
				`## sub header 1${CURSOR}`,
				`content 2`,
				`# main header 2`));

		assertNestedLineNumbersEqual(ranges![0], [2, 3], [1, 3], [0, 3]);
	});
	test('Smart select blank line', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main header 1`,
				`content 1`,
				`${CURSOR}             `,
				`content 2`,
				`# main header 2`));

		assertNestedLineNumbersEqual(ranges![0], [1, 3], [0, 3]);
	});
	test('Smart select line between paragraphs', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`paragraph 1`,
				`${CURSOR}`,
				`paragraph 2`));

		assertNestedLineNumbersEqual(ranges![0], [0, 2]);
	});
	test('Smart select empty document', async () => {
		const ranges = await getSelectionRangesForDocument(``, [new vscode.Position(0, 0)]);
		assert.strictEqual(ranges!.length, 0);
	});
	test('Smart select fenced code block then list then subheader content then subheader then header content then header', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main header 1`,
				`content 1`,
				`## sub header 1`,
				`- item 1`,
				`- ~~~`,
				`  ${CURSOR}a`,
				`  ~~~`,
				`- item 3`,
				`- item 4`,
				``,
				`more content`,
				`# main header 2`));

		assertNestedLineNumbersEqual(ranges![0], [4, 6], [3, 9], [3, 10], [2, 10], [1, 10], [0, 10]);
	});
	test('Smart select list with one element without selecting child subheader', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main header 1`,
				``,
				`- list ${CURSOR}`,
				``,
				`## sub header`,
				``,
				`content 2`,
				`# main header 2`));
		assertNestedLineNumbersEqual(ranges![0], [2, 2], [2, 3], [1, 3], [1, 6], [0, 6]);
	});
	test('Smart select content under header then subheaders and their content', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main ${CURSOR}header 1`,
				``,
				`- list`,
				`paragraph`,
				`## sub header`,
				``,
				`content 2`,
				`# main header 2`));

		assertNestedLineNumbersEqual(ranges![0], [0, 3], [0, 6]);
	});
	test('Smart select last blockquote element under header then subheaders and their content', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main header 1`,
				``,
				`> block`,
				`> block`,
				`>> block`,
				`>> ${CURSOR}block`,
				``,
				`paragraph`,
				`## sub header`,
				``,
				`content 2`,
				`# main header 2`));

		assertNestedLineNumbersEqual(ranges![0], [5, 5], [4, 5], [2, 5], [1, 7], [1, 10], [0, 10]);
	});
	test('Smart select content of subheader then subheader then content of main header then main header', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main header 1`,
				``,
				`> block`,
				`> block`,
				`>> block`,
				`>> block`,
				``,
				`paragraph`,
				`## sub header`,
				``,
				``,
				`${CURSOR}`,
				``,
				`### main header 2`,
				`- content 2`,
				`- content 2`,
				`- content 2`,
				`content 2`));

		assertNestedLineNumbersEqual(ranges![0], [11, 11], [9, 12], [9, 17], [8, 17], [1, 17], [0, 17]);
	});
	test('Smart select last line content of subheader then subheader then content of main header then main header', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main header 1`,
				``,
				`> block`,
				`> block`,
				`>> block`,
				`>> block`,
				``,
				`paragraph`,
				`## sub header`,
				``,
				``,
				``,
				``,
				`### main header 2`,
				`- content 2`,
				`- content 2`,
				`- content 2`,
				`- ${CURSOR}content 2`));

		assertNestedLineNumbersEqual(ranges![0], [17, 17], [14, 17], [13, 17], [9, 17], [8, 17], [1, 17], [0, 17]);
	});
	test('Smart select last line content after content of subheader then subheader then content of main header then main header', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main header 1`,
				``,
				`> block`,
				`> block`,
				`>> block`,
				`>> block`,
				``,
				`paragraph`,
				`## sub header`,
				``,
				``,
				``,
				``,
				`### main header 2`,
				`- content 2`,
				`- content 2`,
				`- content 2`,
				`- content 2${CURSOR}`));

		assertNestedLineNumbersEqual(ranges![0], [17, 17], [14, 17], [13, 17], [9, 17], [8, 17], [1, 17], [0, 17]);
	});
	test('Smart select fenced code block then list then rest of content', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main header 1`,
				``,
				`> block`,
				`> block`,
				`>> block`,
				`>> block`,
				``,
				`- paragraph`,
				`- ~~~`,
				`  my`,
				`  ${CURSOR}code`,
				`  goes here`,
				`  ~~~`,
				`- content`,
				`- content 2`,
				`- content 2`,
				`- content 2`,
				`- content 2`));

		assertNestedLineNumbersEqual(ranges![0], [9, 11], [8, 12], [8, 12], [7, 17], [1, 17], [0, 17]);
	});
	test('Smart select fenced code block then list then rest of content on fenced line', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main header 1`,
				``,
				`> block`,
				`> block`,
				`>> block`,
				`>> block`,
				``,
				`- paragraph`,
				`- ~~~${CURSOR}`,
				`  my`,
				`  code`,
				`  goes here`,
				`  ~~~`,
				`- content`,
				`- content 2`,
				`- content 2`,
				`- content 2`,
				`- content 2`));

		assertNestedLineNumbersEqual(ranges![0], [8, 12], [7, 17], [1, 17], [0, 17]);
	});
	test('Smart select without multiple ranges', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main header 1`,
				``,
				``,
				`- ${CURSOR}paragraph`,
				`- content`));

		assertNestedLineNumbersEqual(ranges![0], [3, 3], [3, 4], [1, 4], [0, 4]);
	});
	test('Smart select on second level of a list', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`* level 0`,
				`   * level 1`,
				`   * level 1`,
				`       * level 2`,
				`   * level 1`,
				`   * level ${CURSOR}1`,
				`* level 0`));

		assertNestedLineNumbersEqual(ranges![0], [5, 5], [1, 5], [0, 5], [0, 6]);
	});
	test('Smart select on third level of a list', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`* level 0`,
				`   * level 1`,
				`   * level 1`,
				`       * level ${CURSOR}2`,
				`       * level 2`,
				`   * level 1`,
				`   * level 1`,
				`* level 0`));
		assertNestedLineNumbersEqual(ranges![0], [3, 3], [3, 4], [2, 4], [1, 6], [0, 6], [0, 7]);
	});
	test('Smart select level 2 then level 1', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`* level 1`,
				`   * level ${CURSOR}2`,
				`   * level 2`,
				`* level 1`));
		assertNestedLineNumbersEqual(ranges![0], [1, 1], [1, 2], [0, 2], [0, 3]);
	});
	test('Smart select last list item', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`- level 1`,
				`- level 2`,
				`- level 2`,
				`- level ${CURSOR}1`));
		assertNestedLineNumbersEqual(ranges![0], [3, 3], [0, 3]);
	});
	test('Smart select without multiple ranges', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main header 1`,
				``,
				``,
				`- ${CURSOR}paragraph`,
				`- content`));

		assertNestedLineNumbersEqual(ranges![0], [3, 3], [3, 4], [1, 4], [0, 4]);
	});
	test('Smart select on second level of a list', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`* level 0`,
				`	* level 1`,
				`	* level 1`,
				`		* level 2`,
				`	* level 1`,
				`	* level ${CURSOR}1`,
				`* level 0`));

		assertNestedLineNumbersEqual(ranges![0], [5, 5], [1, 5], [0, 5], [0, 6]);
	});
	test('Smart select on third level of a list', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`* level 0`,
				`	* level 1`,
				`	* level 1`,
				`		* level ${CURSOR}2`,
				`		* level 2`,
				`	* level 1`,
				`	* level 1`,
				`* level 0`));
		assertNestedLineNumbersEqual(ranges![0], [3, 3], [3, 4], [2, 4], [1, 6], [0, 6], [0, 7]);
	});
	test('Smart select level 2 then level 1', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`* level 1`,
				`	* level ${CURSOR}2`,
				`	* level 2`,
				`* level 1`));
		assertNestedLineNumbersEqual(ranges![0], [1, 1], [1, 2], [0, 2], [0, 3]);
	});
	test('Smart select bold', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`stuff here **new${CURSOR}item** and here`
			));
		assertNestedRangesEqual(ranges![0], [0, 13, 0, 30], [0, 11, 0, 32], [0, 0, 0, 41]);
	});
	test('Smart select link', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`stuff here [text](https${CURSOR}://google.com) and here`
			));
		assertNestedRangesEqual(ranges![0], [0, 18, 0, 46], [0, 17, 0, 47], [0, 11, 0, 47], [0, 0, 0, 56]);
	});
	test('Smart select brackets', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`stuff here [te${CURSOR}xt](https://google.com) and here`
			));
		assertNestedRangesEqual(ranges![0], [0, 12, 0, 26], [0, 11, 0, 27], [0, 11, 0, 47], [0, 0, 0, 56]);
	});
	test('Smart select brackets under header in list', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main header 1`,
				``,
				`- list`,
				`paragraph`,
				`## sub header`,
				`- list`,
				`- stuff here [te${CURSOR}xt](https://google.com) and here`,
				`- list`
			));
		assertNestedRangesEqual(ranges![0], [6, 14, 6, 28], [6, 13, 6, 29], [6, 13, 6, 49], [6, 0, 6, 58], [5, 0, 7, 6], [4, 0, 7, 6], [1, 0, 7, 6], [0, 0, 7, 6]);
	});
	test('Smart select link under header in list', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main header 1`,
				``,
				`- list`,
				`paragraph`,
				`## sub header`,
				`- list`,
				`- stuff here [text](${CURSOR}https://google.com) and here`,
				`- list`
			));
		assertNestedRangesEqual(ranges![0], [6, 20, 6, 48], [6, 19, 6, 49], [6, 13, 6, 49], [6, 0, 6, 58], [5, 0, 7, 6], [4, 0, 7, 6], [1, 0, 7, 6], [0, 0, 7, 6]);
	});
	test('Smart select bold within list where multiple bold elements exists', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`# main header 1`,
				``,
				`- list`,
				`paragraph`,
				`## sub header`,
				`- list`,
				`- stuff here [text] **${CURSOR}items in here** and **here**`,
				`- list`
			));
		assertNestedRangesEqual(ranges![0], [6, 22, 6, 45], [6, 20, 6, 47], [6, 0, 6, 60], [5, 0, 7, 6], [4, 0, 7, 6], [1, 0, 7, 6], [0, 0, 7, 6]);
	});
	test('Smart select link in paragraph with multiple links', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`This[extension](https://marketplace.visualstudio.com/items?itemName=meganrogge.template-string-converter)  addresses this [requ${CURSOR}est](https://github.com/microsoft/vscode/issues/56704) to convert Javascript/Typescript quotes to backticks when has been entered within a string.`
			));
		assertNestedRangesEqual(ranges![0], [0, 123, 0, 140], [0, 122, 0, 141], [0, 122, 0, 191], [0, 0, 0, 283]);
	});
	test('Smart select bold link', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`**[extens${CURSOR}ion](https://google.com)**`
			));
		assertNestedRangesEqual(ranges![0], [0, 3, 0, 22], [0, 2, 0, 23], [0, 2, 0, 43], [0, 2, 0, 43], [0, 0, 0, 45], [0, 0, 0, 45]);
	});
	test('Smart select inline code block', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`[\`code ${CURSOR} link\`]`
			));
		assertNestedRangesEqual(ranges![0], [0, 2, 0, 22], [0, 1, 0, 23], [0, 0, 0, 24]);
	});
	test('Smart select link with inline code block text', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`[\`code ${CURSOR} link\`](http://example.com)`
			));
		assertNestedRangesEqual(ranges![0], [0, 2, 0, 22], [0, 1, 0, 23], [0, 1, 0, 23], [0, 0, 0, 24], [0, 0, 0, 44], [0, 0, 0, 44]);
	});
	test('Smart select italic', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`*some nice ${CURSOR}text*`
			));
		assertNestedRangesEqual(ranges![0], [0, 1, 0, 25], [0, 0, 0, 26], [0, 0, 0, 26]);
	});
	test('Smart select italic link', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`*[extens${CURSOR}ion](https://google.com)*`
			));
		assertNestedRangesEqual(ranges![0], [0, 2, 0, 21], [0, 1, 0, 22], [0, 1, 0, 42], [0, 1, 0, 42], [0, 0, 0, 43], [0, 0, 0, 43]);
	});
	test('Smart select italic on end', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`*word1 word2 word3${CURSOR}*`
			));
		assertNestedRangesEqual(ranges![0], [0, 1, 0, 28], [0, 0, 0, 29], [0, 0, 0, 29]);
	});
	test('Smart select italic then bold', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`outer text **bold words *italic ${CURSOR} words* bold words** outer text`
			));
		assertNestedRangesEqual(ranges![0], [0, 25, 0, 48], [0, 24, 0, 49], [0, 13, 0, 60], [0, 11, 0, 62], [0, 0, 0, 73]);
	});
	test('Smart select bold then italic', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`outer text *italic words **bold ${CURSOR} words** italic words* outer text`
			));
		assertNestedRangesEqual(ranges![0], [0, 27, 0, 48], [0, 25, 0, 50], [0, 12, 0, 63], [0, 11, 0, 64], [0, 0, 0, 75]);
	});
	test('Third level header from release notes', async () => {
		const ranges = await getSelectionRangesForDocument(
			joinLines(
				`---`,
				`Order: 60`,
				`TOCTitle: October 2020`,
				`PageTitle: Visual Studio Code October 2020`,
				`MetaDescription: Learn what is new in the Visual Studio Code October 2020 Release (1.51)`,
				`MetaSocialImage: 1_51/release-highlights.png`,
				`Date: 2020-11-6`,
				`DownloadVersion: 1.51.1`,
				`---`,
				`# October 2020 (version 1.51)`,
				``,
				`**Update 1.51.1**: The update addresses these [issues](https://github.com/microsoft/vscode/issues?q=is%3Aissue+milestone%3A%22October+2020+Recovery%22+is%3Aclosed+).`,
				``,
				`<!-- DOWNLOAD_LINKS_PLACEHOLDER -->`,
				``,
				`---`,
				``,
				`Welcome to the October 2020 release of Visual Studio Code. As announced in the [October iteration plan](https://github.com/microsoft/vscode/issues/108473), we focused on housekeeping GitHub issues and pull requests as documented in our issue grooming guide.`,
				``,
				`We also worked with our partners at GitHub on GitHub Codespaces, which ended up being more involved than originally anticipated. To that end, we'll continue working on housekeeping for part of the November iteration.`,
				``,
				`During this housekeeping milestone, we also addressed several feature requests and community [pull requests](#thank-you). Read on to learn about new features and settings.`,
				``,
				`## Workbench`,
				``,
				`### More prominent pinned tabs`,
				``,
				`${CURSOR}Pinned tabs will now always show their pin icon, even while inactive, to make them easier to identify. If an editor is both pinned and contains unsaved changes, the icon reflects both states.`,
				``,
				`![Inactive pinned tabs showing pin icons](images/1_51/pinned-tabs.png)`
			)
		);
		assertNestedRangesEqual(ranges![0], [27, 0, 27, 201], [26, 0, 29, 70], [25, 0, 29, 70], [24, 0, 29, 70], [23, 0, 29, 70], [10, 0, 29, 70], [9, 0, 29, 70]);
	});
});

function assertNestedLineNumbersEqual(range: vscode.SelectionRange, ...expectedRanges: [number, number][]) {
	const lineage = getLineage(range);
	assert.strictEqual(lineage.length, expectedRanges.length, `expected depth: ${expectedRanges.length}, but was ${lineage.length} ${getValues(lineage)}`);
	for (let i = 0; i < lineage.length; i++) {
		assertLineNumbersEqual(lineage[i], expectedRanges[i][0], expectedRanges[i][1], `parent at a depth of ${i}`);
	}
}

function assertNestedRangesEqual(range: vscode.SelectionRange, ...expectedRanges: [number, number, number, number][]) {
	const lineage = getLineage(range);
	assert.strictEqual(lineage.length, expectedRanges.length, `expected depth: ${expectedRanges.length}, but was ${lineage.length} ${getValues(lineage)}`);
	for (let i = 0; i < lineage.length; i++) {
		assertLineNumbersEqual(lineage[i], expectedRanges[i][0], expectedRanges[i][2], `parent at a depth of ${i}`);
		assert(lineage[i].range.start.character === expectedRanges[i][1], `parent at a depth of ${i} on start char`);
		assert(lineage[i].range.end.character === expectedRanges[i][3], `parent at a depth of ${i} on end char`);
	}
}

function getLineage(range: vscode.SelectionRange): vscode.SelectionRange[] {
	const result: vscode.SelectionRange[] = [];
	let currentRange: vscode.SelectionRange | undefined = range;
	while (currentRange) {
		result.push(currentRange);
		currentRange = currentRange.parent;
	}
	return result;
}

function getValues(ranges: vscode.SelectionRange[]): string[] {
	return ranges.map(range => {
		return range.range.start.line + ' ' + range.range.start.character + ' ' + range.range.end.line + ' ' + range.range.end.character;
	});
}

function assertLineNumbersEqual(selectionRange: vscode.SelectionRange, startLine: number, endLine: number, message: string) {
	assert.strictEqual(selectionRange.range.start.line, startLine, `failed on start line ${message}`);
	assert.strictEqual(selectionRange.range.end.line, endLine, `failed on end line ${message}`);
}

async function getSelectionRangesForDocument(contents: string, pos?: vscode.Position[]) {
	const doc = new InMemoryDocument(testFileName, contents);
	const provider = new MarkdownSmartSelect(createNewMarkdownEngine());
	const positions = pos ? pos : getCursorPositions(contents, doc);
	return await provider.provideSelectionRanges(doc, positions, new vscode.CancellationTokenSource().token);
}

let getCursorPositions = (contents: string, doc: InMemoryDocument): vscode.Position[] => {
	let positions: vscode.Position[] = [];
	let index = 0;
	let wordLength = 0;
	while (index !== -1) {
		index = contents.indexOf(CURSOR, index + wordLength);
		if (index !== -1) {
			positions.push(doc.positionAt(index));
		}
		wordLength = CURSOR.length;
	}
	return positions;
};
