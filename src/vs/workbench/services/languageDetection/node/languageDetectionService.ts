/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILanguageDetectionService } from 'vs/workbench/services/languageDetection/common/languageDetection';
// import * as tf from '@tensorflow/tfjs-node';
// import { TFSavedModel } from '@tensorflow/tfjs-node/dist/saved_model';

enum ModelLangToLangId {
	bat = 'bat',
	cmd = 'bat',
	btm = 'bat',
	c = 'c',
	cs = 'csharp',
	cpp = 'cpp',
	cc = 'cpp',
	coffee = 'coffeescript',
	litcoffee = 'coffeescript',
	css = 'css',
	erl = 'erlang',
	hrl = 'erlang',
	go = 'go',
	hs = 'haskell',
	lhs = 'haskell',
	html = 'html',
	java = 'java',
	js = 'javascript',
	es6 = 'javascript',
	ipynb = 'jupyter',
	lua = 'lua',
	md = 'markdown',
	matlab = 'matlab',
	m = 'objective-c',
	mm = 'objective-c',
	pl = 'perl',
	pm = 'perl',
	php = 'php',
	ps1 = 'powershell',
	py = 'python',
	r = 'r',
	rdata = 'r',
	rds = 'r',
	rda = 'r',
	rb = 'ruby',
	rs = 'rust',
	scala = 'scala',
	sh = 'shellscript',
	sql = 'sql',
	swift = 'swift',
	tex = 'tex',
	ts = 'typescript',
	tsx = 'typescriptreact'
}

class LanguageDetectionService implements ILanguageDetectionService {
	declare readonly _serviceBrand: undefined;
	private _model: TFSavedModel | undefined;

	constructor() { }

	async detectLanguage(content: string): Promise<string | undefined> {
		const prediction = await this.predict(content);
		return prediction.confidence > 0.8 ? prediction.languageId : undefined;
	}

	private async getModel(): TFSavedModel {
		if (this._model) {
			this._model = await tf.node.loadSavedModel('model', ['serve'], 'serving_default');
		}

		return this._model;
	}

	private async predict(content: string): Promise<{ languageId: ModelLangToLangId; confidence: number }> {
		// call out to the model
		const model = await this.getModel();
		const predicted = model.predict(tf.tensor([content]));

		const langs: Array<keyof typeof ModelLangToLangId> = (predicted as tf.Tensor<tf.Rank>[])[0].dataSync() as any;
		const probabilities = (predicted as tf.Tensor<tf.Rank>[])[1].dataSync() as Float32Array;

		let maxIndex = 0;
		for (let i = 0; i < probabilities.length; i++) {
			if (probabilities[i] > probabilities[maxIndex]) {
				maxIndex = i;
			}
		}

		return {
			languageId: ModelLangToLangId[langs[maxIndex]],
			confidence: probabilities[maxIndex]
		};
	}
}

