/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EditorLayoutInfo, EditorLayoutInfoComputer, RenderMinimap, EditorOption, EditorMinimapOptions, InternalEditorScrollbarOptions, EditorOptions, RenderLineNumbersType, InternalEditorRenderLineNumbersOptions } from 'vs/editor/common/config/editorOptions';
import { ComputedEditorOptions } from 'vs/editor/common/config/commonEditorConfig';

interface IEditorLayoutProviderOpts {
	readonly outerWidth: number;
	readonly outerHeight: number;

	readonly showGlyphMargin: boolean;
	readonly lineHeight: number;

	readonly showLineNumbers: boolean;
	readonly lineNumbersMinChars: number;
	readonly lineNumbersDigitCount: number;
	maxLineNumber?: number;

	readonly lineDecorationsWidth: number;

	readonly typicalHalfwidthCharacterWidth: number;
	readonly maxDigitWidth: number;

	readonly verticalScrollbarWidth: number;
	readonly verticalScrollbarHasArrows: boolean;
	readonly scrollbarArrowSize: number;
	readonly horizontalScrollbarHeight: number;

	readonly minimap: boolean;
	readonly minimapSide: 'left' | 'right';
	readonly minimapRenderCharacters: boolean;
	readonly minimapMaxColumn: number;
	minimapSize?: 'proportional' | 'fill' | 'fit';
	readonly pixelRatio: number;
}

