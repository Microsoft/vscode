// @ts-check

const mappings = [
	['bat', 'source.batchfile'],
	['c', 'source.c'],
	['cc', 'source.cpp'],
	['clj', 'source.clojure'],
	['coffee', 'source.coffee'],
	['cpp', 'source.cpp'],
	['cs', 'source.cs'],
	['cshtml', 'text.html.cshtml'],
	['css', 'source.css'],
	['dart', 'source.dart'],
	['diff', 'source.diff'],
	['dockerfile', 'source.dockerfile', '(?:dockerfile|Dockerfile|containerfile|Containerfile)'],
	['fs', 'source.fsharp'],
	['go', 'source.go'],
	['groovy', 'source.groovy'],
	['h', 'source.objc'],
	['handlebars', 'text.html.handlebars'],
	['hbs', 'text.html.handlebars'],
	['hlsl', 'source.hlsl'],
	['hpp', 'source.objcpp'],
	['html', 'text.html.basic'],
	['ini', 'source.ini'],
	['java', 'source.java'],
	['js', 'source.js'],
	['json', 'source.json.comments'],
	['jsx', 'source.js.jsx'],
	['less', 'source.css.less'],
	['log', 'text.log'],
	['lua', 'source.lua'],
	['m', 'source.objc'],
	['makefile', 'source.makefile', '(?:makefile|Makefile)(?:\\..*)?'],
	['md', 'text.html.markdown'],
	['mm', 'source.objcpp'],
	['p6', 'source.perl.6'],
	['perl', 'source.perl'],
	['php', 'source.php'],
	['pl', 'source.perl'],
	['pm', 'source.perl'],
	['ps1', 'source.powershell'],
	['pug', 'text.pug'],
	['py', 'source.python'],
	['r', 'source.r'],
	['rb', 'source.ruby'],
	['rs', 'source.rust'],
	['scala', 'source.scala'],
	['scss', 'source.css.scss'],
	['sh', 'source.shell'],
	['sql', 'source.sql'],
	['swift', 'source.swift'],
	['ts', 'source.ts'],
	['tsx', 'source.tsx'],
	['vb', 'source.asp.vb.net'],
	['xml', 'text.xml'],
	['yaml', 'source.yaml'],
	['yml', 'source.yaml'],
];

const scopes = {
	root: 'text.searchResult',
	header: {
		meta: 'meta.header.search keyword.operator.word.search',
		key: 'entity.other.attribute-name',
		value: 'entity.other.attribute-value string.unquoted',
		flags: {
			keyword: 'keyword.other',
		},
		contextLines: {
			number: 'constant.numeric.integer',
			invalid: 'invalid.illegal',
		},
		query: {
			escape: 'constant.character.escape',
			invalid: 'invalid.illegal',
		}
	},
	resultBlock: {
		meta: 'meta.resultBlock.search',
		path: {
			meta: 'string meta.path.search',
			dirname: 'meta.path.dirname.search',
			basename: 'meta.path.basename.search',
			colon: 'punctuation.separator',
		},
		result: {
			meta: 'meta.resultLine.search',
			metaSingleLine: 'meta.resultLine.singleLine.search',
			metaMultiLine: 'meta.resultLine.multiLine.search',
			prefix: {
				meta: 'constant.numeric.integer meta.resultLinePrefix.search',
				metaContext: 'meta.resultLinePrefix.contextLinePrefix.search',
				metaMatch: 'meta.resultLinePrefix.matchLinePrefix.search',
				lineNumber: 'meta.resultLinePrefix.lineNumber.search',
				colon: 'punctuation.separator',
			}
		}
	}
};

