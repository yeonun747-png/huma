import type { Page } from 'playwright';

import { humanType, humanSleep } from '../../human-engine/typing.js';

import { scrollReview, smartType, scaledHumanSleep } from '../../human-engine/timing.js';

import { randomBetween } from '../../../lib/utils.js';

import type { HumanEngineConfig } from '../../../lib/settings.js';

import { parsePersona, type AccountPersona } from '../persona.js';

import { uniquifyImageFromUrl } from '../../image/uniquify.js';

import { enterBlogEditor } from './enter-blog-editor.js';
import { humanClickLocator } from '../../human-engine/mouse.js';



function mergePersonaConfig(base: HumanEngineConfig, persona: AccountPersona): HumanEngineConfig {

  return {

    ...base,

    wpm_mean: persona.wpm,

    typo_rate: persona.typoRate,

  };

}



export async function postNaverBlog(params: {

  page: Page;

  title: string;

  content: string;

  imageUrls?: string[];

  linkUrl?: string;

  humanEngine: HumanEngineConfig;

  persona?: AccountPersona;

  rttScale?: number;

}) {

  const persona = parsePersona(params.persona);

  const config = mergePersonaConfig(params.humanEngine, persona);

  const scale = params.rttScale ?? 1;



  await enterBlogEditor(params.page, config);



  await humanType(params.page, params.page.locator('#subjectTextBox'), params.title, config);

  await scaledHumanSleep(2000, 5000, scale);



  const editor = params.page.frameLocator('#mainFrame').locator('.se-content');

  await humanClickLocator(params.page, editor);



  await smartType(params.page, editor, params.content, config);



  if (params.linkUrl) {

    await smartType(params.page, editor, `\n\n${params.linkUrl}`, config);

  }



  if (params.imageUrls?.length) {

    for (const url of params.imageUrls) {

      await insertImage(params.page, await uniquifyImageFromUrl(url));

      await scaledHumanSleep(1000, 3000, scale);

    }

  }



  await scrollReview(

    params.page,

    randomBetween(params.humanEngine.review_duration_ms[0], params.humanEngine.review_duration_ms[1])

  );



  await params.page.locator('.publish-btn').click();

  await params.page.waitForLoadState('networkidle');

  return { resultUrl: params.page.url() };

}



async function insertImage(page: Page, localPath: string) {

  const fileInput = page.locator('input[type="file"]').first();

  if (await fileInput.count()) {

    await fileInput.setInputFiles(localPath);

    await humanSleep(2000, 4000);

  }

}


