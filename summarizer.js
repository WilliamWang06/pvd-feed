// summarizer.js
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const Anthropic = require('@anthropic-ai/sdk');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const POSTS_FILE = path.join(__dirname, 'public', 'posts.json');

const VALID_CATEGORIES = ['Roads', 'Budget', 'Schools', 'Events', 'Safety', 'Housing', 'Other'];
const LANGUAGES = [
  { code: 'es', name: 'Spanish' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'zh', name: 'Chinese (Simplified)' }
];

// Lightweight call: category + short summary (x4 languages) + title translation (x3 languages).
// Kept separate from full-article translation so a long article never risks truncating this.
async function getMetadata(title, fullText) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 1200,
    messages: [{
      role: 'user',
      content: `You are a helpful assistant for Providence, RI residents, many of whom are more comfortable in Spanish, Portuguese, or Chinese than English.

TITLE: ${title}

ARTICLE (for context only, you do not need to translate this in this step):
${fullText.slice(0, 3000)}

Do two things:
1. Pick ONE category from this exact list: ${VALID_CATEGORIES.join(', ')}.
2. Write a 2-sentence plain-language summary of the article in English, Spanish, Portuguese, and Chinese (Simplified).
3. Translate the TITLE into Spanish, Portuguese, and Chinese (Simplified).

Respond with ONLY valid JSON, no markdown code fences, no preamble:
{"category": "...", "summary": {"en": "...", "es": "...", "pt": "...", "zh": "..."}, "title": {"es": "...", "pt": "...", "zh": "..."}}`
    }]
  });

  const raw = message.content[0].text.trim().replace(/^```json\s*|```$/g, '');
  try {
    return JSON.parse(raw);
  } catch (err) {
    console.log('  Could not parse metadata JSON:', err.message);
    return null;
  }
}

// Dedicated call per language for the full article body - keeps each call focused and
// well within token limits even for long articles, and is easy to verify/retry per language.
async function translateFullText(fullText, languageName) {
  const message = await anthropic.messages.create({
    model: 'claude-sonnet-4-5',
    max_tokens: 4000,
    messages: [{
      role: 'user',
      content: `Translate the following Providence, RI city council article into ${languageName}, faithfully and completely. Preserve the paragraph structure - separate paragraphs with a blank line. Output ONLY the translated article text. No preamble, no notes, no markdown formatting, nothing except the translation itself.

ARTICLE:
${fullText}`
    }]
  });

  const translated = message.content[0]?.text?.trim() || '';
  // Sanity check: if the model just echoed the English back, treat it as a failure so it gets retried
  if (!translated || translated === fullText.trim()) {
    console.log(`    ${languageName} translation looked like an untranslated echo, will retry next run`);
    return null;
  }
  return translated;
}

function needsMetadata(post) {
  if (!post.summary || typeof post.summary === 'string') return true;
  if (!post.summary.es || !post.summary.pt || !post.summary.zh) return true;
  if (!post.title_i18n || !post.title_i18n.es || !post.title_i18n.pt || !post.title_i18n.zh) return true;
  return false;
}

function missingFullTextLanguages(post) {
  const ft = (post.full_text || '').trim();
  const i18n = post.full_text_i18n || {};
  return LANGUAGES.filter(({ code }) => {
    const val = (i18n[code] || '').trim();
    return !val || val === ft;
  });
}

function needsProcessing(post) {
  if (!post.full_text) return false; // scraper hasn't fetched the article body yet, skip until next run
  return needsMetadata(post) || missingFullTextLanguages(post).length > 0;
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

  // Cap how many posts we touch per run - each post can take up to 4 API calls now
  const toProcess = toDo.slice(0, 8);
  console.log('Processing', toProcess.length, 'posts...');

  for (const post of toProcess) {
    console.log('Processing:', post.title);

    if (needsMetadata(post)) {
      const meta = await getMetadata(post.title, post.full_text);
      if (meta) {
        post.category = VALID_CATEGORIES.includes(meta.category) ? meta.category : 'Other';
        post.summary = {
          en: meta.summary?.en || '',
          es: meta.summary?.es || '',
          pt: meta.summary?.pt || '',
          zh: meta.summary?.zh || ''
        };
        post.title_i18n = {
          en: post.title,
          es: meta.title?.es || post.title,
          pt: meta.title?.pt || post.title,
          zh: meta.title?.zh || post.title
        };
        console.log('  Metadata done. Category:', post.category);
      } else {
        console.log('  Metadata failed, will retry next run.');
      }
    }

    const missing = missingFullTextLanguages(post);
    if (missing.length > 0) {
      post.full_text_i18n = post.full_text_i18n || {};
      post.full_text_i18n.en = post.full_text;
      for (const { code, name } of missing) {
        console.log(`  Translating full article to ${name}...`);
        const translated = await translateFullText(post.full_text, name);
        if (translated) {
          post.full_text_i18n[code] = translated;
        }
      }
    }
  }

  fs.writeFileSync(POSTS_FILE, JSON.stringify(posts, null, 2));
  console.log('All done! Saved to', POSTS_FILE);
}

processPosts();
