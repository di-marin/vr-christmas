/**
 * @OnlyCurrentDoc
 * ↑ limits permissions to THIS spreadsheet only (not all your Drive spreadsheets).
 *
 * VR Christmas Dinner – backend (Google Apps Script + Google Sheet)
 *
 * Setup (see README.md for the click-by-click version):
 *   1. Create a Google Sheet → Extensions → Apps Script → paste this file.
 *   2. Run `setup` once (authorise when asked). The admin code is printed in the log.
 *   3. Deploy → New deployment → Web app → Execute as: Me, Access: Anyone.
 *   4. Paste the web app URL into config.js on the website.
 *
 * Everything people enter lands in the tabs of the Sheet, so you can read or fix it by hand.
 * The secret santa pairs are NOT in the Sheet (they live in Script Properties),
 * so you won't spoil the surprise for yourself by opening the spreadsheet.
 */

var SHEETS = {
  config: ['key', 'value'],
  dates: ['id', 'date', 'time', 'addedBy', 'created'],
  votes: ['name', 'guests', 'votes', 'updated'],
  food: ['id', 'name', 'category', 'dish', 'tags', 'created'],
  santa: ['name', 'pinHash', 'wishlist', 'joined'],
};

var DEFAULT_CONFIG = [
  ['title', 'VR & AR Christmas Dinner'],
  ['location', 'ZKK (Institute)'],
  ['budget', 'around €15'],
  ['giftNote', 'Homemade, second-hand and silly gifts are very welcome. It’s about the fun, not the price.'],
  ['santaDeadline', ''],
  ['finalDateId', ''],
];

var DEFAULT_DATES = ['2026-12-03', '2026-12-04', '2026-12-10', '2026-12-11', '2026-12-17', '2026-12-18'];
var DEFAULT_TIME = '18:00';

var CATEGORIES = ['starter', 'main', 'side', 'dessert', 'drinks', 'other'];
var TAGS = ['vegetarian', 'vegan', 'gluten-free', 'lactose-free', 'nuts'];

/* ───────────────────────── one-time setup ───────────────────────── */

