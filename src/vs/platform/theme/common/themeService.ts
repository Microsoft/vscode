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

export const IThemeService = createDecorator<IThemeService>('themeService');

export interface ThemeColor {
	id: string;
}

export function themeColorFromId(id: ColorIdentifier) {
	return { id };
}

// theme icon
export interface ThemeIcon {
	readonly id: string;
}

export namespace ThemeIcon {
	export function isThemeIcon(obj: any): obj is ThemeIcon {
		return obj && typeof obj === 'object' && typeof (<ThemeIcon>obj).id === 'string';
	}

	const _regexFromString = /^\$\(([a-z.]+\/)?([a-z-~]+)\)$/i;

	export function fromString(str: string): ThemeIcon | undefined {
		const match = _regexFromString.exec(str);
		if (!match) {
			return undefined;
		}
		let [, owner, name] = match;
		if (!owner) {
			owner = `codicon/`;
		}
		return { id: owner + name };
	}

	const _regexAsClassName = /^(codicon\/)?([a-z-]+)(~[a-z]+)?$/i;

	export function asClassName(icon: ThemeIcon): string | undefined {
		// todo@martin,joh -> this should go into the ThemeService
		const match = _regexAsClassName.exec(icon.id);
		if (!match) {
			return undefined;
		}
		let [, , name, modifier] = match;
		let className = `codicon codicon-${name}`;
		if (modifier) {
			className += ` ${modifier.substr(1)}`;
		}
		return className;
	}
}

export const FileThemeIcon = { id: 'file' };
export const FolderThemeIcon = { id: 'folder' };

// base themes
export const DARK: ThemeType = 'dark';
export const LIGHT: ThemeType = 'light';
export const HIGH_CONTRAST: ThemeType = 'hc';
export type ThemeType = 'light' | 'dark' | 'hc';

export function getThemeTypeSelector(type: ThemeType): string {
	switch (type) {
		case DARK: return 'vs-dark';
		case HIGH_CONTRAST: return 'hc-black';
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

	readonly type: ThemeType;

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
