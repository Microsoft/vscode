/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as objects from 'vs/base/common/objects';
import { parse, JSONVisitor, visit } from 'vs/base/common/json';
import { setProperty, withFormatting, applyEdits } from 'vs/base/common/jsonEdit';
import { values } from 'vs/base/common/map';
import { IStringDictionary } from 'vs/base/common/collections';
import { FormattingOptions, Edit, getEOL } from 'vs/base/common/jsonFormatter';
import * as contentUtil from 'vs/platform/userDataSync/common/content';
import { IConflictSetting, getDisallowedIgnoredSettings } from 'vs/platform/userDataSync/common/userDataSync';
import { firstIndex, distinct } from 'vs/base/common/arrays';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { startsWith } from 'vs/base/common/strings';

export interface IMergeResult {
	localContent: string | null;
	remoteContent: string | null;
	hasConflicts: boolean;
	conflictsSettings: IConflictSetting[];
}

export function getIgnoredSettings(defaultIgnoredSettings: string[], configurationService: IConfigurationService, settingsContent?: string): string[] {
	let value: string[] = [];
	if (settingsContent) {
		const setting = parse(settingsContent);
		if (setting) {
			value = setting['sync.ignoredSettings'];
		}
	} else {
		value = configurationService.getValue<string[]>('sync.ignoredSettings');
	}
	const added: string[] = [], removed: string[] = [...getDisallowedIgnoredSettings()];
	if (Array.isArray(value)) {
		for (const key of value) {
			if (startsWith(key, '-')) {
				removed.push(key.substring(1));
			} else {
				added.push(key);
			}
		}
	}
	return distinct([...defaultIgnoredSettings, ...added,].filter(setting => removed.indexOf(setting) === -1));
}


export function updateIgnoredSettings(targetContent: string, sourceContent: string, ignoredSettings: string[], formattingOptions: FormattingOptions): string {
	if (ignoredSettings.length) {
		const sourceTree = parseSettings(sourceContent);
		const source = parse(sourceContent);
		const target = parse(targetContent);
		const settingsToAdd: INode[] = [];
		for (const key of ignoredSettings) {
			const sourceValue = source[key];
			const targetValue = target[key];

			// Remove in target
			if (sourceValue === undefined) {
				targetContent = contentUtil.edit(targetContent, [key], undefined, formattingOptions);
			}

			// Update in target
			else if (targetValue !== undefined) {
				targetContent = contentUtil.edit(targetContent, [key], sourceValue, formattingOptions);
			}

			else {
				settingsToAdd.push(findSettingNode(key, sourceTree)!);
			}
		}

		settingsToAdd.sort((a, b) => a.startOffset - b.startOffset);
		settingsToAdd.forEach(s => targetContent = addSetting(s.setting!.key, sourceContent, targetContent, formattingOptions));
	}
	return targetContent;
}

