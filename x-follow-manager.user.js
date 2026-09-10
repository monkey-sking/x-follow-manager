// ==UserScript==
// @name         X Follow Manager - 互关与条件取关
// @namespace    local.x-follow-manager
// @version      1.0.0
// @description  扫描 X 正在关注列表：隐藏互关、识别未回关，并按白名单/账号类型/关注时长/每日上限条件取关。默认预览，不自动执行。
// @match        https://x.com/*/following
// @match        https://x.com/*/followers
// @match        https://twitter.com/*/following
// @match        https://twitter.com/*/followers
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  'use strict';

  const KEY = 'x-follow-manager:v1';
  const state = Object.assign({
    hideMutual: true,
    minAgeDays: 7,
    delayMs: 3500,
    dailyLimit: 20,
    autoFollowBack: false,
    excludeVerified: true,
    excludeProtected: true,
    whitelist: '',
    bioKeywords: '空投,返佣,邀请码,代充,推广,抽奖,airdrop,referral',
    matchBio: false,
    collectHover: true,
    dryRun: true,
    selected: new Set(),
    seen: {},
    hoverData: {},
    networkData: {}
  }, JSON.parse(localStorage.getItem(KEY) || '{}'));
  state.selected = new Set(state.selected || []);
  const save = () => localStorage.setItem(KEY, JSON.stringify({ ...state, selected: [...state.selected] }));

  // X 的关注列表数据优先从同页网络响应读取；失败时仍使用 DOM。
  const ingest = payload => {
    const walk = value => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) return value.forEach(walk);
      const legacy = value.legacy || value;
      const core = value.core || {};
      const h = legacy.screen_name || core.screen_name || value.screen_name;
      if (h && (legacy.followers_count != null || legacy.following_count != null || value.relationship_perspective)) {
        const rel = value.relationship_perspectives || value.relationship_perspective || legacy.relationship_perspectives || legacy.relationship_perspective || {};
        state.networkData[String(h).toLowerCase()] = {
          followers: legacy.followers_count ?? value.followers_count ?? null,
          followingCount: legacy.friends_count ?? legacy.following_count ?? value.friends_count ?? null,
          following: rel.following ?? value.following ?? null,
          followedBy: rel.followed_by ?? value.followed_by ?? null,
          verified: !!(value.is_blue_verified || legacy.verified || value.verified),
          capturedAt: Date.now()
        };
      }
      Object.values(value).forEach(walk);
    };
    try { walk(payload); save(); } catch (_) { /* X 响应结构变化时静默回退 DOM */ }
  };
  const installNetworkObserver = () => {
    const originalFetch = window.fetch;
    window.fetch = async function (...args) {
      const response = await originalFetch.apply(this, args);
      try { response.clone().json().then(ingest).catch(() => {}); } catch (_) {}
      return response;
    };
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) { this.__xfmUrl = String(url || ''); return open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      this.addEventListener('load', () => { if (this.__xfmUrl.includes('/graphql/')) { try { ingest(JSON.parse(this.responseText)); } catch (_) {} } });
      return send.apply(this, arguments);
    };
  };
  installNetworkObserver();

  const css = document.createElement('style');
  css.textContent = `
    .xfm-mutual { opacity:.16!important; }
    .xfm-target { outline:2px solid #f4212e!important; background:rgba(244,33,46,.08)!important; }
    #xfm-panel { position:fixed; right:14px; top:70px; z-index:99999; width:310px; padding:12px; color:#0f1419; background:#fff; border:1px solid #cfd9de; border-radius:14px; box-shadow:0 6px 24px #0002; font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    #xfm-panel button { border:0; border-radius:999px; padding:7px 11px; margin:3px; cursor:pointer; background:#1d9bf0; color:#fff; font-weight:600; }
    #xfm-panel button.warn { background:#f4212e; } #xfm-panel button.muted { background:#536471; }
    #xfm-panel input { width:72px; margin-left:5px; } #xfm-panel textarea { width:100%; box-sizing:border-box; margin-top:5px; }
    #xfm-status { margin:7px 2px; line-height:1.45; white-space:pre-line; }
  `;
  const mountStyle = () => (document.head || document.documentElement)?.appendChild(css);
  if (document.head || document.documentElement) mountStyle(); else document.addEventListener('DOMContentLoaded', mountStyle, { once: true });

  const text = el => (el?.textContent || '').replace(/\s+/g, ' ').trim();
  const handle = cell => {
    const link = [...cell.querySelectorAll('a[href]')].find(a => /^\/[^/]+$/.test(new URL(a.href, location.origin).pathname));
    return link ? new URL(link.href).pathname.slice(1) : undefined;
  };
  // 只读取关系标签节点，不扫描整行 innerText；X 中文版通常把它放在 UserCell 内的独立 div/span。
  const isMutual = cell => [...cell.querySelectorAll('div[dir="auto"],span,[aria-label]')]
    .some(n => /^(Follows you|回关了你|关注了你|跟隨了你|フォローされています)$/i.test(n.getAttribute('aria-label') || text(n)));
  const isVerified = cell => !!cell.querySelector('[data-testid="icon-verified"],[aria-label*="Verified"],[aria-label*="认证"],[aria-label*="認證"]') ||
    [...cell.querySelectorAll('a[aria-label]')].some(a => /认证账号|認證帳號|Verified account/i.test(a.getAttribute('aria-label')));
  const isProtected = cell => !!cell.querySelector('[aria-label*="Protected"],[aria-label*="受保护"],[aria-label*="受保護"]');
  const whitelist = () => new Set(state.whitelist.split(/[\s,，]+/).map(x => x.replace(/^@/, '').toLowerCase()).filter(Boolean));
  const userCells = () => {
    const marked = [...document.querySelectorAll('[data-testid="UserCell"]')];
    if (marked.length) return marked;
    return [...document.querySelectorAll('main button')].filter(b =>
      b.querySelector('a[href^="/"],a[href^="https://x.com/"]') &&
      b.querySelector('button[aria-label*="正在关注"],button[aria-label*="Following"]')
    );
  };
  const bioWords = () => state.bioKeywords.split(/[\s,，]+/).map(x => x.trim().toLowerCase()).filter(Boolean);
  const bioMatches = cell => {
    const words = bioWords(); if (!words.length) return false;
    const profileLinks = [...cell.querySelectorAll('a[href]')];
    const handles = new Set(profileLinks.map(a => a.getAttribute('href')).filter(h => /^\/[^/]+$/.test(h || '')));
    const nodes = [...cell.querySelectorAll('div[dir="auto"],span')].filter(n => !n.closest('a'));
    const bio = nodes.map(text).join(' ').toLowerCase();
    return words.some(w => bio.includes(w)) && handles.size > 0;
  };
  const parseCount = value => {
    const m = String(value || '').replace(/,/g, '').match(/([\d.]+)\s*(万|k|m)?/i); if (!m) return null;
    const n = Number(m[1]); return m[2] === '万' ? Math.round(n * 10000) : m[2]?.toLowerCase() === 'k' ? Math.round(n * 1000) : m[2]?.toLowerCase() === 'm' ? Math.round(n * 1000000) : Math.round(n);
  };
  const attachHoverCollector = (cell, h) => {
    if (!state.collectHover || cell.dataset.xfmHoverBound) return;
    const link = [...cell.querySelectorAll('a[href]')].find(a => /^\/[^/]+$/.test(a.getAttribute('href') || ''));
    if (!link) return; cell.dataset.xfmHoverBound = '1';
    link.addEventListener('mouseenter', () => setTimeout(() => {
      if (isMutual(cell)) return;
      const pop = document.querySelector('[data-testid="HoverCard"],[role="tooltip"]'); if (!pop) return;
      const raw = text(pop);
      const f = raw.match(/([\d,.]+\s*(?:万|K|M)?)\s*(?:Followers|关注者|粉丝)/i);
      const following = raw.match(/([\d,.]+\s*(?:万|K|M)?)\s*(?:Following|正在关注)/i);
      if (!f && !following) return;
      state.hoverData[h.toLowerCase()] = { followers: parseCount(f?.[1]), following: parseCount(following?.[1]), capturedAt: Date.now() }; save();
      const badge = cell.querySelector('.xfm-hover-data') || document.createElement('span'); badge.className = 'xfm-hover-data'; badge.style.cssText = 'display:block;color:#536471;font-size:12px;margin-left:28px;';
      badge.textContent = `关注者 ${state.hoverData[h.toLowerCase()].followers ?? '?'} · 关注中 ${state.hoverData[h.toLowerCase()].following ?? '?'}`; if (!badge.parentNode) cell.appendChild(badge);
    }, 650));
  };

  function scan() {
    const now = Date.now();
    const wl = whitelist();
    let mutual = 0, candidates = 0, eligible = 0;
    userCells().forEach(cell => {
      const h = handle(cell); if (!h) return;
      const key = h.toLowerCase();
      const nd = state.networkData[key];
      if (!state.seen[key]) state.seen[key] = now;
      cell.classList.remove('xfm-mutual', 'xfm-target');
      const mutualFromNetwork = nd && (nd.followedBy === true || nd.following === true) ? nd.followedBy === true && nd.following === true : null;
      if (mutualFromNetwork === true || (mutualFromNetwork === null && isMutual(cell))) { mutual++; if (state.hideMutual) cell.classList.add('xfm-mutual'); return; }
      candidates++;
      attachHoverCollector(cell, h);
      const ageDays = (now - state.seen[key]) / 86400000;
      const verified = nd?.verified || isVerified(cell);
      const ok = !wl.has(key) && ageDays >= Number(state.minAgeDays || 0) && !(state.excludeVerified && verified) && !(state.excludeProtected && isProtected(cell)) && (!state.matchBio || bioMatches(cell));
      let check = cell.querySelector('.xfm-check');
      if (!check) {
        check = document.createElement('input'); check.type = 'checkbox'; check.className = 'xfm-check';
        check.title = '加入取关清单'; check.style.cssText = 'position:absolute;left:8px;top:8px;z-index:5;width:18px;height:18px;';
        cell.style.position = 'relative'; cell.appendChild(check);
        check.addEventListener('click', e => { e.stopPropagation(); const h = handle(cell)?.toLowerCase(); if (check.checked) state.selected.add(h); else state.selected.delete(h); save(); scan(); });
      }
      check.checked = state.selected.has(key); check.disabled = !ok;
      if (ok) { eligible++; cell.classList.add('xfm-target'); }
      if (nd && (nd.followers != null || nd.followingCount != null)) {
        const badge = cell.querySelector('.xfm-network-data') || document.createElement('span'); badge.className = 'xfm-network-data'; badge.style.cssText = 'display:block;color:#536471;font-size:12px;margin-left:28px;';
        badge.textContent = `网络数据：关注者 ${nd.followers ?? '?'} · 关注中 ${nd.followingCount ?? '?'}`; if (!badge.parentNode) cell.appendChild(badge);
      }
    });
    save();
    const s = document.querySelector('#xfm-status');
    if (s) s.textContent = `本屏：互关 ${mutual} · 未回关 ${candidates} · 符合条件 ${eligible}\n已勾选 ${state.selected.size} · 今日上限 ${state.dailyLimit} · ${state.dryRun ? '预览模式' : '执行模式'}`;
  }

  const buttonByText = (root, names) => [...root.querySelectorAll('button')].find(b => names.some(n => text(b).includes(n)));
  async function unfollowSelected() {
    if (state.dryRun && !confirm('当前是预览模式。确定要切换到真实取关执行吗？')) return;
    state.dryRun = false; save();
    const cells = userCells().filter(c => state.selected.has(handle(c)?.toLowerCase()));
    let done = 0;
    for (const cell of cells) {
      if (done >= Number(state.dailyLimit || 20)) break;
      const b = [...cell.querySelectorAll('button,[role="button"]')].find(x => /^(Following|正在关注|正在關注)$/.test(x.getAttribute('aria-label') || text(x)));
      if (!b) continue;
      b.click(); await new Promise(r => setTimeout(r, 700));
      const menu = document.querySelector('[role="menu"]');
      const u = menu && [...menu.querySelectorAll('button,[role="menuitem"],[role="button"]')].find(x => /^(Unfollow|取消关注|取消關注)$/.test(x.getAttribute('aria-label') || text(x)));
      if (!u) { state.dryRun = true; save(); alert('未找到确认菜单，已停止以避免误操作。'); return; }
      u.click(); done++; await new Promise(r => setTimeout(r, Number(state.delayMs || 3500)));
    }
    state.selected.clear(); state.dryRun = true; save(); scan(); alert(`本次已执行 ${done} 个取关。`);
  }

  async function followBackVisible() {
    if (!state.autoFollowBack) return;
    const candidates = [...document.querySelectorAll('main button')].filter(b =>
      b.querySelector('a[href^="/"],a[href^="https://x.com/"]') &&
      [...b.querySelectorAll('button,[role="button"]')].some(x => /^(Follow|关注)$/.test(x.getAttribute('aria-label') || text(x)))
    );
    if (!candidates.length || !confirm(`发现 ${candidates.length} 个可回关账号，最多执行 ${state.dailyLimit} 个？`)) return;
    let done = 0;
    for (const cell of candidates) {
      if (done >= Number(state.dailyLimit || 20)) break;
      const b = [...cell.querySelectorAll('button,[role="button"]')].find(x => /^(Follow|关注)$/.test(x.getAttribute('aria-label') || text(x)));
      if (!b) continue; b.click(); done++; await new Promise(r => setTimeout(r, Number(state.delayMs || 3500)));
    }
    alert(`本次已回关 ${done} 个账号。`);
  }

  function panel() {
    if (document.querySelector('#xfm-panel')) return;
    const p = document.createElement('div'); p.id = 'xfm-panel';
    p.innerHTML = `<b>X Follow Manager</b><div id="xfm-status">扫描中…</div>
      <label><input id="xfm-hide" type="checkbox" ${state.hideMutual?'checked':''}> 隐藏互关</label><br>
      <label>至少关注天数 <input id="xfm-age" type="number" min="0" value="${state.minAgeDays}"></label>
      <label>每日上限 <input id="xfm-limit" type="number" min="1" value="${state.dailyLimit}"></label><br>
      <label>间隔(ms) <input id="xfm-delay" type="number" min="2000" value="${state.delayMs}"></label><br>
      <label><input id="xfm-ver" type="checkbox" ${state.excludeVerified?'checked':''}> 排除认证账号</label>
      <label><input id="xfm-prot" type="checkbox" ${state.excludeProtected?'checked':''}> 排除保护账号</label>
      <textarea id="xfm-wl" rows="2" placeholder="白名单：@user1, @user2">${state.whitelist}</textarea>
      <label><input id="xfm-bio-on" type="checkbox" ${state.matchBio?'checked':''}> 简介命中关键词才纳入</label>
      <textarea id="xfm-bio" rows="2" placeholder="简介关键词：空投, 返佣, referral">${state.bioKeywords}</textarea>
      <label><input id="xfm-back" type="checkbox" ${state.autoFollowBack?'checked':''}> 关注者页面自动回关</label><br>
      <button id="xfm-scan">重新扫描</button><button id="xfm-select">选中本屏符合条件</button><button id="xfm-back-now">执行回关</button>
      <button id="xfm-run" class="warn">执行已勾选取关</button><button id="xfm-hidepanel" class="muted">关闭面板</button>`;
    document.body.appendChild(p);
    const sync = () => { state.hideMutual=p.querySelector('#xfm-hide').checked; state.minAgeDays=+p.querySelector('#xfm-age').value; state.dailyLimit=+p.querySelector('#xfm-limit').value; state.delayMs=+p.querySelector('#xfm-delay').value; state.excludeVerified=p.querySelector('#xfm-ver').checked; state.excludeProtected=p.querySelector('#xfm-prot').checked; state.whitelist=p.querySelector('#xfm-wl').value; state.matchBio=p.querySelector('#xfm-bio-on').checked; state.bioKeywords=p.querySelector('#xfm-bio').value; state.autoFollowBack=p.querySelector('#xfm-back').checked; save(); scan(); };
    p.querySelectorAll('input,textarea').forEach(x => x.addEventListener('change', sync));
    p.querySelector('#xfm-scan').onclick=scan;
    p.querySelector('#xfm-select').onclick=()=>{ document.querySelectorAll('.xfm-check:not(:disabled)').forEach(x=>{x.checked=true; const h=handle(x.closest('[data-testid="UserCell"]') || x.closest('button'))?.toLowerCase(); if(h) state.selected.add(h);}); save(); scan(); };
    p.querySelector('#xfm-run').onclick=unfollowSelected;
    p.querySelector('#xfm-back-now').onclick=followBackVisible;
    p.querySelector('#xfm-hidepanel').onclick=()=>p.remove();
    scan();
  }
  setInterval(()=>location.pathname.endsWith('/following') ? panel() || scan() : document.querySelector('#xfm-panel')?.remove(), 1500);
})();
