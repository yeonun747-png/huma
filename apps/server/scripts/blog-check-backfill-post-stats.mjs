/**
 * posts.char_count = 0 인 글 — Playwright 본문 크롤 후 posts·blog_post_status 메타 갱신
 *
 * Usage:
 *   npm run build
 *   node scripts/blog-check-backfill-post-stats.mjs [accountId] [--limit=50]
 */
import { config } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { withBlogCheckBrowser } from '../dist/modules/blog-check/scanner.js';
import { scrapePostContentStats } from '../dist/modules/blog-check/post-content-scraper.js';
import { extractBlogIdFromUrl, extractPostNoFromUrl } from '../dist/modules/blog-check/blog-url.js';
import { sleep } from '../dist/lib/utils.js';

config();

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const accountIdArg = process.argv.find((a) => !a.startsWith('-') && a !== process.argv[0] && a !== process.argv[1]);
const limitArg = Number(process.argv.find((a) => a.startsWith('--limit='))?.split('=')[1] ?? 100);
const delayMs = Number(process.argv.find((a) => a.startsWith('--delay='))?.split('=')[1] ?? 800);

let q = supabase
  .from('posts')
  .select('id, account_id, post_url, post_no, title, ext_link_cleared, huma_accounts(blog_url, naver_id)')
  .eq('char_count', 0)
  .order('published_at', { ascending: false })
  .limit(limitArg);

if (accountIdArg) q = q.eq('account_id', accountIdArg);

const { data: rows, error } = await q;
if (error) throw error;

console.log(`backfill targets: ${rows?.length ?? 0}`);
if (!rows?.length) process.exit(0);

await withBlogCheckBrowser(async (page) => {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const acc = row.huma_accounts;
    const blogId = extractBlogIdFromUrl(acc?.blog_url, acc?.naver_id);
    const postNo = row.post_no ?? extractPostNoFromUrl(row.post_url);
    if (!blogId || !postNo) {
      console.warn('skip (no blogId/postNo)', row.post_url);
      continue;
    }

    try {
      const stats = await scrapePostContentStats(page, blogId, postNo);
      if (stats.char_count <= 0) {
        console.warn('crawl empty', row.post_url);
        continue;
      }

      const extLink = row.ext_link_cleared ? 0 : stats.ext_link_count;
      const { error: upErr } = await supabase
        .from('posts')
        .update({
          char_count: stats.char_count,
          img_count: stats.img_count,
          video_count: stats.video_count,
          quote_count: stats.quote_count,
          comment_count: stats.comment_count,
          like_count: stats.like_count,
          gif_count: stats.gif_count,
          map_count: stats.map_count,
          hidden_count: stats.hidden_count,
          int_link_count: stats.int_link_count,
          ext_link_count: extLink,
        })
        .eq('id', row.id);
      if (upErr) throw upErr;

      const { data: latestStatus } = await supabase
        .from('blog_post_status')
        .select('id')
        .eq('account_id', row.account_id)
        .eq('post_no', postNo)
        .order('scanned_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (latestStatus?.id) {
        await supabase
          .from('blog_post_status')
          .update({
            chars: stats.char_count,
            img_count: stats.img_count,
            video_count: stats.video_count,
            quote_count: stats.quote_count,
            comment_count: stats.comment_count,
            like_count: stats.like_count,
            gif_count: stats.gif_count,
            map_count: stats.map_count,
            hidden_count: stats.hidden_count,
            int_link_count: stats.int_link_count,
            ext_link_count: extLink,
          })
          .eq('id', latestStatus.id);
      }

      console.log(`OK ${i + 1}/${rows.length}`, row.title ?? postNo, `chars=${stats.char_count} ext=${extLink}`);
    } catch (err) {
      console.error('FAIL', row.post_url, err.message ?? err);
    }

    if (i < rows.length - 1) await sleep(delayMs);
  }
});

console.log('done');