suite('Editor ViewLayout - EditorLayoutProvider', () => {

	function doTest(input: IEditorLayoutProviderOpts, expected: EditorLayoutInfo): void {
		const options = new ComputedEditorOptions();
		options._write(EditorOption.glyphMargin, input.showGlyphMargin);
		options._write(EditorOption.lineNumbersMinChars, input.lineNumbersMinChars);
		options._write(EditorOption.lineDecorationsWidth, input.lineDecorationsWidth);
		options._write(EditorOption.folding, false);
		const minimapOptions: EditorMinimapOptions = {
			enabled: input.minimap,
			size: input.minimapSize || 'proportional',
			side: input.minimapSide,
			renderCharacters: input.minimapRenderCharacters,
			maxColumn: input.minimapMaxColumn,
			showSlider: 'mouseover',
			scale: 1,
		};
		options._write(EditorOption.minimap, minimapOptions);
		const scrollbarOptions: InternalEditorScrollbarOptions = {
			arrowSize: input.scrollbarArrowSize,
			vertical: EditorOptions.scrollbar.defaultValue.vertical,
			horizontal: EditorOptions.scrollbar.defaultValue.horizontal,
			useShadows: EditorOptions.scrollbar.defaultValue.useShadows,
			verticalHasArrows: input.verticalScrollbarHasArrows,
			horizontalHasArrows: false,
			handleMouseWheel: EditorOptions.scrollbar.defaultValue.handleMouseWheel,
			alwaysConsumeMouseWheel: true,
			horizontalScrollbarSize: input.horizontalScrollbarHeight,
			horizontalSliderSize: EditorOptions.scrollbar.defaultValue.horizontalSliderSize,
			verticalScrollbarSize: input.verticalScrollbarWidth,
			verticalSliderSize: EditorOptions.scrollbar.defaultValue.verticalSliderSize,
			scrollByPage: EditorOptions.scrollbar.defaultValue.scrollByPage,
		};
		options._write(EditorOption.scrollbar, scrollbarOptions);
		const lineNumbersOptions: InternalEditorRenderLineNumbersOptions = {
			renderType: input.showLineNumbers ? RenderLineNumbersType.On : RenderLineNumbersType.Off,
			renderFn: null
		};
		options._write(EditorOption.lineNumbers, lineNumbersOptions);

		options._write(EditorOption.wordWrap, 'off');
		options._write(EditorOption.wordWrapColumn, 80);
		options._write(EditorOption.wordWrapMinified, true);
		options._write(EditorOption.accessibilitySupport, 'auto');

		const actual = EditorLayoutInfoComputer.computeLayout(options, {
			memory: null,
			outerWidth: input.outerWidth,
			outerHeight: input.outerHeight,
			isDominatedByLongLines: false,
			lineHeight: input.lineHeight,
			viewLineCount: input.maxLineNumber || Math.pow(10, input.lineNumbersDigitCount) - 1,
			lineNumbersDigitCount: input.lineNumbersDigitCount,
			typicalHalfwidthCharacterWidth: input.typicalHalfwidthCharacterWidth,
			maxDigitWidth: input.maxDigitWidth,
			pixelRatio: input.pixelRatio,
		});
		assert.deepEqual(actual, expected);
	}

	test('EditorLayoutProvider 1', () => {
		doTest({
			outerWidth: 1000,
			outerHeight: 800,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: false,
			lineNumbersMinChars: 0,
			lineNumbersDigitCount: 1,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 10,
			maxDigitWidth: 10,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: false,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			pixelRatio: 1,
		}, {
			width: 1000,
			height: 800,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 0,

			decorationsLeft: 0,
			decorationsWidth: 10,

			contentLeft: 10,
			contentWidth: 990,

			minimap: {
				renderMinimap: RenderMinimap.None,
				minimapLeft: 0,
				minimapWidth: 0,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 1,
				minimapLineHeight: 1,
				minimapCanvasInnerWidth: 0,
				minimapCanvasInnerHeight: 800,
				minimapCanvasOuterWidth: 0,
				minimapCanvasOuterHeight: 800,
			},

			viewportColumn: 98,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 800,
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 1.1', () => {
		doTest({
			outerWidth: 1000,
			outerHeight: 800,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: false,
			lineNumbersMinChars: 0,
			lineNumbersDigitCount: 1,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 10,
			maxDigitWidth: 10,
			verticalScrollbarWidth: 11,
			horizontalScrollbarHeight: 12,
			scrollbarArrowSize: 13,
			verticalScrollbarHasArrows: true,
			minimap: false,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			pixelRatio: 1,
		}, {
			width: 1000,
			height: 800,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 0,

			decorationsLeft: 0,
			decorationsWidth: 10,

			contentLeft: 10,
			contentWidth: 990,

			minimap: {
				renderMinimap: RenderMinimap.None,
				minimapLeft: 0,
				minimapWidth: 0,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 1,
				minimapLineHeight: 1,
				minimapCanvasInnerWidth: 0,
				minimapCanvasInnerHeight: 800,
				minimapCanvasOuterWidth: 0,
				minimapCanvasOuterHeight: 800,
			},

			viewportColumn: 97,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 11,
			horizontalScrollbarHeight: 12,

			overviewRuler: {
				top: 13,
				width: 11,
				height: (800 - 2 * 13),
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 2', () => {
		doTest({
			outerWidth: 900,
			outerHeight: 800,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: false,
			lineNumbersMinChars: 0,
			lineNumbersDigitCount: 1,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 10,
			maxDigitWidth: 10,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: false,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			pixelRatio: 1,
		}, {
			width: 900,
			height: 800,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 0,

			decorationsLeft: 0,
			decorationsWidth: 10,

			contentLeft: 10,
			contentWidth: 890,

			minimap: {
				renderMinimap: RenderMinimap.None,
				minimapLeft: 0,
				minimapWidth: 0,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 1,
				minimapLineHeight: 1,
				minimapCanvasInnerWidth: 0,
				minimapCanvasInnerHeight: 800,
				minimapCanvasOuterWidth: 0,
				minimapCanvasOuterHeight: 800,
			},

			viewportColumn: 88,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 800,
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 3', () => {
		doTest({
			outerWidth: 900,
			outerHeight: 900,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: false,
			lineNumbersMinChars: 0,
			lineNumbersDigitCount: 1,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 10,
			maxDigitWidth: 10,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: false,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			pixelRatio: 1,
		}, {
			width: 900,
			height: 900,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 0,

			decorationsLeft: 0,
			decorationsWidth: 10,

			contentLeft: 10,
			contentWidth: 890,

			minimap: {
				renderMinimap: RenderMinimap.None,
				minimapLeft: 0,
				minimapWidth: 0,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 1,
				minimapLineHeight: 1,
				minimapCanvasInnerWidth: 0,
				minimapCanvasInnerHeight: 900,
				minimapCanvasOuterWidth: 0,
				minimapCanvasOuterHeight: 900,
			},

			viewportColumn: 88,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 900,
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 4', () => {
		doTest({
			outerWidth: 900,
			outerHeight: 900,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: false,
			lineNumbersMinChars: 5,
			lineNumbersDigitCount: 1,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 10,
			maxDigitWidth: 10,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: false,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			pixelRatio: 1,
		}, {
			width: 900,
			height: 900,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 0,

			decorationsLeft: 0,
			decorationsWidth: 10,

			contentLeft: 10,
			contentWidth: 890,

			minimap: {
				renderMinimap: RenderMinimap.None,
				minimapLeft: 0,
				minimapWidth: 0,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 1,
				minimapLineHeight: 1,
				minimapCanvasInnerWidth: 0,
				minimapCanvasInnerHeight: 900,
				minimapCanvasOuterWidth: 0,
				minimapCanvasOuterHeight: 900,
			},

			viewportColumn: 88,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 900,
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 5', () => {
		doTest({
			outerWidth: 900,
			outerHeight: 900,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: true,
			lineNumbersMinChars: 5,
			lineNumbersDigitCount: 1,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 10,
			maxDigitWidth: 10,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: false,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			pixelRatio: 1,
		}, {
			width: 900,
			height: 900,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 50,

			decorationsLeft: 50,
			decorationsWidth: 10,

			contentLeft: 60,
			contentWidth: 840,

			minimap: {
				renderMinimap: RenderMinimap.None,
				minimapLeft: 0,
				minimapWidth: 0,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 1,
				minimapLineHeight: 1,
				minimapCanvasInnerWidth: 0,
				minimapCanvasInnerHeight: 900,
				minimapCanvasOuterWidth: 0,
				minimapCanvasOuterHeight: 900,
			},

			viewportColumn: 83,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 900,
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 6', () => {
		doTest({
			outerWidth: 900,
			outerHeight: 900,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: true,
			lineNumbersMinChars: 5,
			lineNumbersDigitCount: 5,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 10,
			maxDigitWidth: 10,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: false,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			pixelRatio: 1,
		}, {
			width: 900,
			height: 900,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 50,

			decorationsLeft: 50,
			decorationsWidth: 10,

			contentLeft: 60,
			contentWidth: 840,

			minimap: {
				renderMinimap: RenderMinimap.None,
				minimapLeft: 0,
				minimapWidth: 0,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 1,
				minimapLineHeight: 1,
				minimapCanvasInnerWidth: 0,
				minimapCanvasInnerHeight: 900,
				minimapCanvasOuterWidth: 0,
				minimapCanvasOuterHeight: 900,
			},

			viewportColumn: 83,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 900,
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 7', () => {
		doTest({
			outerWidth: 900,
			outerHeight: 900,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: true,
			lineNumbersMinChars: 5,
			lineNumbersDigitCount: 6,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 10,
			maxDigitWidth: 10,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: false,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			pixelRatio: 1,
		}, {
			width: 900,
			height: 900,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 60,

			decorationsLeft: 60,
			decorationsWidth: 10,

			contentLeft: 70,
			contentWidth: 830,

			minimap: {
				renderMinimap: RenderMinimap.None,
				minimapLeft: 0,
				minimapWidth: 0,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 1,
				minimapLineHeight: 1,
				minimapCanvasInnerWidth: 0,
				minimapCanvasInnerHeight: 900,
				minimapCanvasOuterWidth: 0,
				minimapCanvasOuterHeight: 900,
			},

			viewportColumn: 82,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 900,
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 8', () => {
		doTest({
			outerWidth: 900,
			outerHeight: 900,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: true,
			lineNumbersMinChars: 5,
			lineNumbersDigitCount: 6,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 5,
			maxDigitWidth: 5,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: false,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			pixelRatio: 1,
		}, {
			width: 900,
			height: 900,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 30,

			decorationsLeft: 30,
			decorationsWidth: 10,

			contentLeft: 40,
			contentWidth: 860,

			minimap: {
				renderMinimap: RenderMinimap.None,
				minimapLeft: 0,
				minimapWidth: 0,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 1,
				minimapLineHeight: 1,
				minimapCanvasInnerWidth: 0,
				minimapCanvasInnerHeight: 900,
				minimapCanvasOuterWidth: 0,
				minimapCanvasOuterHeight: 900,
			},

			viewportColumn: 171,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 900,
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 8 - rounds floats', () => {
		doTest({
			outerWidth: 900,
			outerHeight: 900,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: true,
			lineNumbersMinChars: 5,
			lineNumbersDigitCount: 6,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 5.05,
			maxDigitWidth: 5.05,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: false,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			pixelRatio: 1,
		}, {
			width: 900,
			height: 900,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 30,

			decorationsLeft: 30,
			decorationsWidth: 10,

			contentLeft: 40,
			contentWidth: 860,

			minimap: {
				renderMinimap: RenderMinimap.None,
				minimapLeft: 0,
				minimapWidth: 0,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 1,
				minimapLineHeight: 1,
				minimapCanvasInnerWidth: 0,
				minimapCanvasInnerHeight: 900,
				minimapCanvasOuterWidth: 0,
				minimapCanvasOuterHeight: 900,
			},

			viewportColumn: 169,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 900,
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 9 - render minimap', () => {
		doTest({
			outerWidth: 1000,
			outerHeight: 800,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: false,
			lineNumbersMinChars: 0,
			lineNumbersDigitCount: 1,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 10,
			maxDigitWidth: 10,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: true,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			pixelRatio: 1,
		}, {
			width: 1000,
			height: 800,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 0,

			decorationsLeft: 0,
			decorationsWidth: 10,

			contentLeft: 10,
			contentWidth: 893,

			minimap: {
				renderMinimap: RenderMinimap.Text,
				minimapLeft: 903,
				minimapWidth: 97,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 1,
				minimapLineHeight: 2,
				minimapCanvasInnerWidth: 97,
				minimapCanvasInnerHeight: 800,
				minimapCanvasOuterWidth: 97,
				minimapCanvasOuterHeight: 800,
			},

			viewportColumn: 89,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 800,
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 9 - render minimap with pixelRatio = 2', () => {
		doTest({
			outerWidth: 1000,
			outerHeight: 800,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: false,
			lineNumbersMinChars: 0,
			lineNumbersDigitCount: 1,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 10,
			maxDigitWidth: 10,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: true,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			pixelRatio: 2,
		}, {
			width: 1000,
			height: 800,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 0,

			decorationsLeft: 0,
			decorationsWidth: 10,

			contentLeft: 10,
			contentWidth: 893,

			minimap: {
				renderMinimap: RenderMinimap.Text,
				minimapLeft: 903,
				minimapWidth: 97,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 2,
				minimapLineHeight: 4,
				minimapCanvasInnerWidth: 194,
				minimapCanvasInnerHeight: 1600,
				minimapCanvasOuterWidth: 97,
				minimapCanvasOuterHeight: 800,
			},

			viewportColumn: 89,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 800,
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 9 - render minimap with pixelRatio = 4', () => {
		doTest({
			outerWidth: 1000,
			outerHeight: 800,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: false,
			lineNumbersMinChars: 0,
			lineNumbersDigitCount: 1,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 10,
			maxDigitWidth: 10,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: true,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			pixelRatio: 4,
		}, {
			width: 1000,
			height: 800,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 0,

			decorationsLeft: 0,
			decorationsWidth: 10,

			contentLeft: 10,
			contentWidth: 935,

			minimap: {
				renderMinimap: RenderMinimap.Text,
				minimapLeft: 945,
				minimapWidth: 55,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 2,
				minimapLineHeight: 4,
				minimapCanvasInnerWidth: 220,
				minimapCanvasInnerHeight: 3200,
				minimapCanvasOuterWidth: 55,
				minimapCanvasOuterHeight: 800,
			},

			viewportColumn: 93,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 800,
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 10 - render minimap to left', () => {
		doTest({
			outerWidth: 1000,
			outerHeight: 800,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: false,
			lineNumbersMinChars: 0,
			lineNumbersDigitCount: 1,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 10,
			maxDigitWidth: 10,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: true,
			minimapSide: 'left',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			pixelRatio: 4,
		}, {
			width: 1000,
			height: 800,

			glyphMarginLeft: 55,
			glyphMarginWidth: 0,

			lineNumbersLeft: 55,
			lineNumbersWidth: 0,

			decorationsLeft: 55,
			decorationsWidth: 10,

			contentLeft: 65,
			contentWidth: 935,

			minimap: {
				renderMinimap: RenderMinimap.Text,
				minimapLeft: 0,
				minimapWidth: 55,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 2,
				minimapLineHeight: 4,
				minimapCanvasInnerWidth: 220,
				minimapCanvasInnerHeight: 3200,
				minimapCanvasOuterWidth: 55,
				minimapCanvasOuterHeight: 800,
			},

			viewportColumn: 93,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 800,
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 11 - minimap mode cover without sampling', () => {
		doTest({
			outerWidth: 1000,
			outerHeight: 800,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: false,
			lineNumbersMinChars: 0,
			lineNumbersDigitCount: 3,
			maxLineNumber: 120,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 10,
			maxDigitWidth: 10,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: true,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			minimapSize: 'fill',
			pixelRatio: 2,
		}, {
			width: 1000,
			height: 800,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 0,

			decorationsLeft: 0,
			decorationsWidth: 10,

			contentLeft: 10,
			contentWidth: 893,

			minimap: {
				renderMinimap: RenderMinimap.Text,
				minimapLeft: 903,
				minimapWidth: 97,
				minimapHeightIsEditorHeight: true,
				minimapIsSampling: false,
				minimapScale: 3,
				minimapLineHeight: 13,
				minimapCanvasInnerWidth: 291,
				minimapCanvasInnerHeight: 1560,
				minimapCanvasOuterWidth: 97,
				minimapCanvasOuterHeight: 800,
			},

			viewportColumn: 89,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 800,
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 12 - minimap mode cover with sampling', () => {
		doTest({
			outerWidth: 1000,
			outerHeight: 800,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: false,
			lineNumbersMinChars: 0,
			lineNumbersDigitCount: 4,
			maxLineNumber: 2500,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 10,
			maxDigitWidth: 10,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: true,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			minimapSize: 'fill',
			pixelRatio: 2,
		}, {
			width: 1000,
			height: 800,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 0,

			decorationsLeft: 0,
			decorationsWidth: 10,

			contentLeft: 10,
			contentWidth: 935,

			minimap: {
				renderMinimap: RenderMinimap.Text,
				minimapLeft: 945,
				minimapWidth: 55,
				minimapHeightIsEditorHeight: true,
				minimapIsSampling: true,
				minimapScale: 1,
				minimapLineHeight: 1,
				minimapCanvasInnerWidth: 110,
				minimapCanvasInnerHeight: 1600,
				minimapCanvasOuterWidth: 55,
				minimapCanvasOuterHeight: 800,
			},

			viewportColumn: 93,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 800,
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 13 - minimap mode contain without sampling', () => {
		doTest({
			outerWidth: 1000,
			outerHeight: 800,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: false,
			lineNumbersMinChars: 0,
			lineNumbersDigitCount: 3,
			maxLineNumber: 120,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 10,
			maxDigitWidth: 10,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: true,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			minimapSize: 'fit',
			pixelRatio: 2,
		}, {
			width: 1000,
			height: 800,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 0,

			decorationsLeft: 0,
			decorationsWidth: 10,

			contentLeft: 10,
			contentWidth: 893,

			minimap: {
				renderMinimap: RenderMinimap.Text,
				minimapLeft: 903,
				minimapWidth: 97,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 2,
				minimapLineHeight: 4,
				minimapCanvasInnerWidth: 194,
				minimapCanvasInnerHeight: 1600,
				minimapCanvasOuterWidth: 97,
				minimapCanvasOuterHeight: 800,
			},

			viewportColumn: 89,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 800,
				right: 0
			}
		});
	});

	test('EditorLayoutProvider 14 - minimap mode contain with sampling', () => {
		doTest({
			outerWidth: 1000,
			outerHeight: 800,
			showGlyphMargin: false,
			lineHeight: 16,
			showLineNumbers: false,
			lineNumbersMinChars: 0,
			lineNumbersDigitCount: 4,
			maxLineNumber: 2500,
			lineDecorationsWidth: 10,
			typicalHalfwidthCharacterWidth: 10,
			maxDigitWidth: 10,
			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,
			scrollbarArrowSize: 0,
			verticalScrollbarHasArrows: false,
			minimap: true,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 150,
			minimapSize: 'fit',
			pixelRatio: 2,
		}, {
			width: 1000,
			height: 800,

			glyphMarginLeft: 0,
			glyphMarginWidth: 0,

			lineNumbersLeft: 0,
			lineNumbersWidth: 0,

			decorationsLeft: 0,
			decorationsWidth: 10,

			contentLeft: 10,
			contentWidth: 935,

			minimap: {
				renderMinimap: RenderMinimap.Text,
				minimapLeft: 945,
				minimapWidth: 55,
				minimapHeightIsEditorHeight: true,
				minimapIsSampling: true,
				minimapScale: 1,
				minimapLineHeight: 1,
				minimapCanvasInnerWidth: 110,
				minimapCanvasInnerHeight: 1600,
				minimapCanvasOuterWidth: 55,
				minimapCanvasOuterHeight: 800,
			},

			viewportColumn: 93,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 0,
			horizontalScrollbarHeight: 0,

			overviewRuler: {
				top: 0,
				width: 0,
				height: 800,
				right: 0
			}
		});
	});

	test('issue #31312: When wrapping, leave 2px for the cursor', () => {
		doTest({
			outerWidth: 1201,
			outerHeight: 422,
			showGlyphMargin: true,
			lineHeight: 30,
			showLineNumbers: true,
			lineNumbersMinChars: 3,
			lineNumbersDigitCount: 1,
			lineDecorationsWidth: 26,
			typicalHalfwidthCharacterWidth: 12.04296875,
			maxDigitWidth: 12.04296875,
			verticalScrollbarWidth: 14,
			horizontalScrollbarHeight: 10,
			scrollbarArrowSize: 11,
			verticalScrollbarHasArrows: false,
			minimap: true,
			minimapSide: 'right',
			minimapRenderCharacters: true,
			minimapMaxColumn: 120,
			pixelRatio: 2
		}, {
			width: 1201,
			height: 422,

			glyphMarginLeft: 0,
			glyphMarginWidth: 30,

			lineNumbersLeft: 30,
			lineNumbersWidth: 36,

			decorationsLeft: 66,
			decorationsWidth: 26,

			contentLeft: 92,
			contentWidth: 1018,

			minimap: {
				renderMinimap: RenderMinimap.Text,
				minimapLeft: 1096,
				minimapWidth: 91,
				minimapHeightIsEditorHeight: false,
				minimapIsSampling: false,
				minimapScale: 2,
				minimapLineHeight: 4,
				minimapCanvasInnerWidth: 182,
				minimapCanvasInnerHeight: 844,
				minimapCanvasOuterWidth: 91,
				minimapCanvasOuterHeight: 422,
			},

			viewportColumn: 83,
			isWordWrapMinified: false,
			isViewportWrapping: false,
			wrappingColumn: -1,

			verticalScrollbarWidth: 14,
			horizontalScrollbarHeight: 10,

			overviewRuler: {
				top: 0,
				width: 14,
				height: 422,
				right: 0
			}
		});

	});
});
