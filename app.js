(function () {
  'use strict';

  const API = ((window.XMAS_CONFIG || {}).apiUrl || '').trim();
  const DEMO = !API;

  const CATEGORIES = [
    { id: 'starter', label: 'Starters', emoji: '🥗' },
    { id: 'main', label: 'Mains', emoji: '🍲' },
    { id: 'side', label: 'Sides & bread', emoji: '🥖' },
    { id: 'dessert', label: 'Desserts & cookies', emoji: '🍪' },
    { id: 'drinks', label: 'Drinks', emoji: '🍷' },
    { id: 'other', label: 'Other', emoji: '✨' },
  ];
  const TAGS = [
    { id: 'vegetarian', label: 'vegetarian', short: 'veg' },
    { id: 'vegan', label: 'vegan', short: 'vegan' },
    { id: 'gluten-free', label: 'gluten-free', short: 'GF' },
    { id: 'lactose-free', label: 'lactose-free', short: 'LF' },
    { id: 'nuts', label: 'contains nuts', short: 'nuts', warn: true },
  ];

  /* ───────── tiny helpers ───────── */
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const key = (s) => String(s || '').trim().toLowerCase();
  const store = {
    get(k, d) { try { const v = localStorage.getItem('xmas.' + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('xmas.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };
  const session = {
    get(k) { try { return sessionStorage.getItem('xmas.' + k) || ''; } catch (e) { return ''; } },
    set(k, v) { try { sessionStorage.setItem('xmas.' + k, v); } catch (e) { /* ignore */ } },
  };

  function parseDate(iso) {
    const [y, m, d] = String(iso).split('-').map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }
  const fmtDow = (iso) => parseDate(iso).toLocaleDateString('en-GB', { weekday: 'short' });
  const fmtMonth = (iso) => parseDate(iso).toLocaleDateString('en-GB', { month: 'short' });
  const fmtLong = (iso) => parseDate(iso).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' });

  let toastTimer;
  function toast(msg, isErr) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('err', !!isErr);
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), isErr ? 4500 : 2600);
  }

  /* ───────── backend (real or demo) ───────── */
  async function apiState() {
    if (DEMO) return demo.state();
    const res = await fetch(API + '?action=state', { cache: 'no-store' });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Could not load');
    return data.state;
  }
  async function api(action, payload) {
    if (DEMO) {
      const result = demo.call(action, payload || {});
      return { result, state: demo.state() };
    }
    // text/plain body = no CORS preflight, which Apps Script can't answer
    const res = await fetch(API, { method: 'POST', body: JSON.stringify(Object.assign({ action }, payload)) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || 'Something went wrong');
    return data;
  }

  /* ───────── app state ───────── */
  let S = { config: {}, dates: [], votes: [], food: [], santa: { participants: [], drawn: false } };
  let me = store.get('name', '');
  let draft = { votes: {}, guests: 0, dirty: false, forName: null };
  let myFood = store.get('myFood', []);
  let adminCode = session.get('admin');

  function setState(s) {
    S = s;
    syncDraft();
    render();
  }

  function syncDraft() {
    if (draft.dirty) return; // unsaved taps win (also while someone is still typing their name)
    const mine = S.votes.find((v) => key(v.name) === key(me));
    draft = {
      votes: mine ? Object.assign({}, mine.votes) : {},
      guests: mine ? mine.guests : 0,
      dirty: false,
      forName: key(me),
    };
  }

  async function run(btn, fn) {
    if (btn) btn.disabled = true;
    try {
      return await fn();
    } catch (e) {
      toast(e.message || 'Something went wrong', true);
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  function needName() {
    if (key(me)) return false;
    const box = document.querySelector('.me');
    box.classList.add('nudge');
    box.scrollIntoView({ block: 'center' });
    $('myName').focus();
    toast('First, tell us your name 🙂', true);
    setTimeout(() => box.classList.remove('nudge'), 2000);
    return true;
  }

  /* ───────── derived data ───────── */
  function sortedDates() {
    return S.dates.slice().sort((a, b) => (a.date + a.time).localeCompare(b.date + b.time));
  }
  function statsFor(dateId) {
    const yes = [], maybe = [];
    S.votes.forEach((v) => {
      if (v.votes[dateId] === 'yes') yes.push(v);
      else if (v.votes[dateId] === 'maybe') maybe.push(v);
    });
    const heads = yes.reduce((n, v) => n + 1 + (v.guests || 0), 0);
    return { yes, maybe, heads };
  }
  function bestDate() {
    let best = null;
    sortedDates().forEach((d) => {
      const s = statsFor(d.id);
      const score = s.yes.length * 10 + s.maybe.length * 3 + s.heads * 0.01;
      if (s.yes.length && (!best || score > best.score)) best = { d, s, score };
    });
    return best;
  }
  const finalDate = () => S.dates.find((d) => d.id === S.config.finalDateId);

  /* ───────── rendering ───────── */
  function render() {
    renderHero();
    renderDates();
    renderFood();
    renderSanta();
    renderSteps();
    renderAdmin();
  }

  function renderHero() {
    if (S.config.title) {
      $('title').textContent = S.config.title.replace(/^VR & AR /, '') || 'Christmas Dinner';
    }
    const f = finalDate();
    const chips = [];
    if (f) {
      const days = Math.ceil((parseDate(f.date) - new Date(new Date().toDateString())) / 864e5);
      chips.push(`<span class="chip gold">📅 ${esc(fmtLong(f.date))} · ${esc(f.time)}</span>`);
      if (days > 0) chips.push(`<span class="chip">⏳ ${days} day${days === 1 ? '' : 's'} to go</span>`);
      if (days === 0) chips.push('<span class="chip">🎉 It’s tonight!</span>');
    } else {
      chips.push('<span class="chip">📅 Date: vote below</span>');
      chips.push('<span class="chip">🕕 from 18:00</span>');
    }
    chips.push(`<span class="chip">📍 ${esc(S.config.location || 'To be announced')}</span>`);
    if (S.config.budget) chips.push(`<span class="chip">🎁 ${esc(S.config.budget)}</span>`);
    $('heroChips').innerHTML = chips.join('');
  }

  function renderDates() {
    const f = finalDate();
    const best = bestDate();
    $('finalBanner').hidden = !f;
    if (f) {
      const s = statsFor(f.id);
      $('finalBanner').innerHTML = `🎄 It’s decided: <b>${esc(fmtLong(f.date))}</b> at ${esc(f.time)}. ${s.heads} people so far.`;
    }
    $('bestLine').textContent = f ? '' : best
      ? `⭐ Most popular so far: ${fmtLong(best.d.date)} (${best.s.yes.length} yes, ${best.s.heads} people incl. guests)`
      : S.votes.length ? '' : 'No votes yet. Be the first! ✨';

    $('dateGrid').innerHTML = sortedDates().map((d) => {
      const s = statsFor(d.id);
      const isFinal = f && f.id === d.id;
      const isBest = !f && best && best.d.id === d.id;
      const mine = draft.votes[d.id] || '';
      const who = s.yes.map((v) => `<span>${esc(v.name)}${v.guests ? ' +' + v.guests : ''}</span>`)
        .concat(s.maybe.map((v) => `<span class="maybe" title="maybe">${esc(v.name)}?</span>`)).join('');
      const btn = (v, label) => `<button type="button" data-date="${esc(d.id)}" data-v="${v}" aria-pressed="${mine === v}" aria-label="${v}" title="${v}">${label}</button>`;
      return `<div class="date-card${isFinal ? ' final' : ''}${isBest ? ' best-pick' : ''}">
        ${isFinal ? '<span class="badge">it’s this one!</span>' : isBest ? '<span class="badge">favourite</span>' : ''}
        <div class="date-when"><span class="day">${parseDate(d.date).getDate()}</span>
          <span class="dm"><span>${esc(fmtDow(d.date))}</span> <span>${esc(fmtMonth(d.date))} · ${esc(d.time)}</span></span></div>
        <div class="tally"><span class="y" title="yes">✓ ${s.yes.length}</span><span title="maybe">? ${s.maybe.length}</span><span title="people incl. guests">👥 ${s.heads}</span></div>
        <div class="who">${who}</div>
        <div class="seg" role="group" aria-label="Your answer for ${esc(fmtLong(d.date))}">${btn('yes', '✓')}${btn('maybe', '?')}${btn('no', '✗')}</div>
      </div>`;
    }).join('');

    $('guestCount').textContent = draft.guests;
  }

  /* ───────── date auto-save ───────── */
  let saveTimer;
  let saveChain = Promise.resolve();

  function setSaveState(s) {
    const el = $('saveState');
    el.dataset.s = s || '';
    el.textContent = { saving: 'Saving…', saved: 'Saved ✓', error: 'Not saved. Tap a date to retry' }[s] || 'Your answers save automatically';
  }

  function queueSave() {
    draft.dirty = true;
    setSaveState('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 800);
  }

  // saves the current draft (if anything changed); resolves when done
  function flushSave() {
    clearTimeout(saveTimer);
    saveChain = saveChain.then(async () => {
      if (!draft.dirty || !key(me)) return;
      const payload = { name: me, guests: draft.guests, votes: Object.assign({}, draft.votes) };
      draft.dirty = false;
      try {
        const r = await api('vote', payload);
        setState(r.state);
        if (!draft.dirty) setSaveState('saved');
      } catch (e) {
        draft.dirty = true;
        setSaveState('error');
        toast('Couldn’t save your dates: ' + e.message, true);
      }
    });
    return saveChain;
  }

  function renderFood() {
    const sel = $('category');
    if (!sel.options.length) {
      sel.innerHTML = CATEGORIES.map((c) => `<option value="${c.id}">${c.emoji} ${c.label}</option>`).join('');
      $('tagPick').innerHTML = TAGS.map((t) => `<label><input type="checkbox" value="${t.id}"><span>${t.label}</span></label>`).join('');
    }
    const mineSet = new Set(myFood);
    $('foodGrid').innerHTML = CATEGORIES.map((c) => {
      const items = S.food.filter((f) => (CATEGORIES.some((x) => x.id === f.category) ? f.category : 'other') === c.id);
      if (!items.length && c.id === 'other') return '';
      const list = items.map((f) => {
        const tags = (f.tags || []).map((id) => TAGS.find((t) => t.id === id)).filter(Boolean)
          .map((t) => `<i class="${t.warn ? 'warn' : ''}" title="${t.label}">${t.short}</i>`).join('');
        const canDelete = mineSet.has(f.id) || key(f.name) === key(me);
        return `<li><div class="txt"><span class="dish">${esc(f.dish)}</span>${tags ? `<span class="tags">${tags}</span>` : ''}
          <div class="by">by ${esc(f.name)}</div></div>
          ${canDelete ? `<button class="x" type="button" data-remove="${esc(f.id)}" aria-label="Remove ${esc(f.dish)}">×</button>` : ''}</li>`;
      }).join('');
      return `<div class="cat${items.length ? '' : ' empty'}">
        <h3>${c.emoji} ${c.label} <span class="count">${items.length}</span>${items.length ? '' : '<span class="none">any takers?</span>'}</h3>
        ${items.length ? `<ul>${list}</ul>` : ''}
      </div>`;
    }).join('');
  }

  function renderSanta() {
    const c = S.config;
    $('santaInfo').innerHTML =
      `<span>💶 Budget: <b>${esc(c.budget || 'around €15')}</b></span>` +
      (c.santaDeadline ? `<span>🗓 Join by: <b>${esc(c.santaDeadline)}</b></span>` : '') +
      `<span>🎅 Gifts exchanged at the dinner</span>` +
      (c.giftNote ? `<span class="note">${esc(c.giftNote)}</span>` : '');

    const drawn = S.santa.drawn;
    $('santaJoin').hidden = drawn;
    $('santaReveal').hidden = !drawn;

    const joined = S.santa.participants.some((p) => key(p.name) === key(me));
    $('joinBtn').textContent = joined ? 'Update my wishlist' : 'Count me in 🎁';
    $('leaveBtn').hidden = !joined;

    const ps = S.santa.participants;
    $('elfCount').textContent = ps.length;
    $('elves').innerHTML = ps.length
      ? ps.map((p) => `<span class="elf${key(p.name) === key(me) ? ' me-elf' : ''}">${esc(p.name)}${p.hasWishlist ? ' 📝' : ''}</span>`).join('')
      : '<span class="empty-note">No elves yet…</span>';
  }

  /* ───────── steps / tabs ───────── */
  const STEPS = ['dates', 'food', 'santa'];
  const STEP_NAMES = { dates: 'Dates', food: 'Food', santa: 'Secret Santa' };
  const isAdminPage = () => /[?&#]admin\b/.test(location.search + location.hash);
  let currentTab = 'dates';

  function progress() {
    const k = key(me);
    return {
      dates: !!k && S.votes.some((v) => key(v.name) === k && Object.keys(v.votes || {}).length > 0),
      food: !!k && S.food.some((f) => key(f.name) === k),
      santa: !!k && S.santa.participants.some((p) => key(p.name) === k),
    };
  }

  function renderSteps() {
    const p = progress();
    const done = STEPS.filter((s) => p[s]).length;
    STEPS.forEach((s) => {
      const tab = $('tab-' + s);
      const locked = isLocked(s);
      tab.classList.toggle('done', p[s]);
      tab.classList.toggle('locked', locked);
      tab.setAttribute('aria-disabled', String(locked));
      tab.querySelector('.dot').textContent = p[s] ? '✓' : locked ? '🔒' : String(STEPS.indexOf(s) + 1);
      tab.querySelector('.st').textContent = p[s] ? 'done' : locked ? 'dates first' : 'to do';
    });
    if (isLocked(currentTab)) showTab('dates');
    const line = $('todoLine');
    line.classList.toggle('done', done === 3);
    if (!key(me)) {
      line.innerHTML = 'Type your name, then please do <b>all 3 steps</b> below: dates, food and secret santa.';
    } else if (done === 3) {
      line.innerHTML = `<b>🎉 All 3 steps done</b>. Thank you, ${esc(me)}! See you there.`;
    } else {
      const todo = STEPS.filter((s) => !p[s]).map((s) => STEP_NAMES[s]);
      line.innerHTML = `Please do <b>all 3 steps</b>. You’ve done ${done} of 3, still to do: <b>${esc(todo.join(', '))}</b>.`;
    }
    $('tab-admin').hidden = !isAdminPage();
  }

  // Food and Secret Santa open only after you've answered at least one date
  const isLocked = (id) => (id === 'food' || id === 'santa') && !progress().dates;

  async function goTo(id, focus, btn) {
    if (id === currentTab) return;
    if (id === 'food' || id === 'santa') {
      if (needName()) return;
      if (btn) btn.disabled = true;
      try { await flushSave(); } finally { if (btn) btn.disabled = false; }
      if (draft.dirty) return; // save failed, error already shown
      if (isLocked(id)) {
        showTab('dates');
        toast('First tap ✓, ? or ✗ for at least one date 🙂', true);
        return;
      }
    }
    showTab(id, focus);
  }

  function showTab(id, focus) {
    if (id === 'admin' && !isAdminPage()) id = 'dates';
    if (!STEPS.includes(id) && id !== 'admin') id = 'dates';
    if (isLocked(id)) id = 'dates';
    currentTab = id;
    STEPS.concat('admin').forEach((s) => {
      $(s).hidden = s !== id;
      $('tab-' + s).setAttribute('aria-selected', String(s === id));
      $('tab-' + s).tabIndex = s === id ? 0 : -1;
    });
    try { history.replaceState(null, '', location.pathname + location.search + '#' + id); } catch (e) { /* file:// etc. */ }
    if (focus) $('tab-' + id).focus();
    const tabs = document.querySelector('.steps');
    if (tabs.getBoundingClientRect().top < 0) tabs.scrollIntoView({ block: 'start' });
  }

  function renderAdmin() {
    if (!isAdminPage()) return;
    $('adminLogin').hidden = !!adminCode;
    $('adminTools').hidden = !adminCode;
    const sel = $('finalSelect');
    const cur = sel.value || S.config.finalDateId;
    sel.innerHTML = sortedDates().map((d) => {
      const s = statsFor(d.id);
      return `<option value="${esc(d.id)}">${esc(fmtLong(d.date))} ${esc(d.time)} (${s.yes.length} yes / ${s.heads} people)</option>`;
    }).join('');
    if (cur) sel.value = cur;
    $('runDraw').disabled = S.santa.drawn;
    $('runDraw').textContent = S.santa.drawn ? 'Draw done ✓' : `Run the secret santa draw (${S.santa.participants.length} people)`;
    $('undoDraw').hidden = !S.santa.drawn;
  }

  /* ───────── events ───────── */
  function bind() {
    // tabs: click, ←/→ keys, and "Next" buttons
    document.querySelectorAll('[data-tab]').forEach((t) => t.addEventListener('click', () => goTo(t.dataset.tab, false, t)));
    document.querySelector('.steps').addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const tabs = Array.from(document.querySelectorAll('.step:not([hidden])'));
      const i = tabs.findIndex((t) => t.dataset.tab === currentTab);
      const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
      goTo(next.dataset.tab, true);
    });
    document.querySelectorAll('[data-goto]').forEach((b) => b.addEventListener('click', () => goTo(b.dataset.goto, false, b)));
    window.addEventListener('hashchange', () => showTab(location.hash.slice(1)));

    const nameInput = $('myName');
    nameInput.value = me;
    nameInput.addEventListener('input', () => {
      me = nameInput.value.trim();
      store.set('name', me);
      if (!draft.dirty) setSaveState('');
      syncDraft();
      render();
    });

    // dates: vote buttons
    $('dateGrid').addEventListener('click', (e) => {
      const b = e.target.closest('button[data-date]');
      if (!b) return;
      if (needName()) return;
      const id = b.dataset.date;
      draft.votes[id] = draft.votes[id] === b.dataset.v ? undefined : b.dataset.v;
      if (!draft.votes[id]) delete draft.votes[id];
      queueSave();
      renderDates();
    });
    document.querySelectorAll('[data-guests]').forEach((b) => b.addEventListener('click', () => {
      if (needName()) return;
      draft.guests = Math.max(0, Math.min(20, draft.guests + Number(b.dataset.guests)));
      queueSave();
      renderDates();
    }));
    window.addEventListener('beforeunload', (e) => {
      if (draft.dirty) { flushSave(); e.preventDefault(); e.returnValue = ''; }
    });
    $('addDateForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (needName()) return;
      run(e.submitter, async () => {
        const r = await api('addDate', { name: me, date: $('newDate').value, time: $('newTime').value });
        $('newDate').value = '';
        setState(r.state);
        toast('Date added. Don’t forget to vote on it!');
      });
    });

    // food
    $('foodForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (needName()) return;
      const tags = Array.from(document.querySelectorAll('#tagPick input:checked')).map((i) => i.value);
      run(e.submitter, async () => {
        const r = await api('addFood', { name: me, dish: $('dish').value, category: $('category').value, tags });
        if (r.result && r.result.id) { myFood.push(r.result.id); store.set('myFood', myFood); }
        $('dish').value = '';
        document.querySelectorAll('#tagPick input').forEach((i) => { i.checked = false; });
        setState(r.state);
        toast('Yum! Added to the menu 🍽');
      });
    });
    $('foodGrid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-remove]');
      if (!b || !confirm('Remove this dish?')) return;
      run(b, async () => {
        const r = await api('removeFood', { id: b.dataset.remove });
        setState(r.state);
      });
    });

    // santa
    $('joinForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (needName()) return;
      run(e.submitter, async () => {
        const r = await api('santaJoin', { name: me, pin: $('pin').value, wishlist: $('wishlist').value });
        $('pin').value = '';
        setState(r.state);
        toast(r.result && r.result.updated ? 'Wishlist updated 📝' : 'You’re in! Ho ho ho 🎅');
      });
    });
    $('leaveBtn').addEventListener('click', (e) => {
      const pin = $('pin').value;
      if (!pin) { toast('Enter your PIN to leave', true); $('pin').focus(); return; }
      if (!confirm('Leave secret santa?')) return;
      run(e.currentTarget, async () => {
        const r = await api('santaLeave', { name: me, pin });
        $('pin').value = '';
        setState(r.state);
        toast('You left secret santa.');
      });
    });
    $('revealForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (needName()) return;
      run(e.submitter, async () => {
        const r = await api('santaReveal', { name: me, pin: $('revealPin').value });
        $('revealPin').value = '';
        const g = $('giftCard');
        g.hidden = false;
        g.innerHTML = `<div class="to">You’re secret santa for… 🤫</div>
          <div class="name">${esc(r.result.receiver)}</div>
          <div class="wish">${r.result.wishlist ? esc(r.result.wishlist) : 'No wishlist yet. Surprise them! ✨'}</div>
          <p class="fine">Shh, keep it a secret!</p>`;
      });
    });
    $('wishUpdateForm').addEventListener('submit', (e) => {
      e.preventDefault();
      if (needName()) return;
      run(e.submitter, async () => {
        const r = await api('santaJoin', { name: me, pin: $('pin2').value, wishlist: $('wishlist2').value });
        $('pin2').value = '';
        setState(r.state);
        toast('Wishlist updated 📝');
      });
    });

    // admin
    $('adminLogin').addEventListener('submit', (e) => {
      e.preventDefault();
      const code = $('adminCode').value;
      run(e.submitter, async () => {
        await api('checkAdmin', { adminCode: code });
        adminCode = code;
        session.set('admin', code);
        renderAdmin();
        toast('Welcome, head elf 🧝');
      });
    });
    const adminAction = (action, extra, msg, ask) => (e) => {
      if (ask && !confirm(ask)) return;
      run(e.currentTarget, async () => {
        const r = await api(action, Object.assign({ adminCode }, extra && extra()));
        setState(r.state);
        toast(msg);
      });
    };
    $('setFinal').addEventListener('click', adminAction('setFinalDate', () => ({ dateId: $('finalSelect').value }), 'Final date set 🎉'));
    $('clearFinal').addEventListener('click', adminAction('setFinalDate', () => ({ dateId: '' }), 'Final date cleared'));
    $('runDraw').addEventListener('click', adminAction('draw', null, 'Names drawn! 🎁', 'Run the draw now? People can’t join afterwards.'));
    $('undoDraw').addEventListener('click', adminAction('undoDraw', null, 'Draw undone', 'Undo the draw? Everyone will get a new person when you draw again.'));
    $('resetPinForm').addEventListener('submit', (e) => {
      e.preventDefault();
      run(e.submitter, async () => {
        const r = await api('resetPin', { adminCode, name: $('resetName').value, pin: $('resetNewPin').value });
        $('resetName').value = '';
        $('resetNewPin').value = '';
        setState(r.state);
        toast(`New PIN set for ${r.result.name} 🔑`);
      });
    });

    // keep things fresh while the tab is open
    setInterval(() => {
      if (document.hidden || draft.dirty) return;
      apiState().then(setState).catch(() => {});
    }, 45000);
  }

  /* ───────── snow ───────── */
  function snow() {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const box = $('snow');
    for (let i = 0; i < 22; i++) {
      const s = document.createElement('span');
      const size = 3 + Math.random() * 4;
      s.style.cssText = `left:${Math.random() * 100}%;--s:${size}px;--o:${(0.25 + Math.random() * 0.45).toFixed(2)};` +
        `--d:${(9 + Math.random() * 10).toFixed(1)}s;--delay:-${(Math.random() * 18).toFixed(1)}s;--drift:${Math.round(Math.random() * 60 - 30)}px`;
      box.appendChild(s);
    }
  }

  /* ───────── demo backend (browser-only) ───────── */
  const demo = {
    load() {
      let db = store.get('demo', null);
      if (!db) {
        const ids = ['d1', 'd2', 'd3', 'd4', 'd5', 'd6'];
        db = {
          config: { title: 'VR & AR Christmas Dinner', location: 'ZKK (Institute)', budget: 'around €15',
            giftNote: 'Homemade, second-hand and silly gifts are very welcome. It’s about the fun, not the price.', finalDateId: '' },
          dates: ['2026-12-03', '2026-12-04', '2026-12-10', '2026-12-11', '2026-12-17', '2026-12-18']
            .map((d, i) => ({ id: ids[i], date: d, time: '18:00', addedBy: 'organiser' })),
          votes: [
            { name: 'Alex', guests: 1, votes: { d2: 'yes', d4: 'yes', d6: 'maybe' } },
            { name: 'Sam', guests: 0, votes: { d1: 'yes', d4: 'yes', d5: 'no' } },
            { name: 'Mira', guests: 2, votes: { d4: 'maybe', d6: 'yes', d2: 'yes' } },
          ],
          food: [
            { id: 'f1', name: 'Alex', category: 'dessert', dish: 'Vanillekipferl', tags: ['vegetarian', 'nuts'] },
            { id: 'f2', name: 'Mira', category: 'drinks', dish: 'Homemade punch (alcohol-free)', tags: ['vegan'] },
          ],
          santa: [{ name: 'Alex', pin: '1234', wishlist: 'Books, tea, anything with cats' }, { name: 'Sam', pin: '1234', wishlist: '' }],
          pairs: null,
        };
        store.set('demo', db);
      }
      return db;
    },
    state() {
      const db = this.load();
      return JSON.parse(JSON.stringify({
        config: db.config, dates: db.dates, votes: db.votes, food: db.food,
        santa: { participants: db.santa.map((p) => ({ name: p.name, hasWishlist: !!p.wishlist })), drawn: !!db.pairs },
      }));
    },
    call(action, b) {
      const db = this.load();
      const find = (list, n) => list.find((x) => key(x.name) === key(n));
      const need = (v, what) => { v = String(v || '').trim(); if (!v) throw new Error('Please enter ' + what + '.'); return v; };
      const checkPin = () => { const p = find(db.santa, b.name); if (!p || p.pin !== b.pin) throw new Error('Name and PIN don’t match.'); return p; };
      const admin = () => { if (b.adminCode !== 'elf') throw new Error('Wrong admin code (it’s “elf” in demo mode).'); };
      let result = null;
      switch (action) {
        case 'addDate':
          if (!/^\d{4}-\d{2}-\d{2}$/.test(b.date || '')) throw new Error('Please pick a valid date.');
          if (db.dates.some((d) => d.date === b.date && d.time === (b.time || '18:00'))) throw new Error('That date is already on the list.');
          db.dates.push({ id: 'd' + Date.now(), date: b.date, time: b.time || '18:00', addedBy: b.name });
          break;
        case 'vote': {
          const row = { name: need(b.name, 'your name'), guests: b.guests || 0, votes: b.votes || {} };
          const i = db.votes.findIndex((v) => key(v.name) === key(b.name));
          if (i >= 0) db.votes[i] = row; else db.votes.push(row);
          break;
        }
        case 'addFood': {
          const id = 'f' + Date.now();
          db.food.push({ id, name: need(b.name, 'your name'), category: b.category, dish: need(b.dish, 'a dish'), tags: b.tags || [] });
          result = { id };
          break;
        }
        case 'removeFood': db.food = db.food.filter((f) => f.id !== b.id); break;
        case 'santaJoin': {
          if (String(b.pin || '').length < 4) throw new Error('Your PIN needs at least 4 characters.');
          const p = find(db.santa, b.name);
          if (p) { if (p.pin !== b.pin) throw new Error('This name already joined with a different PIN.'); p.wishlist = b.wishlist || ''; result = { updated: true }; }
          else if (db.pairs) throw new Error('The draw already happened. Ask the organiser to add you.');
          else { db.santa.push({ name: need(b.name, 'your name'), pin: b.pin, wishlist: b.wishlist || '' }); result = { joined: true }; }
          break;
        }
        case 'santaLeave': checkPin(); db.santa = db.santa.filter((p) => key(p.name) !== key(b.name)); break;
        case 'santaReveal': {
          if (!db.pairs) throw new Error('The draw hasn’t happened yet.');
          const p = checkPin();
          const to = db.pairs[key(p.name)];
          result = { receiver: to, wishlist: (find(db.santa, to) || {}).wishlist || '' };
          break;
        }
        case 'checkAdmin': admin(); break;
        case 'setFinalDate': admin(); db.config.finalDateId = b.dateId || ''; break;
        case 'draw': {
          admin();
          if (db.santa.length < 3) throw new Error('Need at least 3 people for a fun draw.');
          const names = db.santa.map((p) => p.name).sort(() => Math.random() - 0.5);
          db.pairs = {};
          names.forEach((n, i) => { db.pairs[key(n)] = names[(i + 1) % names.length]; });
          break;
        }
        case 'undoDraw': admin(); db.pairs = null; break;
        case 'resetPin': {
          admin();
          const p = find(db.santa, b.name);
          if (!p) throw new Error('No secret santa participant called “' + (b.name || '') + '”.');
          if (String(b.pin || '').trim().length < 4) throw new Error('The PIN needs at least 4 characters.');
          p.pin = String(b.pin).trim();
          result = { name: p.name };
          break;
        }
        default: throw new Error('Unknown action');
      }
      store.set('demo', db);
      return result;
    },
  };

  /* ───────── go ───────── */
  $('demoBanner').hidden = !DEMO;
  if (DEMO) $('demoBanner').insertAdjacentHTML('beforeend', ' Admin code in demo: <code>elf</code> (open the page with <code>?admin</code>).');
  snow();
  bind();
  const wantedTab = (location.hash || '#dates').slice(1);
  render();
  setSaveState('');
  showTab(wantedTab);
  apiState().then((s) => { setState(s); showTab(wantedTab); })
    .catch((e) => toast('Could not load data: ' + e.message, true));
})();