function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(SHEETS).forEach(function (name) {
    var sh = ss.getSheetByName(name);
    if (!sh) {
      sh = ss.insertSheet(name);
      sh.getRange('A:Z').setNumberFormat('@'); // plain text, so dates/times aren't auto-converted
      sh.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
  });
  // remove the empty default tab ("Sheet1" / "Tabellenblatt1" / …)
  ss.getSheets().forEach(function (sh) {
    if (!SHEETS[sh.getName()] && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });

  if (sheet_('config').getLastRow() < 2) {
    DEFAULT_CONFIG.forEach(function (kv) { append_('config', { key: kv[0], value: kv[1] }); });
  }
  if (sheet_('dates').getLastRow() < 2) {
    DEFAULT_DATES.forEach(function (d) {
      append_('dates', { id: uid_(), date: d, time: DEFAULT_TIME, addedBy: 'organiser', created: now_() });
    });
  }

  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SALT')) props.setProperty('SALT', Utilities.getUuid());
  if (!props.getProperty('ADMIN_CODE')) {
    props.setProperty('ADMIN_CODE', 'elf-' + Math.floor(1000 + Math.random() * 9000));
  }
  Logger.log('Setup done. Your admin code is: ' + props.getProperty('ADMIN_CODE'));
  Logger.log('(Change it under Project Settings → Script Properties → ADMIN_CODE if you like.)');
}

/* ───────────────────────── HTTP entry points ───────────────────────── */

function doGet(e) {
  return respond_(function () {
    var cache = CacheService.getScriptCache();
    var cached = cache.get('state');
    if (cached) return { state: JSON.parse(cached) };
    return { state: freshState_() };
  });
}

// reads the Sheet and keeps a copy for 60 s, so page loads don't re-read all tabs every time
// (hand edits in the Sheet show up on the page within a minute)
function freshState_() {
  var state = getState_();
  try { CacheService.getScriptCache().put('state', JSON.stringify(state), 60); } catch (e) { /* too big → just skip caching */ }
  return state;
}

function doPost(e) {
  return respond_(function () {
    var body = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var fn = ACTIONS[body.action];
    if (!fn) throw new Error('Unknown action');
    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    try {
      var result = fn(body);
      return { result: result === undefined ? null : result, state: freshState_() };
    } finally {
      lock.releaseLock();
    }
  });
}

function respond_(fn) {
  var out;
  try {
    out = fn();
    out.ok = true;
  } catch (err) {
    out = { ok: false, error: String((err && err.message) || err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

/* ───────────────────────── public state ───────────────────────── */

function getState_() {
  var config = {};
  readAll_('config').forEach(function (r) { if (r.key) config[r.key] = r.value; });
  return {
    config: config,
    dates: readAll_('dates').map(function (r) {
      return { id: r.id, date: r.date, time: r.time, addedBy: r.addedBy };
    }),
    votes: readAll_('votes').map(function (r) {
      return { name: r.name, guests: Number(r.guests) || 0, votes: parseJson_(r.votes, {}) };
    }),
    food: readAll_('food').map(function (r) {
      return { id: r.id, name: r.name, category: r.category, dish: r.dish, tags: r.tags ? r.tags.split(',') : [] };
    }),
    santa: {
      participants: readAll_('santa').map(function (r) { return { name: r.name, hasWishlist: !!r.wishlist }; }),
      drawn: isDrawn_(),
    },
  };
}

/* ───────────────────────── actions ───────────────────────── */

var ACTIONS = {
  addDate: function (b) {
    var date = str_(b.date, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Please pick a valid date.');
    var time = /^\d{2}:\d{2}$/.test(b.time) ? b.time : DEFAULT_TIME;
    var exists = readAll_('dates').some(function (d) { return d.date === date && d.time === time; });
    if (exists) throw new Error('That date is already on the list.');
    append_('dates', { id: uid_(), date: date, time: time, addedBy: required_(b.name, 'your name', 60), created: now_() });
  },

  vote: function (b) {
    var name = required_(b.name, 'your name', 60);
    var guests = Math.max(0, Math.min(20, parseInt(b.guests, 10) || 0));
    var valid = { yes: 1, maybe: 1, no: 1 };
    var votes = {};
    var input = b.votes || {};
    Object.keys(input).forEach(function (k) { if (valid[input[k]]) votes[String(k).slice(0, 20)] = input[k]; });
    var row = findByName_('votes', name);
    var obj = { name: name, guests: guests, votes: JSON.stringify(votes), updated: now_() };
    if (row) updateRow_('votes', row._row, obj); else append_('votes', obj);
  },

  addFood: function (b) {
    var id = uid_();
    append_('food', {
      id: id,
      name: required_(b.name, 'your name', 60),
      category: CATEGORIES.indexOf(b.category) >= 0 ? b.category : 'other',
      dish: required_(b.dish, 'a dish', 120),
      tags: (b.tags || []).filter(function (t) { return TAGS.indexOf(t) >= 0; }).join(','),
      created: now_(),
    });
    return { id: id };
  },

  removeFood: function (b) {
    var row = readAll_('food').filter(function (r) { return r.id === b.id; })[0];
    if (row) sheet_('food').deleteRow(row._row);
  },

  santaJoin: function (b) {
    var name = required_(b.name, 'your name', 60);
    var pin = required_(b.pin, 'a PIN', 40);
    if (pin.length < 4) throw new Error('Your PIN needs at least 4 characters.');
    var wishlist = clean_(b.wishlist, 500);
    var row = findByName_('santa', name);
    if (row) {
      if (row.pinHash !== hash_(name, pin)) throw new Error('“' + row.name + '” already joined with a different PIN.');
      updateRow_('santa', row._row, { name: row.name, pinHash: row.pinHash, wishlist: wishlist, joined: row.joined });
      return { updated: true };
    }
    if (isDrawn_()) throw new Error('The draw already happened. Ask the organiser to add you.');
    append_('santa', { name: name, pinHash: hash_(name, pin), wishlist: wishlist, joined: now_() });
    return { joined: true };
  },

  santaLeave: function (b) {
    if (isDrawn_()) throw new Error('The draw already happened. Please talk to the organiser.');
    var row = checkPin_(b.name, b.pin);
    sheet_('santa').deleteRow(row._row);
  },

  santaReveal: function (b) {
    if (!isDrawn_()) throw new Error('The draw hasn’t happened yet. Check back soon!');
    var row = checkPin_(b.name, b.pin);
    var pairs = JSON.parse(PropertiesService.getScriptProperties().getProperty('PAIRS'));
    var receiverName = pairs[key_(row.name)];
    if (!receiverName) throw new Error('You’re not part of this draw. Please talk to the organiser.');
    var receiver = findByName_('santa', receiverName);
    return { receiver: receiverName, wishlist: receiver ? receiver.wishlist : '' };
  },

  /* admin */

  checkAdmin: function (b) { admin_(b); return true; },

  setFinalDate: function (b) {
    admin_(b);
    setConfig_('finalDateId', String(b.dateId || ''));
  },

  draw: function (b) {
    admin_(b);
    if (isDrawn_()) throw new Error('Already drawn. Undo first if you want to redraw.');
    var names = readAll_('santa').map(function (r) { return r.name; });
    if (names.length < 3) throw new Error('Need at least 3 people for a fun draw.');
    // shuffle, then everyone gifts the next person in the circle → nobody draws themselves
    for (var i = names.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var t = names[i]; names[i] = names[j]; names[j] = t;
    }
    var pairs = {};
    names.forEach(function (n, i) { pairs[key_(n)] = names[(i + 1) % names.length]; });
    PropertiesService.getScriptProperties().setProperty('PAIRS', JSON.stringify(pairs));
    return { count: names.length };
  },

  undoDraw: function (b) {
    admin_(b);
    PropertiesService.getScriptProperties().deleteProperty('PAIRS');
  },

  // forgotten PIN: give someone a new one, works before and after the draw (pairs stay untouched)
  resetPin: function (b) {
    admin_(b);
    var row = findByName_('santa', String(b.name || ''));
    if (!row) throw new Error('No secret santa participant called “' + clean_(b.name, 60) + '”.');
    var pin = required_(b.pin, 'a new PIN', 40);
    if (pin.length < 4) throw new Error('The PIN needs at least 4 characters.');
    updateRow_('santa', row._row, { name: row.name, pinHash: hash_(row.name, pin), wishlist: row.wishlist, joined: row.joined });
    return { name: row.name };
  },
};

/* ───────────────────────── helpers ───────────────────────── */

function sheet_(name) {
  var sh = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(name);
  if (!sh) throw new Error('Missing sheet "' + name + '". Did you run setup()?');
  return sh;
}

function readAll_(name) {
  var values = sheet_(name).getDataRange().getDisplayValues();
  var head = values[0];
  var rows = [];
  for (var i = 1; i < values.length; i++) {
    var o = { _row: i + 1 };
    head.forEach(function (h, j) { o[h] = String(values[i][j]).trim(); });
    rows.push(o);
  }
  return rows;
}

function rowValues_(name, obj) {
  return SHEETS[name].map(function (h) {
    var v = obj[h] === undefined || obj[h] === null ? '' : obj[h];
    // stop text (names, wishlists, base64 PIN hashes starting with "+") from being read as a formula
    return typeof v === 'string' && /^[=+\-@]/.test(v) ? ' ' + v : v;
  });
}

function append_(name, obj) {
  sheet_(name).appendRow(rowValues_(name, obj));
}

function updateRow_(name, row, obj) {
  sheet_(name).getRange(row, 1, 1, SHEETS[name].length).setValues([rowValues_(name, obj)]);
}

function findByName_(sheetName, name) {
  return readAll_(sheetName).filter(function (r) { return key_(r.name) === key_(name); })[0];
}

function setConfig_(k, v) {
  var row = readAll_('config').filter(function (r) { return r.key === k; })[0];
  if (row) updateRow_('config', row._row, { key: k, value: v }); else append_('config', { key: k, value: v });
}

function isDrawn_() {
  return !!PropertiesService.getScriptProperties().getProperty('PAIRS');
}

function admin_(b) {
  var code = PropertiesService.getScriptProperties().getProperty('ADMIN_CODE');
  if (!code || String(b.adminCode || '') !== code) throw new Error('Wrong admin code.');
}

function checkPin_(name, pin) {
  var row = findByName_('santa', String(name || ''));
  if (!row || row.pinHash !== hash_(row.name, clean_(pin, 40))) throw new Error('Name and PIN don’t match.');
  return row;
}

function hash_(name, pin) {
  var salt = PropertiesService.getScriptProperties().getProperty('SALT') || '';
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, salt + '|' + key_(name) + '|' + pin);
  return Utilities.base64Encode(bytes);
}

function key_(name) { return String(name || '').trim().toLowerCase(); }

// trims and limits length (formula protection happens in rowValues_)
function clean_(s, max) {
  return String(s === undefined || s === null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, max);
}

function str_(s, max) { return String(s || '').trim().slice(0, max); }

function required_(s, what, max) {
  var v = clean_(s, max);
  if (!v) throw new Error('Please enter ' + what + '.');
  return v;
}

function parseJson_(s, fallback) {
  try { return JSON.parse(s); } catch (e) { return fallback; }
}

function uid_() { return Utilities.getUuid().slice(0, 8); }
function now_() { return new Date().toISOString(); }
