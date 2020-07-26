/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import * as encoding from 'vs/workbench/services/textfile/common/encoding';
import * as terminalEncoding from 'vs/base/node/terminalEncoding';
import * as streams from 'vs/base/common/stream';
import * as iconv from 'iconv-lite-umd';
import { getPathFromAmdModule } from 'vs/base/common/amd';
import { newWriteableBufferStream, VSBuffer, VSBufferReadableStream, streamToBufferReadableStream } from 'vs/base/common/buffer';
import { isWindows } from 'vs/base/common/platform';

export async function detectEncodingByBOM(file: string): Promise<typeof encoding.UTF16be | typeof encoding.UTF16le | typeof encoding.UTF8_with_bom | null> {
	try {
		const { buffer, bytesRead } = await readExactlyByFile(file, 3);

		return encoding.detectEncodingByBOMFromBuffer(buffer, bytesRead);
	} catch (error) {
		return null; // ignore errors (like file not found)
	}
}

interface ReadResult {
	buffer: VSBuffer | null;
	bytesRead: number;
}

function readExactlyByFile(file: string, totalBytes: number): Promise<ReadResult> {
	return new Promise<ReadResult>((resolve, reject) => {
		fs.open(file, 'r', null, (err, fd) => {
			if (err) {
				return reject(err);
			}

			function end(err: Error | null, resultBuffer: Buffer | null, bytesRead: number): void {
				fs.close(fd, closeError => {
					if (closeError) {
						return reject(closeError);
					}

					if (err && (<any>err).code === 'EISDIR') {
						return reject(err); // we want to bubble this error up (file is actually a folder)
					}

					return resolve({ buffer: resultBuffer ? VSBuffer.wrap(resultBuffer) : null, bytesRead });
				});
			}

			const buffer = Buffer.allocUnsafe(totalBytes);
			let offset = 0;

			function readChunk(): void {
				fs.read(fd, buffer, offset, totalBytes - offset, null, (err, bytesRead) => {
					if (err) {
						return end(err, null, 0);
					}

					if (bytesRead === 0) {
						return end(null, buffer, offset);
					}

					offset += bytesRead;

					if (offset === totalBytes) {
						return end(null, buffer, offset);
					}

					return readChunk();
				});
			}

			readChunk();
		});
	});
}

