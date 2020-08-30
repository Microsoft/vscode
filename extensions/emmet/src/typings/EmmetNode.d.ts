/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module 'EmmetNode' {
    import { Position } from 'vscode';

    export interface Node {
        start: Position
        end: Position
        type: string
        parent: Node
        firstChild: Node
        nextSibling: Node
        previousSibling: Node
        children: Node[]
    }

    export interface Token {
        start: Position
        end: Position
        stream: BufferStream
        toString(): string
    }

    export interface CssToken extends Token {
        size: number
        item(number: number): any
        type: string
    }

    export interface HtmlToken extends Token {
        value: string
    }

    export interface Attribute extends Token {
        name: Token
        value: Token
    }

    export interface HtmlNode extends Node {
        name: string
        open: Token
        close: Token
        parent: HtmlNode
        firstChild: HtmlNode
        nextSibling: HtmlNode
        previousSibling: HtmlNode
        children: HtmlNode[]
        attributes: Attribute[]
    }

    export interface CssNode extends Node {
        name: string
        parent: CssNode
        firstChild: CssNode
        nextSibling: CssNode
        previousSibling: CssNode
        children: CssNode[]
    }

    export interface Rule extends CssNode {
        selectorToken: Token
        contentStartToken: Token
        contentEndToken: Token
    }

    export interface Property extends CssNode {
        valueToken: Token
        separator: string
        parent: Rule
        terminatorToken: Token
        separatorToken: Token
        value: string
    }

    export interface Stylesheet extends Node {
        comments: Token[]
    }

    export interface BufferStream {
        peek(): number
        next(): number
        backUp(n: number): number
        current(): string
        substring(from: Position, to: Position): string
        eat(match: any): boolean
        eatWhile(match: any): boolean
    }
}




