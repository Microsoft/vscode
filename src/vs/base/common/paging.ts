/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isArray } from 'vs/base/common/types';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { canceled } from 'vs/base/common/errors';
import { range } from 'vs/base/common/arrays';

/**
 * A Pager is a stateless abstraction over a paged collection.
 */
export interface IPager<T> {
	firstPage: T[];
	total: number;
	pageSize: number;
	getPage(pageIndex: number, cancellationToken: CancellationToken): Promise<T[]>;
}

interface IPage<T> {
	isResolved: boolean;
	promise: Promise<void> | null;
	cts: CancellationTokenSource | null;
	promiseIndexes: Set<number>;
	elements: T[];
}

function createPage<T>(elements?: T[]): IPage<T> {
	return {
		isResolved: !!elements,
		promise: null,
		cts: null,
		promiseIndexes: new Set<number>(),
		elements: elements || []
	};
}

/**
 * A PagedModel is a stateful model over an abstracted paged collection.
 */
export interface IPagedModel<T> {
	length: number;
	isResolved(index: number): boolean;
	get(index: number): T;
	resolve(index: number, cancellationToken: CancellationToken): Promise<T>;
}

export function singlePagePager<T>(elements: T[]): IPager<T> {
	return {
		firstPage: elements,
		total: elements.length,
		pageSize: elements.length,
		getPage: (pageIndex: number, cancellationToken: CancellationToken): Promise<T[]> => {
			return Promise.resolve(elements);
		}
	};
}

export class PagedModel<T> implements IPagedModel<T> {

	private pager: IPager<T>;
	private pages: IPage<T>[] = [];

	get length(): number { return this.pager.total; }

	constructor(arg: IPager<T> | T[]) {
		this.pager = isArray(arg) ? singlePagePager<T>(arg) : arg;

		const totalPages = Math.ceil(this.pager.total / this.pager.pageSize);

		this.pages = [
			createPage(this.pager.firstPage.slice()),
			...range(totalPages - 1).map(() => createPage<T>())
		];
	}

	isResolved(index: number): boolean {
		const pageIndex = Math.floor(index / this.pager.pageSize);
		const page = this.pages[pageIndex];

		return !!page.isResolved;
	}

	get(index: number): T {
		const pageIndex = Math.floor(index / this.pager.pageSize);
		const indexInPage = index % this.pager.pageSize;
		const page = this.pages[pageIndex];

		return page.elements[indexInPage];
	}

	resolve(index: number, cancellationToken: CancellationToken): Promise<T> {
		if (cancellationToken.isCancellationRequested) {
			return Promise.reject(canceled());
		}

		const pageIndex = Math.floor(index / this.pager.pageSize);
		const indexInPage = index % this.pager.pageSize;
		const page = this.pages[pageIndex];

		if (page.isResolved) {
			return Promise.resolve(page.elements[indexInPage]);
		}

		if (!page.promise) {
			page.cts = new CancellationTokenSource();
			page.promise = this.pager.getPage(pageIndex, page.cts.token)
				.then(elements => {
					page.elements = elements;
					page.isResolved = true;
					page.promise = null;
					page.cts = null;
				}, err => {
					page.isResolved = false;
					page.promise = null;
					page.cts = null;
					return Promise.reject(err);
				});
		}

		cancellationToken.onCancellationRequested(() => {
			if (!page.cts) {
				return;
			}

			page.promiseIndexes.delete(index);

			if (page.promiseIndexes.size === 0) {
				page.cts.cancel();
			}
		});

		page.promiseIndexes.add(index);

		return page.promise.then(() => page.elements[indexInPage]);
	}
}

export class DelayedPagedModel<T> implements IPagedModel<T> {

	get length(): number { return this.model.length; }

	constructor(private model: IPagedModel<T>, private timeout: number = 500) { }

	isResolved(index: number): boolean {
		return this.model.isResolved(index);
	}

	get(index: number): T {
		return this.model.get(index);
	}

	resolve(index: number, cancellationToken: CancellationToken): Promise<T> {
		return new Promise((c, e) => {
			if (cancellationToken.isCancellationRequested) {
				return e(canceled());
			}

			const timer = setTimeout(() => {
				if (cancellationToken.isCancellationRequested) {
					return e(canceled());
				}

				timeoutCancellation.dispose();
				this.model.resolve(index, cancellationToken).then(c, e);
			}, this.timeout);

			const timeoutCancellation = cancellationToken.onCancellationRequested(() => {
				clearTimeout(timer);
				timeoutCancellation.dispose();
				e(canceled());
			});
		});
	}
}

/**
 * Similar to array.map, `mapPager` lets you map the elements of an
 * abstract paged collection to another type.
 */
export function mapPager<T, R>(pager: IPager<T>, fn: (t: T) => R): IPager<R> {
	return {
		firstPage: pager.firstPage.map(fn),
		total: pager.total,
		pageSize: pager.pageSize,
		getPage: (pageIndex, token) => pager.getPage(pageIndex, token).then(r => r.map(fn))
	};
}

/**
 * Merges two pagers.
 */
export function mergePagers<T>(one: IPager<T>, other: IPager<T>): IPager<T> {
	return {
		firstPage: [...one.firstPage, ...other.firstPage],
		total: one.total + other.total,
		pageSize: one.pageSize + other.pageSize,
		getPage(pageIndex: number, token): Promise<T[]> {
			return Promise.all([one.getPage(pageIndex, token), other.getPage(pageIndex, token)])
				.then(([onePage, otherPage]) => [...onePage, ...otherPage]);
		}
	};
}
