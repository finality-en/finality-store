// Finality SMP public store. Static: reads data/catalog.json and data/live.json,
// which the private store server publishes. No secrets live here.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const JAVA = /^[A-Za-z0-9_]{3,16}$/;
  const BEDROCK = /^[A-Za-z0-9 ]{1,16}$/;
  const store = { catalog: null, live: null, cat: null, me: null, basket: [], current: null };

  // ---------- storage (may be unavailable) ----------
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
  const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };

  // ---------- helpers ----------
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    for (const kid of kids) if (kid != null) n.append(kid);
    return n;
  }
  const money = (minor, cur) => {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: cur.toUpperCase() }).format(minor / 100); }
    catch { return `${(minor / 100).toFixed(2)} ${cur.toUpperCase()}`; }
  };
  const head = (name, edition) => edition === 'bedrock' || !JAVA.test(name || '')
    ? 'https://mc-heads.net/avatar/MHF_Steve/64'
    : `https://mc-heads.net/avatar/${encodeURIComponent(name)}/64`;
  function toast(msg) {
    const t = el('div', { class: 'toast', role: 'status', text: msg });
    document.body.append(t); setTimeout(() => t.remove(), 2200);
  }
  const ago = t => {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  };
  // Mirrors the server: v1_ + base64url(JSON). Only [A-Za-z0-9_-], as Stripe requires.
  function encodeRef(player, gift) {
    const o = { e: player.edition, n: player.name };
    if (gift) o.g = { e: gift.edition, n: gift.name };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(o))));
    return 'v1_' + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function validName(edition, name) {
    name = String(name || '').trim();
    return edition === 'bedrock' ? BEDROCK.test(name) : JAVA.test(name);
  }

  // Pixel heart in three states (full, half, empty) as inline SVG.
  const HEART = 'M1 0h2v1H1zM6 0h2v1H6zM0 1h1v3H0zM3 1h1v1H3zM5 1h1v1H5zM8 1h1v3H8zM4 2h1v1H4zM1 4h1v1H1zM7 4h1v1H7zM2 5h1v1H2zM6 5h1v1H6zM3 6h1v1H3zM5 6h1v1H5zM4 7h1v1H4z';
  const FILL = 'M1 1h2v1H1zM6 1h2v1H6zM1 2h3v1H1zM5 2h3v1H5zM1 3h7v1H1zM2 4h5v1H2zM3 5h3v1H3zM4 6h1v1H4z';
  const LEFT = 'M1 1h2v1H1zM1 2h3v1H1zM1 3h3.5v1H1zM2 4h2.5v1H2zM3 5h1.5v1H3zM4 6h.5v1H4z';
  function heartSvg(state) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 9 8'); svg.setAttribute('shape-rendering', 'crispEdges'); svg.setAttribute('aria-hidden', 'true');
    const add = (d, fill) => { const p = document.createElementNS(ns, 'path'); p.setAttribute('d', d); p.setAttribute('fill', fill); svg.append(p); };
    add(HEART, '#050b16');
    add(FILL, '#1d3050');
    if (state === 'full') { add(FILL, '#e03a48'); add('M1 1h1v1H1z', '#ffb3b9'); svg.classList.add('fill'); }
    if (state === 'half') { add(LEFT, '#e03a48'); add('M1 1h1v1H1z', '#ffb3b9'); }
    return svg;
  }
  // Fallback package art: a coloured pixel heart crest.
  function badge(i) {
    const colours = ['#e8b04b', '#3fc9bf', '#b48cff', '#e03a48', '#7fd36b', '#ff9f5a'];
    const c = colours[i % colours.length];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="-2 -2 13 12" shape-rendering="crispEdges"><path fill="#0d0a10" d="${HEART}"/><path fill="${c}" d="${FILL}"/><path fill="#fff" fill-opacity=".55" d="M1 1h1v1H1z"/></svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  // ---------- identity ----------
  function setEdition(group, attr, edition) {
    group.querySelectorAll(`[${attr}]`).forEach(b => b.setAttribute('aria-pressed', String(b.getAttribute(attr) === edition)));
  }
  const currentEdition = (group, attr) => group.querySelector(`[${attr}][aria-pressed="true"]`)?.getAttribute(attr) || 'java';

  function renderMe() {
    const me = store.me;
    $('who-form').hidden = !!me; $('who-signed').hidden = !me;
    if (!me) return;
    $('me-name').textContent = me.name;
    $('me-ed').textContent = me.edition === 'bedrock' ? 'Bedrock edition' : 'Java edition';
    $('me-head').src = head(me.name, me.edition);
  }

  // ---------- rendering ----------
  function renderStore() {
    const c = store.catalog;
    document.querySelectorAll('[data-store-name]').forEach(n => { n.textContent = c.store.name; });
    document.title = `${c.store.name} Store`;
    if (c.store.tagline) $('tagline').textContent = c.store.tagline;
    if (c.store.serverIp) $('server-ip').textContent = c.store.serverIp;
    if (c.store.discordUrl && /^https:\/\//.test(c.store.discordUrl)) { $('discord-link').href = c.store.discordUrl; $('discord-link').hidden = false; }
    $('demo-banner').hidden = !c.demo;
    $('open-basket').hidden = !c.store.checkoutApi;

    const tabs = $('tabs'); tabs.replaceChildren();
    const cats = c.categories.length ? c.categories : [{ id: null, name: 'All packages', description: '' }];
    if (!store.cat || !cats.some(x => x.id === store.cat)) store.cat = (cats.find(x => x.id === location.hash.slice(1)) || cats[0]).id;
    for (const cat of cats) {
      tabs.append(el('button', { role: 'tab', type: 'button', 'aria-selected': String(cat.id === store.cat), text: cat.name,
        onclick: () => { store.cat = cat.id; history.replaceState(null, '', cat.id ? `#${cat.id}` : '#'); renderStore(); } }));
    }
    const cat = cats.find(x => x.id === store.cat);
    $('cat-title').textContent = cat.name;
    $('cat-desc').textContent = cat.description || '';

    const grid = $('packages'); grid.replaceChildren();
    const list = c.packages.filter(p => !c.categories.length || p.categoryId === store.cat);
    if (!list.length) grid.append(el('p', { class: 'muted', text: 'Nothing here yet. Check back soon.' }));
    list.forEach((p, i) => {
      const priceLine = el('div', { class: 'price' });
      if (p.price !== null) priceLine.append(money(p.price, c.store.currency));
      if (p.monthlyPrice !== null) {
        if (p.price !== null) priceLine.append(el('small', { text: ` or ${money(p.monthlyPrice, c.store.currency)}/month` }));
        else priceLine.append(money(p.monthlyPrice, c.store.currency), el('small', { text: ' /month' }));
      }
      grid.append(el('article', { class: 'pkg' },
        el('div', { class: 'art' }, el('img', { src: p.image || badge(i), alt: '', loading: 'lazy' })),
        el('h3', { text: p.name }),
        p.upgradeFromName ? el('span', { class: 'tag', text: `Requires ${p.upgradeFromName}` }) : null,
        perksList(p.description),
        priceLine,
        el('div', { class: 'actions' },
          el('button', { class: 'btn block', type: 'button', text: c.demo ? 'Opening soon' : (c.store.checkoutApi ? 'Add to basket' : 'Buy'), onclick: () => openPackage(p, i) }),
          el('button', { class: 'more', type: 'button', text: 'View details', onclick: () => openPackage(p, i) }))));
    });
  }

  function perksList(text) {
    const lines = String(text || '').split(/\r?\n/).map(t => t.trim()).filter(t => /^[-*•]\s+/.test(t)).slice(0, 3);
    if (!lines.length) return null;
    return el('ul', { class: 'perks' }, ...lines.map(t => el('li', { text: t.replace(/^[-*•]\s+/, '') })));
  }

  function renderDescription(target, text) {
    target.replaceChildren();
    let ul = null;
    for (const line of String(text || '').split(/\r?\n/)) {
      const t = line.trim();
      if (/^[-*•]\s+/.test(t)) { if (!ul) { ul = el('ul'); target.append(ul); } ul.append(el('li', { text: t.replace(/^[-*•]\s+/, '') })); continue; }
      ul = null;
      if (t) target.append(el('p', { text: t }));
    }
  }

  function renderLive() {
    const l = store.live || {};
    if (l.goal) {
      $('goal').hidden = false;
      $('goal-title').textContent = l.goal.title || 'Community goal';
      $('goal-pct').textContent = `${l.goal.percent}% reached`;
      const box = $('goal-hearts'); box.replaceChildren();
      box.setAttribute('aria-label', `Goal ${l.goal.percent}% reached`);
      const halves = Math.round(l.goal.percent / 5); // 10 hearts = 20 halves
      for (let i = 0; i < 10; i++) box.append(heartSvg(halves >= (i + 1) * 2 ? 'full' : halves === i * 2 + 1 ? 'half' : 'empty'));
    }
    if (l.topCustomer) {
      $('top-panel').hidden = false;
      $('top-name').textContent = l.topCustomer.player;
      $('top-head').src = head(l.topCustomer.player, l.topCustomer.edition);
    }
    if (l.recentPayments?.length) {
      $('recent-panel').hidden = false;
      $('recent').replaceChildren(...l.recentPayments.map(r => el('li', {},
        el('img', { src: head(r.player, r.edition), alt: '' }),
        el('div', {}, el('div', { text: r.player }), el('div', { class: 'what', text: `${r.items.join(', ')} · ${ago(r.at)}` })))));
    }
    if (l.players && Date.now() - Date.parse(l.generatedAt) < 10 * 60e3) setPlayers(l.players.online, true);
    else pingServer();
  }
  function setPlayers(n, online) {
    $('status-dot').classList.toggle('off', !online);
    $('player-count').textContent = online ? `${n} online` : 'offline';
  }
  async function pingServer() {
    const ip = store.catalog?.store.serverIp;
    if (!ip) return;
    try {
      const r = await fetch(`https://api.mcsrvstat.us/3/${encodeURIComponent(ip)}`);
      const j = await r.json();
      setPlayers(j.players?.online ?? 0, !!j.online);
    } catch { /* leave as is */ }
  }

  // ---------- package dialog ----------
  function openPackage(p, i) {
    store.current = p;
    const c = store.catalog;
    $('dlg-img').src = p.image || badge(i);
    $('dlg-title').textContent = p.name;
    $('dlg-tag').textContent = p.upgradeFromName ? `Requires ${p.upgradeFromName}. You only pay the difference.` : '';
    renderDescription($('dlg-desc'), p.description);
    const choice = $('dlg-choice'); choice.replaceChildren();
    const opts = [];
    if (p.price !== null) opts.push(['once', p.kind === 'giftcard' ? 'Gift card' : 'One-time, keep it forever', money(p.price, c.store.currency)]);
    if (p.monthlyPrice !== null) opts.push(['monthly', 'Monthly, cancel any time', `${money(p.monthlyPrice, c.store.currency)}/mo`]);
    opts.forEach(([v, label, amt], idx) => {
      const input = el('input', { type: 'radio', name: 'ptype', value: v });
      if (idx === 0) input.checked = true;
      choice.append(el('label', {}, input, el('span', { text: label }), el('span', { class: 'amt', text: amt })));
    });
    choice.hidden = opts.length < 2;
    $('dlg-gift').hidden = !p.giftable; $('dlg-gift').open = false; $('gift-name').value = '';
    $('dlg-err').textContent = '';
    $('dlg-buy').disabled = !!c.demo;
    $('dlg-buy').textContent = c.demo ? 'Opening soon' : c.store.checkoutApi ? 'Add to basket' : 'Continue to checkout';
    $('pkg-dialog').showModal();
  }

  function giftTarget() {
    if ($('dlg-gift').hidden || !$('dlg-gift').open) return null;
    const name = $('gift-name').value.trim();
    if (!name) return null;
    const edition = currentEdition($('dlg-gift'), 'data-gift-edition');
    if (!validName(edition, name)) throw new Error(edition === 'bedrock' ? 'Enter your friend\'s Xbox gamertag (letters, numbers, spaces).' : 'Java usernames are 3-16 letters, numbers or underscores.');
    return { edition, name };
  }

  function buy() {
    const p = store.current; const c = store.catalog;
    $('dlg-err').textContent = '';
    if (!store.me) { $('dlg-err').textContent = 'Enter your Minecraft username at the top of the page first.'; $('pkg-dialog').close(); $('username').focus(); return; }
    let gift;
    try { gift = giftTarget(); } catch (e) { $('dlg-err').textContent = e.message; return; }
    const type = document.querySelector('input[name="ptype"]:checked')?.value || (p.price !== null ? 'once' : 'monthly');
    if (c.store.checkoutApi) {
      store.basket = store.basket.filter(b => b.packageId !== p.id);
      if (type === 'monthly') store.basket = store.basket.filter(b => b.type !== 'monthly');
      store.basket.push({ packageId: p.id, type, gift });
      save('fs_basket', store.basket); renderBasketCount();
      $('pkg-dialog').close(); toast(`${p.name} added to basket`);
      return;
    }
    const link = p.links[type];
    if (!link || !/^https:\/\/(buy|checkout)\.stripe\.com\//.test(link)) { $('dlg-err').textContent = 'This package is not available right now.'; return; }
    const url = new URL(link);
    url.searchParams.set('client_reference_id', encodeRef(store.me, gift));
    location.href = url.toString();
  }

  // ---------- basket (only when the store server is hosted publicly) ----------
  function renderBasketCount() { $('basket-count').textContent = String(store.basket.length); }
  function openBasket() {
    const c = store.catalog; const list = $('basket-list'); list.replaceChildren();
    for (const b of store.basket) {
      const p = c.packages.find(x => x.id === b.packageId);
      if (!p) continue;
      const amt = b.type === 'monthly' ? `${money(p.monthlyPrice, c.store.currency)}/mo` : money(p.price, c.store.currency);
      list.append(el('li', {}, el('span', { text: `${p.name}${b.gift ? ` (gift for ${b.gift.name})` : ''}` }), el('b', { text: amt }),
        el('button', { type: 'button', text: 'Remove', onclick: () => { store.basket = store.basket.filter(x => x !== b); save('fs_basket', store.basket); renderBasketCount(); openBasket(); } })));
    }
    if (!list.children.length) list.append(el('li', { class: 'muted', text: 'Your basket is empty.' }));
    $('basket-checkout').disabled = !store.basket.length;
    if (!$('basket-dialog').open) $('basket-dialog').showModal();
  }
  async function checkoutBasket() {
    const err = $('basket-err'); err.textContent = '';
    if (!store.me) { err.textContent = 'Enter your Minecraft username first.'; return; }
    const gifts = [...new Set(store.basket.map(b => b.gift ? `${b.gift.edition}:${b.gift.name}` : ''))];
    if (gifts.length > 1) { err.textContent = 'Check out gifts for different players separately.'; return; }
    const btn = $('basket-checkout'); btn.disabled = true; btn.textContent = 'Opening checkout…';
    try {
      const r = await fetch(store.catalog.store.checkoutApi, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player: store.me, giftTo: store.basket[0]?.gift || null, items: store.basket.map(b => ({ packageId: b.packageId, type: b.type })) }),
      });
      const j = await r.json();
      if (!r.ok || !/^https:\/\/checkout\.stripe\.com\//.test(j.url)) throw new Error(j.error || 'Checkout is unavailable right now.');
      store.basket = []; save('fs_basket', []);
      location.href = j.url;
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Check out'; }
  }

  // ---------- boot ----------
  async function boot() {
    store.me = load('fs_player');
    // Links from the in-game /buy menu carry ?player=Name&edition=java
    const qs = new URLSearchParams(location.search);
    if (qs.get('player')) {
      const fromGame = { edition: qs.get('edition') === 'bedrock' ? 'bedrock' : 'java', name: qs.get('player').trim() };
      if (validName(fromGame.edition, fromGame.name)) { store.me = fromGame; save('fs_player', fromGame); }
      history.replaceState(null, '', location.pathname + location.hash);
    }
    if (store.me && !validName(store.me.edition, store.me.name)) store.me = null;
    store.basket = (load('fs_basket') || []).filter(b => b && b.packageId);
    renderMe(); renderBasketCount();

    $('who').addEventListener('click', e => { const b = e.target.closest('[data-edition]'); if (b) setEdition($('who'), 'data-edition', b.dataset.edition); });
    $('dlg-gift').addEventListener('click', e => { const b = e.target.closest('[data-gift-edition]'); if (b) setEdition($('dlg-gift'), 'data-gift-edition', b.dataset.giftEdition); });
    $('login-form').addEventListener('submit', e => {
      e.preventDefault();
      const edition = currentEdition($('who'), 'data-edition');
      const name = $('username').value.trim();
      if (!validName(edition, name)) {
        $('login-err').textContent = edition === 'bedrock' ? 'Enter your Xbox gamertag (letters, numbers and spaces, up to 16).' : 'Java usernames are 3-16 letters, numbers or underscores.';
        return;
      }
      $('login-err').textContent = '';
      store.me = { edition, name }; save('fs_player', store.me); renderMe();
    });
    $('logout').addEventListener('click', () => { store.me = null; save('fs_player', null); renderMe(); $('username').focus(); });
    $('copy-ip').addEventListener('click', async () => {
      try { await navigator.clipboard.writeText($('server-ip').textContent); toast('Server IP copied'); } catch { toast($('server-ip').textContent); }
    });
    $('dlg-buy').addEventListener('click', buy);
    $('open-basket').addEventListener('click', openBasket);
    $('basket-checkout').addEventListener('click', checkoutBasket);
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));

    try {
      const [cat, live] = await Promise.all([
        fetch(`data/catalog.json?t=${Date.now()}`).then(r => r.json()),
        fetch(`data/live.json?t=${Date.now()}`).then(r => r.ok ? r.json() : null).catch(() => null),
      ]);
      store.catalog = cat; store.live = live;
      renderStore(); renderLive();
    } catch {
      $('cat-title').textContent = 'The store could not load. Refresh the page to try again.';
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
