/* =========================================================================
   rb-carousel.js  v1.7.0
   Robotics section interactive carousel + cross-column sync + lightbox.

   v1.7.0 tweaks (lightbox layout):
   - Main image hugs the top of the lightbox (no empty space above).
   - Caption overlaid on the image bottom-left with glassy translucent look.
   - Thumbnail strip taller to make use of reclaimed vertical space.

   v1.6.0 adds:
   - Lightbox thumbnail strip below main image (decorative, not navigational).
     Set per-row via data-extras="<url1>, <url2>, <url3>" on each .rb-row.
     Up to 3 thumbnails rendered. If empty/missing: no strip rendered.

   v1.5.0 changes:
   - Lightbox: no auto-advance. Bars solid 100% up to current index.
   - Lightbox: persistent left/right arrow indicators.
   - Non-lightbox hover: bars fill instantly to hovered index.
   - Non-lightbox: when hover ends, the active-row timer resets to 0.
   - Both: clicking a progress bar segment jumps to that index.
   - Per-image content via data-caption and data-long-desc on each .rb-row.
   ========================================================================= */
(function () {
  'use strict';

  if (window.__rbCarousel && window.__rbCarousel.loaded) {
    try { console.log('[rb-carousel] duplicate load detected, ignoring'); } catch (e) {}
    return;
  }
  window.__rbCarousel = window.__rbCarousel || { loaded: false, lb: null };
  window.__rbCarousel.loaded = true;

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
    try { console.log('[rb-carousel] v1.7.0 init'); } catch (e) {}

    injectStyles();

    var columns = Array.prototype.slice.call(section.querySelectorAll('.rb-col'));
    if (!columns.length) return;

    var cols = columns.map(buildColumnState).filter(Boolean);
    if (!cols.length) return;

    equalizeRowHeights(cols);
    window.addEventListener('resize', debounce(function () {
      equalizeRowHeights(cols);
    }, 150));

    var state = {
      activeIdx: 0,
      hoverPaused: false,
      hoverTimer: null,
      hoverPendingIdx: null,
      tickerId: null,
      segStart: 0,
      segElapsedBeforePause: 0,
      segDuration: 4500
    };

    cols.forEach(function (col) {
      setupColumn(col, state, cols);
    });

    applyActiveIndex(cols, 0);
    startTicker(cols, state);

    try {
      setupLightbox(cols, state);
      console.log('[rb-carousel] setupLightbox completed, lb:', !!window.__rbCarousel.lb);
    } catch (err) {
      console.error('[rb-carousel] setupLightbox THREW:', err);
    }
  }

  function buildColumnState(colEl) {
    var car = colEl.querySelector('.rb-car');
    var cap = colEl.querySelector('.rb-cap');
    var prog = colEl.querySelector('.rb-prog');
    var rowsWrap = colEl.querySelector('.rb-rows-wrap');
    if (!car || !rowsWrap) return null;

    var imgs = Array.prototype.slice.call(car.querySelectorAll('img'));
    var segs = prog ? Array.prototype.slice.call(prog.querySelectorAll('.rb-prog-seg')) : [];
    var rows = Array.prototype.slice.call(rowsWrap.querySelectorAll('.rb-row'));

    segs.forEach(function (seg) {
      if (!seg.querySelector('.rb-prog-fill')) {
        var fill = document.createElement('div');
        fill.className = 'rb-prog-fill';
        seg.appendChild(fill);
      }
    });

    imgs.forEach(function (img, i) {
      img.classList.add('rb-img');
      if (i === 0) img.classList.add('rb-img-on');
      img.setAttribute('draggable', 'false');
    });

    // Captions: prefer data-caption on the row, then row title, then fallback to .rb-cap text.
    var fallbackCap = cap ? (cap.textContent || '').trim() : '';
    var captions = rows.map(function (row) {
      var dc = row.getAttribute('data-caption');
      if (dc != null && dc.trim() !== '') return dc.trim();
      var t = row.querySelector('.rb-row-title');
      var rt = t ? (t.textContent || '').trim() : '';
      return rt || fallbackCap;
    });

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

  function setupColumn(col, state, allCols) {
    col.rows.forEach(function (row) {
      var idx = parseInt(row.getAttribute('data-idx'), 10);
      if (isNaN(idx)) return;

      row.addEventListener('mouseenter', function () {
        state.hoverPaused = true;
        state.hoverPendingIdx = idx;
        clearTimeout(state.hoverTimer);
        state.hoverTimer = setTimeout(function () {
          if (state.hoverPendingIdx === idx) {
            applyActiveIndex(allCols, idx);
            // Hovered: bars are 100% up to active. Skip animation while hovered.
            paintHoverBars(allCols, idx);
            resetSegTimer(state);
          }
        }, 500);
      });
      row.addEventListener('mouseleave', function () {
        clearTimeout(state.hoverTimer);
        state.hoverPendingIdx = null;
        state.hoverPaused = false;
        // Reset timer for the now-active row to 0 so user feels in control.
        resetSegTimer(state);
      });

      row.addEventListener('click', function (e) {
        if (e.target.closest('a')) return;
        openLightbox(col, idx);
      });
    });

    // Hotspot for image clicks
    if (!col.car.querySelector('.rb-car-hotspot')) {
      var hotspot = document.createElement('div');
      hotspot.className = 'rb-car-hotspot';
      hotspot.style.cssText = 'position:absolute;inset:0;cursor:zoom-in;z-index:5;background:transparent';
      col.car.style.position = col.car.style.position || 'relative';
      col.car.appendChild(hotspot);
      hotspot.addEventListener('click', function (e) {
        e.preventDefault();
        e.stopPropagation();
        var i = allCols.__activeIdx != null ? allCols.__activeIdx : 0;
        openLightbox(col, i);
      });
    }
    if (col.cap) {
      col.cap.style.pointerEvents = 'none';
    }

    // Progress segments are clickable to jump to that index
    col.segs.forEach(function (seg, segIdx) {
      seg.style.cursor = 'pointer';
      seg.addEventListener('click', function (e) {
        e.stopPropagation();
        applyActiveIndex(allCols, segIdx);
        resetSegTimer(state);
      });
    });
  }

  // Paint progress segments to "all-filled-up-to-i" without animation,
  // used while user is hovering a row (no progress, just static state).
  function paintHoverBars(cols, i) {
    cols.forEach(function (col) {
      col.segs.forEach(function (seg, n) {
        var fill = seg.querySelector('.rb-prog-fill');
        if (!fill) return;
        fill.style.transition = 'none';
        fill.style.width = (n <= i ? '100%' : '0%');
      });
    });
  }

  function applyActiveIndex(cols, idx) {
    cols.forEach(function (col) {
      var i = Math.max(0, Math.min(idx, col.count - 1));
      col.imgs.forEach(function (img, n) {
        img.classList.toggle('rb-img-on', n === i);
      });
      if (col.cap) {
        var text = col.captions[i] || '';
        if (col.cap.textContent !== text) col.cap.textContent = text;
      }
      col.rows.forEach(function (row, n) {
        row.classList.toggle('rb-row-active', n === i);
      });
      col.segs.forEach(function (seg, n) {
        seg.classList.remove('rb-seg-active', 'rb-seg-done');
        var fill = seg.querySelector('.rb-prog-fill');
        if (fill) {
          fill.style.transition = 'none';
          if (n < i) fill.style.width = '100%';
          else fill.style.width = '0%';
        }
        if (n < i) seg.classList.add('rb-seg-done');
        else if (n === i) seg.classList.add('rb-seg-active');
      });
    });
    cols.__activeIdx = idx;
  }

  function startTicker(cols, state) {
    state.segStart = performance.now();
    state.segElapsedBeforePause = 0;

    function frame(now) {
      var activeIdx = (cols.__activeIdx != null) ? cols.__activeIdx : 0;
      if (state.hoverPaused) {
        // While hovered: do not advance the timer at all.
        state.segStart = now;
        state.tickerId = requestAnimationFrame(frame);
        return;
      }
      var elapsed = state.segElapsedBeforePause + (now - state.segStart);
      var pct = Math.min(1, elapsed / state.segDuration);
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

  function equalizeRowHeights(cols) {
    if (cols.length < 2) return;
    var max = maxCount(cols);
    for (var i = 0; i < max; i++) {
      cols.forEach(function (col) {
        var r = col.rows[i];
        if (r) r.style.minHeight = '';
      });
      var heights = cols.map(function (col) {
        var r = col.rows[i];
        return r ? r.getBoundingClientRect().height : 0;
      });
      var tallest = Math.max.apply(null, heights);
      cols.forEach(function (col) {
        var r = col.rows[i];
        if (r) r.style.minHeight = tallest + 'px';
      });
    }
  }

  function setupLightbox(cols, state) {
    var existing = document.querySelector('.rb-lb');
    if (existing) existing.remove();

    var lb = document.createElement('div');
    lb.className = 'rb-lb';
    lb.innerHTML = [
      '<div class="rb-lb-bg"></div>',
      '<div class="rb-lb-inner">',
      '  <div class="rb-lb-prog"></div>',
      '  <div class="rb-lb-main">',
      '    <div class="rb-lb-left">',
      '      <div class="rb-lb-imgwrap">',
      '        <div class="rb-lb-nav-left" aria-label="Previous">',
      '          <div class="rb-lb-arrow rb-lb-arrow-left">',
      '            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M15 6l-6 6 6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      '          </div>',
      '        </div>',
      '        <div class="rb-lb-nav-right" aria-label="Next">',
      '          <div class="rb-lb-arrow rb-lb-arrow-right">',
      '            <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
      '          </div>',
      '        </div>',
      '        <img class="rb-lb-img" alt="">',
      '        <div class="rb-lb-cap"></div>',
      '      </div>',
      '      <div class="rb-lb-extras" aria-hidden="true"></div>',
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
      '</div>'
    ].join('');
    document.body.appendChild(lb);

    window.__rbCarousel.lb = lb;

    var lbImg = lb.querySelector('.rb-lb-img');
    var lbCap = lb.querySelector('.rb-lb-cap');
    var lbLbl = lb.querySelector('.rb-lb-lbl');
    var lbTitle = lb.querySelector('.rb-lb-title');
    var lbText = lb.querySelector('.rb-lb-text');
    var lbProg = lb.querySelector('.rb-lb-prog');
    var lbBg = lb.querySelector('.rb-lb-bg');
    var lbClose = lb.querySelector('.rb-lb-close');
    var lbLeft = lb.querySelector('.rb-lb-nav-left');
    var lbRight = lb.querySelector('.rb-lb-nav-right');
    var lbExtras = lb.querySelector('.rb-lb-extras');

    var lbState = { col: null, idx: 0 };

    lb._render = function (col, idx) {
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

      // Long description: prefer data-long-desc on the row, fallback to .rb-row-text.
      var ld = row && row.getAttribute('data-long-desc');
      if (ld != null && ld.trim() !== '') {
        lbText.textContent = ld.trim();
      } else {
        lbText.textContent = textOf(row, '.rb-row-text');
      }

      lbCap.textContent = col.captions[i] || '';

      // Extras strip: parse data-extras as comma-separated URLs, render up to 3.
      lbExtras.innerHTML = '';
      var extrasAttr = row && row.getAttribute('data-extras');
      var extras = [];
      if (extrasAttr) {
        extras = extrasAttr.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
      }
      if (extras.length > 0) {
        extras.slice(0, 3).forEach(function (url) {
          var thumb = document.createElement('div');
          thumb.className = 'rb-lb-extra';
          var t = document.createElement('img');
          t.src = url;
          t.alt = '';
          t.draggable = false;
          thumb.appendChild(t);
          lbExtras.appendChild(thumb);
        });
        lbExtras.style.display = 'flex';
      } else {
        lbExtras.style.display = 'none';
      }

      // Build segments
      if (lbProg.childElementCount !== col.count) {
        lbProg.innerHTML = '';
        for (var k = 0; k < col.count; k++) {
          var s = document.createElement('div');
          s.className = 'rb-lb-seg';
          s.setAttribute('data-lb-idx', String(k));
          var f = document.createElement('div');
          f.className = 'rb-lb-fill';
          s.appendChild(f);
          lbProg.appendChild(s);
        }
        // Wire click-to-jump on lightbox segs (once)
        Array.prototype.forEach.call(lbProg.children, function (seg) {
          seg.style.cursor = 'pointer';
          seg.addEventListener('click', function (e) {
            e.stopPropagation();
            var n = parseInt(seg.getAttribute('data-lb-idx'), 10);
            if (!isNaN(n)) lb._render(lbState.col, n);
          });
        });
      }
      // Paint segments: solid 100% up to and including i, 0% after.
      Array.prototype.forEach.call(lbProg.children, function (seg, n) {
        var fill = seg.firstChild;
        fill.style.transition = 'none';
        fill.style.width = (n <= i ? '100%' : '0%');
      });
    };

    function go(delta) {
      if (!lbState.col) return;
      var next = (lbState.idx + delta + lbState.col.count) % lbState.col.count;
      lb._render(lbState.col, next);
    }

    lbLeft.addEventListener('click', function (e) { e.stopPropagation(); go(-1); });
    lbRight.addEventListener('click', function (e) { e.stopPropagation(); go(1); });
    lbClose.addEventListener('click', function () { closeLb(); });
    lbBg.addEventListener('click', function () { closeLb(); });
    document.addEventListener('keydown', function (e) {
      if (!lb || !lb.classList || !lb.classList.contains('rb-lb-open')) return;
      if (e.key === 'Escape') closeLb();
      else if (e.key === 'ArrowLeft') go(-1);
      else if (e.key === 'ArrowRight') go(1);
    });

    function closeLb() {
      lb.classList.remove('rb-lb-open');
      state.hoverPaused = false;
    }

    lb._open = function (col, idx) {
      lb._render(col, idx);
      lb.classList.add('rb-lb-open');
      state.hoverPaused = true; // pause section ticker while lightbox open
    };
  }

  function openLightbox(col, idx) {
    var lb = window.__rbCarousel && window.__rbCarousel.lb;
    if (!lb) return;
    lb._open(col, idx);
  }

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

  function injectStyles() {
    if (document.getElementById('rb-carousel-styles')) return;
    var css = [
      /* Carousel */
      '.rb .rb-car{position:relative;overflow:hidden}',
      '.rb .rb-car img.rb-img{position:absolute;inset:0;width:100%;height:100%;object-fit:cover;opacity:0;transition:opacity .45s ease;pointer-events:none}',
      '.rb .rb-car img.rb-img.rb-img-on{opacity:1;pointer-events:auto;cursor:zoom-in}',
      '.rb .rb-car img:first-of-type{position:relative}',
      /* Section progress bars (clickable) */
      '.rb .rb-prog{display:flex;gap:4px}',
      '.rb .rb-prog-seg{position:relative;flex:1;height:3px;background:rgba(255,255,255,.22);border-radius:2px;overflow:hidden;cursor:pointer}',
      '.rb .rb-prog-seg:hover{background:rgba(255,255,255,.35)}',
      '.rb .rb-prog-fill{position:absolute;left:0;top:0;bottom:0;width:0%;background:rgba(255,255,255,.9);border-radius:2px}',
      /* Rows */
      'section.rb .rb-rows-wrap{display:flex !important;flex-direction:column !important;grid-template-columns:none !important;gap:0 !important}',
      'section.rb .rb-rows-wrap .rb-row{position:relative !important;cursor:pointer !important;background-color:transparent !important;background:none !important;border:0 !important;border-radius:0 !important;box-shadow:none !important;transition:background-color .2s ease !important;padding-left:14px !important;padding-top:14px !important;padding-bottom:14px !important;margin:0 !important}',
      'section.rb .rb-rows-wrap .rb-row + .rb-row{border-top:1px solid rgba(255,255,255,0.08) !important}',
      'section.rb .rb-rows-wrap .rb-row::before{content:"" !important;position:absolute !important;left:0 !important;top:0 !important;bottom:0 !important;width:3px !important;background:#fff !important;opacity:0 !important;transition:opacity .2s ease !important;pointer-events:none !important;display:block !important}',
      'section.rb .rb-rows-wrap .rb-row.rb-row-active{background-color:rgba(255,255,255,0.05) !important}',
      'section.rb .rb-rows-wrap .rb-row.rb-row-active::before{opacity:1 !important}',
      'section.rb .rb-rows-wrap .rb-row:hover:not(.rb-row-active){background-color:rgba(255,255,255,0.025) !important}',
      /* Lightbox */
      '.rb-lb{position:fixed;inset:0;z-index:9999;display:none}',
      '.rb-lb.rb-lb-open{display:block}',
      '.rb-lb-bg{position:absolute;inset:0;background:rgba(8,8,10,.82);backdrop-filter:blur(6px)}',
      '.rb-lb-inner{position:relative;width:min(1200px,94vw);height:min(800px,88vh);margin:4vh auto 0;display:flex;flex-direction:column;color:#fff;font-family:inherit}',
      /* Lightbox progress (clickable) */
      '.rb-lb-prog{display:flex;gap:4px;padding:12px 16px 8px}',
      '.rb-lb-seg{position:relative;flex:1;height:3px;background:rgba(255,255,255,.22);border-radius:2px;overflow:hidden;cursor:pointer}',
      '.rb-lb-seg:hover{background:rgba(255,255,255,.35)}',
      '.rb-lb-fill{position:absolute;inset:0;width:0;background:rgba(255,255,255,.9);border-radius:2px}',
      /* Lightbox main */
      '.rb-lb-main{flex:1;display:grid;grid-template-columns:2fr 1fr;gap:16px;padding:8px 16px 16px;min-height:0}',
      '.rb-lb-left{display:flex;flex-direction:column;gap:12px;min-height:0;min-width:0}',
      /* imgwrap: top-aligned so the main image hugs under the progress bars */
      '.rb-lb-imgwrap{position:relative;flex:1;background:#111;border-radius:12px;overflow:hidden;display:flex;align-items:flex-start;justify-content:center;min-height:0}',
      '.rb-lb-img{max-width:100%;max-height:100%;width:auto;height:auto;object-fit:contain;display:block}',
      /* Caption: glassy overlay matching side panel aesthetic */
      '.rb-lb-cap{position:absolute;left:12px;bottom:12px;max-width:calc(100% - 24px);font-size:13px;color:#fff;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:8px 12px;backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);pointer-events:none;line-height:1.4}',
      '.rb-lb-cap:empty{display:none}',
      /* Extras thumbnail strip (decorative) - taller now */
      '.rb-lb-extras{display:none;flex-direction:row;gap:10px;flex:0 0 auto;height:180px}',
      '.rb-lb-extra{flex:1;border-radius:8px;overflow:hidden;background:#111;display:flex;align-items:center;justify-content:center}',
      '.rb-lb-extra img{width:100%;height:100%;object-fit:cover;display:block;pointer-events:none}',
      /* Click halves */
      '.rb-lb-nav-left,.rb-lb-nav-right{position:absolute;top:0;bottom:0;width:50%;cursor:pointer;z-index:2;display:flex;align-items:center}',
      '.rb-lb-nav-left{left:0;justify-content:flex-start;padding-left:12px}',
      '.rb-lb-nav-right{right:0;justify-content:flex-end;padding-right:12px}',
      /* Persistent arrow indicators */
      '.rb-lb-arrow{display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:50%;background:rgba(0,0,0,0.45);color:#fff;opacity:0.55;transition:opacity .15s ease, background .15s ease, transform .15s ease;pointer-events:none}',
      '.rb-lb-nav-left:hover .rb-lb-arrow,.rb-lb-nav-right:hover .rb-lb-arrow{opacity:1;background:rgba(0,0,0,0.7);transform:scale(1.05)}',
      /* Side panel */
      '.rb-lb-side{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:12px;padding:20px;overflow:auto;display:flex;flex-direction:column;gap:10px}',
      '.rb-lb-lbl{font-size:12px;letter-spacing:.12em;text-transform:uppercase;color:#aaa}',
      '.rb-lb-title{font-size:22px;font-weight:600;line-height:1.2}',
      '.rb-lb-text{font-size:14px;line-height:1.55;color:#ccc;white-space:pre-wrap}',
      /* Close */
      '.rb-lb-close{position:absolute;top:10px;right:10px;width:36px;height:36px;border:0;border-radius:50%;background:rgba(255,255,255,.12);color:#fff;display:grid;place-items:center;cursor:pointer;transition:background .15s ease;z-index:3}',
      '.rb-lb-close:hover{background:rgba(255,255,255,.22)}',
      /* Mobile */
      '@media (max-width: 720px){',
      '  .rb-lb-main{grid-template-columns:1fr;grid-template-rows:1fr auto}',
      '  .rb-lb-inner{margin-top:2vh;height:96vh;width:96vw}',
      '  .rb-lb-arrow{width:36px;height:36px}',
      '  .rb-lb-extras{height:110px;gap:6px}',
      '}'
    ].join('\n');
    var tag = document.createElement('style');
    tag.id = 'rb-carousel-styles';
    tag.textContent = css;
    document.head.appendChild(tag);
  }
})();
