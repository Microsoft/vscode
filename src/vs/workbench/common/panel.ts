/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IComposite } from 'vs/workbench/common/composite';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';

export const ActivePanelContext = new RawContextKey<string>('activePanel', '');
export const PanelFocusContext = new RawContextKey<boolean>('panelFocus', false);
export const PanelPositionContext = new RawContextKey<string>('panelPosition', 'bottom');

export interface IPanel extends IComposite { }
