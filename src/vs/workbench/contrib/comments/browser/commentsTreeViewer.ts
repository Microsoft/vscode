/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as dom from 'vs/base/browser/dom';
import * as nls from 'vs/nls';
import { renderMarkdown } from 'vs/base/browser/markdownRenderer';
import { onUnexpectedError } from 'vs/base/common/errors';
import { IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IResourceLabel, ResourceLabels } from 'vs/workbench/browser/labels';
import { CommentNode, CommentsModel, ResourceWithCommentThreads } from 'vs/workbench/contrib/comments/common/commentModel';
import { IAsyncDataSource, ITreeNode } from 'vs/base/browser/ui/tree/tree';
import { IListVirtualDelegate, IListRenderer } from 'vs/base/browser/ui/list/list';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { WorkbenchAsyncDataTree, IListService, IWorkbenchAsyncDataTreeOptions } from 'vs/platform/list/browser/listService';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IColorMapping } from 'vs/platform/theme/common/styler';

export const COMMENTS_VIEW_ID = 'workbench.panel.comments';
export const COMMENTS_VIEW_TITLE = 'Comments';

export class CommentsAsyncDataSource implements IAsyncDataSource<any, any> {
	hasChildren(element: any): boolean {
		return element instanceof CommentsModel || element instanceof ResourceWithCommentThreads || (element instanceof CommentNode && !!element.replies.length);
	}

	getChildren(element: any): any[] | Promise<any[]> {
		if (element instanceof CommentsModel) {
			return Promise.resolve(element.resourceCommentThreads);
		}
		if (element instanceof ResourceWithCommentThreads) {
			return Promise.resolve(element.commentThreads);
		}
		if (element instanceof CommentNode) {
			return Promise.resolve(element.replies);
		}
		return Promise.resolve([]);
	}
}

interface IResourceTemplateData {
	resourceLabel: IResourceLabel;
}

interface ICommentThreadTemplateData {
	icon: HTMLImageElement;
	userName: HTMLSpanElement;
	commentText: HTMLElement;
	disposables: IDisposable[];
}

export class CommentsModelVirualDelegate implements IListVirtualDelegate<any> {
	private static readonly RESOURCE_ID = 'resource-with-comments';
	private static readonly COMMENT_ID = 'comment-node';


	getHeight(element: any): number {
		return 22;
	}

	public getTemplateId(element: any): string {
		if (element instanceof ResourceWithCommentThreads) {
			return CommentsModelVirualDelegate.RESOURCE_ID;
		}
		if (element instanceof CommentNode) {
			return CommentsModelVirualDelegate.COMMENT_ID;
		}

		return '';
	}
}

export class ResourceWithCommentsRenderer implements IListRenderer<ITreeNode<ResourceWithCommentThreads>, IResourceTemplateData> {
	templateId: string = 'resource-with-comments';

	constructor(
		private labels: ResourceLabels
	) {
	}

	renderTemplate(container: HTMLElement) {
		const data = <IResourceTemplateData>Object.create(null);
		const labelContainer = dom.append(container, dom.$('.resource-container'));
		data.resourceLabel = this.labels.create(labelContainer);

		return data;
	}

	renderElement(node: ITreeNode<ResourceWithCommentThreads>, index: number, templateData: IResourceTemplateData, height: number | undefined): void {
		templateData.resourceLabel.setFile(node.element.resource);
	}

	disposeTemplate(templateData: IResourceTemplateData): void {
		templateData.resourceLabel.dispose();
	}
}

export class CommentNodeRenderer implements IListRenderer<ITreeNode<CommentNode>, ICommentThreadTemplateData> {
	templateId: string = 'comment-node';

	constructor(
		@IOpenerService private readonly openerService: IOpenerService
	) { }

	renderTemplate(container: HTMLElement) {
		const data = <ICommentThreadTemplateData>Object.create(null);
		const labelContainer = dom.append(container, dom.$('.comment-container'));
		data.userName = dom.append(labelContainer, dom.$('.user'));
		data.commentText = dom.append(labelContainer, dom.$('.text'));
		data.disposables = [];

		return data;
	}

	renderElement(node: ITreeNode<CommentNode>, index: number, templateData: ICommentThreadTemplateData, height: number | undefined): void {
		templateData.userName.textContent = node.element.comment.userName;
		templateData.commentText.innerText = '';
		const disposables = new DisposableStore();
		templateData.disposables.push(disposables);
		const renderedComment = renderMarkdown(node.element.comment.body, {
			inline: true,
			actionHandler: {
				callback: (content) => {
					this.openerService.open(content, { allowCommands: node.element.comment.body.isTrusted }).catch(onUnexpectedError);
				},
				disposeables: disposables
			}
		});

		const images = renderedComment.getElementsByTagName('img');
		for (let i = 0; i < images.length; i++) {
			const image = images[i];
			const textDescription = dom.$('');
			textDescription.textContent = image.alt ? nls.localize('imageWithLabel', "Image: {0}", image.alt) : nls.localize('image', "Image");
			image.parentNode!.replaceChild(textDescription, image);
		}

		templateData.commentText.appendChild(renderedComment);
		templateData.commentText.title = renderedComment.textContent ?? '';
	}

	disposeTemplate(templateData: ICommentThreadTemplateData): void {
		templateData.disposables.forEach(disposeable => disposeable.dispose());
	}
}

export interface ICommentsListOptions extends IWorkbenchAsyncDataTreeOptions<any, any> {
	overrideStyles?: IColorMapping;
}

export class CommentsList extends WorkbenchAsyncDataTree<any, any> {
	constructor(
		labels: ResourceLabels,
		container: HTMLElement,
		options: ICommentsListOptions,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IListService listService: IListService,
		@IThemeService themeService: IThemeService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IAccessibilityService accessibilityService: IAccessibilityService
	) {
		const delegate = new CommentsModelVirualDelegate();
		const dataSource = new CommentsAsyncDataSource();

		const renderers = [
			instantiationService.createInstance(ResourceWithCommentsRenderer, labels),
			instantiationService.createInstance(CommentNodeRenderer)
		];

		super(
			'CommentsTree',
			container,
			delegate,
			renderers,
			dataSource,
			{
				accessibilityProvider: options.accessibilityProvider,
				identityProvider: {
					getId: (element: any) => {
						if (element instanceof CommentsModel) {
							return 'root';
						}
						if (element instanceof ResourceWithCommentThreads) {
							return `${element.owner}-${element.id}`;
						}
						if (element instanceof CommentNode) {
							return `${element.owner}-${element.resource.toString()}-${element.threadId}-${element.comment.uniqueIdInThread}` + (element.isRoot ? '-root' : '');
						}
						return '';
					}
				},
				expandOnlyOnTwistieClick: (element: any) => {
					if (element instanceof CommentsModel || element instanceof ResourceWithCommentThreads) {
						return false;
					}

					return true;
				},
				collapseByDefault: () => {
					return false;
				},
				overrideStyles: options.overrideStyles
			},
			contextKeyService,
			listService,
			themeService,
			configurationService,
			keybindingService,
			accessibilityService
		);
	}
}
