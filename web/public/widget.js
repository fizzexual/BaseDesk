/**
 * BaseDesk web-chat launcher. Drop one tag on any site:
 *
 *   <script src="https://YOUR-BASEDESK/widget.js"
 *           data-channel="ch_1" data-token="tok_…" defer></script>
 *
 * It injects a floating button (bottom-right); clicking it opens the chat panel
 * (an iframe to widget.html). The BaseDesk origin is inferred from this script's
 * own src, so nothing else needs configuring.
 *
 * Exposes window.BaseDeskWidget.destroy() so a host (e.g. the dashboard's live
 * preview) can remove it again.
 */
(function () {
  var self = document.currentScript;
  if (!self || window.BaseDeskWidget) return;

  var channel = self.getAttribute('data-channel') || 'ch_1';
  var token = self.getAttribute('data-token') || '';
  var base = self.getAttribute('data-base') || new URL(self.src, location.href).origin;
  var accent = self.getAttribute('data-accent') || '#12805c';
  var side = self.getAttribute('data-side') === 'left' ? 'left' : 'right';

  var open = false;

  var panel = document.createElement('iframe');
  panel.title = 'Support chat';
  panel.allow = 'autoplay';
  panel.src =
    base +
    '/widget.html?channel=' + encodeURIComponent(channel) +
    '&token=' + encodeURIComponent(token) +
    '&base=' + encodeURIComponent(base) +
    '&accent=' + encodeURIComponent(accent) +
    '&embed=1';
  panel.style.cssText =
    'position:fixed;bottom:92px;' + side + ':20px;width:384px;height:min(620px,calc(100vh - 120px));' +
    'max-width:calc(100vw - 40px);border:0;border-radius:16px;background:#fff;' +
    'box-shadow:0 12px 48px rgba(20,25,23,.24);opacity:0;pointer-events:none;' +
    'transform:translateY(14px) scale(.98);transform-origin:bottom ' + side + ';' +
    'transition:opacity .2s ease,transform .2s ease;z-index:2147483000;';

  var CHAT =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';
  var CLOSE =
    '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>';

  var btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Open support chat');
  btn.innerHTML = CHAT;
  btn.style.cssText =
    'position:fixed;bottom:20px;' + side + ':20px;width:60px;height:60px;border-radius:50%;border:0;' +
    'cursor:pointer;background:' + accent + ';color:#fff;box-shadow:0 8px 24px rgba(20,25,23,.24);' +
    'display:flex;align-items:center;justify-content:center;transition:transform .15s ease;z-index:2147483001;';
  btn.onmouseenter = function () { btn.style.transform = 'scale(1.06)'; };
  btn.onmouseleave = function () { btn.style.transform = 'scale(1)'; };

  var dot = document.createElement('span');
  dot.style.cssText =
    'position:fixed;bottom:64px;' + side + ':22px;width:14px;height:14px;border-radius:50%;' +
    'background:#e5484d;border:2px solid #fff;display:none;z-index:2147483002;pointer-events:none;';

  function setOpen(v) {
    open = v;
    panel.style.opacity = v ? '1' : '0';
    panel.style.pointerEvents = v ? 'auto' : 'none';
    panel.style.transform = v ? 'translateY(0) scale(1)' : 'translateY(14px) scale(.98)';
    btn.innerHTML = v ? CLOSE : CHAT;
    btn.setAttribute('aria-label', v ? 'Close support chat' : 'Open support chat');
    if (v) {
      dot.style.display = 'none';
      try { panel.contentWindow.postMessage({ type: 'basedesk:opened' }, '*'); } catch (e) { /* cross-origin */ }
    }
  }

  btn.addEventListener('click', function () { setOpen(!open); });

  function onMessage(e) {
    var d = e && e.data;
    if (!d || typeof d !== 'object') return;
    if (d.type === 'basedesk:close') setOpen(false);
    else if (d.type === 'basedesk:unread' && !open) dot.style.display = 'block';
  }
  window.addEventListener('message', onMessage);

  function destroy() {
    try {
      window.removeEventListener('message', onMessage);
      [panel, btn, dot].forEach(function (n) { if (n && n.parentNode) n.parentNode.removeChild(n); });
    } catch (e) { /* ignore */ }
    delete window.BaseDeskWidget;
  }

  function mount() {
    var host = document.body || document.documentElement;
    host.appendChild(panel);
    host.appendChild(btn);
    host.appendChild(dot);
  }
  if (document.body) mount();
  else document.addEventListener('DOMContentLoaded', mount);

  window.BaseDeskWidget = { destroy: destroy, channel: channel };
})();
