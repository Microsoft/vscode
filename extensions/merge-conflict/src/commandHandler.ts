/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as vscode from 'vscode';
import * as interfaces from './interfaces';
import ContentProvider from './contentProvider';
import { loadMessageBundle } from 'vscode-nls';
const localize = loadMessageBundle();

interface IDocumentMergeConflictNavigationResults {
	canNavigate: boolean;
	conflict?: interfaces.IDocumentMergeConflict;
}

enum NavigationDirection {
	Forwards,
	Backwards
}

export default class CommandHandler implements vscode.Disposable {

	private disposables: vscode.Disposable[] = [];
	private tracker: interfaces.IDocumentMergeConflictTracker;

	constructor(trackerService: interfaces.IDocumentMergeConflictTrackerService) {
		this.tracker = trackerService.createTracker('commands');
	}

	begin() {
		this.disposables.push(
			this.registerTextEditorCommand('merge-conflict.accept.current', this.acceptCurrent),
			this.registerTextEditorCommand('merge-conflict.accept.incoming', this.acceptIncoming),
			this.registerTextEditorCommand('merge-conflict.accept.selection', this.acceptSelection),
			this.registerTextEditorCommand('merge-conflict.accept.both', this.acceptBoth),
			this.registerTextEditorCommand('merge-conflict.accept.all-current', this.acceptAllCurrent, this.acceptAllCurrentResources),
			this.registerTextEditorCommand('merge-conflict.accept.all-incoming', this.acceptAllIncoming, this.acceptAllIncomingResources),
			this.registerTextEditorCommand('merge-conflict.accept.all-both', this.acceptAllBoth),
			this.registerTextEditorCommand('merge-conflict.next', this.navigateNext),
			this.registerTextEditorCommand('merge-conflict.previous', this.navigatePrevious),
			this.registerTextEditorCommand('merge-conflict.compare', this.compare)
		);
	}

	private registerTextEditorCommand(command: string, cb: (editor: vscode.TextEditor, ...args: any[]) => Promise<void>, resourceCB?: (uris: vscode.Uri[]) => Promise<void>) {
		return vscode.commands.registerCommand(command, (...args) => {
			if (resourceCB && args.length && args.every(arg => arg && arg.resourceUri)) {
				return resourceCB.call(this, args.map(arg => arg.resourceUri));
			}
			const editor = vscode.window.activeTextEditor;
			return editor && cb.call(this, editor, ...args);
		});
	}

	acceptCurrent(editor: vscode.TextEditor, ...args: any[]): Promise<void> {
		return this.accept(interfaces.CommitType.Current, editor, ...args);
	}

	acceptIncoming(editor: vscode.TextEditor, ...args: any[]): Promise<void> {
		return this.accept(interfaces.CommitType.Incoming, editor, ...args);
	}

	acceptBoth(editor: vscode.TextEditor, ...args: any[]): Promise<void> {
		return this.accept(interfaces.CommitType.Both, editor, ...args);
	}

	acceptAllCurrent(editor: vscode.TextEditor): Promise<void> {
		return this.acceptAll(interfaces.CommitType.Current, editor);
	}

	acceptAllIncoming(editor: vscode.TextEditor): Promise<void> {
		return this.acceptAll(interfaces.CommitType.Incoming, editor);
	}

	acceptAllCurrentResources(resources: vscode.Uri[]): Promise<void> {
		return this.acceptAllResources(interfaces.CommitType.Current, resources);
	}

	acceptAllIncomingResources(resources: vscode.Uri[]): Promise<void> {
		return this.acceptAllResources(interfaces.CommitType.Incoming, resources);
	}

	acceptAllBoth(editor: vscode.TextEditor): Promise<void> {
		return this.acceptAll(interfaces.CommitType.Both, editor);
	}

