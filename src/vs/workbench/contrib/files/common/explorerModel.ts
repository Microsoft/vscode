/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { isEqual } from 'vs/base/common/extpath';
import { posix } from 'vs/base/common/path';
import { ResourceMap } from 'vs/base/common/map';
import { IFileStat, IFileService, FileSystemProviderCapabilities } from 'vs/platform/files/common/files';
import { rtrim, startsWithIgnoreCase, equalsIgnoreCase } from 'vs/base/common/strings';
import { coalesce } from 'vs/base/common/arrays';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { memoize } from 'vs/base/common/decorators';
import { Emitter, Event } from 'vs/base/common/event';
import { joinPath, isEqualOrParent, basenameOrAuthority } from 'vs/base/common/resources';
import { SortOrder } from 'vs/workbench/contrib/files/common/files';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';

export class ExplorerModel implements IDisposable {

	private _roots!: ExplorerItem[];
	private _listener: IDisposable;
	private readonly _onDidChangeRoots = new Emitter<void>();

	constructor(
		private readonly contextService: IWorkspaceContextService,
		private readonly uriIdentityService: IUriIdentityService,
		fileService: IFileService
	) {
		const setRoots = () => this._roots = this.contextService.getWorkspace().folders
			.map(folder => new ExplorerItem(folder.uri, fileService, undefined, true, false, folder.name));
		setRoots();

		this._listener = this.contextService.onDidChangeWorkspaceFolders(() => {
			setRoots();
			this._onDidChangeRoots.fire();
		});
	}

	get roots(): ExplorerItem[] {
		return this._roots;
	}

	get onDidChangeRoots(): Event<void> {
		return this._onDidChangeRoots.event;
	}

	/**
	 * Returns an array of child stat from this stat that matches with the provided path.
	 * Starts matching from the first root.
	 * Will return empty array in case the FileStat does not exist.
	 */
	findAll(resource: URI): ExplorerItem[] {
		return coalesce(this.roots.map(root => root.find(resource)));
	}

	/**
	 * Returns a FileStat that matches the passed resource.
	 * In case multiple FileStat are matching the resource (same folder opened multiple times) returns the FileStat that has the closest root.
	 * Will return undefined in case the FileStat does not exist.
	 */
	findClosest(resource: URI): ExplorerItem | null {
		const folder = this.contextService.getWorkspaceFolder(resource);
		if (folder) {
			const root = this.roots.find(r => this.uriIdentityService.extUri.isEqual(r.resource, folder.uri));
			if (root) {
				return root.find(resource);
			}
		}

		return null;
	}

	dispose(): void {
		dispose(this._listener);
	}
}

export class ExplorerItem {
	protected _isDirectoryResolved: boolean;
	public isError = false;
	private _isExcluded = false;

	constructor(
		public resource: URI,
		private readonly fileService: IFileService,
		private _parent: ExplorerItem | undefined,
		private _isDirectory?: boolean,
		private _isSymbolicLink?: boolean,
		private _name: string = basenameOrAuthority(resource),
		private _mtime?: number,
		private _unknown = false
	) {
		this._isDirectoryResolved = false;
	}

	get isExcluded(): boolean {
		if (this._isExcluded) {
			return true;
		}
		if (!this._parent) {
			return false;
		}

		return this._parent.isExcluded;
	}

	set isExcluded(value: boolean) {
		this._isExcluded = value;
	}

	get isDirectoryResolved(): boolean {
		return this._isDirectoryResolved;
	}

	get isSymbolicLink(): boolean {
		return !!this._isSymbolicLink;
	}

	get isDirectory(): boolean {
		return !!this._isDirectory;
	}

	get isReadonly(): boolean {
		return this.fileService.hasCapability(this.resource, FileSystemProviderCapabilities.Readonly);
	}

	get mtime(): number | undefined {
		return this._mtime;
	}

	get name(): string {
		return this._name;
	}

	get isUnknown(): boolean {
		return this._unknown;
	}

	get parent(): ExplorerItem | undefined {
		return this._parent;
	}

	get root(): ExplorerItem {
		if (!this._parent) {
			return this;
		}

		return this._parent.root;
	}

