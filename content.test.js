const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const styles = fs.readFileSync('styles.css', 'utf8');
const manifest = require('./manifest.json');

const source = fs.readFileSync('content.js', 'utf8').replace(
  /\n\s*init\(\);\s*\n\}\)\(\);\s*$/,
  '\n  globalThis.__rip = { isSupportedPage, postMediaItems, inlineMediaItem, renderPostMedia, renderComments, zoomAroundPoint, isolateMainTree, setLayoutMetrics };\n})();'
);
assert.match(source, /function openWebview\(url\)/);
assert.match(source, /openWebview\(postUrl\)/);
assert.match(source, /getElementById\('main-content'\)/);
assert.match(source, /function captureWebviewImages\(frame, main\)/);
assert.match(source, /function imageFromEvent\(event, main\)/);
assert.match(source, /function isolateMainTree\(doc, main\)/);
assert.doesNotMatch(source, /:has\(#main-content\)/);
assert.match(source, /overscroll-behavior: contain !important/);
assert.doesNotMatch(source, /ripPointerInside/);
assert.doesNotMatch(source, /frameWindow\.addEventListener\('wheel'/);
assert.doesNotMatch(source, /document\.addEventListener\('pointermove'/);
assert.match(source, /main\.animate\(/);
assert.match(source, /function refreshPageLayout\(sidebar\)/);
const syncPageSource = source.slice(
  source.indexOf('function syncPage'),
  source.indexOf('function observePage')
);
assert.doesNotMatch(syncPageSource, /refreshPageLayout/);
const observePageSource = source.slice(
  source.indexOf('function observePage'),
  source.indexOf('function init')
);
assert.match(observePageSource, /location\.href === observedUrl && panelRoot\?\.isConnected/);
assert.doesNotMatch(observePageSource, /new MutationObserver\(syncPage\)/);
assert.match(source, />Comments View<\/strong>/);
assert.match(source, /data-action="compact"/);
assert.match(source, /event\.composedPath\(\)/);
assert.match(source, /function openImageViewer\(src, alt = '', gallery = \[\]\)/);
assert.match(source, /function imageViewerItems\(image, main\)/);
const imageViewerSource = source.slice(
  source.indexOf('function openImageViewer'),
  source.indexOf('function imageFromEvent')
);
assert.match(imageViewerSource, /createElement\('img'\)/);
assert.match(imageViewerSource, /image\.decoding = 'async'/);
assert.match(imageViewerSource, /image\.draggable = false/);
assert.doesNotMatch(imageViewerSource, /getBoundingClientRect\(\)/);
assert.match(imageViewerSource, /rip-lightbox-backdrop/);
assert.match(imageViewerSource, /event\.preventDefault\(\)/);
assert.match(imageViewerSource, /passive: false/);
assert.match(imageViewerSource, /requestAnimationFrame\(/);
assert.match(imageViewerSource, /Previous image/);
assert.match(imageViewerSource, /Next image/);
assert.match(imageViewerSource, /ArrowLeft/);
assert.match(imageViewerSource, /ArrowRight/);
assert.match(styles, /filter: blur\(/);
assert.match(styles, /\.rip-lightbox-nav[^{]*\{[^}]*border-radius:\s*50%/s);
assert.match(source, /viewBox="0 0 24 24"/);
assert.match(styles, /\.rip-lightbox-nav svg[^{]*\{[^}]*width:\s*22px[^}]*height:\s*22px/s);
assert.doesNotMatch(styles, /backdrop-filter/);
assert.match(styles, /\.rip-header[^{]*\{[^}]*padding:\s*2px 8px !important/s);
assert.match(styles, /\.rip-layout-open > #right-sidebar-container\.rip-pane-open[^{]*\{[^}]*overflow:\s*clip !important/s);
assert.match(styles, /#rip-root[^{]*\{[^}]*overflow:\s*clip/s);
assert.match(styles, /#rip-content[^{]*\{[^}]*overflow:\s*clip/s);
assert.match(styles, /#rip-content\.has-webview[^{]*\{[^}]*overflow:\s*clip/s);
assert.doesNotMatch(styles, /\.rip-layout-open\s*\{[^}]*display:\s*grid/s);
assert.match(styles, /\.rip-layout-open > #main-content[^{]*\{[^}]*width:\s*var\(--rip-main-width/s);
assert.doesNotMatch(styles, /transition:\s*transform/);
assert.match(styles, /\.rip-webview:not\(\.is-ready\)[^{]*\{[^}]*pointer-events:\s*none/s);
assert.equal(manifest.content_scripts[0].run_at, 'document_start');
const context = { location: { hostname: 'www.reddit.com', pathname: '/' }, URL };
vm.createContext(context);
vm.runInContext(source, context);

assert.deepEqual(
  JSON.parse(JSON.stringify(context.__rip.zoomAroundPoint(1, 0, 0, 100, 50, 2))),
  { scale: 2, x: -100, y: -50 }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.__rip.zoomAroundPoint(2, -100, -50, 100, 50, 0.5))),
  { scale: 1, x: 0, y: 0 }
);

const fakeNode = parent => ({
  parentElement: parent,
  children: [],
  style: { setProperty(name, value) { this[name] = value; } }
});
const body = fakeNode(null);
const wrapper = fakeNode(body);
const outside = fakeNode(body);
const main = fakeNode(wrapper);
const sibling = fakeNode(wrapper);
body.children = [wrapper, outside];
wrapper.children = [main, sibling];
context.__rip.isolateMainTree({ body }, main);
assert.equal(sibling.style.display, 'none');
assert.equal(outside.style.display, 'none');
assert.equal(wrapper.style.display, 'contents');
assert.equal(main.style.display, undefined);

const layoutStyle = { values: {}, setProperty(name, value) { this.values[name] = value; } };
assert.equal(context.__rip.setLayoutMetrics({ style: layoutStyle }, 320, 720, 0), -320);
assert.equal(layoutStyle.values['--rip-layout-left'], '0px');
assert.equal(context.__rip.setLayoutMetrics({ style: layoutStyle }, 320, 720, 240), -80);
assert.equal(layoutStyle.values['--rip-layout-left'], '240px');
assert.equal(layoutStyle.values['--rip-layout-shift'], '-80px');
context.__rip.setLayoutMetrics({ style: layoutStyle }, 320, 720, 240, 1600);
assert.equal(layoutStyle.values['--rip-compact-pane-width'], '374px');
assert.equal(layoutStyle.values['--rip-compact-layout-shift'], '170px');
assert.equal(context.__rip.isSupportedPage(), true);
context.location.pathname = '/r/webdev/';
assert.equal(context.__rip.isSupportedPage(), true);
context.location.pathname = '/search/';
assert.equal(context.__rip.isSupportedPage(), true);
context.location.pathname = '/r/webdev/search/';
assert.equal(context.__rip.isSupportedPage(), true);
context.location.pathname = '/r/webdev/comments/abc123/post/';
assert.equal(context.__rip.isSupportedPage(), false);
context.location = { hostname: 'reddit.com', pathname: '/' };
assert.equal(context.__rip.isSupportedPage(), false);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.__rip.inlineMediaItem('https://giphy.com/gifs/reddit-test-AbC123'))),
  { url: 'https://media.giphy.com/media/AbC123/giphy.gif', type: 'image' }
);
assert.deepEqual(
  JSON.parse(JSON.stringify(context.__rip.inlineMediaItem('https://reddit.com/link/owcleen/video/1g7jzy4k42ch1/player'))),
  { url: 'https://www.reddit.com/link/owcleen/video/1g7jzy4k42ch1/player', type: 'iframe' }
);

assert.deepEqual(
  JSON.parse(JSON.stringify(context.__rip.postMediaItems({
    gallery_data: { items: [{ media_id: 'image' }, { media_id: 'video' }] },
    media_metadata: {
      image: { s: { u: 'https://i.redd.it/image.jpg' } },
      video: { s: { mp4: 'https://i.redd.it/video.mp4' } }
    }
  }))),
  [
    { url: 'https://i.redd.it/image.jpg', type: 'image' },
    { url: 'https://i.redd.it/video.mp4', type: 'video' }
  ]
);

const carousel = context.__rip.renderPostMedia({
  title: 'Gallery',
  gallery_data: { items: [{ media_id: 'a' }, { media_id: 'b' }] },
  media_metadata: {
    a: { s: { u: 'https://i.redd.it/a.jpg' } },
    b: { s: { u: 'https://i.redd.it/b.jpg' } }
  }
});
assert.match(carousel, /class="faceplate-carousel rip-carousel"/);
assert.doesNotMatch(carousel, /<faceplate-carousel/);
assert.equal((carousel.match(/data-carousel-step=/g) || []).length, 2);

const comment = context.__rip.renderComments([{ kind: 't1', data: {
  author: 'reader', score: 12, body: 'hello', permalink: '/comments/post/comment/id/'
} }], 0, 'https://www.reddit.com/r/test/comments/post/title/');
assert.match(comment, /class="rip-avatar"/);
assert.match(comment, />12<\/span>/);
assert.doesNotMatch(comment, /points/);

console.log('content tests passed');
