// scraper.js
require('dotenv').config();
const fetch = require('node-fetch');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const POSTS_FILE = path.join(__dirname, 'public', 'posts.json');
const MAX_ARTICLE_FETCHES_PER_RUN = 30;
const MAX_FULL_TEXT_CHARS = 8000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function scrapeRSS() {
  console.log('Fetching Providence City Council news...');

  const pages = [
    'https://council.providenceri.gov/feed/',
    'https://council.providenceri.gov/feed/?paged=2',
    'https://council.providenceri.gov/feed/?paged=3',
    'https://council.providenceri.gov/feed/?paged=4',
  ];

  let allItems = [];

  for (const url of pages) {
    console.log('Fetching:', url);

    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });

    const xml = await response.text();

    const items = xml.match(/<item>(.*?)<\/item>/gs) || [];
    console.log('Found', items.length, 'items on this page');

    for (const item of items) {
      const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/s) ||
                         item.match(/<title>(.*?)<\/title>/s);
      const title = titleMatch ? titleMatch[1].trim() : '';

      const linkMatch = item.match(/<link>(.*?)<\/link>/s);
      const link = linkMatch ? linkMatch[1].trim() : '';

      const dateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/s);
      const publishedAt = dateMatch ? new Date(dateMatch[1].trim()).toISOString() : null;

      const contentMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/s) ||
                           item.match(/<description>(.*?)<\/description>/s);
      const rawText = contentMatch
        ? contentMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000)
        : title;

      if (title && title.length > 5 && publishedAt && publishedAt.startsWith('2026')) {
        allItems.push({ title, source_url: link, raw_text: rawText, published_at: publishedAt });
        console.log('Found:', title);
        console.log('Date:', publishedAt);
      }
    }
  }

  console.log('Total 2026 articles found:', allItems.length);
  return allItems;
}

// Fetches the actual article page and extracts the main body text (not just the RSS excerpt).
// Works across different WordPress themes by filtering out known chrome/boilerplate
// instead of relying on guessing the right CSS class name.
const JUNK_PATTERNS = [
  /subscribe/i, /mailing list/i, /successfully subscribed/i,
  /accessibility tools?/i, /reading mask/i, /reading bar/i, /grayscale/i,
  /high contrast/i, /invert colors/i, /dyslexic friendly/i, /stop all videos/i,
  /language\s*translation/i, /powered by google/i, /^©/, /all rights reserved/i,
  /^tel:/i, /^share$/i, /^tweet$/i, /^print$/i, /^email$/i,
  /skip to/i, /follow us/i, /newsletter/i, /^\(\d{3}\)\s*\d{3}-\d{4}$/
];

async function fetchFullText(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
      }
    });
    if (!res.ok) {
      console.log('  Article fetch failed with status', res.status);
      return null;
    }
    const html = await res.text();
    const $ = cheerio.load(html);

    $('script, style, nav, header, footer, aside, form, iframe').remove();

    const paragraphs = $('body p')
      .map((i, el) => $(el).text().replace(/\s+/g, ' ').trim())
      .get()
      .filter(t => t.length > 30)
      .filter(t => !JUNK_PATTERNS.some(re => re.test(t)));

    let text = paragraphs.join('\n\n').trim();
    if (text.length < 150) {
      console.log('  Extracted text too short, likely failed to find real content');
      return null;
    }

    return text.slice(0, MAX_FULL_TEXT_CHARS);
  } catch (err) {
    console.log('  Could not fetch full article text:', err.message);
    return null;
  }
}

function loadExistingPosts() {
  if (!fs.existsSync(POSTS_FILE)) return [];
  try {
    const raw = fs.readFileSync(POSTS_FILE, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.log('Could not parse existing posts.json, starting fresh:', err.message);
    return [];
  }
}

// Fetches full article bodies for posts that don't have one yet, or only have the
// short RSS-excerpt fallback (e.g. from before this fix existed)
async function backfillFullText(posts) {
  const needFullText = posts.filter(p => !p.full_text || p.full_text === p.raw_text);
  const toFetch = needFullText.slice(0, MAX_ARTICLE_FETCHES_PER_RUN);
  console.log(toFetch.length, 'articles need their full text (re)fetched (of', needFullText.length, 'missing/incomplete)');

  for (const post of toFetch) {
    console.log('Fetching full article:', post.title);
    const text = await fetchFullText(post.source_url);
    if (text && text !== post.full_text) {
      post.full_text = text;
      post.full_text_i18n = null; // the source text changed, so old translations are stale - redo them
    } else if (!post.full_text) {
      post.full_text = post.raw_text; // still nothing better than the excerpt
    }
    await sleep(300); // be polite to the city's server
  }
}

async function main() {
  const scraped = await scrapeRSS();
  console.log('Total found:', scraped.length);

  const existing = loadExistingPosts();
  const existingTitles = new Set(existing.map(p => p.title));

  const newOnes = scraped
    .filter(p => !existingTitles.has(p.title))
    .map(p => ({
      id: crypto.randomUUID(),
      title: p.title,
      source_url: p.source_url,
      raw_text: p.raw_text,
      full_text: null,
      published_at: p.published_at,
      summary: null,
      category: null,
      title_i18n: null,
      full_text_i18n: null
    }));

  console.log(newOnes.length, 'new posts to add');

  const merged = [...newOnes, ...existing]
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
    .slice(0, 200);

  await backfillFullText(merged);

  fs.mkdirSync(path.dirname(POSTS_FILE), { recursive: true });
  fs.writeFileSync(POSTS_FILE, JSON.stringify(merged, null, 2));
  console.log('Saved', merged.length, 'total posts to', POSTS_FILE);
  console.log('Done!');
}

main();
