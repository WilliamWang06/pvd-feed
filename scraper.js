// scraper.js
require('dotenv').config();
const fetch = require('node-fetch');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const POSTS_FILE = path.join(__dirname, 'public', 'posts.json');

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

function saveToFile(posts) {
  const existing = loadExistingPosts();
  const existingTitles = new Set(existing.map(p => p.title));

  const newOnes = posts
    .filter(p => !existingTitles.has(p.title))
    .map(p => ({
      id: crypto.randomUUID(),
      title: p.title,
      source_url: p.source_url,
      raw_text: p.raw_text,
      published_at: p.published_at,
      summary: null,
      category: null
    }));

  console.log(newOnes.length, 'new posts to add');

  const merged = [...newOnes, ...existing]
    .sort((a, b) => new Date(b.published_at) - new Date(a.published_at))
    .slice(0, 200);

  fs.mkdirSync(path.dirname(POSTS_FILE), { recursive: true });
  fs.writeFileSync(POSTS_FILE, JSON.stringify(merged, null, 2));
  console.log('Saved', merged.length, 'total posts to', POSTS_FILE);
}

async function main() {
  const posts = await scrapeRSS();
  console.log('Total found:', posts.length);
  saveToFile(posts);
  console.log('Done!');
}

main();
