// ==UserScript==
// @name         Etsy Collect URL Listing
// @namespace    https://hapidecor-tools
// @version      3.0.5
// @description  Truy cập shop → gõ keyword 1 lần (thấy rõ) → lấy URL trong grid → chuyển trang bằng chính nút trong khối .wt-action-group (data-page) → lặp. Ổn định khi Etsy ẩn ?page.
// @match        *://*.etsy.com/*
// @run-at       document-idle
// @grant        GM_download
// ==/UserScript==

(function () {
  'use strict';

  const K_PLAN  = 'elu_plan_live_min';
  const K_STATE = 'elu_state_live_min';
  const K_LOGS  = 'elu_logs_live_min';

  const sleep=(ms)=>new Promise(r=>setTimeout(r,ms));
  const jget=(k,def)=>{ try{const v=sessionStorage.getItem(k);return v?JSON.parse(v):def;}catch{return def;} };
  const jset=(k,v)=>{ try{sessionStorage.setItem(k,JSON.stringify(v));}catch{} };
  const now=()=>{const d=new Date();const p=n=>String(n).padStart(2,'0');return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;};
  function log(level,...a){const L=jget(K_LOGS,[]);const msg=a.map(x=>typeof x==='string'?x:JSON.stringify(x)).join(' ');L.push({ts:Date.now(),level,msg});if(L.length>1200)L.splice(0,L.length-1200);jset(K_LOGS,L);(level==='error'?console.error:console.log)(`[EtsyLIVE ${now()}] ${level.toUpperCase()} ${msg}`);try{window.__elu_render&&window.__elu_render();}catch{}}

  // ---------- URL helpers ----------
  function ensureItems(u){
    try{ const url=new URL(u, location.origin);
      if(url.pathname.startsWith('/shop/') && !url.searchParams.has('tab')) url.searchParams.set('tab','items');
      return url.toString();
    }catch{ return u; }
  }
  function canonicalListing(u){
    try{ const url=new URL(u, location.origin);
      const m=url.pathname.match(/\/listing\/(\d+)/i);
      return m?`https://www.etsy.com/listing/${m[1]}`:u.split('#')[0].split('?')[0];
    }catch{ return u.split('#')[0].split('?')[0]; }
  }
  // /shop/<slug> và /shop/<slug>/search cùng scope
  function inShopScope(currentUrl, planShopUrl){
    try{
      const cur=new URL(currentUrl, location.origin);
      const base=new URL(ensureItems(planShopUrl), location.origin);
      if(cur.origin!==base.origin) return false;
      const m=base.pathname.match(/^\/shop\/[^/]+/i);
      const prefix = m ? m[0] : base.pathname;
      return cur.pathname.startsWith(prefix);
    }catch{ return false; }
  }

  // ---------- Pagination helpers ----------
  function getPaginationScope(){
    return document.querySelector('[data-item-pagination] .wt-action-group')
        || document.querySelector('[data-item-pagination] nav[aria-label*="Pagination"] .wt-action-group')
        || document.querySelector('[data-item-pagination]')
        || document.querySelector('nav[aria-label*="Pagination"]');
  }
  function readCurrentPageFromDOM(){
    const scope = getPaginationScope(); if(!scope) return null;
    const curr = scope.querySelector('.wt-is-selected[aria-current="true"], .wt-is-selected') || scope.querySelector('[aria-current="true"]');
    if(!curr) return null;
    const txt = (curr.textContent||'').trim();
    const num = parseInt(txt, 10);
    return Number.isFinite(num) ? num : null;
  }
  function syncCurrentPageToPlan(){
    const plan = jget(K_PLAN,null); if(!plan) return;
    let pageFromUrl = null;
    try{
      const u=new URL(location.href);
      const p=u.searchParams.get('page');
      if(p) pageFromUrl = parseInt(p,10);
    }catch{}
    const pageFromDOM = readCurrentPageFromDOM();
    const finalPage = (pageFromUrl && Number.isFinite(pageFromUrl)) ? pageFromUrl
                     : (pageFromDOM && Number.isFinite(pageFromDOM)) ? pageFromDOM
                     : plan.page;
    if(finalPage && finalPage!==plan.page){
      plan.page = finalPage; jset(K_PLAN,plan);
      log('info','Sync page from DOM/URL', {page: finalPage});
    }
  }

  // ---------- Panel ----------
  function panel(){
    if(document.getElementById('elu_panel_min')) return;
    const css=`
#elu_panel_min{position:fixed;z-index:2147483646;right:16px;bottom:16px;width:560px;max-height:80vh;overflow:hidden;font-family:Inter,system-ui,sans-serif;background:#0f172a;color:#e2e8f0;border:1px solid #334155;border-radius:14px;box-shadow:0 10px 30px rgba(0,0,0,.4)}
#elu_panel_min header{padding:10px 12px;font-weight:600;display:flex;align-items:center;justify-content:space-between;background:#0b1220;border-bottom:1px solid #334155}
#elu_panel_min header button{background:#1f2937;color:#e5e7eb;border:1px solid #334155;border-radius:8px;padding:4px 8px;font-size:12px}
#elu_panel_min .body{padding:10px;display:flex;flex-direction:column;gap:8px;height:calc(80vh - 56px);overflow:auto}
#elu_panel_min input{width:100%;background:#0b1220;color:#e2e8f0;border:1px solid #334155;border-radius:8px;padding:8px}
#elu_panel_min .row{display:flex;gap:8px}
#elu_panel_min .row>button{flex:1;background:#2563eb;border:none;color:#fff;padding:8px 10px;border-radius:8px;font-weight:600}
#elu_panel_min .row>button.secondary{background:#374151}
#elu_logs_min{font-family:ui-monospace,Menlo,monospace;background:#000;border:1px solid #334155;border-radius:8px;padding:8px;height:150px;overflow:auto;white-space:pre-wrap}
.elu-hi{outline:3px solid #22d3ee !important}
`;
    const st=document.createElement('style');st.textContent=css;document.head.appendChild(st);

    const box=document.createElement('div');box.id='elu_panel_min';box.innerHTML=`
<header>
  <div>🟧 Etsy LIVE Driver (Type → Collect → Next)</div>
  <button id="elu_close">✕</button>
</header>
<div class="body">
  <label>Shop URL</label>
  <input id="elu_shop" value="https://www.etsy.com/shop/NativeGreenWood">
  <label>Keyword</label>
  <input id="elu_kw" value="Acrylic Wood Ornament">
  <div class="row">
    <input id="elu_pages" type="number" min="1" value="5" style="max-width:120px">
    <input id="elu_max" type="number" min="1" value="500" style="max-width:140px">
    <button id="elu_start">Start</button>
    <button id="elu_stop" class="secondary">Stop</button>
  </div>
  <div class="row">
    <button id="elu_copy" class="secondary">Copy URLs</button>
    <button id="elu_dl_txt" class="secondary">Download .txt</button>
    <button id="elu_dl_csv" class="secondary">Download .csv</button>
  </div>
  <div><strong>Total:</strong> <span id="elu_total">0</span> | <strong>KW:</strong> <span id="elu_kwmeta">—</span> | <strong>Page:</strong> <span id="elu_pgmeta">—</span></div>
  <textarea id="elu_out" rows="6" placeholder="https://www.etsy.com/listing/123..."></textarea>
  <div id="elu_logs_min">(no logs)</div>
</div>`;
    document.body.appendChild(box);

    box.querySelector('#elu_close').onclick=()=>box.remove();

    window.__elu_render=()=>{
      const logs=jget(K_LOGS,[]);
      const fmt=ts=>{const d=new Date(ts);const p=n=>String(n).padStart(2,'0');return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;};
      box.querySelector('#elu_logs_min').textContent = logs.map(l=>`[${fmt(l.ts)}] ${l.level.toUpperCase()} ${l.msg}`).join('\n')||'(no logs)';
      box.querySelector('#elu_logs_min').scrollTop = box.querySelector('#elu_logs_min').scrollHeight;
    };

    function sync(){
      const plan=jget(K_PLAN,null);
      const out=box.querySelector('#elu_out');
      const total=box.querySelector('#elu_total');
      const kwm=box.querySelector('#elu_kwmeta');
      const pgm=box.querySelector('#elu_pgmeta');
      if(!plan){ out.value=''; total.textContent='0'; kwm.textContent='—'; pgm.textContent='—'; return; }
      out.value=(plan.results||[]).join('\n');
      total.textContent=String(plan.results?.length||0);
      kwm.textContent=plan.keyword||'';
      pgm.textContent=String(plan.page||1);
    }
    window.__elu_sync=sync;

    // buttons
    box.querySelector('#elu_start').onclick=()=>{
      const shop = ensureItems(box.querySelector('#elu_shop').value.trim());
      const kw   = box.querySelector('#elu_kw').value.trim();
      const pages= Math.max(1, Number(box.querySelector('#elu_pages').value)||1);
      const max  = Math.max(1, Number(box.querySelector('#elu_max').value)||1);
      const plan = { shop, keyword:kw, pages, page:1, max, results:[], searched:false };
      jset(K_PLAN, plan); jset(K_STATE,'running'); jset(K_LOGS,[]);
      log('info', 'START', plan);
      run();
    };
    box.querySelector('#elu_stop').onclick=()=>{ jset(K_STATE,'idle'); log('warn','STOP requested'); };
    box.querySelector('#elu_copy').onclick=()=>{
      const txt=box.querySelector('#elu_out').value||''; navigator.clipboard.writeText(txt).then(()=>log('info','Copied')).catch(()=>log('warn','Copy failed'));
    };
    box.querySelector('#elu_dl_txt').onclick=()=>download(box.querySelector('#elu_out').value||'','etsy_urls.txt','text/plain');
    box.querySelector('#elu_dl_csv').onclick=()=>{
      const lines=(box.querySelector('#elu_out').value||'').split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
      if(!lines.length) return;
      const csv='url\n'+lines.map(u=>`"${u.replace(/"/g,'""')}"`).join('\n');
      download(csv,'etsy_urls.csv','text/csv');
    };

    window.__elu_render(); window.__elu_sync();
  }

  function download(content, name, type){
    try{ GM_download({ url: URL.createObjectURL(new Blob([content],{type:(type||'text/plain')})), name }); }
    catch{ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([content],{type:(type||'text/plain')})); a.download=name; a.click(); }
  }

  // ---------- Driver ----------
  let NAV_LOCK = false;

  async function run(){
    panel();
    const state=jget(K_STATE,'idle'); const plan=jget(K_PLAN,null);
    if(state!=='running'||!plan||NAV_LOCK) return;

    // 1) Scope shop (kể cả /search)
    if(!inShopScope(location.href, plan.shop)){
      const dest = ensureItems(plan.shop);
      log('info','Navigate to shop scope', dest);
      NAV_LOCK = true; location.href = dest; return;
    }

    // 2) One-time search (gõ 1 lần đầu)
    if(!plan.searched){
      await typeAndSubmit(plan.keyword);
      return;
    }

    // 3) Đồng bộ số trang từ DOM/URL
    syncCurrentPageToPlan();

    // 4) Thu URL trong grid
    const added = await collectToPlan();
    syncCurrentPageToPlan();
    log('info','Collected page', {page:jget(K_PLAN,plan).page, added, total:jget(K_PLAN,plan).results.length});
    window.__elu_sync&&window.__elu_sync();

    if(jget(K_PLAN,plan).results.length >= plan.max){
      log('info','Reached max', plan.max);
      jset(K_STATE,'idle'); return;
    }

    // 5) Next page bằng nút .wt-action-group → a[data-page]
    if(jget(K_PLAN,plan).page < plan.pages){
      const target = jget(K_PLAN,plan).page + 1;
      const ok = await clickPageButton(target);
      if(!ok){
        // Fallback đổi URL nếu không thấy nút
        let next = new URL(location.href);
        next.searchParams.set('page', String(target));
        next.hash = 'items';
        log('warn','No page button, goto URL', next.toString());
        NAV_LOCK = true; location.href = next.toString(); return;
      }
      return;
    }else{
      log('info','DONE all pages'); jset(K_STATE,'idle'); return;
    }
  }

  async function typeAndSubmit(keyword){
    const region = document.querySelector('[data-region="search-items"].search-items') || document.querySelector('[data-region="search-items"]');
    const form   = region?.querySelector('form[action*="/shop/"][method="GET"]') || document.querySelector('form[action*="/shop/"][method="GET"]');
    const input  = form?.querySelector('input[name="search_query"]');
    const submit = form?.querySelector('button[type="submit"]');
    const plan   = jget(K_PLAN,null);

    if(!form || !input || !submit){
      let u = ensureItems(plan.shop);
      const url = new URL(u);
      url.searchParams.set('search_query', keyword||'');
      url.searchParams.set('ref','shop_search');
      if(plan.page>1) url.searchParams.set('page', String(plan.page));
      url.hash = 'items';
      log('warn','Search form not found, navigate URL', url.toString());
      plan.searched = true; jset(K_PLAN, plan);
      NAV_LOCK = true; location.href = url.toString();
      return;
    }

    input.classList.add('elu-hi');
    input.focus();
    input.value=''; input.dispatchEvent(new Event('input',{bubbles:true}));
    await sleep(120);
    for(const ch of String(keyword)){
      input.value += ch;
      input.dispatchEvent(new Event('input',{bubbles:true}));
      await sleep(30+Math.random()*40);
    }
    input.dispatchEvent(new Event('change',{bubbles:true}));
    await sleep(100);

    submit.scrollIntoView({behavior:'smooth',block:'center'});
    await sleep(160);
    log('info','Click submit', {keyword});
    if (plan) { plan.searched = true; jset(K_PLAN, plan); }
    NAV_LOCK = true; submit.click();
  }

  // --- Bấm đúng nút trang N trong khối .wt-action-group ---
  async function clickPageButton(targetPage){
    const scope = getPaginationScope();
    if(!scope){ log('warn','Pagination scope not found'); return false; }

    // 1) Ưu tiên nút số trang có data-page="N"
    let btn = scope.querySelector(`a[data-page="${targetPage}"]`);
    if (btn) {
      btn.classList.add('elu-hi'); btn.scrollIntoView({behavior:'smooth', block:'center'});
      await sleep(150);
      log('info','Click page button (data-page)', {targetPage});
      NAV_LOCK = true; btn.click(); return true;
    }

    // 2) Nút Next (span screen-reader "Next page")
    const nextBtn = Array.from(scope.querySelectorAll('a.wt-btn, a.wt-action-group__item'))
      .find(a => /\bNext page\b/i.test(a.textContent||'') || a.querySelector('.wt-screen-reader-only')?.textContent?.trim() === 'Next page');
    if (nextBtn && targetPage === (readCurrentPageFromDOM()||1)+1) {
      nextBtn.classList.add('elu-hi'); nextBtn.scrollIntoView({behavior:'smooth', block:'center'});
      await sleep(150);
      log('info','Click Next (sr-only)', {targetPage});
      NAV_LOCK = true; nextBtn.click(); return true;
    }

    // 3) Fallback: href chứa page=N
    btn = scope.querySelector(`a[href*="page=${targetPage}"]`);
    if (btn) {
      btn.classList.add('elu-hi'); btn.scrollIntoView({behavior:'smooth', block:'center'});
      await sleep(150);
      log('info','Click page button (href)', {targetPage});
      NAV_LOCK = true; btn.click(); return true;
    }

    log('warn','Target page button not found', {targetPage});
    return false;
  }

  async function collectToPlan(){
    await waitForListings();
    const plan = jget(K_PLAN,null);
    const set  = new Set(plan.results || []);
    let scanned = 0, added = 0;

    const grid = document.querySelector('[data-listings-container] .responsive-listing-grid');
    if (!grid) { log('warn','Listings grid not found'); return 0; }

    const cards = grid.querySelectorAll('.v2-listing-card[data-listing-id]');
    cards.forEach(card => {
      const a = card.querySelector('a.listing-link[href*="/listing/"]');
      if (!a) return;
      const rect = card.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;

      scanned++;
      try {
        const full = new URL(a.getAttribute('href'), location.origin).toString();
        const can  = canonicalListing(full);
        if (!set.has(can)) { set.add(can); added++; }
      } catch {}
    });

    plan.results = Array.from(set);
    jset(K_PLAN, plan);
    log('info', `DOM page scanned=${scanned}, added=${added}, total=${plan.results.length}`);
    if (scanned > 0 && scanned !== 36) log('warn', `Expected ~36 on page, got ${scanned}`);
    return added;
  }

  async function waitForListings(timeout=18000){
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
      const grid = document.querySelector('[data-listings-container] .responsive-listing-grid');
      const ready = grid && grid.querySelector('.v2-listing-card[data-listing-id] a.listing-link');
      if (ready) return true;
      await sleep(150);
    }
    log('warn','Timeout waiting listings (grid)');
    return false;
  }

  // ---------- Boot ----------
  function boot(){ try{ if(window.top!==window.self) return; panel(); onReady(); }catch(e){ log('error','boot', String(e)); } }
  async function onReady(){
    NAV_LOCK = false; // mở khóa sau mỗi load
    const st=jget(K_STATE,'idle'); const plan=jget(K_PLAN,null);
    if(st==='running' && plan){
      syncCurrentPageToPlan();
      window.__elu_sync&&window.__elu_sync();
      await sleep(250);
      run();
    }else{
      window.__elu_sync&&window.__elu_sync();
    }
  }
  (function hookHistory(){
    const p=history.pushState, r=history.replaceState;
    history.pushState=function(){const ret=p.apply(this,arguments); setTimeout(boot,60); return ret;};
    history.replaceState=function(){const ret=r.apply(this,arguments); setTimeout(boot,60); return ret;};
    window.addEventListener('popstate',()=>setTimeout(boot,60));
  })();
  const obs=new MutationObserver(()=>{ if(!document.getElementById('elu_panel_min')) panel(); });
  obs.observe(document.documentElement,{childList:true,subtree:true});
  setTimeout(boot,300);
})();