const repository = {};
mappings.forEach(([ext, scope, regexp]) =>
	repository[ext] = {
		name: scopes.resultBlock.meta,
		begin: `^(?!\\s)(.*?)([^\\\\\\/\\n]*${regexp || `\\.${ext}`})(:)$`,
		end: '^(?!\\s)',
		beginCaptures: {
			'0': { name: scopes.resultBlock.path.meta },
			'1': { name: scopes.resultBlock.path.dirname },
			'2': { name: scopes.resultBlock.path.basename },
			'3': { name: scopes.resultBlock.path.colon },
		},
		patterns: [
			{
				name: [scopes.resultBlock.result.meta, scopes.resultBlock.result.metaMultiLine].join(' '),
				begin: '^  (?:\\s*)((\\d+) )',
				while: '^  (?:\\s*)(?:((\\d+)(:))|((\\d+) ))',
				beginCaptures: {
					'0': { name: scopes.resultBlock.result.prefix.meta },
					'1': { name: scopes.resultBlock.result.prefix.metaContext },
					'2': { name: scopes.resultBlock.result.prefix.lineNumber },
				},
				whileCaptures: {
					'0': { name: scopes.resultBlock.result.prefix.meta },
					'1': { name: scopes.resultBlock.result.prefix.metaMatch },
					'2': { name: scopes.resultBlock.result.prefix.lineNumber },
					'3': { name: scopes.resultBlock.result.prefix.colon },

					'4': { name: scopes.resultBlock.result.prefix.metaContext },
					'5': { name: scopes.resultBlock.result.prefix.lineNumber },
				},
				patterns: [{ include: scope }]
			},
			{
				begin: '^  (?:\\s*)((\\d+)(:))',
				while: '(?=not)possible',
				name: [scopes.resultBlock.result.meta, scopes.resultBlock.result.metaSingleLine].join(' '),
				beginCaptures: {
					'0': { name: scopes.resultBlock.result.prefix.meta },
					'1': { name: scopes.resultBlock.result.prefix.metaMatch },
					'2': { name: scopes.resultBlock.result.prefix.lineNumber },
					'3': { name: scopes.resultBlock.result.prefix.colon },
				},
				patterns: [{ include: scope }]
			}
		]
	});

const header = [
	{
		begin: '^(# Query): ',
		end: '\n',
		name: scopes.header.meta,
		beginCaptures: { '1': { name: scopes.header.key }, },
		patterns: [
			{
				match: '(\\\\n)|(\\\\\\\\)',
				name: [scopes.header.value, scopes.header.query.escape].join(' ')
			},
			{
				match: '\\\\.|\\\\$',
				name: [scopes.header.value, scopes.header.query.invalid].join(' ')
			},
			{
				match: '[^\\\\\\\n]+',
				name: [scopes.header.value].join(' ')
			},
		]
	},
	{
		begin: '^(# Flags): ',
		end: '\n',
		name: scopes.header.meta,
		beginCaptures: { '1': { name: scopes.header.key }, },
		patterns: [
			{
				match: '(RegExp|CaseSensitive|IgnoreExcludeSettings|WordMatch)',
				name: [scopes.header.value, 'keyword.other'].join(' ')
			},
			{ match: '.' },
		]
	},
	{
		begin: '^(# ContextLines): ',
		end: '\n',
		name: scopes.header.meta,
		beginCaptures: { '1': { name: scopes.header.key }, },
		patterns: [
			{
				match: '\\d',
				name: [scopes.header.value, scopes.header.contextLines.number].join(' ')
			},
			{ match: '.', name: scopes.header.contextLines.invalid },
		]
	},
	{
		match: '^(# (?:Including|Excluding)): (.*)$',
		name: scopes.header.meta,
		captures: {
			'1': { name: scopes.header.key },
			'2': { name: scopes.header.value }
		}
	},
];

const plainText = [
	{
		match: '^(?!\\s)(.*?)([^\\\\\\/\\n]*)(:)$',
		name: [scopes.resultBlock.meta, scopes.resultBlock.path.meta].join(' '),
		captures: {
			'1': { name: scopes.resultBlock.path.dirname },
			'2': { name: scopes.resultBlock.path.basename },
			'3': { name: scopes.resultBlock.path.colon }
		}
	},
	{
		match: '^  (?:\\s*)(?:((\\d+)(:))|((\\d+)( ))(.*))',
		name: [scopes.resultBlock.meta, scopes.resultBlock.result.meta].join(' '),
		captures: {
			'1': { name: [scopes.resultBlock.result.prefix.meta, scopes.resultBlock.result.prefix.metaMatch].join(' ') },
			'2': { name: scopes.resultBlock.result.prefix.lineNumber },
			'3': { name: scopes.resultBlock.result.prefix.colon },

			'4': { name: [scopes.resultBlock.result.prefix.meta, scopes.resultBlock.result.prefix.metaContext].join(' ') },
			'5': { name: scopes.resultBlock.result.prefix.lineNumber },
		}
	}
];

const tmLanguage = {
	'information_for_contributors': 'This file is generated from ./generateTMLanguage.js.',
	name: 'Search Results',
	scopeName: scopes.root,
	patterns: [
		...header,
		...mappings.map(([ext]) => ({ include: `#${ext}` })),
		...plainText
	],
	repository
};

require('fs').writeFileSync(
	require('path').join(__dirname, './searchResult.tmLanguage.json'),
	JSON.stringify(tmLanguage, null, 2));