	@memoize get children(): Map<string, ExplorerItem> {
		return new Map<string, ExplorerItem>();
	}

	private updateName(value: string): void {
		// Re-add to parent since the parent has a name map to children and the name might have changed
		if (this._parent) {
			this._parent.removeChild(this);
		}
		this._name = value;
		if (this._parent) {
			this._parent.addChild(this);
		}
	}

	getId(): string {
		return this.resource.toString();
	}

	toString(): string {
		return `ExplorerItem: ${this.name}`;
	}

	get isRoot(): boolean {
		return this === this.root;
	}

	static create(fileService: IFileService, raw: IFileStat, parent: ExplorerItem | undefined, resolveTo?: readonly URI[]): ExplorerItem {
		const stat = new ExplorerItem(raw.resource, fileService, parent, raw.isDirectory, raw.isSymbolicLink, raw.name, raw.mtime, !raw.isFile && !raw.isDirectory);

		// Recursively add children if present
		if (stat.isDirectory) {

			// isDirectoryResolved is a very important indicator in the stat model that tells if the folder was fully resolved
			// the folder is fully resolved if either it has a list of children or the client requested this by using the resolveTo
			// array of resource path to resolve.
			stat._isDirectoryResolved = !!raw.children || (!!resolveTo && resolveTo.some((r) => {
				return isEqualOrParent(r, stat.resource);
			}));

			// Recurse into children
			if (raw.children) {
				for (let i = 0, len = raw.children.length; i < len; i++) {
					const child = ExplorerItem.create(fileService, raw.children[i], stat, resolveTo);
					stat.addChild(child);
				}
			}
		}

		return stat;
	}

	/**
	 * Merges the stat which was resolved from the disk with the local stat by copying over properties
	 * and children. The merge will only consider resolved stat elements to avoid overwriting data which
	 * exists locally.
	 */
	static mergeLocalWithDisk(disk: ExplorerItem, local: ExplorerItem): void {
		if (disk.resource.toString() !== local.resource.toString()) {
			return; // Merging only supported for stats with the same resource
		}

		// Stop merging when a folder is not resolved to avoid loosing local data
		const mergingDirectories = disk.isDirectory || local.isDirectory;
		if (mergingDirectories && local._isDirectoryResolved && !disk._isDirectoryResolved) {
			return;
		}

		// Properties
		local.resource = disk.resource;
		if (!local.isRoot) {
			local.updateName(disk.name);
		}
		local._isDirectory = disk.isDirectory;
		local._mtime = disk.mtime;
		local._isDirectoryResolved = disk._isDirectoryResolved;
		local._isSymbolicLink = disk.isSymbolicLink;
		local.isError = disk.isError;

		// Merge Children if resolved
		if (mergingDirectories && disk._isDirectoryResolved) {

			// Map resource => stat
			const oldLocalChildren = new ResourceMap<ExplorerItem>();
			local.children.forEach(child => {
				oldLocalChildren.set(child.resource, child);
			});

			// Clear current children
			local.children.clear();

			// Merge received children
			disk.children.forEach(diskChild => {
				const formerLocalChild = oldLocalChildren.get(diskChild.resource);
				// Existing child: merge
				if (formerLocalChild) {
					ExplorerItem.mergeLocalWithDisk(diskChild, formerLocalChild);
					local.addChild(formerLocalChild);
					oldLocalChildren.delete(diskChild.resource);
				}

				// New child: add
				else {
					local.addChild(diskChild);
				}
			});

			oldLocalChildren.forEach(oldChild => {
				if (oldChild instanceof NewExplorerItem) {
					local.addChild(oldChild);
				}
			});
		}
	}

	/**
	 * Adds a child element to this folder.
	 */
	addChild(child: ExplorerItem): void {
		// Inherit some parent properties to child
		child._parent = this;
		child.updateResource(false);
		this.children.set(this.getPlatformAwareName(child.name), child);
	}

	getChild(name: string): ExplorerItem | undefined {
		return this.children.get(this.getPlatformAwareName(name));
	}

