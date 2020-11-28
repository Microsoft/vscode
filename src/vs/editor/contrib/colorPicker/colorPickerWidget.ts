/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./colorPicker';
import { onDidChangeZoomLevel } from 'vs/base/browser/browser';
import * as dom from 'vs/base/browser/dom';
import { GlobalMouseMoveMonitor, IStandardMouseMoveEventData, standardMouseMoveMerger } from 'vs/base/browser/globalMouseMoveMonitor';
import { Widget } from 'vs/base/browser/ui/widget';
import { Color, HSVA, RGBA } from 'vs/base/common/color';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { ColorPickerModel } from 'vs/editor/contrib/colorPicker/colorPickerModel';
import { editorHoverBackground } from 'vs/platform/theme/common/colorRegistry';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';

const $ = dom.$;

export class ColorPickerHeader extends Disposable {

	private readonly domNode: HTMLElement;
	private readonly pickedColorNode: HTMLElement;
	private backgroundColor: Color;

	constructor(container: HTMLElement, private readonly model: ColorPickerModel, themeService: IThemeService) {
		super();

		this.domNode = $('.colorpicker-header');
		dom.append(container, this.domNode);

		this.pickedColorNode = dom.append(this.domNode, $('.picked-color'));

		const colorBox = dom.append(this.domNode, $('.original-color'));
		colorBox.style.backgroundColor = Color.Format.CSS.format(this.model.originalColor) || '';

		this.backgroundColor = themeService.getColorTheme().getColor(editorHoverBackground) || Color.white;
		this._register(registerThemingParticipant((theme, collector) => {
			this.backgroundColor = theme.getColor(editorHoverBackground) || Color.white;
		}));

		this._register(dom.addDisposableListener(this.pickedColorNode, dom.EventType.CLICK, () => this.model.selectNextColorPresentation()));
		this._register(dom.addDisposableListener(colorBox, dom.EventType.CLICK, () => {
			this.model.color = this.model.originalColor;
			this.model.flushColor();
		}));
		this._register(model.onDidChangeColor(this.onDidChangeColor, this));
		this._register(model.onDidChangePresentation(this.onDidChangePresentation, this));
		this.pickedColorNode.style.backgroundColor = Color.Format.CSS.format(model.color) || '';
		this.pickedColorNode.classList.toggle('light', model.color.rgba.a < 0.5 ? this.backgroundColor.isLighter() : model.color.isLighter());
	}

	private onDidChangeColor(color: Color): void {
		this.pickedColorNode.style.backgroundColor = Color.Format.CSS.format(color) || '';
		this.pickedColorNode.classList.toggle('light', color.rgba.a < 0.5 ? this.backgroundColor.isLighter() : color.isLighter());
		this.onDidChangePresentation();
	}

	private onDidChangePresentation(): void {
		this.pickedColorNode.textContent = this.model.presentation ? this.model.presentation.label : '';
	}
}

export class ColorPickerBody extends Disposable {

	private readonly domNode: HTMLElement;
	private readonly saturationBox: SaturationBox;
	private readonly hueStrip: Strip;
	private readonly opacityStrip: Strip;

	constructor(container: HTMLElement, private readonly model: ColorPickerModel, private pixelRatio: number) {
		super();

		this.domNode = $('.colorpicker-body');
		dom.append(container, this.domNode);

		this.saturationBox = new SaturationBox(this.domNode, this.model, this.pixelRatio);
		this._register(this.saturationBox);
		this._register(this.saturationBox.onDidChange(this.onDidSaturationValueChange, this));
		this._register(this.saturationBox.onColorFlushed(this.flushColor, this));

		this.opacityStrip = new OpacityStrip(this.domNode, this.model);
		this._register(this.opacityStrip);
		this._register(this.opacityStrip.onDidChange(this.onDidOpacityChange, this));
		this._register(this.opacityStrip.onColorFlushed(this.flushColor, this));

		this.hueStrip = new HueStrip(this.domNode, this.model);
		this._register(this.hueStrip);
		this._register(this.hueStrip.onDidChange(this.onDidHueChange, this));
		this._register(this.hueStrip.onColorFlushed(this.flushColor, this));
	}

	private flushColor(): void {
		this.model.flushColor();
	}

	private onDidSaturationValueChange({ s, v }: { s: number, v: number }): void {
		const hsva = this.model.color.hsva;
		this.model.color = new Color(new HSVA(hsva.h, s, v, hsva.a));
	}

