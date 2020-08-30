/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface XTermCore {
	_onScroll: IEventEmitter<number>;
	_onKey: IEventEmitter<{ key: string }>;

	_charSizeService: {
		width: number;
		height: number;
	};

	_coreService: {
		triggerDataEvent(data: string, wasUserInput?: boolean): void;
	};

	_renderService: {
		dimensions: {
			actualCellWidth: number;
			actualCellHeight: number;
		},
		_renderer: {
			_renderLayers: any[];
		};
		_onIntersectionChange: any;
	};
}

export interface IEventEmitter<T> {
	fire(e: T): void;
}
