#!/usr/bin/env node

const express = require('express');
const path = require('path');

const app = express();
app.use('/remote', express.static(path.join(__dirname, '../../node_modules')));
app.use('/out', express.static(path.join(__dirname, '../../out')));
app.use('/static-extension', express.static(path.join(__dirname, '../../extensions')));
app.use('/web-extension', express.static(path.join(__dirname, '../extensions')));
app.use(express.static(path.join(__dirname, '../assets')));

app.listen(9090, () => {
	console.log('started');
});