	async fetchChildren(sortOrder: SortOrder): Promise<ExplorerItem[]> {
		if (!this._isDirectoryResolved) {
			// Resolve metadata only when the mtime is needed since this can be expensive
			// Mtime is only used when the sort order is 'modified'
			const resolveMetadata = sortOrder === SortOrder.Modified;
			try {
				const stat = await this.fileService.resolve(this.resource, { resolveSingleChildDescendants: true, resolveMetadata });
				const resolved = ExplorerItem.create(this.fileService, stat, this);
				ExplorerItem.mergeLocalWithDisk(resolved, this);
			} catch (e) {
				this.isError = true;
				throw e;
			}
			this._isDirectoryResolved = true;
		}

		const items: ExplorerItem[] = [];
		this.children.forEach(child => {
			items.push(child);
		});

		return items;
	}

	/**
	 * Removes a child element from this folder.
	 */
	removeChild(child: ExplorerItem): void {
		this.children.delete(this.getPlatformAwareName(child.name));
	}

	forgetChildren(): void {
		this.children.clear();
		this._isDirectoryResolved = false;
	}

	private getPlatformAwareName(name: string): string {
		return this.fileService.hasCapability(this.resource, FileSystemProviderCapabilities.PathCaseSensitive) ? name : name.toLowerCase();
	}

	/**
	 * Moves this element under a new parent element.
	 */
	move(newParent: ExplorerItem): void {
		if (this._parent) {
			this._parent.removeChild(this);
		}
		newParent.removeChild(this); // make sure to remove any previous version of the file if any
		newParent.addChild(this);
		this.updateResource(true);
	}

	private updateResource(recursive: boolean): void {
		if (this._parent) {
			this.resource = joinPath(this._parent.resource, this.name);
		}

		if (recursive) {
			if (this.isDirectory) {
				this.children.forEach(child => {
					child.updateResource(true);
				});
			}
		}
	}

	/**
	 * Tells this stat that it was renamed. This requires changes to all children of this stat (if any)
	 * so that the path property can be updated properly.
	 */
	rename(renamedStat: { name: string, mtime?: number }): void {

		// Merge a subset of Properties that can change on rename
		this.updateName(renamedStat.name);
		this._mtime = renamedStat.mtime;

		// Update Paths including children
		this.updateResource(true);
	}

	/**
	 * Returns a child stat from this stat that matches with the provided path.
	 * Will return "null" in case the child does not exist.
	 */
	find(resource: URI): ExplorerItem | null {
		// Return if path found
		// For performance reasons try to do the comparison as fast as possible
		const ignoreCase = !this.fileService.hasCapability(resource, FileSystemProviderCapabilities.PathCaseSensitive);
		if (resource && this.resource.scheme === resource.scheme && equalsIgnoreCase(this.resource.authority, resource.authority) &&
			(ignoreCase ? startsWithIgnoreCase(resource.path, this.resource.path) : resource.path.startsWith(this.resource.path))) {
			return this.findByPath(rtrim(resource.path, posix.sep), this.resource.path.length, ignoreCase);
		}

		return null; //Unable to find
	}

	private findByPath(path: string, index: number, ignoreCase: boolean): ExplorerItem | null {
		if (isEqual(rtrim(this.resource.path, posix.sep), path, ignoreCase)) {
			return this;
		}

		if (this.isDirectory) {
			// Ignore separtor to more easily deduct the next name to search
			while (index < path.length && path[index] === posix.sep) {
				index++;
			}

			let indexOfNextSep = path.indexOf(posix.sep, index);
			if (indexOfNextSep === -1) {
				// If there is no separator take the remainder of the path
				indexOfNextSep = path.length;
			}
			// The name to search is between two separators
			const name = path.substring(index, indexOfNextSep);

			const child = this.children.get(this.getPlatformAwareName(name));

			if (child) {
				// We found a child with the given name, search inside it
				return child.findByPath(path, indexOfNextSep, ignoreCase);
			}
		}

		return null;
	}
}

export class NewExplorerItem extends ExplorerItem {
	constructor(fileService: IFileService, parent: ExplorerItem, isDirectory: boolean) {
		super(URI.file(''), fileService, parent, isDirectory);
		this._isDirectoryResolved = true;
	}
}
