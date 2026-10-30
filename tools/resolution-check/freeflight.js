(function () {
  // Free Flight at the current size: the page's own rules, in pixels (docs/development.md, Screen resolutions). One
  // gap between every group of the right column, from the timeline widget down to the map buttons (the one under the
  // search field 3 pixels apart at most), the same above the favourites on the left; every block on its column's
  // edges; headers 6 units above their content; the search field as high as the time tiles; the weather grid to the
  // bar's edges; the favourites ending on a whole row, their scroll bar 6 units from the rows; the presets list, when
  // open, ending on the bottom of the bar. Returns { u, gaps, search, favourites, problems }.
  var u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--unscaledScreenHeight')) / 1080;
  var R = function (e) { return e.getBoundingClientRect(); };
  var problems = [];
  var widget = R(document.querySelector('[name="Flight_Conditions_History_Widget"]'));
  var filters = R(document.querySelector('[name="Worldmap_Filters"]'));
  var aircraft = R(document.querySelector('[name="FreeFlight_AircraftButton"]'));
  var panel = document.querySelector('.msfs-ui-wx');
  if (!panel || R(panel).height === 0) return JSON.stringify({ problems: ['no weather bar on screen'] });
  var p = R(panel);
  var sections = Array.prototype.slice.call(document.querySelectorAll('.msfs-ui-wx__section')).filter(function (e) { return R(e).height > 0; });
  var block = document.querySelector('.msfs-ui-wx-search');
  var shown = block && getComputedStyle(block).display !== 'none';
  var search = shown ? R(block.querySelector('[name="Search"]')) : null;

  // Right column: the gaps, from the widget to the map buttons.
  var edges = [widget.bottom];
  sections.forEach(function (e) { edges.push(R(e).top, R(e).bottom); });
  if (search) edges.push(search.top, search.bottom);
  edges.push(filters.top);
  var gaps = [];
  for (var i = 0; i + 1 < edges.length; i += 2) gaps.push(Math.round(edges[i + 1] - edges[i]));
  var inner = gaps.slice(0, gaps.length - 1);
  if (Math.max.apply(null, inner) - Math.min.apply(null, inner) > 1) problems.push('uneven gaps ' + gaps.join(','));
  if (Math.abs(gaps[gaps.length - 1] - inner[0]) > 3) problems.push('gap under the search ' + gaps[gaps.length - 1] + ' against ' + inner[0]);
  if (!search) problems.push('search field hidden');

  // Every block of the right column on the widget's edges.
  sections.concat(search ? [block.querySelector('[name="Search"]')] : []).forEach(function (e) {
    var b = R(e);
    if (Math.abs(b.left - widget.left) > 1 || Math.abs(b.right - widget.right) > 1) problems.push('sides of ' + (e.getAttribute('name') || e.className) + ' ' + Math.round(b.left - widget.left) + '/' + Math.round(widget.right - b.right));
  });

  // Headers 6 units above their content.
  sections.forEach(function (e) {
    var h = e.querySelector('.msfs-ui-header');
    var c = e.querySelector('.msfs-ui-wx__body');
    var first = c && c.firstElementChild;
    if (h && first) {
      var d = R(first).top - R(h).bottom;
      if (Math.abs(d - Math.floor(6 * u)) > 1) problems.push('header to content ' + (h.textContent || '').trim().split(/\s+/)[0] + ' ' + d.toFixed(1));
    }
  });

  // The search field as high as the time tiles.
  var now = R(document.querySelector('.msfs-ui-wx__choice'));
  if (search && Math.abs(search.height - now.height) > 1) problems.push('search height ' + search.height + ' against ' + now.height);

  // The weather grid: each row from one edge of the bar to the other.
  var rows = {};
  Array.prototype.slice.call(document.querySelectorAll('.msfs-ui-wx__icon')).map(R).forEach(function (c) { var k = Math.round(c.top); (rows[k] = rows[k] || []).push(c); });
  Object.keys(rows).forEach(function (k) {
    var r = rows[k];
    if (Math.abs(r[0].left - p.left) > 1 || Math.abs(r[r.length - 1].right - p.right) > 1) problems.push('grid row edges ' + Math.round(r[0].left - p.left) + '/' + Math.round(p.right - r[r.length - 1].right));
  });

  // The presets list, when open: down to the bottom of the bar (its last buttons).
  var list = document.querySelector('.msfs-ui-wx__presets:not(.is-up) [name="List"]');
  if (list && getComputedStyle(list).display !== 'none' && Math.abs(R(list).bottom - p.bottom) > 1) problems.push('presets list bottom ' + Math.round(R(list).bottom - p.bottom));

  // Left column: the favourites.
  var fav = document.querySelector('.msfs-ui-fav');
  var favInfo = 'no favourites';
  if (fav && R(fav).height > 0) {
    var fb = R(fav);
    var leftGap = Math.round(fb.top - aircraft.bottom);
    if (Math.abs(leftGap - inner[0]) > 1) problems.push('left gap ' + leftGap + ' against right ' + inner[0]);
    if (Math.abs(fb.left - aircraft.left) > 1 || Math.abs(fb.right - aircraft.right) > 1) problems.push('favourites sides');
    var favRows = Array.prototype.slice.call(fav.querySelectorAll('.msfs-ui-fav__row')).map(R).filter(function (b) { return b.top < fb.bottom && b.bottom > fb.top; });
    var last = favRows[favRows.length - 1];
    if (last && Math.abs(last.bottom - fb.bottom) > 1) problems.push('favourites end on a cut row ' + Math.round(last.bottom - fb.bottom));
    var scrolling = fav.classList.contains('is-scrolling');
    if (scrolling && favRows.length) {
      var bar = fav.querySelector('ui-scroll-bar');
      var bb = bar ? R(bar) : null;
      if (bb && (Math.abs(bb.left - favRows[0].right - Math.floor(6 * u)) > 1 || Math.abs(fb.right - bb.right) > 1)) problems.push('scroll bar gap ' + Math.round(bb.left - favRows[0].right) + ', edge ' + Math.round(fb.right - bb.right));
    }
    favInfo = Math.round(fb.top) + '..' + Math.round(fb.bottom) + ', ' + favRows.length + ' rows on screen' + (scrolling ? ', scrolling' : '');
  }
  return JSON.stringify({ u: +u.toFixed(3), gaps: gaps.join(','), search: search ? Math.round(search.height) + 'px' : 'hidden', favourites: favInfo, problems: problems });
})()
