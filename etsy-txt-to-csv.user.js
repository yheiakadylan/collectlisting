// ==UserScript==
// @name         Etsy TXT -> CSV 
// @namespace    https://hapidecor-tools
// @version      1.1.0
// @description  TXT mỗi dòng 1 URL listing. Lấy ảnh từ carousel (bỏ video) và tải ngay: listing-<id>-images_<idx>.<ext>. CSV: title = "Title — tag1, tag2, ... tag13", col2 = Downloads\listing-<id>-images
// @match        *://*.etsy.com/*
// @run-at       document-idle
// @grant        GM_getValue
// @grant        GM_setValue
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @connect      i.etsystatic.com
// @connect      img.etsystatic.com
// @connect      oimg.etsystatic.com
// @connect      v.etsystatic.com
// @connect      etsystatic.com
// ==/UserScript==

(function () {
  'use strict';

  // ===== Keys & Defaults =====
  const K_SET   = 'etz_fast_settings_v2';
  const K_ROWS  = 'etz_fast_rows_v2';
  const K_QUEUE = 'etz_fast_queue_v2';
  const K_STATE = 'etz_fast_state_v2';
  const K_LOGS  = 'etz_fast_logs_v2';
  const K_NAVTS = 'etz_fast_navts_v2';

  const DEF = {
    waitMs: 300,                 // nghỉ sau mỗi listing
    fetchConcurrency: 6,         // tải song song
    filenamePattern: '{idx}.jpg',
    imgRootHint: 'C:\\Users\\pcx.vn\\Downloads', // dùng cho CSV col2
    navCooldownMs: 600,
    logLimit: 1200,
    maxRetries: 3,               // retry khi tải ảnh lỗi
  };

  // ===== Utils =====
  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const gmGet=(k,d)=>{try{const v=GM_getValue(k);return v===undefined?d:v;}catch{const v2=localStorage.getItem(k);return v2?JSON.parse(v2):d;}};
  const gmSet=(k,v)=>{try{GM_setValue(k,v);}catch{localStorage.setItem(k,JSON.stringify(v));}};
  function log(level,...a){
    const L=gmGet(K_LOGS,[]), msg=a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');
    L.push({ts:Date.now(),level,msg}); const lim=(gmGet(K_SET,DEF).logLimit||DEF.logLimit); if(L.length>lim)L.splice(0,L.length-lim);
    gmSet(K_LOGS,L); (level==='error'?console.error:level==='warn'?console.warn:console.log)('[EtsyFAST]',msg);
    try{window.__etz_render&&window.__etz_render();}catch{}
  }
  const info=(...a)=>log('info',...a), warn=(...a)=>log('warn',...a), error=(...a)=>log('error',...a);

  function isListingUrl(u){ return /\/listing\/\d+/.test(u||''); }
  function getListingId(u){ try{ const m=new URL(u,location.origin).pathname.match(/\/listing\/(\d+)/); return m?m[1]:'';}catch{ return ''; } }
  function canonicalListingUrl(u){ const id=getListingId(u); return id?`https://www.etsy.com/listing/${id}`:String(u).split('#')[0].split('?')[0]; }
  function normalizeNoHash(u){ try{ const url=new URL(u,location.origin); url.hash=''; return url.toString(); }catch{ return String(u).split('#')[0]; } }
  async function waitFor(sel, timeout=8000, step=120){ const t=Date.now()+timeout; while(Date.now()<t){ const el=document.querySelector(sel); if(el) return el; await sleep(step);} return null; }
  function guessExt(u){ const m=(u||'').toLowerCase().match(/\.(jpe?g|png|webp|avif)(?:\?|$)/); return m?('.'+m[1]):'.jpg'; }

  function toTitleCase(s){
    return (s||'').replace(/\S+/g, w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase());
  }
  function prettyTitleWithTags(title, tags){
    const uniq = [];
    const seen = new Set();
    for (const t of tags) {
      const x = toTitleCase(String(t||'').trim());
      if (x && !seen.has(x.toLowerCase())) { seen.add(x.toLowerCase()); uniq.push(x); }
      if (uniq.length>=13) break;
    }
    if (!uniq.length) return title || '';
    return `${title || ''} — ${uniq.join(', ')}`;
  }

  // ===== Panel =====
  function ensurePanel(){ if(document.getElementById('etz_panel')) return; createPanel(); }
  function createPanel(){
    const st=document.createElement('style'); st.textContent=`
#etz_panel{position:fixed;z-index:2147483646;right:16px;bottom:16px;width:600px;max-height:82vh;overflow:hidden;font-family:Inter,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
#etz_panel header{padding:10px 12px;font-weight:600;display:flex;align-items:center;justify-content:space-between;background:#0b1220;border-bottom:1px solid #334155;cursor:move}
#etz_panel header button{background:#1f2937;color:#e5e7eb;border:1px solid #334155;border-radius:8px;padding:4px 8px;font-size:12px}
#etz_panel .body{padding:10px;display:flex;flex-direction:column;gap:10px;height:calc(82vh - 56px);overflow:auto}
#etz_panel input{width:100%;background:#0b1220;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:8px;outline:none}
#etz_panel .grid{display:grid;grid-template-columns:1fr 1fr;gap:10px}
#etz_panel .row{display:flex;gap:8px}
#etz_panel .row>button{flex:1;background:#2563eb;border:none;color:#fff;padding:8px 10px;border-radius:8px;font-weight:600}
#etz_panel .row>button.secondary{background:#374151}
#etz_panel .row>button.danger{background:#b91c1c}
#etz_logs{font-family:ui-monospace,Menlo,monospace;background:#000;border:1px solid #334155;border-radius:8px;padding:8px;height:220px;overflow:auto;white-space:pre-wrap}
.small{font-size:12px;color:#94a3b8}
`; document.head.appendChild(st);

    const box=document.createElement('div'); box.id='etz_panel'; box.innerHTML=`
<header>
  <div>⚡ Etsy TXT → CSV + Download (No ZIP)</div>
  <div><button id="etz_min">–</button> <button id="etz_close">✕</button></div>
</header>
<div class="body">
  <div class="grid">
    <div><label>Wait per listing (ms)</label><input id="etz_wait" type="number" min="0"/></div>
    <div><label>State</label><input id="etz_state" disabled/></div>
  </div>
  <div class="grid">
    <div><label>Fetch concurrency</label><input id="etz_conc" type="number" min="1" max="10"/></div>
    <div><label>Filename pattern</label><input id="etz_fname" placeholder="{idx}.jpg"/></div>
  </div>
  <div class="grid">
    <div><span class="small">CSV col2 root (tham chiếu)</span><input id="etz_imgRoot" placeholder="C:\\\\Users\\\\pcx.vn\\\\Downloads"/></div>
    <div></div>
  </div>
  <div class="row">
    <input id="etz_file" type="file" accept=".txt"/>
    <button id="etz_load" class="secondary">Load TXT</button>
  </div>
  <div class="row">
    <button id="etz_start">Start</button>
    <button id="etz_stop" class="secondary">Stop</button>
    <button id="etz_export" class="secondary">Export CSV</button>
  </div>
  <div class="row">
    <button id="etz_clear" class="danger">Clear data</button>
  </div>
  <div id="etz_stats">Stats: (chưa chạy)</div>
  <div id="etz_logs">(no logs yet)</div>
</div>`;
    document.body.appendChild(box);

    // drag
    (function makeDraggable(){
      let ox=0,oy=0,px=0,py=0,drag=false;
      const header=box.querySelector('header');
      header.addEventListener('mousedown',e=>{drag=true;px=e.clientX;py=e.clientY;const r=box.getBoundingClientRect();ox=r.left;oy=r.top;e.preventDefault();});
      document.addEventListener('mousemove',e=>{if(!drag) return; const dx=e.clientX-px, dy=e.clientY-py; box.style.left=`${ox+dx}px`; box.style.top=`${oy+dy}px`; box.style.right='auto'; box.style.bottom='auto';});
      document.addEventListener('mouseup',()=>drag=false);
    })();

    // wiring
    const cfg=Object.assign({},DEF,gmGet(K_SET,{}));
    const $=(s)=>box.querySelector(s);
    $('#etz_wait').value=cfg.waitMs;
    $('#etz_conc').value=cfg.fetchConcurrency;
    $('#etz_fname').value=cfg.filenamePattern;
    $('#etz_imgRoot').value=cfg.imgRootHint;

    $('#etz_min').onclick=()=>{ const b=box.querySelector('.body'); b.style.display=b.style.display==='none'?'':'none'; };
    $('#etz_close').onclick=()=>box.remove();

    $('#etz_load').onclick=async()=>{
      const f=$('#etz_file').files?.[0]; if(!f){ toast('Chọn file .txt'); return; }
      const lines=(await f.text()).split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      const urls=lines.map(canonicalListingUrl).filter(isListingUrl);
      gmSet(K_QUEUE, urls); gmSet(K_STATE,'ready');
      updateStats(); updateState(); toast(`Loaded ${urls.length} URL`);
      info('Loaded', urls.length);
    };

    $('#etz_start').onclick=()=>{
      const s={
        waitMs: +$('#etz_wait').value||0,
        fetchConcurrency: Math.min(10, Math.max(1, +$('#etz_conc').value||1)),
        filenamePattern: String($('#etz_fname').value||DEF.filenamePattern),
        imgRootHint: String($('#etz_imgRoot').value||DEF.imgRootHint),
        navCooldownMs: DEF.navCooldownMs,
        logLimit: DEF.logLimit,
        maxRetries: DEF.maxRetries,
      };
      gmSet(K_SET, s);
      const q=gmGet(K_QUEUE,[]); if(!q.length){ toast('Queue trống'); return; }
      gmSet(K_STATE,'running'); updateState(); toast(`Start (${q.length})`); stepRunner();
    };

    $('#etz_stop').onclick=()=>{ gmSet(K_STATE,'idle'); updateState(); toast('⏹ Stopped'); };
    $('#etz_export').onclick=exportCSV;
    $('#etz_clear').onclick=()=>{ gmSet(K_ROWS,[]); gmSet(K_QUEUE,[]); gmSet(K_LOGS,[]); gmSet(K_STATE,'idle'); gmSet(K_NAVTS,0); updateStats(); updateState(); try{window.__etz_render&&window.__etz_render();}catch{}; toast('Cleared'); };

    function updateStats(){ const rows=gmGet(K_ROWS,[]), q=gmGet(K_QUEUE,[]); $('#etz_stats').textContent=`Stats: rows=${rows.length} | queue=${q.length}`; }
    function updateState(){ $('#etz_state').value=gmGet(K_STATE,'idle'); }
    function renderLogs(){ const L=gmGet(K_LOGS,[]), box=document.getElementById('etz_logs'); const fmt=ts=>{const d=new Date(ts),p=n=>String(n).padStart(2,'0');return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`}; box.textContent=L.map(l=>`[${fmt(l.ts)}] ${l.level.toUpperCase()} ${l.msg}`).join('\n')||'(no logs yet)'; box.scrollTop=box.scrollHeight; }
    window.__etz_render=renderLogs; window.__etz_state=updateState; window.__etz_stats=updateStats; renderLogs();

    function stepRunner(){ if(gmGet(K_STATE,'idle')!=='running') return; runStep().then(()=>{ updateStats(); updateState(); }); }
    if(gmGet(K_STATE,'idle')==='running') setTimeout(stepRunner,300);
  }

  function toast(t){ console.log('[Toast]',t); }

  // ===== Runner =====
  let STEP_LOCK=false;
  function navOk(ms){ const last=+gmGet(K_NAVTS,0)||0; return (Date.now()-last)>=ms; }
  function markNav(){ gmSet(K_NAVTS, Date.now()); }

  async function runStep(){
    if(STEP_LOCK) return; STEP_LOCK=true;
    try{
      const q=gmGet(K_QUEUE,[]), cfg=Object.assign({},DEF,gmGet(K_SET,{}));
      if(!q.length){ gmSet(K_STATE,'idle'); toast('✅ Done'); return; }
      if(gmGet(K_STATE,'idle')!=='running') return;

      const target=q[0], cur=normalizeNoHash(location.href);
      if(canonicalListingUrl(cur)!==canonicalListingUrl(target)){
        if(!navOk(cfg.navCooldownMs)){ info('cooldown'); return; }
        info('navigate', {target}); markNav(); location.href=target; return;
      }

      await handleListing(target, cfg);
      if(gmGet(K_STATE,'idle')!=='running') return;

      const qq=q.slice(1); gmSet(K_QUEUE,qq);
      if(qq.length){ if(!navOk(cfg.navCooldownMs)){ info('cooldown after'); return; } markNav(); location.href=qq[0]; }
      else { gmSet(K_STATE,'idle'); toast('✅ Done'); }
    } finally { setTimeout(()=>{ STEP_LOCK=false; }, 30); }
  }

  // ===== Listing handler (fast, no ZIP) =====
  async function handleListing(listingUrl, cfg){
    const id=getListingId(listingUrl)||'unknown';
    info('handle listing', id);

    // Thu ảnh từ carousel (bỏ video)
    let imgs = collectThumbs();
    if(!imgs.length){ await waitFor('[data-carousel-pagination-list] [data-carousel-pagination-item]', 6000, 100); imgs=collectThumbs(); }
    info('images', {count: imgs.length});

    // Tải ảnh: song song, không thử tạo folder, không ZIP
    await downloadImagesFast(id, imgs, cfg);

    // CSV row: Title + 13 tags, format đẹp
    const titleNode = await waitFor('h1[data-buy-box-listing-title="true"]', 5000, 80);
    const rawTitle = (titleNode?.textContent||'').trim()||'';
    const tags = await getTagsUpTo13(12000);
    const finalTitle = prettyTitleWithTags(rawTitle, tags);

    const row = { title: finalTitle, col2: `${cfg.imgRootHint}\\listing-${id}-images` };
    const rows=gmGet(K_ROWS,[]); rows.push(row); gmSet(K_ROWS, rows);
    info('row', {id, folder: row.col2});
    await sleep(cfg.waitMs);
  }

  // Lấy ảnh từ thumbnails carousel (bỏ video)
  function collectThumbs(){
    const root = document.querySelector('[data-carousel-pagination-list]')?.closest('.wt-position-relative')
              || document.querySelector('.image-carousel-container') || document;
    const items = Array.from(root.querySelectorAll('[data-carousel-pagination-list] [data-carousel-pagination-item]'))
      .filter(li => !li.hasAttribute('data-carousel-thumbnail-video')
                 && !(li.getAttribute('data-image-id')||'').startsWith('listing-video'))
      .sort((a,b)=> (parseInt(a.getAttribute('data-index')||'0',10) - parseInt(b.getAttribute('data-index')||'0',10)));
    const seen=new Set(), urls=[];
    for(const li of items){
      const iid=li.getAttribute('data-image-id')||''; if(iid && seen.has(iid)) continue; if(iid) seen.add(iid);
      const img=li.querySelector('img'); const s=img?.getAttribute('src')||img?.getAttribute('data-src-delay')||''; if(!s) continue;
      const full=s.split('?')[0].replace(/\/il_\d+x\d+\./i,'/il_fullxfull.'); // ưu tiên full
      if(/etsystatic\.com/i.test(full)) urls.push(full);
    }
    return urls;
  }

  // Tải ảnh nhanh: luôn đặt tên listing-<id>-images_<idx>.<ext>, không thử subfolder
  async function downloadImagesFast(listingId, urls, cfg){
    const conc=Math.min(cfg.fetchConcurrency, Math.max(1, urls.length));
    let cursor=0, idx=0;

    async function worker(){
      while(gmGet(K_STATE,'idle')==='running'){
        if(cursor>=urls.length) break;
        const u=urls[cursor++]; const myIndex=++idx; const ext=guessExt(u);
        const base = cfg.filenamePattern.replace('{idx}', String(myIndex));
        const fname = base.endsWith(ext)?base:base+ext;                         // 1.jpg
        const finalName = `listing-${listingId}-images_${fname}`;               // listing-xxx-images_1.jpg

        try{
          const ab = await fetchABWithRetry(u, location.href, cfg.maxRetries);
          const blobUrl = URL.createObjectURL(new Blob([ab]));
          GM_download({ url: blobUrl, name: finalName, saveAs: false });
          info('download', {img: finalName});
        }catch(e){
          warn('download fail', {u, e:String(e)});
        }
        await sleep(5);
      }
    }
    await Promise.allSettled(Array.from({length:conc},()=>worker()));
  }

  // Lấy 13 tags (popup/khối mô tả)
  async function getTagsUpTo13(timeout=12000){
    const deadline=Date.now()+timeout;
    while(Date.now()<deadline){
      // Cách 1: khối dd/dt "Tags"
      const dd = document.querySelector('dd a[href*="etsy.com/search?q="]')?.closest('dd');
      const dt = dd?.previousElementSibling;
      const dtSpan = dt?.querySelector('span');
      if (dd && dtSpan && /Tags/i.test(dtSpan.textContent||'')) {
        const tags = Array.from(dd.querySelectorAll('a[href*="etsy.com/search?q="]'))
          .map(a => (a.textContent||'').trim()).filter(Boolean);
        if (tags.length) return tags.slice(0,13);
      }
      // Cách 2: nút copy tags (nếu có)
      const copyBtn = document.querySelector('dt button[onclick*="clipboard.writeText"]');
      if (copyBtn) {
        try{
          const attr = copyBtn.getAttribute('onclick') || '';
          const m = attr.match(/clipboard\.writeText\('([^']+)'\)/i);
          if (m && m[1]) {
            const list = m[1].split(/\s*,\s*/).filter(Boolean);
            if (list.length) return list.slice(0,13);
          }
        }catch{}
      }
      await sleep(150);
    }
    return [];
  }

  // Tải ảnh (ArrayBuffer) với retry nhẹ
  function fetchABWithRetry(url, referer, tries=3){
    const variants = makeVariants(url);
    let i=0, left=tries;
    return new Promise((resolve,reject)=>{
      const attempt=()=>{
        if(i>=variants.length || left<=0) return reject(new Error('exhausted'));
        const u=variants[i++]; const bust=(u.includes('?')?'&':'?')+'tmkx='+Date.now();
        try{
          GM_xmlhttpRequest({
            method:'GET', url:u+bust, responseType:'arraybuffer',
            headers:{'Referer':referer||location.href,'Origin':'https://www.etsy.com','Accept':'image/avif,image/webp,image/*,*/*;q=0.8','Cache-Control':'no-cache'},
            timeout:45000,
            onload:(res)=>{ if(res.status>=200&&res.status<300&&res.response) return resolve(res.response); left--; setTimeout(attempt,120); },
            onerror:()=>{ left--; setTimeout(attempt,160); },
            ontimeout:()=>{ left--; setTimeout(attempt,160); }
          });
        }catch(e){ left--; setTimeout(attempt,160); }
      }; attempt();
    });
  }
  function makeVariants(u){
    const clean=(u||'').split('?')[0]; const out=new Set();
    if(/\/il_fullxfull\./i.test(clean)){ out.add(clean); out.add(clean.replace(/\/il_fullxfull\./i,'/il_1588xN.')); out.add(clean.replace(/\/il_fullxfull\./i,'/il_794xN.')); }
    else if(/\/il_\d+x\d+\./i.test(clean)){ out.add(clean.replace(/\/il_\d+x\d+\./i,'/il_fullxfull.')); out.add(clean.replace(/\/il_\d+x\d+\./i,'/il_1588xN.')); out.add(clean.replace(/\/il_\d+x\d+\./i,'/il_794xN.')); }
    else { out.add(clean); }
    return Array.from(out);
  }

  // ===== CSV =====
  function exportCSV(){
    const rows=gmGet(K_ROWS,[]); if(!rows.length){ toast('Chưa có dữ liệu'); return; }
    const headers=['title','col2'], esc=v=>`"${String(v??'').replace(/"/g,'""')}"`;
    const body = rows.map(r => headers.map(h=>esc(r[h]||'')).join(',')).join('\n');
    const csv = headers.join(',')+'\n'+body;
    try{ GM_download({url:URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})),name:'etsy_listing_title_col2.csv'}); }
    catch{ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8;'})); a.download='etsy_listing_title_col2.csv'; a.click(); }
  }

  // ===== Boot =====
  function boot(){ try{ if(window.top!==window.self) return; ensurePanel(); }catch(e){ error('boot',e); } }
  (function hookHistory(){ const p=history.pushState,r=history.replaceState; history.pushState=function(){const ret=p.apply(this,arguments); setTimeout(boot,50); return ret;}; history.replaceState=function(){const ret=r.apply(this,arguments); setTimeout(boot,50); return ret;}; window.addEventListener('popstate',()=>setTimeout(boot,50)); })();
  const obs=new MutationObserver(()=>{ if(!document.getElementById('etz_panel')) ensurePanel(); }); obs.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(boot,350);

})();
