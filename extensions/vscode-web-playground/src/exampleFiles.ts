/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export const largeTSFile = `/// <reference path="lib/Geometry.ts"/>
/// <reference path="Game.ts"/>

module Mankala {
export var storeHouses = [6,13];
export var svgNS = 'http://www.w3.org/2000/svg';

function createSVGRect(r:Rectangle) {
	var rect = document.createElementNS(svgNS,'rect');
	rect.setAttribute('x', r.x.toString());
	rect.setAttribute('y', r.y.toString());
	rect.setAttribute('width', r.width.toString());
	rect.setAttribute('height', r.height.toString());
	return rect;
}

function createSVGEllipse(r:Rectangle) {
	var ell = document.createElementNS(svgNS,'ellipse');
	ell.setAttribute('rx',(r.width/2).toString());
	ell.setAttribute('ry',(r.height/2).toString());
	ell.setAttribute('cx',(r.x+r.width/2).toString());
	ell.setAttribute('cy',(r.y+r.height/2).toString());
	return ell;
}

function createSVGEllipsePolar(angle:number,radius:number,tx:number,ty:number,cxo:number,cyo:number) {
	var ell = document.createElementNS(svgNS,'ellipse');
	ell.setAttribute('rx',radius.toString());
	ell.setAttribute('ry',(radius/3).toString());
	ell.setAttribute('cx',cxo.toString());
	ell.setAttribute('cy',cyo.toString());
	var dangle = angle*(180/Math.PI);
	ell.setAttribute('transform','rotate('+dangle+','+cxo+','+cyo+') translate('+tx+','+ty+')');
	return ell;
}

function createSVGInscribedCircle(sq:Square) {
	var circle = document.createElementNS(svgNS,'circle');
	circle.setAttribute('r',(sq.length/2).toString());
	circle.setAttribute('cx',(sq.x+(sq.length/2)).toString());
	circle.setAttribute('cy',(sq.y+(sq.length/2)).toString());
	return circle;
}

export class Position {

	seedCounts:number[];
	startMove:number;
	turn:number;

	constructor(seedCounts:number[],startMove:number,turn:number) {
		this.seedCounts = seedCounts;
		this.startMove = startMove;
		this.turn = turn;
	}

	score() {
		var baseScore = this.seedCounts[storeHouses[1-this.turn]]-this.seedCounts[storeHouses[this.turn]];
		var otherSpaces = homeSpaces[this.turn];
		var sum = 0;
		for (var k = 0,len = otherSpaces.length;k<len;k++) {
			sum += this.seedCounts[otherSpaces[k]];
		}
		if (sum==0) {
			var mySpaces = homeSpaces[1-this.turn];
			var mySum = 0;
			for (var j = 0,len = mySpaces.length;j<len;j++) {
				mySum += this.seedCounts[mySpaces[j]];
			}

			baseScore -= mySum;
		}
		return baseScore;
	}

	move(space:number,nextSeedCounts:number[],features:Features):boolean {
		if ((space==storeHouses[0])||(space==storeHouses[1])) {
			// can't move seeds in storehouse
			return false;
		}
		if (this.seedCounts[space]>0) {
			features.clear();
			var len = this.seedCounts.length;
			for (var i = 0;i<len;i++) {
				nextSeedCounts[i] = this.seedCounts[i];
			}
			var seedCount = this.seedCounts[space];
			nextSeedCounts[space] = 0;
			var nextSpace = (space+1)%14;

			while (seedCount>0) {
				if (nextSpace==storeHouses[this.turn]) {
					features.seedStoredCount++;
				}
				if ((nextSpace!=storeHouses[1-this.turn])) {
					nextSeedCounts[nextSpace]++;
					seedCount--;
				}
				if (seedCount==0) {
					if (nextSpace==storeHouses[this.turn]) {
						features.turnContinues = true;
					}
					else {
						if ((nextSeedCounts[nextSpace]==1)&&
							(nextSpace>=firstHomeSpace[this.turn])&&
							(nextSpace<=lastHomeSpace[this.turn])) {
							// capture
							var capturedSpace = capturedSpaces[nextSpace];
							if (capturedSpace>=0) {
								features.spaceCaptured = capturedSpace;
								features.capturedCount = nextSeedCounts[capturedSpace];
								nextSeedCounts[capturedSpace] = 0;
								nextSeedCounts[storeHouses[this.turn]] += features.capturedCount;
								features.seedStoredCount += nextSeedCounts[capturedSpace];
							}
						}
					}
				}
				nextSpace = (nextSpace+1)%14;
			}
			return true;
		}
		else {
			return false;
		}
	}
}

export class SeedCoords {
	tx:number;
	ty:number;
	angle:number;

	constructor(tx:number, ty:number, angle:number) {
		this.tx = tx;
		this.ty = ty;
		this.angle = angle;
	}
}

export class DisplayPosition extends Position {

	config:SeedCoords[][];

	constructor(seedCounts:number[],startMove:number,turn:number) {
		super(seedCounts,startMove,turn);

		this.config = [];

		for (var i = 0;i<seedCounts.length;i++) {
			this.config[i] = new Array<SeedCoords>();
		}
	}


	seedCircleRect(rect:Rectangle,seedCount:number,board:Element,seed:number) {
		var coords = this.config[seed];
		var sq = rect.inner(0.95).square();
		var cxo = (sq.width/2)+sq.x;
		var cyo = (sq.height/2)+sq.y;
		var seedNumbers = [5,7,9,11];
		var ringIndex = 0;
		var ringRem = seedNumbers[ringIndex];
		var angleDelta = (2*Math.PI)/ringRem;
		var angle = angleDelta;
		var seedLength = sq.width/(seedNumbers.length<<1);
		var crMax = sq.width/2-(seedLength/2);
		var pit = createSVGInscribedCircle(sq);
		if (seed<7) {
			pit.setAttribute('fill','brown');
		}
		else {
			pit.setAttribute('fill','saddlebrown');
		}
		board.appendChild(pit);
		var seedsSeen = 0;
		while (seedCount > 0) {
			if (ringRem == 0) {
				ringIndex++;
				ringRem = seedNumbers[ringIndex];
				angleDelta = (2*Math.PI)/ringRem;
				angle = angleDelta;
			}
			var tx:number;
			var ty:number;
			var tangle = angle;
			if (coords.length>seedsSeen) {
				tx = coords[seedsSeen].tx;
				ty = coords[seedsSeen].ty;
				tangle = coords[seedsSeen].angle;
			}
			else {
				tx = (Math.random()*crMax)-(crMax/3);
				ty = (Math.random()*crMax)-(crMax/3);
				coords[seedsSeen] = new SeedCoords(tx,ty,angle);
			}
			var ell = createSVGEllipsePolar(tangle,seedLength,tx,ty,cxo,cyo);
			board.appendChild(ell);
			angle += angleDelta;
			ringRem--;
			seedCount--;
			seedsSeen++;
		}
	}

	toCircleSVG() {
		var seedDivisions = 14;
		var board = document.createElementNS(svgNS,'svg');
		var boardRect = new Rectangle(0,0,1800,800);
		board.setAttribute('width','1800');
		board.setAttribute('height','800');
		var whole = createSVGRect(boardRect);
		whole.setAttribute('fill','tan');
		board.appendChild(whole);
		var labPlayLab = boardRect.proportionalSplitVert(20,760,20);
		var playSurface = labPlayLab[1];
		var storeMainStore = playSurface.proportionalSplitHoriz(8,48,8);
		var mainPair = storeMainStore[1].subDivideVert(2);
		var playerRects = [mainPair[0].subDivideHoriz(6), mainPair[1].subDivideHoriz(6)];
		// reverse top layer because storehouse on left
		for (var k = 0;k<3;k++) {
			var temp = playerRects[0][k];
			playerRects[0][k] = playerRects[0][5-k];
			playerRects[0][5-k] = temp;
		}
		var storehouses = [storeMainStore[0],storeMainStore[2]];
		var playerSeeds = this.seedCounts.length>>1;
		for (var i = 0;i<2;i++) {
			var player = playerRects[i];
			var storehouse = storehouses[i];
			var r:Rectangle;
			for (var j = 0;j<playerSeeds;j++) {
				var seed = (i*playerSeeds)+j;
				var seedCount = this.seedCounts[seed];
				if (j==(playerSeeds-1)) {
					r = storehouse;
				}
				else {
					r = player[j];
				}
				this.seedCircleRect(r,seedCount,board,seed);
				if (seedCount==0) {
					// clear
					this.config[seed] = new Array<SeedCoords>();
				}
			}
		}
		return board;
	}
}
}
`;

