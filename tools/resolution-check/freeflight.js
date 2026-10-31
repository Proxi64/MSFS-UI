(function () {
  // Free Flight at the current size: the page's own rules, in pixels (docs/development.md, Screen resolutions). Right
  // column at fixed places: the Weather / Airport tabs 24 units under the timeline widget (level with the sim's search
  // field under the aircraft button), the bar or the sim's card 6 units under them, 6 units between the sections, the
  // METAR last, the whole column above the map buttons; each section a card of its own (every gap shows the map); every
  // block on the widget's edges; headers 6 units above their content; the weather grid to the bar's edges; the presets
  // list, when open, ending on the bottom of the bar. Left column: the favourites under the search field at the sim's
  // gap, on the button's edges, ending on a whole row, their scroll bar 6 units from the rows.
  // Returns { u, gaps, favourites, problems }.
  var u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--unscaledScreenHeight')) / 1080;
  var R = function (e) { return e.getBoundingClientRect(); };
  var page = document.querySelector('[name="FreeFlightPage"]') || document;
  var problems = [];
  var near = function (a, b) { return Math.abs(a - b) <= 1; };
  var widget = R(page.querySelector('[name="Flight_Conditions_History_Widget"]'));
  var filters = R(page.querySelector('[name="Worldmap_Filters"]'));
  var aircraft = R(page.querySelector('[name="FreeFlight_AircraftButton"]'));
  var panel = page.querySelector('.msfs-ui-wx');
  var tabs = page.querySelector('.msfs-ui-wx-tabs');
  if (!tabs || R(tabs).height === 0) return JSON.stringify({ problems: ['no weather bar on screen'] });
  var t = R(tabs);
  var group = Math.floor(24 * u);
  var gap = Math.floor(6 * u);

  // Right column: the tabs, then the bar or the card on its tab.
  var gaps = [Math.round(t.top - widget.bottom)];
  if (!near(t.top - widget.bottom, group)) problems.push('tabs ' + gaps[0] + ' under the widget, not ' + group);
  var cards = ['[name="FreeFlight_Runways"]', '[name="FreeFlight_Traffic"]'].map(function (s) { return page.querySelector(s); }).filter(function (e) { return e && R(e).height > 0 && getComputedStyle(e).visibility !== 'hidden'; });
  var barShown = panel && R(panel).height > 0;
  var blocks = [];
  if (barShown) {
    if (panel.querySelector(':scope > .msfs-ui-panel__blur')) problems.push('the bar has its own background: its gaps are filled');
    var sections = Array.prototype.slice.call(panel.querySelectorAll('.msfs-ui-wx__section'));
    sections.forEach(function (e) {
      if (R(e).height > 0) blocks.push(e);
      if (!e.querySelector(':scope > .msfs-ui-panel__blur')) problems.push('a section without its background');
    });
    var last = sections[sections.length - 1];
    if (!/METAR/.test(last.textContent || '')) problems.push('the METAR is not the last section');
  }
  if (cards.length > 0 && barShown) problems.push('the bar and a card both shown');
  if (cards.length > 0) blocks = [cards[0]];
  var bottom = t.bottom;
  blocks.forEach(function (e) {
    var b = R(e);
    gaps.push(Math.round(b.top - bottom));
    if (!near(b.top - bottom, gap)) problems.push('gap ' + Math.round(b.top - bottom) + ' above ' + (e.getAttribute('name') || (e.querySelector('.msfs-ui-title') || e).textContent.trim()) + ', not ' + gap);
    bottom = b.bottom;
  });
  gaps.push(Math.round(filters.top - bottom));
  if (bottom > filters.top) problems.push('the column passes the map buttons by ' + Math.round(bottom - filters.top));

  // Every block of the right column on the widget's edges.
  [tabs].concat(barShown ? blocks : []).forEach(function (e) {
    var b = R(e);
    if (!near(b.left, widget.left) || !near(b.right, widget.right)) problems.push('sides of ' + (e.getAttribute('name') || e.className) + ' ' + Math.round(b.left - widget.left) + '/' + Math.round(widget.right - b.right));
  });

  // The sim's search field in its own place, level with the tabs.
  var search = page.querySelector('[name="Search"]');
  var s = search ? R(search) : null;
  if (!s || s.height === 0) problems.push('search field hidden');
  else if (!near(s.top, t.top)) problems.push('search field top ' + Math.round(s.top) + ' against the tabs ' + Math.round(t.top));

  if (barShown) {
    var p = R(panel);
    // Headers 6 units above their content.
    blocks.forEach(function (e) {
      var h = e.querySelector('.msfs-ui-header');
      var c = e.querySelector('.msfs-ui-wx__body');
      var first = c && c.firstElementChild;
      if (h && first) {
        var d = R(first).top - R(h).bottom;
        if (Math.abs(d - gap) > 1) problems.push('header to content ' + (h.textContent || '').trim().split(/\s+/)[0] + ' ' + d.toFixed(1));
      }
    });
    // A section of text (the METAR) ends 6 units under its last line, as far as its first is under the header.
    blocks.forEach(function (e) {
      var lines = Array.prototype.slice.call(e.querySelectorAll('.msfs-ui-wx__line')).filter(function (l) { return R(l).height > 0; });
      if (lines.length === 0) return;
      var under = R(e).bottom - R(lines[lines.length - 1]).bottom;
      if (Math.abs(under - gap) > 1) problems.push('text ends ' + under.toFixed(1) + ' above the bottom of its section, not ' + gap);
    });
    // The weather grid: each row from one edge of the bar to the other.
    var rows = {};
    Array.prototype.slice.call(panel.querySelectorAll('.msfs-ui-wx__icon')).map(R).forEach(function (c) { var k = Math.round(c.top); (rows[k] = rows[k] || []).push(c); });
    Object.keys(rows).forEach(function (k) {
      var r = rows[k];
      if (!near(r[0].left, p.left) || !near(r[r.length - 1].right, p.right)) problems.push('grid row edges ' + Math.round(r[0].left - p.left) + '/' + Math.round(p.right - r[r.length - 1].right));
    });
    // The presets list, when open: down to the bottom of the bar (its last buttons).
    var list = panel.querySelector('.msfs-ui-wx__presets:not(.is-up) [name="List"]');
    if (list && getComputedStyle(list).display !== 'none' && !near(R(list).bottom, p.bottom)) problems.push('presets list bottom ' + Math.round(R(list).bottom - p.bottom));
  }

  // Left column: the favourites, under the search field at the sim's gap above it.
  var fav = page.querySelector('.msfs-ui-fav');
  var favInfo = 'no favourites';
  if (fav && R(fav).height > 0) {
    var fb = R(fav);
    var above = s && s.height > 0 ? s : aircraft;
    var leftGap = Math.round(fb.top - above.bottom);
    var simGap = s && s.height > 0 ? Math.round(s.top - aircraft.bottom) : group;
    if (Math.abs(leftGap - simGap) > 1) problems.push('favourites ' + leftGap + ' under the ' + (above === s ? 'search field' : 'aircraft button') + ', not ' + simGap);
    if (!near(fb.left, aircraft.left) || !near(fb.right, aircraft.right)) problems.push('favourites sides');
    var favRows = Array.prototype.slice.call(fav.querySelectorAll('.msfs-ui-fav__row')).map(R).filter(function (b) { return b.top < fb.bottom && b.bottom > fb.top; });
    var lastRow = favRows[favRows.length - 1];
    if (lastRow && !near(lastRow.bottom, fb.bottom)) problems.push('favourites end on a cut row ' + Math.round(lastRow.bottom - fb.bottom));
    var scrolling = fav.classList.contains('is-scrolling');
    if (scrolling && favRows.length) {
      var bar = fav.querySelector('ui-scroll-bar');
      var bb = bar ? R(bar) : null;
      if (bb && (Math.abs(bb.left - favRows[0].right - gap) > 1 || !near(fb.right, bb.right))) problems.push('scroll bar gap ' + Math.round(bb.left - favRows[0].right) + ', edge ' + Math.round(fb.right - bb.right));
    }
    favInfo = Math.round(fb.top) + '..' + Math.round(fb.bottom) + ', ' + favRows.length + ' rows on screen' + (scrolling ? ', scrolling' : '');
  }
  return JSON.stringify({ u: +u.toFixed(3), gaps: gaps.join(','), favourites: favInfo, problems: problems });
})()
