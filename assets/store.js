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
  // Package text: "## Heading", "- bullet", "> tip", "![alt](assets/img/x.webp)" and **bold**. Built as DOM nodes, never HTML.
  function inline(t) {
    const parts = String(t).split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
    return parts.map(x => /^\*\*[^*]+\*\*$/.test(x) ? el('b', { text: x.slice(2, -2) }) : document.createTextNode(x));
  }
  function richText(text) {
    const out = []; let list = null;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const t = raw.trim();
      if (!t) { list = null; continue; }
      let m;
      if (/^[-*•]\s+/.test(t)) { if (!list) { list = el('ul', { class: 'perks' }); out.push(list); } list.append(el('li', {}, el('span', {}, ...inline(t.replace(/^[-*•]\s+/, ''))))); continue; }
      list = null;
      if ((m = /^#{1,3}\s+(.+)$/.exec(t))) out.push(el('h4', { class: 'd-head' }, ...inline(m[1])));
      else if ((m = /^>\s*(.+)$/.exec(t))) out.push(el('p', { class: 'd-tip' }, ...inline(m[1])));
      else if ((m = /^!\[([^\]]*)\]\(([^)]+)\)$/.exec(t))) { const src = safeImg(m[2]); if (src) out.push(el('img', { class: 'd-img', src, alt: m[1], loading: 'lazy' })); }
      else out.push(el('p', {}, ...inline(t)));
    }
    return out;
  }
  // ---------- real in-game rank (from LuckPerms via the plugin, published anonymised in data/ranks.json) ----------
  async function rankKey(name) {
    const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('fstore:' + String(name).toLowerCase()));
    return [...new Uint8Array(buf)].slice(0, 8).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const cmdNameOf = me => me.edition === 'bedrock' ? (S.catalog?.store?.floodgatePrefix ?? '.') + me.name.replace(/ /g, '_') : me.name;
  async function refreshTier() {
    S.myTier = undefined;
    if (!S.me || !S.ranks?.players || !crypto?.subtle) return;
    try { S.myTier = S.ranks.players[await rankKey(cmdNameOf(S.me))] || null; } catch { S.myTier = undefined; }
  }
  const tierName = id => S.ranks?.ladder?.find(r => r.id === id)?.name || id;
  /** Why this player can't buy this upgrade, or null. */
  function upgradeBlock(p) {
    if (!p.upgradeTier || !S.ranks || !S.me || S.myTier === undefined) return null;
    if (S.myTier === p.upgradeTier) return null;
    return `This upgrade is only for players who have ${tierName(p.upgradeTier)}. ${S.me.name} ${S.myTier ? `has ${tierName(S.myTier)}` : 'has no rank'} right now.`;
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

  // ---------- deals & gentle suggestions ----------
  const worthOf = p => (p.parts || []).reduce((a, x) => a + ((pkgOf(x.packageId)?.regularPrice ?? pkgOf(x.packageId)?.price) || 0) * x.qty, 0);
  const refPrice = p => Math.max(p.compareAtPrice || 0, p.regularCompareAtPrice || 0, p.regularPrice || 0, worthOf(p));
  const savingOf = p => (p.price != null && p.kind !== 'giftcard' && refPrice(p) > p.price ? 1 - p.price / refPrice(p) : 0);
  const bestDeals = (n = 4) => S.catalog.packages.filter(p => savingOf(p) >= 0.05 && !upgradeBlock(p)).sort((a, b) => savingOf(b) - savingOf(a) || b.price - a.price).slice(0, n);
  // what pairs well with what (by category); bundles that contain the item always come first
  const PAIRS = {
    'crate-keys': ['glacier-lootbox', 'special-class-roll'], lootboxes: ['relic-key', 'finality-key-5'], classes: ['finality-key-5', 'relic-key'],
    ranks: ['key-bundle', 'starter-kit'], 'rank-upgrades': ['key-bundle', 'starter-kit'], cosmetics: ['ke-lootbox-5', 'finality-key'], bundles: ['glacier-lootbox', 'relic-key'],
  };
  function pairsFor(p) {
    const out = [];
    const add = x => { if (x && x.id !== p.id && x.price != null && !out.includes(x) && !upgradeBlock(x) && !S.basket.some(b => b.packageId === x.id)) out.push(x); };
    S.catalog.packages.filter(b => b.parts?.some(x => x.packageId === p.id)).sort((a, b) => savingOf(b) - savingOf(a)).forEach(add);
    (PAIRS[p.categoryId] || []).map(pkgOf).forEach(add);
    return out.slice(0, 2);
  }
  /** The bundle the basket is closest to, if it's worth mentioning. */
  function bundleSwap() {
    const have = id => S.basket.filter(b => b.packageId === id && b.type === 'once').reduce((a, b) => a + qtyOf(b), 0);
    let best = null;
    for (const bp of S.catalog.packages.filter(p => p.parts?.length && p.price != null)) {
      if (S.basket.some(b => b.packageId === bp.id)) continue;
      let covered = 0; const take = [];
      for (const part of bp.parts) {
        const pp = pkgOf(part.packageId); if (!pp || pp.price == null) { covered = 0; break; }
        const n = Math.min(have(part.packageId), part.qty);
        if (n > 0) { covered += n * pp.price; take.push([part.packageId, n]); }
      }
      if (!covered || covered < bp.price * 0.3) continue;
      const score = covered / bp.price;
      if (!best || score > best.score) best = { bp, take, extra: bp.price - covered, score };
    }
    return best;
  }
  function swapToBundle(s) {
    const gift = S.basket.find(b => b.packageId === s.take[0][0])?.gift || null;
    for (const [id, n] of s.take) {
      let left = n;
      for (const b of S.basket.filter(x => x.packageId === id && x.type === 'once')) { const used = Math.min(left, qtyOf(b)); b.qty = qtyOf(b) - used; left -= used; }
    }
    S.basket = S.basket.filter(b => qtyOf(b) > 0 && b.qty !== 0);
    S.basket.push({ packageId: s.bp.id, type: 'once', gift, qty: 1 });
    save('fs_basket', S.basket); renderBasketCount(); toast(`Swapped to the ${s.bp.name}`); openBasket();
  }

  function render() {
    if (!S.catalog) return;
    const r = route();
    const view = $('view');
    view.replaceChildren();
    if (r.kind === 'p' && pkgOf(r.id)) {
      const p = pkgOf(r.id);
      view.append(categoryView(p.categoryId));
      if (!$('pkg-dialog').open || S.current?.id !== p.id) openPackage(p);
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
    const deals = bestDeals();
    if (deals.length) {
      frag.append(el('div', { class: 'section-title' }, el('h2', { text: 'Best deals' }), el('span', { class: 'muted', text: 'The biggest savings in the store right now' })));
      frag.append(el('div', { class: 'pkg-grid deals' }, deals.map(p => { const c = card(p); c.prepend(el('span', { class: 'deal-save', text: `Save ${Math.round(savingOf(p) * 100)}%` })); return c; })));
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

  // ---------- store-wide sale ----------
  const onSale = p => !!(S.catalog?.store?.sale && (p.regularPrice != null || p.monthlyFirstPrice != null));
  // The catalog is regenerated every minute, but a page left open past the end time undoes the sale itself.
  function endSaleIfOver() {
    const c = S.catalog, sale = c?.store?.sale;
    if (!sale || !sale.endsAt || Date.now() < sale.endsAt) return false;
    for (const p of c.packages) {
      if (p.regularPrice != null) { p.price = p.regularPrice; p.compareAtPrice = p.regularCompareAtPrice ?? null; }
      delete p.regularPrice; delete p.regularCompareAtPrice; delete p.monthlyFirstPrice;
    }
    c.store.sale = null;
    return true;
  }
  let saleTimer = null;
  function renderSaleBar() {
    clearTimeout(saleTimer);
    const sale = S.catalog?.store?.sale, bar = $('sale-bar');
    if (!bar) return;
    if (!sale) { bar.hidden = true; return; }
    const left = sale.endsAt ? sale.endsAt - Date.now() : null;
    const d = left === null ? '' : left > 864e5 ? `${Math.floor(left / 864e5)}d ${Math.floor(left % 864e5 / 36e5)}h` : left > 36e5 ? `${Math.floor(left / 36e5)}h ${Math.floor(left % 36e5 / 6e4)}m` : `${Math.max(1, Math.ceil(left / 6e4))}m`;
    bar.replaceChildren(el('b', { text: sale.label || `${sale.percent}% off everything` }),
      el('span', { text: sale.label ? ` · ${sale.percent}% off everything, no code needed` : ' · no code needed, applied at checkout' }),
      ...(d ? [el('span', { class: 'sale-left', text: ` · ends in ${d}` })] : []));
    bar.hidden = false;
    if (left !== null) saleTimer = setTimeout(() => { if (endSaleIfOver()) { renderSaleBar(); render(); } else renderSaleBar(); }, Math.min(left + 500, 60e3));
  }

  function priceLine(p, cur) {
    const out = el('div', { class: 'price' });
    if (p.price !== null && p.price !== undefined) {
      out.append(el('b', { text: money(p.price, cur) }));
      if (p.compareAtPrice) out.append(el('s', { text: money(p.compareAtPrice, cur), 'aria-label': `was ${money(p.compareAtPrice, cur)}` }));
      if (onSale(p)) out.append(el('span', { class: 'sale-tag', text: `-${S.catalog.store.sale.percent}%` }));
      if (p.monthlyPrice !== null && p.monthlyPrice !== undefined) out.append(el('small', { text: `or ${money(p.monthlyPrice, cur)}/month` }));
    } else if (p.monthlyPrice !== null && p.monthlyPrice !== undefined) {
      if (p.monthlyFirstPrice != null) out.append(el('b', { text: money(p.monthlyFirstPrice, cur) }), el('s', { text: money(p.monthlyPrice, cur), 'aria-label': `normally ${money(p.monthlyPrice, cur)}` }), el('small', { text: `first month, then ${money(p.monthlyPrice, cur)}/month` }));
      else out.append(el('b', { text: money(p.monthlyPrice, cur) }), el('small', { text: 'per month' }));
    }
    return out;
  }

  function card(p) {
    const c = S.catalog, cur = c.store.currency;
    const perks = lines(p.body || p.description).bullets.slice(0, 3).map(b => b.replace(/\*\*/g, ''));
    const open = () => go(`#/p/${encodeURIComponent(p.id)}`);
    const blocked = upgradeBlock(p), owns = p.upgradeTier && S.me && S.myTier === p.upgradeTier;
    const req = !p.upgradeFromName ? null
      : blocked ? el('div', { class: 'req bad', text: `Needs ${tierName(p.upgradeTier)}: ${S.me.name} ${S.myTier ? `has ${tierName(S.myTier)}` : 'has no rank'}` })
      : owns ? el('div', { class: 'req ok', text: `✓ You have ${tierName(p.upgradeTier)}` })
      : el('div', { class: 'req', text: `Requires ${p.upgradeTier ? tierName(p.upgradeTier) : p.upgradeFromName}` });
    return el('article', { class: blocked ? 'pkg locked' : 'pkg' },
      p.badge ? el('span', { class: `badge${/save|value|everything/i.test(p.badge) ? ' gold' : ''}`, text: p.badge }) : null,
      el('button', { class: 'pkg-art', type: 'button', onclick: open, 'aria-label': `View ${p.name}` }, el('img', { src: safeImg(p.image) || 'assets/img/logo.webp', alt: '', loading: 'lazy' })),
      el('h3', { text: p.name }),
      req,
      perks.length ? el('ul', { class: 'perks' }, perks.map(t => el('li', { text: t }))) : null,
      el('div', { class: 'pkg-foot' }, priceLine(p, cur),
        el('div', { class: 'pkg-actions' },
          el('button', { class: 'btn', type: 'button', disabled: !!blocked, onclick: () => quickBuy(p), text: blocked ? `Needs ${tierName(p.upgradeTier)}` : c.store.checkoutApi ? 'Add to basket' : 'Buy now' }),
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
    if (p.fixedPrice) $('pd-price').append(el('p', { class: 'fixed-note', text: 'Fixed price. Sales and discount codes don\'t apply to this item.' }));
    const blocked = upgradeBlock(p);
    $('pd-req').hidden = !p.upgradeFromName;
    $('pd-req').classList.toggle('bad', !!blocked);
    $('pd-req').textContent = blocked || (p.upgradeFromName ? `Upgrade: you need to have ${p.upgradeTier ? tierName(p.upgradeTier) : p.upgradeFromName} in game. You only pay the difference.` : '');
    $('pd-desc').replaceChildren(...richText(p.body || p.description));
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
    if (p.monthlyPrice !== null && p.monthlyPrice !== undefined) opts.push(['monthly', 'Monthly', p.monthlyFirstPrice != null ? `${money(p.monthlyFirstPrice, cur)} for the first month, then ${money(p.monthlyPrice, cur)}/mo` : 'Renews each month, cancel any time', `${money(p.monthlyFirstPrice ?? p.monthlyPrice, cur)}/mo`]);
    $('pd-options').replaceChildren(...opts.map(([v, label, sub, amt], i) => el('label', { class: 'option' },
      el('input', { type: 'radio', name: 'ptype', value: v, checked: i === 0 }),
      el('span', { class: 'o-label' }, el('b', { text: label }), el('small', { text: sub })), el('span', { class: 'o-amt', text: amt }))));
    $('pd-options').hidden = opts.length < 2;
    $('pd-gift').hidden = !p.giftable; $('pd-gift').open = false; $('gift-name').value = '';
    const pairs = c.store.checkoutApi ? pairsFor(p) : [];
    $('pd-pair').hidden = !pairs.length;
    $('pd-pair-list').replaceChildren(...pairs.map(x => {
      const inBundle = x.parts?.some(y => y.packageId === p.id);
      const save = Math.round(savingOf(x) * 100);
      return el('div', { class: 'pair' },
        el('img', { src: safeImg(x.image) || 'assets/img/logo.webp', alt: '', loading: 'lazy' }),
        el('div', { class: 'pair-txt' }, el('b', { text: x.name }),
          el('small', { text: inBundle ? `Includes this${save ? `, save ${save}%` : ''}` : money(x.price, cur) })),
        inBundle ? el('button', { class: 'btn ghost sm', type: 'button', text: 'View', onclick: () => go(`#/p/${encodeURIComponent(x.id)}`) })
          : el('button', { class: 'btn ghost sm', type: 'button', text: 'Add', onclick: e => { quickBuy(x); if (S.me && x.maxQty) { e.target.textContent = 'Added ✓'; e.target.disabled = true; } } }));
    }));
    $('pd-err').textContent = '';
    $('pd-buy').disabled = !!c.demo || !!blocked;
    $('pd-buy').textContent = c.demo ? 'Opening soon' : blocked ? `Needs ${tierName(p.upgradeTier)}` : c.store.checkoutApi ? 'Add to basket' : 'Continue to checkout';
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
      const max = type === 'monthly' ? 1 : (p.maxQty || 1);
      const giftKey = g => (g ? `${g.edition}:${g.name.toLowerCase()}` : '');
      const same = S.basket.find(b => b.packageId === p.id && b.type === type && giftKey(b.gift) === giftKey(gift));
      if (same && max > 1) {
        same.qty = Math.min(max, (same.qty || 1) + 1);
      } else {
        S.basket = S.basket.filter(b => b.packageId !== p.id);
        if (type === 'monthly') S.basket = S.basket.filter(b => b.type !== 'monthly');
        S.basket.push({ packageId: p.id, type, gift, qty: 1 });
      }
      save('fs_basket', S.basket); renderBasketCount();
      toast(same && max > 1 ? `${p.name} ×${same.qty} in your basket` : `${p.name} added to your basket`);
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
    const blocked = upgradeBlock(p);
    if (blocked) { $('pd-err').textContent = blocked; return; }
    let gift;
    try { gift = giftTarget(); } catch (e) { $('pd-err').textContent = e.message; return; }
    const type = document.querySelector('input[name="ptype"]:checked')?.value || (p.price !== null ? 'once' : 'monthly');
    if (!checkout(p, type, gift)) { $('pd-err').textContent = 'This package is not available right now.'; return; }
    if (S.catalog.store.checkoutApi) $('pkg-dialog').close();
  }

  // ---------- basket (only when the store server is hosted publicly) ----------
  const qtyOf = b => Math.max(1, Math.floor(Number(b.qty) || 1));
  function renderBasketCount() { $('basket-count').textContent = String(S.basket.reduce((a, b) => a + qtyOf(b), 0)); pingSoon(); }
  function setQty(b, n) {
    const p = pkgOf(b.packageId), max = b.type === 'monthly' ? 1 : (p?.maxQty || 1);
    if (n < 1) S.basket = S.basket.filter(x => x !== b);
    else b.qty = Math.min(max, n);
    save('fs_basket', S.basket); renderBasketCount(); openBasket();
  }
  // ---------- spend ranks (Emerald / Obsidian), from data/spend.json (hashed names, whole dollars) ----------
  async function mySpend() {
    if (!S.me || !S.spend?.players || !crypto?.subtle) return 0;
    try { return S.spend.players[await rankKey(cmdNameOf(S.me))] || 0; } catch { return 0; }
  }
  async function renderSpendRank(basketMinor) {
    const box = $('basket-spend'), tiers = (S.catalog?.store?.spendRanks || S.spend?.tiers || []).slice().sort((a, b) => a.threshold - b.threshold);
    if (!box) return;
    if (!tiers.length || !S.me) { box.hidden = true; return; }
    const spent = await mySpend(), basket = Math.floor(basketMinor / 100), after = spent + basket;
    const next = tiers.find(t => t.threshold > spent);
    const cur = S.catalog.store.currency;
    const $$ = d => money(d * 100, cur).replace(/\.00$/, '');
    const unlocks = tiers.filter(t => t.threshold > spent && t.threshold <= after);
    const fill = $('bs-fill'), pend = $('bs-pend');
    box.hidden = false;
    if (!next) {
      $('bs-text').replaceChildren(el('b', { text: `${tiers[tiers.length - 1].name} rank unlocked.` }), ' Thank you for everything you do for Finality!');
      fill.style.width = '100%'; pend.style.width = '0'; return;
    }
    const prev = [...tiers].reverse().find(t => t.threshold <= spent)?.threshold || 0;
    const span = next.threshold - prev;
    const pct = v => Math.max(0, Math.min(100, ((v - prev) / span) * 100));
    fill.style.width = `${pct(spent)}%`;
    pend.style.left = `${pct(spent)}%`; pend.style.width = `${pct(Math.min(after, next.threshold)) - pct(spent)}%`;
    if (unlocks.length) {
      const top = unlocks[unlocks.length - 1];
      $('bs-text').replaceChildren('🎉 This order unlocks the ', el('b', { class: `sr-${top.id}`, text: `${top.name.toUpperCase()} rank` }), '! Same perks as Finality, plus its own exclusive tag.');
    } else {
      $('bs-text').replaceChildren('Spend ', el('b', { text: $$(next.threshold - after) }), ' more to unlock the ', el('b', { class: `sr-${next.id}`, text: `${next.name.toUpperCase()} rank` }), '. ',
        el('small', { text: `You've spent ${$$(spent)} so far${basket ? `, ${$$(basket)} in this basket` : ''}. Gifts you buy count too.` }));
    }
  }

  // ---------- live viewers (shown to staff in the store admin panel; no personal data) ----------
  const presenceUrl = () => (S.catalog?.store?.checkoutApi || '').replace(/\/api\/checkout$/, '/api/presence') || null;
  let sid = '';
  try { sid = sessionStorage.getItem('fs_sid') || ''; } catch {}
  if (!/^[A-Za-z0-9]{12,40}$/.test(sid)) {
    sid = Array.from(crypto.getRandomValues(new Uint8Array(16)), b => (b % 36).toString(36)).join('');
    try { sessionStorage.setItem('fs_sid', sid); } catch {}
  }
  let presenceRef = document.referrer || '', presencePage = null, pingTimer = null, leaving = false;
  function ping(extra) {
    const url = presenceUrl();
    if (!url || leaving) return;
    const body = { sid, page: presencePage || location.hash.replace(/^#\/?/, ''), player: S.me ? { edition: S.me.edition, name: S.me.name } : null,
      basket: S.basket.map(b => ({ id: b.packageId, type: b.type, qty: qtyOf(b) })), ...extra };
    if (presenceRef) { body.ref = presenceRef; presenceRef = ''; }
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), keepalive: true }).catch(() => {});
  }
  function pingSoon() { clearTimeout(pingTimer); pingTimer = setTimeout(() => ping(), 400); }
  function startPresence() {
    if (!presenceUrl()) return;
    ping();
    setInterval(() => { if (document.visibilityState === 'visible') ping(); }, 15000);
    addEventListener('hashchange', pingSoon);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') ping(); });
    $('basket-dialog').addEventListener('close', () => { if (presencePage === 'basket') { presencePage = null; pingSoon(); } });
    addEventListener('pagehide', () => {
      if (leaving) return;
      try { navigator.sendBeacon(presenceUrl(), new Blob([JSON.stringify({ sid, leave: true })], { type: 'application/json' })); } catch {}
    });
  }
  function openBasket() {
    const c = S.catalog, list = $('basket-list');
    list.replaceChildren();
    let totalMinor = 0;
    for (const b of S.basket) {
      const p = pkgOf(b.packageId); if (!p) continue;
      const q = qtyOf(b), max = b.type === 'monthly' ? 1 : (p.maxQty || 1);
      const unit = b.type === 'monthly' ? (p.monthlyFirstPrice != null ? p.monthlyFirstPrice : p.monthlyPrice) : p.price;
      totalMinor += (unit || 0) * q;
      const amt = b.type === 'monthly' ? (p.monthlyFirstPrice != null ? `${money(p.monthlyFirstPrice, c.store.currency)} first month` : `${money(p.monthlyPrice, c.store.currency)}/mo`) : money(p.price * q, c.store.currency);
      const stepper = max > 1 ? el('div', { class: 'qty', role: 'group', 'aria-label': `Quantity of ${p.name}` },
        el('button', { type: 'button', 'aria-label': 'One less', text: '−', onclick: () => setQty(b, q - 1) }),
        el('input', { type: 'number', min: '1', max: String(max), value: String(q), inputmode: 'numeric', 'aria-label': 'Quantity',
          onchange: e => setQty(b, Math.floor(Number(e.target.value) || 1)) }),
        el('button', { type: 'button', 'aria-label': 'One more', text: '+', disabled: q >= max, onclick: () => setQty(b, q + 1) })) : null;
      list.append(el('li', {}, el('img', { src: safeImg(p.image) || 'assets/img/logo.webp', alt: '' }),
        el('div', { class: 'bl-name' }, el('b', { text: p.name }), el('small', { text: b.gift ? `Gift for ${b.gift.name}` : (b.type === 'monthly' ? 'Monthly' : (q > 1 ? `${money(p.price, c.store.currency)} each` : 'One-time')) })),
        stepper,
        el('b', { class: 'bl-amt', text: amt }),
        el('button', { class: 'link', type: 'button', text: 'Remove', onclick: () => { S.basket = S.basket.filter(x => x !== b); save('fs_basket', S.basket); renderBasketCount(); openBasket(); } })));
    }
    const tot = $('basket-total');
    if (tot) { tot.hidden = !S.basket.length; $('basket-total-amt').textContent = money(totalMinor, c.store.currency); }
    renderSpendRank(totalMinor);
    // gentle hints: bundle swap + free bonus progress
    const hints = $('basket-hints');
    if (hints) {
      const out = [];
      const sw = S.basket.length ? bundleSwap() : null;
      if (sw) {
        const add = sw.bp.parts.map(x => { const got = sw.take.find(t => t[0] === x.packageId)?.[1] || 0; return x.qty - got > 0 ? `${x.qty - got}× ${pkgOf(x.packageId)?.name}` : null; }).filter(Boolean);
        out.push(el('div', { class: 'hint' }, el('span', { class: 'hint-ico', text: '💡' }),
          el('p', {}, 'You\'re part way to the ', el('b', { text: sw.bp.name }), '. ',
            sw.extra > 0 ? `Swap to it and get ${add.length ? add.join(', ') : 'the rest'} for just ${money(sw.extra, c.store.currency)} more.` : `Swap to it and save ${money(-sw.extra, c.store.currency)}.`),
          el('button', { class: 'btn ghost sm', type: 'button', text: 'Swap', onclick: () => swapToBundle(sw) })));
      }
      const bonuses = (c.store.bonuses || []).slice().sort((a, b) => a.min - b.min);
      if (bonuses.length && S.basket.length) {
        const got = bonuses.filter(b => totalMinor >= b.min), next = bonuses.find(b => totalMinor < b.min);
        const txt = [];
        if (got.length) txt.push(el('span', {}, 'Free ', el('b', { text: got.map(b => b.label).join(' + ') }), ' included. '));
        if (next) txt.push(el('span', {}, `Add ${money(next.min - totalMinor, c.store.currency)} more for a free `, el('b', { text: next.label }), '.'));
        out.push(el('div', { class: `hint${got.length && !next ? ' done' : ''}` }, el('span', { class: 'hint-ico', text: '🎁' }), el('p', {}, ...txt)));
      }
      hints.replaceChildren(...out);
      hints.hidden = !out.length;
    }
    if (!list.children.length) list.append(el('li', { class: 'muted', text: 'Your basket is empty.' }));
    const sale = c.store.sale, note = $('basket-sale');
    if (note) {
      const fixed = S.basket.some(b => pkgOf(b.packageId)?.fixedPrice);
      const saleOn = sale && S.basket.some(b => onSale(pkgOf(b.packageId) || {}));
      note.hidden = !saleOn && !fixed;
      note.textContent = saleOn ? `${sale.percent}% sale applied automatically at checkout${fixed ? ' (not on fixed-price items)' : ''}. Discount codes can't be added on top.`
        : fixed ? 'This basket has a fixed-price item, so discount codes can\'t be used on this order.' : '';
    }
    $('basket-checkout').disabled = !S.basket.length;
    if (!$('basket-dialog').open) $('basket-dialog').showModal();
    presencePage = 'basket'; pingSoon();
  }
  async function checkoutBasket() {
    const err = $('basket-err'); err.textContent = '';
    if (!S.me) { $('basket-dialog').close(); return openLogin(openBasket); }
    const gifts = [...new Set(S.basket.map(b => b.gift ? `${b.gift.edition}:${b.gift.name}` : ''))];
    if (gifts.length > 1) { err.textContent = 'Check out gifts for different players separately.'; return; }
    const btn = $('basket-checkout'); btn.disabled = true; btn.textContent = 'Opening checkout…';
    try {
      const r = await fetch(S.catalog.store.checkoutApi, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ player: S.me, giftTo: S.basket[0]?.gift || null, items: S.basket.map(b => ({ packageId: b.packageId, type: b.type, qty: qtyOf(b) })) }) });
      const j = await r.json();
      if (!r.ok || !/^https:\/\/checkout\.stripe\.com\//.test(j.url)) throw new Error(j.error || 'Checkout is unavailable right now.');
      presencePage = 'checkout'; ping({ event: 'checkout' }); leaving = true;
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
    serverStatus(l, c.store.serverIp);
  }
  // Status comes from the FinalityStore plugin heartbeats (published in live.json); if that data is old
  // (store PC off), fall back to a public server ping.
  function serverStatus(l, ip) {
    const age = l?.generatedAt ? Date.now() - Date.parse(l.generatedAt) : Infinity;
    if (l?.server && age < 25 * 60e3) setPlayers(l.server.players, l.server.online);
    else pingServer(ip);
  }
  setInterval(async () => {
    if (document.hidden) return;
    try { const l = await (await fetch(`data/live.json?t=${Date.now()}`)).json(); serverStatus(l, S.catalog?.store?.serverIp); } catch { /* keep */ }
  }, 60e3);
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
    $('pb-logout').addEventListener('click', () => { S.me = null; S.myTier = undefined; save('fs_player', null); renderMe(); pingSoon(); if (S.catalog) render(); toast('Logged out'); });
    $('login-form').addEventListener('click', e => { const b = e.target.closest('[data-edition]'); if (b) { segSet($('login-form'), 'data-edition', b.dataset.edition); $('username').focus(); } });
    $('username').addEventListener('input', () => {
      const n = $('username').value.trim(), ed = segValue($('login-form'), 'data-edition');
      $('login-head').src = n && validName(ed, n) ? head(n, ed, 144) : 'assets/img/logo.webp';
    });
    $('login-form').addEventListener('submit', async e => {
      e.preventDefault();
      const edition = segValue($('login-form'), 'data-edition'), name = $('username').value.trim();
      if (!validName(edition, name)) { $('login-err').textContent = nameError(edition); return; }
      S.me = { edition, name }; save('fs_player', S.me); await refreshTier(); renderMe(); pingSoon(); if (S.catalog) render();
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
        fetch(`data/ranks.json?t=${Date.now()}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
        fetch(`data/spend.json?t=${Date.now()}`).then(r => (r.ok ? r.json() : null)).catch(() => null),
      ]).then(([a, b, c, d]) => { S.ranks = c; S.spend = d; return [a, b]; });
      S.catalog = cat; S.live = live;
      endSaleIfOver();
      await refreshTier();
      const st = cat.store;
      if (st.serverIp) { $('server-ip').textContent = st.serverIp; document.querySelector('.footer-brand span').textContent = st.serverIp; }
      if (/^https:\/\//.test(st.discordUrl || '')) ['nav-discord', 'discord-block', 'foot-discord'].forEach(id => { $(id).href = st.discordUrl; });
      if (/^https:\/\//.test(st.homeUrl || '')) $('nav-home').href = st.homeUrl;
      $('test-ribbon').hidden = !st.testMode;
      if (st.notice) { $('notice').textContent = st.notice; $('notice').hidden = false; }
      $('open-basket').hidden = !st.checkoutApi;
      renderSaleBar();
      render(); renderLive(); discordCount(st.discordUrl);
      startPresence();
    } catch {
      $('view').replaceChildren(el('div', { class: 'empty-state', text: 'The store could not load. Refresh the page to try again.' }));
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
