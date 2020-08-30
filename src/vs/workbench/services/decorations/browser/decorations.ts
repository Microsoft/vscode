/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { URI } from 'vs/base/common/uri';
import { Event } from 'vs/base/common/event';
import { ColorIdentifier } from 'vs/platform/theme/common/colorRegistry';
import { IDisposable } from 'vs/base/common/lifecycle';
import { CancellationToken } from 'vs/base/common/cancellation';

export const IDecorationsService = createDecorator<IDecorationsService>('IFileDecorationsService');

export interface IDecorationData {
	readonly weight?: number;
	readonly color?: ColorIdentifier;
	readonly letter?: string;
	readonly tooltip?: string;
	readonly bubble?: boolean;
}

export interface IDecoration extends IDisposable {
	readonly tooltip: string;
	readonly labelClassName: string;
	readonly badgeClassName: string;
}

export interface IDecorationsProvider {
	readonly label: string;
	readonly onDidChange: Event<readonly URI[]>;
	provideDecorations(uri: URI, token: CancellationToken): IDecorationData | Promise<IDecorationData | undefined> | undefined;
}

export interface IResourceDecorationChangeEvent {
	affectsResource(uri: URI): boolean;
}

export interface IDecorationsService {

	readonly _serviceBrand: undefined;

	readonly onDidChangeDecorations: Event<IResourceDecorationChangeEvent>;

	registerDecorationsProvider(provider: IDecorationsProvider): IDisposable;

	getDecoration(uri: URI, includeChildren: boolean): IDecoration | undefined;
}
