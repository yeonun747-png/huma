import { createBrowser } from '../browser.js';
import { supabase } from '../../../middleware/auth.js';

const JEOMSAMO = 'https://cafe.naver.com/jeomsamo';

export async function crawlCafeTargets(): Promise<number> {
  const { browser, context } = await createBrowser();
  let count = 0;

  try {
    const page = await context.newPage();
    await page.goto(JEOMSAMO);
    await page.waitForLoadState('networkidle');

    const links = await page.locator('a.article').all();
    for (const link of links.slice(0, 20)) {
      const href = await link.getAttribute('href');
      const title = await link.textContent();
      if (!href?.includes('articles')) continue;

      const postUrl = href.startsWith('http') ? href : `${JEOMSAMO}${href}`;
      const { error } = await supabase.from('huma_cafe_targets').upsert(
        { post_url: postUrl, post_title: title?.trim() || '', cafe_id: 'jeomsamo' },
        { onConflict: 'post_url', ignoreDuplicates: true }
      );
      if (!error) count++;
    }
  } finally {
    await browser.close();
  }

  return count;
}
