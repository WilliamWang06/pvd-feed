// scraper.js
require('dotenv').config();
const fetch = require('node-fetch');
const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

async function scrapeRSS() {
  console.log('Fetching Providence City Council RSS feed...');

  const response = await fetch('https://council.providenceri.gov/feed/', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
    }
  });

  const xml = await response.text();
  const posts = [];

  // Find each item in the RSS feed
  const items = xml.match(/<item>(.*?)<\/item>/gs) || [];
  console.log('Found', items.length, 'items in RSS feed');

  for (const item of items.slice(0, 10)) {
    // Get title
    const titleMatch = item.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/s) ||
                       item.match(/<title>(.*?)<\/title>/s);
    const title = titleMatch ? titleMatch[1].trim() : '';

    // Get link
    const linkMatch = item.match(/<link>(.*?)<\/link>/s);
    const link = linkMatch ? linkMatch[1].trim() : '';

    // Get publish date
    const dateMatch = item.match(/<pubDate>(.*?)<\/pubDate>/s);
    const publishedAt = dateMatch ? new Date(dateMatch[1].trim()).toISOString() : null;

    // Get content/description
    const contentMatch = item.match(/<description><!\[CDATA\[(.*?)\]\]><\/description>/s) ||
                         item.match(/<description>(.*?)<\/description>/s);
    const rawText = contentMatch
      ? contentMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 1000)
      : title;

    if (title && title.length > 5) {
      posts.push({ title, source_url: link, raw_text: rawText, published_at: publishedAt });
      console.log('Found:', title);
      console.log('Date:', publishedAt);
    }
  }

  return posts;
}

async function saveToDatabase(posts) {
  // Clear old posts first
  await supabase
    .from('posts')
    .delete()
    .neq('id', '00000000-0000-0000-0000-000000000000');

  for (const post of posts) {
    const { error } = await supabase
      .from('posts')
      .insert([{
        title: post.title,
        source_url: post.source_url,
        raw_text: post.raw_text,
        published_at: post.published_at
      }]);

    if (error) console.log('Error saving:', error.message);
    else console.log('Saved:', post.title);
  }
}

async function main() {
  const posts = await scrapeRSS();
  console.log('Total found:', posts.length);
  await saveToDatabase(posts);
  console.log('Done!');
}

main();