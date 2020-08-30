/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

// THIS IS GENERATED FILE. DO NOT MODIFY.

import { IEntries } from './phpGlobals';

export const globalfunctions: IEntries = {
	debug_backtrace: {
		description: 'Generates a backtrace',
		signature: '([ int $options = DEBUG_BACKTRACE_PROVIDE_OBJECT [, int $limit = 0 ]]): array'
	},
	debug_print_backtrace: {
		description: 'Prints a backtrace',
		signature: '([ int $options = 0 [, int $limit = 0 ]]): void'
	},
	error_clear_last: {
		description: 'Clear the most recent error',
		signature: '(void): void'
	},
	error_get_last: {
		description: 'Get the last occurred error',
		signature: '(void): array'
	},
	error_log: {
		description: 'Send an error message to the defined error handling routines',
		signature: '( string $message [, int $message_type = 0 [, string $destination [, string $extra_headers ]]]): bool'
	},
	error_reporting: {
		description: 'Sets which PHP errors are reported',
		signature: '([ int $level ]): int'
	},
	restore_error_handler: {
		description: 'Restores the previous error handler function',
		signature: '(void): bool'
	},
	restore_exception_handler: {
		description: 'Restores the previously defined exception handler function',
		signature: '(void): bool'
	},
	set_error_handler: {
		description: 'Sets a user-defined error handler function',
		signature: '( callable $error_handler [, int $error_types = E_ALL | E_STRICT ]): mixed'
	},
	set_exception_handler: {
		description: 'Sets a user-defined exception handler function',
		signature: '( callable $exception_handler ): callable'
	},
	trigger_error: {
		description: 'Generates a user-level error/warning/notice message',
		signature: '( string $error_msg [, int $error_type = E_USER_NOTICE ]): bool'
	},
	user_error: {
		description: 'Alias of trigger_error',
	},
	opcache_compile_file: {
		description: 'Compiles and caches a PHP script without executing it',
		signature: '( string $file ): bool'
	},
	opcache_get_configuration: {
		description: 'Get configuration information about the cache',
		signature: '(void): array'
	},
	opcache_get_status: {
		description: 'Get status information about the cache',
		signature: '([ bool $get_scripts ]): array'
	},
	opcache_invalidate: {
		description: 'Invalidates a cached script',
		signature: '( string $script [, bool $force ]): bool'
	},
	opcache_is_script_cached: {
		description: 'Tells whether a script is cached in OPCache',
		signature: '( string $file ): bool'
	},
	opcache_reset: {
		description: 'Resets the contents of the opcode cache',
		signature: '(void): bool'
	},
	flush: {
		description: 'Flush system output buffer',
		signature: '(void): void'
	},
	ob_clean: {
		description: 'Clean (erase) the output buffer',
		signature: '(void): void'
	},
	ob_end_clean: {
		description: 'Clean (erase) the output buffer and turn off output buffering',
		signature: '(void): bool'
	},
	ob_end_flush: {
		description: 'Flush (send) the output buffer and turn off output buffering',
		signature: '(void): bool'
	},
	ob_flush: {
		description: 'Flush (send) the output buffer',
		signature: '(void): void'
	},
	ob_get_clean: {
		description: 'Get current buffer contents and delete current output buffer',
		signature: '(void): string'
	},
	ob_get_contents: {
		description: 'Return the contents of the output buffer',
		signature: '(void): string'
	},
	ob_get_flush: {
		description: 'Flush the output buffer, return it as a string and turn off output buffering',
		signature: '(void): string'
	},
	ob_get_length: {
		description: 'Return the length of the output buffer',
		signature: '(void): int'
	},
	ob_get_level: {
		description: 'Return the nesting level of the output buffering mechanism',
		signature: '(void): int'
	},
	ob_get_status: {
		description: 'Get status of output buffers',
		signature: '([ bool $full_status = FALSE ]): array'
	},
	ob_gzhandler: {
		description: 'ob_start callback function to gzip output buffer',
		signature: '( string $buffer , int $mode ): string'
	},
	ob_implicit_flush: {
		description: 'Turn implicit flush on/off',
		signature: '([ int $flag = 1 ]): void'
	},
	ob_list_handlers: {
		description: 'List all output handlers in use',
		signature: '(void): array'
	},
	ob_start: {
		description: 'Turn on output buffering',
		signature: '([ callable $output_callback [, int $chunk_size = 0 [, int $flags ]]]): bool'
	},
	output_add_rewrite_var: {
		description: 'Add URL rewriter values',
		signature: '( string $name , string $value ): bool'
	},
	output_reset_rewrite_vars: {
		description: 'Reset URL rewriter values',
		signature: '(void): bool'
	},
	assert_options: {
		description: 'Set/get the various assert flags',
		signature: '( int $what [, mixed $value ]): mixed'
	},
	assert: {
		description: 'Checks if assertion is FALSE',
		signature: '( mixed $assertion [, string $description [, Throwable $exception ]]): bool'
	},
	cli_get_process_title: {
		description: 'Returns the current process title',
		signature: '(void): string'
	},
	cli_set_process_title: {
		description: 'Sets the process title',
		signature: '( string $title ): bool'
	},
	dl: {
		description: 'Loads a PHP extension at runtime',
		signature: '( string $library ): bool'
	},
	extension_loaded: {
		description: 'Find out whether an extension is loaded',
		signature: '( string $name ): bool'
	},
	gc_collect_cycles: {
		description: 'Forces collection of any existing garbage cycles',
		signature: '(void): int'
	},
	gc_disable: {
		description: 'Deactivates the circular reference collector',
		signature: '(void): void'
	},
	gc_enable: {
		description: 'Activates the circular reference collector',
		signature: '(void): void'
	},
	gc_enabled: {
		description: 'Returns status of the circular reference collector',
		signature: '(void): bool'
	},
	gc_mem_caches: {
		description: 'Reclaims memory used by the Zend Engine memory manager',
		signature: '(void): int'
	},
	gc_status: {
		description: 'Gets information about the garbage collector',
		signature: '(void): array'
	},
	get_cfg_var: {
		description: 'Gets the value of a PHP configuration option',
		signature: '( string $option ): mixed'
	},
	get_current_user: {
		description: 'Gets the name of the owner of the current PHP script',
		signature: '(void): string'
	},
	get_defined_constants: {
		description: 'Returns an associative array with the names of all the constants and their values',
		signature: '([ bool $categorize ]): array'
	},
	get_extension_funcs: {
		description: 'Returns an array with the names of the functions of a module',
		signature: '( string $module_name ): array'
	},
	get_include_path: {
		description: 'Gets the current include_path configuration option',
		signature: '(void): string'
	},
	get_included_files: {
		description: 'Returns an array with the names of included or required files',
		signature: '(void): array'
	},
	get_loaded_extensions: {
		description: 'Returns an array with the names of all modules compiled and loaded',
		signature: '([ bool $zend_extensions ]): array'
	},
	get_magic_quotes_gpc: {
		description: 'Gets the current configuration setting of magic_quotes_gpc',
		signature: '(void): bool'
	},
	get_magic_quotes_runtime: {
		description: 'Gets the current active configuration setting of magic_quotes_runtime',
		signature: '(void): bool'
	},
	get_required_files: {
		description: 'Alias of get_included_files',
	},
	get_resources: {
		description: 'Returns active resources',
		signature: '([ string $type ]): resource'
	},
	getenv: {
		description: 'Gets the value of an environment variable',
		signature: '( string $varname [, bool $local_only ]): array'
	},
	getlastmod: {
		description: 'Gets time of last page modification',
		signature: '(void): int'
	},
	getmygid: {
		description: 'Get PHP script owner\'s GID',
		signature: '(void): int'
	},
	getmyinode: {
		description: 'Gets the inode of the current script',
		signature: '(void): int'
	},
	getmypid: {
		description: 'Gets PHP\'s process ID',
		signature: '(void): int'
	},
	getmyuid: {
		description: 'Gets PHP script owner\'s UID',
		signature: '(void): int'
	},
	getopt: {
		description: 'Gets options from the command line argument list',
		signature: '( string $options [, array $longopts [, int $optind ]]): array'
	},
	getrusage: {
		description: 'Gets the current resource usages',
		signature: '([ int $who = 0 ]): array'
	},
	ini_alter: {
		description: 'Alias of ini_set',
	},
	ini_get_all: {
		description: 'Gets all configuration options',
		signature: '([ string $extension [, bool $details ]]): array'
	},
	ini_get: {
		description: 'Gets the value of a configuration option',
		signature: '( string $varname ): string'
	},
	ini_restore: {
		description: 'Restores the value of a configuration option',
		signature: '( string $varname ): void'
	},
	ini_set: {
		description: 'Sets the value of a configuration option',
		signature: '( string $varname , string $newvalue ): string'
	},
	magic_quotes_runtime: {
		description: 'Alias of set_magic_quotes_runtime',
	},
	main: {
		description: 'Dummy for main',
	},
	memory_get_peak_usage: {
		description: 'Returns the peak of memory allocated by PHP',
		signature: '([ bool $real_usage ]): int'
	},
	memory_get_usage: {
		description: 'Returns the amount of memory allocated to PHP',
		signature: '([ bool $real_usage ]): int'
	},
	php_ini_loaded_file: {
		description: 'Retrieve a path to the loaded php.ini file',
		signature: '(void): string'
	},
	php_ini_scanned_files: {
		description: 'Return a list of .ini files parsed from the additional ini dir',
		signature: '(void): string'
	},
	php_logo_guid: {
		description: 'Gets the logo guid',
		signature: '(void): string'
	},
	php_sapi_name: {
		description: 'Returns the type of interface between web server and PHP',
		signature: '(void): string'
	},
	php_uname: {
		description: 'Returns information about the operating system PHP is running on',
		signature: '([ string $mode = "a" ]): string'
	},
	phpcredits: {
		description: 'Prints out the credits for PHP',
		signature: '([ int $flag = CREDITS_ALL ]): bool'
	},
	phpinfo: {
		description: 'Outputs information about PHP\'s configuration',
		signature: '([ int $what = INFO_ALL ]): bool'
	},
	phpversion: {
		description: 'Gets the current PHP version',
		signature: '([ string $extension ]): string'
	},
	putenv: {
		description: 'Sets the value of an environment variable',
		signature: '( string $setting ): bool'
	},
	restore_include_path: {
		description: 'Restores the value of the include_path configuration option',
		signature: '(void): void'
	},
	set_include_path: {
		description: 'Sets the include_path configuration option',
		signature: '( string $new_include_path ): string'
	},
	set_magic_quotes_runtime: {
		description: 'Sets the current active configuration setting of magic_quotes_runtime',
		signature: '( bool $new_setting ): bool'
	},
	set_time_limit: {
		description: 'Limits the maximum execution time',
		signature: '( int $seconds ): bool'
	},
	sys_get_temp_dir: {
		description: 'Returns directory path used for temporary files',
		signature: '(void): string'
	},
	version_compare: {
		description: 'Compares two "PHP-standardized" version number strings',
		signature: '( string $version1 , string $version2 , string $operator ): bool'
	},
	zend_logo_guid: {
		description: 'Gets the Zend guid',
		signature: '(void): string'
	},
	zend_thread_id: {
		description: 'Returns a unique identifier for the current thread',
		signature: '(void): int'
	},
	zend_version: {
		description: 'Gets the version of the current Zend engine',
		signature: '(void): string'
	},
	bzclose: {
		description: 'Close a bzip2 file',
		signature: '( resource $bz ): int'
	},
	bzcompress: {
		description: 'Compress a string into bzip2 encoded data',
		signature: '( string $source [, int $blocksize = 4 [, int $workfactor = 0 ]]): mixed'
	},
	bzdecompress: {
		description: 'Decompresses bzip2 encoded data',
		signature: '( string $source [, int $small = 0 ]): mixed'
	},
	bzerrno: {
		description: 'Returns a bzip2 error number',
		signature: '( resource $bz ): int'
	},
	bzerror: {
		description: 'Returns the bzip2 error number and error string in an array',
		signature: '( resource $bz ): array'
	},
	bzerrstr: {
		description: 'Returns a bzip2 error string',
		signature: '( resource $bz ): string'
	},
	bzflush: {
		description: 'Force a write of all buffered data',
		signature: '( resource $bz ): bool'
	},
	bzopen: {
		description: 'Opens a bzip2 compressed file',
		signature: '( mixed $file , string $mode ): resource'
	},
	bzread: {
		description: 'Binary safe bzip2 file read',
		signature: '( resource $bz [, int $length = 1024 ]): string'
	},
	bzwrite: {
		description: 'Binary safe bzip2 file write',
		signature: '( resource $bz , string $data [, int $length ]): int'
	},
	PharException: {
		description: 'The PharException class provides a phar-specific exception class    for try/catch blocks',
	},
	zip_close: {
		description: 'Close a ZIP file archive',
		signature: '( resource $zip ): void'
	},
	zip_entry_close: {
		description: 'Close a directory entry',
		signature: '( resource $zip_entry ): bool'
	},
	zip_entry_compressedsize: {
		description: 'Retrieve the compressed size of a directory entry',
		signature: '( resource $zip_entry ): int'
	},
	zip_entry_compressionmethod: {
		description: 'Retrieve the compression method of a directory entry',
		signature: '( resource $zip_entry ): string'
	},
	zip_entry_filesize: {
		description: 'Retrieve the actual file size of a directory entry',
		signature: '( resource $zip_entry ): int'
	},
	zip_entry_name: {
		description: 'Retrieve the name of a directory entry',
		signature: '( resource $zip_entry ): string'
	},
	zip_entry_open: {
		description: 'Open a directory entry for reading',
		signature: '( resource $zip , resource $zip_entry [, string $mode ]): bool'
	},
	zip_entry_read: {
		description: 'Read from an open directory entry',
		signature: '( resource $zip_entry [, int $length = 1024 ]): string'
	},
	zip_open: {
		description: 'Open a ZIP file archive',
		signature: '( string $filename ): resource'
	},
	zip_read: {
		description: 'Read next entry in a ZIP file archive',
		signature: '( resource $zip ): resource'
	},
	deflate_add: {
		description: 'Incrementally deflate data',
		signature: '( resource $context , string $data [, int $flush_mode = ZLIB_SYNC_FLUSH ]): string'
	},
	deflate_init: {
		description: 'Initialize an incremental deflate context',
		signature: '( int $encoding [, array $options = array() ]): resource'
	},
	gzclose: {
		description: 'Close an open gz-file pointer',
		signature: '( resource $zp ): bool'
	},
	gzcompress: {
		description: 'Compress a string',
		signature: '( string $data [, int $level = -1 [, int $encoding = ZLIB_ENCODING_DEFLATE ]]): string'
	},
	gzdecode: {
		description: 'Decodes a gzip compressed string',
		signature: '( string $data [, int $length ]): string'
	},
	gzdeflate: {
		description: 'Deflate a string',
		signature: '( string $data [, int $level = -1 [, int $encoding = ZLIB_ENCODING_RAW ]]): string'
	},
	gzencode: {
		description: 'Create a gzip compressed string',
		signature: '( string $data [, int $level = -1 [, int $encoding_mode = FORCE_GZIP ]]): string'
	},
	gzeof: {
		description: 'Test for EOF on a gz-file pointer',
		signature: '( resource $zp ): int'
	},
	gzfile: {
		description: 'Read entire gz-file into an array',
		signature: '( string $filename [, int $use_include_path = 0 ]): array'
	},
	gzgetc: {
		description: 'Get character from gz-file pointer',
		signature: '( resource $zp ): string'
	},
	gzgets: {
		description: 'Get line from file pointer',
		signature: '( resource $zp [, int $length ]): string'
	},
	gzgetss: {
		description: 'Get line from gz-file pointer and strip HTML tags',
		signature: '( resource $zp , int $length [, string $allowable_tags ]): string'
	},
	gzinflate: {
		description: 'Inflate a deflated string',
		signature: '( string $data [, int $length = 0 ]): string'
	},
	gzopen: {
		description: 'Open gz-file',
		signature: '( string $filename , string $mode [, int $use_include_path = 0 ]): resource'
	},
	gzpassthru: {
		description: 'Output all remaining data on a gz-file pointer',
		signature: '( resource $zp ): int'
	},
	gzputs: {
		description: 'Alias of gzwrite',
	},
	gzread: {
		description: 'Binary-safe gz-file read',
		signature: '( resource $zp , int $length ): string'
	},
	gzrewind: {
		description: 'Rewind the position of a gz-file pointer',
		signature: '( resource $zp ): bool'
	},
	gzseek: {
		description: 'Seek on a gz-file pointer',
		signature: '( resource $zp , int $offset [, int $whence = SEEK_SET ]): int'
	},
	gztell: {
		description: 'Tell gz-file pointer read/write position',
		signature: '( resource $zp ): int'
	},
	gzuncompress: {
		description: 'Uncompress a compressed string',
		signature: '( string $data [, int $length = 0 ]): string'
	},
	gzwrite: {
		description: 'Binary-safe gz-file write',
		signature: '( resource $zp , string $string [, int $length ]): int'
	},
	inflate_add: {
		description: 'Incrementally inflate encoded data',
		signature: '( resource $context , string $encoded_data [, int $flush_mode = ZLIB_SYNC_FLUSH ]): string'
	},
	inflate_get_read_len: {
		description: 'Get number of bytes read so far',
		signature: '( resource $resource ): int'
	},
	inflate_get_status: {
		description: 'Get decompression status',
		signature: '( resource $resource ): int'
	},
	inflate_init: {
		description: 'Initialize an incremental inflate context',
		signature: '( int $encoding [, array $options = array() ]): resource'
	},
	readgzfile: {
		description: 'Output a gz-file',
		signature: '( string $filename [, int $use_include_path = 0 ]): int'
	},
	zlib_decode: {
		description: 'Uncompress any raw/gzip/zlib encoded data',
		signature: '( string $data [, string $max_decoded_len ]): string'
	},
	zlib_encode: {
		description: 'Compress data with the specified encoding',
		signature: '( string $data , int $encoding [, int $level = -1 ]): string'
	},
	zlib_get_coding_type: {
		description: 'Returns the coding type used for output compression',
		signature: '(void): string'
	},
	random_bytes: {
		description: 'Generates cryptographically secure pseudo-random bytes',
		signature: '( int $length ): string'
	},
	random_int: {
		description: 'Generates cryptographically secure pseudo-random integers',
		signature: '( int $min , int $max ): int'
	},
	hash_algos: {
		description: 'Return a list of registered hashing algorithms',
		signature: '(void): array'
	},
	hash_copy: {
		description: 'Copy hashing context',
		signature: '( HashContext $context ): HashContext'
	},
	hash_equals: {
		description: 'Timing attack safe string comparison',
		signature: '( string $known_string , string $user_string ): bool'
	},
	hash_file: {
		description: 'Generate a hash value using the contents of a given file',
		signature: '( string $algo , string $filename [, bool $raw_output ]): string'
	},
	hash_final: {
		description: 'Finalize an incremental hash and return resulting digest',
		signature: '( HashContext $context [, bool $raw_output ]): string'
	},
	hash_hkdf: {
		description: 'Generate a HKDF key derivation of a supplied key input',
		signature: '( string $algo , string $ikm [, int $length = 0 [, string $info = \'\' [, string $salt = \'\' ]]]): string'
	},
	hash_hmac_algos: {
		description: 'Return a list of registered hashing algorithms suitable for hash_hmac',
		signature: '(void): array'
	},
	hash_hmac_file: {
		description: 'Generate a keyed hash value using the HMAC method and the contents of a given file',
		signature: '( string $algo , string $filename , string $key [, bool $raw_output ]): string'
	},
	hash_hmac: {
		description: 'Generate a keyed hash value using the HMAC method',
		signature: '( string $algo , string $data , string $key [, bool $raw_output ]): string'
	},
	hash_init: {
		description: 'Initialize an incremental hashing context',
		signature: '( string $algo [, int $options = 0 [, string $key ]]): HashContext'
	},
	hash_pbkdf2: {
		description: 'Generate a PBKDF2 key derivation of a supplied password',
		signature: '( string $algo , string $password , string $salt , int $iterations [, int $length = 0 [, bool $raw_output ]]): string'
	},
	hash_update_file: {
		description: 'Pump data into an active hashing context from a file',
		signature: '( HashContext $hcontext , string $filename [, resource $scontext ]): bool'
	},
	hash_update_stream: {
		description: 'Pump data into an active hashing context from an open stream',
		signature: '( HashContext $context , resource $handle [, int $length = -1 ]): int'
	},
	hash_update: {
		description: 'Pump data into an active hashing context',
		signature: '( HashContext $context , string $data ): bool'
	},
	hash: {
		description: 'Generate a hash value (message digest)',
		signature: '( string $algo , string $data [, bool $raw_output ]): string'
	},
	openssl_cipher_iv_length: {
		description: 'Gets the cipher iv length',
		signature: '( string $method ): int'
	},
	openssl_csr_export_to_file: {
		description: 'Exports a CSR to a file',
		signature: '( mixed $csr , string $outfilename [, bool $notext ]): bool'
	},
	openssl_csr_export: {
		description: 'Exports a CSR as a string',
		signature: '( mixed $csr , string $out [, bool $notext ]): bool'
	},
	openssl_csr_get_public_key: {
		description: 'Returns the public key of a CSR',
		signature: '( mixed $csr [, bool $use_shortnames ]): resource'
	},
	openssl_csr_get_subject: {
		description: 'Returns the subject of a CSR',
		signature: '( mixed $csr [, bool $use_shortnames ]): array'
	},
	openssl_csr_new: {
		description: 'Generates a CSR',
		signature: '( array $dn , resource $privkey [, array $configargs [, array $extraattribs ]]): mixed'
	},
	openssl_csr_sign: {
		description: 'Sign a CSR with another certificate (or itself) and generate a certificate',
		signature: '( mixed $csr , mixed $cacert , mixed $priv_key , int $days [, array $configargs [, int $serial = 0 ]]): resource'
	},
	openssl_decrypt: {
		description: 'Decrypts data',
		signature: '( string $data , string $method , string $key [, int $options = 0 [, string $iv = "" [, string $tag = "" [, string $aad = "" ]]]]): string'
	},
	openssl_dh_compute_key: {
		description: 'Computes shared secret for public value of remote DH public key and local DH key',
		signature: '( string $pub_key , resource $dh_key ): string'
	},
	openssl_digest: {
		description: 'Computes a digest',
		signature: '( string $data , string $method [, bool $raw_output ]): string'
	},
	openssl_encrypt: {
		description: 'Encrypts data',
		signature: '( string $data , string $method , string $key [, int $options = 0 [, string $iv = "" [, string $tag = NULL [, string $aad = "" [, int $tag_length = 16 ]]]]]): string'
	},
	openssl_error_string: {
		description: 'Return openSSL error message',
		signature: '(void): string'
	},
	openssl_free_key: {
		description: 'Free key resource',
		signature: '( resource $key_identifier ): void'
	},
	openssl_get_cert_locations: {
		description: 'Retrieve the available certificate locations',
		signature: '(void): array'
	},
	openssl_get_cipher_methods: {
		description: 'Gets available cipher methods',
		signature: '([ bool $aliases ]): array'
	},
	openssl_get_curve_names: {
		description: 'Gets list of available curve names for ECC',
		signature: '(void): array'
	},
	openssl_get_md_methods: {
		description: 'Gets available digest methods',
		signature: '([ bool $aliases ]): array'
	},
	openssl_get_privatekey: {
		description: 'Alias of openssl_pkey_get_private',
	},
	openssl_get_publickey: {
		description: 'Alias of openssl_pkey_get_public',
	},
	openssl_open: {
		description: 'Open sealed data',
		signature: '( string $sealed_data , string $open_data , string $env_key , mixed $priv_key_id [, string $method = "RC4" [, string $iv ]]): bool'
	},
	openssl_pbkdf2: {
		description: 'Generates a PKCS5 v2 PBKDF2 string',
		signature: '( string $password , string $salt , int $key_length , int $iterations [, string $digest_algorithm = "sha1" ]): string'
	},
	openssl_pkcs12_export_to_file: {
		description: 'Exports a PKCS#12 Compatible Certificate Store File',
		signature: '( mixed $x509 , string $filename , mixed $priv_key , string $pass [, array $args ]): bool'
	},
	openssl_pkcs12_export: {
		description: 'Exports a PKCS#12 Compatible Certificate Store File to variable',
		signature: '( mixed $x509 , string $out , mixed $priv_key , string $pass [, array $args ]): bool'
	},
	openssl_pkcs12_read: {
		description: 'Parse a PKCS#12 Certificate Store into an array',
		signature: '( string $pkcs12 , array $certs , string $pass ): bool'
	},
	openssl_pkcs7_decrypt: {
		description: 'Decrypts an S/MIME encrypted message',
		signature: '( string $infilename , string $outfilename , mixed $recipcert [, mixed $recipkey ]): bool'
	},
	openssl_pkcs7_encrypt: {
		description: 'Encrypt an S/MIME message',
		signature: '( string $infile , string $outfile , mixed $recipcerts , array $headers [, int $flags = 0 [, int $cipherid = OPENSSL_CIPHER_RC2_40 ]]): bool'
	},
	openssl_pkcs7_read: {
		description: 'Export the PKCS7 file to an array of PEM certificates',
		signature: '( string $infilename , array $certs ): bool'
	},
	openssl_pkcs7_sign: {
		description: 'Sign an S/MIME message',
		signature: '( string $infilename , string $outfilename , mixed $signcert , mixed $privkey , array $headers [, int $flags = PKCS7_DETACHED [, string $extracerts ]]): bool'
	},
	openssl_pkcs7_verify: {
		description: 'Verifies the signature of an S/MIME signed message',
		signature: '( string $filename , int $flags [, string $outfilename [, array $cainfo [, string $extracerts [, string $content [, string $p7bfilename ]]]]]): mixed'
	},
	openssl_pkey_export_to_file: {
		description: 'Gets an exportable representation of a key into a file',
		signature: '( mixed $key , string $outfilename [, string $passphrase [, array $configargs ]]): bool'
	},
	openssl_pkey_export: {
		description: 'Gets an exportable representation of a key into a string',
		signature: '( mixed $key , string $out [, string $passphrase [, array $configargs ]]): bool'
	},
	openssl_pkey_free: {
		description: 'Frees a private key',
		signature: '( resource $key ): void'
	},
	openssl_pkey_get_details: {
		description: 'Returns an array with the key details',
		signature: '( resource $key ): array'
	},
	openssl_pkey_get_private: {
		description: 'Get a private key',
		signature: '( mixed $key [, string $passphrase = "" ]): resource'
	},
	openssl_pkey_get_public: {
		description: 'Extract public key from certificate and prepare it for use',
		signature: '( mixed $certificate ): resource'
	},
	openssl_pkey_new: {
		description: 'Generates a new private key',
		signature: '([ array $configargs ]): resource'
	},
	openssl_private_decrypt: {
		description: 'Decrypts data with private key',
		signature: '( string $data , string $decrypted , mixed $key [, int $padding = OPENSSL_PKCS1_PADDING ]): bool'
	},
	openssl_private_encrypt: {
		description: 'Encrypts data with private key',
		signature: '( string $data , string $crypted , mixed $key [, int $padding = OPENSSL_PKCS1_PADDING ]): bool'
	},
	openssl_public_decrypt: {
		description: 'Decrypts data with public key',
		signature: '( string $data , string $decrypted , mixed $key [, int $padding = OPENSSL_PKCS1_PADDING ]): bool'
	},
	openssl_public_encrypt: {
		description: 'Encrypts data with public key',
		signature: '( string $data , string $crypted , mixed $key [, int $padding = OPENSSL_PKCS1_PADDING ]): bool'
	},
	openssl_random_pseudo_bytes: {
		description: 'Generate a pseudo-random string of bytes',
		signature: '( int $length [, bool $crypto_strong ]): string'
	},
	openssl_seal: {
		description: 'Seal (encrypt) data',
		signature: '( string $data , string $sealed_data , array $env_keys , array $pub_key_ids [, string $method = "RC4" [, string $iv ]]): int'
	},
	openssl_sign: {
		description: 'Generate signature',
		signature: '( string $data , string $signature , mixed $priv_key_id [, mixed $signature_alg = OPENSSL_ALGO_SHA1 ]): bool'
	},
	openssl_spki_export_challenge: {
		description: 'Exports the challenge assoicated with a signed public key and challenge',
		signature: '( string $spkac ): string'
	},
	openssl_spki_export: {
		description: 'Exports a valid PEM formatted public key signed public key and challenge',
		signature: '( string $spkac ): string'
	},
	openssl_spki_new: {
		description: 'Generate a new signed public key and challenge',
		signature: '( resource $privkey , string $challenge [, int $algorithm = 0 ]): string'
	},
	openssl_spki_verify: {
		description: 'Verifies a signed public key and challenge',
		signature: '( string $spkac ): string'
	},
	openssl_verify: {
		description: 'Verify signature',
		signature: '( string $data , string $signature , mixed $pub_key_id [, mixed $signature_alg = OPENSSL_ALGO_SHA1 ]): int'
	},
	openssl_x509_check_private_key: {
		description: 'Checks if a private key corresponds to a certificate',
		signature: '( mixed $cert , mixed $key ): bool'
	},
	openssl_x509_checkpurpose: {
		description: 'Verifies if a certificate can be used for a particular purpose',
		signature: '( mixed $x509cert , int $purpose [, array $cainfo = array() [, string $untrustedfile ]]): int'
	},
	openssl_x509_export_to_file: {
		description: 'Exports a certificate to file',
		signature: '( mixed $x509 , string $outfilename [, bool $notext ]): bool'
	},
	openssl_x509_export: {
		description: 'Exports a certificate as a string',
		signature: '( mixed $x509 , string $output [, bool $notext ]): bool'
	},
	openssl_x509_fingerprint: {
		description: 'Calculates the fingerprint, or digest, of a given X.509 certificate',
		signature: '( mixed $x509 [, string $hash_algorithm = "sha1" [, bool $raw_output ]]): string'
	},
	openssl_x509_free: {
		description: 'Free certificate resource',
		signature: '( resource $x509cert ): void'
	},
	openssl_x509_parse: {
		description: 'Parse an X509 certificate and return the information as an array',
		signature: '( mixed $x509cert [, bool $shortnames ]): array'
	},
	openssl_x509_read: {
		description: 'Parse an X.509 certificate and return a resource identifier for  it',
		signature: '( mixed $x509certdata ): resource'
	},
	password_get_info: {
		description: 'Returns information about the given hash',
		signature: '( string $hash ): array'
	},
	password_hash: {
		description: 'Creates a password hash',
		signature: '( string $password , int $algo [, array $options ]): integer'
	},
	password_needs_rehash: {
		description: 'Checks if the given hash matches the given options',
		signature: '( string $hash , int $algo [, array $options ]): bool'
	},
	password_verify: {
		description: 'Verifies that a password matches a hash',
		signature: '( string $password , string $hash ): bool'
	},
	sodium_add: {
		description: 'Add large numbers',
		signature: '( string $val , string $addv ): void'
	},
	sodium_base642bin: {
		description: 'Description',
		signature: '( string $b64 , int $id [, string $ignore ]): string'
	},
	sodium_bin2base64: {
		description: 'Description',
		signature: '( string $bin , int $id ): string'
	},
	sodium_bin2hex: {
		description: 'Encode to hexadecimal',
		signature: '( string $bin ): string'
	},
	sodium_compare: {
		description: 'Compare large numbers',
		signature: '( string $buf1 , string $buf2 ): int'
	},
	sodium_crypto_aead_aes256gcm_decrypt: {
		description: 'Decrypt in combined mode with precalculation',
		signature: '( string $ciphertext , string $ad , string $nonce , string $key ): string'
	},
	sodium_crypto_aead_aes256gcm_encrypt: {
		description: 'Encrypt in combined mode with precalculation',
		signature: '( string $msg , string $ad , string $nonce , string $key ): string'
	},
	sodium_crypto_aead_aes256gcm_is_available: {
		description: 'Check if hardware supports AES256-GCM',
		signature: '(void): bool'
	},
	sodium_crypto_aead_aes256gcm_keygen: {
		description: 'Get random bytes for key',
		signature: '(void): string'
	},
	sodium_crypto_aead_chacha20poly1305_decrypt: {
		description: 'Verify that the ciphertext includes a valid tag',
		signature: '( string $ciphertext , string $ad , string $nonce , string $key ): string'
	},
	sodium_crypto_aead_chacha20poly1305_encrypt: {
		description: 'Encrypt a message',
		signature: '( string $msg , string $ad , string $nonce , string $key ): string'
	},
	sodium_crypto_aead_chacha20poly1305_ietf_decrypt: {
		description: 'Verify that the ciphertext includes a valid tag',
		signature: '( string $ciphertext , string $ad , string $nonce , string $key ): string'
	},
	sodium_crypto_aead_chacha20poly1305_ietf_encrypt: {
		description: 'Encrypt a message',
		signature: '( string $msg , string $ad , string $nonce , string $key ): string'
	},
	sodium_crypto_aead_chacha20poly1305_ietf_keygen: {
		description: 'Get random bytes for key',
		signature: '(void): string'
	},
	sodium_crypto_aead_chacha20poly1305_keygen: {
		description: 'Get random bytes for key',
		signature: '(void): string'
	},
	sodium_crypto_aead_xchacha20poly1305_ietf_decrypt: {
		description: 'Description',
		signature: '( string $ciphertext , string $ad , string $nonce , string $key ): string'
	},
	sodium_crypto_aead_xchacha20poly1305_ietf_encrypt: {
		description: 'Description',
		signature: '( string $msg , string $ad , string $nonce , string $key ): string'
	},
	sodium_crypto_aead_xchacha20poly1305_ietf_keygen: {
		description: 'Description',
		signature: '(void): string'
	},
	sodium_crypto_auth_keygen: {
		description: 'Get random bytes for key',
		signature: '(void): string'
	},
	sodium_crypto_auth_verify: {
		description: 'Verifies that the tag is valid for the message',
		signature: '( string $signature , string $msg , string $key ): bool'
	},
	sodium_crypto_auth: {
		description: 'Compute a tag for the message',
		signature: '( string $msg , string $key ): string'
	},
	sodium_crypto_box_keypair_from_secretkey_and_publickey: {
		description: 'Description',
		signature: '( string $secret_key , string $public_key ): string'
	},
	sodium_crypto_box_keypair: {
		description: 'Randomly generate a secret key and a corresponding public key',
		signature: '(void): string'
	},
	sodium_crypto_box_open: {
		description: 'Verify and decrypt a ciphertext',
		signature: '( string $ciphertext , string $nonce , string $key ): string'
	},
	sodium_crypto_box_publickey_from_secretkey: {
		description: 'Description',
		signature: '( string $key ): string'
	},
	sodium_crypto_box_publickey: {
		description: 'Description',
		signature: '( string $key ): string'
	},
	sodium_crypto_box_seal_open: {
		description: 'Decrypt the ciphertext',
		signature: '( string $ciphertext , string $key ): string'
	},
	sodium_crypto_box_seal: {
		description: 'Encrypt a message',
		signature: '( string $msg , string $key ): string'
	},
	sodium_crypto_box_secretkey: {
		description: 'Description',
		signature: '( string $key ): string'
	},
	sodium_crypto_box_seed_keypair: {
		description: 'Deterministically derive the key pair from a single key',
		signature: '( string $key ): string'
	},
	sodium_crypto_box: {
		description: 'Encrypt a message',
		signature: '( string $msg , string $nonce , string $key ): string'
	},
	sodium_crypto_generichash_final: {
		description: 'Complete the hash',
		signature: '( string $state [, int $length = SODIUM_CRYPTO_GENERICHASH_BYTES ]): string'
	},
	sodium_crypto_generichash_init: {
		description: 'Initialize a hash',
		signature: '([ string $key [, int $length = SODIUM_CRYPTO_GENERICHASH_BYTES ]]): string'
	},
	sodium_crypto_generichash_keygen: {
		description: 'Get random bytes for key',
		signature: '(void): string'
	},
	sodium_crypto_generichash_update: {
		description: 'Add message to a hash',
		signature: '( string $state , string $msg ): bool'
	},
	sodium_crypto_generichash: {
		description: 'Get a hash of the message',
		signature: '( string $msg [, string $key [, int $length = SODIUM_CRYPTO_GENERICHASH_BYTES ]]): string'
	},
	sodium_crypto_kdf_derive_from_key: {
		description: 'Derive a subkey',
		signature: '( int $subkey_len , int $subkey_id , string $context , string $key ): string'
	},
	sodium_crypto_kdf_keygen: {
		description: 'Get random bytes for key',
		signature: '(void): string'
	},
	sodium_crypto_kx_client_session_keys: {
		description: 'Description',
		signature: '( string $client_keypair , string $server_key ): array'
	},
	sodium_crypto_kx_keypair: {
		description: 'Creates a new sodium keypair',
		signature: '(void): string'
	},
	sodium_crypto_kx_publickey: {
		description: 'Description',
		signature: '( string $key ): string'
	},
	sodium_crypto_kx_secretkey: {
		description: 'Description',
		signature: '( string $key ): string'
	},
	sodium_crypto_kx_seed_keypair: {
		description: 'Description',
		signature: '( string $string ): string'
	},
	sodium_crypto_kx_server_session_keys: {
		description: 'Description',
		signature: '( string $server_keypair , string $client_key ): array'
	},
	sodium_crypto_pwhash_scryptsalsa208sha256_str_verify: {
		description: 'Verify that the password is a valid password verification string',
		signature: '( string $hash , string $password ): bool'
	},
	sodium_crypto_pwhash_scryptsalsa208sha256_str: {
		description: 'Get an ASCII encoded hash',
		signature: '( string $password , int $opslimit , int $memlimit ): string'
	},
	sodium_crypto_pwhash_scryptsalsa208sha256: {
		description: 'Derives a key from a password',
		signature: '( int $length , string $password , string $salt , int $opslimit , int $memlimit ): string'
	},
	sodium_crypto_pwhash_str_needs_rehash: {
		description: 'Description',
		signature: '( string $password , int $opslimit , int $memlimit ): bool'
	},
	sodium_crypto_pwhash_str_verify: {
		description: 'Verifies that a password matches a hash',
		signature: '( string $hash , string $password ): bool'
	},
	sodium_crypto_pwhash_str: {
		description: 'Get an ASCII-encoded hash',
		signature: '( string $password , int $opslimit , int $memlimit ): string'
	},
	sodium_crypto_pwhash: {
		description: 'Derive a key from a password',
		signature: '( int $length , string $password , string $salt , int $opslimit , int $memlimit [, int $alg ]): string'
	},
	sodium_crypto_scalarmult_base: {
		description: 'Alias of sodium_crypto_box_publickey_from_secretkey',
	},
	sodium_crypto_scalarmult: {
		description: 'Compute a shared secret given a user\'s secret key and another user\'s public key',
		signature: '( string $n , string $p ): string'
	},
	sodium_crypto_secretbox_keygen: {
		description: 'Get random bytes for key',
		signature: '(void): string'
	},
	sodium_crypto_secretbox_open: {
		description: 'Verify and decrypt a ciphertext',
		signature: '( string $ciphertext , string $nonce , string $key ): string'
	},
	sodium_crypto_secretbox: {
		description: 'Encrypt a message',
		signature: '( string $string , string $nonce , string $key ): string'
	},
	sodium_crypto_secretstream_xchacha20poly1305_init_pull: {
		description: 'Description',
		signature: '( string $header , string $key ): string'
	},
	sodium_crypto_secretstream_xchacha20poly1305_init_push: {
		description: 'Description',
		signature: '( string $key ): array'
	},
	sodium_crypto_secretstream_xchacha20poly1305_keygen: {
		description: 'Description',
		signature: '(void): string'
	},
	sodium_crypto_secretstream_xchacha20poly1305_pull: {
		description: 'Description',
		signature: '( string $state , string $c [, string $ad ]): array'
	},
	sodium_crypto_secretstream_xchacha20poly1305_push: {
		description: 'Description',
		signature: '( string $state , string $msg [, string $ad [, int $tag ]]): string'
	},
	sodium_crypto_secretstream_xchacha20poly1305_rekey: {
		description: 'Description',
		signature: '( string $state ): void'
	},
	sodium_crypto_shorthash_keygen: {
		description: 'Get random bytes for key',
		signature: '(void): string'
	},
	sodium_crypto_shorthash: {
		description: 'Compute a fixed-size fingerprint for the message',
		signature: '( string $msg , string $key ): string'
	},
	sodium_crypto_sign_detached: {
		description: 'Sign the message',
		signature: '( string $msg , string $secretkey ): string'
	},
	sodium_crypto_sign_ed25519_pk_to_curve25519: {
		description: 'Convert an Ed25519 public key to a Curve25519 public key',
		signature: '( string $key ): string'
	},
	sodium_crypto_sign_ed25519_sk_to_curve25519: {
		description: 'Convert an Ed25519 secret key to a Curve25519 secret key',
		signature: '( string $key ): string'
	},
	sodium_crypto_sign_keypair_from_secretkey_and_publickey: {
		description: 'Description',
		signature: '( string $secret_key , string $public_key ): string'
	},
	sodium_crypto_sign_keypair: {
		description: 'Randomly generate a secret key and a corresponding public key',
		signature: '(void): string'
	},
	sodium_crypto_sign_open: {
		description: 'Check that the signed message has a valid signature',
		signature: '( string $string , string $public_key ): string'
	},
	sodium_crypto_sign_publickey_from_secretkey: {
		description: 'Extract the public key from the secret key',
		signature: '( string $key ): string'
	},
	sodium_crypto_sign_publickey: {
		description: 'Description',
		signature: '( string $keypair ): string'
	},
	sodium_crypto_sign_secretkey: {
		description: 'Description',
		signature: '( string $key ): string'
	},
	sodium_crypto_sign_seed_keypair: {
		description: 'Deterministically derive the key pair from a single key',
		signature: '( string $key ): string'
	},
	sodium_crypto_sign_verify_detached: {
		description: 'Verify signature for the message',
		signature: '( string $signature , string $msg , string $public_key ): bool'
	},
	sodium_crypto_sign: {
		description: 'Sign a message',
		signature: '( string $msg , string $secret_key ): string'
	},
	sodium_crypto_stream_keygen: {
		description: 'Get random bytes for key',
		signature: '(void): string'
	},
	sodium_crypto_stream_xor: {
		description: 'Encrypt a message',
		signature: '( string $msg , string $nonce , string $key ): string'
	},
	sodium_crypto_stream: {
		description: 'Generate a deterministic sequence of bytes from a seed',
		signature: '( int $length , string $nonce , string $key ): string'
	},
	sodium_hex2bin: {
		description: 'Decodes a hexadecimally encoded binary string',
		signature: '( string $hex [, string $ignore ]): string'
	},
	sodium_increment: {
		description: 'Increment large number',
		signature: '( string $val ): void'
	},
	sodium_memcmp: {
		description: 'Test for equality in constant-time',
		signature: '( string $buf1 , string $buf2 ): int'
	},
	sodium_memzero: {
		description: 'Overwrite buf with zeros',
		signature: '( string $buf ): void'
	},
	sodium_pad: {
		description: 'Add padding data',
		signature: '( string $unpadded , int $length ): string'
	},
	sodium_unpad: {
		description: 'Remove padding data',
		signature: '( string $padded , int $length ): string'
	},
	dba_close: {
		description: 'Close a DBA database',
		signature: '( resource $handle ): void'
	},
	dba_delete: {
		description: 'Delete DBA entry specified by key',
		signature: '( string $key , resource $handle ): bool'
	},
	dba_exists: {
		description: 'Check whether key exists',
		signature: '( string $key , resource $handle ): bool'
	},
	dba_fetch: {
		description: 'Fetch data specified by key',
		signature: '( string $key , resource $handle , int $skip ): string'
	},
	dba_firstkey: {
		description: 'Fetch first key',
		signature: '( resource $handle ): string'
	},
	dba_handlers: {
		description: 'List all the handlers available',
		signature: '([ bool $full_info ]): array'
	},
	dba_insert: {
		description: 'Insert entry',
		signature: '( string $key , string $value , resource $handle ): bool'
	},
	dba_key_split: {
		description: 'Splits a key in string representation into array representation',
		signature: '( mixed $key ): mixed'
	},
	dba_list: {
		description: 'List all open database files',
		signature: '(void): array'
	},
	dba_nextkey: {
		description: 'Fetch next key',
		signature: '( resource $handle ): string'
	},
	dba_open: {
		description: 'Open database',
		signature: '( string $path , string $mode [, string $handler [, mixed $... ]]): resource'
	},
	dba_optimize: {
		description: 'Optimize database',
		signature: '( resource $handle ): bool'
	},
	dba_popen: {
		description: 'Open database persistently',
		signature: '( string $path , string $mode [, string $handler [, mixed $... ]]): resource'
	},
	dba_replace: {
		description: 'Replace or insert entry',
		signature: '( string $key , string $value , resource $handle ): bool'
	},
	dba_sync: {
		description: 'Synchronize database',
		signature: '( resource $handle ): bool'
	},
	pdo_drivers: {
		description: 'Return an array of available PDO drivers',
		signature: '(void): array'
	},
	cal_days_in_month: {
		description: 'Return the number of days in a month for a given year and calendar',
		signature: '( int $calendar , int $month , int $year ): int'
	},
	cal_from_jd: {
		description: 'Converts from Julian Day Count to a supported calendar',
		signature: '( int $jd , int $calendar ): array'
	},
	cal_info: {
		description: 'Returns information about a particular calendar',
		signature: '([ int $calendar = -1 ]): array'
	},
	cal_to_jd: {
		description: 'Converts from a supported calendar to Julian Day Count',
		signature: '( int $calendar , int $month , int $day , int $year ): int'
	},
	easter_date: {
		description: 'Get Unix timestamp for midnight on Easter of a given year',
		signature: '([ int $year = date("Y") ]): int'
	},
	easter_days: {
		description: 'Get number of days after March 21 on which Easter falls for a given year',
		signature: '([ int $year = date("Y") [, int $method = CAL_EASTER_DEFAULT ]]): int'
	},
	frenchtojd: {
		description: 'Converts a date from the French Republican Calendar to a Julian Day Count',
		signature: '( int $month , int $day , int $year ): int'
	},
	gregoriantojd: {
		description: 'Converts a Gregorian date to Julian Day Count',
		signature: '( int $month , int $day , int $year ): int'
	},
	jddayofweek: {
		description: 'Returns the day of the week',
		signature: '( int $julianday [, int $mode = CAL_DOW_DAYNO ]): mixed'
	},
	jdmonthname: {
		description: 'Returns a month name',
		signature: '( int $julianday , int $mode ): string'
	},
	jdtofrench: {
		description: 'Converts a Julian Day Count to the French Republican Calendar',
		signature: '( int $juliandaycount ): string'
	},
	jdtogregorian: {
		description: 'Converts Julian Day Count to Gregorian date',
		signature: '( int $julianday ): string'
	},
	jdtojewish: {
		description: 'Converts a Julian day count to a Jewish calendar date',
		signature: '( int $juliandaycount [, bool $hebrew [, int $fl = 0 ]]): string'
	},
	jdtojulian: {
		description: 'Converts a Julian Day Count to a Julian Calendar Date',
		signature: '( int $julianday ): string'
	},
	jdtounix: {
		description: 'Convert Julian Day to Unix timestamp',
		signature: '( int $jday ): int'
	},
	jewishtojd: {
		description: 'Converts a date in the Jewish Calendar to Julian Day Count',
		signature: '( int $month , int $day , int $year ): int'
	},
	juliantojd: {
		description: 'Converts a Julian Calendar date to Julian Day Count',
		signature: '( int $month , int $day , int $year ): int'
	},
	unixtojd: {
		description: 'Convert Unix timestamp to Julian Day',
		signature: '([ int $timestamp = time() ]): int'
	},
	date_add: {
		description: 'Adds an amount of days, months, years, hours, minutes and seconds to a   DateTime object',
		signature: '( DateInterval $interval , DateTime $object ): DateTime'
	},
	date_create: {
		description: 'Returns new DateTime object',
		signature: '([ string $time = "now" [, DateTimeZone $timezone ]]): DateTime'
	},
	date_create_from_format: {
		description: 'Parses a time string according to a specified format',
		signature: '( string $format , string $time [, DateTimeZone $timezone ]): DateTime'
	},
	date_get_last_errors: {
		description: 'Returns the warnings and errors',
		signature: '(void): array'
	},
	date_modify: {
		description: 'Alters the timestamp',
		signature: '( string $modify , DateTime $object ): DateTime'
	},
	date_date_set: {
		description: 'Sets the date',
		signature: '( int $year , int $month , int $day , DateTime $object ): DateTime'
	},
	date_isodate_set: {
		description: 'Sets the ISO date',
		signature: '( int $year , int $week [, int $day = 1 , DateTime $object ]): DateTime'
	},
	date_time_set: {
		description: 'Sets the time',
		signature: '( int $hour , int $minute [, int $second = 0 [, int $microseconds = 0 , DateTime $object ]]): DateTime'
	},
	date_timestamp_set: {
		description: 'Sets the date and time based on an Unix timestamp',
		signature: '( int $unixtimestamp , DateTime $object ): DateTime'
	},
	date_timezone_set: {
		description: 'Sets the time zone for the DateTime object',
		signature: '( DateTimeZone $timezone , DateTime $object ): object'
	},
	date_sub: {
		description: 'Subtracts an amount of days, months, years, hours, minutes and seconds from   a DateTime object',
		signature: '( DateInterval $interval , DateTime $object ): DateTime'
	},
	date_create_immutable: {
		description: 'Returns new DateTimeImmutable object',
		signature: '([ string $time = "now" [, DateTimeZone $timezone ]]): DateTimeImmutable'
	},
	date_create_immutable_from_format: {
		description: 'Parses a time string according to a specified format',
		signature: '( string $format , string $time [, DateTimeZone $timezone ]): DateTimeImmutable'
	},
	date_diff: {
		description: 'Returns the difference between two DateTime objects',
		signature: '( DateTimeInterface $datetime2 [, bool $absolute , DateTimeInterface $datetime1 ]): DateInterval'
	},
	date_format: {
		description: 'Returns date formatted according to given format',
		signature: '( string $format , DateTimeInterface $object ): string'
	},
	date_offset_get: {
		description: 'Returns the timezone offset',
		signature: '( DateTimeInterface $object ): int'
	},
	date_timestamp_get: {
		description: 'Gets the Unix timestamp',
		signature: '( DateTimeInterface $object ): int'
	},
	date_timezone_get: {
		description: 'Return time zone relative to given DateTime',
		signature: '( DateTimeInterface $object ): DateTimeZone'
	},
	timezone_open: {
		description: 'Creates new DateTimeZone object',
		signature: '( string $timezone ): DateTimeZone'
	},
	timezone_location_get: {
		description: 'Returns location information for a timezone',
		signature: '( DateTimeZone $object ): array'
	},
	timezone_name_get: {
		description: 'Returns the name of the timezone',
		signature: '( DateTimeZone $object ): string'
	},
	timezone_offset_get: {
		description: 'Returns the timezone offset from GMT',
		signature: '( DateTimeInterface $datetime , DateTimeZone $object ): int'
	},
	timezone_transitions_get: {
		description: 'Returns all transitions for the timezone',
		signature: '([ int $timestamp_begin [, int $timestamp_end , DateTimeZone $object ]]): array'
	},
	timezone_abbreviations_list: {
		description: 'Returns associative array containing dst, offset and the timezone name',
		signature: '(void): array'
	},
	timezone_identifiers_list: {
		description: 'Returns a numerically indexed array containing all defined timezone identifiers',
		signature: '([ int $what = DateTimeZone::ALL [, string $country ]]): array'
	},
	checkdate: {
		description: 'Validate a Gregorian date',
		signature: '( int $month , int $day , int $year ): bool'
	},
	date_default_timezone_get: {
		description: 'Gets the default timezone used by all date/time functions in a script',
		signature: '(void): string'
	},
	date_default_timezone_set: {
		description: 'Sets the default timezone used by all date/time functions in a script',
		signature: '( string $timezone_identifier ): bool'
	},
	date_interval_create_from_date_string: {
		description: 'Alias of DateInterval::createFromDateString',
	},
	date_interval_format: {
		description: 'Alias of DateInterval::format',
	},
	date_parse_from_format: {
		description: 'Get info about given date formatted according to the specified format',
		signature: '( string $format , string $date ): array'
	},
	date_parse: {
		description: 'Returns associative array with detailed info about given date',
		signature: '( string $date ): array'
	},
	date_sun_info: {
		description: 'Returns an array with information about sunset/sunrise and twilight begin/end',
		signature: '( int $time , float $latitude , float $longitude ): array'
	},
	date_sunrise: {
		description: 'Returns time of sunrise for a given day and location',
		signature: '( int $timestamp [, int $format = SUNFUNCS_RET_STRING [, float $latitude = ini_get("date.default_latitude") [, float $longitude = ini_get("date.default_longitude") [, float $zenith = ini_get("date.sunrise_zenith") [, float $gmt_offset = 0 ]]]]]): mixed'
	},
	date_sunset: {
		description: 'Returns time of sunset for a given day and location',
		signature: '( int $timestamp [, int $format = SUNFUNCS_RET_STRING [, float $latitude = ini_get("date.default_latitude") [, float $longitude = ini_get("date.default_longitude") [, float $zenith = ini_get("date.sunset_zenith") [, float $gmt_offset = 0 ]]]]]): mixed'
	},
	date: {
		description: 'Format a local time/date',
		signature: '( string $format [, int $timestamp = time() ]): string'
	},
	getdate: {
		description: 'Get date/time information',
		signature: '([ int $timestamp = time() ]): array'
	},
	gettimeofday: {
		description: 'Get current time',
		signature: '([ bool $return_float ]): mixed'
	},
	gmdate: {
		description: 'Format a GMT/UTC date/time',
		signature: '( string $format [, int $timestamp = time() ]): string'
	},
	gmmktime: {
		description: 'Get Unix timestamp for a GMT date',
		signature: '([ int $hour = gmdate("H") [, int $minute = gmdate("i") [, int $second = gmdate("s") [, int $month = gmdate("n") [, int $day = gmdate("j") [, int $year = gmdate("Y") [, int $is_dst = -1 ]]]]]]]): int'
	},
	gmstrftime: {
		description: 'Format a GMT/UTC time/date according to locale settings',
		signature: '( string $format [, int $timestamp = time() ]): string'
	},
	idate: {
		description: 'Format a local time/date as integer',
		signature: '( string $format [, int $timestamp = time() ]): int'
	},
	localtime: {
		description: 'Get the local time',
		signature: '([ int $timestamp = time() [, bool $is_associative ]]): array'
	},
	microtime: {
		description: 'Return current Unix timestamp with microseconds',
		signature: '([ bool $get_as_float ]): mixed'
	},
	mktime: {
		description: 'Get Unix timestamp for a date',
		signature: '([ int $hour = date("H") [, int $minute = date("i") [, int $second = date("s") [, int $month = date("n") [, int $day = date("j") [, int $year = date("Y") [, int $is_dst = -1 ]]]]]]]): int'
	},
	strftime: {
		description: 'Format a local time/date according to locale settings',
		signature: '( string $format [, int $timestamp = time() ]): string'
	},
	strptime: {
		description: 'Parse a time/date generated with strftime',
		signature: '( string $date , string $format ): array'
	},
	strtotime: {
		description: 'Parse about any English textual datetime description into a Unix timestamp',
		signature: '( string $time [, int $now = time() ]): int'
	},
	time: {
		description: 'Return current Unix timestamp',
		signature: '(void): int'
	},
	timezone_name_from_abbr: {
		description: 'Returns the timezone name from abbreviation',
		signature: '( string $abbr [, int $gmtOffset = -1 [, int $isdst = -1 ]]): string'
	},
	timezone_version_get: {
		description: 'Gets the version of the timezonedb',
		signature: '(void): string'
	},
	chdir: {
		description: 'Change directory',
		signature: '( string $directory ): bool'
	},
	chroot: {
		description: 'Change the root directory',
		signature: '( string $directory ): bool'
	},
	closedir: {
		description: 'Close directory handle',
		signature: '([ resource $dir_handle ]): void'
	},
	dir: {
		description: 'Return an instance of the Directory class',
		signature: '( string $directory [, resource $context ]): Directory'
	},
	getcwd: {
		description: 'Gets the current working directory',
		signature: '(void): string'
	},
	opendir: {
		description: 'Open directory handle',
		signature: '( string $path [, resource $context ]): resource'
	},
	readdir: {
		description: 'Read entry from directory handle',
		signature: '([ resource $dir_handle ]): string'
	},
	rewinddir: {
		description: 'Rewind directory handle',
		signature: '([ resource $dir_handle ]): void'
	},
	scandir: {
		description: 'List files and directories inside the specified path',
		signature: '( string $directory [, int $sorting_order = SCANDIR_SORT_ASCENDING [, resource $context ]]): array'
	},
	finfo_buffer: {
		description: 'Return information about a string buffer',
		signature: '( resource $finfo , string $string [, int $options = FILEINFO_NONE [, resource $context ]]): string'
	},
	finfo_close: {
		description: 'Close fileinfo resource',
		signature: '( resource $finfo ): bool'
	},
	finfo_file: {
		description: 'Return information about a file',
		signature: '( resource $finfo , string $file_name [, int $options = FILEINFO_NONE [, resource $context ]]): string'
	},
	finfo_open: {
		description: 'Create a new fileinfo resource',
		signature: '([ int $options = FILEINFO_NONE [, string $magic_file ]]): resource'
	},
	finfo_set_flags: {
		description: 'Set libmagic configuration options',
		signature: '( resource $finfo , int $options ): bool'
	},
	mime_content_type: {
		description: 'Detect MIME Content-type for a file',
		signature: '( string $filename ): string'
	},
	basename: {
		description: 'Returns trailing name component of path',
		signature: '( string $path [, string $suffix ]): string'
	},
	chgrp: {
		description: 'Changes file group',
		signature: '( string $filename , mixed $group ): bool'
	},
	chmod: {
		description: 'Changes file mode',
		signature: '( string $filename , int $mode ): bool'
	},
	chown: {
		description: 'Changes file owner',
		signature: '( string $filename , mixed $user ): bool'
	},
	clearstatcache: {
		description: 'Clears file status cache',
		signature: '([ bool $clear_realpath_cache [, string $filename ]]): void'
	},
	copy: {
		description: 'Copies file',
		signature: '( string $source , string $dest [, resource $context ]): bool'
	},
	delete: {
		description: 'See unlink or unset',
	},
	dirname: {
		description: 'Returns a parent directory\'s path',
		signature: '( string $path [, int $levels = 1 ]): string'
	},
	disk_free_space: {
		description: 'Returns available space on filesystem or disk partition',
		signature: '( string $directory ): float'
	},
	disk_total_space: {
		description: 'Returns the total size of a filesystem or disk partition',
		signature: '( string $directory ): float'
	},
	diskfreespace: {
		description: 'Alias of disk_free_space',
	},
	fclose: {
		description: 'Closes an open file pointer',
		signature: '( resource $handle ): bool'
	},
	feof: {
		description: 'Tests for end-of-file on a file pointer',
		signature: '( resource $handle ): bool'
	},
	fflush: {
		description: 'Flushes the output to a file',
		signature: '( resource $handle ): bool'
	},
	fgetc: {
		description: 'Gets character from file pointer',
		signature: '( resource $handle ): string'
	},
	fgetcsv: {
		description: 'Gets line from file pointer and parse for CSV fields',
		signature: '( resource $handle [, int $length = 0 [, string $delimiter = "," [, string $enclosure = \'"\' [, string $escape = "\\" ]]]]): array'
	},
	fgets: {
		description: 'Gets line from file pointer',
		signature: '( resource $handle [, int $length ]): string'
	},
	fgetss: {
		description: 'Gets line from file pointer and strip HTML tags',
		signature: '( resource $handle [, int $length [, string $allowable_tags ]]): string'
	},
	file_exists: {
		description: 'Checks whether a file or directory exists',
		signature: '( string $filename ): bool'
	},
	file_get_contents: {
		description: 'Reads entire file into a string',
		signature: '( string $filename [, bool $use_include_path [, resource $context [, int $offset = 0 [, int $maxlen ]]]]): string'
	},
	file_put_contents: {
		description: 'Write data to a file',
		signature: '( string $filename , mixed $data [, int $flags = 0 [, resource $context ]]): int'
	},
	file: {
		description: 'Reads entire file into an array',
		signature: '( string $filename [, int $flags = 0 [, resource $context ]]): array'
	},
	fileatime: {
		description: 'Gets last access time of file',
		signature: '( string $filename ): int'
	},
	filectime: {
		description: 'Gets inode change time of file',
		signature: '( string $filename ): int'
	},
	filegroup: {
		description: 'Gets file group',
		signature: '( string $filename ): int'
	},
	fileinode: {
		description: 'Gets file inode',
		signature: '( string $filename ): int'
	},
	filemtime: {
		description: 'Gets file modification time',
		signature: '( string $filename ): int'
	},
	fileowner: {
		description: 'Gets file owner',
		signature: '( string $filename ): int'
	},
	fileperms: {
		description: 'Gets file permissions',
		signature: '( string $filename ): int'
	},
	filesize: {
		description: 'Gets file size',
		signature: '( string $filename ): int'
	},
	filetype: {
		description: 'Gets file type',
		signature: '( string $filename ): string'
	},
	flock: {
		description: 'Portable advisory file locking',
		signature: '( resource $handle , int $operation [, int $wouldblock ]): bool'
	},
	fnmatch: {
		description: 'Match filename against a pattern',
		signature: '( string $pattern , string $string [, int $flags = 0 ]): bool'
	},
	fopen: {
		description: 'Opens file or URL',
		signature: '( string $filename , string $mode [, bool $use_include_path [, resource $context ]]): resource'
	},
	fpassthru: {
		description: 'Output all remaining data on a file pointer',
		signature: '( resource $handle ): int'
	},
	fputcsv: {
		description: 'Format line as CSV and write to file pointer',
		signature: '( resource $handle , array $fields [, string $delimiter = "," [, string $enclosure = \'"\' [, string $escape_char = "\\" ]]]): int'
	},
	fputs: {
		description: 'Alias of fwrite',
	},
	fread: {
		description: 'Binary-safe file read',
		signature: '( resource $handle , int $length ): string'
	},
	fscanf: {
		description: 'Parses input from a file according to a format',
		signature: '( resource $handle , string $format [, mixed $... ]): mixed'
	},
	fseek: {
		description: 'Seeks on a file pointer',
		signature: '( resource $handle , int $offset [, int $whence = SEEK_SET ]): int'
	},
	fstat: {
		description: 'Gets information about a file using an open file pointer',
		signature: '( resource $handle ): array'
	},
	ftell: {
		description: 'Returns the current position of the file read/write pointer',
		signature: '( resource $handle ): int'
	},
	ftruncate: {
		description: 'Truncates a file to a given length',
		signature: '( resource $handle , int $size ): bool'
	},
	fwrite: {
		description: 'Binary-safe file write',
		signature: '( resource $handle , string $string [, int $length ]): int'
	},
	glob: {
		description: 'Find pathnames matching a pattern',
		signature: '( string $pattern [, int $flags = 0 ]): array'
	},
	is_dir: {
		description: 'Tells whether the filename is a directory',
		signature: '( string $filename ): bool'
	},
	is_executable: {
		description: 'Tells whether the filename is executable',
		signature: '( string $filename ): bool'
	},
	is_file: {
		description: 'Tells whether the filename is a regular file',
		signature: '( string $filename ): bool'
	},
	is_link: {
		description: 'Tells whether the filename is a symbolic link',
		signature: '( string $filename ): bool'
	},
	is_readable: {
		description: 'Tells whether a file exists and is readable',
		signature: '( string $filename ): bool'
	},
	is_uploaded_file: {
		description: 'Tells whether the file was uploaded via HTTP POST',
		signature: '( string $filename ): bool'
	},
	is_writable: {
		description: 'Tells whether the filename is writable',
		signature: '( string $filename ): bool'
	},
	is_writeable: {
		description: 'Alias of is_writable',
	},
	lchgrp: {
		description: 'Changes group ownership of symlink',
		signature: '( string $filename , mixed $group ): bool'
	},
	lchown: {
		description: 'Changes user ownership of symlink',
		signature: '( string $filename , mixed $user ): bool'
	},
	link: {
		description: 'Create a hard link',
		signature: '( string $target , string $link ): bool'
	},
	linkinfo: {
		description: 'Gets information about a link',
		signature: '( string $path ): int'
	},
	lstat: {
		description: 'Gives information about a file or symbolic link',
		signature: '( string $filename ): array'
	},
	mkdir: {
		description: 'Makes directory',
		signature: '( string $pathname [, int $mode = 0777 [, bool $recursive [, resource $context ]]]): bool'
	},
	move_uploaded_file: {
		description: 'Moves an uploaded file to a new location',
		signature: '( string $filename , string $destination ): bool'
	},
	parse_ini_file: {
		description: 'Parse a configuration file',
		signature: '( string $filename [, bool $process_sections [, int $scanner_mode = INI_SCANNER_NORMAL ]]): array'
	},
	parse_ini_string: {
		description: 'Parse a configuration string',
		signature: '( string $ini [, bool $process_sections [, int $scanner_mode = INI_SCANNER_NORMAL ]]): array'
	},
	pathinfo: {
		description: 'Returns information about a file path',
		signature: '( string $path [, int $options = PATHINFO_DIRNAME | PATHINFO_BASENAME | PATHINFO_EXTENSION | PATHINFO_FILENAME ]): mixed'
	},
	pclose: {
		description: 'Closes process file pointer',
		signature: '( resource $handle ): int'
	},
	popen: {
		description: 'Opens process file pointer',
		signature: '( string $command , string $mode ): resource'
	},
	readfile: {
		description: 'Outputs a file',
		signature: '( string $filename [, bool $use_include_path [, resource $context ]]): int'
	},
	readlink: {
		description: 'Returns the target of a symbolic link',
		signature: '( string $path ): string'
	},
	realpath_cache_get: {
		description: 'Get realpath cache entries',
		signature: '(void): array'
	},
	realpath_cache_size: {
		description: 'Get realpath cache size',
		signature: '(void): int'
	},
	realpath: {
		description: 'Returns canonicalized absolute pathname',
		signature: '( string $path ): string'
	},
	rename: {
		description: 'Renames a file or directory',
		signature: '( string $oldname , string $newname [, resource $context ]): bool'
	},
	rewind: {
		description: 'Rewind the position of a file pointer',
		signature: '( resource $handle ): bool'
	},
	rmdir: {
		description: 'Removes directory',
		signature: '( string $dirname [, resource $context ]): bool'
	},
	set_file_buffer: {
		description: 'Alias of stream_set_write_buffer',
	},
	stat: {
		description: 'Gives information about a file',
		signature: '( string $filename ): array'
	},
	symlink: {
		description: 'Creates a symbolic link',
		signature: '( string $target , string $link ): bool'
	},
	tempnam: {
		description: 'Create file with unique file name',
		signature: '( string $dir , string $prefix ): string'
	},
	tmpfile: {
		description: 'Creates a temporary file',
		signature: '(void): resource'
	},
	touch: {
		description: 'Sets access and modification time of file',
		signature: '( string $filename [, int $time = time() [, int $atime ]]): bool'
	},
	umask: {
		description: 'Changes the current umask',
		signature: '([ int $mask ]): int'
	},
	unlink: {
		description: 'Deletes a file',
		signature: '( string $filename [, resource $context ]): bool'
	},
	iconv_get_encoding: {
		description: 'Retrieve internal configuration variables of iconv extension',
		signature: '([ string $type = "all" ]): mixed'
	},
	iconv_mime_decode_headers: {
		description: 'Decodes multiple MIME header fields at once',
		signature: '( string $encoded_headers [, int $mode = 0 [, string $charset = ini_get("iconv.internal_encoding") ]]): array'
	},
	iconv_mime_decode: {
		description: 'Decodes a MIME header field',
		signature: '( string $encoded_header [, int $mode = 0 [, string $charset = ini_get("iconv.internal_encoding") ]]): string'
	},
	iconv_mime_encode: {
		description: 'Composes a MIME header field',
		signature: '( string $field_name , string $field_value [, array $preferences ]): string'
	},
	iconv_set_encoding: {
		description: 'Set current setting for character encoding conversion',
		signature: '( string $type , string $charset ): bool'
	},
	iconv_strlen: {
		description: 'Returns the character count of string',
		signature: '( string $str [, string $charset = ini_get("iconv.internal_encoding") ]): int'
	},
	iconv_strpos: {
		description: 'Finds position of first occurrence of a needle within a haystack',
		signature: '( string $haystack , string $needle [, int $offset = 0 [, string $charset = ini_get("iconv.internal_encoding") ]]): int'
	},
	iconv_strrpos: {
		description: 'Finds the last occurrence of a needle within a haystack',
		signature: '( string $haystack , string $needle [, string $charset = ini_get("iconv.internal_encoding") ]): int'
	},
	iconv_substr: {
		description: 'Cut out part of a string',
		signature: '( string $str , int $offset [, int $length = iconv_strlen($str, $charset) [, string $charset = ini_get("iconv.internal_encoding") ]]): string'
	},
	iconv: {
		description: 'Convert string to requested character encoding',
		signature: '( string $in_charset , string $out_charset , string $str ): string'
	},
	ob_iconv_handler: {
		description: 'Convert character encoding as output buffer handler',
		signature: '( string $contents , int $status ): string'
	},
	collator_asort: {
		description: 'Sort array maintaining index association',
		signature: '( array $arr [, int $sort_flag , Collator $coll ]): bool'
	},
	collator_compare: {
		description: 'Compare two Unicode strings',
		signature: '( string $str1 , string $str2 , Collator $coll ): int'
	},
	collator_create: {
		description: 'Create a collator',
		signature: '( string $locale ): Collator'
	},
	collator_get_attribute: {
		description: 'Get collation attribute value',
		signature: '( int $attr , Collator $coll ): int'
	},
	collator_get_error_code: {
		description: 'Get collator\'s last error code',
		signature: '( Collator $coll ): int'
	},
	collator_get_error_message: {
		description: 'Get text for collator\'s last error code',
		signature: '( Collator $coll ): string'
	},
	collator_get_locale: {
		description: 'Get the locale name of the collator',
		signature: '( int $type , Collator $coll ): string'
	},
	collator_get_sort_key: {
		description: 'Get sorting key for a string',
		signature: '( string $str , Collator $coll ): string'
	},
	collator_get_strength: {
		description: 'Get current collation strength',
		signature: '( Collator $coll ): int'
	},
	collator_set_attribute: {
		description: 'Set collation attribute',
		signature: '( int $attr , int $val , Collator $coll ): bool'
	},
	collator_set_strength: {
		description: 'Set collation strength',
		signature: '( int $strength , Collator $coll ): bool'
	},
	collator_sort_with_sort_keys: {
		description: 'Sort array using specified collator and sort keys',
		signature: '( array $arr , Collator $coll ): bool'
	},
	collator_sort: {
		description: 'Sort array using specified collator',
		signature: '( array $arr [, int $sort_flag , Collator $coll ]): bool'
	},
	numfmt_create: {
		description: 'Create a number formatter',
		signature: '( string $locale , int $style [, string $pattern ]): NumberFormatter'
	},
	numfmt_format_currency: {
		description: 'Format a currency value',
		signature: '( float $value , string $currency , NumberFormatter $fmt ): string'
	},
	numfmt_format: {
		description: 'Format a number',
		signature: '( number $value [, int $type , NumberFormatter $fmt ]): string'
	},
	numfmt_get_attribute: {
		description: 'Get an attribute',
		signature: '( int $attr , NumberFormatter $fmt ): int'
	},
	numfmt_get_error_code: {
		description: 'Get formatter\'s last error code',
		signature: '( NumberFormatter $fmt ): int'
	},
	numfmt_get_error_message: {
		description: 'Get formatter\'s last error message',
		signature: '( NumberFormatter $fmt ): string'
	},
	numfmt_get_locale: {
		description: 'Get formatter locale',
		signature: '([ int $type , NumberFormatter $fmt ]): string'
	},
	numfmt_get_pattern: {
		description: 'Get formatter pattern',
		signature: '( NumberFormatter $fmt ): string'
	},
	numfmt_get_symbol: {
		description: 'Get a symbol value',
		signature: '( int $attr , NumberFormatter $fmt ): string'
	},
	numfmt_get_text_attribute: {
		description: 'Get a text attribute',
		signature: '( int $attr , NumberFormatter $fmt ): string'
	},
	numfmt_parse_currency: {
		description: 'Parse a currency number',
		signature: '( string $value , string $currency [, int $position , NumberFormatter $fmt ]): float'
	},
	numfmt_parse: {
		description: 'Parse a number',
		signature: '( string $value [, int $type [, int $position , NumberFormatter $fmt ]]): mixed'
	},
	numfmt_set_attribute: {
		description: 'Set an attribute',
		signature: '( int $attr , int $value , NumberFormatter $fmt ): bool'
	},
	numfmt_set_pattern: {
		description: 'Set formatter pattern',
		signature: '( string $pattern , NumberFormatter $fmt ): bool'
	},
	numfmt_set_symbol: {
		description: 'Set a symbol value',
		signature: '( int $attr , string $value , NumberFormatter $fmt ): bool'
	},
	numfmt_set_text_attribute: {
		description: 'Set a text attribute',
		signature: '( int $attr , string $value , NumberFormatter $fmt ): bool'
	},
	locale_accept_from_http: {
		description: 'Tries to find out best available locale based on HTTP "Accept-Language" header',
		signature: '( string $header ): string'
	},
	locale_canonicalize: {
		description: 'Canonicalize the locale string',
		signature: '( string $locale ): string'
	},
	locale_compose: {
		description: 'Returns a correctly ordered and delimited locale ID',
		signature: '( array $subtags ): string'
	},
	locale_filter_matches: {
		description: 'Checks if a language tag filter matches with locale',
		signature: '( string $langtag , string $locale [, bool $canonicalize ]): bool'
	},
	locale_get_all_variants: {
		description: 'Gets the variants for the input locale',
		signature: '( string $locale ): array'
	},
	locale_get_default: {
		description: 'Gets the default locale value from the INTL global \'default_locale\'',
		signature: '(void): string'
	},
	locale_get_display_language: {
		description: 'Returns an appropriately localized display name for language of the inputlocale',
		signature: '( string $locale [, string $in_locale ]): string'
	},
	locale_get_display_name: {
		description: 'Returns an appropriately localized display name for the input locale',
		signature: '( string $locale [, string $in_locale ]): string'
	},
	locale_get_display_region: {
		description: 'Returns an appropriately localized display name for region of the input locale',
		signature: '( string $locale [, string $in_locale ]): string'
	},
	locale_get_display_script: {
		description: 'Returns an appropriately localized display name for script of the input locale',
		signature: '( string $locale [, string $in_locale ]): string'
	},
	locale_get_display_variant: {
		description: 'Returns an appropriately localized display name for variants of the input locale',
		signature: '( string $locale [, string $in_locale ]): string'
	},
	locale_get_keywords: {
		description: 'Gets the keywords for the input locale',
		signature: '( string $locale ): array'
	},
	locale_get_primary_language: {
		description: 'Gets the primary language for the input locale',
		signature: '( string $locale ): string'
	},
	locale_get_region: {
		description: 'Gets the region for the input locale',
		signature: '( string $locale ): string'
	},
	locale_get_script: {
		description: 'Gets the script for the input locale',
		signature: '( string $locale ): string'
	},
	locale_lookup: {
		description: 'Searches the language tag list for the best match to the language',
		signature: '( array $langtag , string $locale [, bool $canonicalize [, string $default ]]): string'
	},
	locale_parse: {
		description: 'Returns a key-value array of locale ID subtag elements',
		signature: '( string $locale ): array'
	},
	locale_set_default: {
		description: 'Sets the default runtime locale',
		signature: '( string $locale ): bool'
	},
	normalizer_get_raw_decomposition: {
		description: 'Gets the Decomposition_Mapping property for the given UTF-8 encoded code point',
		signature: '( string $input ): string'
	},
	normalizer_is_normalized: {
		description: 'Checks if the provided string is already in the specified normalization   form',
		signature: '( string $input [, int $form = Normalizer::FORM_C ]): bool'
	},
	normalizer_normalize: {
		description: 'Normalizes the input provided and returns the normalized string',
		signature: '( string $input [, int $form = Normalizer::FORM_C ]): string'
	},
	msgfmt_create: {
		description: 'Constructs a new Message Formatter',
		signature: '( string $locale , string $pattern ): MessageFormatter'
	},
	msgfmt_format_message: {
		description: 'Quick format message',
		signature: '( string $locale , string $pattern , array $args ): string'
	},
	msgfmt_format: {
		description: 'Format the message',
		signature: '( array $args , MessageFormatter $fmt ): string'
	},
	msgfmt_get_error_code: {
		description: 'Get the error code from last operation',
		signature: '( MessageFormatter $fmt ): int'
	},
	msgfmt_get_error_message: {
		description: 'Get the error text from the last operation',
		signature: '( MessageFormatter $fmt ): string'
	},
	msgfmt_get_locale: {
		description: 'Get the locale for which the formatter was created',
		signature: '( NumberFormatter $formatter ): string'
	},
	msgfmt_get_pattern: {
		description: 'Get the pattern used by the formatter',
		signature: '( MessageFormatter $fmt ): string'
	},
	msgfmt_parse_message: {
		description: 'Quick parse input string',
		signature: '( string $locale , string $pattern , string $source , string $value ): array'
	},
	msgfmt_parse: {
		description: 'Parse input string according to pattern',
		signature: '( string $value , MessageFormatter $fmt ): array'
	},
	msgfmt_set_pattern: {
		description: 'Set the pattern used by the formatter',
		signature: '( string $pattern , MessageFormatter $fmt ): bool'
	},
	intlcal_get_error_code: {
		description: 'Get last error code on the object',
		signature: '( IntlCalendar $calendar ): int'
	},
	intlcal_get_error_message: {
		description: 'Get last error message on the object',
		signature: '( IntlCalendar $calendar ): string'
	},
	intltz_get_error_code: {
		description: 'Get last error code on the object',
		signature: '(void): int'
	},
	intltz_get_error_message: {
		description: 'Get last error message on the object',
		signature: '(void): string'
	},
	datefmt_create: {
		description: 'Create a date formatter',
		signature: '( string $locale , int $datetype , int $timetype [, mixed $timezone = NULL [, mixed $calendar = NULL [, string $pattern = "" ]]]): IntlDateFormatter'
	},
	datefmt_format: {
		description: 'Format the date/time value as a string',
		signature: '( mixed $value , IntlDateFormatter $fmt ): string'
	},
	datefmt_format_object: {
		description: 'Formats an object',
		signature: '( object $object [, mixed $format = NULL [, string $locale = NULL ]]): string'
	},
	datefmt_get_calendar: {
		description: 'Get the calendar type used for the IntlDateFormatter',
		signature: '( IntlDateFormatter $fmt ): int'
	},
	datefmt_get_datetype: {
		description: 'Get the datetype used for the IntlDateFormatter',
		signature: '( IntlDateFormatter $fmt ): int'
	},
	datefmt_get_error_code: {
		description: 'Get the error code from last operation',
		signature: '( IntlDateFormatter $fmt ): int'
	},
	datefmt_get_error_message: {
		description: 'Get the error text from the last operation',
		signature: '( IntlDateFormatter $fmt ): string'
	},
	datefmt_get_locale: {
		description: 'Get the locale used by formatter',
		signature: '([ int $which , IntlDateFormatter $fmt ]): string'
	},
	datefmt_get_pattern: {
		description: 'Get the pattern used for the IntlDateFormatter',
		signature: '( IntlDateFormatter $fmt ): string'
	},
	datefmt_get_timetype: {
		description: 'Get the timetype used for the IntlDateFormatter',
		signature: '( IntlDateFormatter $fmt ): int'
	},
	datefmt_get_timezone_id: {
		description: 'Get the timezone-id used for the IntlDateFormatter',
		signature: '( IntlDateFormatter $fmt ): string'
	},
	datefmt_get_calendar_object: {
		description: 'Get copy of formatterʼs calendar object',
		signature: '(void): IntlCalendar'
	},
	datefmt_get_timezone: {
		description: 'Get formatterʼs timezone',
		signature: '(void): IntlTimeZone'
	},
	datefmt_is_lenient: {
		description: 'Get the lenient used for the IntlDateFormatter',
		signature: '( IntlDateFormatter $fmt ): bool'
	},
	datefmt_localtime: {
		description: 'Parse string to a field-based time value',
		signature: '( string $value [, int $position , IntlDateFormatter $fmt ]): array'
	},
	datefmt_parse: {
		description: 'Parse string to a timestamp value',
		signature: '( string $value [, int $position , IntlDateFormatter $fmt ]): int'
	},
	datefmt_set_calendar: {
		description: 'Sets the calendar type used by the formatter',
		signature: '( mixed $which , IntlDateFormatter $fmt ): bool'
	},
	datefmt_set_lenient: {
		description: 'Set the leniency of the parser',
		signature: '( bool $lenient , IntlDateFormatter $fmt ): bool'
	},
	datefmt_set_pattern: {
		description: 'Set the pattern used for the IntlDateFormatter',
		signature: '( string $pattern , IntlDateFormatter $fmt ): bool'
	},
	datefmt_set_timezone_id: {
		description: 'Sets the time zone to use',
		signature: '( string $zone , IntlDateFormatter $fmt ): bool'
	},
	datefmt_set_timezone: {
		description: 'Sets formatterʼs timezone',
		signature: '( mixed $zone , IntlDateFormatter $fmt ): bool'
	},
	resourcebundle_count: {
		description: 'Get number of elements in the bundle',
		signature: '( ResourceBundle $r ): int'
	},
	resourcebundle_create: {
		description: 'Create a resource bundle',
		signature: '( string $locale , string $bundlename [, bool $fallback ]): ResourceBundle'
	},
	resourcebundle_get_error_code: {
		description: 'Get bundle\'s last error code',
		signature: '( ResourceBundle $r ): int'
	},
	resourcebundle_get_error_message: {
		description: 'Get bundle\'s last error message',
		signature: '( ResourceBundle $r ): string'
	},
	resourcebundle_get: {
		description: 'Get data from the bundle',
		signature: '( string|int $index [, bool $fallback , ResourceBundle $r ]): mixed'
	},
	resourcebundle_locales: {
		description: 'Get supported locales',
		signature: '( string $bundlename ): array'
	},
	transliterator_create: {
		description: 'Create a transliterator',
		signature: '( string $id [, int $direction ]): Transliterator'
	},
	transliterator_create_from_rules: {
		description: 'Create transliterator from rules',
		signature: '( string $rules [, int $direction , string $id ]): Transliterator'
	},
	transliterator_create_inverse: {
		description: 'Create an inverse transliterator',
		signature: '(void): Transliterator'
	},
	transliterator_get_error_code: {
		description: 'Get last error code',
		signature: '(void): int'
	},
	transliterator_get_error_message: {
		description: 'Get last error message',
		signature: '(void): string'
	},
	transliterator_list_ids: {
		description: 'Get transliterator IDs',
		signature: '(void): array'
	},
	transliterator_transliterate: {
		description: 'Transliterate a string',
		signature: '( string $subject [, int $start [, int $end , mixed $transliterator ]]): string'
	},
	intl_get_error_code: {
		description: 'Get the last error code',
		signature: '(void): int'
	},
	intl_get_error_message: {
		description: 'Get description of the last error',
		signature: '(void): string'
	},
	grapheme_extract: {
		description: 'Function to extract a sequence of default grapheme clusters from a text buffer, which must be encoded in UTF-8',
		signature: '( string $haystack , int $size [, int $extract_type [, int $start = 0 [, int $next ]]]): string'
	},
	grapheme_stripos: {
		description: 'Find position (in grapheme units) of first occurrence of a case-insensitive string',
		signature: '( string $haystack , string $needle [, int $offset = 0 ]): int'
	},
	grapheme_stristr: {
		description: 'Returns part of haystack string from the first occurrence of case-insensitive needle to the end of haystack',
		signature: '( string $haystack , string $needle [, bool $before_needle ]): string'
	},
	grapheme_strlen: {
		description: 'Get string length in grapheme units',
		signature: '( string $input ): int'
	},
	grapheme_strpos: {
		description: 'Find position (in grapheme units) of first occurrence of a string',
		signature: '( string $haystack , string $needle [, int $offset = 0 ]): int'
	},
	grapheme_strripos: {
		description: 'Find position (in grapheme units) of last occurrence of a case-insensitive string',
		signature: '( string $haystack , string $needle [, int $offset = 0 ]): int'
	},
	grapheme_strrpos: {
		description: 'Find position (in grapheme units) of last occurrence of a string',
		signature: '( string $haystack , string $needle [, int $offset = 0 ]): int'
	},
	grapheme_strstr: {
		description: 'Returns part of haystack string from the first occurrence of needle to the end of haystack',
		signature: '( string $haystack , string $needle [, bool $before_needle ]): string'
	},
	grapheme_substr: {
		description: 'Return part of a string',
		signature: '( string $string , int $start [, int $length ]): string'
	},
	idn_to_ascii: {
		description: 'Convert domain name to IDNA ASCII form',
		signature: '( string $domain [, int $options = IDNA_DEFAULT [, int $variant = INTL_IDNA_VARIANT_UTS46 [, array $idna_info ]]]): string'
	},
	idn_to_utf8: {
		description: 'Convert domain name from IDNA ASCII to Unicode',
		signature: '( string $domain [, int $options = IDNA_DEFAULT [, int $variant = INTL_IDNA_VARIANT_UTS46 [, array $idna_info ]]]): string'
	},
	intl_error_name: {
		description: 'Get symbolic name for a given error code',
		signature: '( int $error_code ): string'
	},
	intl_is_failure: {
		description: 'Check whether the given error code indicates failure',
		signature: '( int $error_code ): bool'
	},
	mb_check_encoding: {
		description: 'Check if the string is valid for the specified encoding',
		signature: '([ string $var [, string $encoding = mb_internal_encoding() ]]): bool'
	},
	mb_chr: {
		description: 'Get a specific character',
		signature: '( int $cp [, string $encoding ]): string'
	},
	mb_convert_case: {
		description: 'Perform case folding on a string',
		signature: '( string $str , int $mode [, string $encoding = mb_internal_encoding() ]): string'
	},
	mb_convert_encoding: {
		description: 'Convert character encoding',
		signature: '( string $str , string $to_encoding [, mixed $from_encoding = mb_internal_encoding() ]): string'
	},
	mb_convert_kana: {
		description: 'Convert "kana" one from another ("zen-kaku", "han-kaku" and more)',
		signature: '( string $str [, string $option = "KV" [, string $encoding = mb_internal_encoding() ]]): string'
	},
	mb_convert_variables: {
		description: 'Convert character code in variable(s)',
		signature: '( string $to_encoding , mixed $from_encoding , mixed $vars [, mixed $... ]): string'
	},
	mb_decode_mimeheader: {
		description: 'Decode string in MIME header field',
		signature: '( string $str ): string'
	},
	mb_decode_numericentity: {
		description: 'Decode HTML numeric string reference to character',
		signature: '( string $str , array $convmap [, string $encoding = mb_internal_encoding() [, bool $is_hex ]]): string'
	},
	mb_detect_encoding: {
		description: 'Detect character encoding',
		signature: '( string $str [, mixed $encoding_list = mb_detect_order() [, bool $strict ]]): string'
	},
	mb_detect_order: {
		description: 'Set/Get character encoding detection order',
		signature: '([ mixed $encoding_list = mb_detect_order() ]): mixed'
	},
	mb_encode_mimeheader: {
		description: 'Encode string for MIME header',
		signature: '( string $str [, string $charset = determined by mb_language() [, string $transfer_encoding = "B" [, string $linefeed = "\r\n" [, int $indent = 0 ]]]]): string'
	},
	mb_encode_numericentity: {
		description: 'Encode character to HTML numeric string reference',
		signature: '( string $str , array $convmap [, string $encoding = mb_internal_encoding() [, bool $is_hex ]]): string'
	},
	mb_encoding_aliases: {
		description: 'Get aliases of a known encoding type',
		signature: '( string $encoding ): array'
	},
	mb_ereg_match: {
		description: 'Regular expression match for multibyte string',
		signature: '( string $pattern , string $string [, string $option = "msr" ]): bool'
	},
	mb_ereg_replace_callback: {
		description: 'Perform a regular expression search and replace with multibyte support using a callback',
		signature: '( string $pattern , callable $callback , string $string [, string $option = "msr" ]): string'
	},
	mb_ereg_replace: {
		description: 'Replace regular expression with multibyte support',
		signature: '( string $pattern , string $replacement , string $string [, string $option = "msr" ]): string'
	},
	mb_ereg_search_getpos: {
		description: 'Returns start point for next regular expression match',
		signature: '(void): int'
	},
	mb_ereg_search_getregs: {
		description: 'Retrieve the result from the last multibyte regular expression match',
		signature: '(void): array'
	},
	mb_ereg_search_init: {
		description: 'Setup string and regular expression for a multibyte regular expression match',
		signature: '( string $string [, string $pattern [, string $option = "msr" ]]): bool'
	},
	mb_ereg_search_pos: {
		description: 'Returns position and length of a matched part of the multibyte regular expression for a predefined multibyte string',
		signature: '([ string $pattern [, string $option = "ms" ]]): array'
	},
	mb_ereg_search_regs: {
		description: 'Returns the matched part of a multibyte regular expression',
		signature: '([ string $pattern [, string $option = "ms" ]]): array'
	},
	mb_ereg_search_setpos: {
		description: 'Set start point of next regular expression match',
		signature: '( int $position ): bool'
	},
	mb_ereg_search: {
		description: 'Multibyte regular expression match for predefined multibyte string',
		signature: '([ string $pattern [, string $option = "ms" ]]): bool'
	},
	mb_ereg: {
		description: 'Regular expression match with multibyte support',
		signature: '( string $pattern , string $string [, array $regs ]): int'
	},
	mb_eregi_replace: {
		description: 'Replace regular expression with multibyte support ignoring case',
		signature: '( string $pattern , string $replace , string $string [, string $option = "msri" ]): string'
	},
	mb_eregi: {
		description: 'Regular expression match ignoring case with multibyte support',
		signature: '( string $pattern , string $string [, array $regs ]): int'
	},
	mb_get_info: {
		description: 'Get internal settings of mbstring',
		signature: '([ string $type = "all" ]): mixed'
	},
	mb_http_input: {
		description: 'Detect HTTP input character encoding',
		signature: '([ string $type = "" ]): mixed'
	},
	mb_http_output: {
		description: 'Set/Get HTTP output character encoding',
		signature: '([ string $encoding = mb_http_output() ]): mixed'
	},
	mb_internal_encoding: {
		description: 'Set/Get internal character encoding',
		signature: '([ string $encoding = mb_internal_encoding() ]): mixed'
	},
	mb_language: {
		description: 'Set/Get current language',
		signature: '([ string $language = mb_language() ]): mixed'
	},
	mb_list_encodings: {
		description: 'Returns an array of all supported encodings',
		signature: '(void): array'
	},
	mb_ord: {
		description: 'Get code point of character',
		signature: '( string $str [, string $encoding ]): int'
	},
	mb_output_handler: {
		description: 'Callback function converts character encoding in output buffer',
		signature: '( string $contents , int $status ): string'
	},
	mb_parse_str: {
		description: 'Parse GET/POST/COOKIE data and set global variable',
		signature: '( string $encoded_string [, array $result ]): array'
	},
	mb_preferred_mime_name: {
		description: 'Get MIME charset string',
		signature: '( string $encoding ): string'
	},
	mb_regex_encoding: {
		description: 'Set/Get character encoding for multibyte regex',
		signature: '([ string $encoding = mb_regex_encoding() ]): mixed'
	},
	mb_regex_set_options: {
		description: 'Set/Get the default options for mbregex functions',
		signature: '([ string $options = mb_regex_set_options() ]): string'
	},
	mb_scrub: {
		description: 'Description',
		signature: '( string $str [, string $encoding ]): string'
	},
	mb_send_mail: {
		description: 'Send encoded mail',
		signature: '( string $to , string $subject , string $message [, mixed $additional_headers [, string $additional_parameter ]]): bool'
	},
	mb_split: {
		description: 'Split multibyte string using regular expression',
		signature: '( string $pattern , string $string [, int $limit = -1 ]): array'
	},
	mb_strcut: {
		description: 'Get part of string',
		signature: '( string $str , int $start [, int $length = NULL [, string $encoding = mb_internal_encoding() ]]): string'
	},
	mb_strimwidth: {
		description: 'Get truncated string with specified width',
		signature: '( string $str , int $start , int $width [, string $trimmarker = "" [, string $encoding = mb_internal_encoding() ]]): string'
	},
	mb_stripos: {
		description: 'Finds position of first occurrence of a string within another, case insensitive',
		signature: '( string $haystack , string $needle [, int $offset = 0 [, string $encoding = mb_internal_encoding() ]]): int'
	},
	mb_stristr: {
		description: 'Finds first occurrence of a string within another, case insensitive',
		signature: '( string $haystack , string $needle [, bool $before_needle [, string $encoding = mb_internal_encoding() ]]): string'
	},
	mb_strlen: {
		description: 'Get string length',
		signature: '( string $str [, string $encoding = mb_internal_encoding() ]): string'
	},
	mb_strpos: {
		description: 'Find position of first occurrence of string in a string',
		signature: '( string $haystack , string $needle [, int $offset = 0 [, string $encoding = mb_internal_encoding() ]]): string'
	},
	mb_strrchr: {
		description: 'Finds the last occurrence of a character in a string within another',
		signature: '( string $haystack , string $needle [, bool $part [, string $encoding = mb_internal_encoding() ]]): string'
	},
	mb_strrichr: {
		description: 'Finds the last occurrence of a character in a string within another, case insensitive',
		signature: '( string $haystack , string $needle [, bool $part [, string $encoding = mb_internal_encoding() ]]): string'
	},
	mb_strripos: {
		description: 'Finds position of last occurrence of a string within another, case insensitive',
		signature: '( string $haystack , string $needle [, int $offset = 0 [, string $encoding = mb_internal_encoding() ]]): int'
	},
	mb_strrpos: {
		description: 'Find position of last occurrence of a string in a string',
		signature: '( string $haystack , string $needle [, int $offset = 0 [, string $encoding = mb_internal_encoding() ]]): int'
	},
	mb_strstr: {
		description: 'Finds first occurrence of a string within another',
		signature: '( string $haystack , string $needle [, bool $before_needle [, string $encoding = mb_internal_encoding() ]]): string'
	},
	mb_strtolower: {
		description: 'Make a string lowercase',
		signature: '( string $str [, string $encoding = mb_internal_encoding() ]): string'
	},
	mb_strtoupper: {
		description: 'Make a string uppercase',
		signature: '( string $str [, string $encoding = mb_internal_encoding() ]): string'
	},
	mb_strwidth: {
		description: 'Return width of string',
		signature: '( string $str [, string $encoding = mb_internal_encoding() ]): string'
	},
	mb_substitute_character: {
		description: 'Set/Get substitution character',
		signature: '([ mixed $substchar = mb_substitute_character() ]): integer'
	},
	mb_substr_count: {
		description: 'Count the number of substring occurrences',
		signature: '( string $haystack , string $needle [, string $encoding = mb_internal_encoding() ]): string'
	},
	mb_substr: {
		description: 'Get part of string',
		signature: '( string $str , int $start [, int $length = NULL [, string $encoding = mb_internal_encoding() ]]): string'
	},
	exif_imagetype: {
		description: 'Determine the type of an image',
		signature: '( string $filename ): int'
	},
	exif_read_data: {
		description: 'Reads the EXIF headers from an image file',
		signature: '( mixed $stream [, string $sections [, bool $arrays [, bool $thumbnail ]]]): array'
	},
	exif_tagname: {
		description: 'Get the header name for an index',
		signature: '( int $index ): string'
	},
	exif_thumbnail: {
		description: 'Retrieve the embedded thumbnail of an image',
		signature: '( mixed $stream [, int $width [, int $height [, int $imagetype ]]]): string'
	},
	read_exif_data: {
		description: 'Alias of exif_read_data',
	},
	ezmlm_hash: {
		description: 'Calculate the hash value needed by EZMLM',
		signature: '( string $addr ): int'
	},
	mail: {
		description: 'Send mail',
		signature: '( string $to , string $subject , string $message [, mixed $additional_headers [, string $additional_parameters ]]): bool'
	},
	bcadd: {
		description: 'Add two arbitrary precision numbers',
		signature: '( string $left_operand , string $right_operand [, int $scale = 0 ]): string'
	},
	bccomp: {
		description: 'Compare two arbitrary precision numbers',
		signature: '( string $left_operand , string $right_operand [, int $scale = 0 ]): int'
	},
	bcdiv: {
		description: 'Divide two arbitrary precision numbers',
		signature: '( string $dividend , string $divisor [, int $scale = 0 ]): string'
	},
	bcmod: {
		description: 'Get modulus of an arbitrary precision number',
		signature: '( string $dividend , string $divisor [, int $scale = 0 ]): string'
	},
	bcmul: {
		description: 'Multiply two arbitrary precision numbers',
		signature: '( string $left_operand , string $right_operand [, int $scale = 0 ]): string'
	},
	bcpow: {
		description: 'Raise an arbitrary precision number to another',
		signature: '( string $base , string $exponent [, int $scale = 0 ]): string'
	},
	bcpowmod: {
		description: 'Raise an arbitrary precision number to another, reduced by a specified modulus',
		signature: '( string $base , string $exponent , string $modulus [, int $scale = 0 ]): string'
	},
	bcscale: {
		description: 'Set or get default scale parameter for all bc math functions',
		signature: '( int $scale ): int'
	},
	bcsqrt: {
		description: 'Get the square root of an arbitrary precision number',
		signature: '( string $operand [, int $scale = 0 ]): string'
	},
	bcsub: {
		description: 'Subtract one arbitrary precision number from another',
		signature: '( string $left_operand , string $right_operand [, int $scale = 0 ]): string'
	},
	abs: {
		description: 'Absolute value',
		signature: '( mixed $number ): number'
	},
	acos: {
		description: 'Arc cosine',
		signature: '( float $arg ): float'
	},
	acosh: {
		description: 'Inverse hyperbolic cosine',
		signature: '( float $arg ): float'
	},
	asin: {
		description: 'Arc sine',
		signature: '( float $arg ): float'
	},
	asinh: {
		description: 'Inverse hyperbolic sine',
		signature: '( float $arg ): float'
	},
	atan2: {
		description: 'Arc tangent of two variables',
		signature: '( float $y , float $x ): float'
	},
	atan: {
		description: 'Arc tangent',
		signature: '( float $arg ): float'
	},
	atanh: {
		description: 'Inverse hyperbolic tangent',
		signature: '( float $arg ): float'
	},
	base_convert: {
		description: 'Convert a number between arbitrary bases',
		signature: '( string $number , int $frombase , int $tobase ): string'
	},
	bindec: {
		description: 'Binary to decimal',
		signature: '( string $binary_string ): float'
	},
	ceil: {
		description: 'Round fractions up',
		signature: '( float $value ): float'
	},
	cos: {
		description: 'Cosine',
		signature: '( float $arg ): float'
	},
	cosh: {
		description: 'Hyperbolic cosine',
		signature: '( float $arg ): float'
	},
	decbin: {
		description: 'Decimal to binary',
		signature: '( int $number ): string'
	},
	dechex: {
		description: 'Decimal to hexadecimal',
		signature: '( int $number ): string'
	},
	decoct: {
		description: 'Decimal to octal',
		signature: '( int $number ): string'
	},
	deg2rad: {
		description: 'Converts the number in degrees to the radian equivalent',
		signature: '( float $number ): float'
	},
	exp: {
		description: 'Calculates the exponent of e',
		signature: '( float $arg ): float'
	},
	expm1: {
		description: 'Returns exp(number) - 1, computed in a way that is accurate even   when the value of number is close to zero',
		signature: '( float $arg ): float'
	},
	floor: {
		description: 'Round fractions down',
		signature: '( float $value ): float'
	},
	fmod: {
		description: 'Returns the floating point remainder (modulo) of the division  of the arguments',
		signature: '( float $x , float $y ): float'
	},
	getrandmax: {
		description: 'Show largest possible random value',
		signature: '(void): int'
	},
	hexdec: {
		description: 'Hexadecimal to decimal',
		signature: '( string $hex_string ): number'
	},
	hypot: {
		description: 'Calculate the length of the hypotenuse of a right-angle triangle',
		signature: '( float $x , float $y ): float'
	},
	intdiv: {
		description: 'Integer division',
		signature: '( int $dividend , int $divisor ): int'
	},
	is_finite: {
		description: 'Finds whether a value is a legal finite number',
		signature: '( float $val ): bool'
	},
	is_infinite: {
		description: 'Finds whether a value is infinite',
		signature: '( float $val ): bool'
	},
	is_nan: {
		description: 'Finds whether a value is not a number',
		signature: '( float $val ): bool'
	},
	lcg_value: {
		description: 'Combined linear congruential generator',
		signature: '(void): float'
	},
	log10: {
		description: 'Base-10 logarithm',
		signature: '( float $arg ): float'
	},
	log1p: {
		description: 'Returns log(1 + number), computed in a way that is accurate even when   the value of number is close to zero',
		signature: '( float $number ): float'
	},
	log: {
		description: 'Natural logarithm',
		signature: '( float $arg [, float $base = M_E ]): float'
	},
	max: {
		description: 'Find highest value',
		signature: '( array $values , mixed $value1 [, mixed $... ]): string'
	},
	min: {
		description: 'Find lowest value',
		signature: '( array $values , mixed $value1 [, mixed $... ]): string'
	},
	mt_getrandmax: {
		description: 'Show largest possible random value',
		signature: '(void): int'
	},
	mt_rand: {
		description: 'Generate a random value via the Mersenne Twister Random Number Generator',
		signature: '( int $min , int $max ): int'
	},
	mt_srand: {
		description: 'Seeds the Mersenne Twister Random Number Generator',
		signature: '([ int $seed [, int $mode = MT_RAND_MT19937 ]]): void'
	},
	octdec: {
		description: 'Octal to decimal',
		signature: '( string $octal_string ): number'
	},
	pi: {
		description: 'Get value of pi',
		signature: '(void): float'
	},
	pow: {
		description: 'Exponential expression',
		signature: '( number $base , number $exp ): number'
	},
	rad2deg: {
		description: 'Converts the radian number to the equivalent number in degrees',
		signature: '( float $number ): float'
	},
	rand: {
		description: 'Generate a random integer',
		signature: '( int $min , int $max ): int'
	},
	round: {
		description: 'Rounds a float',
		signature: '( float $val [, int $precision = 0 [, int $mode = PHP_ROUND_HALF_UP ]]): float'
	},
	sin: {
		description: 'Sine',
		signature: '( float $arg ): float'
	},
	sinh: {
		description: 'Hyperbolic sine',
		signature: '( float $arg ): float'
	},
	sqrt: {
		description: 'Square root',
		signature: '( float $arg ): float'
	},
	srand: {
		description: 'Seed the random number generator',
		signature: '([ int $seed ]): void'
	},
	tan: {
		description: 'Tangent',
		signature: '( float $arg ): float'
	},
	tanh: {
		description: 'Hyperbolic tangent',
		signature: '( float $arg ): float'
	},
	pcntl_alarm: {
		description: 'Set an alarm clock for delivery of a signal',
		signature: '( int $seconds ): int'
	},
	pcntl_async_signals: {
		description: 'Enable/disable asynchronous signal handling or return the old setting',
		signature: '([ bool $on ]): bool'
	},
	pcntl_errno: {
		description: 'Alias of pcntl_get_last_error',
	},
	pcntl_exec: {
		description: 'Executes specified program in current process space',
		signature: '( string $path [, array $args [, array $envs ]]): void'
	},
	pcntl_fork: {
		description: 'Forks the currently running process',
		signature: '(void): int'
	},
	pcntl_get_last_error: {
		description: 'Retrieve the error number set by the last pcntl function which failed',
		signature: '(void): int'
	},
	pcntl_getpriority: {
		description: 'Get the priority of any process',
		signature: '([ int $pid = getmypid() [, int $process_identifier = PRIO_PROCESS ]]): int'
	},
	pcntl_setpriority: {
		description: 'Change the priority of any process',
		signature: '( int $priority [, int $pid = getmypid() [, int $process_identifier = PRIO_PROCESS ]]): bool'
	},
	pcntl_signal_dispatch: {
		description: 'Calls signal handlers for pending signals',
		signature: '(void): bool'
	},
	pcntl_signal_get_handler: {
		description: 'Get the current handler for specified signal',
		signature: '( int $signo ): mixed'
	},
	pcntl_signal: {
		description: 'Installs a signal handler',
		signature: '( int $signo , callable|int $handler [, bool $restart_syscalls ]): bool'
	},
	pcntl_sigprocmask: {
		description: 'Sets and retrieves blocked signals',
		signature: '( int $how , array $set [, array $oldset ]): bool'
	},
	pcntl_sigtimedwait: {
		description: 'Waits for signals, with a timeout',
		signature: '( array $set [, array $siginfo [, int $seconds = 0 [, int $nanoseconds = 0 ]]]): int'
	},
	pcntl_sigwaitinfo: {
		description: 'Waits for signals',
		signature: '( array $set [, array $siginfo ]): int'
	},
	pcntl_strerror: {
		description: 'Retrieve the system error message associated with the given errno',
		signature: '( int $errno ): string'
	},
	pcntl_wait: {
		description: 'Waits on or returns the status of a forked child',
		signature: '( int $status [, int $options = 0 [, array $rusage ]]): int'
	},
	pcntl_waitpid: {
		description: 'Waits on or returns the status of a forked child',
		signature: '( int $pid , int $status [, int $options = 0 [, array $rusage ]]): int'
	},
	pcntl_wexitstatus: {
		description: 'Returns the return code of a terminated child',
		signature: '( int $status ): int'
	},
	pcntl_wifexited: {
		description: 'Checks if status code represents a normal exit',
		signature: '( int $status ): bool'
	},
	pcntl_wifsignaled: {
		description: 'Checks whether the status code represents a termination due to a signal',
		signature: '( int $status ): bool'
	},
	pcntl_wifstopped: {
		description: 'Checks whether the child process is currently stopped',
		signature: '( int $status ): bool'
	},
	pcntl_wstopsig: {
		description: 'Returns the signal which caused the child to stop',
		signature: '( int $status ): int'
	},
	pcntl_wtermsig: {
		description: 'Returns the signal which caused the child to terminate',
		signature: '( int $status ): int'
	},
	posix_access: {
		description: 'Determine accessibility of a file',
		signature: '( string $file [, int $mode = POSIX_F_OK ]): bool'
	},
	posix_ctermid: {
		description: 'Get path name of controlling terminal',
		signature: '(void): string'
	},
	posix_errno: {
		description: 'Alias of posix_get_last_error',
	},
	posix_get_last_error: {
		description: 'Retrieve the error number set by the last posix function that failed',
		signature: '(void): int'
	},
	posix_getcwd: {
		description: 'Pathname of current directory',
		signature: '(void): string'
	},
	posix_getegid: {
		description: 'Return the effective group ID of the current process',
		signature: '(void): int'
	},
	posix_geteuid: {
		description: 'Return the effective user ID of the current process',
		signature: '(void): int'
	},
	posix_getgid: {
		description: 'Return the real group ID of the current process',
		signature: '(void): int'
	},
	posix_getgrgid: {
		description: 'Return info about a group by group id',
		signature: '( int $gid ): array'
	},
	posix_getgrnam: {
		description: 'Return info about a group by name',
		signature: '( string $name ): array'
	},
	posix_getgroups: {
		description: 'Return the group set of the current process',
		signature: '(void): array'
	},
	posix_getlogin: {
		description: 'Return login name',
		signature: '(void): string'
	},
	posix_getpgid: {
		description: 'Get process group id for job control',
		signature: '( int $pid ): int'
	},
	posix_getpgrp: {
		description: 'Return the current process group identifier',
		signature: '(void): int'
	},
	posix_getpid: {
		description: 'Return the current process identifier',
		signature: '(void): int'
	},
	posix_getppid: {
		description: 'Return the parent process identifier',
		signature: '(void): int'
	},
	posix_getpwnam: {
		description: 'Return info about a user by username',
		signature: '( string $username ): array'
	},
	posix_getpwuid: {
		description: 'Return info about a user by user id',
		signature: '( int $uid ): array'
	},
	posix_getrlimit: {
		description: 'Return info about system resource limits',
		signature: '(void): array'
	},
	posix_getsid: {
		description: 'Get the current sid of the process',
		signature: '( int $pid ): int'
	},
	posix_getuid: {
		description: 'Return the real user ID of the current process',
		signature: '(void): int'
	},
	posix_initgroups: {
		description: 'Calculate the group access list',
		signature: '( string $name , int $base_group_id ): bool'
	},
	posix_isatty: {
		description: 'Determine if a file descriptor is an interactive terminal',
		signature: '( mixed $fd ): bool'
	},
	posix_kill: {
		description: 'Send a signal to a process',
		signature: '( int $pid , int $sig ): bool'
	},
	posix_mkfifo: {
		description: 'Create a fifo special file (a named pipe)',
		signature: '( string $pathname , int $mode ): bool'
	},
	posix_mknod: {
		description: 'Create a special or ordinary file (POSIX.1)',
		signature: '( string $pathname , int $mode [, int $major = 0 [, int $minor = 0 ]]): bool'
	},
	posix_setegid: {
		description: 'Set the effective GID of the current process',
		signature: '( int $gid ): bool'
	},
	posix_seteuid: {
		description: 'Set the effective UID of the current process',
		signature: '( int $uid ): bool'
	},
	posix_setgid: {
		description: 'Set the GID of the current process',
		signature: '( int $gid ): bool'
	},
	posix_setpgid: {
		description: 'Set process group id for job control',
		signature: '( int $pid , int $pgid ): bool'
	},
	posix_setrlimit: {
		description: 'Set system resource limits',
		signature: '( int $resource , int $softlimit , int $hardlimit ): bool'
	},
	posix_setsid: {
		description: 'Make the current process a session leader',
		signature: '(void): int'
	},
	posix_setuid: {
		description: 'Set the UID of the current process',
		signature: '( int $uid ): bool'
	},
	posix_strerror: {
		description: 'Retrieve the system error message associated with the given errno',
		signature: '( int $errno ): string'
	},
	posix_times: {
		description: 'Get process times',
		signature: '(void): array'
	},
	posix_ttyname: {
		description: 'Determine terminal device name',
		signature: '( mixed $fd ): string'
	},
	posix_uname: {
		description: 'Get system name',
		signature: '(void): array'
	},
	escapeshellarg: {
		description: 'Escape a string to be used as a shell argument',
		signature: '( string $arg ): string'
	},
	escapeshellcmd: {
		description: 'Escape shell metacharacters',
		signature: '( string $command ): string'
	},
	exec: {
		description: 'Execute an external program',
		signature: '( string $command [, array $output [, int $return_var ]]): string'
	},
	passthru: {
		description: 'Execute an external program and display raw output',
		signature: '( string $command [, int $return_var ]): void'
	},
	proc_close: {
		description: 'Close a process opened by proc_open and return the exit code of that process',
		signature: '( resource $process ): int'
	},
	proc_get_status: {
		description: 'Get information about a process opened by proc_open',
		signature: '( resource $process ): array'
	},
	proc_nice: {
		description: 'Change the priority of the current process',
		signature: '( int $increment ): bool'
	},
	proc_open: {
		description: 'Execute a command and open file pointers for input/output',
		signature: '( string $cmd , array $descriptorspec , array $pipes [, string $cwd [, array $env [, array $other_options ]]]): resource'
	},
	proc_terminate: {
		description: 'Kills a process opened by proc_open',
		signature: '( resource $process [, int $signal = 15 ]): bool'
	},
	shell_exec: {
		description: 'Execute command via shell and return the complete output as a string',
		signature: '( string $cmd ): string'
	},
	system: {
		description: 'Execute an external program and display the output',
		signature: '( string $command [, int $return_var ]): string'
	},
	ftok: {
		description: 'Convert a pathname and a project identifier to a System V IPC key',
		signature: '( string $pathname , string $proj ): int'
	},
	msg_get_queue: {
		description: 'Create or attach to a message queue',
		signature: '( int $key [, int $perms = 0666 ]): resource'
	},
	msg_queue_exists: {
		description: 'Check whether a message queue exists',
		signature: '( int $key ): bool'
	},
	msg_receive: {
		description: 'Receive a message from a message queue',
		signature: '( resource $queue , int $desiredmsgtype , int $msgtype , int $maxsize , mixed $message [, bool $unserialize [, int $flags = 0 [, int $errorcode ]]]): bool'
	},
	msg_remove_queue: {
		description: 'Destroy a message queue',
		signature: '( resource $queue ): bool'
	},
	msg_send: {
		description: 'Send a message to a message queue',
		signature: '( resource $queue , int $msgtype , mixed $message [, bool $serialize [, bool $blocking [, int $errorcode ]]]): bool'
	},
	msg_set_queue: {
		description: 'Set information in the message queue data structure',
		signature: '( resource $queue , array $data ): bool'
	},
	msg_stat_queue: {
		description: 'Returns information from the message queue data structure',
		signature: '( resource $queue ): array'
	},
	sem_acquire: {
		description: 'Acquire a semaphore',
		signature: '( resource $sem_identifier [, bool $nowait ]): bool'
	},
	sem_get: {
		description: 'Get a semaphore id',
		signature: '( int $key [, int $max_acquire = 1 [, int $perm = 0666 [, int $auto_release = 1 ]]]): resource'
	},
	sem_release: {
		description: 'Release a semaphore',
		signature: '( resource $sem_identifier ): bool'
	},
	sem_remove: {
		description: 'Remove a semaphore',
		signature: '( resource $sem_identifier ): bool'
	},
	shm_attach: {
		description: 'Creates or open a shared memory segment',
		signature: '( int $key [, int $memsize [, int $perm = 0666 ]]): resource'
	},
	shm_detach: {
		description: 'Disconnects from shared memory segment',
		signature: '( resource $shm_identifier ): bool'
	},
	shm_get_var: {
		description: 'Returns a variable from shared memory',
		signature: '( resource $shm_identifier , int $variable_key ): mixed'
	},
	shm_has_var: {
		description: 'Check whether a specific entry exists',
		signature: '( resource $shm_identifier , int $variable_key ): bool'
	},
	shm_put_var: {
		description: 'Inserts or updates a variable in shared memory',
		signature: '( resource $shm_identifier , int $variable_key , mixed $variable ): bool'
	},
	shm_remove_var: {
		description: 'Removes a variable from shared memory',
		signature: '( resource $shm_identifier , int $variable_key ): bool'
	},
	shm_remove: {
		description: 'Removes shared memory from Unix systems',
		signature: '( resource $shm_identifier ): bool'
	},
	shmop_close: {
		description: 'Close shared memory block',
		signature: '( resource $shmid ): void'
	},
	shmop_delete: {
		description: 'Delete shared memory block',
		signature: '( resource $shmid ): bool'
	},
	shmop_open: {
		description: 'Create or open shared memory block',
		signature: '( int $key , string $flags , int $mode , int $size ): resource'
	},
	shmop_read: {
		description: 'Read data from shared memory block',
		signature: '( resource $shmid , int $start , int $count ): string'
	},
	shmop_size: {
		description: 'Get size of shared memory block',
		signature: '( resource $shmid ): int'
	},
	shmop_write: {
		description: 'Write data into shared memory block',
		signature: '( resource $shmid , string $data , int $offset ): int'
	},
	json_decode: {
		description: 'Decodes a JSON string',
		signature: '( string $json [, bool $assoc [, int $depth = 512 [, int $options = 0 ]]]): mixed'
	},
	json_encode: {
		description: 'Returns the JSON representation of a value',
		signature: '( mixed $value [, int $options = 0 [, int $depth = 512 ]]): string'
	},
	json_last_error_msg: {
		description: 'Returns the error string of the last json_encode() or json_decode() call',
		signature: '(void): string'
	},
	json_last_error: {
		description: 'Returns the last error occurred',
		signature: '(void): int'
	},
	connection_aborted: {
		description: 'Check whether client disconnected',
		signature: '(void): int'
	},
	connection_status: {
		description: 'Returns connection status bitfield',
		signature: '(void): int'
	},
	constant: {
		description: 'Returns the value of a constant',
		signature: '( string $name ): mixed'
	},
	define: {
		description: 'Defines a named constant',
		signature: '( string $name , mixed $value [, bool $case_insensitive ]): bool'
	},
	defined: {
		description: 'Checks whether a given named constant exists',
		signature: '( string $name ): bool'
	},
	die: {
		description: 'Equivalent to exit',
	},
	eval: {
		description: 'Evaluate a string as PHP code',
		signature: '( string $code ): mixed'
	},
	exit: {
		description: 'Output a message and terminate the current script',
		signature: '( int $status ): void'
	},
	get_browser: {
		description: 'Tells what the user\'s browser is capable of',
		signature: '([ string $user_agent [, bool $return_array ]]): mixed'
	},
	__halt_compiler: {
		description: 'Halts the compiler execution',
		signature: '(void): void'
	},
	highlight_file: {
		description: 'Syntax highlighting of a file',
		signature: '( string $filename [, bool $return ]): mixed'
	},
	highlight_string: {
		description: 'Syntax highlighting of a string',
		signature: '( string $str [, bool $return ]): mixed'
	},
	hrtime: {
		description: 'Get the system\'s high resolution time',
		signature: '([ bool $get_as_number ]): mixed'
	},
	ignore_user_abort: {
		description: 'Set whether a client disconnect should abort script execution',
		signature: '([ bool $value ]): int'
	},
	pack: {
		description: 'Pack data into binary string',
		signature: '( string $format [, mixed $... ]): string'
	},
	php_check_syntax: {
		description: 'Check the PHP syntax of (and execute) the specified file',
		signature: '( string $filename [, string $error_message ]): bool'
	},
	php_strip_whitespace: {
		description: 'Return source with stripped comments and whitespace',
		signature: '( string $filename ): string'
	},
	sapi_windows_cp_conv: {
		description: 'Convert string from one codepage to another',
		signature: '( int|string $in_codepage , int|string $out_codepage , string $subject ): string'
	},
	sapi_windows_cp_get: {
		description: 'Get process codepage',
		signature: '( string $kind ): int'
	},
	sapi_windows_cp_is_utf8: {
		description: 'Indicates whether the codepage is UTF-8 compatible',
		signature: '(void): bool'
	},
	sapi_windows_cp_set: {
		description: 'Set process codepage',
		signature: '( int $cp ): bool'
	},
	sapi_windows_vt100_support: {
		description: 'Get or set VT100 support for the specified stream associated to an output buffer of a Windows console.',
		signature: '( resource $stream [, bool $enable ]): bool'
	},
	show_source: {
		description: 'Alias of highlight_file',
	},
	sleep: {
		description: 'Delay execution',
		signature: '( int $seconds ): int'
	},
	sys_getloadavg: {
		description: 'Gets system load average',
		signature: '(void): array'
	},
	time_nanosleep: {
		description: 'Delay for a number of seconds and nanoseconds',
		signature: '( int $seconds , int $nanoseconds ): mixed'
	},
	time_sleep_until: {
		description: 'Make the script sleep until the specified time',
		signature: '( float $timestamp ): bool'
	},
	uniqid: {
		description: 'Generate a unique ID',
		signature: '([ string $prefix = "" [, bool $more_entropy ]]): string'
	},
	unpack: {
		description: 'Unpack data from binary string',
		signature: '( string $format , string $data [, int $offset = 0 ]): array'
	},
	usleep: {
		description: 'Delay execution in microseconds',
		signature: '( int $micro_seconds ): void'
	},
	class_implements: {
		description: 'Return the interfaces which are implemented by the given class or interface',
		signature: '( mixed $class [, bool $autoload ]): array'
	},
	class_parents: {
		description: 'Return the parent classes of the given class',
		signature: '( mixed $class [, bool $autoload ]): array'
	},
	class_uses: {
		description: 'Return the traits used by the given class',
		signature: '( mixed $class [, bool $autoload ]): array'
	},
	iterator_apply: {
		description: 'Call a function for every element in an iterator',
		signature: '( Traversable $iterator , callable $function [, array $args ]): int'
	},
	iterator_count: {
		description: 'Count the elements in an iterator',
		signature: '( Traversable $iterator ): int'
	},
	iterator_to_array: {
		description: 'Copy the iterator into an array',
		signature: '( Traversable $iterator [, bool $use_keys ]): array'
	},
	spl_autoload_call: {
		description: 'Try all registered __autoload() functions to load the requested class',
		signature: '( string $class_name ): void'
	},
	spl_autoload_extensions: {
		description: 'Register and return default file extensions for spl_autoload',
		signature: '([ string $file_extensions ]): string'
	},
	spl_autoload_functions: {
		description: 'Return all registered __autoload() functions',
		signature: '(void): array'
	},
	spl_autoload_register: {
		description: 'Register given function as __autoload() implementation',
		signature: '([ callable $autoload_function [, bool $throw [, bool $prepend ]]]): bool'
	},
	spl_autoload_unregister: {
		description: 'Unregister given function as __autoload() implementation',
		signature: '( mixed $autoload_function ): bool'
	},
	spl_autoload: {
		description: 'Default implementation for __autoload()',
		signature: '( string $class_name [, string $file_extensions = spl_autoload_extensions() ]): void'
	},
	spl_classes: {
		description: 'Return available SPL classes',
		signature: '(void): array'
	},
	spl_object_hash: {
		description: 'Return hash id for given object',
		signature: '( object $obj ): string'
	},
	spl_object_id: {
		description: 'Return the integer object handle for given object',
		signature: '( object $obj ): int'
	},
	set_socket_blocking: {
		description: 'Alias of stream_set_blocking',
	},
	stream_bucket_append: {
		description: 'Append bucket to brigade',
		signature: '( resource $brigade , object $bucket ): void'
	},
	stream_bucket_make_writeable: {
		description: 'Return a bucket object from the brigade for operating on',
		signature: '( resource $brigade ): object'
	},
	stream_bucket_new: {
		description: 'Create a new bucket for use on the current stream',
		signature: '( resource $stream , string $buffer ): object'
	},
	stream_bucket_prepend: {
		description: 'Prepend bucket to brigade',
		signature: '( resource $brigade , object $bucket ): void'
	},
	stream_context_create: {
		description: 'Creates a stream context',
		signature: '([ array $options [, array $params ]]): resource'
	},
	stream_context_get_default: {
		description: 'Retrieve the default stream context',
		signature: '([ array $options ]): resource'
	},
	stream_context_get_options: {
		description: 'Retrieve options for a stream/wrapper/context',
		signature: '( resource $stream_or_context ): array'
	},
	stream_context_get_params: {
		description: 'Retrieves parameters from a context',
		signature: '( resource $stream_or_context ): array'
	},
	stream_context_set_default: {
		description: 'Set the default stream context',
		signature: '( array $options ): resource'
	},
	stream_context_set_option: {
		description: 'Sets an option for a stream/wrapper/context',
		signature: '( resource $stream_or_context , string $wrapper , string $option , mixed $value , array $options ): bool'
	},
	stream_context_set_params: {
		description: 'Set parameters for a stream/wrapper/context',
		signature: '( resource $stream_or_context , array $params ): bool'
	},
	stream_copy_to_stream: {
		description: 'Copies data from one stream to another',
		signature: '( resource $source , resource $dest [, int $maxlength = -1 [, int $offset = 0 ]]): int'
	},
	stream_filter_append: {
		description: 'Attach a filter to a stream',
		signature: '( resource $stream , string $filtername [, int $read_write [, mixed $params ]]): resource'
	},
	stream_filter_prepend: {
		description: 'Attach a filter to a stream',
		signature: '( resource $stream , string $filtername [, int $read_write [, mixed $params ]]): resource'
	},
	stream_filter_register: {
		description: 'Register a user defined stream filter',
		signature: '( string $filtername , string $classname ): bool'
	},
	stream_filter_remove: {
		description: 'Remove a filter from a stream',
		signature: '( resource $stream_filter ): bool'
	},
	stream_get_contents: {
		description: 'Reads remainder of a stream into a string',
		signature: '( resource $handle [, int $maxlength = -1 [, int $offset = -1 ]]): string'
	},
	stream_get_filters: {
		description: 'Retrieve list of registered filters',
		signature: '(void): array'
	},
	stream_get_line: {
		description: 'Gets line from stream resource up to a given delimiter',
		signature: '( resource $handle , int $length [, string $ending ]): string'
	},
	stream_get_meta_data: {
		description: 'Retrieves header/meta data from streams/file pointers',
		signature: '( resource $stream ): array'
	},
	stream_get_transports: {
		description: 'Retrieve list of registered socket transports',
		signature: '(void): array'
	},
	stream_get_wrappers: {
		description: 'Retrieve list of registered streams',
		signature: '(void): array'
	},
	stream_is_local: {
		description: 'Checks if a stream is a local stream',
		signature: '( mixed $stream_or_url ): bool'
	},
	stream_isatty: {
		description: 'Check if a stream is a TTY',
		signature: '( resource $stream ): bool'
	},
	stream_notification_callback: {
		description: 'A callback function for the notification context parameter',
		signature: '( int $notification_code , int $severity , string $message , int $message_code , int $bytes_transferred , int $bytes_max ): callable'
	},
	stream_register_wrapper: {
		description: 'Alias of stream_wrapper_register',
	},
	stream_resolve_include_path: {
		description: 'Resolve filename against the include path',
		signature: '( string $filename ): string'
	},
	stream_select: {
		description: 'Runs the equivalent of the select() system call on the given   arrays of streams with a timeout specified by tv_sec and tv_usec',
		signature: '( array $read , array $write , array $except , int $tv_sec [, int $tv_usec = 0 ]): int'
	},
	stream_set_blocking: {
		description: 'Set blocking/non-blocking mode on a stream',
		signature: '( resource $stream , bool $mode ): bool'
	},
	stream_set_chunk_size: {
		description: 'Set the stream chunk size',
		signature: '( resource $fp , int $chunk_size ): int'
	},
	stream_set_read_buffer: {
		description: 'Set read file buffering on the given stream',
		signature: '( resource $stream , int $buffer ): int'
	},
	stream_set_timeout: {
		description: 'Set timeout period on a stream',
		signature: '( resource $stream , int $seconds [, int $microseconds = 0 ]): bool'
	},
	stream_set_write_buffer: {
		description: 'Sets write file buffering on the given stream',
		signature: '( resource $stream , int $buffer ): int'
	},
	stream_socket_accept: {
		description: 'Accept a connection on a socket created by stream_socket_server',
		signature: '( resource $server_socket [, float $timeout = ini_get("default_socket_timeout") [, string $peername ]]): resource'
	},
	stream_socket_client: {
		description: 'Open Internet or Unix domain socket connection',
		signature: '( string $remote_socket [, int $errno [, string $errstr [, float $timeout = ini_get("default_socket_timeout") [, int $flags = STREAM_CLIENT_CONNECT [, resource $context ]]]]]): resource'
	},
	stream_socket_enable_crypto: {
		description: 'Turns encryption on/off on an already connected socket',
		signature: '( resource $stream , bool $enable [, int $crypto_type [, resource $session_stream ]]): mixed'
	},
	stream_socket_get_name: {
		description: 'Retrieve the name of the local or remote sockets',
		signature: '( resource $handle , bool $want_peer ): string'
	},
	stream_socket_pair: {
		description: 'Creates a pair of connected, indistinguishable socket streams',
		signature: '( int $domain , int $type , int $protocol ): array'
	},
	stream_socket_recvfrom: {
		description: 'Receives data from a socket, connected or not',
		signature: '( resource $socket , int $length [, int $flags = 0 [, string $address ]]): string'
	},
	stream_socket_sendto: {
		description: 'Sends a message to a socket, whether it is connected or not',
		signature: '( resource $socket , string $data [, int $flags = 0 [, string $address ]]): int'
	},
	stream_socket_server: {
		description: 'Create an Internet or Unix domain server socket',
		signature: '( string $local_socket [, int $errno [, string $errstr [, int $flags = STREAM_SERVER_BIND | STREAM_SERVER_LISTEN [, resource $context ]]]]): resource'
	},
	stream_socket_shutdown: {
		description: 'Shutdown a full-duplex connection',
		signature: '( resource $stream , int $how ): bool'
	},
	stream_supports_lock: {
		description: 'Tells whether the stream supports locking',
		signature: '( resource $stream ): bool'
	},
	stream_wrapper_register: {
		description: 'Register a URL wrapper implemented as a PHP class',
		signature: '( string $protocol , string $classname [, int $flags = 0 ]): bool'
	},
	stream_wrapper_restore: {
		description: 'Restores a previously unregistered built-in wrapper',
		signature: '( string $protocol ): bool'
	},
	stream_wrapper_unregister: {
		description: 'Unregister a URL wrapper',
		signature: '( string $protocol ): bool'
	},
	token_get_all: {
		description: 'Split given source into PHP tokens',
		signature: '( string $source [, int $flags = 0 ]): array'
	},
	token_name: {
		description: 'Get the symbolic name of a given PHP token',
		signature: '( int $token ): string'
	},
	base64_decode: {
		description: 'Decodes data encoded with MIME base64',
		signature: '( string $data [, bool $strict ]): string'
	},
	base64_encode: {
		description: 'Encodes data with MIME base64',
		signature: '( string $data ): string'
	},
	get_headers: {
		description: 'Fetches all the headers sent by the server in response to an HTTP request',
		signature: '( string $url [, int $format = 0 [, resource $context ]]): array'
	},
	get_meta_tags: {
		description: 'Extracts all meta tag content attributes from a file and returns an array',
		signature: '( string $filename [, bool $use_include_path ]): array'
	},
	http_build_query: {
		description: 'Generate URL-encoded query string',
		signature: '( mixed $query_data [, string $numeric_prefix [, string $arg_separator [, int $enc_type ]]]): string'
	},
	parse_url: {
		description: 'Parse a URL and return its components',
		signature: '( string $url [, int $component = -1 ]): mixed'
	},
	rawurldecode: {
		description: 'Decode URL-encoded strings',
		signature: '( string $str ): string'
	},
	rawurlencode: {
		description: 'URL-encode according to RFC 3986',
		signature: '( string $str ): string'
	},
	urldecode: {
		description: 'Decodes URL-encoded string',
		signature: '( string $str ): string'
	},
	urlencode: {
		description: 'URL-encodes string',
		signature: '( string $str ): string'
	},
	curl_close: {
		description: 'Close a cURL session',
		signature: '( resource $ch ): void'
	},
	curl_copy_handle: {
		description: 'Copy a cURL handle along with all of its preferences',
		signature: '( resource $ch ): resource'
	},
	curl_errno: {
		description: 'Return the last error number',
		signature: '( resource $ch ): int'
	},
	curl_error: {
		description: 'Return a string containing the last error for the current session',
		signature: '( resource $ch ): string'
	},
	curl_escape: {
		description: 'URL encodes the given string',
		signature: '( resource $ch , string $str ): string'
	},
	curl_exec: {
		description: 'Perform a cURL session',
		signature: '( resource $ch ): mixed'
	},
	curl_file_create: {
		description: 'Create a CURLFile object',
		signature: '( string $filename [, string $mimetype [, string $postname ]]): CURLFile'
	},
	curl_getinfo: {
		description: 'Get information regarding a specific transfer',
		signature: '( resource $ch [, int $opt ]): mixed'
	},
	curl_init: {
		description: 'Initialize a cURL session',
		signature: '([ string $url ]): resource'
	},
	curl_multi_add_handle: {
		description: 'Add a normal cURL handle to a cURL multi handle',
		signature: '( resource $mh , resource $ch ): int'
	},
	curl_multi_close: {
		description: 'Close a set of cURL handles',
		signature: '( resource $mh ): void'
	},
	curl_multi_errno: {
		description: 'Return the last multi curl error number',
		signature: '( resource $mh ): int'
	},
	curl_multi_exec: {
		description: 'Run the sub-connections of the current cURL handle',
		signature: '( resource $mh , int $still_running ): int'
	},
	curl_multi_getcontent: {
		description: 'Return the content of a cURL handle if CURLOPT_RETURNTRANSFER is set',
		signature: '( resource $ch ): string'
	},
	curl_multi_info_read: {
		description: 'Get information about the current transfers',
		signature: '( resource $mh [, int $msgs_in_queue ]): array'
	},
	curl_multi_init: {
		description: 'Returns a new cURL multi handle',
		signature: '(void): resource'
	},
	curl_multi_remove_handle: {
		description: 'Remove a multi handle from a set of cURL handles',
		signature: '( resource $mh , resource $ch ): int'
	},
	curl_multi_select: {
		description: 'Wait for activity on any curl_multi connection',
		signature: '( resource $mh [, float $timeout = 1.0 ]): int'
	},
	curl_multi_setopt: {
		description: 'Set an option for the cURL multi handle',
		signature: '( resource $mh , int $option , mixed $value ): bool'
	},
	curl_multi_strerror: {
		description: 'Return string describing error code',
		signature: '( int $errornum ): string'
	},
	curl_pause: {
		description: 'Pause and unpause a connection',
		signature: '( resource $ch , int $bitmask ): int'
	},
	curl_reset: {
		description: 'Reset all options of a libcurl session handle',
		signature: '( resource $ch ): void'
	},
	curl_setopt_array: {
		description: 'Set multiple options for a cURL transfer',
		signature: '( resource $ch , array $options ): bool'
	},
	curl_setopt: {
		description: 'Set an option for a cURL transfer',
		signature: '( resource $ch , int $option , mixed $value ): bool'
	},
	curl_share_close: {
		description: 'Close a cURL share handle',
		signature: '( resource $sh ): void'
	},
	curl_share_errno: {
		description: 'Return the last share curl error number',
		signature: '( resource $sh ): int'
	},
	curl_share_init: {
		description: 'Initialize a cURL share handle',
		signature: '(void): resource'
	},
	curl_share_setopt: {
		description: 'Set an option for a cURL share handle',
		signature: '( resource $sh , int $option , string $value ): bool'
	},
	curl_share_strerror: {
		description: 'Return string describing the given error code',
		signature: '( int $errornum ): string'
	},
	curl_strerror: {
		description: 'Return string describing the given error code',
		signature: '( int $errornum ): string'
	},
	curl_unescape: {
		description: 'Decodes the given URL encoded string',
		signature: '( resource $ch , string $str ): string'
	},
	curl_version: {
		description: 'Gets cURL version information',
		signature: '([ int $age = CURLVERSION_NOW ]): array'
	},
	ftp_alloc: {
		description: 'Allocates space for a file to be uploaded',
		signature: '( resource $ftp_stream , int $filesize [, string $result ]): bool'
	},
	ftp_append: {
		description: 'Append the contents of a file to another file on the FTP server',
		signature: '( resource $ftp , string $remote_file , string $local_file [, int $mode ]): bool'
	},
	ftp_cdup: {
		description: 'Changes to the parent directory',
		signature: '( resource $ftp_stream ): bool'
	},
	ftp_chdir: {
		description: 'Changes the current directory on a FTP server',
		signature: '( resource $ftp_stream , string $directory ): bool'
	},
	ftp_chmod: {
		description: 'Set permissions on a file via FTP',
		signature: '( resource $ftp_stream , int $mode , string $filename ): int'
	},
	ftp_close: {
		description: 'Closes an FTP connection',
		signature: '( resource $ftp_stream ): resource'
	},
	ftp_connect: {
		description: 'Opens an FTP connection',
		signature: '( string $host [, int $port = 21 [, int $timeout = 90 ]]): resource'
	},
	ftp_delete: {
		description: 'Deletes a file on the FTP server',
		signature: '( resource $ftp_stream , string $path ): bool'
	},
	ftp_exec: {
		description: 'Requests execution of a command on the FTP server',
		signature: '( resource $ftp_stream , string $command ): bool'
	},
	ftp_fget: {
		description: 'Downloads a file from the FTP server and saves to an open file',
		signature: '( resource $ftp_stream , resource $handle , string $remote_file [, int $mode [, int $resumepos = 0 ]]): bool'
	},
	ftp_fput: {
		description: 'Uploads from an open file to the FTP server',
		signature: '( resource $ftp_stream , string $remote_file , resource $handle [, int $mode [, int $startpos = 0 ]]): bool'
	},
	ftp_get_option: {
		description: 'Retrieves various runtime behaviours of the current FTP stream',
		signature: '( resource $ftp_stream , int $option ): mixed'
	},
	ftp_get: {
		description: 'Downloads a file from the FTP server',
		signature: '( resource $ftp_stream , string $local_file , string $remote_file [, int $mode [, int $resumepos = 0 ]]): bool'
	},
	ftp_login: {
		description: 'Logs in to an FTP connection',
		signature: '( resource $ftp_stream , string $username , string $password ): bool'
	},
	ftp_mdtm: {
		description: 'Returns the last modified time of the given file',
		signature: '( resource $ftp_stream , string $remote_file ): int'
	},
	ftp_mkdir: {
		description: 'Creates a directory',
		signature: '( resource $ftp_stream , string $directory ): string'
	},
	ftp_mlsd: {
		description: 'Returns a list of files in the given directory',
		signature: '( resource $ftp_stream , string $directory ): array'
	},
	ftp_nb_continue: {
		description: 'Continues retrieving/sending a file (non-blocking)',
		signature: '( resource $ftp_stream ): int'
	},
	ftp_nb_fget: {
		description: 'Retrieves a file from the FTP server and writes it to an open file (non-blocking)',
		signature: '( resource $ftp_stream , resource $handle , string $remote_file [, int $mode [, int $resumepos = 0 ]]): int'
	},
	ftp_nb_fput: {
		description: 'Stores a file from an open file to the FTP server (non-blocking)',
		signature: '( resource $ftp_stream , string $remote_file , resource $handle [, int $mode [, int $startpos = 0 ]]): int'
	},
	ftp_nb_get: {
		description: 'Retrieves a file from the FTP server and writes it to a local file (non-blocking)',
		signature: '( resource $ftp_stream , string $local_file , string $remote_file [, int $mode [, int $resumepos = 0 ]]): int'
	},
	ftp_nb_put: {
		description: 'Stores a file on the FTP server (non-blocking)',
		signature: '( resource $ftp_stream , string $remote_file , string $local_file [, int $mode [, int $startpos = 0 ]]): int'
	},
	ftp_nlist: {
		description: 'Returns a list of files in the given directory',
		signature: '( resource $ftp_stream , string $directory ): array'
	},
	ftp_pasv: {
		description: 'Turns passive mode on or off',
		signature: '( resource $ftp_stream , bool $pasv ): bool'
	},
	ftp_put: {
		description: 'Uploads a file to the FTP server',
		signature: '( resource $ftp_stream , string $remote_file , string $local_file [, int $mode [, int $startpos = 0 ]]): bool'
	},
	ftp_pwd: {
		description: 'Returns the current directory name',
		signature: '( resource $ftp_stream ): string'
	},
	ftp_quit: {
		description: 'Alias of ftp_close',
	},
	ftp_raw: {
		description: 'Sends an arbitrary command to an FTP server',
		signature: '( resource $ftp_stream , string $command ): array'
	},
	ftp_rawlist: {
		description: 'Returns a detailed list of files in the given directory',
		signature: '( resource $ftp_stream , string $directory [, bool $recursive ]): array'
	},
	ftp_rename: {
		description: 'Renames a file or a directory on the FTP server',
		signature: '( resource $ftp_stream , string $oldname , string $newname ): bool'
	},
	ftp_rmdir: {
		description: 'Removes a directory',
		signature: '( resource $ftp_stream , string $directory ): bool'
	},
	ftp_set_option: {
		description: 'Set miscellaneous runtime FTP options',
		signature: '( resource $ftp_stream , int $option , mixed $value ): bool'
	},
	ftp_site: {
		description: 'Sends a SITE command to the server',
		signature: '( resource $ftp_stream , string $command ): bool'
	},
	ftp_size: {
		description: 'Returns the size of the given file',
		signature: '( resource $ftp_stream , string $remote_file ): int'
	},
	ftp_ssl_connect: {
		description: 'Opens a Secure SSL-FTP connection',
		signature: '( string $host [, int $port = 21 [, int $timeout = 90 ]]): resource'
	},
	ftp_systype: {
		description: 'Returns the system type identifier of the remote FTP server',
		signature: '( resource $ftp_stream ): string'
	},
	checkdnsrr: {
		description: 'Check DNS records corresponding to a given Internet host name or IP address',
		signature: '( string $host [, string $type = "MX" ]): bool'
	},
	closelog: {
		description: 'Close connection to system logger',
		signature: '(void): bool'
	},
	define_syslog_variables: {
		description: 'Initializes all syslog related variables',
		signature: '(void): void'
	},
	dns_check_record: {
		description: 'Alias of checkdnsrr',
	},
	dns_get_mx: {
		description: 'Alias of getmxrr',
	},
	dns_get_record: {
		description: 'Fetch DNS Resource Records associated with a hostname',
		signature: '( string $hostname [, int $type = DNS_ANY [, array $authns [, array $addtl [, bool $raw ]]]]): array'
	},
	fsockopen: {
		description: 'Open Internet or Unix domain socket connection',
		signature: '( string $hostname [, int $port = -1 [, int $errno [, string $errstr [, float $timeout = ini_get("default_socket_timeout") ]]]]): resource'
	},
	gethostbyaddr: {
		description: 'Get the Internet host name corresponding to a given IP address',
		signature: '( string $ip_address ): string'
	},
	gethostbyname: {
		description: 'Get the IPv4 address corresponding to a given Internet host name',
		signature: '( string $hostname ): string'
	},
	gethostbynamel: {
		description: 'Get a list of IPv4 addresses corresponding to a given Internet host   name',
		signature: '( string $hostname ): array'
	},
	gethostname: {
		description: 'Gets the host name',
		signature: '(void): string'
	},
	getmxrr: {
		description: 'Get MX records corresponding to a given Internet host name',
		signature: '( string $hostname , array $mxhosts [, array $weight ]): bool'
	},
	getprotobyname: {
		description: 'Get protocol number associated with protocol name',
		signature: '( string $name ): int'
	},
	getprotobynumber: {
		description: 'Get protocol name associated with protocol number',
		signature: '( int $number ): string'
	},
	getservbyname: {
		description: 'Get port number associated with an Internet service and protocol',
		signature: '( string $service , string $protocol ): int'
	},
	getservbyport: {
		description: 'Get Internet service which corresponds to port and protocol',
		signature: '( int $port , string $protocol ): string'
	},
	header_register_callback: {
		description: 'Call a header function',
		signature: '( callable $callback ): bool'
	},
	header_remove: {
		description: 'Remove previously set headers',
		signature: '([ string $name ]): void'
	},
	header: {
		description: 'Send a raw HTTP header',
		signature: '( string $header [, bool $replace [, int $http_response_code ]]): void'
	},
	headers_list: {
		description: 'Returns a list of response headers sent (or ready to send)',
		signature: '(void): array'
	},
	headers_sent: {
		description: 'Checks if or where headers have been sent',
		signature: '([ string $file [, int $line ]]): bool'
	},
	http_response_code: {
		description: 'Get or Set the HTTP response code',
		signature: '([ int $response_code ]): mixed'
	},
	inet_ntop: {
		description: 'Converts a packed internet address to a human readable representation',
		signature: '( string $in_addr ): string'
	},
	inet_pton: {
		description: 'Converts a human readable IP address to its packed in_addr representation',
		signature: '( string $address ): string'
	},
	ip2long: {
		description: 'Converts a string containing an (IPv4) Internet Protocol dotted address into a long integer',
		signature: '( string $ip_address ): int'
	},
	long2ip: {
		description: 'Converts an long integer address into a string in (IPv4) Internet standard dotted format',
		signature: '( int $proper_address ): string'
	},
	openlog: {
		description: 'Open connection to system logger',
		signature: '( string $ident , int $option , int $facility ): bool'
	},
	pfsockopen: {
		description: 'Open persistent Internet or Unix domain socket connection',
		signature: '( string $hostname [, int $port = -1 [, int $errno [, string $errstr [, float $timeout = ini_get("default_socket_timeout") ]]]]): resource'
	},
	setcookie: {
		description: 'Send a cookie',
		signature: '( string $name [, string $value = "" [, int $expires = 0 [, string $path = "" [, string $domain = "" [, bool $secure [, bool $httponly [, array $options = [] ]]]]]]]): bool'
	},
	setrawcookie: {
		description: 'Send a cookie without urlencoding the cookie value',
		signature: '( string $name [, string $value [, int $expires = 0 [, string $path [, string $domain [, bool $secure [, bool $httponly [, array $options = [] ]]]]]]]): bool'
	},
	socket_get_status: {
		description: 'Alias of stream_get_meta_data',
	},
	socket_set_blocking: {
		description: 'Alias of stream_set_blocking',
	},
	socket_set_timeout: {
		description: 'Alias of stream_set_timeout',
	},
	syslog: {
		description: 'Generate a system log message',
		signature: '( int $priority , string $message ): bool'
	},
	socket_accept: {
		description: 'Accepts a connection on a socket',
		signature: '( resource $socket ): resource'
	},
	socket_addrinfo_bind: {
		description: 'Create and bind to a socket from a given addrinfo',
		signature: '( resource $addr ): resource'
	},
	socket_addrinfo_connect: {
		description: 'Create and connect to a socket from a given addrinfo',
		signature: '( resource $addr ): resource'
	},
	socket_addrinfo_explain: {
		description: 'Get information about addrinfo',
		signature: '( resource $addr ): array'
	},
	socket_addrinfo_lookup: {
		description: 'Get array with contents of getaddrinfo about the given hostname',
		signature: '( string $host [, string $service [, array $hints ]]): array'
	},
	socket_bind: {
		description: 'Binds a name to a socket',
		signature: '( resource $socket , string $address [, int $port = 0 ]): bool'
	},
	socket_clear_error: {
		description: 'Clears the error on the socket or the last error code',
		signature: '([ resource $socket ]): void'
	},
	socket_close: {
		description: 'Closes a socket resource',
		signature: '( resource $socket ): void'
	},
	socket_cmsg_space: {
		description: 'Calculate message buffer size',
		signature: '( int $level , int $type [, int $n = 0 ]): int'
	},
	socket_connect: {
		description: 'Initiates a connection on a socket',
		signature: '( resource $socket , string $address [, int $port = 0 ]): bool'
	},
	socket_create_listen: {
		description: 'Opens a socket on port to accept connections',
		signature: '( int $port [, int $backlog = 128 ]): resource'
	},
	socket_create_pair: {
		description: 'Creates a pair of indistinguishable sockets and stores them in an array',
		signature: '( int $domain , int $type , int $protocol , array $fd ): bool'
	},
	socket_create: {
		description: 'Create a socket (endpoint for communication)',
		signature: '( int $domain , int $type , int $protocol ): resource'
	},
	socket_export_stream: {
		description: 'Export a socket extension resource into a stream that encapsulates a socket',
		signature: '( resource $socket ): resource'
	},
	socket_get_option: {
		description: 'Gets socket options for the socket',
		signature: '( resource $socket , int $level , int $optname ): mixed'
	},
	socket_getopt: {
		description: 'Alias of socket_get_option',
	},
	socket_getpeername: {
		description: 'Queries the remote side of the given socket which may either result in host/port or in a Unix filesystem path, dependent on its type',
		signature: '( resource $socket , string $address [, int $port ]): bool'
	},
	socket_getsockname: {
		description: 'Queries the local side of the given socket which may either result in host/port or in a Unix filesystem path, dependent on its type',
		signature: '( resource $socket , string $addr [, int $port ]): bool'
	},
	socket_import_stream: {
		description: 'Import a stream',
		signature: '( resource $stream ): resource'
	},
	socket_last_error: {
		description: 'Returns the last error on the socket',
		signature: '([ resource $socket ]): int'
	},
	socket_listen: {
		description: 'Listens for a connection on a socket',
		signature: '( resource $socket [, int $backlog = 0 ]): bool'
	},
	socket_read: {
		description: 'Reads a maximum of length bytes from a socket',
		signature: '( resource $socket , int $length [, int $type = PHP_BINARY_READ ]): string'
	},
	socket_recv: {
		description: 'Receives data from a connected socket',
		signature: '( resource $socket , string $buf , int $len , int $flags ): int'
	},
	socket_recvfrom: {
		description: 'Receives data from a socket whether or not it is connection-oriented',
		signature: '( resource $socket , string $buf , int $len , int $flags , string $name [, int $port ]): int'
	},
	socket_recvmsg: {
		description: 'Read a message',
		signature: '( resource $socket , array $message [, int $flags = 0 ]): int'
	},
	socket_select: {
		description: 'Runs the select() system call on the given arrays of sockets with a specified timeout',
		signature: '( array $read , array $write , array $except , int $tv_sec [, int $tv_usec = 0 ]): int'
	},
	socket_send: {
		description: 'Sends data to a connected socket',
		signature: '( resource $socket , string $buf , int $len , int $flags ): int'
	},
	socket_sendmsg: {
		description: 'Send a message',
		signature: '( resource $socket , array $message [, int $flags = 0 ]): int'
	},
	socket_sendto: {
		description: 'Sends a message to a socket, whether it is connected or not',
		signature: '( resource $socket , string $buf , int $len , int $flags , string $addr [, int $port = 0 ]): int'
	},
	socket_set_block: {
		description: 'Sets blocking mode on a socket resource',
		signature: '( resource $socket ): bool'
	},
	socket_set_nonblock: {
		description: 'Sets nonblocking mode for file descriptor fd',
		signature: '( resource $socket ): bool'
	},
	socket_set_option: {
		description: 'Sets socket options for the socket',
		signature: '( resource $socket , int $level , int $optname , mixed $optval ): bool'
	},
	socket_setopt: {
		description: 'Alias of socket_set_option',
	},
	socket_shutdown: {
		description: 'Shuts down a socket for receiving, sending, or both',
		signature: '( resource $socket [, int $how = 2 ]): bool'
	},
	socket_strerror: {
		description: 'Return a string describing a socket error',
		signature: '( int $errno ): string'
	},
	socket_write: {
		description: 'Write to a socket',
		signature: '( resource $socket , string $buffer [, int $length = 0 ]): int'
	},
	apache_child_terminate: {
		description: 'Terminate apache process after this request',
		signature: '(void): bool'
	},
	apache_get_modules: {
		description: 'Get a list of loaded Apache modules',
		signature: '(void): array'
	},
	apache_get_version: {
		description: 'Fetch Apache version',
		signature: '(void): string'
	},
	apache_getenv: {
		description: 'Get an Apache subprocess_env variable',
		signature: '( string $variable [, bool $walk_to_top ]): string'
	},
	apache_lookup_uri: {
		description: 'Perform a partial request for the specified URI and return all info about it',
		signature: '( string $filename ): object'
	},
	apache_note: {
		description: 'Get and set apache request notes',
		signature: '( string $note_name [, string $note_value = "" ]): string'
	},
	apache_request_headers: {
		description: 'Fetch all HTTP request headers',
		signature: '(void): array'
	},
	apache_reset_timeout: {
		description: 'Reset the Apache write timer',
		signature: '(void): bool'
	},
	apache_response_headers: {
		description: 'Fetch all HTTP response headers',
		signature: '(void): array'
	},
	apache_setenv: {
		description: 'Set an Apache subprocess_env variable',
		signature: '( string $variable , string $value [, bool $walk_to_top ]): bool'
	},
	getallheaders: {
		description: 'Fetch all HTTP request headers',
		signature: '(void): array'
	},
	virtual: {
		description: 'Perform an Apache sub-request',
		signature: '( string $filename ): bool'
	},
	nsapi_request_headers: {
		description: 'Fetch all HTTP request headers',
		signature: '(void): array'
	},
	nsapi_response_headers: {
		description: 'Fetch all HTTP response headers',
		signature: '(void): array'
	},
	nsapi_virtual: {
		description: 'Perform an NSAPI sub-request',
		signature: '( string $uri ): bool'
	},
	session_abort: {
		description: 'Discard session array changes and finish session',
		signature: '(void): bool'
	},
	session_cache_expire: {
		description: 'Return current cache expire',
		signature: '([ string $new_cache_expire ]): int'
	},
	session_cache_limiter: {
		description: 'Get and/or set the current cache limiter',
		signature: '([ string $cache_limiter ]): string'
	},
	session_commit: {
		description: 'Alias of session_write_close',
	},
	session_create_id: {
		description: 'Create new session id',
		signature: '([ string $prefix ]): string'
	},
	session_decode: {
		description: 'Decodes session data from a session encoded string',
		signature: '( string $data ): bool'
	},
	session_destroy: {
		description: 'Destroys all data registered to a session',
		signature: '(void): bool'
	},
	session_encode: {
		description: 'Encodes the current session data as a session encoded string',
		signature: '(void): string'
	},
	session_gc: {
		description: 'Perform session data garbage collection',
		signature: '(void): int'
	},
	session_get_cookie_params: {
		description: 'Get the session cookie parameters',
		signature: '(void): array'
	},
	session_id: {
		description: 'Get and/or set the current session id',
		signature: '([ string $id ]): string'
	},
	session_is_registered: {
		description: 'Find out whether a global variable is registered in a session',
		signature: '( string $name ): bool'
	},
	session_module_name: {
		description: 'Get and/or set the current session module',
		signature: '([ string $module ]): string'
	},
	session_name: {
		description: 'Get and/or set the current session name',
		signature: '([ string $name ]): string'
	},
	session_regenerate_id: {
		description: 'Update the current session id with a newly generated one',
		signature: '([ bool $delete_old_session ]): bool'
	},
	session_register_shutdown: {
		description: 'Session shutdown function',
		signature: '(void): void'
	},
	session_register: {
		description: 'Register one or more global variables with the current session',
		signature: '( mixed $name [, mixed $... ]): bool'
	},
	session_reset: {
		description: 'Re-initialize session array with original values',
		signature: '(void): bool'
	},
	session_save_path: {
		description: 'Get and/or set the current session save path',
		signature: '([ string $path ]): string'
	},
	session_set_cookie_params: {
		description: 'Set the session cookie parameters',
		signature: '( int $lifetime [, string $path [, string $domain [, bool $secure [, bool $httponly , array $options ]]]]): bool'
	},
	session_set_save_handler: {
		description: 'Sets user-level session storage functions',
		signature: '( callable $open , callable $close , callable $read , callable $write , callable $destroy , callable $gc [, callable $create_sid [, callable $validate_sid [, callable $update_timestamp , object $sessionhandler [, bool $register_shutdown ]]]]): bool'
	},
	session_start: {
		description: 'Start new or resume existing session',
		signature: '([ array $options = array() ]): bool'
	},
	session_status: {
		description: 'Returns the current session status',
		signature: '(void): int'
	},
	session_unregister: {
		description: 'Unregister a global variable from the current session',
		signature: '( string $name ): bool'
	},
	session_unset: {
		description: 'Free all session variables',
		signature: '(void): bool'
	},
	session_write_close: {
		description: 'Write session data and end session',
		signature: '(void): bool'
	},
	preg_filter: {
		description: 'Perform a regular expression search and replace',
		signature: '( mixed $pattern , mixed $replacement , mixed $subject [, int $limit = -1 [, int $count ]]): mixed'
	},
	preg_grep: {
		description: 'Return array entries that match the pattern',
		signature: '( string $pattern , array $input [, int $flags = 0 ]): array'
	},
	preg_last_error: {
		description: 'Returns the error code of the last PCRE regex execution',
		signature: '(void): int'
	},
	preg_match_all: {
		description: 'Perform a global regular expression match',
		signature: '( string $pattern , string $subject [, array $matches [, int $flags [, int $offset = 0 ]]]): int'
	},
	preg_match: {
		description: 'Perform a regular expression match',
		signature: '( string $pattern , string $subject [, array $matches [, int $flags = 0 [, int $offset = 0 ]]]): int'
	},
	preg_quote: {
		description: 'Quote regular expression characters',
		signature: '( string $str [, string $delimiter ]): string'
	},
	preg_replace_callback_array: {
		description: 'Perform a regular expression search and replace using callbacks',
		signature: '( array $patterns_and_callbacks , mixed $subject [, int $limit = -1 [, int $count ]]): mixed'
	},
	preg_replace_callback: {
		description: 'Perform a regular expression search and replace using a callback',
		signature: '( mixed $pattern , callable $callback , mixed $subject [, int $limit = -1 [, int $count ]]): mixed'
	},
	preg_replace: {
		description: 'Perform a regular expression search and replace',
		signature: '( mixed $pattern , mixed $replacement , mixed $subject [, int $limit = -1 [, int $count ]]): mixed'
	},
	preg_split: {
		description: 'Split string by a regular expression',
		signature: '( string $pattern , string $subject [, int $limit = -1 [, int $flags = 0 ]]): array'
	},
	addcslashes: {
		description: 'Quote string with slashes in a C style',
		signature: '( string $str , string $charlist ): string'
	},
	addslashes: {
		description: 'Quote string with slashes',
		signature: '( string $str ): string'
	},
	bin2hex: {
		description: 'Convert binary data into hexadecimal representation',
		signature: '( string $str ): string'
	},
	chop: {
		description: 'Alias of rtrim',
	},
	chr: {
		description: 'Generate a single-byte string from a number',
		signature: '( int $bytevalue ): string'
	},
	chunk_split: {
		description: 'Split a string into smaller chunks',
		signature: '( string $body [, int $chunklen = 76 [, string $end = "\r\n" ]]): string'
	},
	convert_cyr_string: {
		description: 'Convert from one Cyrillic character set to another',
		signature: '( string $str , string $from , string $to ): string'
	},
	convert_uudecode: {
		description: 'Decode a uuencoded string',
		signature: '( string $data ): string'
	},
	convert_uuencode: {
		description: 'Uuencode a string',
		signature: '( string $data ): string'
	},
	count_chars: {
		description: 'Return information about characters used in a string',
		signature: '( string $string [, int $mode = 0 ]): mixed'
	},
	crc32: {
		description: 'Calculates the crc32 polynomial of a string',
		signature: '( string $str ): int'
	},
	crypt: {
		description: 'One-way string hashing',
		signature: '( string $str [, string $salt ]): string'
	},
	echo: {
		description: 'Output one or more strings',
		signature: '( string $arg1 [, string $... ]): void'
	},
	explode: {
		description: 'Split a string by a string',
		signature: '( string $delimiter , string $string [, int $limit = PHP_INT_MAX ]): array'
	},
	fprintf: {
		description: 'Write a formatted string to a stream',
		signature: '( resource $handle , string $format [, mixed $... ]): int'
	},
	get_html_translation_table: {
		description: 'Returns the translation table used by htmlspecialchars and htmlentities',
		signature: '([ int $table = HTML_SPECIALCHARS [, int $flags = ENT_COMPAT | ENT_HTML401 [, string $encoding = "UTF-8" ]]]): array'
	},
	hebrev: {
		description: 'Convert logical Hebrew text to visual text',
		signature: '( string $hebrew_text [, int $max_chars_per_line = 0 ]): string'
	},
	hebrevc: {
		description: 'Convert logical Hebrew text to visual text with newline conversion',
		signature: '( string $hebrew_text [, int $max_chars_per_line = 0 ]): string'
	},
	hex2bin: {
		description: 'Decodes a hexadecimally encoded binary string',
		signature: '( string $data ): string'
	},
	html_entity_decode: {
		description: 'Convert HTML entities to their corresponding characters',
		signature: '( string $string [, int $flags = ENT_COMPAT | ENT_HTML401 [, string $encoding = ini_get("default_charset") ]]): string'
	},
	htmlentities: {
		description: 'Convert all applicable characters to HTML entities',
		signature: '( string $string [, int $flags = ENT_COMPAT | ENT_HTML401 [, string $encoding = ini_get("default_charset") [, bool $double_encode ]]]): string'
	},
	htmlspecialchars_decode: {
		description: 'Convert special HTML entities back to characters',
		signature: '( string $string [, int $flags = ENT_COMPAT | ENT_HTML401 ]): string'
	},
	htmlspecialchars: {
		description: 'Convert special characters to HTML entities',
		signature: '( string $string [, int $flags = ENT_COMPAT | ENT_HTML401 [, string $encoding = ini_get("default_charset") [, bool $double_encode ]]]): string'
	},
	implode: {
		description: 'Join array elements with a string',
		signature: '( string $glue , array $pieces ): string'
	},
	join: {
		description: 'Alias of implode',
	},
	lcfirst: {
		description: 'Make a string\'s first character lowercase',
		signature: '( string $str ): string'
	},
	levenshtein: {
		description: 'Calculate Levenshtein distance between two strings',
		signature: '( string $str1 , string $str2 , int $cost_ins , int $cost_rep , int $cost_del ): int'
	},
	localeconv: {
		description: 'Get numeric formatting information',
		signature: '(void): array'
	},
	ltrim: {
		description: 'Strip whitespace (or other characters) from the beginning of a string',
		signature: '( string $str [, string $character_mask ]): string'
	},
	md5_file: {
		description: 'Calculates the md5 hash of a given file',
		signature: '( string $filename [, bool $raw_output ]): string'
	},
	md5: {
		description: 'Calculate the md5 hash of a string',
		signature: '( string $str [, bool $raw_output ]): string'
	},
	metaphone: {
		description: 'Calculate the metaphone key of a string',
		signature: '( string $str [, int $phonemes = 0 ]): string'
	},
	money_format: {
		description: 'Formats a number as a currency string',
		signature: '( string $format , float $number ): string'
	},
	nl_langinfo: {
		description: 'Query language and locale information',
		signature: '( int $item ): string'
	},
	nl2br: {
		description: 'Inserts HTML line breaks before all newlines in a string',
		signature: '( string $string [, bool $is_xhtml ]): string'
	},
	number_format: {
		description: 'Format a number with grouped thousands',
		signature: '( float $number , int $decimals = 0 , string $dec_point = "." , string $thousands_sep = "," ): string'
	},
	ord: {
		description: 'Convert the first byte of a string to a value between 0 and 255',
		signature: '( string $string ): int'
	},
	parse_str: {
		description: 'Parses the string into variables',
		signature: '( string $encoded_string [, array $result ]): void'
	},
	print: {
		description: 'Output a string',
		signature: '( string $arg ): int'
	},
	printf: {
		description: 'Output a formatted string',
		signature: '( string $format [, mixed $... ]): int'
	},
	quoted_printable_decode: {
		description: 'Convert a quoted-printable string to an 8 bit string',
		signature: '( string $str ): string'
	},
	quoted_printable_encode: {
		description: 'Convert a 8 bit string to a quoted-printable string',
		signature: '( string $str ): string'
	},
	quotemeta: {
		description: 'Quote meta characters',
		signature: '( string $str ): string'
	},
	rtrim: {
		description: 'Strip whitespace (or other characters) from the end of a string',
		signature: '( string $str [, string $character_mask ]): string'
	},
	setlocale: {
		description: 'Set locale information',
		signature: '( int $category , array $locale [, string $... ]): string'
	},
	sha1_file: {
		description: 'Calculate the sha1 hash of a file',
		signature: '( string $filename [, bool $raw_output ]): string'
	},
	sha1: {
		description: 'Calculate the sha1 hash of a string',
		signature: '( string $str [, bool $raw_output ]): string'
	},
	similar_text: {
		description: 'Calculate the similarity between two strings',
		signature: '( string $first , string $second [, float $percent ]): int'
	},
	soundex: {
		description: 'Calculate the soundex key of a string',
		signature: '( string $str ): string'
	},
	sprintf: {
		description: 'Return a formatted string',
		signature: '( string $format [, mixed $... ]): string'
	},
	sscanf: {
		description: 'Parses input from a string according to a format',
		signature: '( string $str , string $format [, mixed $... ]): mixed'
	},
	str_getcsv: {
		description: 'Parse a CSV string into an array',
		signature: '( string $input [, string $delimiter = "," [, string $enclosure = \'"\' [, string $escape = "\\" ]]]): array'
	},
	str_ireplace: {
		description: 'Case-insensitive version of str_replace',
		signature: '( mixed $search , mixed $replace , mixed $subject [, int $count ]): mixed'
	},
	str_pad: {
		description: 'Pad a string to a certain length with another string',
		signature: '( string $input , int $pad_length [, string $pad_string = " " [, int $pad_type = STR_PAD_RIGHT ]]): string'
	},
	str_repeat: {
		description: 'Repeat a string',
		signature: '( string $input , int $multiplier ): string'
	},
	str_replace: {
		description: 'Replace all occurrences of the search string with the replacement string',
		signature: '( mixed $search , mixed $replace , mixed $subject [, int $count ]): mixed'
	},
	str_rot13: {
		description: 'Perform the rot13 transform on a string',
		signature: '( string $str ): string'
	},
	str_shuffle: {
		description: 'Randomly shuffles a string',
		signature: '( string $str ): string'
	},
	str_split: {
		description: 'Convert a string to an array',
		signature: '( string $string [, int $split_length = 1 ]): array'
	},
	str_word_count: {
		description: 'Return information about words used in a string',
		signature: '( string $string [, int $format = 0 [, string $charlist ]]): mixed'
	},
	strcasecmp: {
		description: 'Binary safe case-insensitive string comparison',
		signature: '( string $str1 , string $str2 ): int'
	},
	strchr: {
		description: 'Alias of strstr',
	},
	strcmp: {
		description: 'Binary safe string comparison',
		signature: '( string $str1 , string $str2 ): int'
	},
	strcoll: {
		description: 'Locale based string comparison',
		signature: '( string $str1 , string $str2 ): int'
	},
	strcspn: {
		description: 'Find length of initial segment not matching mask',
		signature: '( string $subject , string $mask [, int $start [, int $length ]]): int'
	},
	strip_tags: {
		description: 'Strip HTML and PHP tags from a string',
		signature: '( string $str [, string $allowable_tags ]): string'
	},
	stripcslashes: {
		description: 'Un-quote string quoted with addcslashes',
		signature: '( string $str ): string'
	},
	stripos: {
		description: 'Find the position of the first occurrence of a case-insensitive substring in a string',
		signature: '( string $haystack , mixed $needle [, int $offset = 0 ]): int'
	},
	stripslashes: {
		description: 'Un-quotes a quoted string',
		signature: '( string $str ): string'
	},
	stristr: {
		description: 'Case-insensitive strstr',
		signature: '( string $haystack , mixed $needle [, bool $before_needle ]): string'
	},
	strlen: {
		description: 'Get string length',
		signature: '( string $string ): int'
	},
	strnatcasecmp: {
		description: 'Case insensitive string comparisons using a "natural order" algorithm',
		signature: '( string $str1 , string $str2 ): int'
	},
	strnatcmp: {
		description: 'String comparisons using a "natural order" algorithm',
		signature: '( string $str1 , string $str2 ): int'
	},
	strncasecmp: {
		description: 'Binary safe case-insensitive string comparison of the first n characters',
		signature: '( string $str1 , string $str2 , int $len ): int'
	},
	strncmp: {
		description: 'Binary safe string comparison of the first n characters',
		signature: '( string $str1 , string $str2 , int $len ): int'
	},
	strpbrk: {
		description: 'Search a string for any of a set of characters',
		signature: '( string $haystack , string $char_list ): string'
	},
	strpos: {
		description: 'Find the position of the first occurrence of a substring in a string',
		signature: '( string $haystack , mixed $needle [, int $offset = 0 ]): int'
	},
	strrchr: {
		description: 'Find the last occurrence of a character in a string',
		signature: '( string $haystack , mixed $needle ): string'
	},
	strrev: {
		description: 'Reverse a string',
		signature: '( string $string ): string'
	},
	strripos: {
		description: 'Find the position of the last occurrence of a case-insensitive substring in a string',
		signature: '( string $haystack , mixed $needle [, int $offset = 0 ]): int'
	},
	strrpos: {
		description: 'Find the position of the last occurrence of a substring in a string',
		signature: '( string $haystack , mixed $needle [, int $offset = 0 ]): int'
	},
	strspn: {
		description: 'Finds the length of the initial segment of a string consisting   entirely of characters contained within a given mask',
		signature: '( string $subject , string $mask [, int $start [, int $length ]]): int'
	},
	strstr: {
		description: 'Find the first occurrence of a string',
		signature: '( string $haystack , mixed $needle [, bool $before_needle ]): string'
	},
	strtok: {
		description: 'Tokenize string',
		signature: '( string $str , string $token ): string'
	},
	strtolower: {
		description: 'Make a string lowercase',
		signature: '( string $string ): string'
	},
	strtoupper: {
		description: 'Make a string uppercase',
		signature: '( string $string ): string'
	},
	strtr: {
		description: 'Translate characters or replace substrings',
		signature: '( string $str , string $from , string $to , array $replace_pairs ): string'
	},
	substr_compare: {
		description: 'Binary safe comparison of two strings from an offset, up to length characters',
		signature: '( string $main_str , string $str , int $offset [, int $length [, bool $case_insensitivity ]]): int'
	},
	substr_count: {
		description: 'Count the number of substring occurrences',
		signature: '( string $haystack , string $needle [, int $offset = 0 [, int $length ]]): int'
	},
	substr_replace: {
		description: 'Replace text within a portion of a string',
		signature: '( mixed $string , mixed $replacement , mixed $start [, mixed $length ]): mixed'
	},
	substr: {
		description: 'Return part of a string',
		signature: '( string $string , int $start [, int $length ]): string'
	},
	trim: {
		description: 'Strip whitespace (or other characters) from the beginning and end of a string',
		signature: '( string $str [, string $character_mask = " \t\n\r\0\x0B" ]): string'
	},
	ucfirst: {
		description: 'Make a string\'s first character uppercase',
		signature: '( string $str ): string'
	},
	ucwords: {
		description: 'Uppercase the first character of each word in a string',
		signature: '( string $str [, string $delimiters = " \t\r\n\f\v" ]): string'
	},
	vfprintf: {
		description: 'Write a formatted string to a stream',
		signature: '( resource $handle , string $format , array $args ): int'
	},
	vprintf: {
		description: 'Output a formatted string',
		signature: '( string $format , array $args ): int'
	},
	vsprintf: {
		description: 'Return a formatted string',
		signature: '( string $format , array $args ): string'
	},
	wordwrap: {
		description: 'Wraps a string to a given number of characters',
		signature: '( string $str [, int $width = 75 [, string $break = "\n" [, bool $cut ]]]): string'
	},
	array_change_key_case: {
		description: 'Changes the case of all keys in an array',
		signature: '( array $array [, int $case = CASE_LOWER ]): array'
	},
	array_chunk: {
		description: 'Split an array into chunks',
		signature: '( array $array , int $size [, bool $preserve_keys ]): array'
	},
	array_column: {
		description: 'Return the values from a single column in the input array',
		signature: '( array $input , mixed $column_key [, mixed $index_key ]): array'
	},
	array_combine: {
		description: 'Creates an array by using one array for keys and another for its values',
		signature: '( array $keys , array $values ): array'
	},
	array_count_values: {
		description: 'Counts all the values of an array',
		signature: '( array $array ): array'
	},
	array_diff_assoc: {
		description: 'Computes the difference of arrays with additional index check',
		signature: '( array $array1 , array $array2 [, array $... ]): array'
	},
	array_diff_key: {
		description: 'Computes the difference of arrays using keys for comparison',
		signature: '( array $array1 , array $array2 [, array $... ]): array'
	},
	array_diff_uassoc: {
		description: 'Computes the difference of arrays with additional index check which is performed by a user supplied callback function',
		signature: '( array $array1 , array $array2 [, array $... , callable $key_compare_func ]): array'
	},
	array_diff_ukey: {
		description: 'Computes the difference of arrays using a callback function on the keys for comparison',
		signature: '( array $array1 , array $array2 [, array $... , callable $key_compare_func ]): array'
	},
	array_diff: {
		description: 'Computes the difference of arrays',
		signature: '( array $array1 , array $array2 [, array $... ]): array'
	},
	array_fill_keys: {
		description: 'Fill an array with values, specifying keys',
		signature: '( array $keys , mixed $value ): array'
	},
	array_fill: {
		description: 'Fill an array with values',
		signature: '( int $start_index , int $num , mixed $value ): array'
	},
	array_filter: {
		description: 'Filters elements of an array using a callback function',
		signature: '( array $array [, callable $callback [, int $flag = 0 ]]): array'
	},
	array_flip: {
		description: 'Exchanges all keys with their associated values in an array',
		signature: '( array $array ): string'
	},
	array_intersect_assoc: {
		description: 'Computes the intersection of arrays with additional index check',
		signature: '( array $array1 , array $array2 [, array $... ]): array'
	},
	array_intersect_key: {
		description: 'Computes the intersection of arrays using keys for comparison',
		signature: '( array $array1 , array $array2 [, array $... ]): array'
	},
	array_intersect_uassoc: {
		description: 'Computes the intersection of arrays with additional index check, compares indexes by a callback function',
		signature: '( array $array1 , array $array2 [, array $... , callable $key_compare_func ]): array'
	},
	array_intersect_ukey: {
		description: 'Computes the intersection of arrays using a callback function on the keys for comparison',
		signature: '( array $array1 , array $array2 [, array $... , callable $key_compare_func ]): array'
	},
	array_intersect: {
		description: 'Computes the intersection of arrays',
		signature: '( array $array1 , array $array2 [, array $... ]): array'
	},
	array_key_exists: {
		description: 'Checks if the given key or index exists in the array',
		signature: '( mixed $key , array $array ): bool'
	},
	array_key_first: {
		description: 'Gets the first key of an array',
		signature: '( array $array ): mixed'
	},
	array_key_last: {
		description: 'Gets the last key of an array',
		signature: '( array $array ): mixed'
	},
	array_keys: {
		description: 'Return all the keys or a subset of the keys of an array',
		signature: '( array $array , mixed $search_value [, bool $strict ]): array'
	},
	array_map: {
		description: 'Applies the callback to the elements of the given arrays',
		signature: '( callable $callback , array $array1 [, array $... ]): array'
	},
	array_merge_recursive: {
		description: 'Merge one or more arrays recursively',
		signature: '( array $array1 [, array $... ]): array'
	},
	array_merge: {
		description: 'Merge one or more arrays',
		signature: '( array $array1 [, array $... ]): array'
	},
	array_multisort: {
		description: 'Sort multiple or multi-dimensional arrays',
		signature: '( array $array1 [, mixed $array1_sort_order = SORT_ASC [, mixed $array1_sort_flags = SORT_REGULAR [, mixed $... ]]]): string'
	},
	array_pad: {
		description: 'Pad array to the specified length with a value',
		signature: '( array $array , int $size , mixed $value ): array'
	},
	array_pop: {
		description: 'Pop the element off the end of array',
		signature: '( array $array ): array'
	},
	array_product: {
		description: 'Calculate the product of values in an array',
		signature: '( array $array ): number'
	},
	array_push: {
		description: 'Push one or more elements onto the end of array',
		signature: '( array $array [, mixed $... ]): int'
	},
	array_rand: {
		description: 'Pick one or more random keys out of an array',
		signature: '( array $array [, int $num = 1 ]): mixed'
	},
	array_reduce: {
		description: 'Iteratively reduce the array to a single value using a callback function',
		signature: '( array $array , callable $callback [, mixed $initial ]): mixed'
	},
	array_replace_recursive: {
		description: 'Replaces elements from passed arrays into the first array recursively',
		signature: '( array $array1 [, array $... ]): array'
	},
	array_replace: {
		description: 'Replaces elements from passed arrays into the first array',
		signature: '( array $array1 [, array $... ]): array'
	},
	array_reverse: {
		description: 'Return an array with elements in reverse order',
		signature: '( array $array [, bool $preserve_keys ]): array'
	},
	array_search: {
		description: 'Searches the array for a given value and returns the first corresponding key if successful',
		signature: '( mixed $needle , array $haystack [, bool $strict ]): mixed'
	},
	array_shift: {
		description: 'Shift an element off the beginning of array',
		signature: '( array $array ): array'
	},
	array_slice: {
		description: 'Extract a slice of the array',
		signature: '( array $array , int $offset [, int $length [, bool $preserve_keys ]]): array'
	},
	array_splice: {
		description: 'Remove a portion of the array and replace it with something else',
		signature: '( array $input , int $offset [, int $length = count($input) [, mixed $replacement = array() ]]): array'
	},
	array_sum: {
		description: 'Calculate the sum of values in an array',
		signature: '( array $array ): number'
	},
	array_udiff_assoc: {
		description: 'Computes the difference of arrays with additional index check, compares data by a callback function',
		signature: '( array $array1 , array $array2 [, array $... , callable $value_compare_func ]): array'
	},
	array_udiff_uassoc: {
		description: 'Computes the difference of arrays with additional index check, compares data and indexes by a callback function',
		signature: '( array $array1 , array $array2 [, array $... , callable $value_compare_func , callable $key_compare_func ]): array'
	},
	array_udiff: {
		description: 'Computes the difference of arrays by using a callback function for data comparison',
		signature: '( array $array1 , array $array2 [, array $... , callable $value_compare_func ]): array'
	},
	array_uintersect_assoc: {
		description: 'Computes the intersection of arrays with additional index check, compares data by a callback function',
		signature: '( array $array1 , array $array2 [, array $... , callable $value_compare_func ]): array'
	},
	array_uintersect_uassoc: {
		description: 'Computes the intersection of arrays with additional index check, compares data and indexes by separate callback functions',
		signature: '( array $array1 , array $array2 [, array $... , callable $value_compare_func , callable $key_compare_func ]): array'
	},
	array_uintersect: {
		description: 'Computes the intersection of arrays, compares data by a callback function',
		signature: '( array $array1 , array $array2 [, array $... , callable $value_compare_func ]): array'
	},
	array_unique: {
		description: 'Removes duplicate values from an array',
		signature: '( array $array [, int $sort_flags = SORT_STRING ]): array'
	},
	array_unshift: {
		description: 'Prepend one or more elements to the beginning of an array',
		signature: '( array $array [, mixed $... ]): int'
	},
	array_values: {
		description: 'Return all the values of an array',
		signature: '( array $array ): array'
	},
	array_walk_recursive: {
		description: 'Apply a user function recursively to every member of an array',
		signature: '( array $array , callable $callback [, mixed $userdata ]): bool'
	},
	array_walk: {
		description: 'Apply a user supplied function to every member of an array',
		signature: '( array $array , callable $callback [, mixed $userdata ]): bool'
	},
	array: {
		description: 'Create an array',
		signature: '([ mixed $... ]): array'
	},
	arsort: {
		description: 'Sort an array in reverse order and maintain index association',
		signature: '( array $array [, int $sort_flags = SORT_REGULAR ]): bool'
	},
	asort: {
		description: 'Sort an array and maintain index association',
		signature: '( array $array [, int $sort_flags = SORT_REGULAR ]): bool'
	},
	compact: {
		description: 'Create array containing variables and their values',
		signature: '( mixed $varname1 [, mixed $... ]): array'
	},
	count: {
		description: 'Count all elements in an array, or something in an object',
		signature: '( mixed $array_or_countable [, int $mode = COUNT_NORMAL ]): int'
	},
	current: {
		description: 'Return the current element in an array',
		signature: '( array $array ): mixed'
	},
	each: {
		description: 'Return the current key and value pair from an array and advance the array cursor',
		signature: '( array $array ): array'
	},
	end: {
		description: 'Set the internal pointer of an array to its last element',
		signature: '( array $array ): mixed'
	},
	extract: {
		description: 'Import variables into the current symbol table from an array',
		signature: '( array $array [, int $flags = EXTR_OVERWRITE [, string $prefix ]]): int'
	},
	in_array: {
		description: 'Checks if a value exists in an array',
		signature: '( mixed $needle , array $haystack [, bool $strict ]): bool'
	},
	key_exists: {
		description: 'Alias of array_key_exists',
	},
	key: {
		description: 'Fetch a key from an array',
		signature: '( array $array ): mixed'
	},
	krsort: {
		description: 'Sort an array by key in reverse order',
		signature: '( array $array [, int $sort_flags = SORT_REGULAR ]): bool'
	},
	ksort: {
		description: 'Sort an array by key',
		signature: '( array $array [, int $sort_flags = SORT_REGULAR ]): bool'
	},
	list: {
		description: 'Assign variables as if they were an array',
		signature: '( mixed $var1 [, mixed $... ]): array'
	},
	natcasesort: {
		description: 'Sort an array using a case insensitive "natural order" algorithm',
		signature: '( array $array ): bool'
	},
	natsort: {
		description: 'Sort an array using a "natural order" algorithm',
		signature: '( array $array ): bool'
	},
	next: {
		description: 'Advance the internal pointer of an array',
		signature: '( array $array ): mixed'
	},
	pos: {
		description: 'Alias of current',
	},
	prev: {
		description: 'Rewind the internal array pointer',
		signature: '( array $array ): mixed'
	},
	range: {
		description: 'Create an array containing a range of elements',
		signature: '( mixed $start , mixed $end [, number $step = 1 ]): array'
	},
	reset: {
		description: 'Set the internal pointer of an array to its first element',
		signature: '( array $array ): mixed'
	},
	rsort: {
		description: 'Sort an array in reverse order',
		signature: '( array $array [, int $sort_flags = SORT_REGULAR ]): bool'
	},
	shuffle: {
		description: 'Shuffle an array',
		signature: '( array $array ): bool'
	},
	sizeof: {
		description: 'Alias of count',
	},
	sort: {
		description: 'Sort an array',
		signature: '( array $array [, int $sort_flags = SORT_REGULAR ]): bool'
	},
	uasort: {
		description: 'Sort an array with a user-defined comparison function and maintain index association',
		signature: '( array $array , callable $value_compare_func ): bool'
	},
	uksort: {
		description: 'Sort an array by keys using a user-defined comparison function',
		signature: '( array $array , callable $key_compare_func ): bool'
	},
	usort: {
		description: 'Sort an array by values using a user-defined comparison function',
		signature: '( array $array , callable $value_compare_func ): bool'
	},
	__autoload: {
		description: 'Attempt to load undefined class',
		signature: '( string $class ): void'
	},
	call_user_method_array: {
		description: 'Call a user method given with an array of parameters',
		signature: '( string $method_name , object $obj , array $params ): mixed'
	},
	call_user_method: {
		description: 'Call a user method on an specific object',
		signature: '( string $method_name , object $obj [, mixed $... ]): mixed'
	},
	class_alias: {
		description: 'Creates an alias for a class',
		signature: '( string $original , string $alias [, bool $autoload ]): bool'
	},
	class_exists: {
		description: 'Checks if the class has been defined',
		signature: '( string $class_name [, bool $autoload ]): bool'
	},
	get_called_class: {
		description: 'The "Late Static Binding" class name',
		signature: '(void): string'
	},
	get_class_methods: {
		description: 'Gets the class methods\' names',
		signature: '( mixed $class_name ): array'
	},
	get_class_vars: {
		description: 'Get the default properties of the class',
		signature: '( string $class_name ): array'
	},
	get_class: {
		description: 'Returns the name of the class of an object',
		signature: '([ object $object ]): string'
	},
	get_declared_classes: {
		description: 'Returns an array with the name of the defined classes',
		signature: '(void): array'
	},
	get_declared_interfaces: {
		description: 'Returns an array of all declared interfaces',
		signature: '(void): array'
	},
	get_declared_traits: {
		description: 'Returns an array of all declared traits',
		signature: '(void): array'
	},
	get_object_vars: {
		description: 'Gets the properties of the given object',
		signature: '( object $object ): array'
	},
	get_parent_class: {
		description: 'Retrieves the parent class name for object or class',
		signature: '([ mixed $object ]): string'
	},
	interface_exists: {
		description: 'Checks if the interface has been defined',
		signature: '( string $interface_name [, bool $autoload ]): bool'
	},
	is_a: {
		description: 'Checks if the object is of this class or has this class as one of its parents',
		signature: '( mixed $object , string $class_name [, bool $allow_string ]): bool'
	},
	is_subclass_of: {
		description: 'Checks if the object has this class as one of its parents or implements it',
		signature: '( mixed $object , string $class_name [, bool $allow_string ]): bool'
	},
	method_exists: {
		description: 'Checks if the class method exists',
		signature: '( mixed $object , string $method_name ): bool'
	},
	property_exists: {
		description: 'Checks if the object or class has a property',
		signature: '( mixed $class , string $property ): bool'
	},
	trait_exists: {
		description: 'Checks if the trait exists',
		signature: '( string $traitname [, bool $autoload ]): bool'
	},
	ctype_alnum: {
		description: 'Check for alphanumeric character(s)',
		signature: '( string $text ): string'
	},
	ctype_alpha: {
		description: 'Check for alphabetic character(s)',
		signature: '( string $text ): string'
	},
	ctype_cntrl: {
		description: 'Check for control character(s)',
		signature: '( string $text ): string'
	},
	ctype_digit: {
		description: 'Check for numeric character(s)',
		signature: '( string $text ): string'
	},
	ctype_graph: {
		description: 'Check for any printable character(s) except space',
		signature: '( string $text ): string'
	},
	ctype_lower: {
		description: 'Check for lowercase character(s)',
		signature: '( string $text ): string'
	},
	ctype_print: {
		description: 'Check for printable character(s)',
		signature: '( string $text ): string'
	},
	ctype_punct: {
		description: 'Check for any printable character which is not whitespace or an   alphanumeric character',
		signature: '( string $text ): string'
	},
	ctype_space: {
		description: 'Check for whitespace character(s)',
		signature: '( string $text ): string'
	},
	ctype_upper: {
		description: 'Check for uppercase character(s)',
		signature: '( string $text ): string'
	},
	ctype_xdigit: {
		description: 'Check for character(s) representing a hexadecimal digit',
		signature: '( string $text ): string'
	},
	filter_has_var: {
		description: 'Checks if variable of specified type exists',
		signature: '( int $type , string $variable_name ): bool'
	},
	filter_id: {
		description: 'Returns the filter ID belonging to a named filter',
		signature: '( string $filtername ): int'
	},
	filter_input_array: {
		description: 'Gets external variables and optionally filters them',
		signature: '( int $type [, mixed $definition [, bool $add_empty ]]): mixed'
	},
	filter_input: {
		description: 'Gets a specific external variable by name and optionally filters it',
		signature: '( int $type , string $variable_name [, int $filter = FILTER_DEFAULT [, mixed $options ]]): mixed'
	},
	filter_list: {
		description: 'Returns a list of all supported filters',
		signature: '(void): array'
	},
	filter_var_array: {
		description: 'Gets multiple variables and optionally filters them',
		signature: '( array $data [, mixed $definition [, bool $add_empty ]]): mixed'
	},
	filter_var: {
		description: 'Filters a variable with a specified filter',
		signature: '( mixed $variable [, int $filter = FILTER_DEFAULT [, mixed $options ]]): mixed'
	},
	call_user_func_array: {
		description: 'Call a callback with an array of parameters',
		signature: '( callable $callback , array $param_arr ): mixed'
	},
	call_user_func: {
		description: 'Call the callback given by the first parameter',
		signature: '( callable $callback [, mixed $... ]): mixed'
	},
	create_function: {
		description: 'Create an anonymous (lambda-style) function',
		signature: '( string $args , string $code ): string'
	},
	forward_static_call_array: {
		description: 'Call a static method and pass the arguments as array',
		signature: '( callable $function , array $parameters ): mixed'
	},
	forward_static_call: {
		description: 'Call a static method',
		signature: '( callable $function [, mixed $... ]): mixed'
	},
	func_get_arg: {
		description: 'Return an item from the argument list',
		signature: '( int $arg_num ): mixed'
	},
	func_get_args: {
		description: 'Returns an array comprising a function\'s argument list',
		signature: '(void): array'
	},
	func_num_args: {
		description: 'Returns the number of arguments passed to the function',
		signature: '(void): int'
	},
	function_exists: {
		description: 'Return TRUE if the given function has been defined',
		signature: '( string $function_name ): bool'
	},
	get_defined_functions: {
		description: 'Returns an array of all defined functions',
		signature: '([ bool $exclude_disabled ]): array'
	},
	register_shutdown_function: {
		description: 'Register a function for execution on shutdown',
		signature: '( callable $callback [, mixed $... ]): void'
	},
	register_tick_function: {
		description: 'Register a function for execution on each tick',
		signature: '( callable $function [, mixed $... ]): bool'
	},
	unregister_tick_function: {
		description: 'De-register a function for execution on each tick',
		signature: '( callable $function ): void'
	},
	boolval: {
		description: 'Get the boolean value of a variable',
		signature: '( mixed $var ): boolean'
	},
	debug_zval_dump: {
		description: 'Dumps a string representation of an internal zend value to output',
		signature: '( mixed $variable [, mixed $... ]): void'
	},
	doubleval: {
		description: 'Alias of floatval',
	},
	empty: {
		description: 'Determine whether a variable is empty',
		signature: '( mixed $var ): bool'
	},
	floatval: {
		description: 'Get float value of a variable',
		signature: '( mixed $var ): float'
	},
	get_defined_vars: {
		description: 'Returns an array of all defined variables',
		signature: '(void): array'
	},
	get_resource_type: {
		description: 'Returns the resource type',
		signature: '( resource $handle ): string'
	},
	gettype: {
		description: 'Get the type of a variable',
		signature: '( mixed $var ): string'
	},
	import_request_variables: {
		description: 'Import GET/POST/Cookie variables into the global scope',
		signature: '( string $types [, string $prefix ]): bool'
	},
	intval: {
		description: 'Get the integer value of a variable',
		signature: '( mixed $var [, int $base = 10 ]): integer'
	},
	is_array: {
		description: 'Finds whether a variable is an array',
		signature: '( mixed $var ): bool'
	},
	is_bool: {
		description: 'Finds out whether a variable is a boolean',
		signature: '( mixed $var ): bool'
	},
	is_callable: {
		description: 'Verify that the contents of a variable can be called as a function',
		signature: '( mixed $var [, bool $syntax_only [, string $callable_name ]]): bool'
	},
	is_countable: {
		description: 'Verify that the contents of a variable is a countable value',
		signature: '( mixed $var ): array'
	},
	is_double: {
		description: 'Alias of is_float',
	},
	is_float: {
		description: 'Finds whether the type of a variable is float',
		signature: '( mixed $var ): bool'
	},
	is_int: {
		description: 'Find whether the type of a variable is integer',
		signature: '( mixed $var ): bool'
	},
	is_integer: {
		description: 'Alias of is_int',
	},
	is_iterable: {
		description: 'Verify that the contents of a variable is an iterable value',
		signature: '( mixed $var ): array'
	},
	is_long: {
		description: 'Alias of is_int',
	},
	is_null: {
		description: 'Finds whether a variable is NULL',
		signature: '( mixed $var ): bool'
	},
	is_numeric: {
		description: 'Finds whether a variable is a number or a numeric string',
		signature: '( mixed $var ): bool'
	},
	is_object: {
		description: 'Finds whether a variable is an object',
		signature: '( mixed $var ): bool'
	},
	is_real: {
		description: 'Alias of is_float',
	},
	is_resource: {
		description: 'Finds whether a variable is a resource',
		signature: '( mixed $var ): bool'
	},
	is_scalar: {
		description: 'Finds whether a variable is a scalar',
		signature: '( mixed $var ): resource'
	},
	is_string: {
		description: 'Find whether the type of a variable is string',
		signature: '( mixed $var ): bool'
	},
	isset: {
		description: 'Determine if a variable is declared and is different than NULL',
		signature: '( mixed $var [, mixed $... ]): bool'
	},
	print_r: {
		description: 'Prints human-readable information about a variable',
		signature: '( mixed $expression [, bool $return ]): mixed'
	},
	serialize: {
		description: 'Generates a storable representation of a value',
		signature: '( mixed $value ): string'
	},
	settype: {
		description: 'Set the type of a variable',
		signature: '( mixed $var , string $type ): bool'
	},
	strval: {
		description: 'Get string value of a variable',
		signature: '( mixed $var ): string'
	},
	unserialize: {
		description: 'Creates a PHP value from a stored representation',
		signature: '( string $str [, array $options ]): mixed'
	},
	unset: {
		description: 'Unset a given variable',
		signature: '( mixed $var [, mixed $... ]): void'
	},
	var_dump: {
		description: 'Dumps information about a variable',
		signature: '( mixed $expression [, mixed $... ]): string'
	},
	var_export: {
		description: 'Outputs or returns a parsable string representation of a variable',
		signature: '( mixed $expression [, bool $return ]): mixed'
	},
	xmlrpc_decode_request: {
		description: 'Decodes XML into native PHP types',
		signature: '( string $xml , string $method [, string $encoding ]): mixed'
	},
	xmlrpc_decode: {
		description: 'Decodes XML into native PHP types',
		signature: '( string $xml [, string $encoding = "iso-8859-1" ]): mixed'
	},
	xmlrpc_encode_request: {
		description: 'Generates XML for a method request',
		signature: '( string $method , mixed $params [, array $output_options ]): string'
	},
	xmlrpc_encode: {
		description: 'Generates XML for a PHP value',
		signature: '( mixed $value ): string'
	},
	xmlrpc_get_type: {
		description: 'Gets xmlrpc type for a PHP value',
		signature: '( mixed $value ): string'
	},
	xmlrpc_is_fault: {
		description: 'Determines if an array value represents an XMLRPC fault',
		signature: '( array $arg ): bool'
	},
	xmlrpc_parse_method_descriptions: {
		description: 'Decodes XML into a list of method descriptions',
		signature: '( string $xml ): array'
	},
	xmlrpc_server_add_introspection_data: {
		description: 'Adds introspection documentation',
		signature: '( resource $server , array $desc ): int'
	},
	xmlrpc_server_call_method: {
		description: 'Parses XML requests and call methods',
		signature: '( resource $server , string $xml , mixed $user_data [, array $output_options ]): string'
	},
	xmlrpc_server_create: {
		description: 'Creates an xmlrpc server',
		signature: '(void): resource'
	},
	xmlrpc_server_destroy: {
		description: 'Destroys server resources',
		signature: '( resource $server ): bool'
	},
	xmlrpc_server_register_introspection_callback: {
		description: 'Register a PHP function to generate documentation',
		signature: '( resource $server , string $function ): bool'
	},
	xmlrpc_server_register_method: {
		description: 'Register a PHP function to resource method matching method_name',
		signature: '( resource $server , string $method_name , string $function ): bool'
	},
	xmlrpc_set_type: {
		description: 'Sets xmlrpc type, base64 or datetime, for a PHP string value',
		signature: '( string $value , string $type ): bool'
	},
	com_create_guid: {
		description: 'Generate a globally unique identifier (GUID)',
		signature: '(void): string'
	},
	com_event_sink: {
		description: 'Connect events from a COM object to a PHP object',
		signature: '( variant $comobject , object $sinkobject [, mixed $sinkinterface ]): bool'
	},
	com_get_active_object: {
		description: 'Returns a handle to an already running instance of a COM object',
		signature: '( string $progid [, int $code_page ]): variant'
	},
	com_load_typelib: {
		description: 'Loads a Typelib',
		signature: '( string $typelib_name [, bool $case_sensitive ]): bool'
	},
	com_message_pump: {
		description: 'Process COM messages, sleeping for up to timeoutms milliseconds',
		signature: '([ int $timeoutms = 0 ]): bool'
	},
	com_print_typeinfo: {
		description: 'Print out a PHP class definition for a dispatchable interface',
		signature: '( object $comobject [, string $dispinterface [, bool $wantsink ]]): bool'
	},
	variant_abs: {
		description: 'Returns the absolute value of a variant',
		signature: '( mixed $val ): mixed'
	},
	variant_add: {
		description: '"Adds" two variant values together and returns the result',
		signature: '( mixed $left , mixed $right ): mixed'
	},
	variant_and: {
		description: 'Performs a bitwise AND operation between two variants',
		signature: '( mixed $left , mixed $right ): mixed'
	},
	variant_cast: {
		description: 'Convert a variant into a new variant object of another type',
		signature: '( variant $variant , int $type ): variant'
	},
	variant_cat: {
		description: 'Concatenates two variant values together and returns the result',
		signature: '( mixed $left , mixed $right ): mixed'
	},
	variant_cmp: {
		description: 'Compares two variants',
		signature: '( mixed $left , mixed $right [, int $lcid [, int $flags ]]): int'
	},
	variant_date_from_timestamp: {
		description: 'Returns a variant date representation of a Unix timestamp',
		signature: '( int $timestamp ): variant'
	},
	variant_date_to_timestamp: {
		description: 'Converts a variant date/time value to Unix timestamp',
		signature: '( variant $variant ): int'
	},
	variant_div: {
		description: 'Returns the result from dividing two variants',
		signature: '( mixed $left , mixed $right ): mixed'
	},
	variant_eqv: {
		description: 'Performs a bitwise equivalence on two variants',
		signature: '( mixed $left , mixed $right ): mixed'
	},
	variant_fix: {
		description: 'Returns the integer portion of a variant',
		signature: '( mixed $variant ): mixed'
	},
	variant_get_type: {
		description: 'Returns the type of a variant object',
		signature: '( variant $variant ): int'
	},
	variant_idiv: {
		description: 'Converts variants to integers and then returns the result from dividing them',
		signature: '( mixed $left , mixed $right ): mixed'
	},
	variant_imp: {
		description: 'Performs a bitwise implication on two variants',
		signature: '( mixed $left , mixed $right ): mixed'
	},
	variant_int: {
		description: 'Returns the integer portion of a variant',
		signature: '( mixed $variant ): mixed'
	},
	variant_mod: {
		description: 'Divides two variants and returns only the remainder',
		signature: '( mixed $left , mixed $right ): mixed'
	},
	variant_mul: {
		description: 'Multiplies the values of the two variants',
		signature: '( mixed $left , mixed $right ): mixed'
	},
	variant_neg: {
		description: 'Performs logical negation on a variant',
		signature: '( mixed $variant ): mixed'
	},
	variant_not: {
		description: 'Performs bitwise not negation on a variant',
		signature: '( mixed $variant ): mixed'
	},
	variant_or: {
		description: 'Performs a logical disjunction on two variants',
		signature: '( mixed $left , mixed $right ): mixed'
	},
	variant_pow: {
		description: 'Returns the result of performing the power function with two variants',
		signature: '( mixed $left , mixed $right ): mixed'
	},
	variant_round: {
		description: 'Rounds a variant to the specified number of decimal places',
		signature: '( mixed $variant , int $decimals ): mixed'
	},
	variant_set_type: {
		description: 'Convert a variant into another type "in-place"',
		signature: '( variant $variant , int $type ): void'
	},
	variant_set: {
		description: 'Assigns a new value for a variant object',
		signature: '( variant $variant , mixed $value ): void'
	},
	variant_sub: {
		description: 'Subtracts the value of the right variant from the left variant value',
		signature: '( mixed $left , mixed $right ): mixed'
	},
	variant_xor: {
		description: 'Performs a logical exclusion on two variants',
		signature: '( mixed $left , mixed $right ): mixed'
	},
	libxml_clear_errors: {
		description: 'Clear libxml error buffer',
		signature: '(void): void'
	},
	libxml_disable_entity_loader: {
		description: 'Disable the ability to load external entities',
		signature: '([ bool $disable ]): bool'
	},
	libxml_get_errors: {
		description: 'Retrieve array of errors',
		signature: '(void): array'
	},
	libxml_get_last_error: {
		description: 'Retrieve last error from libxml',
		signature: '(void): LibXMLError'
	},
	libxml_set_external_entity_loader: {
		description: 'Changes the default external entity loader',
		signature: '( callable $resolver_function ): bool'
	},
	libxml_set_streams_context: {
		description: 'Set the streams context for the next libxml document load or write',
		signature: '( resource $streams_context ): void'
	},
	libxml_use_internal_errors: {
		description: 'Disable libxml errors and allow user to fetch error information as needed',
		signature: '([ bool $use_errors ]): bool'
	},
	simplexml_import_dom: {
		description: 'Get a SimpleXMLElement object from a DOM node',
		signature: '( DOMNode $node [, string $class_name = "SimpleXMLElement" ]): SimpleXMLElement'
	},
	simplexml_load_file: {
		description: 'Interprets an XML file into an object',
		signature: '( string $filename [, string $class_name = "SimpleXMLElement" [, int $options = 0 [, string $ns = "" [, bool $is_prefix ]]]]): SimpleXMLElement'
	},
	simplexml_load_string: {
		description: 'Interprets a string of XML into an object',
		signature: '( string $data [, string $class_name = "SimpleXMLElement" [, int $options = 0 [, string $ns = "" [, bool $is_prefix ]]]]): SimpleXMLElement'
	},
	utf8_decode: {
		description: 'Converts a string with ISO-8859-1 characters encoded with UTF-8   to single-byte ISO-8859-1',
		signature: '( string $data ): string'
	},
	utf8_encode: {
		description: 'Encodes an ISO-8859-1 string to UTF-8',
		signature: '( string $data ): string'
	},
	xml_error_string: {
		description: 'Get XML parser error string',
		signature: '( int $code ): string'
	},
	xml_get_current_byte_index: {
		description: 'Get current byte index for an XML parser',
		signature: '( resource $parser ): int'
	},
	xml_get_current_column_number: {
		description: 'Get current column number for an XML parser',
		signature: '( resource $parser ): int'
	},
	xml_get_current_line_number: {
		description: 'Get current line number for an XML parser',
		signature: '( resource $parser ): int'
	},
	xml_get_error_code: {
		description: 'Get XML parser error code',
		signature: '( resource $parser ): int'
	},
	xml_parse_into_struct: {
		description: 'Parse XML data into an array structure',
		signature: '( resource $parser , string $data , array $values [, array $index ]): int'
	},
	xml_parse: {
		description: 'Start parsing an XML document',
		signature: '( resource $parser , string $data [, bool $is_final ]): int'
	},
	xml_parser_create_ns: {
		description: 'Create an XML parser with namespace support',
		signature: '([ string $encoding [, string $separator = ":" ]]): resource'
	},
	xml_parser_create: {
		description: 'Create an XML parser',
		signature: '([ string $encoding ]): resource'
	},
	xml_parser_free: {
		description: 'Free an XML parser',
		signature: '( resource $parser ): bool'
	},
	xml_parser_get_option: {
		description: 'Get options from an XML parser',
		signature: '( resource $parser , int $option ): mixed'
	},
	xml_parser_set_option: {
		description: 'Set options in an XML parser',
		signature: '( resource $parser , int $option , mixed $value ): bool'
	},
	xml_set_character_data_handler: {
		description: 'Set up character data handler',
		signature: '( resource $parser , callable $handler ): bool'
	},
	xml_set_default_handler: {
		description: 'Set up default handler',
		signature: '( resource $parser , callable $handler ): bool'
	},
	xml_set_element_handler: {
		description: 'Set up start and end element handlers',
		signature: '( resource $parser , callable $start_element_handler , callable $end_element_handler ): bool'
	},
	xml_set_end_namespace_decl_handler: {
		description: 'Set up end namespace declaration handler',
		signature: '( resource $parser , callable $handler ): bool'
	},
	xml_set_external_entity_ref_handler: {
		description: 'Set up external entity reference handler',
		signature: '( resource $parser , callable $handler ): bool'
	},
	xml_set_notation_decl_handler: {
		description: 'Set up notation declaration handler',
		signature: '( resource $parser , callable $handler ): bool'
	},
	xml_set_object: {
		description: 'Use XML Parser within an object',
		signature: '( resource $parser , object $object ): bool'
	},
	xml_set_processing_instruction_handler: {
		description: 'Set up processing instruction (PI) handler',
		signature: '( resource $parser , callable $handler ): bool'
	},
	xml_set_start_namespace_decl_handler: {
		description: 'Set up start namespace declaration handler',
		signature: '( resource $parser , callable $handler ): bool'
	},
	xml_set_unparsed_entity_decl_handler: {
		description: 'Set up unparsed entity declaration handler',
		signature: '( resource $parser , callable $handler ): bool'
	},
	xmlwriter_end_attribute: {
		description: 'End attribute',
		signature: '( resource $xmlwriter ): bool'
	},
	xmlwriter_end_cdata: {
		description: 'End current CDATA',
		signature: '( resource $xmlwriter ): bool'
	},
	xmlwriter_end_comment: {
		description: 'Create end comment',
		signature: '( resource $xmlwriter ): bool'
	},
	xmlwriter_end_document: {
		description: 'End current document',
		signature: '( resource $xmlwriter ): bool'
	},
	xmlwriter_end_dtd_attlist: {
		description: 'End current DTD AttList',
		signature: '( resource $xmlwriter ): bool'
	},
	xmlwriter_end_dtd_element: {
		description: 'End current DTD element',
		signature: '( resource $xmlwriter ): bool'
	},
	xmlwriter_end_dtd_entity: {
		description: 'End current DTD Entity',
		signature: '( resource $xmlwriter ): bool'
	},
	xmlwriter_end_dtd: {
		description: 'End current DTD',
		signature: '( resource $xmlwriter ): bool'
	},
	xmlwriter_end_element: {
		description: 'End current element',
		signature: '( resource $xmlwriter ): bool'
	},
	xmlwriter_end_pi: {
		description: 'End current PI',
		signature: '( resource $xmlwriter ): bool'
	},
	xmlwriter_flush: {
		description: 'Flush current buffer',
		signature: '([ bool $empty , resource $xmlwriter ]): mixed'
	},
	xmlwriter_full_end_element: {
		description: 'End current element',
		signature: '( resource $xmlwriter ): bool'
	},
	xmlwriter_open_memory: {
		description: 'Create new xmlwriter using memory for string output',
		signature: '(void): resource'
	},
	xmlwriter_open_uri: {
		description: 'Create new xmlwriter using source uri for output',
		signature: '( string $uri ): resource'
	},
	xmlwriter_output_memory: {
		description: 'Returns current buffer',
		signature: '([ bool $flush , resource $xmlwriter ]): string'
	},
	xmlwriter_set_indent_string: {
		description: 'Set string used for indenting',
		signature: '( string $indentString , resource $xmlwriter ): bool'
	},
	xmlwriter_set_indent: {
		description: 'Toggle indentation on/off',
		signature: '( bool $indent , resource $xmlwriter ): bool'
	},
	xmlwriter_start_attribute_ns: {
		description: 'Create start namespaced attribute',
		signature: '( string $prefix , string $name , string $uri , resource $xmlwriter ): bool'
	},
	xmlwriter_start_attribute: {
		description: 'Create start attribute',
		signature: '( string $name , resource $xmlwriter ): bool'
	},
	xmlwriter_start_cdata: {
		description: 'Create start CDATA tag',
		signature: '( resource $xmlwriter ): bool'
	},
	xmlwriter_start_comment: {
		description: 'Create start comment',
		signature: '( resource $xmlwriter ): bool'
	},
	xmlwriter_start_document: {
		description: 'Create document tag',
		signature: '([ string $version = 1.0 [, string $encoding [, string $standalone , resource $xmlwriter ]]]): bool'
	},
	xmlwriter_start_dtd_attlist: {
		description: 'Create start DTD AttList',
		signature: '( string $name , resource $xmlwriter ): bool'
	},
	xmlwriter_start_dtd_element: {
		description: 'Create start DTD element',
		signature: '( string $qualifiedName , resource $xmlwriter ): bool'
	},
	xmlwriter_start_dtd_entity: {
		description: 'Create start DTD Entity',
		signature: '( string $name , bool $isparam , resource $xmlwriter ): bool'
	},
	xmlwriter_start_dtd: {
		description: 'Create start DTD tag',
		signature: '( string $qualifiedName [, string $publicId [, string $systemId , resource $xmlwriter ]]): bool'
	},
	xmlwriter_start_element_ns: {
		description: 'Create start namespaced element tag',
		signature: '( string $prefix , string $name , string $uri , resource $xmlwriter ): bool'
	},
	xmlwriter_start_element: {
		description: 'Create start element tag',
		signature: '( string $name , resource $xmlwriter ): bool'
	},
	xmlwriter_start_pi: {
		description: 'Create start PI tag',
		signature: '( string $target , resource $xmlwriter ): bool'
	},
	xmlwriter_text: {
		description: 'Write text',
		signature: '( string $content , resource $xmlwriter ): bool'
	},
	xmlwriter_write_attribute_ns: {
		description: 'Write full namespaced attribute',
		signature: '( string $prefix , string $name , string $uri , string $content , resource $xmlwriter ): bool'
	},
	xmlwriter_write_attribute: {
		description: 'Write full attribute',
		signature: '( string $name , string $value , resource $xmlwriter ): bool'
	},
	xmlwriter_write_cdata: {
		description: 'Write full CDATA tag',
		signature: '( string $content , resource $xmlwriter ): bool'
	},
	xmlwriter_write_comment: {
		description: 'Write full comment tag',
		signature: '( string $content , resource $xmlwriter ): bool'
	},
	xmlwriter_write_dtd_attlist: {
		description: 'Write full DTD AttList tag',
		signature: '( string $name , string $content , resource $xmlwriter ): bool'
	},
	xmlwriter_write_dtd_element: {
		description: 'Write full DTD element tag',
		signature: '( string $name , string $content , resource $xmlwriter ): bool'
	},
	xmlwriter_write_dtd_entity: {
		description: 'Write full DTD Entity tag',
		signature: '( string $name , string $content , bool $pe , string $pubid , string $sysid , string $ndataid , resource $xmlwriter ): bool'
	},
	xmlwriter_write_dtd: {
		description: 'Write full DTD tag',
		signature: '( string $name [, string $publicId [, string $systemId [, string $subset , resource $xmlwriter ]]]): bool'
	},
	xmlwriter_write_element_ns: {
		description: 'Write full namespaced element tag',
		signature: '( string $prefix , string $name , string $uri [, string $content , resource $xmlwriter ]): bool'
	},
	xmlwriter_write_element: {
		description: 'Write full element tag',
		signature: '( string $name [, string $content , resource $xmlwriter ]): bool'
	},
	xmlwriter_write_pi: {
		description: 'Writes a PI',
		signature: '( string $target , string $content , resource $xmlwriter ): bool'
	},
	xmlwriter_write_raw: {
		description: 'Write a raw XML text',
		signature: '( string $content , resource $xmlwriter ): bool'
	},
};
