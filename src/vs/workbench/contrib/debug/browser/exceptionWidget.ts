/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/exceptionWidget';
import * as nls from 'vs/nls';
import * as dom from 'vs/base/browser/dom';
import { ZoneWidget } from 'vs/editor/contrib/zoneWidget/zoneWidget';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IExceptionInfo, IDebugSession } from 'vs/workbench/contrib/debug/common/debug';
import { RunOnceScheduler } from 'vs/base/common/async';
import { IThemeService, IColorTheme } from 'vs/platform/theme/common/themeService';
import { Color } from 'vs/base/common/color';
import { registerColor } from 'vs/platform/theme/common/colorRegistry';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { LinkDetector } from 'vs/workbench/contrib/debug/browser/linkDetector';
import { EditorOption } from 'vs/editor/common/config/editorOptions';
const $ = dom.$;

// theming

export const debugExceptionWidgetBorder = registerColor('debugExceptionWidget.border', { dark: '#a31515', light: '#a31515', hc: '#a31515' }, nls.localize('debugExceptionWidgetBorder', 'Exception widget border color.'));
export const debugExceptionWidgetBackground = registerColor('debugExceptionWidget.background', { dark: '#420b0d', light: '#f1dfde', hc: '#420b0d' }, nls.localize('debugExceptionWidgetBackground', 'Exception widget background color.'));

export class ExceptionWidget extends ZoneWidget {

	private _backgroundColor?: Color;

	constructor(editor: ICodeEditor, private exceptionInfo: IExceptionInfo, private debugSession: IDebugSession | undefined,
		@IThemeService themeService: IThemeService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super(editor, { showFrame: true, showArrow: true, frameWidth: 1, className: 'exception-widget-container' });

		this._backgroundColor = Color.white;

		this._applyTheme(themeService.getColorTheme());
		this._disposables.add(themeService.onDidColorThemeChange(this._applyTheme.bind(this)));

		this.create();
		const onDidLayoutChangeScheduler = new RunOnceScheduler(() => this._doLayout(undefined, undefined), 50);
		this._disposables.add(this.editor.onDidLayoutChange(() => onDidLayoutChangeScheduler.schedule()));
		this._disposables.add(onDidLayoutChangeScheduler);
	}

	private _applyTheme(theme: IColorTheme): void {
		this._backgroundColor = theme.getColor(debugExceptionWidgetBackground);
		const frameColor = theme.getColor(debugExceptionWidgetBorder);
		this.style({
			arrowColor: frameColor,
			frameColor: frameColor
		}); // style() will trigger _applyStyles
	}

	protected _applyStyles(): void {
		if (this.container) {
			this.container.style.backgroundColor = this._backgroundColor ? this._backgroundColor.toString() : '';
		}
		super._applyStyles();
	}

	protected _fillContainer(container: HTMLElement): void {
		this.setCssClass('exception-widget');
		// Set the font size and line height to the one from the editor configuration.
		const fontInfo = this.editor.getOption(EditorOption.fontInfo);
		container.style.fontSize = `${fontInfo.fontSize}px`;
		container.style.lineHeight = `${fontInfo.lineHeight}px`;

		let title = $('.title');
		title.textContent = this.exceptionInfo.id ? nls.localize('exceptionThrownWithId', 'Exception has occurred: {0}', this.exceptionInfo.id) : nls.localize('exceptionThrown', 'Exception has occurred.');
		dom.append(container, title);

		if (this.exceptionInfo.description) {
			let description = $('.description');
			description.textContent = this.exceptionInfo.description;
			dom.append(container, description);
		}

		if (this.exceptionInfo.details && this.exceptionInfo.details.stackTrace) {
			let stackTrace = $('.stack-trace');
			const linkDetector = this.instantiationService.createInstance(LinkDetector);
			const linkedStackTrace = linkDetector.linkify(this.exceptionInfo.details.stackTrace, true, this.debugSession ? this.debugSession.root : undefined);
			stackTrace.appendChild(linkedStackTrace);
			dom.append(container, stackTrace);
		}
	}

	protected _doLayout(_heightInPixel: number | undefined, _widthInPixel: number | undefined): void {
		// Reload the height with respect to the exception text content and relayout it to match the line count.
		this.container!.style.height = 'initial';

		const lineHeight = this.editor.getOption(EditorOption.lineHeight);
		const arrowHeight = Math.round(lineHeight / 3);
		const computedLinesNumber = Math.ceil((this.container!.offsetHeight + arrowHeight) / lineHeight);

		this._relayout(computedLinesNumber);
	}
}
