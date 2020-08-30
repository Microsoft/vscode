/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

declare module '@emmetio/html-matcher' {
	import { BufferStream, HtmlNode } from 'EmmetNode';

	function parse(stream: BufferStream): HtmlNode;

	export default parse;
}

