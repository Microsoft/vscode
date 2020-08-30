/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';

export const FindInFilesActionId = 'workbench.action.findInFiles';
export const FocusActiveEditorCommandId = 'search.action.focusActiveEditor';

export const FocusSearchFromResults = 'search.action.focusSearchFromResults';
export const OpenMatch = 'search.action.openResult';
export const OpenMatchToSide = 'search.action.openResultToSide';
export const CancelActionId = 'search.action.cancel';
export const RemoveActionId = 'search.action.remove';
export const CopyPathCommandId = 'search.action.copyPath';
export const CopyMatchCommandId = 'search.action.copyMatch';
export const CopyAllCommandId = 'search.action.copyAll';
export const OpenInEditorCommandId = 'search.action.openInEditor';
export const ClearSearchHistoryCommandId = 'search.action.clearHistory';
export const FocusSearchListCommandID = 'search.action.focusSearchList';
export const ReplaceActionId = 'search.action.replace';
export const ReplaceAllInFileActionId = 'search.action.replaceAllInFile';
export const ReplaceAllInFolderActionId = 'search.action.replaceAllInFolder';
export const CloseReplaceWidgetActionId = 'closeReplaceInFilesWidget';
export const ToggleCaseSensitiveCommandId = 'toggleSearchCaseSensitive';
export const ToggleWholeWordCommandId = 'toggleSearchWholeWord';
export const ToggleRegexCommandId = 'toggleSearchRegex';
export const AddCursorsAtSearchResults = 'addCursorsAtSearchResults';
export const RevealInSideBarForSearchResults = 'search.action.revealInSideBar';

export const SearchViewVisibleKey = new RawContextKey<boolean>('searchViewletVisible', true);
export const SearchViewFocusedKey = new RawContextKey<boolean>('searchViewletFocus', false);
export const InputBoxFocusedKey = new RawContextKey<boolean>('inputBoxFocus', false);
export const SearchInputBoxFocusedKey = new RawContextKey<boolean>('searchInputBoxFocus', false);
export const ReplaceInputBoxFocusedKey = new RawContextKey<boolean>('replaceInputBoxFocus', false);
export const PatternIncludesFocusedKey = new RawContextKey<boolean>('patternIncludesInputBoxFocus', false);
export const PatternExcludesFocusedKey = new RawContextKey<boolean>('patternExcludesInputBoxFocus', false);
export const ReplaceActiveKey = new RawContextKey<boolean>('replaceActive', false);
export const HasSearchResults = new RawContextKey<boolean>('hasSearchResult', false);
export const FirstMatchFocusKey = new RawContextKey<boolean>('firstMatchFocus', false);
export const FileMatchOrMatchFocusKey = new RawContextKey<boolean>('fileMatchOrMatchFocus', false); // This is actually, Match or File or Folder
export const FileMatchOrFolderMatchFocusKey = new RawContextKey<boolean>('fileMatchOrFolderMatchFocus', false);
export const FileMatchOrFolderMatchWithResourceFocusKey = new RawContextKey<boolean>('fileMatchOrFolderMatchWithResourceFocus', false); // Excludes "Other files"
export const FileFocusKey = new RawContextKey<boolean>('fileMatchFocus', false);
export const FolderFocusKey = new RawContextKey<boolean>('folderMatchFocus', false);
export const MatchFocusKey = new RawContextKey<boolean>('matchFocus', false);
