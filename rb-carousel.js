/* =========================================================================
   rb-carousel.js
   Robotics section interactive carousel + cross-column sync + lightbox.
   Expected DOM (built in Webflow):
     section.rb
       .rb-cols
         .rb-col[id="rb-col-<key>"]
           .rb-col-hdr > .rb-col-ttl
           .rb-car[id="rb-car-<key>"] containing 5 <img> + .rb-cap[id="rb-cap-<key>"]
           .rb-prog[id="rb-prog-<key>"] containing 5 .rb-prog-seg
           .rb-rows-wrap[id="rb-rows-<key>"] containing 5 .rb-row[data-idx]
             each .rb-row has .rb-row-lbl, .rb-row-title, .rb-row-text
           .rb-link
   One column's index drives the other (cross-column sync by data-idx).
   ========================================================================= */
(function () {
  'use strict';

  // Run after DOM ready, but also re-init on Webflow's page transitions if any.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  function init() {
    var section = document.querySelector('section.rb');
    if (!section) return;
    if (section.dataset.rbInit === '1') return;
    section.dataset.rbInit = '1';

    // -------------------------------------------------------------------
    // Inject runtime CSS (hover / active / transitions / lightbox / bars).
    // Keep all visual tuning here so Designer styles are untouched.
    // -------------------------------------------------------------------
    injectStyles();

    var columns = Array.prototype.slice.call(section.querySelectorAll('.rb-col'));
    if (!columns.length) return;

    // Build per-column state objects.
    var cols = columns.map(buildColumnState).filter(Boolean);
    if (!cols.length) return;

    // Equalize row heights across columns per index.
    equalizeRowHeights(cols);
    window.addEventListener('resize', debounce(function () {
      equalizeRowHeights(cols);
    }, 150));

    // Shared active index + hover-intent state.
    var state = {
      activeIdx: 0,
      hoverPaused: false,
      hoverTimer: null,
      hoverPendingIdx: null,
      tickerId: null,
      segStart: 0,
      segElapsedBeforePause: 0,
      segDuration: 4500 // ms per slide
    };

    cols.forEach(function (col) {
      setupColumn(col, state, cols);
    });

    // Initial paint: show idx 0 on every column, start the progress ticker.
    applyActiveIndex(cols, 0);
    startTicker(cols, state);

    // Lightbox setup (single shared overlay).
    setupLightbox(cols, state);
  }

  // =====================================================================
  // Column state builder
  // =====================================================================
  function buildColumnState(colEl) {
    var car = colEl.querySelector('.rb-car');
    var cap = colEl.querySelector('.rb-cap');
    var prog = colEl.querySelector('.rb-prog');
    var rowsWrap = colEl.querySelector('.rb-rows-wrap');
    if (!car || !rowsWrap) return null;

    var imgs = Array.prototype.slice.call(car.querySelectorAll('img'));
    var segs = prog ? Array.prototype.slice.call(prog.querySelectorAll('.rb-prog-seg')) : [];
    var rows = Array.prototype.slice.call(rowsWrap.querySelectorAll('.rb-row'));

    // Ensure each seg has an inner fill bar.
    segs.forEach(function (seg) {
      if (!seg.querySelector('.rb-prog-fill')) {
        var fill = document.createElement('div');
        fill.className = 'rb-prog-fill';
        seg.appendChild(fill);
      }
    });

    // Stack images for cross-fade; first one visible.
    imgs.forEach(function (img, i) {
      img.classList.add('rb-img');
      if (i === 0) img.classList.add('rb-img-on');
      img.setAttribute('draggable', 'false');
    });

    // Captions: read per-row caption from row's title + lbl, or fall back
    // to .rb-cap text. Ideal: caption = row title. This fixes stuck caption.
    var captions = rows.map(function (row) {
      var t = row.querySelector('.rb-row-title');
      return t ? (t.textContent || '').trim() : '';
    });
    // If no row titles found, use the original cap text for every index.
    var fallbackCap = cap ? (cap.textContent || '').trim() : '';
    captions = captions.map(function (c) { return c || fallbackCap; });

    return {
      el: colEl,
      car: car,
      cap: cap,
      prog: prog,
      rowsWrap: rowsWrap,
      imgs: imgs,
      segs: segs,
      rows: rows,
      captions: captions,
      count: Math.max(imgs.length, rows.length)
    };
  }

  // =====================================================================
  // Per-column event wiring
  // =====================================================================
  function setupColumn(col, state, allCols) {
    // Row hover intent (>500ms to avoid jitter).
    col.rows.forEach(function (row) {
      var idx = parseInt(row.getAttribute('data-idx'), 10);
      if (isNaN(idx)) return;

      row.addEventListener('mouseenter', function () {
        // Pause the auto ticker; do NOT change columns on enter until
        // hover-intent timer fires.
        state.hoverPaused = true;
        state.hoverPendingIdx = idx;
        clearTimeout(state.hoverTimer);
        state.hoverTimer = setTimeout(function () {
          // If user is still on the row, commit.
          if (state.hoverPendingIdx === idx) {
            applyActiveIndex(allCols, idx);
            resetSegTimer(state);
          }
        }, 500);
      });
      row.addEventListener('mouseleave', function () {
        clearTimeout(state.hoverTimer);
        state.hoverPendingIdx = null;
        state.hoverPaused = false;
      });

      // Click row -> open lightbox at this index, for THIS column.
      row.addEventListener('click', function (e) {
        if (e.target.closest('a')) return; // don't hijack real links
        openLightbox(col, idx);
      });
    });

    // Image click also opens lightbox on that column at current active idx.
    col.car.addEventListener('click', function (e) {
      if (e.target.closest('a')) return;
      openLightbox(col, state.activeIdx);
    });
  }

  // =====================================================================
  // Render: apply an active index to every column
  // =====================================================================
  function applyActiveIndex(cols, idx) {
    cols.forEach(function (col) {
      var i = Math.max(0, Math.min(idx, col.count - 1));

      // Images cross-fade.
      col.imgs.forEach(function (img, n) {
        img.classList.toggle('rb-img-on', n === i);
      });

      // Caption updates to match current row title.
      if (col.cap) {
        var text = col.captions[i] || '';
        if (col.cap.textContent !== text) col.cap.textContent = text;
      }

      // Row active state.
      col.rows.forEach(function (row, n) {
        row.classList.toggle('rb-row-active', n === i);
      });

      // Progress segments: mark 'done' for segments before active,
      // 'active' for current, nothing for future.
      col.segs.forEach(function (seg, n) {
        seg.classList.remove('rb-seg-active', 'rb-seg-done');
        var fill = seg.querySelector('.rb-prog-fill');
        if (fill) {
          fill.style.transition = 'none';
          if (n < i) fill.style.width = '100%';
          else if (n === i) fill.style.width = '0%';
          else fill.style.width = '0%';
        }
        if (n < i) seg.classList.add('rb-seg-done');
        else if (n === i) seg.classList.add('rb-seg-active');
      });
    });
    // Snapshot shared active idx.
    cols.__activeIdx = idx;
  }

  // =====================================================================
  // Progress ticker (Instagram-style)
  // =====================================================================
  function startTicker(cols, state) {
    state.segStart = performance.now();
    state.segElapsedBeforePause = 0;

    function frame(now) {
      var activeIdx = (cols.__activeIdx != null) ? cols.__activeIdx : 0;

      // If paused by hover, hold the fill where it is and keep re-scheduling.
      if (state.hoverPaused) {
        // Freeze: record elapsed so far, then on resume, shift segStart.
        state.segElapsedBeforePause = Math.min(
          state.segDuration,
          state.segElapsedBeforePause + (now - state.segStart)
        );
        state.segStart = now;
        state.tickerId = requestAnimationFrame(frame);
        return;
      }

      var elapsed = state.segElapsedBeforePause + (now - state.segStart);
      var pct = Math.min(1, elapsed / state.segDuration);

      // Paint the active seg fill on every column.
      cols.forEach(function (col) {
        var seg = col.segs[activeIdx];
        if (!seg) return;
        var fill = seg.querySelector('.rb-prog-fill');
        if (fill) {
          fill.style.transition = 'none';
          fill.style.width = (pct * 100).toFixed(2) + '%';
        }
      });

      if (pct >= 1) {
        // Advance.
        var next = (activeIdx + 1) % maxCount(cols);
        applyActiveIndex(cols, next);
        resetSegTimer(state);
      }
      state.tickerId = requestAnimationFrame(frame);
    }
    state.tickerId = requestAnimationFrame(frame);
  }

  function resetSegTimer(state) {
    state.segStart = performance.now();
    state.segElapsedBeforePause = 0;
  }

  function maxCount(cols) {
    return cols.reduce(function (m, c) { return Math.max(m, c.count); }, 0) || 1;
  }

  // =====================================================================
  // Row height equalization across columns per index
  // =====================================================================
  function equalizeRowHeights(cols) {
    if (cols.length < 2) return;
    var max = maxCount(cols);
    for (var i = 0; i < max; i++) {
      // Clear previous min-height.
      cols.forEach(function (col) {
        var r = col.rows[i];
        if (r) r.style.minHeight = '';
      });
      // Measure natural heights.
      var heights = cols.map(function (col) {
        var r = col.rows[i];
        return r ? r.getBoundingClientRect().height : 0;
      });
      var tallest = Math.max.apply(null, heights);
      // Apply.
      cols.forEach(function (col) {
        var r = col.rows[i];
        if (r) r.style.minHeight = tallest + 'px';
      });
    }
  }

  // =====================================================================
  // Lightbox
  // =====================================================================
  var lb = null;
  function setupLightbox(cols, state) {
    lb = document.createElement('div');
    lb.className = 'rb-lb';
    lb.innerHTML = [
      '<div class="rb-lb-bg"></div>',
      '<div class="rb-lb-inner">',
      '  <div class="rb-lb-prog"></div>',
      '  <div class="rb-lb-main">',
      '    <div class="rb-lb-imgwrap">',
      '      <div class="rb-lb-nav-left" aria-label="Previous"></div>',
      '      <div class="rb-lb-nav-right" aria-label="Next"></div>',
      '      <img class="rb-lb-img" alt="">',
      '      <div class="rb-lb-cap"></div>',
      '    </div>',
      '    <div class="rb-lb-side">',
      '      <div class="rb-lb-lbl"></div>',
      '      <div class="rb-lb-title"></div>',
      '      <div class="rb-lb-text"></div>',
      '    </div>',
      '  </div>',
      '  <button class="rb-lb-close" aria-label="Close">',
      '    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
      '  </button>',
      '  <div class="rb-lb-tut" aria-hidden="true">',
      '    <div class="rb-lb-tut-left"><span class="rb-lb-tut-arrow">&larr;</span><span>Previous</span></div>',
      '    <div class="rb-lb-tut-right"><span>Next</span><span class="rb-lb-tut-arrow">&rarr;</span></div>',
      '    <div class="rb-lb-tut-hint">Click either side to navigate. Esc or X to close.</div>',
      '  </div>',
      '</div>'
    ].join('');
    document.body.appendChild(lb);

    var lbImg = lb.querySelector('.rb-lb-img');
    var lbCap = lb.querySelector('.rb-lb-cap');
    var lbLbl = lb.querySelector('.rb-lb-lbl');
    var lbTitle = lb.querySelector('.rb-lb-title');
    var lbText = lb.querySelector('.rb-lb-text');
    var lbProg = lb.querySelector('.rb-lb-prog');
    var lbTut = lb.querySelector('.rb-lb-tut');
    var lbBg = lb.querySelector('.rb-lb-bg');
    var lbClose = lb.querySelector('.rb-lb-close');
    var lbLeft = lb.querySelector('.rb-lb-nav-left');
    var lbRight = lb.querySelector('.rb-lb-nav-right');

    var lbState = {
      col: null,
      idx: 0,
      tickerId: null,
      segStart: 0,
      segDuration: 4500,
      segElapsedBeforePause: 0
    };

    lb._state = lbState;
    lb._render = function render(col, idx) {
      var i = Math.max(0, Math.min(idx, col.count - 1));
      lbState.col = col;
      lbState.idx = i;

      var srcImg = col.imgs[i];
      if (srcImg) {
        lbImg.src = srcImg.currentSrc || srcImg.src;
        lbImg.srcset = srcImg.srcset || '';
        lbImg.alt = srcImg.alt || '';
      }

      var row = col.rows[i];
      lbLbl.textContent = textOf(row, '.rb-row-lbl');
      lbTitle.textContent = textOf(row, '.rb-row-title');
      lbText.textContent = textOf(row, '.rb-row-text');
      lbCap.textContent = col.captions[i] || '';

      // Build progress segments in lightbox to match count.
      if (lbProg.childElementCount !== col.count) {
        lbProg.innerHTML = '';
        for (var k = 0; k < col.count; k++) {
          var s = document.createElement('div');
          s.className = 'rb-lb-seg';
          var f = document.createElement('div');
          f.className = 'rb-lb-fill';
          s.appendChild(f);
          lbProg.appendChild(s);
        }
      }
      Array.prototype.forEach.call(lbProg.children, function (seg, n) {
        var fill = seg.firstChild;
        fill.style.transition = 'none';
        if (n < i) fill.style.width = '100%';
        else fill.style.width = '0%';
      });
      resetLbSeg();
    };

    function resetLbSeg() {
      lbState.segStart = performance.now();
      lbState.segElapsedBeforePause = 0;
    }

    function tickLb(now) {
      if (!lb.classList.contains('rb-lb-open')) return;
      var col = lbState.col;
      if (!col) { lbState.tickerId = requestAnimationFrame(tickLb); return; }
      var elapsed = lbState.segElapsedBeforePause + (now - lbState.segStart);
      var pct = Math.min(1, elapsed / lbState.segDuration);
      var seg = lbProg.children[lbState.idx];
      if (seg) {
        var fill = seg.firstChild;
        fill.style.transition = 'none';
        fill.style.width = (pct * 100).toFixed(2) + '%';
      }
      if (pct >= 1) {
        go(1);
      }
      lbState.tickerId = requestAnimationFrame(tickLb);
    }

    function go(delta) {
      if (!lbState.col) return;
      var next = (lbState.idx + delta + lbState.col.count) % lbState.col.count;
      lb._render(lbState.col, next);
    }

    // Events.
    lbLeft.addEventListener('click', function (e) { e.stopPropagation(); go(-1); });
    lbRight.addEventListener('click', function (e) { e.stopPropagation(); go(1); });
    lbClose.addEventListener('click', function () { closeLb(); });
    lbBg.addEventListener('click', function () { closeLb(); });
    document.addEventListener('keydown', function (e) {
      if (!lb.classList.contains('rb-lb-open')) return;
      if (e.key === 'Escape') closeLb();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    });

    function closeLb() {
      lb.classList.remove('rb-lb-open');
      cancelAnimationFrame(lbState.tickerId);
      // Resume section ticker.
      state.hoverPaused = false;
    }

    // Expose opener.
    lb._open = function (col, idx) {
      lb._render(col, idx);
      lb.classList.add('rb-lb-open');
      // Tutorial on first open only.
      try {
        if (!localStorage.getItem('rb_lb_tut_seen')) {
          lbTut.classList.add('rb-lb-tut-show');
          localStorage.setItem('rb_lb_tut_seen', '1');
          setTimeout(function () { lbTut.classList.remove('rb-lb-tut-show'); }, 3200);
        }
      } catch (err) { /* storage blocked; skip tutorial */ }
      // Pause section auto-ticker while lightbox is open.
      state.hoverPaused = true;
      resetLbSeg();
      cancelAnimationFrame(lbState.tickerId);
      lbState.tickerId = requestAnimationFrame(tickLb);
    };
  }

  function openLightbox(col, idx) {
    if (!lb) return;
    lb._open(col, idx);
  }

  // =====================================================================
  // Utilities
  // =====================================================================
  function textOf(parent, sel) {
    if (!parent) return '';
    var el = parent.querySelector(sel);
    return el ? (el.textContent || '').trim() : '';
  }
  function debounce(fn, ms) {
    var t;
    return function () {
      var a = arguments, c = this;
      clearTimeout(t);
      t = setTimeout(function () { fn.apply(c, a); }, ms);
    };
  }

  // =====================================================================
  // Styles
  // =====================================================================
  function injectStyles() {
    if (document.getElementById('rb-carousel-styles')) return;
    var css = [
      /* Carousel image stack */
      '.rb .rb-car{position:relative;overflow:hidden}',
      '.rb .rb-car img.rb-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .45s ease;pointer-events:none}',
      '.rb .rb-car img.rb-img.rb-img-on{opacity:1;pointer-events:auto;cursor:zoom-in}',
      /* First image pinning so container has height even before JS */
      '.rb .rb-car img:first-of-type{position:relative}',
      /* Progress segments */
      '.rb .rb-prog{display:flex;gap:4px}',
      '.rb .rb-prog-seg{position:relative;flex:1;height:3px;background:rgba(255,255,255,.22);border-radius:2px;overflow:hidden}',
      '.rb .rb-prog-fill{position:absolute;left:0;top:0;bottom:0;width:0%;background:rgba(255,255,255,.9);border-radius:2px}',
      /* Row active emphasis (lighter gray border per your spec) */
      '.rb .rb-row{transition:border-color .2s ease, background-color .2s ease, box-shadow .2s ease;border:1px solid rgba(255,255,255,0.08);border-radius:10px;cursor:pointer}',
      '.rb .rb-row.rb-row-active{border-color:rgba(255,255,255,0.35);box-shadow:0 0 0 1px rgba(255,255,255,0.12) inset}',
      '.rb .rb-row:hover{border-color:rgba(255,255,255,0.28)}',
      /* Lightbox */
      '.rb-lb{position:fixed;inset:0;z-index:9999;display:none}',
      '.rb-lb.rb-lb-open{display:block}',
      '.rb-lb-bg{position:absolute;inset:0;background:rgba(8,8,10,.82);backdrop-filter:blur(6px)}',
      '.rb-lb-inner{position:relative;width:min(1200px,94vw);height:min(800px,88vh);margin:4vh auto 0;display:flex;flex-direction:column;color:#fff;font-family:inherit}',
      '.rb-lb-prog{display:flex;gap:4px;padding:12px 16px 8px}',
      '.rb-lb-seg{position:relative;flex:1;height:3px;background:rgba(255,255,255,.22);border-radius:2px;overflow:hidden}',
      '.rb-lb-fill{position:absolute;inset:0;width:0;background:rgba(255,255,255,.9);border-radius:2px}',
      '.rb-lb-main{flex:1;display:grid;grid-template-columns:2fr 1fr;gap:16px;padding:8px 16px 16px;min-height:0}',
      '.rb-lb-imgwrap{position:relative;background:#111;border-radius:12px;overflow:hidden;display:flex;align-items:center;justify-content:center}',
      '.rb-lb-img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block}',
      '.rb-lb-cap{position:absolute;left:12px;bottom:10px;right:12px;font-size:13px;color:#ddd;text-shadow:0 1px 2px rgba(0,0,0,.6)}',
      '.rb-lb-nav-left,.rb-lb-nav-right{position:absolute;top:0;bottom:0;width:50%;cursor:pointer;z-index:2}',
      '.rb-lb-nav-left{left:0}.rb-lb-nav-right{right:0}',
      '.rb-lb-side{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:20px;overflow:auto;display:flex;flex-direction:column;gap:10px}',
      '.rb-lb-lbl{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#aaa}',
      '.rb-lb-title{font-size:22px;font-weight:600;line-height:1.2}',
      '.rb-lb-text{font-size:14px;line-height:1.55;color:#ccc}',
      '.rb-lb-close{position:absolute;top:10px;right:10px;width:36px;height:36px;border:0;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;display:grid;place-items:center;cursor:pointer;transition:background .15s ease;z-index:3}',
      '.rb-lb-close:hover{background:rgba(255,255,255,.22)}',
      /* Tutorial overlay */
      '.rb-lb-tut{position:absolute;inset:0;display:none;align-items:center;justify-content:space-between;padding:0 8%;pointer-events:none;color:#fff;font-size:18px;letter-spacing:.04em}',
      '.rb-lb-tut.rb-lb-tut-show{display:flex}',
      '.rb-lb-tut-left,.rb-lb-tut-right{display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.4);padding:10px 16px;border-radius:999px;animation:rbTutPulse 1.6s ease-in-out infinite}',
      '.rb-lb-tut-arrow{font-size:22px}',
      '.rb-lb-tut-hint{position:absolute;left:0;right:0;bottom:10%;text-align:center;font-size:13px;color:#ddd}',
      '@keyframes rbTutPulse{0%,100%{transform:scale(1);opacity:.9}50%{transform:scale(1.06);opacity:1}}',
      /* Mobile */
      '@media (max-width: 720px){',
      '  .rb-lb-main{grid-template-columns:1fr;grid-template-rows:1fr auto}',
      '  .rb-lb-inner{margin-top:2vh;height:96vh;width:96vw}',
      '}'
    ].join('\n');

    var tag = document.createElement('style');
    tag.id = 'rb-carousel-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }
})();
