/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// Type definitions for Marked 0.4
// Project: https://github.com/markedjs/marked
// Definitions by: William Orr <https://github.com/worr>
//                 BendingBender <https://github.com/BendingBender>
//                 CrossR <https://github.com/CrossR>
// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped

export as namespace marked;

export = marked;
/**
 * Compiles markdown to HTML.
 *
 * @param src String of markdown source to be compiled
 * @param callback Function called when the markdownString has been fully parsed when using async highlighting
 * @return String of compiled HTML
 */
declare function marked(src: string, callback: (error: any | undefined, parseResult: string) => void): string;

/**
 * Compiles markdown to HTML.
 *
 * @param src String of markdown source to be compiled
 * @param options Hash of options
 * @param callback Function called when the markdownString has been fully parsed when using async highlighting
 * @return String of compiled HTML
 */
declare function marked(src: string, options?: marked.MarkedOptions, callback?: (error: any | undefined, parseResult: string) => void): string;

declare namespace marked {
    /**
     * @param src String of markdown source to be compiled
     * @param options Hash of options
     */
	function lexer(src: string, options?: MarkedOptions): TokensList;

    /**
     * Compiles markdown to HTML.
     *
     * @param src String of markdown source to be compiled
     * @param callback Function called when the markdownString has been fully parsed when using async highlighting
     * @return String of compiled HTML
     */
	function parse(src: string, callback: (error: any | undefined, parseResult: string) => void): string;

    /**
     * Compiles markdown to HTML.
     *
     * @param src String of markdown source to be compiled
     * @param options Hash of options
     * @param callback Function called when the markdownString has been fully parsed when using async highlighting
     * @return String of compiled HTML
     */
	function parse(src: string, options?: MarkedOptions, callback?: (error: any | undefined, parseResult: string) => void): string;

    /**
     * @param src Tokenized source as array of tokens
     * @param options Hash of options
     */
	function parser(src: TokensList, options?: MarkedOptions): string;

    /**
     * Sets the default options.
     *
     * @param options Hash of options
     */
	function setOptions(options: MarkedOptions): typeof marked;

	class Renderer {
		constructor(options?: MarkedOptions);
		code(code: string, language: string, isEscaped: boolean): string;
		blockquote(quote: string): string;
		html(html: string): string;
		heading(text: string, level: number, raw: string): string;
		hr(): string;
		list(body: string, ordered: boolean): string;
		listitem(text: string): string;
		paragraph(text: string): string;
		table(header: string, body: string): string;
		tablerow(content: string): string;
		tablecell(content: string, flags: {
			header: boolean;
			align: 'center' | 'left' | 'right' | null;
		}): string;
		strong(text: string): string;
		em(text: string): string;
		codespan(code: string): string;
		br(): string;
		del(text: string): string;
		link(href: string, title: string, text: string): string;
		image(href: string, title: string, text: string): string;
		text(text: string): string;
	}

	class Lexer {
		rules: Rules;
		tokens: TokensList;
		constructor(options?: MarkedOptions);
		lex(src: string): TokensList;
	}

	interface Rules {
		[ruleName: string]: RegExp | Rules;
	}

	type TokensList = Token[] & {
		links: {
			[key: string]: { href: string; title: string; }
		}
	};

	type Token =
		Tokens.Space
		| Tokens.Code
		| Tokens.Heading
		| Tokens.Table
		| Tokens.Hr
		| Tokens.BlockquoteStart
		| Tokens.BlockquoteEnd
		| Tokens.ListStart
		| Tokens.LooseItemStart
		| Tokens.ListItemStart
		| Tokens.ListItemEnd
		| Tokens.ListEnd
		| Tokens.Paragraph
		| Tokens.HTML
		| Tokens.Text;

	namespace Tokens {
		interface Space {
			type: 'space';
		}

		interface Code {
			type: 'code';
			lang?: string;
			text: string;
		}

		interface Heading {
			type: 'heading';
			depth: number;
			text: string;
		}

		interface Table {
			type: 'table';
			header: string[];
			align: Array<'center' | 'left' | 'right' | null>;
			cells: string[][];
		}

		interface Hr {
			type: 'hr';
		}

		interface BlockquoteStart {
			type: 'blockquote_start';
		}

		interface BlockquoteEnd {
			type: 'blockquote_end';
		}

		interface ListStart {
			type: 'list_start';
			ordered: boolean;
		}

		interface LooseItemStart {
			type: 'loose_item_start';
		}

		interface ListItemStart {
			type: 'list_item_start';
		}

		interface ListItemEnd {
			type: 'list_item_end';
		}

		interface ListEnd {
			type: 'list_end';
		}

		interface Paragraph {
			type: 'paragraph';
			pre?: boolean;
			text: string;
		}

		interface HTML {
			type: 'html';
			pre: boolean;
			text: string;
		}

		interface Text {
			type: 'text';
			text: string;
		}
	}

	interface MarkedOptions {
        /**
         * A prefix URL for any relative link.
         */
		baseUrl?: string;

        /**
         * Enable GFM line breaks. This option requires the gfm option to be true.
         */
		breaks?: boolean;

        /**
         * Enable GitHub flavored markdown.
         */
		gfm?: boolean;

        /**
         * Include an id attribute when emitting headings.
         */
		headerIds?: boolean;

        /**
         * Set the prefix for header tag ids.
         */
		headerPrefix?: string;

        /**
         * A function to highlight code blocks. The function takes three arguments: code, lang, and callback.
         */
		highlight?(code: string, lang: string, callback?: (error: any | undefined, code: string) => void): string;

        /**
         * Set the prefix for code block classes.
         */
		langPrefix?: string;

        /**
         * Mangle autolinks (<email@domain.com>).
         */
		mangle?: boolean;

        /**
         * Conform to obscure parts of markdown.pl as much as possible. Don't fix any of the original markdown bugs or poor behavior.
         */
		pedantic?: boolean;

        /**
         * Type: object Default: new Renderer()
         *
         * An object containing functions to render tokens to HTML.
         */
		renderer?: Renderer;

        /**
         * Sanitize the output. Ignore any HTML that has been input.
         */
		sanitize?: boolean;

        /**
         * Optionally sanitize found HTML with a sanitizer function.
         */
		sanitizer?(html: string): string;

        /**
         * Shows an HTML error message when rendering fails.
         */
		silent?: boolean;

        /**
         * Use smarter list behavior than the original markdown. May eventually be default with the old behavior moved into pedantic.
         */
		smartLists?: boolean;

        /**
         * Use "smart" typograhic punctuation for things like quotes and dashes.
         */
		smartypants?: boolean;

        /**
         * Enable GFM tables. This option requires the gfm option to be true.
         */
		tables?: boolean;

        /**
         * Generate closing slash for self-closing tags (<br/> instead of <br>)
         */
		xhtml?: boolean;
	}
}
