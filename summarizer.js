// summarizer.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const POSTS_FILE = path.join(__dirname, 'public', 'posts.json');

const VALID_CATEGORIES = ['Roads', 'Budget', 'Schools', 'Events', 'Safety', 'Housing', 'Other'];

async function summarizePost(title) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 700,
    messages: [{
      role: 'user',
      content: `You are a helpful assistant for Providence, RI residents, many of whom are more comfortable in Spanish, Portuguese, or Chinese than English.

For this city council meeting/article, write a 2-sentence plain-language summary that a regular resident would understand, in FOUR languages: English, Spanish, Portuguese, and Chinese (Simplified).

Also pick ONE category from this exact list: ${VALID_CATEGORIES.join(', ')}.

Meeting: ${title}

Respond with ONLY valid JSON, no markdown code fences, no preamble, in exactly this shape:
{"category": "...", "summary": {"en": "...", "es": "...", "pt": "...", "zh": "..."}}`
    }]
  });

  const raw = message.content[0].text.trim().replace(/^```json\s*|```$/g, '');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.log('  Could not parse JSON response, falling back to English-only. Raw:', raw.slice(0, 200));
    return { category: 'Other', summary: { en: raw, es: '', pt: '', zh: '' } };
  }

  const category = VALID_CATEGORIES.includes(parsed.category) ? parsed.category : 'Other';
  const summary = {
    en: parsed.summary?.en || '',
    es: parsed.summary?.es || '',
    pt: parsed.summary?.pt || '',
    zh: parsed.summary?.zh || ''
  };

  return { category, summary };
}

function needsProcessing(post) {
  // Old-format posts have summary as a plain string. New format is an object with en/es/pt/zh.
  if (!post.summary) return true;
  if (typeof post.summary === 'string') return true;
  if (typeof post.summary === 'object' && (!post.summary.es || !post.summary.pt || !post.summary.zh)) return true;
  return false;
}

async function processPosts() {
  if (!fs.existsSync(POSTS_FILE)) {
    console.log('No posts.json found yet - run scraper.js first.');
    return;
  }

  const posts = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf-8'));
  const toDo = posts.filter(needsProcessing);

  if (toDo.length === 0) {
    console.log('No new posts to summarize.');
    return;
  }

  // Cap how many we process per run so we never blow through rate limits
  const toProcess = toDo.slice(0, 22);
  console.log('Summarizing', toProcess.length, 'posts in 4 languages...');

  for (const post of toProcess) {
    console.log('Summarizing:', post.title);
    const { category, summary } = await summarizePost(post.title);
    post.category = category;
    post.summary = summary;
    console.log('  Category:', category);
  }

  fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2));
  console.log('All done! Saved to', POSTS_FILE);
}

processPosts();
