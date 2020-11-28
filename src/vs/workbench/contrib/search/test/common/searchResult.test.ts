/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import * as sinon from 'sinon';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { Match, FileMatch, SearchResult, SearchModel } from 'vs/workbench/contrib/search/common/searchModel';
import { URI } from 'vs/base/common/uri';
import { IFileMatch, TextSearchMatch, OneLineRange, ITextSearchMatch } from 'vs/workbench/services/search/common/search';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { Range } from 'vs/editor/common/core/range';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { ModelServiceImpl } from 'vs/editor/common/services/modelServiceImpl';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IReplaceService } from 'vs/workbench/contrib/search/common/replace';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { UriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentityService';
import { FileService } from 'vs/platform/files/common/fileService';
import { NullLogService } from 'vs/platform/log/common/log';

const lineOneRange = new OneLineRange(1, 0, 1);

suite('SearchResult', () => {

	let instantiationService: TestInstantiationService;

	setup(() => {
		instantiationService = new TestInstantiationService();
		instantiationService.stub(ITelemetryService, NullTelemetryService);
		instantiationService.stub(IModelService, stubModelService(instantiationService));
		instantiationService.stub(IUriIdentityService, new UriIdentityService(new FileService(new NullLogService())));
		instantiationService.stubPromise(IReplaceService, {});
		instantiationService.stubPromise(IReplaceService, 'replace', null);
	});

	test('Line Match', function () {
		const fileMatch = aFileMatch('folder/file.txt', null!);
		const lineMatch = new Match(fileMatch, ['0 foo bar'], new OneLineRange(0, 2, 5), new OneLineRange(1, 0, 5));
		assert.equal(lineMatch.text(), '0 foo bar');
		assert.equal(lineMatch.range().startLineNumber, 2);
		assert.equal(lineMatch.range().endLineNumber, 2);
		assert.equal(lineMatch.range().startColumn, 1);
		assert.equal(lineMatch.range().endColumn, 6);
		assert.equal(lineMatch.id(), 'file:///folder/file.txt>[2,1 -> 2,6]foo');

		assert.equal(lineMatch.fullMatchText(), 'foo');
		assert.equal(lineMatch.fullMatchText(true), '0 foo bar');
	});

	test('Line Match - Remove', function () {
		const fileMatch = aFileMatch('folder/file.txt', aSearchResult(), new TextSearchMatch('foo bar', new OneLineRange(1, 0, 3)));
		const lineMatch = fileMatch.matches()[0];
		fileMatch.remove(lineMatch);
		assert.equal(fileMatch.matches().length, 0);
	});

	test('File Match', function () {
		let fileMatch = aFileMatch('folder/file.txt');
		assert.equal(fileMatch.matches(), 0);
		assert.equal(fileMatch.resource.toString(), 'file:///folder/file.txt');
		assert.equal(fileMatch.name(), 'file.txt');

		fileMatch = aFileMatch('file.txt');
		assert.equal(fileMatch.matches(), 0);
		assert.equal(fileMatch.resource.toString(), 'file:///file.txt');
		assert.equal(fileMatch.name(), 'file.txt');
	});

	test('File Match: Select an existing match', function () {
		const testObject = aFileMatch(
			'folder/file.txt',
			aSearchResult(),
			new TextSearchMatch('foo', new OneLineRange(1, 0, 3)),
			new TextSearchMatch('bar', new OneLineRange(1, 5, 3)));

		testObject.setSelectedMatch(testObject.matches()[0]);

		assert.equal(testObject.matches()[0], testObject.getSelectedMatch());
	});

	test('File Match: Select non existing match', function () {
		const testObject = aFileMatch(
			'folder/file.txt',
			aSearchResult(),
			new TextSearchMatch('foo', new OneLineRange(1, 0, 3)),
			new TextSearchMatch('bar', new OneLineRange(1, 5, 3)));
		const target = testObject.matches()[0];
		testObject.remove(target);

		testObject.setSelectedMatch(target);

		assert.equal(undefined, testObject.getSelectedMatch());
	});

	test('File Match: isSelected return true for selected match', function () {
		const testObject = aFileMatch(
			'folder/file.txt',
			aSearchResult(),
			new TextSearchMatch('foo', new OneLineRange(1, 0, 3)),
			new TextSearchMatch('bar', new OneLineRange(1, 5, 3)));
		const target = testObject.matches()[0];
		testObject.setSelectedMatch(target);

		assert.ok(testObject.isMatchSelected(target));
	});

	test('File Match: isSelected return false for un-selected match', function () {
		const testObject = aFileMatch('folder/file.txt',
			aSearchResult(),
			new TextSearchMatch('foo', new OneLineRange(1, 0, 3)),
			new TextSearchMatch('bar', new OneLineRange(1, 5, 3)));
		testObject.setSelectedMatch(testObject.matches()[0]);
		assert.ok(!testObject.isMatchSelected(testObject.matches()[1]));
	});

	test('File Match: unselect', function () {
		const testObject = aFileMatch(
			'folder/file.txt',
			aSearchResult(),
			new TextSearchMatch('foo', new OneLineRange(1, 0, 3)),
			new TextSearchMatch('bar', new OneLineRange(1, 5, 3)));
		testObject.setSelectedMatch(testObject.matches()[0]);
		testObject.setSelectedMatch(null);

		assert.equal(null, testObject.getSelectedMatch());
	});

	test('File Match: unselect when not selected', function () {
		const testObject = aFileMatch(
			'folder/file.txt',
			aSearchResult(),
			new TextSearchMatch('foo', new OneLineRange(1, 0, 3)),
			new TextSearchMatch('bar', new OneLineRange(1, 5, 3)));
		testObject.setSelectedMatch(null);

		assert.equal(null, testObject.getSelectedMatch());
	});

	test('Alle Drei Zusammen', function () {
		const searchResult = instantiationService.createInstance(SearchResult, null);
		const fileMatch = aFileMatch('far/boo', searchResult);
		const lineMatch = new Match(fileMatch, ['foo bar'], new OneLineRange(0, 0, 3), new OneLineRange(1, 0, 3));

		assert(lineMatch.parent() === fileMatch);
		assert(fileMatch.parent() === searchResult);
	});

	test('Adding a raw match will add a file match with line matches', function () {
		const testObject = aSearchResult();
		const target = [aRawMatch('file://c:/',
			new TextSearchMatch('preview 1', new OneLineRange(1, 1, 4)),
			new TextSearchMatch('preview 1', new OneLineRange(1, 4, 11)),
			new TextSearchMatch('preview 2', lineOneRange))];

		testObject.add(target);

		assert.equal(3, testObject.count());

		const actual = testObject.matches();
		assert.equal(1, actual.length);
		assert.equal('file://c:/', actual[0].resource.toString());

		const actuaMatches = actual[0].matches();
		assert.equal(3, actuaMatches.length);

		assert.equal('preview 1', actuaMatches[0].text());
		assert.ok(new Range(2, 2, 2, 5).equalsRange(actuaMatches[0].range()));

		assert.equal('preview 1', actuaMatches[1].text());
		assert.ok(new Range(2, 5, 2, 12).equalsRange(actuaMatches[1].range()));

		assert.equal('preview 2', actuaMatches[2].text());
		assert.ok(new Range(2, 1, 2, 2).equalsRange(actuaMatches[2].range()));
	});

	test('Adding multiple raw matches', function () {
		const testObject = aSearchResult();
		const target = [
			aRawMatch('file://c:/1',
				new TextSearchMatch('preview 1', new OneLineRange(1, 1, 4)),
				new TextSearchMatch('preview 1', new OneLineRange(1, 4, 11))),
			aRawMatch('file://c:/2',
				new TextSearchMatch('preview 2', lineOneRange))];

		testObject.add(target);

		assert.equal(3, testObject.count());

		const actual = testObject.matches();
		assert.equal(2, actual.length);
		assert.equal('file://c:/1', actual[0].resource.toString());

		let actuaMatches = actual[0].matches();
		assert.equal(2, actuaMatches.length);
		assert.equal('preview 1', actuaMatches[0].text());
		assert.ok(new Range(2, 2, 2, 5).equalsRange(actuaMatches[0].range()));
		assert.equal('preview 1', actuaMatches[1].text());
		assert.ok(new Range(2, 5, 2, 12).equalsRange(actuaMatches[1].range()));

		actuaMatches = actual[1].matches();
		assert.equal(1, actuaMatches.length);
		assert.equal('preview 2', actuaMatches[0].text());
		assert.ok(new Range(2, 1, 2, 2).equalsRange(actuaMatches[0].range()));
	});

	test('Dispose disposes matches', function () {
		const target1 = sinon.spy();
		const target2 = sinon.spy();

		const testObject = aSearchResult();
		testObject.add([
			aRawMatch('file://c:/1',
				new TextSearchMatch('preview 1', lineOneRange)),
			aRawMatch('file://c:/2',
				new TextSearchMatch('preview 2', lineOneRange))]);

		testObject.matches()[0].onDispose(target1);
		testObject.matches()[1].onDispose(target2);

		testObject.dispose();

		assert.ok(testObject.isEmpty());
		assert.ok(target1.calledOnce);
		assert.ok(target2.calledOnce);
	});

	test('remove triggers change event', function () {
		const target = sinon.spy();
		const testObject = aSearchResult();
		testObject.add([
			aRawMatch('file://c:/1',
				new TextSearchMatch('preview 1', lineOneRange))]);
		const objectToRemove = testObject.matches()[0];
		testObject.onChange(target);

		testObject.remove(objectToRemove);

		assert.ok(target.calledOnce);
		assert.deepEqual([{ elements: [objectToRemove], removed: true }], target.args[0]);
	});

	test('remove array triggers change event', function () {
		const target = sinon.spy();
		const testObject = aSearchResult();
		testObject.add([
			aRawMatch('file://c:/1',
				new TextSearchMatch('preview 1', lineOneRange)),
			aRawMatch('file://c:/2',
				new TextSearchMatch('preview 2', lineOneRange))]);
		const arrayToRemove = testObject.matches();
		testObject.onChange(target);

		testObject.remove(arrayToRemove);

		assert.ok(target.calledOnce);
		assert.deepEqual([{ elements: arrayToRemove, removed: true }], target.args[0]);
	});

	test('remove triggers change event', function () {
		const target = sinon.spy();
		const testObject = aSearchResult();
		testObject.add([
			aRawMatch('file://c:/1',
				new TextSearchMatch('preview 1', lineOneRange))]);
		const objectToRemove = testObject.matches()[0];
		testObject.onChange(target);

		testObject.remove(objectToRemove);

		assert.ok(target.calledOnce);
		assert.deepEqual([{ elements: [objectToRemove], removed: true }], target.args[0]);
	});

	test('Removing all line matches and adding back will add file back to result', function () {
		const testObject = aSearchResult();
		testObject.add([
			aRawMatch('file://c:/1',
				new TextSearchMatch('preview 1', lineOneRange))]);
		const target = testObject.matches()[0];
		const matchToRemove = target.matches()[0];
		target.remove(matchToRemove);

		assert.ok(testObject.isEmpty());
		target.add(matchToRemove, true);

		assert.equal(1, testObject.fileCount());
		assert.equal(target, testObject.matches()[0]);
	});

	test('replace should remove the file match', function () {
		const voidPromise = Promise.resolve(null);
		instantiationService.stub(IReplaceService, 'replace', voidPromise);
		const testObject = aSearchResult();
		testObject.add([
			aRawMatch('file://c:/1',
				new TextSearchMatch('preview 1', lineOneRange))]);

		testObject.replace(testObject.matches()[0]);

		return voidPromise.then(() => assert.ok(testObject.isEmpty()));
	});

	test('replace should trigger the change event', function () {
		const target = sinon.spy();
		const voidPromise = Promise.resolve(null);
		instantiationService.stub(IReplaceService, 'replace', voidPromise);
		const testObject = aSearchResult();
		testObject.add([
			aRawMatch('file://c:/1',
				new TextSearchMatch('preview 1', lineOneRange))]);
		testObject.onChange(target);
		const objectToRemove = testObject.matches()[0];

		testObject.replace(objectToRemove);

		return voidPromise.then(() => {
			assert.ok(target.calledOnce);
			assert.deepEqual([{ elements: [objectToRemove], removed: true }], target.args[0]);
		});
	});

	test('replaceAll should remove all file matches', function () {
		const voidPromise = Promise.resolve(null);
		instantiationService.stubPromise(IReplaceService, 'replace', voidPromise);
		const testObject = aSearchResult();
		testObject.add([
			aRawMatch('file://c:/1',
				new TextSearchMatch('preview 1', lineOneRange)),
			aRawMatch('file://c:/2',
				new TextSearchMatch('preview 2', lineOneRange))]);

		testObject.replaceAll(null!);

		return voidPromise.then(() => assert.ok(testObject.isEmpty()));
	});

	function aFileMatch(path: string, searchResult?: SearchResult, ...lineMatches: ITextSearchMatch[]): FileMatch {
		const rawMatch: IFileMatch = {
			resource: URI.file('/' + path),
			results: lineMatches
		};
		return instantiationService.createInstance(FileMatch, null, null, null, searchResult, rawMatch);
	}

	function aSearchResult(): SearchResult {
		const searchModel = instantiationService.createInstance(SearchModel);
		searchModel.searchResult.query = { type: 1, folderQueries: [{ folder: URI.parse('file://c:/') }] };
		return searchModel.searchResult;
	}

	function aRawMatch(resource: string, ...results: ITextSearchMatch[]): IFileMatch {
		return { resource: URI.parse(resource), results };
	}

	function stubModelService(instantiationService: TestInstantiationService): IModelService {
		instantiationService.stub(IConfigurationService, new TestConfigurationService());
		instantiationService.stub(IThemeService, new TestThemeService());
		return instantiationService.createInstance(ModelServiceImpl);
	}
});
