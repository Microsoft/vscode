/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { IEnvConfiguration } from 'vs/editor/common/config/commonEditorConfig';
import { IEditorHoverOptions, EditorOption, ConfigurationChangedEvent, IQuickSuggestionsOptions } from 'vs/editor/common/config/editorOptions';
import { EditorZoom } from 'vs/editor/common/config/editorZoom';
import { TestConfiguration } from 'vs/editor/test/common/mocks/testConfiguration';
import { AccessibilitySupport } from 'vs/platform/accessibility/common/accessibility';

suite('Common Editor Config', () => {
	test('Zoom Level', () => {

		//Zoom levels are defined to go between -5, 20 inclusive
		const zoom = EditorZoom;

		zoom.setZoomLevel(0);
		assert.equal(zoom.getZoomLevel(), 0);

		zoom.setZoomLevel(-0);
		assert.equal(zoom.getZoomLevel(), 0);

		zoom.setZoomLevel(5);
		assert.equal(zoom.getZoomLevel(), 5);

		zoom.setZoomLevel(-1);
		assert.equal(zoom.getZoomLevel(), -1);

		zoom.setZoomLevel(9);
		assert.equal(zoom.getZoomLevel(), 9);

		zoom.setZoomLevel(-9);
		assert.equal(zoom.getZoomLevel(), -5);

		zoom.setZoomLevel(20);
		assert.equal(zoom.getZoomLevel(), 20);

		zoom.setZoomLevel(-10);
		assert.equal(zoom.getZoomLevel(), -5);

		zoom.setZoomLevel(9.1);
		assert.equal(zoom.getZoomLevel(), 9.1);

		zoom.setZoomLevel(-9.1);
		assert.equal(zoom.getZoomLevel(), -5);

		zoom.setZoomLevel(Infinity);
		assert.equal(zoom.getZoomLevel(), 20);

		zoom.setZoomLevel(Number.NEGATIVE_INFINITY);
		assert.equal(zoom.getZoomLevel(), -5);
	});

	class TestWrappingConfiguration extends TestConfiguration {
		protected _getEnvConfiguration(): IEnvConfiguration {
			return {
				extraEditorClassName: '',
				outerWidth: 1000,
				outerHeight: 100,
				emptySelectionClipboard: true,
				pixelRatio: 1,
				zoomLevel: 0,
				accessibilitySupport: AccessibilitySupport.Unknown
			};
		}
	}

	function assertWrapping(config: TestConfiguration, isViewportWrapping: boolean, wrappingColumn: number): void {
		const options = config.options;
		const wrappingInfo = options.get(EditorOption.wrappingInfo);
		assert.equal(wrappingInfo.isViewportWrapping, isViewportWrapping);
		assert.equal(wrappingInfo.wrappingColumn, wrappingColumn);
	}

	test('wordWrap default', () => {
		let config = new TestWrappingConfiguration({});
		assertWrapping(config, false, -1);
	});

	test('wordWrap compat false', () => {
		let config = new TestWrappingConfiguration({
			wordWrap: <any>false
		});
		assertWrapping(config, false, -1);
	});

	test('wordWrap compat true', () => {
		let config = new TestWrappingConfiguration({
			wordWrap: <any>true
		});
		assertWrapping(config, true, 80);
	});

	test('wordWrap on', () => {
		let config = new TestWrappingConfiguration({
			wordWrap: 'on'
		});
		assertWrapping(config, true, 80);
	});

	test('wordWrap on without minimap', () => {
		let config = new TestWrappingConfiguration({
			wordWrap: 'on',
			minimap: {
				enabled: false
			}
		});
		assertWrapping(config, true, 88);
	});

	test('wordWrap on does not use wordWrapColumn', () => {
		let config = new TestWrappingConfiguration({
			wordWrap: 'on',
			wordWrapColumn: 10
		});
		assertWrapping(config, true, 80);
	});

	test('wordWrap off', () => {
		let config = new TestWrappingConfiguration({
			wordWrap: 'off'
		});
		assertWrapping(config, false, -1);
	});

	test('wordWrap off does not use wordWrapColumn', () => {
		let config = new TestWrappingConfiguration({
			wordWrap: 'off',
			wordWrapColumn: 10
		});
		assertWrapping(config, false, -1);
	});

	test('wordWrap wordWrapColumn uses default wordWrapColumn', () => {
		let config = new TestWrappingConfiguration({
			wordWrap: 'wordWrapColumn'
		});
		assertWrapping(config, false, 80);
	});

	test('wordWrap wordWrapColumn uses wordWrapColumn', () => {
		let config = new TestWrappingConfiguration({
			wordWrap: 'wordWrapColumn',
			wordWrapColumn: 100
		});
		assertWrapping(config, false, 100);
	});

	test('wordWrap wordWrapColumn validates wordWrapColumn', () => {
		let config = new TestWrappingConfiguration({
			wordWrap: 'wordWrapColumn',
			wordWrapColumn: -1
		});
		assertWrapping(config, false, 1);
	});

	test('wordWrap bounded uses default wordWrapColumn', () => {
		let config = new TestWrappingConfiguration({
			wordWrap: 'bounded'
		});
		assertWrapping(config, true, 80);
	});

	test('wordWrap bounded uses wordWrapColumn', () => {
		let config = new TestWrappingConfiguration({
			wordWrap: 'bounded',
			wordWrapColumn: 40
		});
		assertWrapping(config, true, 40);
	});

	test('wordWrap bounded validates wordWrapColumn', () => {
		let config = new TestWrappingConfiguration({
			wordWrap: 'bounded',
			wordWrapColumn: -1
		});
		assertWrapping(config, true, 1);
	});

	test('issue #53152: Cannot assign to read only property \'enabled\' of object', () => {
		let hoverOptions: IEditorHoverOptions = {};
		Object.defineProperty(hoverOptions, 'enabled', {
			writable: false,
			value: true
		});
		let config = new TestConfiguration({ hover: hoverOptions });

		assert.equal(config.options.get(EditorOption.hover).enabled, true);
		config.updateOptions({ hover: { enabled: false } });
		assert.equal(config.options.get(EditorOption.hover).enabled, false);
	});

	test('does not emit event when nothing changes', () => {
		const config = new TestConfiguration({ glyphMargin: true, roundedSelection: false });
		let event: ConfigurationChangedEvent | null = null;
		config.onDidChange(e => event = e);
		assert.equal(config.options.get(EditorOption.glyphMargin), true);

		config.updateOptions({ glyphMargin: true });
		config.updateOptions({ roundedSelection: false });
		assert.equal(event, null);
	});

	test('issue #94931: Unable to open source file', () => {
		const config = new TestConfiguration({ quickSuggestions: null! });
		const actual = <Readonly<Required<IQuickSuggestionsOptions>>>config.options.get(EditorOption.quickSuggestions);
		assert.deepEqual(actual, {
			other: true,
			comments: false,
			strings: false
		});
	});

	test('issue #102920: Can\'t snap or split view with JSON files', () => {
		const config = new TestConfiguration({ quickSuggestions: null! });
		config.updateOptions({ quickSuggestions: { strings: true } });
		const actual = <Readonly<Required<IQuickSuggestionsOptions>>>config.options.get(EditorOption.quickSuggestions);
		assert.deepEqual(actual, {
			other: true,
			comments: false,
			strings: true
		});
	});
});