	async compare(editor: vscode.TextEditor, conflict: interfaces.IDocumentMergeConflict | null) {

		// No conflict, command executed from command palette
		if (!conflict) {
			conflict = await this.findConflictContainingSelection(editor);

			// Still failed to find conflict, warn the user and exit
			if (!conflict) {
				vscode.window.showWarningMessage(localize('cursorNotInConflict', 'Editor cursor is not within a merge conflict'));
				return;
			}
		}

		const conflicts = await this.tracker.getConflicts(editor.document);

		// Still failed to find conflict, warn the user and exit
		if (!conflicts) {
			vscode.window.showWarningMessage(localize('cursorNotInConflict', 'Editor cursor is not within a merge conflict'));
			return;
		}

		const scheme = editor.document.uri.scheme;
		let range = conflict.current.content;
		let leftRanges = conflicts.map(conflict => [conflict.current.content, conflict.range]);
		let rightRanges = conflicts.map(conflict => [conflict.incoming.content, conflict.range]);

		const leftUri = editor.document.uri.with({
			scheme: ContentProvider.scheme,
			query: JSON.stringify({ scheme, range: range, ranges: leftRanges })
		});


		range = conflict.incoming.content;
		const rightUri = leftUri.with({ query: JSON.stringify({ scheme, ranges: rightRanges }) });

		let mergeConflictLineOffsets = 0;
		for (let nextconflict of conflicts) {
			if (nextconflict.range.isEqual(conflict.range)) {
				break;
			} else {
				mergeConflictLineOffsets += (nextconflict.range.end.line - nextconflict.range.start.line) - (nextconflict.incoming.content.end.line - nextconflict.incoming.content.start.line);
			}
		}
		const selection = new vscode.Range(
			conflict.range.start.line - mergeConflictLineOffsets, conflict.range.start.character,
			conflict.range.start.line - mergeConflictLineOffsets, conflict.range.start.character
		);

		const docPath = editor.document.uri.path;
		const fileName = docPath.substring(docPath.lastIndexOf('/') + 1); // avoid NodeJS path to keep browser webpack small
		const title = localize('compareChangesTitle', '{0}: Current Changes ⟷ Incoming Changes', fileName);
		const mergeConflictConfig = vscode.workspace.getConfiguration('merge-conflict');
		const openToTheSide = mergeConflictConfig.get<string>('diffViewPosition');
		const opts: vscode.TextDocumentShowOptions = {
			viewColumn: openToTheSide === 'Beside' ? vscode.ViewColumn.Beside : vscode.ViewColumn.Active,
			selection
		};

		if (openToTheSide === 'Below') {
			await vscode.commands.executeCommand('workbench.action.newGroupBelow');
		}

		await vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title, opts);
	}

	navigateNext(editor: vscode.TextEditor): Promise<void> {
		return this.navigate(editor, NavigationDirection.Forwards);
	}

	navigatePrevious(editor: vscode.TextEditor): Promise<void> {
		return this.navigate(editor, NavigationDirection.Backwards);
	}

	async acceptSelection(editor: vscode.TextEditor): Promise<void> {
		let conflict = await this.findConflictContainingSelection(editor);

		if (!conflict) {
			vscode.window.showWarningMessage(localize('cursorNotInConflict', 'Editor cursor is not within a merge conflict'));
			return;
		}

		let typeToAccept: interfaces.CommitType;
		let tokenAfterCurrentBlock: vscode.Range = conflict.splitter;

		if (conflict.commonAncestors.length > 0) {
			tokenAfterCurrentBlock = conflict.commonAncestors[0].header;
		}

		// Figure out if the cursor is in current or incoming, we do this by seeing if
		// the active position is before or after the range of the splitter or common
		// ancestors marker. We can use this trick as the previous check in
		// findConflictByActiveSelection will ensure it's within the conflict range, so
		// we don't falsely identify "current" or "incoming" if outside of a conflict range.
		if (editor.selection.active.isBefore(tokenAfterCurrentBlock.start)) {
			typeToAccept = interfaces.CommitType.Current;
		}
		else if (editor.selection.active.isAfter(conflict.splitter.end)) {
			typeToAccept = interfaces.CommitType.Incoming;
		}
		else if (editor.selection.active.isBefore(conflict.splitter.start)) {
			vscode.window.showWarningMessage(localize('cursorOnCommonAncestorsRange', 'Editor cursor is within the common ancestors block, please move it to either the "current" or "incoming" block'));
			return;
		}
		else {
			vscode.window.showWarningMessage(localize('cursorOnSplitterRange', 'Editor cursor is within the merge conflict splitter, please move it to either the "current" or "incoming" block'));
			return;
		}

		this.tracker.forget(editor.document);
		conflict.commitEdit(typeToAccept, editor);
	}

	dispose() {
		this.disposables.forEach(disposable => disposable.dispose());
		this.disposables = [];
	}

	private async navigate(editor: vscode.TextEditor, direction: NavigationDirection): Promise<void> {
		let navigationResult = await this.findConflictForNavigation(editor, direction);

		if (!navigationResult) {
			// Check for autoNavigateNextConflict, if it's enabled(which indicating no conflict remain), then do not show warning
			const mergeConflictConfig = vscode.workspace.getConfiguration('merge-conflict');
			if (mergeConflictConfig.get<boolean>('autoNavigateNextConflict.enabled')) {
				return;
			}
			vscode.window.showWarningMessage(localize('noConflicts', 'No merge conflicts found in this file'));
			return;
		}
		else if (!navigationResult.canNavigate) {
			vscode.window.showWarningMessage(localize('noOtherConflictsInThisFile', 'No other merge conflicts within this file'));
			return;
		}
		else if (!navigationResult.conflict) {
			// TODO: Show error message?
			return;
		}

		// Move the selection to the first line of the conflict
		editor.selection = new vscode.Selection(navigationResult.conflict.range.start, navigationResult.conflict.range.start);
		editor.revealRange(navigationResult.conflict.range, vscode.TextEditorRevealType.Default);
	}

	private async accept(type: interfaces.CommitType, editor: vscode.TextEditor, ...args: any[]): Promise<void> {

		let conflict: interfaces.IDocumentMergeConflict | null;

		// If launched with known context, take the conflict from that
		if (args[0] === 'known-conflict') {
			conflict = args[1];
		}
		else {
			// Attempt to find a conflict that matches the current cursor position
			conflict = await this.findConflictContainingSelection(editor);
		}

		if (!conflict) {
			vscode.window.showWarningMessage(localize('cursorNotInConflict', 'Editor cursor is not within a merge conflict'));
			return;
		}

		// Tracker can forget as we know we are going to do an edit
		this.tracker.forget(editor.document);
		conflict.commitEdit(type, editor);

		// navigate to the next merge conflict
		const mergeConflictConfig = vscode.workspace.getConfiguration('merge-conflict');
		if (mergeConflictConfig.get<boolean>('autoNavigateNextConflict.enabled')) {
			this.navigateNext(editor);
		}

	}

	private async acceptAll(type: interfaces.CommitType, editor: vscode.TextEditor): Promise<void> {
		let conflicts = await this.tracker.getConflicts(editor.document);

		if (!conflicts || conflicts.length === 0) {
			vscode.window.showWarningMessage(localize('noConflicts', 'No merge conflicts found in this file'));
			return;
		}

		// For get the current state of the document, as we know we are doing to do a large edit
		this.tracker.forget(editor.document);

		// Apply all changes as one edit
		await editor.edit((edit) => conflicts.forEach(conflict => {
			conflict.applyEdit(type, editor.document, edit);
		}));
	}

	private async acceptAllResources(type: interfaces.CommitType, resources: vscode.Uri[]): Promise<void> {
		const documents = await Promise.all(resources.map(resource => vscode.workspace.openTextDocument(resource)));
		const edit = new vscode.WorkspaceEdit();
		for (const document of documents) {
			const conflicts = await this.tracker.getConflicts(document);

			if (!conflicts || conflicts.length === 0) {
				continue;
			}

			// For get the current state of the document, as we know we are doing to do a large edit
			this.tracker.forget(document);

			// Apply all changes as one edit
			conflicts.forEach(conflict => {
				conflict.applyEdit(type, document, { replace: (range, newText) => edit.replace(document.uri, range, newText) });
			});
		}
		vscode.workspace.applyEdit(edit);
	}

	private async findConflictContainingSelection(editor: vscode.TextEditor, conflicts?: interfaces.IDocumentMergeConflict[]): Promise<interfaces.IDocumentMergeConflict | null> {

		if (!conflicts) {
			conflicts = await this.tracker.getConflicts(editor.document);
		}

		if (!conflicts || conflicts.length === 0) {
			return null;
		}

		for (const conflict of conflicts) {
			if (conflict.range.contains(editor.selection.active)) {
				return conflict;
			}
		}

		return null;
	}

	private async findConflictForNavigation(editor: vscode.TextEditor, direction: NavigationDirection, conflicts?: interfaces.IDocumentMergeConflict[]): Promise<IDocumentMergeConflictNavigationResults | null> {
		if (!conflicts) {
			conflicts = await this.tracker.getConflicts(editor.document);
		}

		if (!conflicts || conflicts.length === 0) {
			return null;
		}

		let selection = editor.selection.active;
		if (conflicts.length === 1) {
			if (conflicts[0].range.contains(selection)) {
				return {
					canNavigate: false
				};
			}

			return {
				canNavigate: true,
				conflict: conflicts[0]
			};
		}

		let predicate: (_conflict: any) => boolean;
		let fallback: () => interfaces.IDocumentMergeConflict;
		let scanOrder: interfaces.IDocumentMergeConflict[];

		if (direction === NavigationDirection.Forwards) {
			predicate = (conflict) => selection.isBefore(conflict.range.start);
			fallback = () => conflicts![0];
			scanOrder = conflicts;
		} else if (direction === NavigationDirection.Backwards) {
			predicate = (conflict) => selection.isAfter(conflict.range.start);
			fallback = () => conflicts![conflicts!.length - 1];
			scanOrder = conflicts.slice().reverse();
		} else {
			throw new Error(`Unsupported direction ${direction}`);
		}

		for (const conflict of scanOrder) {
			if (predicate(conflict) && !conflict.range.contains(selection)) {
				return {
					canNavigate: true,
					conflict: conflict
				};
			}
		}

		// Went all the way to the end, return the head
		return {
			canNavigate: true,
			conflict: fallback()
		};
	}
}
