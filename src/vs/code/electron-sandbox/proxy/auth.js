/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const { ipcRenderer } = window.vscode;

function promptForCredentials(data) {
	return new Promise((c, e) => {
		const $title = document.getElementById('title');
		const $username = document.getElementById('username');
		const $password = document.getElementById('password');
		const $form = document.getElementById('form');
		const $cancel = document.getElementById('cancel');
		const $message = document.getElementById('message');

		function submit() {
			c({ username: $username.value, password: $password.value });
			return false;
		}

		function cancel() {
			c({ username: '', password: '' });
			return false;
		}

		$form.addEventListener('submit', submit);
		$cancel.addEventListener('click', cancel);

		document.body.addEventListener('keydown', function (e) {
			switch (e.keyCode) {
				case 27: e.preventDefault(); e.stopPropagation(); return cancel();
				case 13: e.preventDefault(); e.stopPropagation(); return submit();
			}
		});

		$title.textContent = data.title;
		$message.textContent = data.message;
		$username.focus();
	});
}

ipcRenderer.on('vscode:openProxyAuthDialog', async (event, data) => {
	const response = await promptForCredentials(data);
	ipcRenderer.send('vscode:proxyAuthResponse', response);
});