export function merge(originalLocalContent: string, originalRemoteContent: string, baseContent: string | null, ignoredSettings: string[], resolvedConflicts: { key: string, value: any | undefined }[], formattingOptions: FormattingOptions): IMergeResult {

	const localContentWithoutIgnoredSettings = updateIgnoredSettings(originalLocalContent, originalRemoteContent, ignoredSettings, formattingOptions);
	const localForwarded = baseContent !== localContentWithoutIgnoredSettings;
	const remoteForwarded = baseContent !== originalRemoteContent;

	/* no changes */
	if (!localForwarded && !remoteForwarded) {
		return { conflictsSettings: [], localContent: null, remoteContent: null, hasConflicts: false };
	}

	/* local has changed and remote has not */
	if (localForwarded && !remoteForwarded) {
		return { conflictsSettings: [], localContent: null, remoteContent: localContentWithoutIgnoredSettings, hasConflicts: false };
	}

	/* remote has changed and local has not */
	if (remoteForwarded && !localForwarded) {
		return { conflictsSettings: [], localContent: updateIgnoredSettings(originalRemoteContent, originalLocalContent, ignoredSettings, formattingOptions), remoteContent: null, hasConflicts: false };
	}

	/* local is empty and not synced before */
	if (baseContent === null && isEmpty(originalLocalContent)) {
		const localContent = areSame(originalLocalContent, originalRemoteContent, ignoredSettings) ? null : updateIgnoredSettings(originalRemoteContent, originalLocalContent, ignoredSettings, formattingOptions);
		return { conflictsSettings: [], localContent, remoteContent: null, hasConflicts: false };
	}

	/* remote and local has changed */
	let localContent = originalLocalContent;
	let remoteContent = originalRemoteContent;
	const local = parse(originalLocalContent);
	const remote = parse(originalRemoteContent);
	const base = baseContent ? parse(baseContent) : null;

	const ignored = ignoredSettings.reduce((set, key) => { set.add(key); return set; }, new Set<string>());
	const localToRemote = compare(local, remote, ignored);
	const baseToLocal = compare(base, local, ignored);
	const baseToRemote = compare(base, remote, ignored);

	const conflicts: Map<string, IConflictSetting> = new Map<string, IConflictSetting>();
	const handledConflicts: Set<string> = new Set<string>();
	const handleConflict = (conflictKey: string): void => {
		handledConflicts.add(conflictKey);
		const resolvedConflict = resolvedConflicts.filter(({ key }) => key === conflictKey)[0];
		if (resolvedConflict) {
			localContent = contentUtil.edit(localContent, [conflictKey], resolvedConflict.value, formattingOptions);
			remoteContent = contentUtil.edit(remoteContent, [conflictKey], resolvedConflict.value, formattingOptions);
		} else {
			conflicts.set(conflictKey, { key: conflictKey, localValue: local[conflictKey], remoteValue: remote[conflictKey] });
		}
	};

	// Removed settings in Local
	for (const key of values(baseToLocal.removed)) {
		// Conflict - Got updated in remote.
		if (baseToRemote.updated.has(key)) {
			handleConflict(key);
		}
		// Also remove in remote
		else {
			remoteContent = contentUtil.edit(remoteContent, [key], undefined, formattingOptions);
		}
	}

	// Removed settings in Remote
	for (const key of values(baseToRemote.removed)) {
		if (handledConflicts.has(key)) {
			continue;
		}
		// Conflict - Got updated in local
		if (baseToLocal.updated.has(key)) {
			handleConflict(key);
		}
		// Also remove in locals
		else {
			localContent = contentUtil.edit(localContent, [key], undefined, formattingOptions);
		}
	}

	// Updated settings in Local
	for (const key of values(baseToLocal.updated)) {
		if (handledConflicts.has(key)) {
			continue;
		}
		// Got updated in remote
		if (baseToRemote.updated.has(key)) {
			// Has different value
			if (localToRemote.updated.has(key)) {
				handleConflict(key);
			}
		} else {
			remoteContent = contentUtil.edit(remoteContent, [key], local[key], formattingOptions);
		}
	}

	// Updated settings in Remote
	for (const key of values(baseToRemote.updated)) {
		if (handledConflicts.has(key)) {
			continue;
		}
		// Got updated in local
		if (baseToLocal.updated.has(key)) {
			// Has different value
			if (localToRemote.updated.has(key)) {
				handleConflict(key);
			}
		} else {
			localContent = contentUtil.edit(localContent, [key], remote[key], formattingOptions);
		}
	}

	// Added settings in Local
	for (const key of values(baseToLocal.added)) {
		if (handledConflicts.has(key)) {
			continue;
		}
		// Got added in remote
		if (baseToRemote.added.has(key)) {
			// Has different value
			if (localToRemote.updated.has(key)) {
				handleConflict(key);
			}
		} else {
			remoteContent = addSetting(key, localContent, remoteContent, formattingOptions);
		}
	}

	// Added settings in remote
	for (const key of values(baseToRemote.added)) {
		if (handledConflicts.has(key)) {
			continue;
		}
		// Got added in local
		if (baseToLocal.added.has(key)) {
			// Has different value
			if (localToRemote.updated.has(key)) {
				handleConflict(key);
			}
		} else {
			localContent = addSetting(key, remoteContent, localContent, formattingOptions);
		}
	}

	const hasConflicts = conflicts.size > 0 || !areSame(localContent, remoteContent, ignoredSettings);
	const hasLocalChanged = hasConflicts || !areSame(localContent, originalLocalContent, []);
	const hasRemoteChanged = hasConflicts || !areSame(remoteContent, originalRemoteContent, []);
	return { localContent: hasLocalChanged ? localContent : null, remoteContent: hasRemoteChanged ? remoteContent : null, conflictsSettings: values(conflicts), hasConflicts };
}

