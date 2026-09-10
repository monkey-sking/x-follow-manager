// ==UserScript==
// @name         X Follow Manager - 互关与条件取关
// @namespace    local.x-follow-manager
// @version      1.1.0
// @description  X 关注管理：网络数据解析、互关识别、未回关条件取关、关注者自动回关、白名单与限速。
// @author       monkey-sking
// @homepageURL  https://github.com/monkey-sking/x-follow-manager
// @supportURL   https://github.com/monkey-sking/x-follow-manager/issues
// @match        https://x.com/*/following
// @match        https://x.com/*/followers
// @match        https://x.com/*/verified_followers
// @match        https://twitter.com/*/following
// @match        https://twitter.com/*/followers
// @match        https://twitter.com/*/verified_followers
// @run-at       document-start
// @grant        none
// @noframes
// @inject-into  page
// @sandbox      raw
// ==/UserScript==

(function () {
  'use strict';

  const KEY = 'x-follow-manager:v1';
  const state = Object.assign({
    hideMutual: true,
    minAgeDays: 7,
    delayMs: 3500,
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
  let actionRunning = false;
  const LIST_GRAPHQL_RE = /\/graphql\/[^/]+\/(?:Following|Followers|BlueVerifiedFollowers|FollowersYouKnow)(?:$|\?)/;
  const requestUrl = input => typeof input === 'string' ? input : input?.url || '';
  const isRelevantGraphQL = url => { try { return LIST_GRAPHQL_RE.test(new URL(url, location.href).pathname); } catch (_) { return false; } };
  const save = () => localStorage.setItem(KEY, JSON.stringify({ ...state, selected: [...state.selected] }));

  // X 的关注列表数据优先从同页网络响应读取；失败时仍使用 DOM。
  const ingest = payload => {
    const walk = value => {
      if (!value || typeof value !== 'object') return;
      if (Array.isArray(value)) return value.forEach(walk);
      const legacy = value.legacy || value;
      const core = value.core || {};
      const h = legacy.screen_name || core.screen_name || value.screen_name;
      if (h && (legacy.followers_count != null || legacy.following_count != null || value.relationship_perspectives || value.relationship_perspective)) {
        const rel = value.relationship_perspectives || value.relationship_perspective || legacy.relationship_perspectives || legacy.relationship_perspective || {};
        const key = String(h).toLowerCase(), old = state.networkData[key] || {};
        state.networkData[key] = {
          followers: legacy.followers_count ?? value.followers_count ?? null,
          followingCount: legacy.friends_count ?? legacy.following_count ?? value.friends_count ?? null,
          following: typeof (rel.following ?? legacy.following ?? value.following) === 'boolean' ? (rel.following ?? legacy.following ?? value.following) : old.following ?? null,
          followedBy: typeof (rel.followed_by ?? legacy.followed_by ?? value.followed_by) === 'boolean' ? (rel.followed_by ?? legacy.followed_by ?? value.followed_by) : old.followedBy ?? null,
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
      if (isRelevantGraphQL(requestUrl(args[0]))) try { response.clone().json().then(ingest).catch(() => {}); } catch (_) {}
      return response;
    };
    const open = XMLHttpRequest.prototype.open;
    const send = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (method, url) { this.__xfmUrl = String(url || ''); return open.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      this.addEventListener('load', () => { if (isRelevantGraphQL(this.__xfmUrl)) { try { ingest(this.responseType === 'json' ? this.response : JSON.parse(this.responseText)); } catch (_) {} } });
      return send.apply(this, arguments);
    };
  };
  installNetworkObserver();

  const css = document.createElement('style');
  css.textContent = `
    .xfm-mutual { opacity:.16!important; }
    .xfm-hide-mutual .xfm-mutual { display:none!important; }
    .xfm-target { outline:2px solid #f4212e!important; background:rgba(244,33,46,.08)!important; }
    #xfm-panel { position:fixed; right:14px; top:70px; z-index:99999; width:350px; max-height:calc(100vh - 90px); overflow:auto; padding:16px; color:#0f1419; background:#fff; border:1px solid #cfd9de; border-radius:16px; box-shadow:0 8px 30px #0003; font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif; }
    #xfm-panel h3 { margin:0 0 5px; font-size:16px; } #xfm-panel .xfm-section { border-top:1px solid #eff3f4; margin-top:12px; padding-top:10px; }
    #xfm-panel details { border-top:1px solid #eff3f4; margin-top:12px; padding-top:10px; } #xfm-panel summary { cursor:pointer; font-weight:700; margin-bottom:9px; }
    #xfm-panel button { border:0; border-radius:999px; padding:7px 11px; margin:3px; cursor:pointer; background:#1d9bf0; color:#fff; font-weight:600; }
    #xfm-panel button.warn { background:#f4212e; } #xfm-panel button.muted { background:#536471; }
    #xfm-panel input { width:72px; margin-left:5px; } #xfm-panel textarea { width:100%; box-sizing:border-box; margin-top:5px; border:1px solid #cfd9de; border-radius:8px; padding:6px; }
    #xfm-toggle { position:fixed; right:18px; bottom:18px; z-index:100000; width:42px; height:42px; border:0; border-radius:50%; background:#1d9bf0; color:#fff; font-size:20px; cursor:pointer; box-shadow:0 4px 14px #0003; }
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
  const isMutualSafe = (cell, nd) => {
    if (cell.querySelector('[data-testid="userFollowIndicator"]')) return true;
    if (location.pathname.endsWith('/following')) return nd?.followedBy === true;
    if (location.pathname.endsWith('/followers') || location.pathname.endsWith('/verified_followers')) return nd?.following === true;
    return nd?.following === true && nd?.followedBy === true;
  };
  const isFollowerSafe = (cell, nd) =>
    !!cell.querySelector('[data-testid="userFollowIndicator"]') ||
    isMutual(cell) ||
    nd?.followedBy === true;
  const followButton = cell => [...cell.querySelectorAll('[data-testid$="-follow"],button,[role="button"]')].find(x => {
    const a=x.getAttribute('aria-label')||''; return a.startsWith('Follow @') || a.startsWith('关注 @') || a.startsWith('關注 @');
  });
  const unfollowButton = cell => [...cell.querySelectorAll('[data-testid$="-unfollow"],button,[role="button"]')].find(x => {
    const a=x.getAttribute('aria-label')||''; return a.startsWith('Following @') || a.startsWith('正在关注 @') || a.startsWith('正在關注 @');
  });
  const waitForElement = (selector, timeout=2500) => new Promise(resolve => {
    const existing=document.querySelector(selector); if(existing){resolve(existing);return;}
    const observer=new MutationObserver(()=>{const el=document.querySelector(selector);if(el){observer.disconnect();clearTimeout(timer);resolve(el);}});
    observer.observe(document.documentElement,{childList:true,subtree:true}); const timer=setTimeout(()=>{observer.disconnect();resolve(null);},timeout);
  });
  const pageOwner = () => location.pathname.match(/^\/([^/]+)\/(?:following|followers|verified_followers)\/?$/)?.[1]?.toLowerCase() || null;
  const loggedInHandle = () => { const a=document.querySelector('[data-testid="SideNav_AccountSwitcher_Button"]'); return (text(a).match(/@([A-Za-z0-9_]+)/)||[])[1]?.toLowerCase() || null; };
  const assertOwnList = () => { const me=loggedInHandle(), owner=pageOwner(); if (!me || !owner || me!==owner) throw new Error('安全保护：仅允许在当前登录账号自己的列表页执行操作。'); };
  const whitelist = () => new Set(state.whitelist.split(/[\s,，]+/).map(x => x.replace(/^@/, '').toLowerCase()).filter(Boolean));
  const userCells = () => {
    const marked = [...document.querySelectorAll('[data-testid="UserCell"]')];
    if (marked.length) return marked;
    return [...document.querySelectorAll('main button')].filter(b =>
      b.querySelector('a[href^="/"],a[href^="https://x.com/"]') &&
      b.querySelector('button[aria-label*="正在关注"],button[aria-label*="Following"],button[aria-label*="关注 @"],button[aria-label*="Follow @"]')
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
    document.body?.classList.toggle('xfm-hide-mutual', state.hideMutual);
    let mutual = 0, candidates = 0, eligible = 0;
    userCells().forEach(cell => {
      const h = handle(cell); if (!h) return;
      const key = h.toLowerCase();
      const nd = state.networkData[key];
      if (!state.seen[key]) state.seen[key] = now;
      cell.classList.remove('xfm-mutual', 'xfm-target');
      if (isMutualSafe(cell, nd)) { mutual++; if (state.hideMutual) cell.classList.add('xfm-mutual'); return; }
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
    if (s) s.textContent = `本屏：互关 ${mutual} · 未回关 ${candidates} · 符合条件 ${eligible}\n已勾选 ${state.selected.size} · ${state.dryRun ? '预览模式' : '执行模式'}`;
  }

  const buttonByText = (root, names) => [...root.querySelectorAll('button')].find(b => names.some(n => text(b).includes(n)));
  async function unfollowSelected() {
    if (actionRunning) return alert('已有操作正在执行。');
    assertOwnList(); if (!location.pathname.endsWith('/following')) return alert('请在自己的正在关注页面执行取关。');
    if (!confirm('即将取关已选账号。确定继续？')) return;
    actionRunning = true;
    const cells = userCells().filter(c => state.selected.has(handle(c)?.toLowerCase()));
    let done = 0; try { for (const cell of cells) {
      const b=unfollowButton(cell); if(!b) continue;
      if(document.querySelector('[data-testid="confirmationSheetConfirm"]')) throw new Error('页面已有未处理确认框。');
      b.click(); const u=await waitForElement('[data-testid="confirmationSheetConfirm"]'); if(!u) throw new Error(`@${handle(cell)} 未出现确认框。`); u.click();
      state.selected.delete(handle(cell).toLowerCase()); done++; await new Promise(r=>setTimeout(r,Number(state.delayMs||3500)));
    }} catch(e){ alert(e.message); } finally { actionRunning=false; save(); scan(); if(done) alert(`本次已执行 ${done} 个取关。`); }
  }

  async function followBackVisible() {
    if (actionRunning) return alert('已有操作正在执行。'); assertOwnList(); if (!(location.pathname.endsWith('/followers') || location.pathname.endsWith('/verified_followers'))) return alert('请在自己的关注者页面执行回关。');
    const candidates = userCells().filter(b => {
      const h = handle(b)?.toLowerCase();
      const nd = h ? state.networkData[h] : null;
      // followers 页面混有推荐账号；没有“关注了你”证据时绝不回关。
      return !!h && isFollowerSafe(b, nd) && !!followButton(b);
    });
    if (!candidates.length || !confirm(`发现 ${candidates.length} 个可回关账号，确定执行？`)) return;
    actionRunning=true; let done=0; try { for(const cell of candidates){ const b=followButton(cell); if(!b) continue; b.click(); done++; await new Promise(r=>setTimeout(r,Number(state.delayMs||3500))); } } finally { actionRunning=false; save(); } alert(`本次已回关 ${done} 个账号。`);
  }

  function panel() {
    if (document.querySelector('#xfm-panel')) return;
    if (!document.body) return;
    const p = document.createElement('div'); p.id = 'xfm-panel';
    p.innerHTML = `<h3>X Follow Manager</h3><div id="xfm-status">扫描中…</div>
      <details open><summary>功能 / Actions</summary>
      <label><input id="xfm-hide" type="checkbox" ${state.hideMutual?'checked':''}> 隐藏互关</label><br>
      <button id="xfm-scan">重新扫描</button><button id="xfm-select">选中本屏符合条件</button><br><button id="xfm-back-now">回关当前列表未关注账号</button>
      <button id="xfm-run" class="warn">执行已勾选取关</button></details>
      <details><summary>设置 / Settings</summary>
      <label>至少关注天数 <input id="xfm-age" type="number" min="0" value="${state.minAgeDays}"></label>
      <label>间隔(ms) <input id="xfm-delay" type="number" min="2000" value="${state.delayMs}"></label><br>
      <label><input id="xfm-ver" type="checkbox" ${state.excludeVerified?'checked':''}> 排除认证账号</label>
      <label><input id="xfm-prot" type="checkbox" ${state.excludeProtected?'checked':''}> 排除保护账号</label>
      <textarea id="xfm-wl" rows="2" placeholder="白名单：@user1, @user2">${state.whitelist}</textarea>
      <label><input id="xfm-bio-on" type="checkbox" ${state.matchBio?'checked':''}> 简介命中关键词才纳入</label>
      <textarea id="xfm-bio" rows="2" placeholder="简介关键词：空投, 返佣, referral">${state.bioKeywords}</textarea></details>
      <button id="xfm-hidepanel" class="muted">缩小面板</button>`;
    document.body.appendChild(p);
    const toggle = document.createElement('button'); toggle.id='xfm-toggle'; toggle.title='显示 X Follow Manager'; toggle.textContent='⚙'; toggle.hidden=true; document.body.appendChild(toggle);
    const sync = () => { state.hideMutual=p.querySelector('#xfm-hide').checked; state.minAgeDays=+p.querySelector('#xfm-age').value; state.delayMs=+p.querySelector('#xfm-delay').value; state.excludeVerified=p.querySelector('#xfm-ver').checked; state.excludeProtected=p.querySelector('#xfm-prot').checked; state.whitelist=p.querySelector('#xfm-wl').value; state.matchBio=p.querySelector('#xfm-bio-on').checked; state.bioKeywords=p.querySelector('#xfm-bio').value; save(); scan(); };
    p.querySelectorAll('input,textarea').forEach(x => x.addEventListener('change', sync));
    p.querySelector('#xfm-scan').onclick=scan;
    p.querySelector('#xfm-select').onclick=()=>{ document.querySelectorAll('.xfm-check:not(:disabled)').forEach(x=>{x.checked=true; const h=handle(x.closest('[data-testid="UserCell"]') || x.closest('button'))?.toLowerCase(); if(h) state.selected.add(h);}); save(); scan(); };
    p.querySelector('#xfm-run').onclick=unfollowSelected;
    p.querySelector('#xfm-back-now').onclick=followBackVisible;
    p.querySelector('#xfm-hidepanel').onclick=()=>{ p.hidden=true; toggle.hidden=false; };
    toggle.onclick=()=>{ p.hidden=false; toggle.hidden=true; };
    scan();
  }
  const tick = () => {
    try {
      const active = ['/following','/followers','/verified_followers'].some(x=>location.pathname.endsWith(x));
      if (active) { panel(); if (document.body) scan(); }
      else { document.querySelector('#xfm-panel')?.remove(); document.querySelector('#xfm-toggle')?.remove(); }
    } catch (error) { console.warn('[X Follow Manager] initialization failed', error); }
  };
  setInterval(tick, 1500); tick();
})();
