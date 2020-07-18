/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/editor/browser/controller/coreCommands';
import 'vs/editor/browser/widget/codeEditorWidget';
import 'vs/editor/browser/widget/diffEditorWidget';
import 'vs/editor/browser/widget/diffNavigator';
import 'vs/editor/contrib/anchorSelect/anchorSelect';
import 'vs/editor/contrib/bracketMatching/bracketMatching';
import 'vs/editor/contrib/caretOperations/caretOperations';
import 'vs/editor/contrib/caretOperations/transpose';
import 'vs/editor/contrib/clipboard/clipboard';
import 'vs/editor/contrib/codeAction/codeActionContributions';
import 'vs/editor/contrib/codelens/codelensController';
import 'vs/editor/contrib/colorPicker/colorDetector';
import 'vs/editor/contrib/comment/comment';
import 'vs/editor/contrib/contextmenu/contextmenu';
import 'vs/editor/contrib/cursorUndo/cursorUndo';
import 'vs/editor/contrib/dnd/dnd';
import 'vs/editor/contrib/find/findController';
import 'vs/editor/contrib/folding/folding';
import 'vs/editor/contrib/fontZoom/fontZoom';
import 'vs/editor/contrib/format/formatActions';
import 'vs/editor/contrib/gotoSymbol/documentSymbols';
import 'vs/editor/contrib/gotoSymbol/goToCommands';
import 'vs/editor/contrib/gotoSymbol/link/goToDefinitionAtPosition';
import 'vs/editor/contrib/gotoError/gotoError';
import 'vs/editor/contrib/hover/hover';
import 'vs/editor/contrib/indentation/indentation';
import 'vs/editor/contrib/inPlaceReplace/inPlaceReplace';
import 'vs/editor/contrib/linesOperations/linesOperations';
import 'vs/editor/contrib/links/links';
import 'vs/editor/contrib/multicursor/multicursor';
import 'vs/editor/contrib/parameterHints/parameterHints';
import 'vs/editor/contrib/rename/onTypeRename';
import 'vs/editor/contrib/rename/rename';
import 'vs/editor/contrib/smartSelect/smartSelect';
import 'vs/editor/contrib/snippet/snippetController2';
import 'vs/editor/contrib/suggest/suggestController';
import 'vs/editor/contrib/tokenization/tokenization';
import 'vs/editor/contrib/toggleTabFocusMode/toggleTabFocusMode';
import 'vs/editor/contrib/unusualLineTerminators/unusualLineTerminators';
import 'vs/editor/contrib/viewportSemanticTokens/viewportSemanticTokens';
import 'vs/editor/contrib/wordHighlighter/wordHighlighter';
import 'vs/editor/contrib/wordOperations/wordOperations';
import 'vs/editor/contrib/wordPartOperations/wordPartOperations';

// Load up these strings even in VSCode, even if they are not used
// in order to get them translated
import 'vs/editor/common/standaloneStrings';

import 'vs/base/browser/ui/codicons/codiconStyles'; // The codicons are defined here and must be loaded
