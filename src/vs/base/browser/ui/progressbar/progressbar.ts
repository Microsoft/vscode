/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./progressbar';
import { Disposable } from 'vs/base/common/lifecycle';
import { Color } from 'vs/base/common/color';
import { mixin } from 'vs/base/common/objects';
import { hide, show } from 'vs/base/browser/dom';
import { RunOnceScheduler } from 'vs/base/common/async';
import { isNumber } from 'vs/base/common/types';

const CSS_DONE = 'done';
const CSS_ACTIVE = 'active';
const CSS_INFINITE = 'infinite';
const CSS_DISCRETE = 'discrete';

export interface IProgressBarOptions extends IProgressBarStyles {
}

export interface IProgressBarStyles {
	progressBarBackground?: Color;
}

const defaultOpts = {
	progressBarBackground: Color.fromHex('#0E70C0')
};

/**
 * A progress bar with support for infinite or discrete progress.
 */
export class ProgressBar extends Disposable {
	private options: IProgressBarOptions;
	private workedVal: number;
	private element!: HTMLElement;
	private bit!: HTMLElement;
	private totalWork: number | undefined;
	private progressBarBackground: Color | undefined;
	private showDelayedScheduler: RunOnceScheduler;

	constructor(container: HTMLElement, options?: IProgressBarOptions) {
		super();

		this.options = options || Object.create(null);
		mixin(this.options, defaultOpts, false);

		this.workedVal = 0;

		this.progressBarBackground = this.options.progressBarBackground;

		this._register(this.showDelayedScheduler = new RunOnceScheduler(() => show(this.element), 0));

		this.create(container);
	}

	private create(container: HTMLElement): void {
		this.element = document.createElement('div');
		this.element.classList.add('monaco-progress-container');
		this.element.setAttribute('role', 'progressbar');
		this.element.setAttribute('aria-valuemin', '0');
		container.appendChild(this.element);

		this.bit = document.createElement('div');
		this.bit.classList.add('progress-bit');
		this.element.appendChild(this.bit);

		this.applyStyles();
	}

	private off(): void {
		this.bit.style.width = 'inherit';
		this.bit.style.opacity = '1';
		this.element.classList.remove(CSS_ACTIVE, CSS_INFINITE, CSS_DISCRETE);

		this.workedVal = 0;
		this.totalWork = undefined;
	}

	/**
	 * Indicates to the progress bar that all work is done.
	 */
	done(): ProgressBar {
		return this.doDone(true);
	}

	/**
	 * Stops the progressbar from showing any progress instantly without fading out.
	 */
	stop(): ProgressBar {
		return this.doDone(false);
	}

	private doDone(delayed: boolean): ProgressBar {
		this.element.classList.add(CSS_DONE);

		// let it grow to 100% width and hide afterwards
		if (!this.element.classList.contains(CSS_INFINITE)) {
			this.bit.style.width = 'inherit';

			if (delayed) {
				setTimeout(() => this.off(), 200);
			} else {
				this.off();
			}
		}

		// let it fade out and hide afterwards
		else {
			this.bit.style.opacity = '0';
			if (delayed) {
				setTimeout(() => this.off(), 200);
			} else {
				this.off();
			}
		}

		return this;
	}

	/**
	 * Use this mode to indicate progress that has no total number of work units.
	 */
	infinite(): ProgressBar {
		this.bit.style.width = '2%';
		this.bit.style.opacity = '1';

		this.element.classList.remove(CSS_DISCRETE, CSS_DONE);
		this.element.classList.add(CSS_ACTIVE, CSS_INFINITE);

		return this;
	}

	/**
	 * Tells the progress bar the total number of work. Use in combination with workedVal() to let
	 * the progress bar show the actual progress based on the work that is done.
	 */
	total(value: number): ProgressBar {
		this.workedVal = 0;
		this.totalWork = value;
		this.element.setAttribute('aria-valuemax', value.toString());

		return this;
	}

	/**
	 * Finds out if this progress bar is configured with total work
	 */
	hasTotal(): boolean {
		return isNumber(this.totalWork);
	}

	/**
	 * Tells the progress bar that an increment of work has been completed.
	 */
	worked(value: number): ProgressBar {
		value = Math.max(1, Number(value));

		return this.doSetWorked(this.workedVal + value);
	}

	/**
	 * Tells the progress bar the total amount of work that has been completed.
	 */
	setWorked(value: number): ProgressBar {
		value = Math.max(1, Number(value));

		return this.doSetWorked(value);
	}

	private doSetWorked(value: number): ProgressBar {
		const totalWork = this.totalWork || 100;

		this.workedVal = value;
		this.workedVal = Math.min(totalWork, this.workedVal);

		this.element.classList.remove(CSS_INFINITE, CSS_DONE);
		this.element.classList.add(CSS_ACTIVE, CSS_DISCRETE);
		this.element.setAttribute('aria-valuenow', value.toString());

		this.bit.style.width = 100 * (this.workedVal / (totalWork)) + '%';

		return this;
	}

	getContainer(): HTMLElement {
		return this.element;
	}

	show(delay?: number): void {
		this.showDelayedScheduler.cancel();

		if (typeof delay === 'number') {
			this.showDelayedScheduler.schedule(delay);
		} else {
			show(this.element);
		}
	}

	hide(): void {
		hide(this.element);
		this.showDelayedScheduler.cancel();
	}

	style(styles: IProgressBarStyles): void {
		this.progressBarBackground = styles.progressBarBackground;

		this.applyStyles();
	}

	protected applyStyles(): void {
		if (this.bit) {
			const background = this.progressBarBackground ? this.progressBarBackground.toString() : '';

			this.bit.style.backgroundColor = background;
		}
	}
}
