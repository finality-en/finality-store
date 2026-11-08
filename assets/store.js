// Finality SMP public store. Static: reads data/catalog.json and data/live.json,
// which the private store server publishes. No secrets live here.
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const JAVA = /^[A-Za-z0-9_]{3,16}$/;
  const BEDROCK = /^[A-Za-z0-9 ]{1,16}$/;
  const S = { catalog: null, live: null, me: null, basket: [], current: null };

  // ---------- storage (may be unavailable) ----------
  const save = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* private mode */ } };
  const load = k => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } };

  // ---------- helpers ----------
  function el(tag, props = {}, ...kids) {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v === null || v === undefined || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid !== null && kid !== undefined && kid !== false) n.append(kid);
    return n;
  }
  const money = (minor, cur) => {
    try { return new Intl.NumberFormat(undefined, { style: 'currency', currency: String(cur).toUpperCase() }).format(minor / 100); }
    catch { return `${(minor / 100).toFixed(2)} ${String(cur).toUpperCase()}`; }
  };
  const safeImg = src => (typeof src === 'string' && /^(assets\/[\w./-]+|https:\/\/[^\s"'<>]+)$/.test(src) ? src : '');
  const head = (name, edition, size = 64) => edition === 'bedrock' || !JAVA.test(name || '')
    ? `https://mc-heads.net/avatar/MHF_Steve/${size}` : `https://mc-heads.net/avatar/${encodeURIComponent(name)}/${size}`;
  function toast(msg) { const t = el('div', { class: 'toast', role: 'status', text: msg }); document.body.append(t); setTimeout(() => t.remove(), 2200); }
  const ago = t => {
    const s = Math.max(1, Math.round((Date.now() - t) / 1000));
    if (s < 3600) return `${Math.max(1, Math.round(s / 60))} min ago`;
    if (s < 86400) return `${Math.round(s / 3600)} h ago`;
    return `${Math.round(s / 86400)} d ago`;
  };
  const validName = (edition, name) => (edition === 'bedrock' ? BEDROCK : JAVA).test(String(name || '').trim());
  const nameError = edition => edition === 'bedrock' ? 'Enter your Xbox gamertag: letters, numbers and spaces, up to 16 characters.' : 'Java usernames are 3 to 16 letters, numbers or underscores.';
  // Mirrors the server: v1_ + base64url(JSON). Only [A-Za-z0-9_-], as Stripe requires.
  function encodeRef(player, gift) {
    const o = { e: player.edition, n: player.name };
    if (gift) o.g = { e: gift.edition, n: gift.name };
    const b64 = btoa(unescape(encodeURIComponent(JSON.stringify(o))));
    return 'v1_' + b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function lines(text) {
    const out = { paras: [], bullets: [] };
    for (const raw of String(text || '').split(/\r?\n/)) {
      const t = raw.trim();
      if (!t) continue;
      if (/^[-*•]\s+/.test(t)) out.bullets.push(t.replace(/^[-*•]\s+/, '')); else out.paras.push(t);
    }
    return out;
  }
  const segValue = (root, attr) => root.querySelector(`[${attr}][aria-checked="true"]`)?.getAttribute(attr) || 'java';
  function segSet(root, attr, value) { root.querySelectorAll(`[${attr}]`).forEach(b => b.setAttribute('aria-checked', String(b.getAttribute(attr) === value))); }

  // ---------- account ----------
  function renderMe() {
    const me = S.me;
    $('pb-login').hidden = !!me; $('pb-logout').hidden = !me;
    if (me) {
      $('pb-avatar').src = head(me.name, me.edition, 92);
      $('pb-name').textContent = `Welcome, ${me.name}`;
      $('pb-sub').textContent = `${me.edition === 'bedrock' ? 'Bedrock' : 'Java'} Edition. Purchases are delivered to this player.`;
    } else {
      $('pb-avatar').src = 'assets/img/logo.webp';
      $('pb-name').textContent = 'Welcome to the store';
      $('pb-sub').textContent = 'Log in with your Minecraft username to start shopping.';
    }
  }
  let afterLogin = null;
  function openLogin(then) {
    afterLogin = then || null;
    $('login-err').textContent = '';
    $('username').value = S.me?.name || '';
    segSet($('login-form'), 'data-edition', S.me?.edition || 'java');
    $('login-dialog').showModal();
    setTimeout(() => $('username').focus(), 30);
  }

  // ---------- routing ----------
  const route = () => {
    const h = location.hash.replace(/^#\/?/, '');
    const [kind, id] = h.split('/');
    return { kind: kind || 'home', id: decodeURIComponent(id || '') };
  };
  function go(hash) { if (location.hash !== hash) location.hash = hash; else render(); }
  const catOf = id => S.catalog.categories.find(c => c.id === id);
  const pkgOf = id => S.catalog.packages.find(p => p.id === id);
  const pkgsIn = id => S.catalog.packages.filter(p => p.categoryId === id);

  function render() {
    if (!S.catalog) return;
    const r = route();
    const view = $('view');
    view.replaceChildren();
    if (r.kind === 'p' && pkgOf(r.id)) {
      const p = pkgOf(r.id);
      view.append(categoryView(p.categoryId));
      if (!$('pkg-dialog').open) openPackage(p);
    } else if (r.kind === 'c' && catOf(r.id)) {
      view.append(categoryView(r.id));
    } else {
      view.append(homeView());
    }
    document.title = r.kind === 'c' && catOf(r.id) ? `${catOf(r.id).name} · ${S.catalog.store.name} Store` : `${S.catalog.store.name} Store`;
  }

  function homeView() {
    const c = S.catalog;
    const frag = document.createDocumentFragment();
    const about = lines(c.store.about);
    frag.append(el('section', { class: 'intro' },
      el('h2', { text: c.store.tagline || `Welcome to the ${c.store.name} store` }),
      ...(about.paras.length ? about.paras : ['Every purchase helps keep the server running. Purchases are delivered automatically, usually within a minute.']).map(t => el('p', { text: t }))));
    if (c.demo || !c.packages.length) {
      frag.append(el('div', { class: 'empty-state', text: 'The store is being set up. Packages will appear here shortly.' }));
      return frag;
    }
    frag.append(el('div', { class: 'section-title' }, el('h2', { text: 'Browse the store' }), el('span', { class: 'muted', text: `${c.packages.length} items` })));
    frag.append(el('div', { class: 'cat-grid' }, c.categories.map(cat => {
      const n = pkgsIn(cat.id).length;
      const image = safeImg(cat.image) || safeImg(pkgsIn(cat.id)[0]?.image);
      return el('a', { class: 'cat-tile', href: `#/c/${encodeURIComponent(cat.id)}` },
        image ? el('img', { src: image, alt: '', loading: 'lazy' }) : null,
        el('b', { text: cat.name }), el('span', { text: `${n} item${n === 1 ? '' : 's'}` }));
    })));
    frag.append(el('div', { class: 'policies' },
      el('div', { class: 'policy' }, el('b', { text: 'Instant delivery' }), el('p', { text: 'Items arrive in game automatically, usually within a minute of paying.' })),
      el('div', { class: 'policy' }, el('b', { text: 'Offline? No problem' }), el('p', { text: 'If you are not online, your items wait and arrive the next time you join.' })),
      el('div', { class: 'policy' }, el('b', { text: 'Need help?' }), el('p', {}, 'Open a ticket on our ', el('a', { href: c.store.discordUrl || '#', target: '_blank', rel: 'noopener', text: 'Discord' }), ' with the email you paid with.'))));
    return frag;
  }

  function categoryView(id) {
    const c = S.catalog, cat = catOf(id);
    const frag = document.createDocumentFragment();
    frag.append(el('nav', { class: 'cat-tabs', 'aria-label': 'Categories' }, c.categories.map(x => el('a', { href: `#/c/${encodeURIComponent(x.id)}`, class: x.id === id ? 'on' : null, text: x.name }))));
    frag.append(el('div', { class: 'cat-head' },
      el('div', { class: 'crumbs' }, el('a', { href: '#/', text: 'Store' }), el('span', { text: '/' }), el('span', { text: cat?.name || 'Packages' })),
      el('h2', { text: cat?.name || 'Packages' }), cat?.description ? el('p', { text: cat.description }) : null));
    const list = pkgsIn(id);
    frag.append(list.length ? el('div', { class: 'pkg-grid' }, list.map(card)) : el('div', { class: 'empty-state', text: 'Nothing here yet. Check back soon.' }));
    return frag;
  }

  function priceLine(p, cur) {
    const out = el('div', { class: 'price' });
    if (p.price !== null && p.price !== undefined) {
      out.append(el('b', { text: money(p.price, cur) }));
      if (p.compareAtPrice) out.append(el('s', { text: money(p.compareAtPrice, cur), 'aria-label': `was ${money(p.compareAtPrice, cur)}` }));
      if (p.monthlyPrice !== null && p.monthlyPrice !== undefined) out.append(el('small', { text: `or ${money(p.monthlyPrice, cur)}/month` }));
    } else if (p.monthlyPrice !== null && p.monthlyPrice !== undefined) {
      out.append(el('b', { text: money(p.monthlyPrice, cur) }), el('small', { text: 'per month' }));
    }
    return out;
  }

  function card(p) {
    const c = S.catalog, cur = c.store.currency;
    const perks = lines(p.description).bullets.slice(0, 3);
    const open = () => go(`#/p/${encodeURIComponent(p.id)}`);
    return el('article', { class: 'pkg' },
      p.badge ? el('span', { class: `badge${/save|value|everything/i.test(p.badge) ? ' gold' : ''}`, text: p.badge }) : null,
      el('button', { class: 'pkg-art', type: 'button', onclick: open, 'aria-label': `View ${p.name}` }, el('img', { src: safeImg(p.image) || 'assets/img/logo.webp', alt: '', loading: 'lazy' })),
      el('h3', { text: p.name }),
      p.upgradeFromName ? el('div', { class: 'req', text: `Requires ${p.upgradeFromName}` }) : null,
      perks.length ? el('ul', { class: 'perks' }, perks.map(t => el('li', { text: t }))) : null,
      el('div', { class: 'pkg-foot' }, priceLine(p, cur),
        el('div', { class: 'pkg-actions' },
          el('button', { class: 'btn', type: 'button', onclick: () => quickBuy(p), text: c.store.checkoutApi ? 'Add to basket' : 'Buy now' }),
          el('button', { class: 'btn ghost more-btn', type: 'button', onclick: open, 'aria-label': `Details for ${p.name}`, text: 'Details' }))));
  }

  // ---------- package dialog ----------
  function openPackage(p) {
    S.current = p;
    const c = S.catalog, cur = c.store.currency;
    $('pd-img').src = safeImg(p.image) || 'assets/img/logo.webp';
    $('pd-badge').textContent = p.badge || ''; $('pd-badge').hidden = !p.badge;
    $('pd-badge').className = `badge${/save|value|everything/i.test(p.badge || '') ? ' gold' : ''}`;
    $('pd-cat').textContent = catOf(p.categoryId)?.name || '';
    $('pd-name').textContent = p.name;
    $('pd-price').replaceChildren(priceLine(p, cur));
    $('pd-req').hidden = !p.upgradeFromName;
    $('pd-req').textContent = p.upgradeFromName ? `Upgrade: you need to own ${p.upgradeFromName} first. You only pay the difference.` : '';
    const d = lines(p.description);
    $('pd-desc').replaceChildren(...d.paras.map(t => el('p', { text: t })), d.bullets.length ? el('ul', {}, d.bullets.map(t => el('li', { text: t }))) : '');
    // included items / possible rewards
    const items = Array.isArray(p.contents) ? p.contents : [];
    $('pd-contents').hidden = !items.length;
    $('pd-ctitle').textContent = p.contentsTitle || 'Included';
    const withImg = items.filter(it => safeImg(it.image)), textOnly = items.filter(it => !safeImg(it.image));
    $('pd-clist').replaceChildren(...withImg.map(it => {
      const src = safeImg(it.image);
      return el('li', {}, el('div', { class: 'c-img' }, el('img', { src, alt: '', loading: 'lazy', class: /\/item-/.test(src) ? 'sprite' : null })),
        el('b', { text: it.name }), it.note ? el('span', { text: it.note }) : null);
    }));
    $('pd-clist').hidden = !withImg.length;
    $('pd-also').replaceChildren(...(textOnly.length ? [el('span', { class: 'also-label', text: withImg.length ? 'Also:' : '' }), ...textOnly.map(it => el('span', { class: 'chip', text: it.note ? `${it.name} (${it.note})` : it.name }))] : []));
    $('pd-also').hidden = !textOnly.length;
    // purchase options
    const opts = [];
    if (p.price !== null && p.price !== undefined) opts.push(['once', p.kind === 'giftcard' ? 'Gift card' : 'One-time payment', p.kind === 'giftcard' ? 'Single-use code, sent in game' : 'Yours to keep', money(p.price, cur)]);
    if (p.monthlyPrice !== null && p.monthlyPrice !== undefined) opts.push(['monthly', 'Monthly', 'Renews each month, cancel any time', `${money(p.monthlyPrice, cur)}/mo`]);
    $('pd-options').replaceChildren(...opts.map(([v, label, sub, amt], i) => el('label', { class: 'option' },
      el('input', { type: 'radio', name: 'ptype', value: v, checked: i === 0 }),
      el('span', { class: 'o-label' }, el('b', { text: label }), el('small', { text: sub })), el('span', { class: 'o-amt', text: amt }))));
    $('pd-options').hidden = opts.length < 2;
    $('pd-gift').hidden = !p.giftable; $('pd-gift').open = false; $('gift-name').value = '';
    $('pd-err').textContent = '';
    $('pd-buy').disabled = !!c.demo;
    $('pd-buy').textContent = c.demo ? 'Opening soon' : c.store.checkoutApi ? 'Add to basket' : 'Continue to checkout';
    if (!$('pkg-dialog').open) $('pkg-dialog').showModal();
  }
  function giftTarget() {
    if ($('pd-gift').hidden || !$('pd-gift').open) return null;
    const name = $('gift-name').value.trim();
    if (!name) return null;
    const edition = segValue($('pd-gift'), 'data-gift-edition');
    if (!validName(edition, name)) throw new Error(`Gift: ${nameError(edition)}`);
    return { edition, name };
  }
  function checkout(p, type, gift) {
    const c = S.catalog;
    if (c.store.checkoutApi) {
      S.basket = S.basket.filter(b => b.packageId !== p.id);
      if (type === 'monthly') S.basket = S.basket.filter(b => b.type !== 'monthly');
      S.basket.push({ packageId: p.id, type, gift });
      save('fs_basket', S.basket); renderBasketCount(); toast(`${p.name} added to your basket`);
      return true;
    }
    const link = p.links?.[type];
    if (!link || !/^https:\/\/(buy|checkout)\.stripe\.com\//.test(link)) return false;
    const url = new URL(link);
    url.searchParams.set('client_reference_id', encodeRef(S.me, gift));
    location.href = url.toString();
    return true;
  }
  function quickBuy(p) {
    if (S.catalog.demo) return toast('The store opens soon');
    // Packages with options (monthly, gifting) or upgrade notes open the full view.
    if ((p.monthlyPrice !== null && p.monthlyPrice !== undefined && p.price !== null) || p.upgradeFromName) return go(`#/p/${encodeURIComponent(p.id)}`);
    if (!S.me) return openLogin(() => quickBuy(p));
    if (!checkout(p, p.price !== null ? 'once' : 'monthly', null)) toast('This package is not available right now');
  }
  function buyCurrent() {
    const p = S.current;
    $('pd-err').textContent = '';
    if (!S.me) { $('pkg-dialog').close(); return openLogin(() => { go(`#/p/${encodeURIComponent(p.id)}`); openPackage(p); }); }
    let gift;
    try { gift = giftTarget(); } catch (e) { $('pd-err').textContent = e.message; return; }
    const type = document.querySelector('input[name="ptype"]:checked')?.value || (p.price !== null ? 'once' : 'monthly');
    if (!checkout(p, type, gift)) { $('pd-err').textContent = 'This package is not available right now.'; return; }
    if (S.catalog.store.checkoutApi) $('pkg-dialog').close();
  }

  // ---------- basket (only when the store server is hosted publicly) ----------
  function renderBasketCount() { $('basket-count').textContent = String(S.basket.length); }
  function openBasket() {
    const c = S.catalog, list = $('basket-list');
    list.replaceChildren();
    for (const b of S.basket) {
      const p = pkgOf(b.packageId); if (!p) continue;
      const amt = b.type === 'monthly' ? `${money(p.monthlyPrice, c.store.currency)}/mo` : money(p.price, c.store.currency);
      list.append(el('li', {}, el('img', { src: safeImg(p.image) || 'assets/img/logo.webp', alt: '' }),
        el('div', { class: 'bl-name' }, el('b', { text: p.name }), el('small', { text: b.gift ? `Gift for ${b.gift.name}` : (b.type === 'monthly' ? 'Monthly' : 'One-time') })),
        el('b', { text: amt }),
        el('button', { class: 'link', type: 'button', text: 'Remove', onclick: () => { S.basket = S.basket.filter(x => x !== b); save('fs_basket', S.basket); renderBasketCount(); openBasket(); } })));
    }
    if (!list.children.length) list.append(el('li', { class: 'muted', text: 'Your basket is empty.' }));
    $('basket-checkout').disabled = !S.basket.length;
    if (!$('basket-dialog').open) $('basket-dialog').showModal();
  }
  async function checkoutBasket() {
    const err = $('basket-err'); err.textContent = '';
    if (!S.me) { $('basket-dialog').close(); return openLogin(openBasket); }
    const gifts = [...new Set(S.basket.map(b => b.gift ? `${b.gift.edition}:${b.gift.name}` : ''))];
    if (gifts.length > 1) { err.textContent = 'Check out gifts for different players separately.'; return; }
    const btn = $('basket-checkout'); btn.disabled = true; btn.textContent = 'Opening checkout…';
    try {
      const r = await fetch(S.catalog.store.checkoutApi, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player: S.me, giftTo: S.basket[0]?.gift || null, items: S.basket.map(b => ({ packageId: b.packageId, type: b.type })) }) });
      const j = await r.json();
      if (!r.ok || !/^https:\/\/checkout\.stripe\.com\//.test(j.url)) throw new Error(j.error || 'Checkout is unavailable right now.');
      S.basket = []; save('fs_basket', []);
      location.href = j.url;
    } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Check out'; }
  }

  // ---------- live widgets ----------
  function renderLive() {
    const l = S.live || {}, c = S.catalog;
    if (l.goal) {
      $('goal-panel').hidden = false;
      $('goal-title').textContent = l.goal.title || 'Community goal';
      $('goal-text').textContent = `${l.goal.percent}% of this month's goal reached. Thank you!`;
      $('goal-bar').setAttribute('aria-valuenow', String(l.goal.percent));
      requestAnimationFrame(() => { $('goal-fill').style.width = `${Math.min(100, l.goal.percent)}%`; });
    }
    if (l.topCustomer) {
      $('top-panel').hidden = false;
      $('top-name').textContent = l.topCustomer.player;
      $('top-head').src = head(l.topCustomer.player, l.topCustomer.edition, 112);
    }
    if (l.recentPayments?.length) {
      $('recent-panel').hidden = false;
      $('recent').replaceChildren(...l.recentPayments.map(r => el('li', {},
        el('img', { src: head(r.player, r.edition), alt: '', loading: 'lazy' }),
        el('div', {}, el('b', { text: r.player }), el('span', { text: `${r.items.join(', ')} · ${ago(r.at)}` })))));
    }
    const fresh = l.players && Date.now() - Date.parse(l.generatedAt) < 10 * 60e3;
    if (fresh) setPlayers(l.players.online, true); else pingServer(c.store.serverIp);
  }
  function setPlayers(n, online) {
    $('player-tag').classList.toggle('off', !online);
    $('player-count').textContent = online ? `${n} online` : 'Offline';
  }
  async function pingServer(ip) {
    if (!ip) return;
    try { const j = await (await fetch(`https://api.mcsrvstat.us/3/${encodeURIComponent(ip)}`)).json(); setPlayers(j.players?.online ?? 0, !!j.online); }
    catch { /* leave the default */ }
  }
  async function discordCount(url) {
    const code = (String(url).match(/discord\.(?:gg|com\/invite)\/([\w-]+)/) || [])[1];
    if (!code) return;
    try {
      const j = await (await fetch(`https://discord.com/api/v10/invites/${code}?with_counts=true`)).json();
      if (j.approximate_presence_count) { $('discord-count').textContent = `${j.approximate_presence_count.toLocaleString()} online`; $('discord-tag').hidden = false; }
    } catch { /* optional */ }
  }

  // ---------- snow ----------
  function snow() {
    const cv = $('snow'); if (!cv || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const ctx = cv.getContext('2d'); let w, h, flakes = [];
    const size = () => { w = cv.width = cv.offsetWidth * devicePixelRatio; h = cv.height = cv.offsetHeight * devicePixelRatio; };
    size(); addEventListener('resize', size);
    const n = Math.min(90, Math.round(cv.offsetWidth / 16));
    for (let i = 0; i < n; i++) flakes.push({ x: Math.random() * w, y: Math.random() * h, r: (Math.random() * 1.8 + .6) * devicePixelRatio, s: Math.random() * .5 + .25, d: Math.random() * Math.PI * 2 });
    let visible = true;
    new IntersectionObserver(([e]) => { visible = e.isIntersecting; }).observe(cv);
    (function tick() {
      if (visible && !document.hidden) {
        ctx.clearRect(0, 0, w, h); ctx.fillStyle = 'rgba(238,246,255,.8)'; ctx.beginPath();
        for (const f of flakes) {
          f.y += f.s * devicePixelRatio; f.d += .01; f.x += Math.sin(f.d) * .3 * devicePixelRatio;
          if (f.y > h) { f.y = -5; f.x = Math.random() * w; }
          ctx.moveTo(f.x, f.y); ctx.arc(f.x, f.y, f.r, 0, Math.PI * 2);
        }
        ctx.fill();
      }
      requestAnimationFrame(tick);
    })();
  }

  // ---------- boot ----------
  async function boot() {
    $('year').textContent = String(new Date().getFullYear());
    S.me = load('fs_player');
    const qs = new URLSearchParams(location.search);
    if (qs.get('player')) { // links from the in-game /buy menu
      const fromGame = { edition: qs.get('edition') === 'bedrock' ? 'bedrock' : 'java', name: qs.get('player').trim() };
      if (validName(fromGame.edition, fromGame.name)) { S.me = fromGame; save('fs_player', fromGame); }
      history.replaceState(null, '', location.pathname + location.hash);
    }
    if (S.me && !validName(S.me.edition, S.me.name)) S.me = null;
    S.basket = (load('fs_basket') || []).filter(b => b && b.packageId);
    renderMe(); renderBasketCount(); snow();

    $('pb-login').addEventListener('click', () => openLogin());
    $('pb-logout').addEventListener('click', () => { S.me = null; save('fs_player', null); renderMe(); toast('Logged out'); });
    $('login-form').addEventListener('click', e => { const b = e.target.closest('[data-edition]'); if (b) { segSet($('login-form'), 'data-edition', b.dataset.edition); $('username').focus(); } });
    $('username').addEventListener('input', () => {
      const n = $('username').value.trim(), ed = segValue($('login-form'), 'data-edition');
      $('login-head').src = n && validName(ed, n) ? head(n, ed, 144) : 'assets/img/logo.webp';
    });
    $('login-form').addEventListener('submit', e => {
      e.preventDefault();
      const edition = segValue($('login-form'), 'data-edition'), name = $('username').value.trim();
      if (!validName(edition, name)) { $('login-err').textContent = nameError(edition); return; }
      S.me = { edition, name }; save('fs_player', S.me); renderMe();
      $('login-dialog').close(); toast(`Logged in as ${name}`);
      const next = afterLogin; afterLogin = null; if (next) next();
    });
    $('pd-gift').addEventListener('click', e => { const b = e.target.closest('[data-gift-edition]'); if (b) segSet($('pd-gift'), 'data-gift-edition', b.dataset.giftEdition); });
    $('pd-buy').addEventListener('click', buyCurrent);
    $('pkg-dialog').addEventListener('close', () => { if (route().kind === 'p') history.replaceState(null, '', `#/c/${encodeURIComponent(S.current?.categoryId || '')}`); });
    $('copy-ip').addEventListener('click', async () => {
      const ip = $('server-ip').textContent;
      try { await navigator.clipboard.writeText(ip); toast('Server IP copied'); } catch { toast(ip); }
    });
    $('open-basket').addEventListener('click', openBasket);
    $('basket-checkout').addEventListener('click', checkoutBasket);
    document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => b.closest('dialog').close()));
    document.querySelectorAll('dialog').forEach(d => d.addEventListener('click', e => { if (e.target === d) d.close(); }));
    addEventListener('hashchange', () => { if ($('pkg-dialog').open && route().kind !== 'p') $('pkg-dialog').close(); render(); scrollTo({ top: Math.min(scrollY, $('content').offsetTop - 16) }); });

    try {
      const [cat, live] = await Promise.all([
        fetch(`data/catalog.json?t=${Date.now()}`).then(r => r.json()),
        fetch(`data/live.json?t=${Date.now()}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      S.catalog = cat; S.live = live;
      const st = cat.store;
      if (st.serverIp) { $('server-ip').textContent = st.serverIp; document.querySelector('.footer-brand span').textContent = st.serverIp; }
      if (/^https:\/\//.test(st.discordUrl || '')) ['nav-discord', 'discord-block', 'foot-discord'].forEach(id => { $(id).href = st.discordUrl; });
      if (/^https:\/\//.test(st.homeUrl || '')) $('nav-home').href = st.homeUrl;
      $('test-ribbon').hidden = !st.testMode;
      if (st.notice) { $('notice').textContent = st.notice; $('notice').hidden = false; }
      $('open-basket').hidden = !st.checkoutApi;
      render(); renderLive(); discordCount(st.discordUrl);
    } catch {
      $('view').replaceChildren(el('div', { class: 'empty-state', text: 'The store could not load. Refresh the page to try again.' }));
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
