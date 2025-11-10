// @downloadURL  https://cdn.jsdelivr.net/gh/yheiakadylan/collectlisting@v1.2.1/path/etsy-txt-to-csv.user.js
// @updateURL    https://cdn.jsdelivr.net/gh/yheiakadylan/collectlisting@latest/path/etsy-txt-to-csv.user.js
// ==UserScript==
// @name         Etsy TXT -> CSV (title + folder)
// @namespace    https://hapidecor-tools
// @version      1.2.1
// @description  Đọc TXT (mỗi dòng 1 URL listing hoặc shop). Với shop: gom link listing từ tab Items (auto-scroll). Vào từng listing: đợi popup Tags render, ghép Title + 13 tags. Tùy chọn: bấm “Download All Images” và CHỜ (hoặc bỏ qua). Export CSV: title,col2 (col2 = downloadFolder/listing-<id>-images).
// @match        *://*.etsy.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_download
// ==/UserScript==

(function () {
  'use strict';

  // ============================
  // KEYS + DEFAULT SETTINGS
  // ============================
  const SKEY_SETTINGS = 'elc_settings';
  const SKEY_ROWS     = 'elc_rows';
  const SKEY_QUEUE    = 'elc_queue';
  const SKEY_STATE    = 'elc_state';
  const SKEY_LOGS     = 'elc_logs';
  const SKEY_NAV_TS   = 'elc_last_nav_ts';

  const DEF = {
    waitMs: 4000,
    deepScan: true,
    slowMode: false,
    shopPages: 2,            // tối đa N trang Items / shop
    maxListingsPerShop: 60,  // giới hạn số listing / shop
    imgFolderWin: 'C:\\Users\\pcx.vn\\Downloads', // gốc folder tải ảnh
    navCooldownMs: 2500,

    // ---- Tải ảnh (có thể TẮT) ----
    downloadEnabled: true,   // <== TÙY CHỌN MỚI
    downloadQuietMs: 3000,   // thời gian yên lặng mạng để xem là đã xong
    maxDownloadWaitMs: 60000 // timeout tối đa chờ tải ảnh
  };

  // ============================
  // STORAGE + LOGGING
  // ============================
  const gmGet=(k,def)=>{try{const v=GM_getValue(k);return v===undefined?def:v;}catch{const v2=localStorage.getItem(k);return v2?JSON.parse(v2):def;}}; // eslint-disable-line
  const gmSet=(k,v)=>{try{GM_setValue(k,v);}catch{localStorage.setItem(k,JSON.stringify(v));}}; // eslint-disable-line
  const LOG_LIMIT=1200;
  function log(level, ...parts){
    const logs=gmGet(SKEY_LOGS,[]);
    const msg=parts.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');
    logs.push({ts:Date.now(),level,msg});
    if(logs.length>LOG_LIMIT) logs.splice(0,logs.length-LOG_LIMIT);
    gmSet(SKEY_LOGS,logs);
    (level==='error'?console.error:level==='warn'?console.warn:console.log)('[EtsyCSV]', msg);
    renderLogsToUI();
  }
  const info=(...a)=>log('info',...a);
  const warn=(...a)=>log('warn',...a);
  const error=(...a)=>log('error',...a);

  // ============================
  // URL / CANONICAL HELPERS
  // ============================
  function isListingUrl(u){ return /\/listing\/\d+/.test(u); }
  function isShopUrl(u){ return /\/shop\//.test(u); }
  function getListingId(u){
    try{ const url=new URL(u, location.origin); const m=url.pathname.match(/\/listing\/(\d+)/); return m?m[1]:'';}
    catch{ return ''; }
  }
  function canonicalListingUrl(u){
    const id=getListingId(u);
    return id ? `https://www.etsy.com/listing/${id}` : u.split('#')[0].split('?')[0];
  }
  function ensureShopItemsTab(u){
    try{
      const url=new URL(u, location.origin);
      if(url.pathname.startsWith('/shop/') && !url.searchParams.has('tab')) url.searchParams.set('tab','items');
      return url.toString();
    }catch{ return u; }
  }
  function shopKeyFrom(u){
    try{
      const url=new URL(u, location.origin);
      let base=(url.origin+url.pathname).replace(/\/+$/,'');
      const params=new URLSearchParams(url.search);
      if(url.pathname.startsWith('/shop/') && !params.has('tab')) params.set('tab','items');
      params.delete('page');
      const qs=params.toString();
      return qs ? (base+'?'+qs) : base;
    }catch{ return u.split('#')[0].split('?')[0]; }
  }
  function isSameTarget(current, target){
    const cur=current.split('#')[0], tar=target.split('#')[0];
    if(isListingUrl(cur)&&isListingUrl(tar)) return getListingId(cur)===getListingId(tar);
    if(isShopUrl(cur)&&isShopUrl(tar)) return shopKeyFrom(cur)===shopKeyFrom(tar);
    try{
      const A=new URL(cur); A.search=''; A.hash='';
      const B=new URL(tar); B.search=''; B.hash='';
      return A.toString()===B.toString();
    }catch{ return cur.split('?')[0]===tar.split('?')[0]; }
  }
  function normalizeNoHash(u){ try{ const url=new URL(u, location.origin); url.hash=''; return url.toString(); }catch{ return u.split('#')[0]; } }

  // ============================
  // DOM / WAIT HELPERS
  // ============================
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  async function waitFor(sel, timeout=8000, step=200){
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){
      const el=document.querySelector(sel);
      if(el) return el;
      await sleep(step);
    }
    return null;
  }
  async function autoScroll(maxMs=8000, step=800){
    const deadline=Date.now()+maxMs; let lastH=0;
    while(Date.now()<deadline){
      window.scrollTo(0,document.documentElement.scrollHeight);
      await sleep(step);
      const h=document.documentElement.scrollHeight;
      if(h===lastH) break; lastH=h;
    }
    window.scrollTo(0,0);
  }

  // ============================
  // NETWORK WATCHER
  // ============================
  let NET_ACTIVE = 0;
  let NET_LAST_TS = 0;
  let NET_PATCHED = false;

  function shouldTrackUrl(url){
    try{
      const u = String(url);
      return /\/il\//.test(u) // ảnh Etsy thường /il/
          || /\.jpe?g($|\?)/i.test(u)
          || /\.png($|\?)/i.test(u)
          || /\.webp($|\?)/i.test(u)
          || /download|images|zip/i.test(u);
    }catch{ return false; }
  }

  function patchNetworkOnce(){
    if (NET_PATCHED) return;
    NET_PATCHED = true;
    const _fetch = window.fetch;
    window.fetch = function(...args){
      try{ if(shouldTrackUrl(args?.[0])) { NET_ACTIVE++; NET_LAST_TS=Date.now(); } }catch{}
      return _fetch.apply(this,args).finally(()=>{ try{ if(shouldTrackUrl(args?.[0])) { NET_ACTIVE=Math.max(0,NET_ACTIVE-1); NET_LAST_TS=Date.now(); } }catch{} });
    };
    const _open = XMLHttpRequest.prototype.open;
    const _send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function(method,url,...rest){
      try{ this.__track = shouldTrackUrl(url); }catch{ this.__track=false; }
      return _open.call(this, method, url, ...rest);
    };
    XMLHttpRequest.prototype.send = function(...args){
      if(this.__track){ NET_ACTIVE++; NET_LAST_TS=Date.now();
        this.addEventListener('loadend', ()=>{ NET_ACTIVE=Math.max(0,NET_ACTIVE-1); NET_LAST_TS=Date.now(); }, {once:true});
      }
      return _send.apply(this,args);
    };
    info('network monitor patched');
  }

  async function waitForNetworkIdle({quietMs, maxWaitMs}){
    const start = Date.now();
    let seenAnyActivity = false;
    patchNetworkOnce();
    while (Date.now() - start < maxWaitMs){
      if (NET_ACTIVE>0) seenAnyActivity = true;
      const since = Date.now() - (NET_LAST_TS||0);
      if (seenAnyActivity && NET_ACTIVE===0 && since >= quietMs){
        info('network idle OK', {since, quietMs});
        return true;
      }
      await sleep(250);
    }
    warn('waitForNetworkIdle timeout', {maxWaitMs});
    return false;
  }

  async function waitForButtonSettle(btn, {maxWaitMs}){
    const start=Date.now();
    const getState=()=>{
      const t=(btn.textContent||'').trim();
      const dis = btn.disabled || btn.getAttribute('aria-disabled')==='true';
      return {t,dis};
    };
    let enteredBusy=false;
    while(Date.now()-start<maxWaitMs){
      const s=getState();
      if(!enteredBusy){
        if(s.dis || /downloading|processing|please wait|đang|generating/i.test(s.t)){
          enteredBusy=true;
        }
      }else{
        if(!s.dis && !/downloading|processing|please wait|đang|generating/i.test(s.t)){
          info('download button settled');
          return true;
        }
      }
      await sleep(300);
    }
    warn('waitForButtonSettle timeout');
    return false;
  }

  async function waitDownloadsSmart(btn, settings){
    const {downloadQuietMs, maxDownloadWaitMs} = settings;
    const t0 = Date.now();
    const p1 = waitForNetworkIdle({quietMs: downloadQuietMs, maxWaitMs: maxDownloadWaitMs});
    const p2 = btn ? waitForButtonSettle(btn, {maxWaitMs: maxDownloadWaitMs}) : Promise.resolve(false);
    let done=false;
    await Promise.race([
      p1.then(v=>{ if(v) done=true; }),
      p2.then(v=>{ if(v) done=true; })
    ]);
    if(!done){
      const left = Math.max(0, maxDownloadWaitMs - (Date.now()-t0));
      await waitForNetworkIdle({quietMs: downloadQuietMs, maxWaitMs: left});
    }
  }

  // ============================
  // PANEL UI
  // ============================
  function ensurePanel(){ if(document.getElementById('elc_panel')) return; createPanel(); }
  function createPanel(){
    const style=document.createElement('style'); style.textContent=`
#elc_panel{position:fixed;z-index:999999;right:16px;bottom:16px;width:520px;max-height:80vh;overflow:hidden;font-family:Inter,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
#elc_panel header{padding:10px 12px;font-weight:600;display:flex;align-items:center;justify-content:space-between;background:#0b1220;border-bottom:1px solid #334155;cursor:move}
#elc_panel header .btns{display:flex;gap:8px}
#elc_panel header button{background:#1f2937;color:#e5e7eb;border:1px solid #334155;border-radius:8px;padding:4px 8px;font-size:12px}
#elc_panel .body{padding:10px;display:flex;flex-direction:column;gap:10px;height:calc(80vh - 56px);overflow:auto}
#elc_panel input,#elc_panel select{width:100%;background:#0b1220;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:8px;outline:none}
#elc_panel .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
#elc_panel .row{display:flex;gap:8px}
#elc_panel .row>button{flex:1;background:#2563eb;border:none;color:#fff;padding:8px 10px;border-radius:8px;font-weight:600}
#elc_panel .row>button.secondary{background:#374151}
#elc_logs{font-family:ui-monospace,Menlo,monospace;background:#000;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:8px;height:200px;overflow:auto;white-space:pre-wrap}
#elc_toast{position:fixed;bottom:100px;right:24px;background:#0f172a;color:#e2e8f0;border:1px solid #334155;padding:10px 12px;border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.35);z-index:1000000;opacity:0;transform:translateY(10px);transition:all .25s ease}
`; document.head.appendChild(style);

    const panel=document.createElement('div'); panel.id='elc_panel'; panel.innerHTML=`
<header>
  <div>📥 Etsy TXT → CSV (title + folder)</div>
  <div class="btns">
    <button id="elc_min">–</button>
    <button id="elc_close">✕</button>
  </div>
</header>
<div class="body">
  <div class="grid">
    <div><label>Wait per listing (ms)</label><input id="elc_wait" type="number" min="0"/></div>
    <div><label>State</label><input id="elc_state" disabled/></div>
  </div>
  <div class="grid">
    <div><label><input type="checkbox" id="elc_deep"/> Deep Scan (auto-scroll)</label></div>
    <div><label><input type="checkbox" id="elc_slow"/> Slow Mode</label></div>
  </div>
  <div class="grid">
    <div><label>Shop pages</label><input id="elc_shopPages" type="number" min="1"/></div>
    <div><label>Max listings / shop</label><input id="elc_maxShop" type="number" min="1"/></div>
  </div>
  <div class="grid">
    <div><label>Windows Downloads folder</label><input id="elc_imgRoot" placeholder="C:\\\\Users\\\\pcx.vn\\\\Downloads"/></div>
    <div><label><input type="checkbox" id="elc_download"/> Tải ảnh & đợi xong</label></div>
  </div>
  <div class="grid">
    <div><label>Quiet after downloads (ms)</label><input id="elc_qms" type="number" min="500"/></div>
    <div><label>Max wait downloads (ms)</label><input id="elc_mdw" type="number" min="1000"/></div>
  </div>
  <div class="row">
    <input id="elc_file" type="file" accept=".txt"/>
    <button id="elc_load" class="secondary">Load TXT</button>
  </div>
  <div class="row">
    <button id="elc_start">Start</button>
    <button id="elc_export" class="secondary">Export CSV</button>
  </div>
  <div class="row">
    <button id="elc_clear" class="secondary">Clear data</button>
  </div>
  <div id="elc_stats">Stats: (chưa chạy)</div>
  <div id="elc_logs">(no logs yet)</div>
</div>`;
    document.body.appendChild(panel);

    makeDraggable(panel, panel.querySelector('header'));

    const waitInput = panel.querySelector('#elc_wait');
    const deepChk   = panel.querySelector('#elc_deep');
    const slowChk   = panel.querySelector('#elc_slow');
    const shopPagesInput = panel.querySelector('#elc_shopPages');
    const maxShopInput   = panel.querySelector('#elc_maxShop');
    const imgRootInput   = panel.querySelector('#elc_imgRoot');
    const downloadChk    = panel.querySelector('#elc_download');
    const qmsInput       = panel.querySelector('#elc_qms');
    const mdwInput       = panel.querySelector('#elc_mdw');
    const stateInput     = panel.querySelector('#elc_state');
    const fileInput      = panel.querySelector('#elc_file');
    const logsBox        = panel.querySelector('#elc_logs');
    const statsBox       = panel.querySelector('#elc_stats');

    const cfg = Object.assign({}, DEF, gmGet(SKEY_SETTINGS, {}));
    waitInput.value      = cfg.waitMs;
    deepChk.checked      = cfg.deepScan;
    slowChk.checked      = cfg.slowMode;
    shopPagesInput.value = cfg.shopPages;
    maxShopInput.value   = cfg.maxListingsPerShop;
    imgRootInput.value   = cfg.imgFolderWin;
    downloadChk.checked  = cfg.downloadEnabled;
    qmsInput.value       = cfg.downloadQuietMs;
    mdwInput.value       = cfg.maxDownloadWaitMs;

    panel.querySelector('#elc_min').onclick=()=>{
      const body=panel.querySelector('.body');
      body.style.display = (body.style.display==='none') ? '' : 'none';
    };
    panel.querySelector('#elc_close').onclick=()=>panel.remove();

    panel.querySelector('#elc_load').onclick=async()=>{
      if(!fileInput.files?.length){ toast('Chọn file .txt trước'); return; }
      const text = await fileInput.files[0].text();
      const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      const normalized = lines.map(u=>{
        if (isListingUrl(u)) return canonicalListingUrl(u);
        if (isShopUrl(u))    return ensureShopItemsTab(u);
        return u;
      });
      gmSet(SKEY_QUEUE, normalized);
      gmSet(SKEY_STATE, 'ready');
      updateStats(); updateState();
      toast(`Loaded ${normalized.length} dòng từ TXT`);
      info('Loaded TXT lines', normalized.length);
    };

    panel.querySelector('#elc_start').onclick=()=>{
      const settings = {
        waitMs: Math.max(0, Number(waitInput.value)||0),
        deepScan: !!deepChk.checked,
        slowMode: !!slowChk.checked,
        shopPages: Math.max(1, Number(shopPagesInput.value)||1),
        maxListingsPerShop: Math.max(1, Number(maxShopInput.value)||1),
        imgFolderWin: String(imgRootInput.value||DEF.imgFolderWin),
        navCooldownMs: DEF.navCooldownMs,
        downloadEnabled: !!downloadChk.checked, // <== dùng để bật/tắt tải ảnh
        downloadQuietMs: Math.max(500, Number(qmsInput.value)||DEF.downloadQuietMs),
        maxDownloadWaitMs: Math.max(1000, Number(mdwInput.value)||DEF.maxDownloadWaitMs),
      };
      gmSet(SKEY_SETTINGS, settings);
      const q = gmGet(SKEY_QUEUE, []);
      if(!q.length){ toast('Queue trống: hãy Load TXT trước'); return; }
      gmSet(SKEY_STATE, 'running');
      updateState();
      toast(`Start. Queue=${q.length}`);
      stepRunner();
    };

    panel.querySelector('#elc_export').onclick=exportCSV;
    panel.querySelector('#elc_clear').onclick=()=>{
      gmSet(SKEY_ROWS,[]);
      gmSet(SKEY_QUEUE,[]);
      gmSet(SKEY_STATE,'idle');
      gmSet(SKEY_LOGS,[]);
      gmSet(SKEY_NAV_TS,0);
      updateStats(); updateState(); renderLogsToUI();
      toast('Đã clear dữ liệu');
    };

    function updateStats(){
      const rows=gmGet(SKEY_ROWS,[]);
      const q=gmGet(SKEY_QUEUE,[]);
      statsBox.textContent=`Stats: rows=${rows.length} | queue=${q.length}`;
    }
    function updateState(){ stateInput.value=gmGet(SKEY_STATE,'idle'); }
    function stepRunner(){
      if(gmGet(SKEY_STATE,'idle')!=='running') return;
      runStep().then(()=>{ updateStats(); updateState(); });
    }
    if(gmGet(SKEY_STATE,'idle')==='running') setTimeout(stepRunner, 400);

    window.__elc_renderLogs = renderLogsToUI;
    window.__elc_updateStats = updateStats;
    window.__elc_updateState = updateState;

    function renderLogsToUI(){
      const logs = gmGet(SKEY_LOGS,[]);
      const fmt=ts=>{const d=new Date(ts); const p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;};
      logsBox.textContent = logs.map(l=>`[${fmt(l.ts)}] ${String(l.level||'').toUpperCase()} ${l.msg||''}`).join('\n') || '(no logs yet)';
      logsBox.scrollTop = logsBox.scrollHeight;
    }
    renderLogsToUI();
  }

  function renderLogsToUI(){ try{ window.__elc_renderLogs && window.__elc_renderLogs(); }catch{} }
  function updateStats(){ try{ window.__elc_updateStats && window.__elc_updateStats(); }catch{} }
  function updateState(){ try{ window.__elc_updateState && window.__elc_updateState(); }catch{} }

  // ============================
  // TOAST + DRAG
  // ============================
  let toastTimer=null;
  function toast(text){
    let node=document.getElementById('elc_toast');
    if(!node){ node=document.createElement('div'); node.id='elc_toast'; document.body.appendChild(node); }
    node.textContent=text; node.style.opacity='1'; node.style.transform='translateY(0)';
    clearTimeout(toastTimer);
    toastTimer=setTimeout(()=>{ node.style.opacity='0'; node.style.transform='translateY(10px)'; }, 2500);
    info('toast', text);
  }
  function makeDraggable(panel,handle){
    let ox=0,oy=0,px=0,py=0,drag=false;
    handle.addEventListener('mousedown',e=>{drag=true;px=e.clientX;py=e.clientY;const r=panel.getBoundingClientRect();ox=r.left;oy=r.top;e.preventDefault();});
    document.addEventListener('mousemove',e=>{if(!drag) return; const dx=e.clientX-px, dy=e.clientY-py; panel.style.left=`${ox+dx}px`; panel.style.top=`${oy+dy}px`; panel.style.right='auto'; panel.style.bottom='auto';});
    document.addEventListener('mouseup',()=>drag=false);
  }

  // ============================
  // RUNNER (LOCK + COOLDOWN)
  // ============================
  let STEP_LOCK=false;
  function navCooldownOk(minMs){
    const last=Number(gmGet(SKEY_NAV_TS,0))||0;
    return (Date.now()-last)>=minMs;
  }
  function markNavigated(){ gmSet(SKEY_NAV_TS, Date.now()); }

  async function runStep(){
    if (STEP_LOCK) return;
    STEP_LOCK = true;
    try{
      const q = gmGet(SKEY_QUEUE, []);
      const settings = Object.assign({}, DEF, gmGet(SKEY_SETTINGS, {}));
      if (!q.length) {
        gmSet(SKEY_STATE,'idle'); toast('✅ Done. Queue empty.'); info('Queue finished'); return;
      }

      const target = q[0];
      const cur = normalizeNoHash(location.href);

      if (!isSameTarget(cur, target)) {
        if (!navCooldownOk(settings.navCooldownMs)) { info('nav cooldown, skip'); return; }
        info('navigate to target', {target});
        markNavigated();
        location.href = target;
        return;
      }

      // Already on target
      if (isShopUrl(target) && !isListingUrl(target)) {
        await handleShopPage(target, settings);
        const qq = gmGet(SKEY_QUEUE, []).slice(1); // drop shop url
        gmSet(SKEY_QUEUE, qq);
        if (qq.length) {
          if (!navCooldownOk(settings.navCooldownMs)) { info('nav cooldown after shop'); return; }
          markNavigated();
          location.href = qq[0];
        } else {
          gmSet(SKEY_STATE,'idle'); toast('✅ Done. Queue empty.');
        }
        return;
      }

      // Listing page
      await handleListingPage(target, settings);

      const qq2 = gmGet(SKEY_QUEUE, []).slice(1);
      gmSet(SKEY_QUEUE, qq2);
      if (qq2.length) {
        if (!navCooldownOk(settings.navCooldownMs)) { info('nav cooldown after listing'); return; }
        markNavigated();
        location.href = qq2[0];
      } else {
        gmSet(SKEY_STATE,'idle'); toast('✅ Done. Queue empty.');
      }
    } finally {
      STEP_LOCK=false;
    }
  }

  // ============================
  // SHOP HANDLER
  // ============================
  async function handleShopPage(shopUrl, settings){
    info('handleShopPage', shopUrl);
    const base = ensureShopItemsTab(shopUrl);
    const listingSet = new Set();

    const collectFromDOM = ()=>{
      document.querySelectorAll('a.listing-link, a[href*="/listing/"]').forEach(a=>{
        if(a.href && /\/listing\/\d+/i.test(a.href)) listingSet.add(canonicalListingUrl(a.href));
      });
    };

    const totalPages = Math.max(1, settings.shopPages||1);
    for (let p=1; p<=totalPages; p++){
      try{
        const u=new URL(base, location.origin);
        u.searchParams.set('page', String(p));
        if (normalizeNoHash(location.href)!==u.toString()){
          if (!navCooldownOk(settings.navCooldownMs)) { info('nav cooldown inside shop'); return; }
          markNavigated();
          location.href = u.toString();
          await sleep(900);
          await waitFor('body', 6000);
        }
      }catch{}

      if (settings.deepScan) await autoScroll(settings.slowMode?14000:8000, 800);
      collectFromDOM();
      info('shop page collected', {p, count: listingSet.size});
      if (listingSet.size >= (settings.maxListingsPerShop||60)) break;
      await sleep(200 + (settings.slowMode?400:0));
    }

    // Merge to queue (dedupe)
    const qOld = gmGet(SKEY_QUEUE, []);
    const toAdd = Array.from(listingSet).slice(0, settings.maxListingsPerShop||60);
    const qSet = new Set(qOld);
    for (const u of toAdd) qSet.add(u);
    const merged = [qOld[0], ...Array.from(qSet).slice(1)];
    gmSet(SKEY_QUEUE, merged);
    toast(`Shop → thêm ${toAdd.length} listing vào queue`);
  }

  // ============================
  // LISTING HANDLER
  // ============================
  async function handleListingPage(listingUrl, settings){
    info('handleListingPage', listingUrl);

    // Title
    const titleNode = await waitFor('h1[data-buy-box-listing-title="true"]', Math.max(6000, settings.waitMs));
    const rawTitle = (titleNode?.textContent||'').trim();

    // Tags
    const tags = await waitTagsBlock(13000);
    const tags13 = tags.slice(0,13);
    const titleWithTags = joinTitleWithTags(rawTitle, tags13);

    // Tải ảnh nếu bật
    if (settings.downloadEnabled){
      const dlBtn = document.querySelector('#heyEtsyDownloadAllImages');
      if (dlBtn) {
        try{
          patchNetworkOnce();
          dlBtn.click();
          info('clicked Download All Images');
          await waitDownloadsSmart(dlBtn, settings);
          info('downloads finished (smart wait)');
        }catch(e){ warn('cannot click download btn', e); }
      } else {
        warn('download button not found (downloadEnabled=true)');
      }
    } else {
      info('download disabled → skip waiting images');
    }

    // Folder path cho col2
    const listingId = getListingId(listingUrl) || 'unknown';
    const folderPath = buildWindowsImageFolderPath(listingId, settings.imgFolderWin);

    // Push row (CSV: title, col2)
    const row = { title: titleWithTags, col2: folderPath };
    const rows=gmGet(SKEY_ROWS,[]); rows.push(row); gmSet(SKEY_ROWS, rows);

    info('row added', row);
    toast(`✅ Collected: ${rawTitle.slice(0,60)}…`);
    await sleep(200 + (settings.slowMode?400:0));
  }

  async function waitTagsBlock(timeout=12000){
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){
      const dd = document.querySelector('dd a[href*="etsy.com/search?q="]')?.closest('dd');
      const dt = dd?.previousElementSibling;
      const dtSpan = dt?.querySelector('span');
      if (dd && dtSpan && /Tags/i.test(dtSpan.textContent||'')) {
        const tags = Array.from(dd.querySelectorAll('a[href*="etsy.com/search?q="] .heyetsy-hover, dd a'))
          .map(el => (el.textContent||'').trim())
          .filter(Boolean);
        if (tags.length) return tags.map(toTitleCase);
      }
      const copyBtn = document.querySelector('dt button[onclick*="clipboard.writeText"]');
      if (copyBtn) {
        try{
          const attr = copyBtn.getAttribute('onclick') || '';
          const m = attr.match(/clipboard\.writeText\('([^']+)'\)/i);
          if (m && m[1]) {
            const list = m[1].split(/\s*,\s*/).filter(Boolean).map(toTitleCase);
            if (list.length) return list;
          }
        }catch{}
      }
      await sleep(200);
    }
    warn('tags popup not found/empty');
    return [];
  }

  function toTitleCase(s){ return s.replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()); }
  function joinTitleWithTags(title, tags){
    if(!tags.length) return title || '';
    return `${title} ${tags.join(', ')}`;
  }

  function buildWindowsImageFolderPath(listingId, root){
    return `${root}\\listing-${listingId}-images`;
  }

  // ============================
  // CSV EXPORT (title, col2)
  // ============================
  function exportCSV(){
    const rows = gmGet(SKEY_ROWS, []);
    if(!rows.length){ toast('Chưa có dữ liệu để export'); return; }
    const headers = ['title','col2']; // col2 = downloadFolder\listing-<id>-images
    const esc = (v)=>`"${String(v??'').replace(/"/g,'""')}"`;
    const body = rows.map(r => headers.map(h => esc(r[h]||'')).join(',')).join('\n');
    const csv = headers.join(',') + '\n' + body;

    try{
      GM_download({
        url: URL.createObjectURL(new Blob([csv], {type:'text/csv;charset=utf-8;'})),
        name: 'etsy_listing_title_col2.csv'
      });
      toast(`📦 Exported ${rows.length} rows`);
    }catch{
      const a=document.createElement('a');
      a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'}));
      a.download='etsy_listing_title_col2.csv';
      a.click();
    }
  }

  // ============================
  // BOOT / HOOKS
  // ============================
  function boot(){ try{ if(window.top!==window.self) return; ensurePanel(); }catch(e){ error('boot', e); } }
  (function hookHistory(){
    const p=history.pushState, r=history.replaceState;
    history.pushState=function(){const ret=p.apply(this,arguments); setTimeout(boot,50); return ret;};
    history.replaceState=function(){const ret=r.apply(this,arguments); setTimeout(boot,50); return ret;};
    window.addEventListener('popstate',()=>setTimeout(boot,50));
  })();
  const obs=new MutationObserver(()=>{ if(!document.getElementById('elc_panel')) ensurePanel(); });
  obs.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(boot,400);

})();
