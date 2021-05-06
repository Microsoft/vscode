/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as glob from 'vs/base/common/glob';
import { Iterable } from 'vs/base/common/iterator';
import { joinPath } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { INotebookRendererInfo, NotebookRendererMatch } from 'vs/workbench/contrib/notebook/common/notebookCommon';

class DependencyList {
	private readonly value: ReadonlySet<string>;
	public readonly defined: boolean;

	constructor(value: Iterable<string>) {
		this.value = new Set(value);
		this.defined = this.value.size > 0;
	}

	/** Gets whether any of the 'available' dependencies match the ones in this list */
	public matches(available: ReadonlyArray<string>) {
		// For now this is simple, but this may expand to support globs later
		// @see https://github.com/microsoft/vscode/issues/119899
		return available.some(v => this.value.has(v));
	}
}

export class NotebookOutputRendererInfo implements INotebookRendererInfo {

	readonly id: string;
	readonly entrypoint: URI;
	readonly displayName: string;
	readonly extensionLocation: URI;
	readonly extensionId: ExtensionIdentifier;
	readonly hardDependencies: DependencyList;
	readonly optionalDependencies: DependencyList;
	// todo: re-add preloads in pure renderer API
	readonly preloads: ReadonlyArray<URI> = [];

	private readonly mimeTypes: readonly string[];
	private readonly mimeTypeGlobs: glob.ParsedPattern[];

	constructor(descriptor: {
		readonly id: string;
		readonly displayName: string;
		readonly entrypoint: string;
		readonly mimeTypes: readonly string[];
		readonly extension: IExtensionDescription;
		readonly dependencies: readonly string[] | undefined;
		readonly optionalDependencies: readonly string[] | undefined;
	}) {
		this.id = descriptor.id;
		this.extensionId = descriptor.extension.identifier;
		this.extensionLocation = descriptor.extension.extensionLocation;
		this.entrypoint = joinPath(this.extensionLocation, descriptor.entrypoint);
		this.displayName = descriptor.displayName;
		this.mimeTypes = descriptor.mimeTypes;
		this.mimeTypeGlobs = this.mimeTypes.map(pattern => glob.parse(pattern));
		this.hardDependencies = new DependencyList(descriptor.dependencies ?? Iterable.empty());
		this.optionalDependencies = new DependencyList(descriptor.optionalDependencies ?? Iterable.empty());
	}

	matchesWithoutKernel(mimeType: string) {
		if (!this.matchesMimeTypeOnly(mimeType)) {
			return NotebookRendererMatch.Never;
		}

		if (this.hardDependencies.defined) {
			return NotebookRendererMatch.WithHardKernelDependency;
		}

		if (this.optionalDependencies.defined) {
			return NotebookRendererMatch.WithOptionalKernelDependency;
		}

		return NotebookRendererMatch.Pure;
	}

	matches(mimeType: string, kernelProvides: ReadonlyArray<string>) {
		if (!this.matchesMimeTypeOnly(mimeType)) {
			return NotebookRendererMatch.Never;
		}

		if (this.hardDependencies.defined) {
			return this.hardDependencies.matches(kernelProvides)
				? NotebookRendererMatch.WithHardKernelDependency
				: NotebookRendererMatch.Never;
		}

		return this.optionalDependencies.matches(kernelProvides)
			? NotebookRendererMatch.WithOptionalKernelDependency
			: NotebookRendererMatch.Pure;
	}

	private matchesMimeTypeOnly(mimeType: string) {
		return this.mimeTypeGlobs.some(pattern => pattern(mimeType)) || this.mimeTypes.some(pattern => pattern === mimeType);
	}
}
