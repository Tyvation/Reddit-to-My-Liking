(() => {
  'use strict';

  const IDS = {
    root: 'rip-root',
    toggle: 'rip-toggle',
    sidebar: 'right-sidebar-container',
    panel: 'rip-panel',
    content: 'rip-content',
    title: 'rip-title',
    status: 'rip-status'
  };

  const DEFAULTS = {
    intercept: true,
    fullWidthPercent: 100,
    compactWidthPercent: 60
  };

  let settings = { ...DEFAULTS };
  let activeUrl = '';
  let activeSort = 'best';
  let abortController = null;
  let avatarObserver = null;
  let panelRoot = null;
  let resizeFrame = 0;
  const avatarCache = new Map();

  const postPathPattern = /^\/r\/[^/]+\/comments\/[a-z0-9]+(?:\/[^/?#]*)?/i;

  function isSupportedPage() {
    return location.hostname.toLowerCase() === 'www.reddit.com'
      && (location.pathname === '/'
        || /^\/search\/?$/i.test(location.pathname)
        || /^\/r\/[^/]+(?:\/search)?\/?$/i.test(location.pathname));
  }

  function normalizePostUrl(href) {
    try {
      const url = new URL(href, location.origin);
      if (!/^(www\.)?reddit\.com$/i.test(url.hostname)) return null;
      if (!postPathPattern.test(url.pathname)) return null;
      url.hostname = 'www.reddit.com';
      url.search = '';
      url.hash = '';
      return url.toString().replace(/\/?$/, '/');
    } catch {
      return null;
    }
  }

  function escapeHtml(value = '') {
    return String(value).replace(/[&<>"']/g, ch => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;'
    })[ch]);
  }

  function decodeEntities(value = '') {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = value;
    return textarea.value;
  }

  function sanitizeHtml(encodedHtml = '') {
    const decoded = decodeEntities(encodedHtml);
    const template = document.createElement('template');
    template.innerHTML = decoded;

    template.content.querySelectorAll('script, style, iframe, object, embed, form').forEach(el => el.remove());
    template.content.querySelectorAll('*').forEach(el => {
      [...el.attributes].forEach(attr => {
        const name = attr.name.toLowerCase();
        const value = attr.value.trim().toLowerCase();
        if (name.startsWith('on')) el.removeAttribute(attr.name);
        if ((name === 'href' || name === 'src') && value.startsWith('javascript:')) {
          el.removeAttribute(attr.name);
        }
      });
      if (el.tagName === 'A') {
        el.setAttribute('target', '_blank');
        el.setAttribute('rel', 'noopener noreferrer');
      }
      if (el.tagName === 'IMG') {
        el.setAttribute('loading', 'lazy');
        el.setAttribute('alt', el.getAttribute('alt') || 'Reddit image');
        if (!el.closest('a') && el.getAttribute('src')) {
          const link = document.createElement('a');
          link.href = el.getAttribute('src');
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          el.replaceWith(link);
          link.appendChild(el);
        }
      }
      if (el.tagName === 'VIDEO') {
        el.controls = true;
        el.playsInline = true;
        el.preload = 'metadata';
        el.removeAttribute('autoplay');
      }
    });
    template.content.querySelectorAll('a[href]').forEach(link => {
      if (link.querySelector('img, video')) return;
      const media = inlineMediaItem(link.href);
      if (media?.type === 'image') {
        const image = document.createElement('img');
        image.src = media.url;
        image.alt = link.textContent.trim() || 'Reddit image';
        image.loading = 'lazy';
        link.replaceChildren(image);
      } else if (media?.type === 'video') {
        const video = document.createElement('video');
        video.src = media.url;
        video.controls = true;
        video.playsInline = true;
        video.preload = 'metadata';
        link.replaceWith(video);
      } else if (media?.type === 'iframe') {
        const frame = document.createElement('iframe');
        frame.src = media.url;
        frame.title = 'Reddit comment video';
        frame.loading = 'lazy';
        frame.allow = 'autoplay; fullscreen; picture-in-picture';
        frame.allowFullscreen = true;
        link.replaceWith(frame);
      }
    });
    return template.innerHTML;
  }

  function mediaType(url = '') {
    if (/\.(mp4|webm|mov)(?:\?|$)/i.test(url)) return 'video';
    if (/\.(png|jpe?g|gif|webp)(?:\?|$)/i.test(url)) return 'image';
    return '';
  }

  function inlineMediaItem(url = '') {
    const type = mediaType(url);
    if (type) return { url, type };
    try {
      const parsed = new URL(url);
      if (/(^|\.)reddit\.com$/i.test(parsed.hostname)
        && /^\/link\/[^/]+\/video\/[^/]+\/player\/?$/i.test(parsed.pathname)) {
        parsed.hostname = 'www.reddit.com';
        return { url: parsed.toString(), type: 'iframe' };
      }
      if (!/(^|\.)giphy\.com$/i.test(parsed.hostname) || !parsed.pathname.startsWith('/gifs/')) return null;
      const slug = parsed.pathname.split('/').filter(Boolean).pop();
      const id = slug.match(/-([a-z0-9]+)$/i)?.[1] || slug;
      return { url: `https://media.giphy.com/media/${id}/giphy.gif`, type: 'image' };
    } catch {
      return null;
    }
  }

  function postMediaItems(data) {
    const items = [];
    const add = (url, type = mediaType(url)) => {
      if (type && /^https?:\/\//i.test(url || '') && !items.some(item => item.url === url)) items.push({ url, type });
    };

    const gallery = data.gallery_data?.items || [];
    for (const item of gallery) {
      const source = data.media_metadata?.[item.media_id]?.s || {};
      if (source.mp4) add(source.mp4, 'video');
      else add(source.u || source.gif, 'image');
    }
    if (items.length) return items;

    const redditVideo = data.secure_media?.reddit_video || data.media?.reddit_video
      || data.preview?.reddit_video_preview;
    if (redditVideo?.fallback_url) add(redditVideo.fallback_url, 'video');
    add(data.url_overridden_by_dest);
    add(data.preview?.images?.[0]?.source?.url, 'image');
    if (!items.length) add(data.thumbnail, 'image');
    return items.slice(0, 1);
  }

  function formatNumber(n) {
    return new Intl.NumberFormat(undefined, { notation: n >= 10000 ? 'compact' : 'standard' }).format(n || 0);
  }

  function timeAgo(epochSeconds) {
    if (!epochSeconds) return '';
    const seconds = Math.max(1, Math.floor(Date.now() / 1000 - epochSeconds));
    const units = [
      ['year', 31536000], ['month', 2592000], ['day', 86400],
      ['hour', 3600], ['minute', 60], ['second', 1]
    ];
    for (const [unit, size] of units) {
      if (seconds >= size) {
        const value = Math.floor(seconds / size);
        return new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' }).format(-value, unit);
      }
    }
    return 'now';
  }

  function avatarUrl(author = '') {
    let hash = 0;
    for (const char of author) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
    return `https://www.redditstatic.com/avatars/defaults/v2/avatar_default_${hash % 7}.png`;
  }

  function commentUrl(permalink, fallback) {
    try { return new URL(permalink || fallback, 'https://www.reddit.com').toString(); } catch { return fallback; }
  }

  function hydrateAvatars(container) {
    if (!('IntersectionObserver' in window)) return;
    avatarObserver?.disconnect();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        const author = entry.target.dataset.author;
        if (!author || author === '[deleted]') continue;
        if (!avatarCache.has(author)) {
          avatarCache.set(author, fetch(`/user/${encodeURIComponent(author)}/about.json?raw_json=1`, { credentials: 'include' })
            .then(response => response.ok ? response.json() : null)
            .then(payload => payload?.data?.icon_img || '')
            .catch(() => ''));
        }
        avatarCache.get(author).then(url => {
          if (/^https?:\/\//i.test(url)) entry.target.src = url;
        });
      }
    }, { root: container, rootMargin: '200px' });
    avatarObserver = observer;
    container.querySelectorAll('.rip-avatar[data-author]').forEach(avatar => avatarObserver.observe(avatar));
  }

  async function loadSettings() {
    try {
      settings = { ...DEFAULTS, ...(await chrome.storage.local.get(DEFAULTS)) };
    } catch {
      settings = { ...DEFAULTS };
    }
  }

  function leftRailWidth() {
    let leftRail = 0;
    document.querySelectorAll('#left-sidebar-container, reddit-sidebar-nav, nav, aside').forEach(element => {
      const rect = element.getBoundingClientRect();
      if (rect.left <= 1 && rect.right < innerWidth * .35 && rect.height > innerHeight * .55) {
        leftRail = Math.max(leftRail, Math.ceil(rect.right));
      }
    });
    return leftRail;
  }

  function setLayoutMetrics(layout, layoutLeft, mainWidth, leftRail, viewportWidth = globalThis.innerWidth) {
    layout.style.setProperty('--rip-main-width', `${mainWidth}px`);
    layout.style.setProperty('--rip-layout-left', `${leftRail}px`);
    const shift = leftRail - layoutLeft;
    if (Number.isFinite(viewportWidth)) {
      const availableWidth = Math.max(0, viewportWidth - leftRail - mainWidth - 16);
      const fullPercent = Math.min(100, Math.max(50, Number(settings.fullWidthPercent) || 100));
      const compactPercent = Math.min(fullPercent, Math.max(30, Number(settings.compactWidthPercent) || 60));
      const paneWidth = Math.round(availableWidth * fullPercent / 100);
      const compactPaneWidth = Math.round(availableWidth * compactPercent / 100);
      layout.style.setProperty('--rip-pane-width', `${paneWidth}px`);
      layout.style.setProperty('--rip-compact-pane-width', `${compactPaneWidth}px`);
      layout.style.setProperty('--rip-compact-layout-shift', `${shift + availableWidth - compactPaneWidth}px`);
      layout.style.setProperty('--rip-layout-shift', `${shift + availableWidth - paneWidth}px`);
    } else {
      layout.style.setProperty('--rip-layout-shift', `${shift}px`);
    }
    return shift;
  }

  function primePageLayout(sidebar) {
    const layout = sidebar?.parentElement;
    const main = document.getElementById('main-content');
    if (!layout || !main) return false;
    layout.ripLayoutLeft = Math.ceil(layout.getBoundingClientRect().left);
    layout.ripMainWidth = Math.ceil(main.getBoundingClientRect().width);
    setLayoutMetrics(layout, layout.ripLayoutLeft, layout.ripMainWidth, leftRailWidth());
    return true;
  }

  function resizePageLayout() {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => {
      const sidebar = document.getElementById(IDS.sidebar);
      const layout = sidebar?.parentElement;
      if (!layout) return;
      if (layout.classList.contains('rip-layout-open')) {
        setLayoutMetrics(layout, layout.ripLayoutLeft, layout.ripMainWidth, leftRailWidth(), innerWidth);
      } else {
        primePageLayout(sidebar);
      }
    });
  }

  function layoutShift(layout, compact = layout.classList.contains('rip-layout-compact')) {
    const property = compact ? '--rip-compact-layout-shift' : '--rip-layout-shift';
    return Number.parseFloat(layout.style.getPropertyValue(property)) || 0;
  }

  function toggleCompact(root, button) {
    const sidebar = root.parentElement;
    const layout = sidebar.parentElement;
    const main = document.getElementById('main-content');
    layout.ripCompactAnimation?.cancel();
    layout.ripMainAnimation?.cancel();
    const current = layout.classList.contains('rip-layout-compact');
    const active = !current;
    const oldShift = layoutShift(layout, current);
    const newShift = layoutShift(layout, active);
    button.textContent = active ? 'Compact' : 'Full';
    button.setAttribute('aria-pressed', String(active));
    layout.classList.toggle('rip-layout-compact', active);
    if (!main?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }

    button.disabled = true;
    const panelAnimation = root.animate([
      { opacity: .72 },
      { opacity: 1 }
    ], { duration: 160, easing: 'ease-out' });
    const mainAnimation = main.animate([
      { translate: `${oldShift}px 0` },
      { translate: `${newShift}px 0` }
    ], { duration: 220, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
    layout.ripCompactAnimation = panelAnimation;
    layout.ripMainAnimation = mainAnimation;
    mainAnimation.finished.then(() => {
      if (layout.ripCompactAnimation !== panelAnimation) return;
      layout.ripCompactAnimation = null;
      layout.ripMainAnimation = null;
      panelAnimation.cancel();
      mainAnimation.cancel();
      button.disabled = false;
    }, () => {});
  }

  function expandPageLayout(sidebar) {
    const layout = sidebar.parentElement;
    const main = document.getElementById('main-content');
    if (!layout || !main) return;
    layout.ripMainAnimation?.cancel();
    layout.ripMainAnimation = null;
    layout.ripCompactAnimation?.cancel();
    layout.ripCompactAnimation = null;
    layout.ripPanelCloseAnimation?.cancel();
    layout.ripPanelCloseAnimation = null;
    if (layout.classList.contains('rip-layout-open')) return;
    if (!Number.isFinite(layout.ripLayoutLeft) && !primePageLayout(sidebar)) return;
    layout.classList.add('rip-layout-open');
    const shift = layoutShift(layout);
    document.documentElement.classList.add('rip-layout-active');
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) {
      const animation = main.animate([{ translate: '0 0' }, { translate: `${shift}px 0` }], {
        duration: 220,
        easing: 'cubic-bezier(.4, 0, .2, 1)'
      });
      layout.ripMainAnimation = animation;
      animation.finished.then(() => {
        if (layout.ripMainAnimation === animation) layout.ripMainAnimation = null;
      }, () => {});
      document.getElementById(IDS.root)?.animate([
        { transformOrigin: 'right center', transform: 'scaleX(0)' },
        { transformOrigin: 'right center', transform: 'scaleX(1)' }
      ], { duration: 220, easing: 'cubic-bezier(.4, 0, .2, 1)' });
    }
  }

  function createPanel() {
    const sidebar = document.getElementById(IDS.sidebar);
    const existingRoot = document.getElementById(IDS.root);
    if (!sidebar) return;
    if (existingRoot) {
      panelRoot = existingRoot;
      return;
    }

    const toggle = document.createElement('button');
    toggle.id = IDS.toggle;
    toggle.type = 'button';
    toggle.textContent = 'Open inline reader';
    toggle.addEventListener('click', openPanel);

    const root = document.createElement('aside');
    root.id = IDS.root;
    panelRoot = root;
    root.innerHTML = `
      <section id="${IDS.panel}" aria-label="Reddit inline post viewer">
        <header class="rip-header">
          <div class="rip-heading">
            <strong id="${IDS.title}">Comments View</strong>
            <span id="${IDS.status}"></span>
          </div>
          <button class="rip-compact-btn" data-action="compact" aria-pressed="false">Full</button>
          <a class="rip-icon-btn rip-open-native" href="#" target="_blank" rel="noopener" title="Open normally" aria-label="Open normally">↗</a>
          <button class="rip-icon-btn" data-action="close" title="Close" aria-label="Close">×</button>
        </header>
        <main id="${IDS.content}">
          <div class="rip-empty">
            <div class="rip-empty-icon">☰</div>
            <strong>Open posts without leaving the feed</strong>
            <p>Click a Reddit post title or comments link.</p>
          </div>
        </main>
      </section>
    `;
    sidebar.prepend(root);
    sidebar.prepend(toggle);

    root.querySelector('[data-action="close"]').addEventListener('click', closePanel);
    root.addEventListener('click', event => {
      const compact = event.target.closest('[data-action="compact"]');
      if (compact) {
        toggleCompact(root, compact);
        return;
      }

      const share = event.target.closest('[data-action="share"]');
      if (share) {
        const url = share.dataset.url;
        if (navigator.share) navigator.share({ url }).catch(() => {});
        else navigator.clipboard?.writeText(url).then(() => {
          const label = share.querySelector('.rip-action-label');
          if (!label) return;
          label.textContent = 'Copied';
          setTimeout(() => { label.textContent = 'Share'; }, 1200);
        }).catch(() => {});
        return;
      }

      const cancel = event.target.closest('[data-action="cancel-comment"]');
      if (cancel) {
        const textarea = cancel.closest('.rip-composer').querySelector('textarea');
        textarea.value = '';
        textarea.blur();
        cancel.blur();
        return;
      }

      const toggle = event.target.closest('[data-action="toggle-comment"]');
      if (toggle) {
        const comment = toggle.closest('.rip-comment');
        const collapsed = comment.classList.toggle('is-collapsed');
        toggle.setAttribute('aria-expanded', String(!collapsed));
        toggle.textContent = collapsed ? '+' : '−';
        toggle.title = collapsed ? 'Expand comment' : 'Collapse comment';
        return;
      }

      const carouselButton = event.target.closest('[data-carousel-step]');
      if (!carouselButton) return;
      const carousel = carouselButton.closest('.rip-carousel');
      const slides = [...carousel.querySelectorAll('.rip-carousel-slide')];
      const next = Math.max(0, Math.min(slides.length - 1,
        Number(carousel.dataset.index || 0) + Number(carouselButton.dataset.carouselStep)));
      carousel.dataset.index = String(next);
      slides.forEach((slide, index) => {
        slide.hidden = index !== next;
        slide.setAttribute('aria-hidden', String(index !== next));
        if (index !== next) slide.querySelector('video')?.pause();
      });
      carousel.querySelector('.rip-carousel-count').textContent = `${next + 1} / ${slides.length}`;
      carousel.querySelector('[data-carousel-step="-1"]').disabled = next === 0;
      carousel.querySelector('[data-carousel-step="1"]').disabled = next === slides.length - 1;
    });
    root.addEventListener('change', event => {
      if (event.target.matches('.rip-sort') && activeUrl) fetchPost(activeUrl, event.target.value);
    });
    root.addEventListener('input', event => {
      if (!event.target.matches('.rip-comment-search')) return;
      const query = event.target.value.trim().toLocaleLowerCase();
      root.querySelectorAll('.rip-comment').forEach(comment => {
        comment.hidden = Boolean(query) && !comment.textContent.toLocaleLowerCase().includes(query);
      });
    });
    requestAnimationFrame(() => primePageLayout(sidebar));
  }

  function openPanel() {
    createPanel();
    const root = document.getElementById(IDS.root);
    if (!root) return;
    root.classList.add('is-open');
    expandPageLayout(root.parentElement);
    root.parentElement.classList.add('rip-pane-open');
  }

  function closePanel() {
    const root = document.getElementById(IDS.root);
    const sidebar = root?.parentElement;
    const layout = sidebar?.parentElement;
    const main = document.getElementById('main-content');
    let panelAnimation = null;
    const finish = () => {
      if (layout) {
        layout.ripMainAnimation?.cancel();
        layout.ripCompactAnimation?.cancel();
        layout.ripMainAnimation = null;
        layout.ripCompactAnimation = null;
      }
      root?.classList.remove('is-open');
      const compactButton = root?.querySelector('[data-action="compact"]');
      if (compactButton) {
        compactButton.disabled = false;
        compactButton.textContent = 'Compact';
        compactButton.setAttribute('aria-pressed', 'false');
      }
      panelAnimation?.cancel();
      if (layout?.ripPanelCloseAnimation === panelAnimation) layout.ripPanelCloseAnimation = null;
      sidebar?.classList.remove('rip-pane-open');
      layout?.classList.remove('rip-layout-open', 'rip-layout-compact');
      document.documentElement.classList.remove('rip-layout-active');
    };
    if (layout && main?.animate && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
      layout.ripMainAnimation?.cancel();
      layout.ripCompactAnimation?.cancel();
      panelAnimation = root?.animate([
        { transformOrigin: 'right center', transform: 'scaleX(1)' },
        { transformOrigin: 'right center', transform: 'scaleX(0)' }
      ], { duration: 220, easing: 'cubic-bezier(.4, 0, .2, 1)', fill: 'forwards' });
      layout.ripPanelCloseAnimation = panelAnimation;
      const shift = layoutShift(layout);
      const animation = main.animate([
        { translate: `${shift}px 0` },
        { translate: '0 0' }
      ], { duration: 220, easing: 'cubic-bezier(.4, 0, .2, 1)' });
      layout.ripMainAnimation = animation;
      animation.finished.then(() => {
        if (layout.ripMainAnimation !== animation) return;
        layout.ripMainAnimation = null;
        finish();
      }, () => {});
    } else {
      finish();
    }
    abortController?.abort();
  }

  function setLoading(url) {
    const content = document.getElementById(IDS.content);
    const status = document.getElementById(IDS.status);
    const nativeLink = document.querySelector('.rip-open-native');
    if (status) status.textContent = 'Loading…';
    if (nativeLink) nativeLink.href = url;
    if (content) {
      content.innerHTML = `
        <div class="rip-loading">
          <span class="rip-spinner"></span>
          <span>Loading post and comments…</span>
        </div>`;
    }
  }

  function renderError(message, url) {
    const content = document.getElementById(IDS.content);
    const status = document.getElementById(IDS.status);
    if (status) status.textContent = 'Could not load';
    if (content) {
      content.innerHTML = `
        <div class="rip-error">
          <strong>Unable to load this post</strong>
          <p>${escapeHtml(message)}</p>
          <a href="${escapeHtml(url)}" target="_blank" rel="noopener">Open normally</a>
        </div>`;
    }
  }

  function zoomAroundPoint(scale, x, y, pointX, pointY, factor) {
    const nextScale = Math.min(8, Math.max(1, scale * factor));
    if (nextScale === 1) return { scale: 1, x: 0, y: 0 };
    const ratio = nextScale / scale;
    return {
      scale: nextScale,
      x: pointX - (pointX - x) * ratio,
      y: pointY - (pointY - y) * ratio
    };
  }

  function openImageViewer(src, alt = '', gallery = []) {
    const root = document.body;
    if (!root || !/^(https?:|blob:|data:image\/)/i.test(src)) return;
    document.querySelector('.rip-lightbox')?.remove();

    const items = gallery.length ? gallery : [{ src, alt }];
    let currentIndex = Math.max(0, items.findIndex(item => item.src === src));

    const lightbox = document.createElement('div');
    lightbox.className = 'rip-lightbox';
    lightbox.setAttribute('role', 'dialog');
    lightbox.setAttribute('aria-modal', 'true');
    lightbox.setAttribute('aria-label', 'Image viewer');
    const image = document.createElement('img');
    image.className = 'rip-lightbox-image';
    image.src = src;
    image.alt = alt || 'Reddit image';
    image.decoding = 'async';
    image.draggable = false;
    const backdrop = document.createElement('div');
    backdrop.className = 'rip-lightbox-backdrop';
    backdrop.style.backgroundImage = `url(${JSON.stringify(src)})`;
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'rip-lightbox-close';
    close.setAttribute('aria-label', 'Close image');
    close.textContent = '×';
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'rip-lightbox-nav rip-lightbox-prev';
    previous.setAttribute('aria-label', 'Previous image');
    previous.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16 4 8 12l8 8"/></svg>';
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'rip-lightbox-nav rip-lightbox-next';
    next.setAttribute('aria-label', 'Next image');
    next.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m8 4 8 8-8 8"/></svg>';
    const hint = document.createElement('div');
    hint.className = 'rip-lightbox-hint';
    lightbox.append(backdrop, image, close, hint);
    if (items.length > 1) lightbox.append(previous, next);

    let scale = 1;
    let x = 0;
    let y = 0;
    let dragging = false;
    let dragX = 0;
    let dragY = 0;
    let startX = 0;
    let startY = 0;
    let renderFrame = 0;
    let lastPercent = -1;
    let zoomed = false;

    const renderTransform = () => {
      if (renderFrame) return;
      renderFrame = requestAnimationFrame(() => {
        renderFrame = 0;
        image.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${scale})`;
        const nextZoomed = scale > 1;
        if (nextZoomed !== zoomed) {
          zoomed = nextZoomed;
          image.classList.toggle('is-zoomed', zoomed);
        }
        const percent = Math.round(scale * 100);
        if (percent !== lastPercent) {
          lastPercent = percent;
          const position = items.length > 1 ? `${currentIndex + 1}/${items.length} · ` : '';
          hint.textContent = `${position}${percent}% · Scroll to zoom · Drag to pan`;
        }
      });
    };

    const showImage = index => {
      currentIndex = Math.max(0, Math.min(items.length - 1, index));
      const item = items[currentIndex];
      image.src = item.src;
      image.alt = item.alt || 'Reddit image';
      backdrop.style.backgroundImage = `url(${JSON.stringify(item.src)})`;
      scale = 1;
      x = 0;
      y = 0;
      lastPercent = -1;
      zoomed = false;
      image.classList.remove('is-zoomed', 'is-dragging');
      previous.disabled = currentIndex === 0;
      next.disabled = currentIndex === items.length - 1;
      renderTransform();
    };

    lightbox.addEventListener('wheel', event => {
      event.preventDefault();
      event.stopPropagation();
      const pointX = event.clientX - innerWidth / 2;
      const pointY = event.clientY - innerHeight / 2;
      ({ scale, x, y } = zoomAroundPoint(
        scale, x, y, pointX, pointY, Math.exp(-event.deltaY * 0.0015)
      ));
      renderTransform();
    }, { passive: false });

    image.addEventListener('pointerdown', event => {
      if (event.button !== 0 || scale === 1) return;
      event.preventDefault();
      dragging = true;
      dragX = event.clientX;
      dragY = event.clientY;
      startX = x;
      startY = y;
      image.setPointerCapture(event.pointerId);
      image.classList.add('is-dragging');
    });
    image.addEventListener('pointermove', event => {
      if (!dragging) return;
      x = startX + event.clientX - dragX;
      y = startY + event.clientY - dragY;
      renderTransform();
    });
    const stopDragging = event => {
      if (!dragging) return;
      dragging = false;
      image.releasePointerCapture?.(event.pointerId);
      image.classList.remove('is-dragging');
    };
    image.addEventListener('pointerup', stopDragging);
    image.addEventListener('pointercancel', stopDragging);

    const dismiss = () => {
      cancelAnimationFrame(renderFrame);
      document.removeEventListener('keydown', onKeyDown);
      lightbox.remove();
    };
    const onKeyDown = event => {
      if (event.key === 'Escape') dismiss();
      else if (event.key === 'ArrowLeft' && currentIndex > 0) {
        event.preventDefault();
        showImage(currentIndex - 1);
      } else if (event.key === 'ArrowRight' && currentIndex < items.length - 1) {
        event.preventDefault();
        showImage(currentIndex + 1);
      }
    };
    close.addEventListener('click', dismiss);
    previous.addEventListener('click', event => {
      event.stopPropagation();
      showImage(currentIndex - 1);
    });
    next.addEventListener('click', event => {
      event.stopPropagation();
      showImage(currentIndex + 1);
    });
    lightbox.addEventListener('click', event => { if (event.target === lightbox) dismiss(); });
    document.addEventListener('keydown', onKeyDown);
    root.appendChild(lightbox);
    showImage(currentIndex);
    close.focus();
  }

  function imageFromEvent(event, main) {
    const path = event.composedPath();
    const image = path.find(node => node?.tagName === 'IMG');
    if (!image || !path.includes(main)) return null;
    if (path.some(node => node?.matches?.('faceplate-avatar, [class*="avatar"], [data-testid*="avatar"]'))) return null;
    const rect = image.getBoundingClientRect();
    return rect.width * rect.height >= 4096 ? image : null;
  }

  function imageViewerItems(image, main) {
    const carousel = image.closest('faceplate-carousel');
    const scope = carousel || image.closest('shreddit-post, shreddit-comment, article, [data-testid="post-container"]') || main;
    const items = [];
    const seen = new Set();
    for (const candidate of [image, ...scope.querySelectorAll('img')]) {
      if (candidate.closest('faceplate-avatar, [class*="avatar"], [data-testid*="avatar"]')) continue;
      const candidateSrc = candidate.currentSrc || candidate.src;
      if (!candidateSrc || seen.has(candidateSrc) || !/^(https?:|blob:|data:image\/)/i.test(candidateSrc)) continue;
      const pixels = Math.max(candidate.naturalWidth * candidate.naturalHeight, candidate.width * candidate.height);
      if (candidate !== image && !carousel && pixels < 4096) continue;
      seen.add(candidateSrc);
      items.push({ src: candidateSrc, alt: candidate.alt || 'Reddit image' });
    }
    return items;
  }

  function captureWebviewImages(frame, main) {
    const frameWindow = frame.contentWindow;
    const frameDocument = frame.contentDocument;
    if (!frameWindow || !frameDocument || frame.ripImageCaptureDocument === frameDocument) return;
    frame.ripImageCaptureDocument = frameDocument;
    frameWindow.addEventListener('click', event => {
      const image = imageFromEvent(event, main);
      if (!image) return;
      const src = image.currentSrc || image.src;
      if (!src) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openImageViewer(src, image.alt || '', imageViewerItems(image, main));
    }, true);
  }

  function isolateMainTree(doc, main) {
    let node = main;
    while (node && node !== doc.body) {
      const parent = node.parentElement;
      if (!parent) break;
      for (const sibling of parent.children) {
        if (sibling !== node) sibling.style.setProperty('display', 'none', 'important');
      }
      if (node !== main) node.style.setProperty('display', 'contents', 'important');
      node = parent;
    }
  }

  function isolateMainContent(frame) {
    try {
      const doc = frame.contentDocument;
      if (!doc?.documentElement) return;

      const apply = () => {
        const main = doc.getElementById('main-content');
        if (!main) return false;
        isolateMainTree(doc, main);
        if (!doc.getElementById('rip-webview-style')) {
          const style = doc.createElement('style');
          style.id = 'rip-webview-style';
          style.textContent = `
            html, body { margin: 0 !important; min-width: 0 !important; background: var(--color-neutral-background, #0b1416) !important; overscroll-behavior: contain !important; }
            #main-content { display: block !important; width: 100% !important; max-width: none !important; margin: 0 !important; padding: 0 12px 48px !important; box-sizing: border-box !important; overscroll-behavior: contain !important; }
            #main-content #sticky-comment-composer-wrapper { position: static !important; inset: auto !important; }
          `;
          (doc.head || doc.documentElement).appendChild(style);
        }
        captureWebviewImages(frame, main);
        frame.classList.add('is-ready');
        document.getElementById(IDS.content)?.classList.add('webview-ready');
        const status = document.getElementById(IDS.status);
        if (status) status.textContent = 'Native Reddit view';
        return true;
      };

      if (apply()) return;
      const observer = new MutationObserver(() => {
        if (apply()) observer.disconnect();
      });
      observer.observe(doc.documentElement, { childList: true, subtree: true });
      setTimeout(() => observer.disconnect(), 15000);
    } catch {
      const status = document.getElementById(IDS.status);
      if (status) status.textContent = 'Open original to continue';
    }
  }

  function openWebview(url) {
    openPanel();
    activeUrl = url;
    abortController?.abort();

    const content = document.getElementById(IDS.content);
    const status = document.getElementById(IDS.status);
    const title = document.getElementById(IDS.title);
    const nativeLink = document.querySelector('.rip-open-native');
    if (!content) return;
    if (status) status.textContent = 'Loading native Reddit…';
    if (title) title.textContent = 'Comments View';
    if (nativeLink) nativeLink.href = url;

    const frame = document.createElement('iframe');
    frame.className = 'rip-webview';
    frame.title = 'Reddit post and comments';
    frame.allow = 'autoplay; clipboard-write; fullscreen; picture-in-picture';
    frame.addEventListener('load', () => {
      frame.ripImageCaptureDocument = null;
      isolateMainContent(frame);
    });
    content.classList.add('has-webview');
    content.classList.remove('webview-ready');
    content.replaceChildren(frame);
    frame.src = url;
  }

  function renderMediaItem(item, title) {
    if (item.type === 'video') {
      return `<video class="rip-media" src="${escapeHtml(item.url)}" controls playsinline preload="metadata"></video>`;
    }
    return `<a class="rip-media-link" href="${escapeHtml(item.url)}" target="_blank" rel="noopener noreferrer">
      <img class="rip-media" src="${escapeHtml(item.url)}" alt="${escapeHtml(title || 'Reddit image')}" loading="lazy">
    </a>`;
  }

  function renderPostMedia(data) {
    const items = postMediaItems(data);
    if (!items.length) return '';
    if (items.length === 1) return renderMediaItem(items[0], data.title);

    return `<div class="faceplate-carousel rip-carousel" data-index="0" role="region" aria-label="Post media carousel">
      ${items.map((item, index) => `<div class="rip-carousel-slide" aria-hidden="${index !== 0}" ${index ? 'hidden' : ''}>
        ${renderMediaItem(item, data.title)}
      </div>`).join('')}
      <button class="rip-carousel-button rip-carousel-prev" data-carousel-step="-1" aria-label="Previous media" disabled>‹</button>
      <button class="rip-carousel-button rip-carousel-next" data-carousel-step="1" aria-label="Next media">›</button>
      <span class="rip-carousel-count">1 / ${items.length}</span>
    </div>`;
  }

  function renderCommentMedia(data) {
    const items = [];
    const add = (url, type = mediaType(url)) => {
      if (type && /^https?:\/\//i.test(url || '') && !items.some(item => item.url === url)
        && !String(data.body_html || '').includes(url)) items.push({ url, type });
    };
    for (const metadata of Object.values(data.media_metadata || {})) {
      const source = metadata?.s || {};
      if (source.mp4) add(source.mp4, 'video');
      else add(source.gif || source.u, 'image');
    }
    const redditVideo = data.secure_media?.reddit_video || data.media?.reddit_video;
    if (redditVideo?.fallback_url) add(redditVideo.fallback_url, 'video');
    if (!items.length) return '';
    return `<div class="rip-comment-media">${items.map(item => renderMediaItem(item, 'Comment media')).join('')}</div>`;
  }

  function renderPost(post, comments, url) {
    const data = post?.data || {};
    const content = document.getElementById(IDS.content);
    const title = document.getElementById(IDS.title);
    const status = document.getElementById(IDS.status);

    title.textContent = 'Comments View';
    status.textContent = `${data.subreddit_name_prefixed || ''} · ${formatNumber(data.num_comments)} comments`;

    const media = renderPostMedia(data);

    const body = data.selftext_html
      ? `<div class="rip-richtext">${sanitizeHtml(data.selftext_html)}</div>`
      : '';
    const sortOptions = ['best', 'top', 'new', 'controversial', 'old', 'qa']
      .map(value => `<option value="${value}" ${value === activeSort ? 'selected' : ''}>${value === 'qa' ? 'Q&A' : value[0].toUpperCase() + value.slice(1)}</option>`)
      .join('');

    content.innerHTML = `
      <article class="rip-post">
        <div class="rip-meta">
          <span>${escapeHtml(data.subreddit_name_prefixed || '')}</span>
          <span>u/${escapeHtml(data.author || '[deleted]')}</span>
          <span>${escapeHtml(timeAgo(data.created_utc))}</span>
        </div>
        <h1>${escapeHtml(data.title || '')}</h1>
        ${media}
        ${body}
        <div class="rip-post-actions">
          <span class="rip-action-pill rip-vote-pill">
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener" aria-label="Open Reddit to upvote">↑</a>
            <strong>${formatNumber(data.score)}</strong>
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener" aria-label="Open Reddit to downvote">↓</a>
          </span>
          <a class="rip-action-pill" href="${escapeHtml(url)}" target="_blank" rel="noopener">◯ ${formatNumber(data.num_comments)}</a>
          <button class="rip-action-pill" data-action="share" data-url="${escapeHtml(url)}">↗ <span class="rip-action-label">Share</span></button>
        </div>
      </article>
      <section class="rip-comments">
        <div class="rip-composer">
          <textarea rows="1" placeholder="Join the conversation" aria-label="Join the conversation"></textarea>
          <div class="rip-composer-actions">
            <button type="button" data-action="cancel-comment">Cancel</button>
            <a href="${escapeHtml(url)}" target="_blank" rel="noopener" title="Open Reddit to comment">Comment</a>
          </div>
        </div>
        <div class="rip-comments-toolbar">
          <label>Sort by: <select class="rip-sort" aria-label="Sort comments">${sortOptions}</select></label>
          <label class="rip-search">⌕ <input class="rip-comment-search" type="search" placeholder="Search Comments" aria-label="Search comments"></label>
        </div>
        ${renderComments(comments, 0, url)}
      </section>`;

    hydrateAvatars(content);
    content.scrollTop = 0;
  }

  function renderComments(children, depth = 0, postUrl = activeUrl) {
    if (!Array.isArray(children) || !children.length) {
      return depth === 0 ? '<div class="rip-no-comments">No comments to display.</div>' : '';
    }

    return children.map(node => {
      if (!node || node.kind !== 't1') return '';
      const c = node.data || {};
      const replies = c.replies?.data?.children || [];
      const body = c.body_html
        ? sanitizeHtml(c.body_html)
        : `<p>${escapeHtml(c.body || '[deleted]')}</p>`;
      const media = renderCommentMedia(c);
      const permalink = commentUrl(c.permalink, postUrl);

      return `
        <article class="rip-comment">
          <button class="rip-comment-toggle" data-action="toggle-comment" aria-expanded="true" title="Collapse comment">−</button>
          <img class="rip-avatar" src="${escapeHtml(avatarUrl(c.author || 'deleted'))}" data-author="${escapeHtml(c.author || '[deleted]')}" alt="" loading="lazy">
          <div class="rip-comment-meta">
            <strong>${escapeHtml(c.author || '[deleted]')}</strong>
            <span>${escapeHtml(timeAgo(c.created_utc))}</span>
          </div>
          <div class="rip-comment-content">
            <div class="rip-richtext">${body}</div>
            ${media}
            <div class="rip-comment-actions">
              <a href="${escapeHtml(permalink)}" target="_blank" rel="noopener" aria-label="Open Reddit to upvote">↑</a>
              <span>${formatNumber(c.score)}</span>
              <a href="${escapeHtml(permalink)}" target="_blank" rel="noopener" aria-label="Open Reddit to downvote">↓</a>
              <a href="${escapeHtml(permalink)}" target="_blank" rel="noopener">◯ Reply</a>
              <button data-action="share" data-url="${escapeHtml(permalink)}">↗ <span class="rip-action-label">Share</span></button>
            </div>
            ${replies.length ? `<div class="rip-replies">${renderComments(replies, depth + 1, postUrl)}</div>` : ''}
          </div>
        </article>`;
    }).join('');
  }

  async function fetchPost(url, sort = 'best') {
    openPanel();
    activeUrl = url;
    activeSort = sort;
    setLoading(url);

    abortController?.abort();
    abortController = new AbortController();

    try {
      const jsonUrl = `${url.replace(/\/$/, '')}.json?raw_json=1&limit=200&depth=10&sort=${encodeURIComponent(sort)}`;
      const response = await fetch(jsonUrl, {
        credentials: 'include',
        headers: { 'Accept': 'application/json' },
        signal: abortController.signal
      });

      if (!response.ok) throw new Error(`Reddit returned HTTP ${response.status}.`);
      const payload = await response.json();
      if (!Array.isArray(payload) || !payload[0]?.data?.children?.[0]) {
        throw new Error('Unexpected Reddit response.');
      }
      if (activeUrl !== url) return;

      const post = payload[0].data.children[0];
      const comments = payload[1]?.data?.children || [];
      renderPost(post, comments, url);
    } catch (error) {
      if (error.name === 'AbortError') return;
      renderError(error.message || 'Unknown error', url);
    }
  }

  function shouldIntercept(event, anchor) {
    if (!isSupportedPage() || !settings.intercept) return false;
    if (event.defaultPrevented || event.button !== 0) return false;
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return false;
    if (anchor.target === '_blank' || anchor.hasAttribute('download')) return false;
    if (document.getElementById(IDS.root)?.contains(anchor)) return false;
    return true;
  }

  function clickHandler(event) {
    const main = document.getElementById('main-content');
    const image = main && imageFromEvent(event, main);
    if (image && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      const src = image.currentSrc || image.src;
      if (src) {
        event.preventDefault();
        event.stopImmediatePropagation();
        openImageViewer(src, image.alt || '', imageViewerItems(image, main));
        return;
      }
    }

    const anchor = event.target.closest('a[href]');
    if (!anchor || !shouldIntercept(event, anchor)) return;

    const postUrl = normalizePostUrl(anchor.href);
    if (!postUrl) return;

    event.preventDefault();
    event.stopPropagation();
    openWebview(postUrl);
  }

  function syncPage() {
    if (isSupportedPage()) {
      createPanel();
      return;
    }
    closePanel();
    document.getElementById(IDS.toggle)?.remove();
    document.getElementById(IDS.root)?.remove();
    panelRoot = null;
  }

  function observePage() {
    let observedUrl = location.href;
    const observer = new MutationObserver(() => {
      if (location.href === observedUrl && panelRoot?.isConnected) return;
      observedUrl = location.href;
      syncPage();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    addEventListener('popstate', () => {
      observedUrl = location.href;
      syncPage();
    });
  }

  function init() {
    document.addEventListener('click', clickHandler, true);
    addEventListener('resize', resizePageLayout, { passive: true });
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      for (const key of ['fullWidthPercent', 'compactWidthPercent']) {
        if (changes[key]) settings[key] = changes[key].newValue;
      }
      resizePageLayout();
    });
    observePage();
    syncPage();
    loadSettings().then(resizePageLayout);
  }

  init();
})();