	private onDidOpacityChange(a: number): void {
		const hsva = this.model.color.hsva;
		this.model.color = new Color(new HSVA(hsva.h, hsva.s, hsva.v, a));
	}

	private onDidHueChange(value: number): void {
		const hsva = this.model.color.hsva;
		const h = (1 - value) * 360;

		this.model.color = new Color(new HSVA(h === 360 ? 0 : h, hsva.s, hsva.v, hsva.a));
	}

	layout(): void {
		this.saturationBox.layout();
		this.opacityStrip.layout();
		this.hueStrip.layout();
	}
}

class SaturationBox extends Disposable {

	private readonly domNode: HTMLElement;
	private readonly selection: HTMLElement;
	private readonly canvas: HTMLCanvasElement;
	private width!: number;
	private height!: number;

	private monitor: GlobalMouseMoveMonitor<IStandardMouseMoveEventData> | null;
	private readonly _onDidChange = new Emitter<{ s: number, v: number }>();
	readonly onDidChange: Event<{ s: number, v: number }> = this._onDidChange.event;

	private readonly _onColorFlushed = new Emitter<void>();
	readonly onColorFlushed: Event<void> = this._onColorFlushed.event;

	constructor(container: HTMLElement, private readonly model: ColorPickerModel, private pixelRatio: number) {
		super();

		this.domNode = $('.saturation-wrap');
		dom.append(container, this.domNode);

		// Create canvas, draw selected color
		this.canvas = document.createElement('canvas');
		this.canvas.className = 'saturation-box';
		dom.append(this.domNode, this.canvas);

		// Add selection circle
		this.selection = $('.saturation-selection');
		dom.append(this.domNode, this.selection);

		this.layout();

		this._register(dom.addDisposableGenericMouseDownListner(this.domNode, e => this.onMouseDown(e)));
		this._register(this.model.onDidChangeColor(this.onDidChangeColor, this));
		this.monitor = null;
	}

	private onMouseDown(e: MouseEvent): void {
		this.monitor = this._register(new GlobalMouseMoveMonitor<IStandardMouseMoveEventData>());
		const origin = dom.getDomNodePagePosition(this.domNode);

		if (e.target !== this.selection) {
			this.onDidChangePosition(e.offsetX, e.offsetY);
		}

		this.monitor.startMonitoring(<HTMLElement>e.target, e.buttons, standardMouseMoveMerger, event => this.onDidChangePosition(event.posx - origin.left, event.posy - origin.top), () => null);

		const mouseUpListener = dom.addDisposableGenericMouseUpListner(document, () => {
			this._onColorFlushed.fire();
			mouseUpListener.dispose();
			if (this.monitor) {
				this.monitor.stopMonitoring(true);
				this.monitor = null;
			}
		}, true);
	}

	private onDidChangePosition(left: number, top: number): void {
		const s = Math.max(0, Math.min(1, left / this.width));
		const v = Math.max(0, Math.min(1, 1 - (top / this.height)));

		this.paintSelection(s, v);
		this._onDidChange.fire({ s, v });
	}

	layout(): void {
		this.width = this.domNode.offsetWidth;
		this.height = this.domNode.offsetHeight;
		this.canvas.width = this.width * this.pixelRatio;
		this.canvas.height = this.height * this.pixelRatio;
		this.paint();

		const hsva = this.model.color.hsva;
		this.paintSelection(hsva.s, hsva.v);
	}

	private paint(): void {
		const hsva = this.model.color.hsva;
		const saturatedColor = new Color(new HSVA(hsva.h, 1, 1, 1));
		const ctx = this.canvas.getContext('2d')!;

		const whiteGradient = ctx.createLinearGradient(0, 0, this.canvas.width, 0);
		whiteGradient.addColorStop(0, 'rgba(255, 255, 255, 1)');
		whiteGradient.addColorStop(0.5, 'rgba(255, 255, 255, 0.5)');
		whiteGradient.addColorStop(1, 'rgba(255, 255, 255, 0)');

		const blackGradient = ctx.createLinearGradient(0, 0, 0, this.canvas.height);
		blackGradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
		blackGradient.addColorStop(1, 'rgba(0, 0, 0, 1)');

		ctx.rect(0, 0, this.canvas.width, this.canvas.height);
		ctx.fillStyle = Color.Format.CSS.format(saturatedColor)!;
		ctx.fill();
		ctx.fillStyle = whiteGradient;
		ctx.fill();
		ctx.fillStyle = blackGradient;
		ctx.fill();
	}

