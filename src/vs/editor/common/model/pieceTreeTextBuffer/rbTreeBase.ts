/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Piece, PieceTreeBase } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeBase';

export class TreeNode {
	parent: TreeNode;
	left: TreeNode;
	right: TreeNode;
	color: NodeColor;

	// Piece
	piece: Piece;
	size_left: number; // size of the left subtree (not inorder)
	lf_left: number; // line feeds cnt in the left subtree (not inorder)

	constructor(piece: Piece, color: NodeColor) {
		this.piece = piece;
		this.color = color;
		this.size_left = 0;
		this.lf_left = 0;
		this.parent = this;
		this.left = this;
		this.right = this;
	}

	public next(): TreeNode {
		if (this.right !== SENTINEL) {
			return leftmost(this.right);
		}

		let node: TreeNode = this;

		while (node.parent !== SENTINEL) {
			if (node.parent.left === node) {
				break;
			}

			node = node.parent;
		}

		if (node.parent === SENTINEL) {
			return SENTINEL;
		} else {
			return node.parent;
		}
	}

	public prev(): TreeNode {
		if (this.left !== SENTINEL) {
			return rightmost(this.left);
		}

		let node: TreeNode = this;

		while (node.parent !== SENTINEL) {
			if (node.parent.right === node) {
				break;
			}

			node = node.parent;
		}

		if (node.parent === SENTINEL) {
			return SENTINEL;
		} else {
			return node.parent;
		}
	}

	public detach(): void {
		this.parent = null!;
		this.left = null!;
		this.right = null!;
	}
}

export const enum NodeColor {
	Black = 0,
	Red = 1,
}

export const SENTINEL: TreeNode = new TreeNode(null!, NodeColor.Black);
SENTINEL.parent = SENTINEL;
SENTINEL.left = SENTINEL;
SENTINEL.right = SENTINEL;
SENTINEL.color = NodeColor.Black;

export function leftmost(node: TreeNode): TreeNode {
	while (node.left !== SENTINEL) {
		node = node.left;
	}
	return node;
}

export function rightmost(node: TreeNode): TreeNode {
	while (node.right !== SENTINEL) {
		node = node.right;
	}
	return node;
}

export function calculateSize(node: TreeNode): number {
	let sum = 0;

	while (node !== SENTINEL) {
		sum += node.size_left + node.piece.length;
		node = node.right;
	}

	return sum;
}

export function calculateLF(node: TreeNode): number {
	let sum = 0;

	while (node !== SENTINEL) {
		sum += node.lf_left + node.piece.lineFeedCnt;
		node = node.right;
	}

	return sum;
}

export function resetSentinel(): void {
	SENTINEL.parent = SENTINEL;
}

export function leftRotate(tree: PieceTreeBase, x: TreeNode) {
	let y = x.right;

	// fix size_left
	y.size_left += x.size_left + (x.piece ? x.piece.length : 0);
	y.lf_left += x.lf_left + (x.piece ? x.piece.lineFeedCnt : 0);
	x.right = y.left;

	if (y.left !== SENTINEL) {
		y.left.parent = x;
	}
	y.parent = x.parent;
	if (x.parent === SENTINEL) {
		tree.root = y;
	} else if (x.parent.left === x) {
		x.parent.left = y;
	} else {
		x.parent.right = y;
	}
	y.left = x;
	x.parent = y;
}

export function rightRotate(tree: PieceTreeBase, y: TreeNode) {
	let x = y.left;
	y.left = x.right;
	if (x.right !== SENTINEL) {
		x.right.parent = y;
	}
	x.parent = y.parent;

	// fix size_left
	y.size_left -= x.size_left + (x.piece ? x.piece.length : 0);
	y.lf_left -= x.lf_left + (x.piece ? x.piece.lineFeedCnt : 0);

	if (y.parent === SENTINEL) {
		tree.root = x;
	} else if (y === y.parent.right) {
		y.parent.right = x;
	} else {
		y.parent.left = x;
	}

	x.right = y;
	y.parent = x;
}