export function areSame(localContent: string, remoteContent: string, ignoredSettings: string[]): boolean {
	if (localContent === remoteContent) {
		return true;
	}

	const local = parse(localContent);
	const remote = parse(remoteContent);
	const ignored = ignoredSettings.reduce((set, key) => { set.add(key); return set; }, new Set<string>());
	const localTree = parseSettings(localContent).filter(node => !(node.setting && ignored.has(node.setting.key)));
	const remoteTree = parseSettings(remoteContent).filter(node => !(node.setting && ignored.has(node.setting.key)));

	if (localTree.length !== remoteTree.length) {
		return false;
	}

	for (let index = 0; index < localTree.length; index++) {
		const localNode = localTree[index];
		const remoteNode = remoteTree[index];
		if (localNode.setting && remoteNode.setting) {
			if (localNode.setting.key !== remoteNode.setting.key) {
				return false;
			}
			if (!objects.equals(local[localNode.setting.key], remote[localNode.setting.key])) {
				return false;
			}
		} else if (!localNode.setting && !remoteNode.setting) {
			if (localNode.value !== remoteNode.value) {
				return false;
			}
		} else {
			return false;
		}
	}

	return true;
}

export function isEmpty(content: string): boolean {
	const nodes = parseSettings(content);
	return nodes.length === 0;
}

function compare(from: IStringDictionary<any> | null, to: IStringDictionary<any>, ignored: Set<string>): { added: Set<string>, removed: Set<string>, updated: Set<string> } {
	const fromKeys = from ? Object.keys(from).filter(key => !ignored.has(key)) : [];
	const toKeys = Object.keys(to).filter(key => !ignored.has(key));
	const added = toKeys.filter(key => fromKeys.indexOf(key) === -1).reduce((r, key) => { r.add(key); return r; }, new Set<string>());
	const removed = fromKeys.filter(key => toKeys.indexOf(key) === -1).reduce((r, key) => { r.add(key); return r; }, new Set<string>());
	const updated: Set<string> = new Set<string>();

	if (from) {
		for (const key of fromKeys) {
			if (removed.has(key)) {
				continue;
			}
			const value1 = from[key];
			const value2 = to[key];
			if (!objects.equals(value1, value2)) {
				updated.add(key);
			}
		}
	}

	return { added, removed, updated };
}

export function addSetting(key: string, sourceContent: string, targetContent: string, formattingOptions: FormattingOptions): string {
	const source = parse(sourceContent);
	const sourceTree = parseSettings(sourceContent);
	const targetTree = parseSettings(targetContent);
	const insertLocation = getInsertLocation(key, sourceTree, targetTree);
	return insertAtLocation(targetContent, key, source[key], insertLocation, targetTree, formattingOptions);
}

interface InsertLocation {
	index: number,
	insertAfter: boolean;
}

