/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { workbenchInstantiationService } from 'vs/workbench/test/browser/workbenchTestServices';
import { LinkDetector } from 'vs/workbench/contrib/debug/browser/linkDetector';
import { isWindows } from 'vs/base/common/platform';
import { WorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { URI } from 'vs/base/common/uri';

suite('Debug - Link Detector', () => {

	let linkDetector: LinkDetector;

	/**
	 * Instantiate a {@link LinkDetector} for use by the functions being tested.
	 */
	setup(() => {
		const instantiationService: TestInstantiationService = <TestInstantiationService>workbenchInstantiationService();
		linkDetector = instantiationService.createInstance(LinkDetector);
	});

	/**
	 * Assert that a given Element is an anchor element.
	 *
	 * @param element The Element to verify.
	 */
	function assertElementIsLink(element: Element) {
		assert(element instanceof HTMLAnchorElement);
	}

	test('noLinks', () => {
		const input = 'I am a string';
		const expectedOutput = '<span>I am a string</span>';
		const output = linkDetector.linkify(input);

		assert.equal(0, output.children.length);
		assert.equal('SPAN', output.tagName);
		assert.equal(expectedOutput, output.outerHTML);
	});

	test('trailingNewline', () => {
		const input = 'I am a string\n';
		const expectedOutput = '<span>I am a string\n</span>';
		const output = linkDetector.linkify(input);

		assert.equal(0, output.children.length);
		assert.equal('SPAN', output.tagName);
		assert.equal(expectedOutput, output.outerHTML);
	});

	test('trailingNewlineSplit', () => {
		const input = 'I am a string\n';
		const expectedOutput = '<span>I am a string\n</span>';
		const output = linkDetector.linkify(input, true);

		assert.equal(0, output.children.length);
		assert.equal('SPAN', output.tagName);
		assert.equal(expectedOutput, output.outerHTML);
	});

	test('singleLineLink', () => {
		const input = isWindows ? 'C:\\foo\\bar.js:12:34' : '/Users/foo/bar.js:12:34';
		const expectedOutput = isWindows ? '<span><a>C:\\foo\\bar.js:12:34<\/a><\/span>' : '<span><a>/Users/foo/bar.js:12:34<\/a><\/span>';
		const output = linkDetector.linkify(input);

		assert.equal(1, output.children.length);
		assert.equal('SPAN', output.tagName);
		assert.equal('A', output.firstElementChild!.tagName);
		assert.equal(expectedOutput, output.outerHTML);
		assertElementIsLink(output.firstElementChild!);
		assert.equal(isWindows ? 'C:\\foo\\bar.js:12:34' : '/Users/foo/bar.js:12:34', output.firstElementChild!.textContent);
	});

	test('relativeLink', () => {
		const input = '\./foo/bar.js';
		const expectedOutput = '<span>\./foo/bar.js</span>';
		const output = linkDetector.linkify(input);

		assert.equal(0, output.children.length);
		assert.equal('SPAN', output.tagName);
		assert.equal(expectedOutput, output.outerHTML);
	});

	test('relativeLinkWithWorkspace', () => {
		const input = '\./foo/bar.js';
		const expectedOutput = /^<span><a class="link" title=".*">\.\/foo\/bar\.js<\/a><\/span>$/;
		const output = linkDetector.linkify(input, false, new WorkspaceFolder({ uri: URI.file('/path/to/workspace'), name: 'ws', index: 0 }));

		assert.equal('SPAN', output.tagName);
		assert(expectedOutput.test(output.outerHTML));
	});

	test('singleLineLinkAndText', function () {
		const input = isWindows ? 'The link: C:/foo/bar.js:12:34' : 'The link: /Users/foo/bar.js:12:34';
		const expectedOutput = /^<span>The link: <a>.*\/foo\/bar.js:12:34<\/a><\/span>$/;
		const output = linkDetector.linkify(input);

		assert.equal(1, output.children.length);
		assert.equal('SPAN', output.tagName);
		assert.equal('A', output.children[0].tagName);
		assert(expectedOutput.test(output.outerHTML));
		assertElementIsLink(output.children[0]);
		assert.equal(isWindows ? 'C:/foo/bar.js:12:34' : '/Users/foo/bar.js:12:34', output.children[0].textContent);
	});

	test('singleLineMultipleLinks', () => {
		const input = isWindows ? 'Here is a link C:/foo/bar.js:12:34 and here is another D:/boo/far.js:56:78' :
			'Here is a link /Users/foo/bar.js:12:34 and here is another /Users/boo/far.js:56:78';
		const expectedOutput = /^<span>Here is a link <a>.*\/foo\/bar.js:12:34<\/a> and here is another <a>.*\/boo\/far.js:56:78<\/a><\/span>$/;
		const output = linkDetector.linkify(input);

		assert.equal(2, output.children.length);
		assert.equal('SPAN', output.tagName);
		assert.equal('A', output.children[0].tagName);
		assert.equal('A', output.children[1].tagName);
		assert(expectedOutput.test(output.outerHTML));
		assertElementIsLink(output.children[0]);
		assertElementIsLink(output.children[1]);
		assert.equal(isWindows ? 'C:/foo/bar.js:12:34' : '/Users/foo/bar.js:12:34', output.children[0].textContent);
		assert.equal(isWindows ? 'D:/boo/far.js:56:78' : '/Users/boo/far.js:56:78', output.children[1].textContent);
	});

	test('multilineNoLinks', () => {
		const input = 'Line one\nLine two\nLine three';
		const expectedOutput = /^<span><span>Line one\n<\/span><span>Line two\n<\/span><span>Line three<\/span><\/span>$/;
		const output = linkDetector.linkify(input, true);

		assert.equal(3, output.children.length);
		assert.equal('SPAN', output.tagName);
		assert.equal('SPAN', output.children[0].tagName);
		assert.equal('SPAN', output.children[1].tagName);
		assert.equal('SPAN', output.children[2].tagName);
		assert(expectedOutput.test(output.outerHTML));
	});

	test('multilineTrailingNewline', () => {
		const input = 'I am a string\nAnd I am another\n';
		const expectedOutput = '<span><span>I am a string\n<\/span><span>And I am another\n<\/span><\/span>';
		const output = linkDetector.linkify(input, true);

		assert.equal(2, output.children.length);
		assert.equal('SPAN', output.tagName);
		assert.equal('SPAN', output.children[0].tagName);
		assert.equal('SPAN', output.children[1].tagName);
		assert.equal(expectedOutput, output.outerHTML);
	});

	test('multilineWithLinks', () => {
		const input = isWindows ? 'I have a link for you\nHere it is: C:/foo/bar.js:12:34\nCool, huh?' :
			'I have a link for you\nHere it is: /Users/foo/bar.js:12:34\nCool, huh?';
		const expectedOutput = /^<span><span>I have a link for you\n<\/span><span>Here it is: <a>.*\/foo\/bar.js:12:34<\/a>\n<\/span><span>Cool, huh\?<\/span><\/span>$/;
		const output = linkDetector.linkify(input, true);

		assert.equal(3, output.children.length);
		assert.equal('SPAN', output.tagName);
		assert.equal('SPAN', output.children[0].tagName);
		assert.equal('SPAN', output.children[1].tagName);
		assert.equal('SPAN', output.children[2].tagName);
		assert.equal('A', output.children[1].children[0].tagName);
		assert(expectedOutput.test(output.outerHTML));
		assertElementIsLink(output.children[1].children[0]);
		assert.equal(isWindows ? 'C:/foo/bar.js:12:34' : '/Users/foo/bar.js:12:34', output.children[1].children[0].textContent);
	});
});
