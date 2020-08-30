/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/extensionsWidgets';
import { Disposable, toDisposable, DisposableStore, MutableDisposable } from 'vs/base/common/lifecycle';
import { IExtension, IExtensionsWorkbenchService, IExtensionContainer } from 'vs/workbench/contrib/extensions/common/extensions';
import { append, $, addClass, removeNode } from 'vs/base/browser/dom';
import * as platform from 'vs/base/common/platform';
import { localize } from 'vs/nls';
import { IExtensionRecommendationsService, IExtensionManagementServerService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { ILabelService } from 'vs/platform/label/common/label';
import { extensionButtonProminentBackground, extensionButtonProminentForeground, ExtensionToolTipAction } from 'vs/workbench/contrib/extensions/browser/extensionsActions';
import { IThemeService, IColorTheme } from 'vs/platform/theme/common/themeService';
import { EXTENSION_BADGE_REMOTE_BACKGROUND, EXTENSION_BADGE_REMOTE_FOREGROUND } from 'vs/workbench/common/theme';
import { Emitter, Event } from 'vs/base/common/event';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { CountBadge } from 'vs/base/browser/ui/countBadge/countBadge';

export abstract class ExtensionWidget extends Disposable implements IExtensionContainer {
	private _extension: IExtension | null = null;
	get extension(): IExtension | null { return this._extension; }
	set extension(extension: IExtension | null) { this._extension = extension; this.update(); }
	update(): void { this.render(); }
	abstract render(): void;
}

export class Label extends ExtensionWidget {

	constructor(
		private element: HTMLElement,
		private fn: (extension: IExtension) => string,
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService
	) {
		super();
		this.render();
	}

	render(): void {
		this.element.textContent = this.extension ? this.fn(this.extension) : '';
	}
}

export class InstallCountWidget extends ExtensionWidget {

	constructor(
		private container: HTMLElement,
		private small: boolean,
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService
	) {
		super();
		addClass(container, 'extension-install-count');
		this.render();
	}

	render(): void {
		this.container.innerText = '';

		if (!this.extension) {
			return;
		}

		const installCount = this.extension.installCount;

		if (installCount === undefined) {
			return;
		}

		let installLabel: string;

		if (this.small) {
			if (installCount > 1000000) {
				installLabel = `${Math.floor(installCount / 100000) / 10}M`;
			} else if (installCount > 1000) {
				installLabel = `${Math.floor(installCount / 1000)}K`;
			} else {
				installLabel = String(installCount);
			}
		}
		else {
			installLabel = installCount.toLocaleString(platform.locale);
		}

		append(this.container, $('span.codicon.codicon-cloud-download'));
		const count = append(this.container, $('span.count'));
		count.textContent = installLabel;
	}
}

export class RatingsWidget extends ExtensionWidget {

	constructor(
		private container: HTMLElement,
		private small: boolean
	) {
		super();
		addClass(container, 'extension-ratings');

		if (this.small) {
			addClass(container, 'small');
		}

		this.render();
	}

	render(): void {
		this.container.innerText = '';

		if (!this.extension) {
			return;
		}

		if (this.extension.rating === undefined) {
			return;
		}

		if (this.small && !this.extension.ratingCount) {
			return;
		}

		const rating = Math.round(this.extension.rating * 2) / 2;

		if (this.small) {
			append(this.container, $('span.codicon.codicon-star-full'));

			const count = append(this.container, $('span.count'));
			count.textContent = String(rating);
		} else {
			for (let i = 1; i <= 5; i++) {
				if (rating >= i) {
					append(this.container, $('span.codicon.codicon-star-full'));
				} else if (rating >= i - 0.5) {
					append(this.container, $('span.codicon.codicon-star-half'));
				} else {
					append(this.container, $('span.codicon.codicon-star-empty'));
				}
			}
		}
		this.container.title = this.extension.ratingCount === 1 ? localize('ratedBySingleUser', "Rated by 1 user")
			: typeof this.extension.ratingCount === 'number' && this.extension.ratingCount > 1 ? localize('ratedByUsers', "Rated by {0} users", this.extension.ratingCount) : localize('noRating', "No rating");
	}
}

export class TooltipWidget extends ExtensionWidget {

	constructor(
		private readonly parent: HTMLElement,
		private readonly tooltipAction: ExtensionToolTipAction,
		private readonly recommendationWidget: RecommendationWidget,
		@ILabelService private readonly labelService: ILabelService
	) {
		super();
		this._register(Event.any<any>(
			this.tooltipAction.onDidChange,
			this.recommendationWidget.onDidChangeTooltip,
			this.labelService.onDidChangeFormatters
		)(() => this.render()));
	}

	render(): void {
		this.parent.title = this.getTooltip();
	}

	private getTooltip(): string {
		if (!this.extension) {
			return '';
		}
		if (this.tooltipAction.label) {
			return this.tooltipAction.label;
		}
		return this.recommendationWidget.tooltip;
	}

}

export class RecommendationWidget extends ExtensionWidget {

	private element?: HTMLElement;
	private readonly disposables = this._register(new DisposableStore());

	private _tooltip: string = '';
	get tooltip(): string { return this._tooltip; }
	set tooltip(tooltip: string) {
		if (this._tooltip !== tooltip) {
			this._tooltip = tooltip;
			this._onDidChangeTooltip.fire();
		}
	}
	private _onDidChangeTooltip: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidChangeTooltip: Event<void> = this._onDidChangeTooltip.event;

	constructor(
		private parent: HTMLElement,
		@IThemeService private readonly themeService: IThemeService,
		@IExtensionRecommendationsService private readonly extensionRecommendationsService: IExtensionRecommendationsService
	) {
		super();
		this.render();
		this._register(toDisposable(() => this.clear()));
		this._register(this.extensionRecommendationsService.onRecommendationChange(() => this.render()));
	}

	private clear(): void {
		this.tooltip = '';
		if (this.element) {
			this.parent.removeChild(this.element);
		}
		this.element = undefined;
		this.disposables.clear();
	}

	render(): void {
		this.clear();
		if (!this.extension) {
			return;
		}
		const extRecommendations = this.extensionRecommendationsService.getAllRecommendationsWithReason();
		if (extRecommendations[this.extension.identifier.id.toLowerCase()]) {
			this.element = append(this.parent, $('div.extension-bookmark'));
			const recommendation = append(this.element, $('.recommendation'));
			append(recommendation, $('span.codicon.codicon-star'));
			const applyBookmarkStyle = (theme: IColorTheme) => {
				const bgColor = theme.getColor(extensionButtonProminentBackground);
				const fgColor = theme.getColor(extensionButtonProminentForeground);
				recommendation.style.borderTopColor = bgColor ? bgColor.toString() : 'transparent';
				recommendation.style.color = fgColor ? fgColor.toString() : 'white';
			};
			applyBookmarkStyle(this.themeService.getColorTheme());
			this.themeService.onDidColorThemeChange(applyBookmarkStyle, this, this.disposables);
			this.tooltip = extRecommendations[this.extension.identifier.id.toLowerCase()].reasonText;
		}
	}

}

export class RemoteBadgeWidget extends ExtensionWidget {

	private readonly remoteBadge = this._register(new MutableDisposable<RemoteBadge>());

	private element: HTMLElement;

	constructor(
		parent: HTMLElement,
		private readonly tooltip: boolean,
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
		this.element = append(parent, $('.extension-remote-badge-container'));
		this.render();
		this._register(toDisposable(() => this.clear()));
	}

	private clear(): void {
		if (this.remoteBadge.value) {
			this.element.removeChild(this.remoteBadge.value.element);
		}
		this.remoteBadge.clear();
	}

	render(): void {
		this.clear();
		if (!this.extension || !this.extension.local || !this.extension.server || !(this.extensionManagementServerService.localExtensionManagementServer && this.extensionManagementServerService.remoteExtensionManagementServer) || this.extension.server !== this.extensionManagementServerService.remoteExtensionManagementServer) {
			return;
		}
		this.remoteBadge.value = this.instantiationService.createInstance(RemoteBadge, this.tooltip);
		append(this.element, this.remoteBadge.value.element);
	}
}

class RemoteBadge extends Disposable {

	readonly element: HTMLElement;

	constructor(
		private readonly tooltip: boolean,
		@ILabelService private readonly labelService: ILabelService,
		@IThemeService private readonly themeService: IThemeService,
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService
	) {
		super();
		this.element = $('div.extension-badge.extension-remote-badge');
		this.render();
	}

	private render(): void {
		append(this.element, $('span.codicon.codicon-remote'));

		const applyBadgeStyle = () => {
			if (!this.element) {
				return;
			}
			const bgColor = this.themeService.getColorTheme().getColor(EXTENSION_BADGE_REMOTE_BACKGROUND);
			const fgColor = this.themeService.getColorTheme().getColor(EXTENSION_BADGE_REMOTE_FOREGROUND);
			this.element.style.backgroundColor = bgColor ? bgColor.toString() : '';
			this.element.style.color = fgColor ? fgColor.toString() : '';
		};
		applyBadgeStyle();
		this._register(this.themeService.onDidColorThemeChange(() => applyBadgeStyle()));

		if (this.tooltip) {
			const updateTitle = () => {
				if (this.element && this.extensionManagementServerService.remoteExtensionManagementServer) {
					this.element.title = localize('remote extension title', "Extension in {0}", this.extensionManagementServerService.remoteExtensionManagementServer.label);
				}
			};
			this._register(this.labelService.onDidChangeFormatters(() => updateTitle()));
			updateTitle();
		}
	}
}

export class ExtensionPackCountWidget extends ExtensionWidget {

	private element: HTMLElement | undefined;

	constructor(
		private readonly parent: HTMLElement,
	) {
		super();
		this.render();
		this._register(toDisposable(() => this.clear()));
	}

	private clear(): void {
		if (this.element) {
			removeNode(this.element);
		}
	}

	render(): void {
		this.clear();
		if (!this.extension || !this.extension.extensionPack.length) {
			return;
		}
		this.element = append(this.parent, $('.extension-badge.extension-pack-badge'));
		const countBadge = new CountBadge(this.element);
		countBadge.setCount(this.extension.extensionPack.length);
	}
}
