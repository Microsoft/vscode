/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerEditorContribution } from 'vs/editor/browser/editorExtensions';
import { CopyPasteActionController } from 'vs/editor/contrib/copyPasteAction/copyPasteActionController';


registerEditorContribution(CopyPasteActionController.ID, CopyPasteActionController);