export const debuggableFile = `# VS Code Mock Debug

This is a starter sample for developing VS Code debug adapters.

**Mock Debug** simulates a debug adapter for Visual Studio Code.
It supports *step*, *continue*, *breakpoints*, *exceptions*, and
*variable access* but it is not connected to any real debugger.

The sample is meant as an educational piece showing how to implement a debug
adapter for VS Code. It can be used as a starting point for developing a real adapter.

More information about how to develop a new debug adapter can be found
[here](https://code.visualstudio.com/docs/extensions/example-debuggers).
Or discuss debug adapters on Gitter:
[![Gitter Chat](https://img.shields.io/badge/chat-online-brightgreen.svg)](https://gitter.im/Microsoft/vscode)

## Using Mock Debug

* Install the **Mock Debug** extension in VS Code.
* Create a new 'program' file 'readme.md' and enter several lines of arbitrary text.
* Switch to the debug viewlet and press the gear dropdown.
* Select the debug environment "Mock Debug".
* Press the green 'play' button to start debugging.

You can now 'step through' the 'readme.md' file, set and hit breakpoints, and run into exceptions (if the word exception appears in a line).

![Mock Debug](file.jpg)

## Build and Run

[![build status](https://travis-ci.org/Microsoft/vscode-mock-debug.svg?branch=master)](https://travis-ci.org/Microsoft/vscode-mock-debug)
[![build status](https://ci.appveyor.com/api/projects/status/empmw5q1tk6h1fly/branch/master?svg=true)](https://ci.appveyor.com/project/weinand/vscode-mock-debug)


* Clone the project [https://github.com/Microsoft/vscode-mock-debug.git](https://github.com/Microsoft/vscode-mock-debug.git)
* Open the project folder in VS Code.
* Press 'F5' to build and launch Mock Debug in another VS Code window. In that window:
* Open a new workspace, create a new 'program' file 'readme.md' and enter several lines of arbitrary text.
* Switch to the debug viewlet and press the gear dropdown.
* Select the debug environment "Mock Debug".
* Press 'F5' to start debugging.`;

export function getImageFile(): Uint8Array {
	const data = atob(`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`);
	return Uint8Array.from([...data].map(x => x.charCodeAt(0)));
}

// encoded from 'АБВГДЕЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯабвгдежзийклмнопрстуфхцчшщъыьэюя'
export const windows1251File = Uint8Array.from([192, 193, 194, 195, 196, 197, 198, 199, 200, 201, 202, 203, 204, 205, 206, 207, 208, 209, 210, 211, 212, 213, 214, 215, 216, 217, 218, 219, 220, 221, 222, 223, 224, 225, 226, 227, 228, 229, 230, 231, 232, 233, 234, 235, 236, 237, 238, 239, 240, 241, 242, 243, 244, 245, 246, 247, 248, 249, 250, 251, 252, 253, 254, 255]);

// encoded from '中国abc'
export const gbkFile = Uint8Array.from([214, 208, 185, 250, 97, 98, 99]);
