/*  ──────────────────────────────────────────────────────────────────────────
    joust.js  –  Mini-physics “joust” arena  ★ 2025-06-27 sprite-fix v3
  ──────────────────────────────────────────────────────────────────────────*/

(() => {
/*────────────────────────────  Tunables  ───────────────────────────────*/
const CANVAS_W        = 900;
const CANVAS_H        = 600;
const GRAVITY         = 0.45;
const FLAP_VY         = -11;
const MAX_VX          = 4;
const GROUND_FRIC     = 0.80;
const AIR_DRAG        = 0.995;
const EDGE_PADDING    = 14;
const FPS             = 60;
const FRAME_MS        = 1000 / FPS;
const SPRITE_SCALE    = 2;          // combat scale
const VICTORY_SECONDS   = 2;          // big splash duration
const COUNTDOWN_START   = 3;          // 3-2-1
const NEW_HS_SECONDS     = 2;          // “NEW HIGH SCORE!” banner
const HIGH_SCORE_SCREEN  = 5;          // length of high-score roll
const HIGH_SCORE_ENTRIES = 10;         // keep top-10
const DEFAULT_HS_NAME    = 'AAAA';     // placeholder name


/* ────── high-score I/O helpers ────── */
/* ────── embedded high-score table ──────
   Edit this list manually for permanent changes.
   The game updates a copy at runtime but will NOT write any files.
*/
const EMBEDDED_HIGH_SCORES = [
  { name: 'COPE', score: 189 },
  { name: 'CATS', score: 173 },
  { name: '0ASS', score: 169 },
  { name: 'ELOD', score: 142 },
];



/* Static platforms */
const PLATFORMS = [
  { x: 150, y: 350, w: 200, h: 10 },
  { x: 550, y: 250, w: 200, h: 10 },
  { x: 310, y: 180, w: 260, h: 10 },   // ← NEW mid-upper perch

];

/*──────────────────────────────  Sprites  ──────────────────────────────*/
const SPRITE_PATHS = {
  walk: [ 'images/walk1.png','images/walk2.png','images/walk3.png','images/walk4.png' ],
  fly : [ 'images/fly1.png','images/fly2.png' ],
  rider: 'images/yellow.png',
};
const SPRITES = { walk: [], fly: [], rider: null };

function preloadSprites() {
  const load = src => new Promise(res => { const i=new Image(); i.onload=()=>res(i); i.src=src; });
  const tasks = [];

  ['walk','fly'].forEach(k=>SPRITE_PATHS[k].forEach(src=>{
    tasks.push(load(src).then(img=>SPRITES[k].push(img)));
  }));
  tasks.push(load(SPRITE_PATHS.rider).then(img=>SPRITES.rider=img));

  return Promise.all(tasks).then(()=>{
    ['walk','fly'].forEach(k=>SPRITES[k].sort((a,b)=>a.src.localeCompare(b.src)));
  });
}

/*──────────────────────────────  Helpers  ──────────────────────────────*/
const clamp = (v,lo,hi)=>Math.max(lo,Math.min(hi,v));
const rand  = (lo,hi)=>Math.random()*(hi-lo)+lo;

/*──────────────────────────────  Entity  ───────────────────────────────*/
class Entity {
  constructor(opts) {
    Object.assign(this, opts);
    this.alive = true;
    this.frame = 0;
    this.frameAcc = 0;
    this.onGround = false;
    this.prevY = this.y;
    this.airFrames = 0;
    this.spriteKey = 'walk';
  }
  flap(){ this.vy = FLAP_VY * (this.isChampion?1.1:1); }

  /*━━━━━━━━━━ AI ━━━━━━━━━━*/
  updateAI(arena){
    if(!this.ai) return;
    this.aiTimer--;
    const rival = arena.players.find(p=>p!==this && p.alive);
    if(rival){
      this.vx += Math.sign(rival.x-this.x)*0.15;
      if(rival.y>this.y && Math.random()<0.02) this.flap();
    }
    const plat=this.currentPlatform();
    if(plat){
      const nearL=this.x<plat.x+EDGE_PADDING;
      const nearR=this.x+this.w>plat.x+plat.w-EDGE_PADDING;
      if(nearL||nearR){ Math.random()<0.5 ? this.flap() : (this.vx*=-0.7); }
    }else if(this.aiTimer<=0){
      this.vx+=rand(-0.6,0.6);
      this.aiTimer=rand(40,90);
      if(Math.random()<0.1) this.flap();
    }
  }

  /*━━━━━━━━━━ Physics & animation ━━━━━━━━━━*/
  step(){
    this.prevY=this.y;
    this.vy+=GRAVITY;
    this.vx=clamp(this.vx,-MAX_VX*(this.isChampion?1.25:1),MAX_VX);
    this.x+=this.vx; this.y+=this.vy;

    if(this.x<-this.w) this.x=CANVAS_W+this.w;
    if(this.x>CANVAS_W+this.w) this.x=-this.w;
    this.handleSurfaces();

    if(this.onGround) this.airFrames=0; else this.airFrames++;
    const want=this.airFrames>2?'fly':'walk';
    if(want!==this.spriteKey){ this.spriteKey=want; this.frame=this.frameAcc=0; }

    const arr=SPRITES[this.spriteKey];
    const spd=this.spriteKey==='walk'?Math.abs(this.vx)*0.12+0.08:0.18;
    this.frameAcc+=spd;
    if(this.frameAcc>1){ this.frame=(this.frame+1)%arr.length; this.frameAcc=0; }
  }

  /*━━━━━━━━━━ Collisions with ground / platforms ━━━━━━━━━━*/
  handleSurfaces(){
    this.onGround=false;
    if(this.y>CANVAS_H-this.h){ this.y=CANVAS_H-this.h; this.vy=0; this.onGround=true; }
    if(this.vy>=0){
      for(const p of PLATFORMS){
        const withinX=this.x+this.w>p.x && this.x<p.x+p.w;
        const crossed=this.prevY+this.h<=p.y && this.y+this.h>=p.y;
        if(withinX && crossed){ this.y=p.y-this.h; this.vy=0; this.onGround=true; break; }
      }
    }
    this.vx*=this.onGround?GROUND_FRIC:AIR_DRAG;
  }
  currentPlatform(){
    return PLATFORMS.find(p=>
      Math.abs(this.y+this.h-p.y)<1 && this.x+this.w>p.x && this.x<p.x+p.w
    )||null;
  }

  /*━━━━━━━━━━ Rendering ━━━━━━━━━━*/
  render(ctx){
    const img=SPRITES[this.spriteKey][this.frame];
    const rider=SPRITES.rider;
    ctx.save();
    ctx.translate(this.x+this.w/2, this.y+this.h/2);
    if(this.vx<0) ctx.scale(-1,1);

    const sw=SPRITE_SCALE;
    /* rider behind bird */
    ctx.drawImage(
      rider,
      -rider.width*sw/2,
      (-img.height*sw/2)+6*sw,
      rider.width*sw,
      rider.height*sw
    );
    ctx.drawImage(
      img,
      -img.width*sw/2,
      -img.height*sw/2,
      img.width*sw,
      img.height*sw
    );
    ctx.restore();

    ctx.fillStyle='#fff';
    ctx.font='20px monospace';
    ctx.textAlign='center';
    ctx.fillText(this.user, this.x+this.w/2, this.y-6);
  }
}

/*──────────────────────────────  Arena  ───────────────────────────────*/
class Arena {
  constructor(players, ctx) {
    this.ctx     = ctx;
    this.players = [];
    this.ticks   = 0;

	/* champion = highest score */
    const champ = [...players].sort((a, b) => b.score - a.score)[0];

    /* hit-boxes already taken at spawn time */
    const taken = [];

    /* sprite metrics (available after preloadSprites()) */
    const baseW = SPRITES.walk[0].width  * SPRITE_SCALE;
    const baseH = SPRITES.walk[0].height * SPRITE_SCALE;

/* helper: test AABB overlap + personal-space cushion */
const EXTRA_SEP = baseW * 0.65;           // 65 % horizontal buffer keeps things from ending too quick
const overlaps  = (ax, ay, bx, by) =>
  Math.abs(ax - bx) < baseW + EXTRA_SEP &&
  Math.abs(ay - by) < baseH;              // vertical check unchanged

    /* place each entrant */
    players.forEach(p => {
      let x, y, plat, tries = 0;

      do {
        plat = PLATFORMS[Math.floor(Math.random() * PLATFORMS.length)];

        /* clamp X so the whole bird fits on the platform */
        const minX = plat.x + 10,
              maxX = plat.x + plat.w - baseW - 10;

        x = rand(minX, maxX);
        y = plat.y - baseH;
      } while (
        tries++ < 40 &&          // 40 attempts is plenty
        taken.some(pos => overlaps(x, y, pos.x, pos.y))
      );

      taken.push({ x, y });

      this.players.push(new Entity({
        user : p.user,
        score: p.score,
        x, y,
        vx: rand(-2, 2) * (p === champ ? 1.2 : 1),
        vy: 0,
        isChampion: p === champ,
        ai: 'bot',
        aiTimer: 30,
        w: baseW,
        h: baseH,
      }));
    });
  }
  handleCollisions(){
    const alive=this.players.filter(p=>p.alive);
    for(let i=0;i<alive.length;i++){
      for(let j=i+1;j<alive.length;j++){
        const a=alive[i], b=alive[j];
        if(!a.alive||!b.alive) continue;
        if (Math.abs(a.x - b.x) < 40 && Math.abs(a.y - b.y) < 40) {
  let winner;

  /* Champion always wins any collision */
  if (a.isChampion || b.isChampion) {
    winner = a.isChampion ? a : b;
  } else if (Math.abs(a.y - b.y) < 8) {
    winner = (Math.random() < 0.5 ? a : b);
  } else {
    winner = a.y < b.y ? a : b;
  }

  const loser = winner === a ? b : a;
  loser.alive = false; loser.vx = loser.vy = 0; winner.vy = -6;
}

      }
    }
  }
  step(){
    this.ticks++;
    for(const p of this.players){ if(p.alive){ p.updateAI(this); p.step(); } }
    this.handleCollisions();
    const live=this.players.filter(p=>p.alive);
    return live.length===1?live[0]:null;
  }
  drawBackground(){
    const c=this.ctx;
    c.fillStyle='#000'; c.fillRect(0,0,CANVAS_W,CANVAS_H);
    c.fillStyle='#333'; for(const p of PLATFORMS) c.fillRect(p.x,p.y,p.w,p.h);
  }
  render(){ this.drawBackground(); for(const p of this.players) if(p.alive) p.render(this.ctx); }
}

/*────────────────────────────  Public API  ─────────────────────────────*/
async function startJoust(players = []) {
  if (!Array.isArray(players) || players.length < 3)
    throw new Error('startJoust() expects at least 3 player objects');

  /* pull current record */
  let highScores = [...EMBEDDED_HIGH_SCORES];    // clone so the original stays pristine


  /* canvas / ctx */
  const canvas = document.getElementById('game');
  if (!canvas) throw new Error('Canvas with id="game" not found!');
  canvas.width = CANVAS_W; canvas.height = CANVAS_H;
  const ctx    = canvas.getContext('2d');

  /* promise for caller */
  let resolveWin;
  const winnerP = new Promise(res => (resolveWin = res));

  await preloadSprites();

  const arena = new Arena(players, ctx);

  /* ───── local state machine ───── */
  let phase          = 'countdown';                   // countdown → combat → victory
  let countdownTicks = COUNTDOWN_START * FPS;
  let victoryTicks   = 0;
  let newHsTicks     = 0;
  let hsTicks        = 0;

  let championEntity = null;
  let gotNewRecord   = false;
  const birdAnim     = { x: 10, dir: 1, ticks: 0 };      // lil victory walker


  /* draw helpers */
  function drawCountdown(sec){
    arena.drawBackground();
    arena.render();
    ctx.fillStyle = '#fff';
    ctx.font      = '48px monospace';
    ctx.textAlign = 'center';
    ctx.fillText(`Comment Coliseum Starts In: ${sec}`, CANVAS_W/2, 80);
  }
  function drawVictory(ent){
    arena.drawBackground();
    const frames = SPRITES.fly;
    const img    = frames[(Math.floor((VICTORY_SECONDS*FPS-victoryTicks)/8)%frames.length)];
    const sc     = 4;
    ctx.save();
    ctx.translate(CANVAS_W/2, CANVAS_H/2);
    if (ent.vx < 0) ctx.scale(-1,1);
    ctx.drawImage(SPRITES.rider, -SPRITES.rider.width*sc/2, (-img.height*sc/2)+12, SPRITES.rider.width*sc, SPRITES.rider.height*sc);
    ctx.drawImage(img, -img.width*sc/2, -img.height*sc/2, img.width*sc, img.height*sc);
    ctx.restore();
    ctx.fillStyle='#fff'; ctx.font='48px monospace'; ctx.textAlign='center';
    ctx.fillText(`${ent.user} – Victory!`, CANVAS_W/2, 80);
  }
  function drawNewHs(ent){
    arena.drawBackground();
    ctx.fillStyle='#fff'; ctx.font='64px monospace'; ctx.textAlign='center';
    ctx.fillText('★ NEW HIGH SCORE! ★', CANVAS_W/2, CANVAS_H/2-30);
    ctx.font='32px monospace';
    ctx.fillText(`${ent.user}: ${ent.score}`, CANVAS_W/2, CANVAS_H/2+26);
  }
function drawHsScreen(list){
  arena.drawBackground();

  /* headline */
  ctx.fillStyle = '#fff';
  ctx.font      = '48px monospace';
  ctx.textAlign = 'center';
  ctx.fillText('HIGH SCORES', CANVAS_W/2, 70);

  /* table */
  ctx.font      = '32px monospace';
  ctx.textAlign = 'left';
  const colW   = CANVAS_W / 2;
  const startY = 140;
  const rowH   = 36;

  for (let i = 0; i < HIGH_SCORE_ENTRIES; i++){
    const entry = list[i] || { name: DEFAULT_HS_NAME, score: 0 };
    const col   = (i < 5) ? 0 : 1;
    const row   = i % 5;
    const x     = (col === 0) ? CANVAS_W/2 - colW + 40 : CANVAS_W/2 + 40;
    const y     = startY + row * rowH;
    ctx.fillText(`${(i+1).toString().padStart(2,'0')}. ${entry.name.slice(0,4)}  ${entry.score}`, x, y);
  }

  /* walker sprite */
  const frame = SPRITES.walk[Math.floor(birdAnim.ticks / 8) % SPRITES.walk.length];
  const bw    = frame.width  * SPRITE_SCALE;
  const bh    = frame.height * SPRITE_SCALE;
  ctx.save();
  ctx.translate(birdAnim.dir === -1 ? birdAnim.x + bw : birdAnim.x,
                CANVAS_H - bh - 10);
  ctx.scale(birdAnim.dir, 1);
  ctx.drawImage(frame, 0, 0, bw, bh);
  ctx.restore();
}


  /* main loop */
  let last = performance.now();
  function tick(now){
    if (now - last < FRAME_MS){ requestAnimationFrame(tick); return; }
    last = now;

    switch (phase){
      case 'countdown': {
        drawCountdown(Math.ceil(countdownTicks/FPS));
        if (--countdownTicks === 0) phase = 'combat';
        break;
      }
      case 'combat': {
        const champ = arena.step();
        arena.render();
        if (champ){
          championEntity = champ;
          victoryTicks   = VICTORY_SECONDS*FPS;
          phase          = 'victory';
        }
        break;
      }
      case 'victory': {
        drawVictory(championEntity);
        if (--victoryTicks === 0){
          const prevTop = highScores[0]?.score || 0;

/* insert champion, sort & trim */
highScores.push({ name: championEntity.user, score: championEntity.score });
highScores.sort((a,b) => b.score - a.score);
if (highScores.length > HIGH_SCORE_ENTRIES) highScores.length = HIGH_SCORE_ENTRIES;

gotNewRecord = championEntity.score > prevTop;
/* scores stay in-memory only – edit EMBEDDED_HIGH_SCORES above for permanent changes */


if (gotNewRecord){
  newHsTicks = NEW_HS_SECONDS*FPS;
  phase      = 'newHigh';
} else {
  hsTicks = HIGH_SCORE_SCREEN*FPS;
  phase   = 'highScore';
}

        }
        break;
      }
      case 'newHigh': {
        drawNewHs(championEntity);
        if (--newHsTicks === 0){
          hsTicks = HIGH_SCORE_SCREEN*FPS;
          phase   = 'highScore';
        }
        break;
      }
      case 'highScore': {
        /* little bird pacing */
        birdAnim.ticks++;
        birdAnim.x += birdAnim.dir * 2;
        const maxX = CANVAS_W - SPRITES.walk[0].width * SPRITE_SCALE - 10;
        if (birdAnim.x > maxX){ birdAnim.x = maxX; birdAnim.dir = -1; }
        if (birdAnim.x < 10)  { birdAnim.x = 10;   birdAnim.dir =  1; }

        drawHsScreen(highScores);
        if (--hsTicks === 0){
          resolveWin(championEntity.user);
          return;                       // stop loop
        }
        break;
      }
    }
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  return winnerP;
}


window.startJoust = startJoust;
})(); /* keep file-end shim intact */
