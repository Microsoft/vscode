/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { editorActiveIndentGuides, editorIndentGuides } from 'vs/editor/common/view/editorColorRegistry';
import { IStandaloneThemeData } from 'vs/editor/standalone/common/standaloneThemeService';
import { editorBackground, editorForeground, editorInactiveSelection, editorSelectionHighlight, listFocusHighlightForeground } from 'vs/platform/theme/common/colorRegistry';

/* -------------------------------- Begin vs theme -------------------------------- */
export const vs: IStandaloneThemeData = {
	base: 'vs',
	inherit: false,
	rules: [
		{ token: '', foreground: '000000', background: 'fffffe' },
		{ token: 'invalid', foreground: 'cd3131' },
		{ token: 'emphasis', fontStyle: 'italic' },
		{ token: 'strong', fontStyle: 'bold' },

		{ token: 'variable', foreground: '001188' },
		{ token: 'variable.predefined', foreground: '4864AA' },
		{ token: 'constant', foreground: 'dd0000' },
		{ token: 'comment', foreground: '008000' },
		{ token: 'number', foreground: '098658' },
		{ token: 'number.hex', foreground: '3030c0' },
		{ token: 'regexp', foreground: '800000' },
		{ token: 'annotation', foreground: '808080' },
		{ token: 'type', foreground: '008080' },

		{ token: 'delimiter', foreground: '000000' },
		{ token: 'delimiter.html', foreground: '383838' },
		{ token: 'delimiter.xml', foreground: '0000FF' },

		{ token: 'tag', foreground: '800000' },
		{ token: 'tag.id.pug', foreground: '4F76AC' },
		{ token: 'tag.class.pug', foreground: '4F76AC' },
		{ token: 'meta.scss', foreground: '800000' },
		{ token: 'metatag', foreground: 'e00000' },
		{ token: 'metatag.content.html', foreground: 'FF0000' },
		{ token: 'metatag.html', foreground: '808080' },
		{ token: 'metatag.xml', foreground: '808080' },
		{ token: 'metatag.php', fontStyle: 'bold' },

		{ token: 'key', foreground: '863B00' },
		{ token: 'string.key.json', foreground: 'A31515' },
		{ token: 'string.value.json', foreground: '0451A5' },

		{ token: 'attribute.name', foreground: 'FF0000' },
		{ token: 'attribute.value', foreground: '0451A5' },
		{ token: 'attribute.value.number', foreground: '098658' },
		{ token: 'attribute.value.unit', foreground: '098658' },
		{ token: 'attribute.value.html', foreground: '0000FF' },
		{ token: 'attribute.value.xml', foreground: '0000FF' },

		{ token: 'string', foreground: 'A31515' },
		{ token: 'string.html', foreground: '0000FF' },
		{ token: 'string.sql', foreground: 'FF0000' },
		{ token: 'string.yaml', foreground: '0451A5' },

		{ token: 'keyword', foreground: '0000FF' },
		{ token: 'keyword.json', foreground: '0451A5' },
		{ token: 'keyword.flow', foreground: 'AF00DB' },
		{ token: 'keyword.flow.scss', foreground: '0000FF' },

		{ token: 'operator.scss', foreground: '666666' },
		{ token: 'operator.sql', foreground: '778899' },
		{ token: 'operator.swift', foreground: '666666' },
		{ token: 'predefined.sql', foreground: 'C700C7' },
	],
	colors: {
		[editorBackground]: '#FFFFFE',
		[editorForeground]: '#000000',
		[editorInactiveSelection]: '#E5EBF1',
		[editorIndentGuides]: '#D3D3D3',
		[editorActiveIndentGuides]: '#939393',
		[editorSelectionHighlight]: '#ADD6FF4D',
		[listFocusHighlightForeground]: '#33B6FF'
	}
};
/* -------------------------------- End vs theme -------------------------------- */


