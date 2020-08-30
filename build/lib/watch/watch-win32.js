/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

var path = require('path');
var cp = require('child_process');
var fs = require('fs');
var File = require('vinyl');
var es = require('event-stream');
var filter = require('gulp-filter');

var watcherPath = path.join(__dirname, 'watcher.exe');

function toChangeType(type) {
	switch (type) {
		case '0': return 'change';
		case '1': return 'add';
		default: return 'unlink';
	}
}

function watch(root) {
	var result = es.through();
	var child = cp.spawn(watcherPath, [root]);

	child.stdout.on('data', function (data) {
		var lines = data.toString('utf8').split('\n');
		for (var i = 0; i < lines.length; i++) {
			var line = lines[i].trim();
			if (line.length === 0) {
				continue;
			}

			var changeType = line[0];
			var changePath = line.substr(2);

			// filter as early as possible
			if (/^\.git/.test(changePath) || /(^|\\)out($|\\)/.test(changePath)) {
				continue;
			}

			var changePathFull = path.join(root, changePath);

			var file = new File({
				path: changePathFull,
				base: root
			});
			file.event = toChangeType(changeType);
			result.emit('data', file);
		}
	});

	child.stderr.on('data', function (data) {
		result.emit('error', data);
	});

	child.on('exit', function (code) {
		result.emit('error', 'Watcher died with code ' + code);
		child = null;
	});

	process.once('SIGTERM', function () { process.exit(0); });
	process.once('SIGTERM', function () { process.exit(0); });
	process.once('exit', function () { child && child.kill(); });

	return result;
}

var cache = Object.create(null);

module.exports = function (pattern, options) {
	options = options || {};

	var cwd = path.normalize(options.cwd || process.cwd());
	var watcher = cache[cwd];

	if (!watcher) {
		watcher = cache[cwd] = watch(cwd);
	}

	var rebase = !options.base ? es.through() : es.mapSync(function (f) {
		f.base = options.base;
		return f;
	});

	return watcher
		.pipe(filter(['**', '!.git{,/**}'])) // ignore all things git
		.pipe(filter(pattern))
		.pipe(es.map(function (file, cb) {
			fs.stat(file.path, function (err, stat) {
				if (err && err.code === 'ENOENT') { return cb(null, file); }
				if (err) { return cb(); }
				if (!stat.isFile()) { return cb(); }

				fs.readFile(file.path, function (err, contents) {
					if (err && err.code === 'ENOENT') { return cb(null, file); }
					if (err) { return cb(); }

					file.contents = contents;
					file.stat = stat;
					cb(null, file);
				});
			});
		}))
		.pipe(rebase);
};
