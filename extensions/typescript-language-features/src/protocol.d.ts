import * as Proto from 'typescript/lib/protocol';
export = Proto;

declare enum ServerType {
	Syntax = 'syntax',
	Semantic = 'semantic',
}
declare module 'typescript/lib/protocol' {

	interface Response {
		readonly _serverType?: ServerType;
	}

	interface JSDocLinkDisplayPart {
		target: Proto.FileSpan;
	}
}