function getInsertLocation(key: string, sourceTree: INode[], targetTree: INode[]): InsertLocation {

	const sourceNodeIndex = firstIndex(sourceTree, (node => node.setting?.key === key));

	const sourcePreviousNode: INode = sourceTree[sourceNodeIndex - 1];
	if (sourcePreviousNode) {
		/*
			Previous node in source is a setting.
			Find the same setting in the target.
			Insert it after that setting
		*/
		if (sourcePreviousNode.setting) {
			const targetPreviousSetting = findSettingNode(sourcePreviousNode.setting.key, targetTree);
			if (targetPreviousSetting) {
				/* Insert after target's previous setting */
				return { index: targetTree.indexOf(targetPreviousSetting), insertAfter: true };
			}
		}
		/* Previous node in source is a comment */
		else {
			const sourcePreviousSettingNode = findPreviousSettingNode(sourceNodeIndex, sourceTree);
			/*
				Source has a setting defined before the setting to be added.
				Find the same previous setting in the target.
				If found, insert before its next setting so that comments are retrieved.
				Otherwise, insert at the end.
			*/
			if (sourcePreviousSettingNode) {
				const targetPreviousSetting = findSettingNode(sourcePreviousSettingNode.setting!.key, targetTree);
				if (targetPreviousSetting) {
					const targetNextSetting = findNextSettingNode(targetTree.indexOf(targetPreviousSetting), targetTree);
					const sourceCommentNodes = findNodesBetween(sourceTree, sourcePreviousSettingNode, sourceTree[sourceNodeIndex]);
					if (targetNextSetting) {
						const targetCommentNodes = findNodesBetween(targetTree, targetPreviousSetting, targetNextSetting);
						const targetCommentNode = findLastMatchingTargetCommentNode(sourceCommentNodes, targetCommentNodes);
						if (targetCommentNode) {
							return { index: targetTree.indexOf(targetCommentNode), insertAfter: true }; /* Insert after comment */
						} else {
							return { index: targetTree.indexOf(targetNextSetting), insertAfter: false }; /* Insert before target next setting */
						}
					} else {
						const targetCommentNodes = findNodesBetween(targetTree, targetPreviousSetting, targetTree[targetTree.length - 1]);
						const targetCommentNode = findLastMatchingTargetCommentNode(sourceCommentNodes, targetCommentNodes);
						if (targetCommentNode) {
							return { index: targetTree.indexOf(targetCommentNode), insertAfter: true }; /* Insert after comment */
						} else {
							return { index: targetTree.length - 1, insertAfter: true }; /* Insert at the end */
						}
					}
				}
			}
		}

		const sourceNextNode = sourceTree[sourceNodeIndex + 1];
		if (sourceNextNode) {
			/*
				Next node in source is a setting.
				Find the same setting in the target.
				Insert it before that setting
			*/
			if (sourceNextNode.setting) {
				const targetNextSetting = findSettingNode(sourceNextNode.setting.key, targetTree);
				if (targetNextSetting) {
					/* Insert before target's next setting */
					return { index: targetTree.indexOf(targetNextSetting), insertAfter: false };
				}
			}
			/* Next node in source is a comment */
			else {
				const sourceNextSettingNode = findNextSettingNode(sourceNodeIndex, sourceTree);
				/*
					Source has a setting defined after the setting to be added.
					Find the same next setting in the target.
					If found, insert after its previous setting so that comments are retrieved.
					Otherwise, insert at the beginning.
				*/
				if (sourceNextSettingNode) {
					const targetNextSetting = findSettingNode(sourceNextSettingNode.setting!.key, targetTree);
					if (targetNextSetting) {
						const targetPreviousSetting = findPreviousSettingNode(targetTree.indexOf(targetNextSetting), targetTree);
						const sourceCommentNodes = findNodesBetween(sourceTree, sourceTree[sourceNodeIndex], sourceNextSettingNode);
						if (targetPreviousSetting) {
							const targetCommentNodes = findNodesBetween(targetTree, targetPreviousSetting, targetNextSetting);
							const targetCommentNode = findLastMatchingTargetCommentNode(sourceCommentNodes.reverse(), targetCommentNodes.reverse());
							if (targetCommentNode) {
								return { index: targetTree.indexOf(targetCommentNode), insertAfter: false }; /* Insert before comment */
							} else {
								return { index: targetTree.indexOf(targetPreviousSetting), insertAfter: true }; /* Insert after target previous setting */
							}
						} else {
							const targetCommentNodes = findNodesBetween(targetTree, targetTree[0], targetNextSetting);
							const targetCommentNode = findLastMatchingTargetCommentNode(sourceCommentNodes.reverse(), targetCommentNodes.reverse());
							if (targetCommentNode) {
								return { index: targetTree.indexOf(targetCommentNode), insertAfter: false }; /* Insert before comment */
							} else {
								return { index: 0, insertAfter: false }; /* Insert at the beginning */
							}
						}
					}
				}
			}
		}
	}
	/* Insert at the end */
	return { index: targetTree.length - 1, insertAfter: true };
}

function insertAtLocation(content: string, key: string, value: any, location: InsertLocation, tree: INode[], formattingOptions: FormattingOptions): string {
	let edits: Edit[];
	/* Insert at the end */
	if (location.index === -1) {
		edits = setProperty(content, [key], value, formattingOptions);
	} else {
		edits = getEditToInsertAtLocation(content, key, value, location, tree, formattingOptions).map(edit => withFormatting(content, edit, formattingOptions)[0]);
	}
	return applyEdits(content, edits);
}

function getEditToInsertAtLocation(content: string, key: string, value: any, location: InsertLocation, tree: INode[], formattingOptions: FormattingOptions): Edit[] {
	const newProperty = `${JSON.stringify(key)}: ${JSON.stringify(value)}`;
	const eol = getEOL(formattingOptions, content);
	const node = tree[location.index];

	if (location.insertAfter) {

		/* Insert after a setting */
		if (node.setting) {
			return [{ offset: node.endOffset, length: 0, content: ',' + newProperty }];
		}

		/*
			Insert after a comment and before a setting (or)
			Insert between comments and there is a setting after
		*/
		if (tree[location.index + 1] &&
			(tree[location.index + 1].setting || findNextSettingNode(location.index, tree))) {
			return [{ offset: node.endOffset, length: 0, content: eol + newProperty + ',' }];
		}

		/* Insert after the comment at the end */
		const edits = [{ offset: node.endOffset, length: 0, content: eol + newProperty }];
		const previousSettingNode = findPreviousSettingNode(location.index, tree);
		if (previousSettingNode && !previousSettingNode.setting!.hasCommaSeparator) {
			edits.splice(0, 0, { offset: previousSettingNode.endOffset, length: 0, content: ',' });
		}
		return edits;
	}

	else {

		/* Insert before a setting */
		if (node.setting) {
			return [{ offset: node.startOffset, length: 0, content: newProperty + ',' }];
		}

		/* Insert before a comment */
		const content = (tree[location.index - 1] && !tree[location.index - 1].setting /* previous node is comment */ ? eol : '')
			+ newProperty
			+ (findNextSettingNode(location.index, tree) ? ',' : '')
			+ eol;
		return [{ offset: node.startOffset, length: 0, content }];
	}

}

