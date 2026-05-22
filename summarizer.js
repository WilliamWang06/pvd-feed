// summarizer.js
require('dotenv').config();
const Anthropic = require('@anthropic-ai/sdk');
const { createClient } = require('@supabase/supabase-js');

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_KEY);

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
  const { data: posts, error } = await supabase
    .from('posts')
    .select('*')
    .is('summary', null)
    .limit(22);

  if (error) { console.log('Error:', error.message); return; }
  if (!posts || posts.length === 0) { console.log('No new posts to summarize.'); return; }

  console.log('Summarizing', posts.length, 'posts...');

  for (const post of posts) {
    console.log('Summarizing:', post.title);
    const { summary, category } = await summarizePost(post.title);

    await supabase
      .from('posts')
      .update({ summary, category })
      .eq('id', post.id);

    console.log('  Category:', category);
    console.log('  Summary:', summary);
  }

  console.log('All done!');
}

processPosts();