/* -------------------------------- Begin vs-dark theme -------------------------------- */
export const vs_dark: IStandaloneThemeData = {
	base: 'vs-dark',
	inherit: false,
	rules: [
		{ token: '', foreground: 'D4D4D4', background: '1E1E1E' },
		{ token: 'invalid', foreground: 'f44747' },
		{ token: 'emphasis', fontStyle: 'italic' },
		{ token: 'strong', fontStyle: 'bold' },

		{ token: 'variable', foreground: '74B0DF' },
		{ token: 'variable.predefined', foreground: '4864AA' },
		{ token: 'variable.parameter', foreground: '9CDCFE' },
		{ token: 'constant', foreground: '569CD6' },
		{ token: 'comment', foreground: '608B4E' },
		{ token: 'number', foreground: 'B5CEA8' },
		{ token: 'number.hex', foreground: '5BB498' },
		{ token: 'regexp', foreground: 'B46695' },
		{ token: 'annotation', foreground: 'cc6666' },
		{ token: 'type', foreground: '3DC9B0' },

		{ token: 'delimiter', foreground: 'DCDCDC' },
		{ token: 'delimiter.html', foreground: '808080' },
		{ token: 'delimiter.xml', foreground: '808080' },

		{ token: 'tag', foreground: '569CD6' },
		{ token: 'tag.id.pug', foreground: '4F76AC' },
		{ token: 'tag.class.pug', foreground: '4F76AC' },
		{ token: 'meta.scss', foreground: 'A79873' },
		{ token: 'meta.tag', foreground: 'CE9178' },
		{ token: 'metatag', foreground: 'DD6A6F' },
		{ token: 'metatag.content.html', foreground: '9CDCFE' },
		{ token: 'metatag.html', foreground: '569CD6' },
		{ token: 'metatag.xml', foreground: '569CD6' },
		{ token: 'metatag.php', fontStyle: 'bold' },

		{ token: 'key', foreground: '9CDCFE' },
		{ token: 'string.key.json', foreground: '9CDCFE' },
		{ token: 'string.value.json', foreground: 'CE9178' },

		{ token: 'attribute.name', foreground: '9CDCFE' },
		{ token: 'attribute.value', foreground: 'CE9178' },
		{ token: 'attribute.value.number.css', foreground: 'B5CEA8' },
		{ token: 'attribute.value.unit.css', foreground: 'B5CEA8' },
		{ token: 'attribute.value.hex.css', foreground: 'D4D4D4' },

		{ token: 'string', foreground: 'CE9178' },
		{ token: 'string.sql', foreground: 'FF0000' },

		{ token: 'keyword', foreground: '569CD6' },
		{ token: 'keyword.flow', foreground: 'C586C0' },
		{ token: 'keyword.json', foreground: 'CE9178' },
		{ token: 'keyword.flow.scss', foreground: '569CD6' },

		{ token: 'operator.scss', foreground: '909090' },
		{ token: 'operator.sql', foreground: '778899' },
		{ token: 'operator.swift', foreground: '909090' },
		{ token: 'predefined.sql', foreground: 'FF00FF' },
	],
	colors: {
		[editorBackground]: '#1E1E1E',
		[editorForeground]: '#D4D4D4',
		[editorInactiveSelection]: '#3A3D41',
		[editorIndentGuides]: '#404040',
		[editorActiveIndentGuides]: '#707070',
		[editorSelectionHighlight]: '#ADD6FF26'
	}
};
/* -------------------------------- End vs-dark theme -------------------------------- */



/* -------------------------------- Begin hc-black theme -------------------------------- */
export const hc_black: IStandaloneThemeData = {
	base: 'hc-black',
	inherit: false,
	rules: [
		{ token: '', foreground: 'FFFFFF', background: '000000' },
		{ token: 'invalid', foreground: 'f44747' },
		{ token: 'emphasis', fontStyle: 'italic' },
		{ token: 'strong', fontStyle: 'bold' },

		{ token: 'variable', foreground: '1AEBFF' },
		{ token: 'variable.parameter', foreground: '9CDCFE' },
		{ token: 'constant', foreground: '569CD6' },
		{ token: 'comment', foreground: '608B4E' },
		{ token: 'number', foreground: 'FFFFFF' },
		{ token: 'regexp', foreground: 'C0C0C0' },
		{ token: 'annotation', foreground: '569CD6' },
		{ token: 'type', foreground: '3DC9B0' },

		{ token: 'delimiter', foreground: 'FFFF00' },
		{ token: 'delimiter.html', foreground: 'FFFF00' },

		{ token: 'tag', foreground: '569CD6' },
		{ token: 'tag.id.pug', foreground: '4F76AC' },
		{ token: 'tag.class.pug', foreground: '4F76AC' },
		{ token: 'meta', foreground: 'D4D4D4' },
		{ token: 'meta.tag', foreground: 'CE9178' },
		{ token: 'metatag', foreground: '569CD6' },
		{ token: 'metatag.content.html', foreground: '1AEBFF' },
		{ token: 'metatag.html', foreground: '569CD6' },
		{ token: 'metatag.xml', foreground: '569CD6' },
		{ token: 'metatag.php', fontStyle: 'bold' },

		{ token: 'key', foreground: '9CDCFE' },
		{ token: 'string.key', foreground: '9CDCFE' },
		{ token: 'string.value', foreground: 'CE9178' },

		{ token: 'attribute.name', foreground: '569CD6' },
		{ token: 'attribute.value', foreground: '3FF23F' },

		{ token: 'string', foreground: 'CE9178' },
		{ token: 'string.sql', foreground: 'FF0000' },

		{ token: 'keyword', foreground: '569CD6' },
		{ token: 'keyword.flow', foreground: 'C586C0' },

		{ token: 'operator.sql', foreground: '778899' },
		{ token: 'operator.swift', foreground: '909090' },
		{ token: 'predefined.sql', foreground: 'FF00FF' },
	],
	colors: {
		[editorBackground]: '#000000',
		[editorForeground]: '#FFFFFF',
		[editorIndentGuides]: '#FFFFFF',
		[editorActiveIndentGuides]: '#FFFFFF',
	}
};
/* -------------------------------- End hc-black theme -------------------------------- */
