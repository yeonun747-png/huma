const blogId = process.argv[2] ?? 'yeonun2';
const postNo = process.argv[3] ?? '224212849946';

const urls = [
  `https://m.blog.naver.com/${blogId}/${postNo}`,
  `https://m.blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${postNo}`,
  `https://blog.naver.com/PostView.naver?blogId=${blogId}&logNo=${postNo}`,
];

const headers = {
  'User-Agent':
    'Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36',
  'Accept-Language': 'ko-KR,ko;q=0.9',
};

function probe(html) {
  const se = html.includes('se-main-container');
  const pva = html.includes('postViewArea') || html.includes('id="postViewArea"');
  const postCt = html.includes('post_ct');
  const ogDesc = html.match(/property="og:description"\s+content="([^"]*)"/i)?.[1] ?? '';
  const ogTitle = html.match(/property="og:title"\s+content="([^"]*)"/i)?.[1] ?? '';
  return { se, pva, postCt, ogDescLen: ogDesc.length, ogTitle: ogTitle.slice(0, 40), htmlLen: html.length };
}

for (const url of urls) {
  const res = await fetch(url, { headers, redirect: 'follow' });
  const html = await res.text();
  console.log('\nURL:', url);
  console.log('final:', res.url, 'status:', res.status);
  console.log(probe(html));
}