function findSettingNode(key: string, tree: INode[]): INode | undefined {
	return tree.filter(node => node.setting?.key === key)[0];
}

function findPreviousSettingNode(index: number, tree: INode[]): INode | undefined {
	for (let i = index - 1; i >= 0; i--) {
		if (tree[i].setting) {
			return tree[i];
		}
	}
	return undefined;
}

function findNextSettingNode(index: number, tree: INode[]): INode | undefined {
	for (let i = index + 1; i < tree.length; i++) {
		if (tree[i].setting) {
			return tree[i];
		}
	}
	return undefined;
}

function findNodesBetween(nodes: INode[], from: INode, till: INode): INode[] {
	const fromIndex = nodes.indexOf(from);
	const tillIndex = nodes.indexOf(till);
	return nodes.filter((node, index) => fromIndex < index && index < tillIndex);
}

function findLastMatchingTargetCommentNode(sourceComments: INode[], targetComments: INode[]): INode | undefined {
	if (sourceComments.length && targetComments.length) {
		let index = 0;
		for (; index < targetComments.length && index < sourceComments.length; index++) {
			if (sourceComments[index].value !== targetComments[index].value) {
				return targetComments[index - 1];
			}
		}
		return targetComments[index - 1];
	}
	return undefined;
}

interface INode {
	readonly startOffset: number;
	readonly endOffset: number;
	readonly value: string;
	readonly setting?: {
		readonly key: string;
		readonly hasCommaSeparator: boolean;
	};
	readonly comment?: string;
}

function parseSettings(content: string): INode[] {
	const nodes: INode[] = [];
	let hierarchyLevel = -1;
	let startOffset: number;
	let key: string;

	const visitor: JSONVisitor = {
		onObjectBegin: (offset: number) => {
			hierarchyLevel++;
		},
		onObjectProperty: (name: string, offset: number, length: number) => {
			if (hierarchyLevel === 0) {
				// this is setting key
				startOffset = offset;
				key = name;
			}
		},
		onObjectEnd: (offset: number, length: number) => {
			hierarchyLevel--;
			if (hierarchyLevel === 0) {
				nodes.push({
					startOffset,
					endOffset: offset + length,
					value: content.substring(startOffset, offset + length),
					setting: {
						key,
						hasCommaSeparator: false
					}
				});
			}
		},
		onArrayBegin: (offset: number, length: number) => {
			hierarchyLevel++;
		},
		onArrayEnd: (offset: number, length: number) => {
			hierarchyLevel--;
			if (hierarchyLevel === 0) {
				nodes.push({
					startOffset,
					endOffset: offset + length,
					value: content.substring(startOffset, offset + length),
					setting: {
						key,
						hasCommaSeparator: false
					}
				});
			}
		},
		onLiteralValue: (value: any, offset: number, length: number) => {
			if (hierarchyLevel === 0) {
				nodes.push({
					startOffset,
					endOffset: offset + length,
					value: content.substring(startOffset, offset + length),
					setting: {
						key,
						hasCommaSeparator: false
					}
				});
			}
		},
		onSeparator: (sep: string, offset: number, length: number) => {
			if (hierarchyLevel === 0) {
				if (sep === ',') {
					const node = nodes.pop();
					if (node) {
						nodes.push({
							startOffset: node.startOffset,
							endOffset: node.endOffset,
							value: node.value,
							setting: {
								key: node.setting!.key,
								hasCommaSeparator: true
							}
						});
					}
				}
			}
		},
		onComment: (offset: number, length: number) => {
			if (hierarchyLevel === 0) {
				nodes.push({
					startOffset: offset,
					endOffset: offset + length,
					value: content.substring(offset, offset + length),
				});
			}
		}
	};
	visit(content, visitor);
	return nodes;
}
