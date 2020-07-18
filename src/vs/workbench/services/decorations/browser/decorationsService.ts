/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { Event, Emitter } from 'vs/base/common/event';
import { IDecorationsService, IDecoration, IResourceDecorationChangeEvent, IDecorationsProvider, IDecorationData } from './decorations';
import { TernarySearchTree } from 'vs/base/common/map';
import { IDisposable, toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { isThenable } from 'vs/base/common/async';
import { LinkedList } from 'vs/base/common/linkedList';
import { createStyleSheet, createCSSRule, removeCSSRulesContainingSelector } from 'vs/base/browser/dom';
import { IThemeService, IColorTheme } from 'vs/platform/theme/common/themeService';
import { isFalsyOrWhitespace } from 'vs/base/common/strings';
import { localize } from 'vs/nls';
import { isPromiseCanceledError } from 'vs/base/common/errors';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';
import { hash } from 'vs/base/common/hash';

class DecorationRule {

	static keyOf(data: IDecorationData | IDecorationData[]): string {
		if (Array.isArray(data)) {
			return data.map(DecorationRule.keyOf).join(',');
		} else {
			const { color, letter } = data;
			return `${color}/${letter}`;
		}
	}

	private static readonly _classNamesPrefix = 'monaco-decoration';

	readonly data: IDecorationData | IDecorationData[];
	readonly itemColorClassName: string;
	readonly itemBadgeClassName: string;
	readonly bubbleBadgeClassName: string;

	private _refCounter: number = 0;

	constructor(data: IDecorationData | IDecorationData[], key: string) {
		this.data = data;
		const suffix = hash(key).toString(36);
		this.itemColorClassName = `${DecorationRule._classNamesPrefix}-itemColor-${suffix}`;
		this.itemBadgeClassName = `${DecorationRule._classNamesPrefix}-itemBadge-${suffix}`;
		this.bubbleBadgeClassName = `${DecorationRule._classNamesPrefix}-bubbleBadge-${suffix}`;
	}

	acquire(): void {
		this._refCounter += 1;
	}

	release(): boolean {
		return --this._refCounter === 0;
	}

	appendCSSRules(element: HTMLStyleElement, theme: IColorTheme): void {
		if (!Array.isArray(this.data)) {
			this._appendForOne(this.data, element, theme);
		} else {
			this._appendForMany(this.data, element, theme);
		}
	}

	private _appendForOne(data: IDecorationData, element: HTMLStyleElement, theme: IColorTheme): void {
		const { color, letter } = data;
		// label
		createCSSRule(`.${this.itemColorClassName}`, `color: ${getColor(theme, color)};`, element);
		// letter
		if (letter) {
			createCSSRule(`.${this.itemBadgeClassName}::after`, `content: "${letter}"; color: ${getColor(theme, color)};`, element);
		}
	}

	private _appendForMany(data: IDecorationData[], element: HTMLStyleElement, theme: IColorTheme): void {
		// label
		const { color } = data[0];
		createCSSRule(`.${this.itemColorClassName}`, `color: ${getColor(theme, color)};`, element);

		// badge
		const letters = data.filter(d => !isFalsyOrWhitespace(d.letter)).map(d => d.letter);
		if (letters.length) {
			createCSSRule(`.${this.itemBadgeClassName}::after`, `content: "${letters.join(', ')}"; color: ${getColor(theme, color)};`, element);
		}

		// bubble badge
		// TODO @misolori update bubble badge to use class name instead of unicode
		createCSSRule(
			`.${this.bubbleBadgeClassName}::after`,
			`content: "\uea71"; color: ${getColor(theme, color)}; font-family: codicon; font-size: 14px; padding-right: 14px; opacity: 0.4;`,
			element
		);
	}

	removeCSSRules(element: HTMLStyleElement): void {
		removeCSSRulesContainingSelector(this.itemColorClassName, element);
		removeCSSRulesContainingSelector(this.itemBadgeClassName, element);
		removeCSSRulesContainingSelector(this.bubbleBadgeClassName, element);
	}
}

class DecorationStyles {

	private readonly _styleElement = createStyleSheet();
	private readonly _decorationRules = new Map<string, DecorationRule>();
	private readonly _dispoables = new DisposableStore();

	constructor(
		private _themeService: IThemeService,
	) {
		this._themeService.onDidColorThemeChange(this._onThemeChange, this, this._dispoables);
	}

	dispose(): void {
		this._dispoables.dispose();
		this._styleElement.remove();
	}

	asDecoration(data: IDecorationData[], onlyChildren: boolean): IDecoration {

		// sort by weight
		data.sort((a, b) => (b.weight || 0) - (a.weight || 0));

		let key = DecorationRule.keyOf(data);
		let rule = this._decorationRules.get(key);

		if (!rule) {
			// new css rule
			rule = new DecorationRule(data, key);
			this._decorationRules.set(key, rule);
			rule.appendCSSRules(this._styleElement, this._themeService.getColorTheme());
		}

		rule.acquire();

		let labelClassName = rule.itemColorClassName;
		let badgeClassName = rule.itemBadgeClassName;
		let tooltip = data.filter(d => !isFalsyOrWhitespace(d.tooltip)).map(d => d.tooltip).join(' • ');

		if (onlyChildren) {
			// show items from its children only
			badgeClassName = rule.bubbleBadgeClassName;
			tooltip = localize('bubbleTitle', "Contains emphasized items");
		}

		return {
			labelClassName,
			badgeClassName,
			tooltip,
			dispose: () => {
				if (rule && rule.release()) {
					this._decorationRules.delete(key);
					rule.removeCSSRules(this._styleElement);
					rule = undefined;
				}
			}
		};
	}

	private _onThemeChange(): void {
		this._decorationRules.forEach(rule => {
			rule.removeCSSRules(this._styleElement);
			rule.appendCSSRules(this._styleElement, this._themeService.getColorTheme());
		});
	}
}

class FileDecorationChangeEvent implements IResourceDecorationChangeEvent {

	private readonly _data = TernarySearchTree.forUris<boolean>();

	affectsResource(uri: URI): boolean {
		return this._data.get(uri) || this._data.findSuperstr(uri) !== undefined;
	}

	static debouncer(last: FileDecorationChangeEvent | undefined, current: URI | URI[]) {
		if (!last) {
			last = new FileDecorationChangeEvent();
		}
		if (Array.isArray(current)) {
			// many
			for (const uri of current) {
				last._data.set(uri, true);
			}
		} else {
			// one
			last._data.set(current, true);
		}

		return last;
	}
}

class DecorationDataRequest {
	constructor(
		readonly source: CancellationTokenSource,
		readonly thenable: Promise<void>,
	) { }
}

class DecorationProviderWrapper {

	readonly data = TernarySearchTree.forUris<DecorationDataRequest | IDecorationData | null>();
	private readonly _dispoable: IDisposable;

	constructor(
		readonly provider: IDecorationsProvider,
		private readonly _uriEmitter: Emitter<URI | URI[]>,
		private readonly _flushEmitter: Emitter<IResourceDecorationChangeEvent>,
		@ILogService private readonly _logService: ILogService,
	) {
		this._dispoable = this.provider.onDidChange(uris => {
			if (!uris) {
				// flush event -> drop all data, can affect everything
				this.data.clear();
				this._flushEmitter.fire({ affectsResource() { return true; } });

			} else {
				// selective changes -> drop for resource, fetch again, send event
				// perf: the map stores thenables, decorations, or `null`-markers.
				// we make us of that and ignore all uris in which we have never
				// been interested.
				for (const uri of uris) {
					this._fetchData(uri);
				}
			}
		});
	}

	dispose(): void {
		this._dispoable.dispose();
		this.data.clear();
	}

	knowsAbout(uri: URI): boolean {
		return Boolean(this.data.get(uri)) || Boolean(this.data.findSuperstr(uri));
	}

	getOrRetrieve(uri: URI, includeChildren: boolean, callback: (data: IDecorationData, isChild: boolean) => void): void {
		let item = this.data.get(uri);

		if (item === undefined) {
			// unknown -> trigger request
			this._logService.trace('[Decorations] getOrRetrieve -> FETCH', this.provider.label, uri);
			item = this._fetchData(uri);
		}

		if (item && !(item instanceof DecorationDataRequest)) {
			// found something (which isn't pending anymore)
			this._logService.trace('[Decorations] getOrRetrieve -> RESULT', this.provider.label, uri);
			callback(item, false);
		}

		if (includeChildren) {
			// (resolved) children
			const iter = this.data.findSuperstr(uri);
			if (iter) {
				for (let item = iter.next(); !item.done; item = iter.next()) {
					if (item.value && !(item.value instanceof DecorationDataRequest)) {
						this._logService.trace('[Decorations] getOrRetrieve -> RESULT (children)', this.provider.label, uri);
						callback(item.value, true);
					}
				}
			}
		}
	}

	private _fetchData(uri: URI): IDecorationData | null {

		// check for pending request and cancel it
		const pendingRequest = this.data.get(uri);
		if (pendingRequest instanceof DecorationDataRequest) {
			this._logService.trace('[Decorations] fetchData -> CANCEL previous', this.provider.label, uri);
			pendingRequest.source.cancel();
			this.data.delete(uri);
		}

		const source = new CancellationTokenSource();
		const dataOrThenable = this.provider.provideDecorations(uri, source.token);
		if (!isThenable<IDecorationData | Promise<IDecorationData | undefined> | undefined>(dataOrThenable)) {
			// sync -> we have a result now
			return this._keepItem(uri, dataOrThenable);

		} else {
			// async -> we have a result soon
			const request = new DecorationDataRequest(source, Promise.resolve(dataOrThenable).then(data => {
				if (this.data.get(uri) === request) {
					this._keepItem(uri, data);
				}
			}).catch(err => {
				if (!isPromiseCanceledError(err) && this.data.get(uri) === request) {
					this.data.delete(uri);
				}
			}));

			this.data.set(uri, request);
			return null;
		}
	}

	private _keepItem(uri: URI, data: IDecorationData | undefined): IDecorationData | null {
		this._logService.trace('[Decorations] keepItem -> CANCEL previous', this.provider.label, uri, data);
		const deco = data ? data : null;
		const old = this.data.set(uri, deco);
		if (deco || old) {
			// only fire event when something changed
			this._uriEmitter.fire(uri);
		}
		return deco;
	}
}

export class DecorationsService implements IDecorationsService {

	declare readonly _serviceBrand: undefined;

	private readonly _data = new LinkedList<DecorationProviderWrapper>();
	private readonly _onDidChangeDecorationsDelayed = new Emitter<URI | URI[]>();
	private readonly _onDidChangeDecorations = new Emitter<IResourceDecorationChangeEvent>();
	private readonly _decorationStyles: DecorationStyles;

	readonly onDidChangeDecorations: Event<IResourceDecorationChangeEvent> = Event.any(
		this._onDidChangeDecorations.event,
		Event.debounce<URI | URI[], FileDecorationChangeEvent>(
			this._onDidChangeDecorationsDelayed.event,
			FileDecorationChangeEvent.debouncer,
			undefined, undefined, 500
		)
	);

	constructor(
		@IThemeService themeService: IThemeService,
		@ILogService private readonly _logService: ILogService,
	) {
		this._decorationStyles = new DecorationStyles(themeService);
	}

	dispose(): void {
		this._decorationStyles.dispose();
		this._onDidChangeDecorations.dispose();
		this._onDidChangeDecorationsDelayed.dispose();
	}

	registerDecorationsProvider(provider: IDecorationsProvider): IDisposable {

		const wrapper = new DecorationProviderWrapper(
			provider,
			this._onDidChangeDecorationsDelayed,
			this._onDidChangeDecorations,
			this._logService
		);
		const remove = this._data.push(wrapper);

		this._onDidChangeDecorations.fire({
			// everything might have changed
			affectsResource() { return true; }
		});

		return toDisposable(() => {
			// fire event that says 'yes' for any resource
			// known to this provider. then dispose and remove it.
			remove();
			this._onDidChangeDecorations.fire({ affectsResource: uri => wrapper.knowsAbout(uri) });
			wrapper.dispose();
		});
	}

	getDecoration(uri: URI, includeChildren: boolean): IDecoration | undefined {
		let data: IDecorationData[] = [];
		let containsChildren: boolean = false;
		for (let wrapper of this._data) {
			wrapper.getOrRetrieve(uri, includeChildren, (deco, isChild) => {
				if (!isChild || deco.bubble) {
					data.push(deco);
					containsChildren = isChild || containsChildren;
					this._logService.trace('DecorationsService#getDecoration#getOrRetrieve', wrapper.provider.label, deco, isChild, uri);
				}
			});
		}
		return data.length === 0
			? undefined
			: this._decorationStyles.asDecoration(data, containsChildren);
	}
}
function getColor(theme: IColorTheme, color: string | undefined) {
	if (color) {
		const foundColor = theme.getColor(color);
		if (foundColor) {
			return foundColor;
		}
	}
	return 'inherit';
}

registerSingleton(IDecorationsService, DecorationsService, true);
