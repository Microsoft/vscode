/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { LanguagesRegistry } from 'vs/editor/common/services/languagesRegistry';

suite('LanguagesRegistry', () => {

	test('output mode does not have a name', () => {
		let registry = new LanguagesRegistry(false);

		registry._registerLanguages([{
			id: 'outputModeId',
			extensions: [],
			aliases: [],
			mimetypes: ['outputModeMimeType'],
		}]);

		assert.deepEqual(registry.getRegisteredLanguageNames(), []);
	});

	test('mode with alias does have a name', () => {
		let registry = new LanguagesRegistry(false);

		registry._registerLanguages([{
			id: 'modeId',
			extensions: [],
			aliases: ['ModeName'],
			mimetypes: ['bla'],
		}]);

		assert.deepEqual(registry.getRegisteredLanguageNames(), ['ModeName']);
		assert.deepEqual(registry.getLanguageName('modeId'), 'ModeName');
	});

	test('mode without alias gets a name', () => {
		let registry = new LanguagesRegistry(false);

		registry._registerLanguages([{
			id: 'modeId',
			extensions: [],
			mimetypes: ['bla'],
		}]);

		assert.deepEqual(registry.getRegisteredLanguageNames(), ['modeId']);
		assert.deepEqual(registry.getLanguageName('modeId'), 'modeId');
	});

	test('bug #4360: f# not shown in status bar', () => {
		let registry = new LanguagesRegistry(false);

		registry._registerLanguages([{
			id: 'modeId',
			extensions: ['.ext1'],
			aliases: ['ModeName'],
			mimetypes: ['bla'],
		}]);

		registry._registerLanguages([{
			id: 'modeId',
			extensions: ['.ext2'],
			aliases: [],
			mimetypes: ['bla'],
		}]);

		assert.deepEqual(registry.getRegisteredLanguageNames(), ['ModeName']);
		assert.deepEqual(registry.getLanguageName('modeId'), 'ModeName');
	});

	test('issue #5278: Extension cannot override language name anymore', () => {
		let registry = new LanguagesRegistry(false);

		registry._registerLanguages([{
			id: 'modeId',
			extensions: ['.ext1'],
			aliases: ['ModeName'],
			mimetypes: ['bla'],
		}]);

		registry._registerLanguages([{
			id: 'modeId',
			extensions: ['.ext2'],
			aliases: ['BetterModeName'],
			mimetypes: ['bla'],
		}]);

		assert.deepEqual(registry.getRegisteredLanguageNames(), ['BetterModeName']);
		assert.deepEqual(registry.getLanguageName('modeId'), 'BetterModeName');
	});

	test('mimetypes are generated if necessary', () => {
		let registry = new LanguagesRegistry(false);

		registry._registerLanguages([{
			id: 'modeId'
		}]);

		assert.deepEqual(registry.getMimeForMode('modeId'), 'text/x-modeId');
	});

	test('first mimetype wins', () => {
		let registry = new LanguagesRegistry(false);

		registry._registerLanguages([{
			id: 'modeId',
			mimetypes: ['text/modeId', 'text/modeId2']
		}]);

		assert.deepEqual(registry.getMimeForMode('modeId'), 'text/modeId');
	});

	test('first mimetype wins 2', () => {
		let registry = new LanguagesRegistry(false);

		registry._registerLanguages([{
			id: 'modeId'
		}]);

		registry._registerLanguages([{
			id: 'modeId',
			mimetypes: ['text/modeId']
		}]);

		assert.deepEqual(registry.getMimeForMode('modeId'), 'text/x-modeId');
	});

	test('aliases', () => {
		let registry = new LanguagesRegistry(false);

		registry._registerLanguages([{
			id: 'a'
		}]);

		assert.deepEqual(registry.getRegisteredLanguageNames(), ['a']);
		assert.deepEqual(registry.getModeIdsFromLanguageName('a'), ['a']);
		assert.deepEqual(registry.getModeIdForLanguageNameLowercase('a'), 'a');
		assert.deepEqual(registry.getLanguageName('a'), 'a');

		registry._registerLanguages([{
			id: 'a',
			aliases: ['A1', 'A2']
		}]);

		assert.deepEqual(registry.getRegisteredLanguageNames(), ['A1']);
		assert.deepEqual(registry.getModeIdsFromLanguageName('a'), []);
		assert.deepEqual(registry.getModeIdsFromLanguageName('A1'), ['a']);
		assert.deepEqual(registry.getModeIdsFromLanguageName('A2'), []);
		assert.deepEqual(registry.getModeIdForLanguageNameLowercase('a'), 'a');
		assert.deepEqual(registry.getModeIdForLanguageNameLowercase('a1'), 'a');
		assert.deepEqual(registry.getModeIdForLanguageNameLowercase('a2'), 'a');
		assert.deepEqual(registry.getLanguageName('a'), 'A1');

		registry._registerLanguages([{
			id: 'a',
			aliases: ['A3', 'A4']
		}]);

		assert.deepEqual(registry.getRegisteredLanguageNames(), ['A3']);
		assert.deepEqual(registry.getModeIdsFromLanguageName('a'), []);
		assert.deepEqual(registry.getModeIdsFromLanguageName('A1'), []);
		assert.deepEqual(registry.getModeIdsFromLanguageName('A2'), []);
		assert.deepEqual(registry.getModeIdsFromLanguageName('A3'), ['a']);
		assert.deepEqual(registry.getModeIdsFromLanguageName('A4'), []);
		assert.deepEqual(registry.getModeIdForLanguageNameLowercase('a'), 'a');
		assert.deepEqual(registry.getModeIdForLanguageNameLowercase('a1'), 'a');
		assert.deepEqual(registry.getModeIdForLanguageNameLowercase('a2'), 'a');
		assert.deepEqual(registry.getModeIdForLanguageNameLowercase('a3'), 'a');
		assert.deepEqual(registry.getModeIdForLanguageNameLowercase('a4'), 'a');
		assert.deepEqual(registry.getLanguageName('a'), 'A3');
	});

	test('empty aliases array means no alias', () => {
		let registry = new LanguagesRegistry(false);

		registry._registerLanguages([{
			id: 'a'
		}]);

		assert.deepEqual(registry.getRegisteredLanguageNames(), ['a']);
		assert.deepEqual(registry.getModeIdsFromLanguageName('a'), ['a']);
		assert.deepEqual(registry.getModeIdForLanguageNameLowercase('a'), 'a');
		assert.deepEqual(registry.getLanguageName('a'), 'a');

		registry._registerLanguages([{
			id: 'b',
			aliases: []
		}]);

		assert.deepEqual(registry.getRegisteredLanguageNames(), ['a']);
		assert.deepEqual(registry.getModeIdsFromLanguageName('a'), ['a']);
		assert.deepEqual(registry.getModeIdsFromLanguageName('b'), []);
		assert.deepEqual(registry.getModeIdForLanguageNameLowercase('a'), 'a');
		assert.deepEqual(registry.getModeIdForLanguageNameLowercase('b'), 'b');
		assert.deepEqual(registry.getLanguageName('a'), 'a');
		assert.deepEqual(registry.getLanguageName('b'), null);
	});

	test('extensions', () => {
		let registry = new LanguagesRegistry(false);

		registry._registerLanguages([{
			id: 'a',
			aliases: ['aName'],
			extensions: ['aExt']
		}]);

		assert.deepEqual(registry.getExtensions('a'), []);
		assert.deepEqual(registry.getExtensions('aname'), []);
		assert.deepEqual(registry.getExtensions('aName'), ['aExt']);

		registry._registerLanguages([{
			id: 'a',
			extensions: ['aExt2']
		}]);

		assert.deepEqual(registry.getExtensions('a'), []);
		assert.deepEqual(registry.getExtensions('aname'), []);
		assert.deepEqual(registry.getExtensions('aName'), ['aExt', 'aExt2']);
	});

	test('extensions of primary language registration come first', () => {
		let registry = new LanguagesRegistry(false);

		registry._registerLanguages([{
			id: 'a',
			extensions: ['aExt3']
		}]);

		assert.deepEqual(registry.getExtensions('a')[0], 'aExt3');

		registry._registerLanguages([{
			id: 'a',
			configuration: URI.file('conf.json'),
			extensions: ['aExt']
		}]);

		assert.deepEqual(registry.getExtensions('a')[0], 'aExt');

		registry._registerLanguages([{
			id: 'a',
			extensions: ['aExt2']
		}]);

		assert.deepEqual(registry.getExtensions('a')[0], 'aExt');
	});

	test('filenames', () => {
		let registry = new LanguagesRegistry(false);

		registry._registerLanguages([{
			id: 'a',
			aliases: ['aName'],
			filenames: ['aFilename']
		}]);

		assert.deepEqual(registry.getFilenames('a'), []);
		assert.deepEqual(registry.getFilenames('aname'), []);
		assert.deepEqual(registry.getFilenames('aName'), ['aFilename']);

		registry._registerLanguages([{
			id: 'a',
			filenames: ['aFilename2']
		}]);

		assert.deepEqual(registry.getFilenames('a'), []);
		assert.deepEqual(registry.getFilenames('aname'), []);
		assert.deepEqual(registry.getFilenames('aName'), ['aFilename', 'aFilename2']);
	});

	test('configuration', () => {
		let registry = new LanguagesRegistry(false);

		registry._registerLanguages([{
			id: 'a',
			aliases: ['aName'],
			configuration: URI.file('/path/to/aFilename')
		}]);

		assert.deepEqual(registry.getConfigurationFiles('a'), [URI.file('/path/to/aFilename')]);
		assert.deepEqual(registry.getConfigurationFiles('aname'), []);
		assert.deepEqual(registry.getConfigurationFiles('aName'), []);

		registry._registerLanguages([{
			id: 'a',
			configuration: URI.file('/path/to/aFilename2')
		}]);

		assert.deepEqual(registry.getConfigurationFiles('a'), [URI.file('/path/to/aFilename'), URI.file('/path/to/aFilename2')]);
		assert.deepEqual(registry.getConfigurationFiles('aname'), []);
		assert.deepEqual(registry.getConfigurationFiles('aName'), []);
	});
});
