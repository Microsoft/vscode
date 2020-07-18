/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { IRange } from 'vs/editor/common/core/range';
import { Comment, CommentThread, CommentThreadChangedEvent } from 'vs/editor/common/modes';
import { groupBy, firstIndex, flatten } from 'vs/base/common/arrays';
import { localize } from 'vs/nls';

export interface ICommentThreadChangedEvent extends CommentThreadChangedEvent {
	owner: string;
}

export class CommentNode {
	owner: string;
	threadId: string;
	range: IRange;
	comment: Comment;
	replies: CommentNode[] = [];
	resource: URI;
	isRoot: boolean;

	constructor(owner: string, threadId: string, resource: URI, comment: Comment, range: IRange) {
		this.owner = owner;
		this.threadId = threadId;
		this.comment = comment;
		this.resource = resource;
		this.range = range;
		this.isRoot = false;
	}

	hasReply(): boolean {
		return this.replies && this.replies.length !== 0;
	}
}

export class ResourceWithCommentThreads {
	id: string;
	owner: string;
	commentThreads: CommentNode[]; // The top level comments on the file. Replys are nested under each node.
	resource: URI;

	constructor(owner: string, resource: URI, commentThreads: CommentThread[]) {
		this.owner = owner;
		this.id = resource.toString();
		this.resource = resource;
		this.commentThreads = commentThreads.filter(thread => thread.comments && thread.comments.length).map(thread => ResourceWithCommentThreads.createCommentNode(owner, resource, thread));
	}

	public static createCommentNode(owner: string, resource: URI, commentThread: CommentThread): CommentNode {
		const { threadId, comments, range } = commentThread;
		const commentNodes: CommentNode[] = comments!.map(comment => new CommentNode(owner, threadId!, resource, comment, range));
		if (commentNodes.length > 1) {
			commentNodes[0].replies = commentNodes.slice(1, commentNodes.length);
		}

		commentNodes[0].isRoot = true;

		return commentNodes[0];
	}
}

export class CommentsModel {
	resourceCommentThreads: ResourceWithCommentThreads[];
	commentThreadsMap: Map<string, ResourceWithCommentThreads[]>;

	constructor() {
		this.resourceCommentThreads = [];
		this.commentThreadsMap = new Map<string, ResourceWithCommentThreads[]>();
	}

	public setCommentThreads(owner: string, commentThreads: CommentThread[]): void {
		this.commentThreadsMap.set(owner, this.groupByResource(owner, commentThreads));
		this.resourceCommentThreads = flatten([...this.commentThreadsMap.values()]);
	}

	public updateCommentThreads(event: ICommentThreadChangedEvent): boolean {
		const { owner, removed, changed, added } = event;

		let threadsForOwner = this.commentThreadsMap.get(owner) || [];

		removed.forEach(thread => {
			// Find resource that has the comment thread
			const matchingResourceIndex = firstIndex(threadsForOwner, (resourceData) => resourceData.id === thread.resource);
			const matchingResourceData = threadsForOwner[matchingResourceIndex];

			// Find comment node on resource that is that thread and remove it
			const index = firstIndex(matchingResourceData.commentThreads, (commentThread) => commentThread.threadId === thread.threadId);
			matchingResourceData.commentThreads.splice(index, 1);

			// If the comment thread was the last thread for a resource, remove that resource from the list
			if (matchingResourceData.commentThreads.length === 0) {
				threadsForOwner.splice(matchingResourceIndex, 1);
			}
		});

		changed.forEach(thread => {
			// Find resource that has the comment thread
			const matchingResourceIndex = firstIndex(threadsForOwner, (resourceData) => resourceData.id === thread.resource);
			const matchingResourceData = threadsForOwner[matchingResourceIndex];

			// Find comment node on resource that is that thread and replace it
			const index = firstIndex(matchingResourceData.commentThreads, (commentThread) => commentThread.threadId === thread.threadId);
			if (index >= 0) {
				matchingResourceData.commentThreads[index] = ResourceWithCommentThreads.createCommentNode(owner, URI.parse(matchingResourceData.id), thread);
			} else if (thread.comments && thread.comments.length) {
				matchingResourceData.commentThreads.push(ResourceWithCommentThreads.createCommentNode(owner, URI.parse(matchingResourceData.id), thread));
			}
		});

		added.forEach(thread => {
			const existingResource = threadsForOwner.filter(resourceWithThreads => resourceWithThreads.resource.toString() === thread.resource);
			if (existingResource.length) {
				const resource = existingResource[0];
				if (thread.comments && thread.comments.length) {
					resource.commentThreads.push(ResourceWithCommentThreads.createCommentNode(owner, resource.resource, thread));
				}
			} else {
				threadsForOwner.push(new ResourceWithCommentThreads(owner, URI.parse(thread.resource!), [thread]));
			}
		});

		this.commentThreadsMap.set(owner, threadsForOwner);
		this.resourceCommentThreads = flatten([...this.commentThreadsMap.values()]);

		return removed.length > 0 || changed.length > 0 || added.length > 0;
	}

	public hasCommentThreads(): boolean {
		return !!this.resourceCommentThreads.length;
	}

	public getMessage(): string {
		if (!this.resourceCommentThreads.length) {
			return localize('noComments', "There are no comments on this review.");
		} else {
			return '';
		}
	}

	private groupByResource(owner: string, commentThreads: CommentThread[]): ResourceWithCommentThreads[] {
		const resourceCommentThreads: ResourceWithCommentThreads[] = [];
		const commentThreadsByResource = new Map<string, ResourceWithCommentThreads>();
		for (const group of groupBy(commentThreads, CommentsModel._compareURIs)) {
			commentThreadsByResource.set(group[0].resource!, new ResourceWithCommentThreads(owner, URI.parse(group[0].resource!), group));
		}

		commentThreadsByResource.forEach((v, i, m) => {
			resourceCommentThreads.push(v);
		});

		return resourceCommentThreads;
	}

	private static _compareURIs(a: CommentThread, b: CommentThread) {
		const resourceA = a.resource!.toString();
		const resourceB = b.resource!.toString();
		if (resourceA < resourceB) {
			return -1;
		} else if (resourceA > resourceB) {
			return 1;
		} else {
			return 0;
		}
	}
}
