// summarizer.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const POSTS_FILE = path.join(__dirname, 'public', 'posts.json');

const VALID_CATEGORIES = ['Roads', 'Budget', 'Schools', 'Events', 'Safety', 'Housing', 'Other'];

async function summarizePost(title, fullText) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 6000,
    messages: [{
      role: 'user',
      content: `You are a helpful assistant for Providence, RI residents, many of whom are more comfortable in Spanish, Portuguese, or Chinese than English.

Here is a Providence City Council article:

TITLE: ${title}

FULL ARTICLE TEXT:
${fullText}

Do three things:
1. Pick ONE category from this exact list: ${VALID_CATEGORIES.join(', ')}.
2. Write a 2-sentence plain-language summary in English, Spanish, Portuguese, and Chinese (Simplified).
3. Translate the TITLE into Spanish, Portuguese, and Chinese (Simplified). Do not translate it into English - it's already in English.
4. Translate the FULL ARTICLE TEXT into Spanish, Portuguese, and Chinese (Simplified), faithfully and completely, preserving paragraph breaks (use \\n\\n between paragraphs). Do not translate it into English - it's already in English. Do not summarize or shorten it, translate the whole thing.

Respond with ONLY valid JSON, no markdown code fences, no preamble, in exactly this shape:
{
  "category": "...",
  "summary": {"en": "...", "es": "...", "pt": "...", "zh": "..."},
  "title": {"es": "...", "pt": "...", "zh": "..."},
  "full_text": {"es": "...", "pt": "...", "zh": "..."}
}`
    }]
  });

  const raw = message.content[0].text.trim().replace(/^```json\s*|```$/g, '');
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.log('  Could not parse JSON response:', err.message);
    return null;
  }

  const category = VALID_CATEGORIES.includes(parsed.category) ? parsed.category : 'Other';
  const summary = {
    en: parsed.summary?.en || '',
    es: parsed.summary?.es || '',
    pt: parsed.summary?.pt || '',
    zh: parsed.summary?.zh || ''
  };
  const titleI18n = {
    en: title,
    es: parsed.title?.es || title,
    pt: parsed.title?.pt || title,
    zh: parsed.title?.zh || title
  };
  const fullTextI18n = {
    en: fullText,
    es: parsed.full_text?.es || '',
    pt: parsed.full_text?.pt || '',
    zh: parsed.full_text?.zh || ''
  };

  return { category, summary, titleI18n, fullTextI18n };
}

function needsProcessing(post) {
  if (!post.full_text) return false; // scraper hasn't fetched the article body yet, skip until next run

  if (!post.summary || typeof post.summary === 'string') return true;
  if (!post.summary.es || !post.summary.pt || !post.summary.zh) return true;

  if (!post.title_i18n || !post.title_i18n.es || !post.title_i18n.pt || !post.title_i18n.zh) return true;

  if (!post.full_text_i18n || !post.full_text_i18n.es || !post.full_text_i18n.pt || !post.full_text_i18n.zh) return true;

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
    console.log('No new posts to summarize/translate.');
    return;
  }

  // Cap how many we process per run - full article translation is heavier than a short summary
  const toProcess = toDo.slice(0, 12);
  console.log('Translating', toProcess.length, 'posts (summary + title + full article, x4 languages)...');

  for (const post of toProcess) {
    console.log('Processing:', post.title);
    const result = await summarizePost(post.title, post.full_text);
    if (!result) {
      console.log('  Skipped due to parse error, will retry next run.');
      continue;
    }
    post.category = result.category;
    post.summary = result.summary;
    post.title_i18n = result.titleI18n;
    post.full_text_i18n = result.fullTextI18n;
    console.log('  Category:', result.category);
  }

  fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2));
  console.log('All done! Saved to', POSTS_FILE);
}

processPosts();