	private paintSelection(s: number, v: number): void {
		this.selection.style.left = `${s * this.width}px`;
		this.selection.style.top = `${this.height - v * this.height}px`;
	}

	private onDidChangeColor(): void {
		if (this.monitor && this.monitor.isMonitoring()) {
			return;
		}
		this.paint();
	}
}

abstract class Strip extends Disposable {

	protected domNode: HTMLElement;
	protected overlay: HTMLElement;
	protected slider: HTMLElement;
	private height!: number;

	private readonly _onDidChange = new Emitter<number>();
	readonly onDidChange: Event<number> = this._onDidChange.event;

	private readonly _onColorFlushed = new Emitter<void>();
	readonly onColorFlushed: Event<void> = this._onColorFlushed.event;

	constructor(container: HTMLElement, protected model: ColorPickerModel) {
		super();
		this.domNode = dom.append(container, $('.strip'));
		this.overlay = dom.append(this.domNode, $('.overlay'));
		this.slider = dom.append(this.domNode, $('.slider'));
		this.slider.style.top = `0px`;

		this._register(dom.addDisposableGenericMouseDownListner(this.domNode, e => this.onMouseDown(e)));
		this.layout();
	}

	layout(): void {
		this.height = this.domNode.offsetHeight - this.slider.offsetHeight;

		const value = this.getValue(this.model.color);
		this.updateSliderPosition(value);
	}

	private onMouseDown(e: MouseEvent): void {
		const monitor = this._register(new GlobalMouseMoveMonitor<IStandardMouseMoveEventData>());
		const origin = dom.getDomNodePagePosition(this.domNode);
		this.domNode.classList.add('grabbing');

		if (e.target !== this.slider) {
			this.onDidChangeTop(e.offsetY);
		}

		monitor.startMonitoring(<HTMLElement>e.target, e.buttons, standardMouseMoveMerger, event => this.onDidChangeTop(event.posy - origin.top), () => null);

		const mouseUpListener = dom.addDisposableGenericMouseUpListner(document, () => {
			this._onColorFlushed.fire();
			mouseUpListener.dispose();
			monitor.stopMonitoring(true);
			this.domNode.classList.remove('grabbing');
		}, true);
	}

	private onDidChangeTop(top: number): void {
		const value = Math.max(0, Math.min(1, 1 - (top / this.height)));

		this.updateSliderPosition(value);
		this._onDidChange.fire(value);
	}

	private updateSliderPosition(value: number): void {
		this.slider.style.top = `${(1 - value) * this.height}px`;
	}

	protected abstract getValue(color: Color): number;
}

class OpacityStrip extends Strip {

	constructor(container: HTMLElement, model: ColorPickerModel) {
		super(container, model);
		this.domNode.classList.add('opacity-strip');

		this._register(model.onDidChangeColor(this.onDidChangeColor, this));
		this.onDidChangeColor(this.model.color);
	}

	private onDidChangeColor(color: Color): void {
		const { r, g, b } = color.rgba;
		const opaque = new Color(new RGBA(r, g, b, 1));
		const transparent = new Color(new RGBA(r, g, b, 0));

		this.overlay.style.background = `linear-gradient(to bottom, ${opaque} 0%, ${transparent} 100%)`;
	}

	protected getValue(color: Color): number {
		return color.hsva.a;
	}
}

class HueStrip extends Strip {

	constructor(container: HTMLElement, model: ColorPickerModel) {
		super(container, model);
		this.domNode.classList.add('hue-strip');
	}

	protected getValue(color: Color): number {
		return 1 - (color.hsva.h / 360);
	}
}

export class ColorPickerWidget extends Widget {

	private static readonly ID = 'editor.contrib.colorPickerWidget';

	body: ColorPickerBody;

	constructor(container: Node, readonly model: ColorPickerModel, private pixelRatio: number, themeService: IThemeService) {
		super();

		this._register(onDidChangeZoomLevel(() => this.layout()));

		const element = $('.colorpicker-widget');
		container.appendChild(element);

		const header = new ColorPickerHeader(element, this.model, themeService);
		this.body = new ColorPickerBody(element, this.model, this.pixelRatio);

		this._register(header);
		this._register(this.body);
	}

	getId(): string {
		return ColorPickerWidget.ID;
	}

	layout(): void {
		this.body.layout();
	}
}
