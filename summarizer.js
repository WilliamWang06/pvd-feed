// summarizer.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const POSTS_FILE = path.join(__dirname, 'public', 'posts.json');

async function summarizePost(title) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 200,
    messages: [{
      role: 'user',
      content: `You are a helpful assistant for Providence, RI residents.
Summarize this city meeting in 2 plain-English sentences that a regular resident would understand.
Then on a new line write CATEGORY: followed by ONE category from this list:
Roads, Budget, Schools, Events, Safety, Housing, Other.

Meeting: ${title}`
    }]
  });

  const fullResponse = message.content[0].text;
  const parts = fullResponse.split('CATEGORY:');
  const summary = parts[0].trim();
  const category = parts[1] ? parts[1].trim() : 'Other';

  return { summary, category };
}

async function processPosts() {
  if (!fs.existsSync(POSTS_FILE)) {
    console.log('No posts.json found yet - run scraper.js first.');
    return;
  }

  const posts = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf-8'));
  const unsummarized = posts.filter(p => !p.summary);

  if (unsummarized.length === 0) {
    console.log('No new posts to summarize.');
    return;
  }

  const toProcess = unsummarized.slice(0, 22);
  console.log('Summarizing', toProcess.length, 'posts...');

  for (const post of toProcess) {
    console.log('Summarizing:', post.title);
    const { summary, category } = await summarizePost(post.title);
    post.summary = summary;
    post.category = category;
    console.log('  Category:', category);
    console.log('  Summary:', summary);
  }

  fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2));
  console.log('All done! Saved to', POSTS_FILE);
}

processPosts();
