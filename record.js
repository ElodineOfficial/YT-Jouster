/**
 * record.js  –  headless capture with full request/console logging
 * ---------------------------------------------------------------
 * one-time deps:
 *   npm i puppeteer @ffmpeg-installer/ffmpeg serve-handler
 */

const fs = require('fs');
const { spawn, spawnSync } = require('child_process');
const http = require('http');
const handler = require('serve-handler');
const puppeteer = require('puppeteer');

/*── find ffmpeg ─────────────────────────────────────────────────────────*/
let ffmpegPath;
try { ffmpegPath = require('@ffmpeg-installer/ffmpeg').path; }
catch {
  if (process.env.FFMPEG_PATH && fs.existsSync(process.env.FFMPEG_PATH)) {
    ffmpegPath = process.env.FFMPEG_PATH;
  } else if (spawnSync('ffmpeg',['-version'],{stdio:'ignore'}).status===0) {
    ffmpegPath = 'ffmpeg';
  } else {
    console.error('❌  FFmpeg not found. Install @ffmpeg-installer/ffmpeg or set FFMPEG_PATH.');
    process.exit(1);
  }
}

/*── settings ────────────────────────────────────────────────────────────*/
const OUT   = process.argv[2] || 'joust.mp4';
const W     = 900, H = 600, FPS = 30, PORT = 8080;
const TIMEOUT_MS = 65_000;

/*── helper ──────────────────────────────────────────────────────────────*/
const serve = () =>
  new Promise(res =>
    http.createServer((req,res_)=>handler(req,res_,{public:'.'}))
        .listen(PORT, ()=>{console.log(`[srv] 📡  localhost:${PORT}`); res();}));

/*── main ────────────────────────────────────────────────────────────────*/
(async () => {
  await serve();

  /* 1. puppeteer */
  const browser = await puppeteer.launch({
    headless:'new',
    defaultViewport:{width:W,height:H},
    args:['--no-sandbox',`--window-size=${W},${H}`]
  });
  const [page] = await browser.pages();
  const client = await page.target().createCDPSession();

  /* forward browser console */
  page.on('console', msg =>
    console[msg.type()==='error'?'error':'log'](`[page] ${msg.text()}`));

  /* log failed / 404 requests */
  page.on('response', async resp=>{
    const s = resp.status();
    if (s >= 400) console.error(`[page] ❌ ${s}  ${resp.url()}`);
  });

  /* 2. ffmpeg pipe */
  const ff = spawn(ffmpegPath, [
    '-y','-f','image2pipe','-r',FPS,'-i','pipe:0',
    '-c:v','libx264','-preset','veryfast','-tune','animation',
    '-pix_fmt','yuv420p','-movflags','+faststart','-r',FPS, OUT
  ],{stdio:['pipe','inherit','inherit']});
  const ffIn = ff.stdin;

  ff.on('close', async code=>{
    await browser.close();
    console.log(code===0?`💾 Saved ${OUT}`:`FFmpeg exited ${code}`);
    process.exit(code);
  });

  /* 3. screencast */
  let frames=0; client.on('Page.screencastFrame',async f=>{
    frames++; ffIn.write(Buffer.from(f.data,'base64'));
    await client.send('Page.screencastFrameAck',{sessionId:f.sessionId});
  });
  await client.send('Page.startScreencast',{
    format:'png',quality:100,maxWidth:W,maxHeight:H,everyNthFrame:1});
  console.log(`[rec] ⏯  ${W}×${H}@${FPS} → ${OUT}`);

  /* heartbeat + timeout */
  const t0=Date.now(); const hb=setInterval(()=>{
    console.log(`[rec] … ${(Date.now()-t0)/1000|0}s | ${frames} frames`);
  },1000);
  const watchdog=setTimeout(()=>{console.error('⏰ timeout');ffIn.end();},TIMEOUT_MS);

  /* finish hook */
  await page.exposeFunction('notifyFinish',async w=>{
    clearInterval(hb); clearTimeout(watchdog);
    console.log(`[rec] 🎖 Winner: ${w}`); await client.send('Page.stopScreencast'); ffIn.end();
  });
  await page.evaluate(()=>window.addEventListener('matchFinished',e=>window.notifyFinish(e.detail.winner)));

  /* 4. go */
  await page.goto(`http://localhost:${PORT}/index.html`,{waitUntil:'load'});
})();
