// scripts/fetch_comments.mjs
//-----------------------------------------------------------
// Pull YouTube comments + replies, calculate per-user SCORE.
//
// SCORE = likes
//       + 2 · extraComments
//       + 3 · replies
//       + 20 · hearts
//       + 0.05 · chars
//
// Then write TOP-3 (padded, if ≤2 unique users) to players.json.
//-----------------------------------------------------------

// 1 . Environment & deps
import 'dotenv/config';
import { google } from 'googleapis';
import fs from 'node:fs/promises';

//-----------------------------------------------------------
// 2 . CLI
//-----------------------------------------------------------
if (!process.argv[2]) {
  console.error('Usage: node scripts/fetch_comments.mjs <YouTube-URL>');
  process.exit(1);
}

//-----------------------------------------------------------
// 3 . Extract 11-character video ID
//-----------------------------------------------------------
function getVideoId(raw) {
  try {
    const u = new URL(raw);
    if (u.hostname === 'youtu.be')                return u.pathname.slice(1);
    if (u.hostname.includes('youtube'))           return u.searchParams.get('v');
  } catch {}
  return null;
}

const videoId = getVideoId(process.argv[2]);
if (!videoId) {
  console.error('❌  Could not find a video ID in that URL.');
  process.exit(1);
}

//-----------------------------------------------------------
// 4 . API key
//-----------------------------------------------------------
if (!process.env.YT_API_KEY) {
  console.error('❌  YT_API_KEY missing in .env');
  process.exit(1);
}

//-----------------------------------------------------------
// 5 . YouTube client
//-----------------------------------------------------------
const youtube = google.youtube({
  version: 'v3',
  auth   : process.env.YT_API_KEY,
});

//-----------------------------------------------------------
// 6 . Fetch up to 2 000 top-level threads + all replies
//-----------------------------------------------------------
async function fetchThreads(max = 2000) {
  const out = [];
  let token = null;
  do {
    const { data } = await youtube.commentThreads.list({
      part       : 'snippet',
      videoId,
      order      : 'relevance',
      maxResults : 100,
      pageToken  : token || undefined,
    });
    out.push(...(data.items ?? []));
    token = data.nextPageToken;
  } while (token && out.length < max);
  return out.slice(0, max);
}

async function fetchReplies(parentId) {
  const out = [];
  let token = null;
  do {
    const { data } = await youtube.comments.list({
      part       : 'snippet',
      parentId,
      maxResults : 100,
      pageToken  : token || undefined,
    });
    out.push(...(data.items ?? []));
    token = data.nextPageToken;
  } while (token);
  return out;
}

const threads = await fetchThreads();
if (!threads.length) {
  console.error('❌  No comments found on that video.');
  process.exit(1);
}

// replies (pooled 20-at-a-time)
const replies = [];
for (let i = 0; i < threads.length; i += 20) {
  const chunk  = threads.slice(i, i + 20);
  const nested = await Promise.all(
    chunk.map(t =>
      t.snippet.totalReplyCount ? fetchReplies(t.id) : []));
  nested.forEach(arr => replies.push(...arr));
}

//-----------------------------------------------------------
// 7 . Aggregate per-user stats
//-----------------------------------------------------------
const stats = new Map();

function accumulate(snip, isReply = false) {
  const id  = snip.authorChannelId?.value ?? snip.authorDisplayName;
  const rec = stats.get(id) ?? {
    user      : sanitize(snip.authorDisplayName),
    likes     : 0,
    comments  : 0,
    replies   : 0,
    hearts    : 0,
    chars     : 0,
  };

  rec.comments += 1;
  if (isReply) rec.replies += 1;

  rec.likes += snip.likeCount ?? 0;
  rec.chars += (snip.textOriginal ?? '').length;

  // ❤️  detection
  if (snip.isHearted) rec.hearts += 1;

  stats.set(id, rec);
}

// top-level
threads.forEach(t =>
  accumulate(t.snippet.topLevelComment.snippet, false));
// replies
replies.forEach(c =>
  accumulate(c.snippet, true));

//-----------------------------------------------------------
// 8 . Compute SCORE
//-----------------------------------------------------------
for (const rec of stats.values()) {
  const extraComments = rec.comments - 1;
  rec.score =
      rec.likes
    + extraComments * 2
    + rec.replies   * 3
    + rec.hearts    * 20
    + rec.chars     * 0.05;
}

//-----------------------------------------------------------
// 9 . Keep TOP-3 (pad if needed)
//-----------------------------------------------------------
let top = [...stats.values()].sort((a, b) => b.score - a.score);
while (top.length < 3) {
  top.push({
    user     : `CPU Knight #${top.length + 1}`,
    likes    : 0,
    comments : 0,
    replies  : 0,
    hearts   : 0,
    chars    : 0,
    score    : 0,
  });
}
top = top.slice(0, 4);

//-----------------------------------------------------------
// 10. write file
//-----------------------------------------------------------
await fs.writeFile('players.json', JSON.stringify(top, null, 2));
console.log('✔  players.json written:', top);

//-----------------------------------------------------------
// 11. utils
//-----------------------------------------------------------
function sanitize(name = 'Player') {
  return name.replace(/[^\w\s]/g, '').slice(0, 12).trim() || 'Player';
}
