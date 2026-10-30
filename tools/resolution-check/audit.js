(function () {
  // Audit of everything the mod shows on the current screen: elements outside the page, controls of a bar overlapping,
  // texts wider than their box (no ellipsis in the engine: they are cut), and the alignment rules of each part.
  // Returns { size, parts, problems }.
  var W = window.innerWidth;
  var H = window.innerHeight;
  var u = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--unscaledScreenHeight')) / 1080;
  var problems = [];
  var rect = function (e) { var b = e.getBoundingClientRect(); return { l: b.left, r: b.right, t: b.top, b: b.bottom, w: b.width, h: b.height }; };
  var visible = function (e) {
    if (!e) return false;
    var b = e.getBoundingClientRect();
    if (b.width < 1 || b.height < 1) return false;
    for (var n = e; n && n !== document.body; n = n.parentElement) {
      var cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') return false;
    }
    return true;
  };
  var name = function (e) { return (e.getAttribute('name') || String(e.className).split(' ').slice(0, 2).join('.')).slice(0, 50); };
  var px = function (v) { return Math.round(v * 10) / 10; };
  var roots = ['.msfs-ui-gal', '.msfs-ui-setup', '.msfs-ui-fav', '.msfs-ui-wx', '.msfs-ui-panel'];
  var parts = [];
  roots.forEach(function (selector) {
    Array.prototype.slice.call(document.querySelectorAll(selector)).forEach(function (root) {
      if (!visible(root)) return;
      var rr = rect(root);
      parts.push(selector + ' ' + px(rr.l) + '-' + px(rr.r) + ' x ' + px(rr.t) + '-' + px(rr.b));
      if (rr.l < -0.5 || rr.r > W + 0.5 || rr.t < -0.5 || rr.b > H + 0.5) problems.push('outside the page: ' + selector + ' ' + JSON.stringify([px(rr.l), px(rr.r), px(rr.t), px(rr.b)]));
      // Texts cut: a text element wider (by its content) than the box it is in.
      Array.prototype.slice.call(root.querySelectorAll('span, [name="Text"], [name="Title"], [name="AircraftName"], [name="Subtitle"], [name="Distance"], [name="ValueText"], .msfs-ui-title, .msfs-ui-value, .msfs-ui-gal__count')).forEach(function (t) {
        if (!visible(t) || !(t.textContent || '').trim()) return;
        if (t.closest && t.closest('.marquee__trigger')) return; // the sim scrolls those on hover
        if (t.scrollWidth > t.clientWidth + 1 && getComputedStyle(t).overflow !== 'visible') problems.push('text cut: "' + t.textContent.trim().slice(0, 40) + '" ' + t.scrollWidth + ' > ' + t.clientWidth + ' in ' + name(t.parentElement));
      });
    });
  });
  // Bars: their controls in order, none overlapping the next, none outside the bar.
  Array.prototype.slice.call(document.querySelectorAll('.msfs-ui-gal__bar')).forEach(function (bar) {
    if (!visible(bar)) return;
    var b = rect(bar);
    var controls = Array.prototype.slice.call(bar.querySelectorAll('.msfs-ui-gal__control, .msfs-ui-gal__count')).filter(visible).map(function (c) { return { n: name(c), r: rect(c) }; });
    controls.sort(function (a, c) { return a.r.l - c.r.l; });
    for (var i = 0; i < controls.length; i++) {
      var c = controls[i];
      if (c.r.l < b.l - 0.5 || c.r.r > b.r + 0.5) problems.push('bar control outside its bar: ' + c.n + ' ' + px(c.r.l) + '-' + px(c.r.r) + ' bar ' + px(b.l) + '-' + px(b.r));
      if (i > 0 && controls[i - 1].r.r > c.r.l + 0.5) problems.push('bar controls overlap: ' + controls[i - 1].n + ' ends ' + px(controls[i - 1].r.r) + ', ' + c.n + ' starts ' + px(c.r.l));
      if (c.r.w < 20) problems.push('bar control too narrow: ' + c.n + ' ' + px(c.r.w));
    }
  });
  // The gallery's tiles and rows inside their list horizontally (a cut tile at rest in Default is a problem).
  var list = document.querySelector('.msfs-ui-gal__body .msfs-ui-gal__list');
  if (visible(list)) {
    var lr = rect(list);
    Array.prototype.slice.call(list.querySelectorAll('.msfs-ui-gal__tile, .msfs-ui-gal__row')).filter(visible).forEach(function (t) {
      var r = rect(t);
      if (r.b < lr.t || r.t > lr.b) return;
      if (r.r > lr.l + 1 && r.l < lr.r - 1 && (r.l < lr.l - 0.5 || r.r > lr.r + 0.5)) problems.push('tile cut by its list: ' + px(r.l) + '-' + px(r.r) + ' list ' + px(lr.l) + '-' + px(lr.r));
    });
  }
  // The setup panel: every block on the title block's edges.
  var setup = document.querySelector('.msfs-ui-setup');
  var title = document.querySelector('[name="Fleet_Details"] [name="Header"]');
  if (visible(setup) && title) {
    var tr = rect(title);
    Array.prototype.slice.call(setup.querySelectorAll('.msfs-ui-setup__variants, .msfs-ui-setup__variant, .msfs-ui-setup__livery-header, .msfs-ui-setup__liveries, .msfs-ui-setup__stats, .msfs-ui-setup__tail, .msfs-ui-setup__actions')).filter(visible).forEach(function (blk) {
      var r = rect(blk);
      if (Math.abs(r.l - tr.l) > 1 || (Math.abs(r.r - tr.r) > 1 && blk.className.indexOf('setup__variant ') < 0 && blk.className !== 'msfs-ui-setup__variant msfs-ui-compact-tile')) problems.push('setup block off the title block: ' + name(blk) + ' ' + px(r.l) + '-' + px(r.r) + ' title ' + px(tr.l) + '-' + px(tr.r));
    });
    if (rect(setup).b > rect(document.querySelector('[name="Fleet_Details"] [name="ButtonBlock"]') || setup).t + 1) problems.push('setup panel runs over the Configure tile');
  }
  return JSON.stringify({ size: W + 'x' + H + ' u=' + px(u * 1000) / 1000, parts: parts, problems: problems });
})()
