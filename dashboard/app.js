/* Token Radar v3 dashboard: board, calibration table, detail view, sandbox slider.
   Static page, no network. Reads window.TOKEN_RADAR from data.js beside it. */
(function () {
  'use strict';
  var D = window.TOKEN_RADAR || { rows: [], calibration: [], counts: {}, as_of: '', floor_usd: 0 };
  var rows = D.rows || [];
  var growth = 1;
  var sortKey = 'rank';
  var sortDir = 1;
  var selected = null;

  function $(id) { return document.getElementById(id); }
  function money(n) {
    n = Math.round(n);
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + n;
  }
  function moneyFull(n) { return '$' + Math.round(n).toLocaleString('en-US'); }
  function pct(n) { return (n > 0 ? '+' : '') + n.toFixed(1) + '%'; }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* Header meta */
  $('meta').textContent = 'Snapshot as of ' + D.as_of + '  ·  ' + rows.length + ' protocols on the board  ·  ' +
    (D.counts.watchlist || 0) + ' watchlist protocols covered  ·  ' +
    (D.counts.priced_peers || 0) + ' priced protocols calibrate the multiples  ·  floor ' + moneyFull(D.floor_usd || 0);
  $('asof').textContent = D.as_of;

  /* Calibration table */
  var calBody = document.querySelector('#calTable tbody');
  (D.calibration || []).forEach(function (c) {
    var tr = document.createElement('tr');
    tr.innerHTML = '<td>' + esc(c.category) + '</td><td class="r">' + c.n + '</td>' +
      '<td class="r">' + c.median.toFixed(3) + '</td><td class="r">' + c.p25.toFixed(3) + '</td>' +
      '<td class="r">' + c.p75.toFixed(3) + '</td>' +
      '<td>' + (c.fallback ? '<span class="fb">global median (fewer than 3 peers)</span>' : 'category median') + '</td>';
    calBody.appendChild(tr);
  });

  /* Category filter options */
  var cats = [];
  rows.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  var catSel = $('cat');
  cats.forEach(function (c) {
    var o = document.createElement('option');
    o.value = c; o.textContent = c;
    catSel.appendChild(o);
  });

  /* Range column visibility */
  function syncRangeCol() {
    var show = $('withRange').checked;
    document.querySelectorAll('.rangeCol').forEach(function (el) {
      el.style.display = show ? '' : 'none';
    });
  }

  function filtered() {
    var q = $('q').value.trim().toLowerCase();
    var cat = catSel.value;
    var watchOnly = $('watchOnly').checked;
    var out = rows.filter(function (r) {
      if (watchOnly && !r.watchlist) return false;
      if (cat && r.category !== cat) return false;
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    out.sort(function (a, b) {
      var av = a[sortKey], bv = b[sortKey];
      if (typeof av === 'string') return sortDir * (av < bv ? -1 : av > bv ? 1 : 0);
      return sortDir * ((av || 0) - (bv || 0));
    });
    return out;
  }

  function renderBoard() {
    var list = filtered();
    var tb = document.querySelector('#board tbody');
    tb.innerHTML = '';
    var showRange = $('withRange').checked;
    list.forEach(function (r) {
      var tr = document.createElement('tr');
      if (selected === r.slug) tr.className = 'sel';
      tr.innerHTML = '<td class="r">' + r.rank + '</td>' +
        '<td><strong>' + esc(r.name) + '</strong><br><span class="fb">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category || '—') + '</td>' +
        '<td class="r">' + money(r.tvl_usd) + '</td>' +
        '<td class="r">' + (r.change_7d === null ? '—' : pct(r.change_7d)) + '</td>' +
        '<td class="r">' + r.multiple.toFixed(3) + (r.fallback ? '*' : '') + '</td>' +
        '<td class="r"><strong>' + money(r.implied_value_usd * growth) + '</strong></td>' +
        '<td class="r rangeCol" style="display:' + (showRange ? '' : 'none') + '">' +
          money(r.low_usd * growth) + ' – ' + money(r.high_usd * growth) + '</td>' +
        '<td>' + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') + '</td>';
      tr.addEventListener('click', function () { showDetail(r.slug); });
      tb.appendChild(tr);
    });
    $('count').textContent = list.length + ' of ' + rows.length + ' protocols shown' +
      (growth !== 1 ? '  ·  sandbox growth ' + pct((growth - 1) * 100) + ' applied to values' : '') +
      '  ·  * = global-median fallback (fewer than 3 priced peers in the category)';
    syncRangeCol();
  }

  function showDetail(slug) {
    var r = null;
    rows.forEach(function (x) { if (x.slug === slug) r = x; });
    if (!r) return;
    selected = slug;
    var sec = $('detail');
    sec.hidden = false;
    $('detailTitle').textContent = '#' + r.rank + ' — ' + r.name + (r.watchlist ? '  ·  WATCHLIST' : '');
    var steps = r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('');
    var calc = r.breakdown.map(function (line, i) {
      return '<li class="' + (i === r.breakdown.length - 1 ? 'total' : '') + '">' + esc(line) + '</li>';
    }).join('');
    var gNote = growth !== 1
      ? '<p class="hint">Sandbox growth ' + pct((growth - 1) * 100) + ' applied: base implied ' + moneyFull(r.implied_value_usd) +
        ' → ' + moneyFull(r.implied_value_usd * growth) + '; range ' + moneyFull(r.low_usd * growth) + ' – ' + moneyFull(r.high_usd * growth) + '.</p>'
      : '';
    $('detailBody').innerHTML =
      '<div class="kv"><span><b>TVL</b> ' + moneyFull(r.tvl_usd) + '</span>' +
      '<span><b>Category</b> ' + esc(r.category || '—') + '</span>' +
      '<span><b>Chains</b> ' + esc(r.chains.join(', ')) + '</span>' +
      '<span><b>7-day TVL</b> ' + (r.change_7d === null ? 'not reported' : pct(r.change_7d)) + '</span>' +
      '<span><b>Implied value</b> ' + moneyFull(r.implied_value_usd * growth) + '</span>' +
      '<span><b>Range (low – high)</b> ' + moneyFull(r.low_usd * growth) + ' – ' + moneyFull(r.high_usd * growth) + '</span>' +
      '<span><b>Multiple</b> ' + r.multiple.toFixed(3) + ' (' + r.peers + ' priced peer' + (r.peers === 1 ? '' : 's') + (r.fallback ? ', global fallback' : '') + ')</span>' +
      '<span><b>Listed</b> ' + (r.listed_at || 'not reported') + '</span></div>' +
      '<h3>How the value is calculated</h3><ol class="calc">' + calc + '</ol>' + gNote +
      '<h3>How to farm it</h3><ol class="steps">' + steps + '</ol>';
    renderBoard();
    sec.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* Sorting */
  document.querySelectorAll('#board th[data-sort]').forEach(function (th) {
    th.addEventListener('click', function () {
      var k = th.getAttribute('data-sort');
      if (sortKey === k) sortDir = -sortDir; else { sortKey = k; sortDir = 1; }
      renderBoard();
    });
  });

  /* Controls */
  $('q').addEventListener('input', renderBoard);
  catSel.addEventListener('change', renderBoard);
  $('watchOnly').addEventListener('change', renderBoard);
  $('withRange').addEventListener('change', renderBoard);
  $('growth').addEventListener('input', function () {
    var v = parseInt($('growth').value, 10);
    growth = 1 + v / 100;
    $('growthOut').textContent = (v > 0 ? '+' : '') + v + '%';
    renderBoard();
    if (selected) {
      var keep = selected;
      selected = null;
      showDetail(keep);
    }
  });

  renderBoard();
})();