suite('Encoding', () => {

	test('detectBOM does not return error for non existing file', async () => {
		const file = getPathFromAmdModule(require, './fixtures/not-exist.css');

		const detectedEncoding = await detectEncodingByBOM(file);
		assert.equal(detectedEncoding, null);
	});

	test('detectBOM UTF-8', async () => {
		const file = getPathFromAmdModule(require, './fixtures/some_utf8.css');

		const detectedEncoding = await detectEncodingByBOM(file);
		assert.equal(detectedEncoding, 'utf8bom');
	});

	test('detectBOM UTF-16 LE', async () => {
		const file = getPathFromAmdModule(require, './fixtures/some_utf16le.css');

		const detectedEncoding = await detectEncodingByBOM(file);
		assert.equal(detectedEncoding, 'utf16le');
	});

	test('detectBOM UTF-16 BE', async () => {
		const file = getPathFromAmdModule(require, './fixtures/some_utf16be.css');

		const detectedEncoding = await detectEncodingByBOM(file);
		assert.equal(detectedEncoding, 'utf16be');
	});

	test('detectBOM ANSI', async function () {
		const file = getPathFromAmdModule(require, './fixtures/some_ansi.css');

		const detectedEncoding = await detectEncodingByBOM(file);
		assert.equal(detectedEncoding, null);
	});

	test('detectBOM ANSI', async function () {
		const file = getPathFromAmdModule(require, './fixtures/empty.txt');

		const detectedEncoding = await detectEncodingByBOM(file);
		assert.equal(detectedEncoding, null);
	});

	test('resolve terminal encoding (detect)', async function () {
		const enc = await terminalEncoding.resolveTerminalEncoding();
		assert.ok(enc.length > 0);
	});

	test('resolve terminal encoding (environment)', async function () {
		process.env['VSCODE_CLI_ENCODING'] = 'utf16le';

		const enc = await terminalEncoding.resolveTerminalEncoding();
		assert.ok(await encoding.encodingExists(enc));
		assert.equal(enc, 'utf16le');
	});

	test('detectEncodingFromBuffer (JSON saved as PNG)', async function () {
		const file = getPathFromAmdModule(require, './fixtures/some.json.png');

		const buffer = await readExactlyByFile(file, 512);
		const mimes = encoding.detectEncodingFromBuffer(buffer);
		assert.equal(mimes.seemsBinary, false);
	});

	test('detectEncodingFromBuffer (PNG saved as TXT)', async function () {
		const file = getPathFromAmdModule(require, './fixtures/some.png.txt');
		const buffer = await readExactlyByFile(file, 512);
		const mimes = encoding.detectEncodingFromBuffer(buffer);
		assert.equal(mimes.seemsBinary, true);
	});

	test('detectEncodingFromBuffer (XML saved as PNG)', async function () {
		const file = getPathFromAmdModule(require, './fixtures/some.xml.png');
		const buffer = await readExactlyByFile(file, 512);
		const mimes = encoding.detectEncodingFromBuffer(buffer);
		assert.equal(mimes.seemsBinary, false);
	});

	test('detectEncodingFromBuffer (QWOFF saved as TXT)', async function () {
		const file = getPathFromAmdModule(require, './fixtures/some.qwoff.txt');
		const buffer = await readExactlyByFile(file, 512);
		const mimes = encoding.detectEncodingFromBuffer(buffer);
		assert.equal(mimes.seemsBinary, true);
	});

	test('detectEncodingFromBuffer (CSS saved as QWOFF)', async function () {
		const file = getPathFromAmdModule(require, './fixtures/some.css.qwoff');
		const buffer = await readExactlyByFile(file, 512);
		const mimes = encoding.detectEncodingFromBuffer(buffer);
		assert.equal(mimes.seemsBinary, false);
	});

	test('detectEncodingFromBuffer (PDF)', async function () {
		const file = getPathFromAmdModule(require, './fixtures/some.pdf');
		const buffer = await readExactlyByFile(file, 512);
		const mimes = encoding.detectEncodingFromBuffer(buffer);
		assert.equal(mimes.seemsBinary, true);
	});

	test('detectEncodingFromBuffer (guess UTF-16 LE from content without BOM)', async function () {
		const file = getPathFromAmdModule(require, './fixtures/utf16_le_nobom.txt');
		const buffer = await readExactlyByFile(file, 512);
		const mimes = encoding.detectEncodingFromBuffer(buffer);
		assert.equal(mimes.encoding, encoding.UTF16le);
		assert.equal(mimes.seemsBinary, false);
	});

	test('detectEncodingFromBuffer (guess UTF-16 BE from content without BOM)', async function () {
		const file = getPathFromAmdModule(require, './fixtures/utf16_be_nobom.txt');
		const buffer = await readExactlyByFile(file, 512);
		const mimes = encoding.detectEncodingFromBuffer(buffer);
		assert.equal(mimes.encoding, encoding.UTF16be);
		assert.equal(mimes.seemsBinary, false);
	});

	test('autoGuessEncoding (UTF8)', async function () {
		const file = getPathFromAmdModule(require, './fixtures/some_file.css');
		const buffer = await readExactlyByFile(file, 512 * 8);
		const mimes = await encoding.detectEncodingFromBuffer(buffer, true);
		assert.equal(mimes.encoding, 'utf8');
	});

	test('autoGuessEncoding (ASCII)', async function () {
		const file = getPathFromAmdModule(require, './fixtures/some_ansi.css');
		const buffer = await readExactlyByFile(file, 512 * 8);
		const mimes = await encoding.detectEncodingFromBuffer(buffer, true);
		assert.equal(mimes.encoding, null);
	});

	test('autoGuessEncoding (ShiftJIS)', async function () {
		const file = getPathFromAmdModule(require, './fixtures/some.shiftjis.txt');
		const buffer = await readExactlyByFile(file, 512 * 8);
		const mimes = await encoding.detectEncodingFromBuffer(buffer, true);
		assert.equal(mimes.encoding, 'shiftjis');
	});

	test('autoGuessEncoding (CP1252)', async function () {
		const file = getPathFromAmdModule(require, './fixtures/some.cp1252.txt');
		const buffer = await readExactlyByFile(file, 512 * 8);
		const mimes = await encoding.detectEncodingFromBuffer(buffer, true);
		assert.equal(mimes.encoding, 'windows1252');
	});

	async function readAndDecodeFromDisk(path: string, fileEncoding: string | null) {
		return new Promise<string>((resolve, reject) => {
			fs.readFile(path, (err, data) => {
				if (err) {
					reject(err);
				} else {
					resolve(iconv.decode(data, encoding.toNodeEncoding(fileEncoding!)));
				}
			});
		});
	}

	function newTestReadableStream(buffers: Buffer[]): VSBufferReadableStream {
		const stream = newWriteableBufferStream();
		buffers
			.map(VSBuffer.wrap)
			.forEach(buffer => {
				setTimeout(() => {
					stream.write(buffer);
				});
			});
		setTimeout(() => {
			stream.end();
		});
		return stream;
	}

	async function readAllAsString(stream: streams.ReadableStream<string>) {
		return streams.consumeStream(stream, strings => strings.join(''));
	}

	test('toDecodeStream - some stream', async function () {
		const source = newTestReadableStream([
			Buffer.from([65, 66, 67]),
			Buffer.from([65, 66, 67]),
			Buffer.from([65, 66, 67]),
		]);

		const { detected, stream } = await encoding.toDecodeStream(source, { minBytesRequiredForDetection: 4, guessEncoding: false, overwriteEncoding: async detected => detected || encoding.UTF8 });

		assert.ok(detected);
		assert.ok(stream);

		const content = await readAllAsString(stream);
		assert.equal(content, 'ABCABCABC');
	});

	test('toDecodeStream - some stream, expect too much data', async function () {
		const source = newTestReadableStream([
			Buffer.from([65, 66, 67]),
			Buffer.from([65, 66, 67]),
			Buffer.from([65, 66, 67]),
		]);

		const { detected, stream } = await encoding.toDecodeStream(source, { minBytesRequiredForDetection: 64, guessEncoding: false, overwriteEncoding: async detected => detected || encoding.UTF8 });

		assert.ok(detected);
		assert.ok(stream);

		const content = await readAllAsString(stream);
		assert.equal(content, 'ABCABCABC');
	});

	test('toDecodeStream - some stream, no data', async function () {
		const source = newWriteableBufferStream();
		source.end();

		const { detected, stream } = await encoding.toDecodeStream(source, { minBytesRequiredForDetection: 512, guessEncoding: false, overwriteEncoding: async detected => detected || encoding.UTF8 });

		assert.ok(detected);
		assert.ok(stream);

		const content = await readAllAsString(stream);
		assert.equal(content, '');
	});

	test('toDecodeStream - encoding, utf16be', async function () {
		const path = getPathFromAmdModule(require, './fixtures/some_utf16be.css');
		const source = streamToBufferReadableStream(fs.createReadStream(path));

		const { detected, stream } = await encoding.toDecodeStream(source, { minBytesRequiredForDetection: 64, guessEncoding: false, overwriteEncoding: async detected => detected || encoding.UTF8 });

		assert.equal(detected.encoding, 'utf16be');
		assert.equal(detected.seemsBinary, false);

		const expected = await readAndDecodeFromDisk(path, detected.encoding);
		const actual = await readAllAsString(stream);
		assert.equal(actual, expected);
	});

	test('toDecodeStream - empty file', async function () {
		const path = getPathFromAmdModule(require, './fixtures/empty.txt');
		const source = streamToBufferReadableStream(fs.createReadStream(path));
		const { detected, stream } = await encoding.toDecodeStream(source, { guessEncoding: false, overwriteEncoding: async detected => detected || encoding.UTF8 });

		const expected = await readAndDecodeFromDisk(path, detected.encoding);
		const actual = await readAllAsString(stream);
		assert.equal(actual, expected);
	});

	test('toDecodeStream - decodes buffer entirely', async function () {
		const emojis = Buffer.from('🖥️💻💾');
		const incompleteEmojis = emojis.slice(0, emojis.length - 1);

		const buffers: Buffer[] = [];
		for (let i = 0; i < incompleteEmojis.length; i++) {
			buffers.push(incompleteEmojis.slice(i, i + 1));
		}

		const source = newTestReadableStream(buffers);
		const { stream } = await encoding.toDecodeStream(source, { minBytesRequiredForDetection: 4, guessEncoding: false, overwriteEncoding: async detected => detected || encoding.UTF8 });

		const expected = new TextDecoder().decode(incompleteEmojis);
		const actual = await readAllAsString(stream);

		assert.equal(actual, expected);
	});

	test('toDecodeStream - some stream (GBK issue #101856)', async function () {
		const path = getPathFromAmdModule(require, './fixtures/some_gbk.txt');
		const source = streamToBufferReadableStream(fs.createReadStream(path));

		const { detected, stream } = await encoding.toDecodeStream(source, { minBytesRequiredForDetection: 4, guessEncoding: false, overwriteEncoding: async () => 'gbk' });
		assert.ok(detected);
		assert.ok(stream);

		const content = await readAllAsString(stream);
		assert.equal(content.length, 65537);
	});

	(isWindows /* unsupported OS */ ? test.skip : test)('toDecodeStream - some stream (UTF-8 issue #102202)', async function () {
		const path = getPathFromAmdModule(require, './fixtures/issue_102202.txt');
		const source = streamToBufferReadableStream(fs.createReadStream(path));

		const { detected, stream } = await encoding.toDecodeStream(source, { minBytesRequiredForDetection: 4, guessEncoding: false, overwriteEncoding: async () => 'utf-8' });
		assert.ok(detected);
		assert.ok(stream);

		const content = await readAllAsString(stream);
		const lines = content.split('\n');

		assert.equal(lines[981].toString(), '啊啊啊啊啊啊aaa啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊啊，啊啊啊啊啊啊啊啊啊啊啊。');
	});

	test('toEncodeReadable - encoding, utf16be', async function () {
		const path = getPathFromAmdModule(require, './fixtures/some_utf16be.css');
		const source = await readAndDecodeFromDisk(path, encoding.UTF16be);

		const expected = VSBuffer.wrap(
			iconv.encode(source, encoding.toNodeEncoding(encoding.UTF16be))
		).toString();

		const actual = streams.consumeReadable(
			await encoding.toEncodeReadable(streams.toReadable(source), encoding.UTF16be),
			VSBuffer.concat
		).toString();

		assert.equal(actual, expected);
	});

	test('toEncodeReadable - empty readable to utf8', async function () {
		const source: streams.Readable<string> = {
			read() {
				return null;
			}
		};

		const actual = streams.consumeReadable(
			await encoding.toEncodeReadable(source, encoding.UTF8),
			VSBuffer.concat
		).toString();

		assert.equal(actual, '');
	});

	[{
		utfEncoding: encoding.UTF8,
		relatedBom: encoding.UTF8_BOM
	}, {
		utfEncoding: encoding.UTF8_with_bom,
		relatedBom: encoding.UTF8_BOM
	}, {
		utfEncoding: encoding.UTF16be,
		relatedBom: encoding.UTF16be_BOM,
	}, {
		utfEncoding: encoding.UTF16le,
		relatedBom: encoding.UTF16le_BOM
	}].forEach(({ utfEncoding, relatedBom }) => {
		test(`toEncodeReadable - empty readable to ${utfEncoding} with BOM`, async function () {
			const source: streams.Readable<string> = {
				read() {
					return null;
				}
			};

			const encodedReadable = encoding.toEncodeReadable(source, utfEncoding, { addBOM: true });

			const expected = VSBuffer.wrap(Buffer.from(relatedBom)).toString();
			const actual = streams.consumeReadable(await encodedReadable, VSBuffer.concat).toString();

			assert.equal(actual, expected);
		});
	});

	test('encodingExists', async function () {
		for (const enc in encoding.SUPPORTED_ENCODINGS) {
			if (enc === encoding.UTF8_with_bom) {
				continue; // skip over encodings from us
			}

			assert.equal(iconv.encodingExists(enc), true, enc);
		}
	});
});
