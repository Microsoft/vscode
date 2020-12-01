/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Color } from 'vs/base/common/color';
import { IDisposable, toDisposable, Disposable } from 'vs/base/common/lifecycle';
import * as platform from 'vs/platform/registry/common/platform';
import { ColorIdentifier } from 'vs/platform/theme/common/colorRegistry';
import { Event, Emitter } from 'vs/base/common/event';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ColorScheme } from 'vs/platform/theme/common/theme';
import { CSSIcon } from 'vs/base/common/codicons';

export const IThemeService = createDecorator<IThemeService>('themeService');

export interface ThemeColor {
	id: string;
}

export namespace ThemeColor {
	export function isThemeColor(obj: any): obj is ThemeColor {
		return obj && typeof obj === 'object' && typeof (<ThemeColor>obj).id === 'string';
	}
}

export function themeColorFromId(id: ColorIdentifier) {
	return { id };
}

// theme icon
export interface ThemeIcon {
	readonly id: string;
	readonly color?: ThemeColor;
}

export namespace ThemeIcon {
	export function isThemeIcon(obj: any): obj is ThemeIcon {
		return obj && typeof obj === 'object' && typeof (<ThemeIcon>obj).id === 'string' && (typeof (<ThemeIcon>obj).color === 'undefined' || ThemeColor.isThemeColor((<ThemeIcon>obj).color));
	}

	const _regexFromString = /^\$\(([a-z.]+\/)?([a-z-~]+)\)$/i;

	export function fromString(str: string): ThemeIcon | undefined {
		const match = _regexFromString.exec(str);
		if (!match) {
			return undefined;
		}
		let [, owner, name] = match;
		if (!owner || owner === 'codicon/') {
			return { id: name };
		}
		return { id: owner + name };
	}

	export function modify(icon: ThemeIcon, modifier: 'disabled' | 'spin' | undefined): ThemeIcon {
		let id = icon.id;
		const tildeIndex = id.lastIndexOf('~');
		if (tildeIndex !== -1) {
			id = id.substring(0, tildeIndex);
		}
		if (modifier) {
			id = `${id}~${modifier}`;
		}
		return { id };
	}

	export function isEqual(ti1: ThemeIcon, ti2: ThemeIcon): boolean {
		return ti1.id === ti2.id && ti1.color?.id === ti2.color?.id;
	}

	const _regexAsClassName = /^(codicon\/)?([a-z-]+)(~[a-z]+)?$/i;

	export function asClassNameArray(icon: ThemeIcon): string[] {
		const match = _regexAsClassName.exec(icon.id);
		if (!match) {
			return ['codicon', 'codicon-error'];
		}
		let [, , name, modifier] = match;
		let className = `codicon-${name}`;
		if (modifier) {
			return ['codicon', className, modifier.substr(1)];
		}
		return ['codicon', className];
	}


	export function asClassName(icon: ThemeIcon): string {
		return asClassNameArray(icon).join(' ');
	}

	export function asCSSSelector(icon: ThemeIcon): string {
		return '.' + asClassNameArray(icon).join('.');
	}

	export function asCSSIcon(icon: ThemeIcon): CSSIcon {
		return {
			classNames: asClassName(icon)
		};
	}

	export function asCodiconLabel(icon: ThemeIcon): string {
		return '$(' + icon.id + ')';
	}

	export function revive(icon: any): ThemeIcon | undefined {
		if (ThemeIcon.isThemeIcon(icon)) {
			return { id: icon.id, color: icon.color ? { id: icon.color.id } : undefined };
		}
		return undefined;
	}
}

export const FileThemeIcon = { id: 'file' };
export const FolderThemeIcon = { id: 'folder' };

export function getThemeTypeSelector(type: ColorScheme): string {
	switch (type) {
		case ColorScheme.DARK: return 'vs-dark';
		case ColorScheme.HIGH_CONTRAST: return 'hc-black';
		default: return 'vs';
	}
}

export interface ITokenStyle {
	readonly foreground?: number;
	readonly bold?: boolean;
	readonly underline?: boolean;
	readonly italic?: boolean;
}

export interface IColorTheme {

	readonly type: ColorScheme;

	readonly label: string;