export function rbDelete(tree: PieceTreeBase, z: TreeNode) {
	let x: TreeNode;
	let y: TreeNode;

	if (z.left === SENTINEL) {
		y = z;
		x = y.right;
	} else if (z.right === SENTINEL) {
		y = z;
		x = y.left;
	} else {
		y = leftmost(z.right);
		x = y.right;
	}

	if (y === tree.root) {
		tree.root = x;

		// if x is null, we are removing the only node
		x.color = NodeColor.Black;
		z.detach();
		resetSentinel();
		tree.root.parent = SENTINEL;

		return;
	}

	let yWasRed = (y.color === NodeColor.Red);

	if (y === y.parent.left) {
		y.parent.left = x;
	} else {
		y.parent.right = x;
	}

	if (y === z) {
		x.parent = y.parent;
		recomputeTreeMetadata(tree, x);
	} else {
		if (y.parent === z) {
			x.parent = y;
		} else {
			x.parent = y.parent;
		}

		// as we make changes to x's hierarchy, update size_left of subtree first
		recomputeTreeMetadata(tree, x);

		y.left = z.left;
		y.right = z.right;
		y.parent = z.parent;
		y.color = z.color;

		if (z === tree.root) {
			tree.root = y;
		} else {
			if (z === z.parent.left) {
				z.parent.left = y;
			} else {
				z.parent.right = y;
			}
		}

		if (y.left !== SENTINEL) {
			y.left.parent = y;
		}
		if (y.right !== SENTINEL) {
			y.right.parent = y;
		}
		// update metadata
		// we replace z with y, so in this sub tree, the length change is z.item.length
		y.size_left = z.size_left;
		y.lf_left = z.lf_left;
		recomputeTreeMetadata(tree, y);
	}

	z.detach();

	if (x.parent.left === x) {
		let newSizeLeft = calculateSize(x);
		let newLFLeft = calculateLF(x);
		if (newSizeLeft !== x.parent.size_left || newLFLeft !== x.parent.lf_left) {
			let delta = newSizeLeft - x.parent.size_left;
			let lf_delta = newLFLeft - x.parent.lf_left;
			x.parent.size_left = newSizeLeft;
			x.parent.lf_left = newLFLeft;
			updateTreeMetadata(tree, x.parent, delta, lf_delta);
		}
	}

	recomputeTreeMetadata(tree, x.parent);

	if (yWasRed) {
		resetSentinel();
		return;
	}

	// RB-DELETE-FIXUP
	let w: TreeNode;
	while (x !== tree.root && x.color === NodeColor.Black) {
		if (x === x.parent.left) {
			w = x.parent.right;

			if (w.color === NodeColor.Red) {
				w.color = NodeColor.Black;
				x.parent.color = NodeColor.Red;
				leftRotate(tree, x.parent);
				w = x.parent.right;
			}

			if (w.left.color === NodeColor.Black && w.right.color === NodeColor.Black) {
				w.color = NodeColor.Red;
				x = x.parent;
			} else {
				if (w.right.color === NodeColor.Black) {
					w.left.color = NodeColor.Black;
					w.color = NodeColor.Red;
					rightRotate(tree, w);
					w = x.parent.right;
				}

				w.color = x.parent.color;
				x.parent.color = NodeColor.Black;
				w.right.color = NodeColor.Black;
				leftRotate(tree, x.parent);
				x = tree.root;
			}
		} else {
			w = x.parent.left;

			if (w.color === NodeColor.Red) {
				w.color = NodeColor.Black;
				x.parent.color = NodeColor.Red;
				rightRotate(tree, x.parent);
				w = x.parent.left;
			}

			if (w.left.color === NodeColor.Black && w.right.color === NodeColor.Black) {
				w.color = NodeColor.Red;
				x = x.parent;

			} else {
				if (w.left.color === NodeColor.Black) {
					w.right.color = NodeColor.Black;
					w.color = NodeColor.Red;
					leftRotate(tree, w);
					w = x.parent.left;
				}

				w.color = x.parent.color;
				x.parent.color = NodeColor.Black;
				w.left.color = NodeColor.Black;
				rightRotate(tree, x.parent);
				x = tree.root;
			}
		}
	}
	x.color = NodeColor.Black;
	resetSentinel();
}

export function fixInsert(tree: PieceTreeBase, x: TreeNode) {
	recomputeTreeMetadata(tree, x);

	while (x !== tree.root && x.parent.color === NodeColor.Red) {
		if (x.parent === x.parent.parent.left) {
			const y = x.parent.parent.right;

			if (y.color === NodeColor.Red) {
				x.parent.color = NodeColor.Black;
				y.color = NodeColor.Black;
				x.parent.parent.color = NodeColor.Red;
				x = x.parent.parent;
			} else {
				if (x === x.parent.right) {
					x = x.parent;
					leftRotate(tree, x);
				}

				x.parent.color = NodeColor.Black;
				x.parent.parent.color = NodeColor.Red;
				rightRotate(tree, x.parent.parent);
			}
		} else {
			const y = x.parent.parent.left;

			if (y.color === NodeColor.Red) {
				x.parent.color = NodeColor.Black;
				y.color = NodeColor.Black;
				x.parent.parent.color = NodeColor.Red;
				x = x.parent.parent;
			} else {
				if (x === x.parent.left) {
					x = x.parent;
					rightRotate(tree, x);
				}
				x.parent.color = NodeColor.Black;
				x.parent.parent.color = NodeColor.Red;
				leftRotate(tree, x.parent.parent);
			}
		}
	}

	tree.root.color = NodeColor.Black;
}

export function createTreeNode(p: Piece, color: NodeColor): TreeNode {
	const treeNode = new TreeNode(p, color);
	treeNode.parent = treeNode.left = treeNode.right = SENTINEL;
	treeNode.size_left = treeNode.lf_left = 0;
	return treeNode;
}

export function updateTreeMetadata(tree: PieceTreeBase, x: TreeNode, delta: number, lineFeedCntDelta: number): void {
	// node length change or line feed count change
	while (x !== tree.root && x !== SENTINEL) {
		if (x.parent.left === x) {
			x.parent.size_left += delta;
			x.parent.lf_left += lineFeedCntDelta;
		}

		x = x.parent;
	}
}

export function recomputeTreeMetadata(tree: PieceTreeBase, x: TreeNode) {
	let delta = 0;
	let lf_delta = 0;
	if (x === tree.root) {
		return;
	}

	if (delta === 0) {
		// go upwards till the node whose left subtree is changed.
		while (x !== tree.root && x === x.parent.right) {
			x = x.parent;
		}

		if (x === tree.root) {
			// well, it means we add a node to the end (inorder)
			return;
		}

		// x is the node whose right subtree is changed.
		x = x.parent;

		delta = calculateSize(x.left) - x.size_left;
		lf_delta = calculateLF(x.left) - x.lf_left;
		x.size_left += delta;
		x.lf_left += lf_delta;
	}

	// go upwards till root. O(logN)
	while (x !== tree.root && (delta !== 0 || lf_delta !== 0)) {
		if (x.parent.left === x) {
			x.parent.size_left += delta;
			x.parent.lf_left += lf_delta;
		}

		x = x.parent;
	}
}