	/**
	 * Resolves the color of the given color identifier. If the theme does not
	 * specify the color, the default color is returned unless <code>useDefault</code> is set to false.
	 * @param color the id of the color
	 * @param useDefault specifies if the default color should be used. If not set, the default is used.
	 */
	getColor(color: ColorIdentifier, useDefault?: boolean): Color | undefined;

	/**
	 * Returns whether the theme defines a value for the color. If not, that means the
	 * default color will be used.
	 */
	defines(color: ColorIdentifier): boolean;

	/**
	 * Returns the token style for a given classification. The result uses the <code>MetadataConsts</code> format
	 */
	getTokenStyleMetadata(type: string, modifiers: string[], modelLanguage: string): ITokenStyle | undefined;

	/**
	 * List of all colors used with tokens. <code>getTokenStyleMetadata</code> references the colors by index into this list.
	 */
	readonly tokenColorMap: string[];

	/**
	 * Defines whether semantic highlighting should be enabled for the theme.
	 */
	readonly semanticHighlighting: boolean;
}

export interface IFileIconTheme {
	readonly hasFileIcons: boolean;
	readonly hasFolderIcons: boolean;
	readonly hidesExplorerArrows: boolean;
}

export interface ICssStyleCollector {
	addRule(rule: string): void;
}

export interface IThemingParticipant {
	(theme: IColorTheme, collector: ICssStyleCollector, environment: IEnvironmentService): void;
}

export interface IThemeService {
	readonly _serviceBrand: undefined;

	getColorTheme(): IColorTheme;

	readonly onDidColorThemeChange: Event<IColorTheme>;

	getFileIconTheme(): IFileIconTheme;

	readonly onDidFileIconThemeChange: Event<IFileIconTheme>;

}

// static theming participant
export const Extensions = {
	ThemingContribution: 'base.contributions.theming'
};

export interface IThemingRegistry {

	/**
	 * Register a theming participant that is invoked on every theme change.
	 */
	onColorThemeChange(participant: IThemingParticipant): IDisposable;

	getThemingParticipants(): IThemingParticipant[];

	readonly onThemingParticipantAdded: Event<IThemingParticipant>;
}

class ThemingRegistry implements IThemingRegistry {
	private themingParticipants: IThemingParticipant[] = [];
	private readonly onThemingParticipantAddedEmitter: Emitter<IThemingParticipant>;

	constructor() {
		this.themingParticipants = [];
		this.onThemingParticipantAddedEmitter = new Emitter<IThemingParticipant>();
	}

	public onColorThemeChange(participant: IThemingParticipant): IDisposable {
		this.themingParticipants.push(participant);
		this.onThemingParticipantAddedEmitter.fire(participant);
		return toDisposable(() => {
			const idx = this.themingParticipants.indexOf(participant);
			this.themingParticipants.splice(idx, 1);
		});
	}

	public get onThemingParticipantAdded(): Event<IThemingParticipant> {
		return this.onThemingParticipantAddedEmitter.event;
	}

	public getThemingParticipants(): IThemingParticipant[] {
		return this.themingParticipants;
	}
}

let themingRegistry = new ThemingRegistry();
platform.Registry.add(Extensions.ThemingContribution, themingRegistry);

export function registerThemingParticipant(participant: IThemingParticipant): IDisposable {
	return themingRegistry.onColorThemeChange(participant);
}

/**
 * Utility base class for all themable components.
 */
export class Themable extends Disposable {
	protected theme: IColorTheme;

	constructor(
		protected themeService: IThemeService
	) {
		super();

		this.theme = themeService.getColorTheme();

		// Hook up to theme changes
		this._register(this.themeService.onDidColorThemeChange(theme => this.onThemeChange(theme)));
	}

	protected onThemeChange(theme: IColorTheme): void {
		this.theme = theme;

		this.updateStyles();
	}

	protected updateStyles(): void {
		// Subclasses to override
	}

	protected getColor(id: string, modify?: (color: Color, theme: IColorTheme) => Color): string | null {
		let color = this.theme.getColor(id);

		if (color && modify) {
			color = modify(color, this.theme);
		}

		return color ? color.toString() : null;
	}
}
