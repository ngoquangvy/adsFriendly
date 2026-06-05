// ============================================================
// blocker.js - LỚP 1: Chặn popup ngay tại trang web
// Chiến lược: Ghi đè window.open + Bắt mousedown/click + Bắt thẻ <a> mới
// ============================================================

(function() {
  "use strict";

  // === 1. TIÊM SCRIPT VÀO PAGE CONTEXT ĐỂ GHI ĐÈ window.open ===
  function injectPageScript() {
    const code = `
    (function() {
      const _origOpen = window.open;
      
      window.open = function(url, target, features) {
        try {
          const ev = new CustomEvent('__AFS_popup__', { 
            detail: JSON.stringify({ url: url || '', target: target || '' })
          });
          window.dispatchEvent(ev);
          
          const flag = document.documentElement.getAttribute('__afs_allow__');
          if (flag === 'yes') {
            document.documentElement.removeAttribute('__afs_allow__');
            return _origOpen.call(window, url, target, features);
          }
          
          return { 
            closed: false, close: function(){}, focus: function(){},
            blur: function(){}, postMessage: function(){},
            document: { write: function(){}, close: function(){} },
            location: { href: '', replace: function(){} }
          };
        } catch(e) {
          return null;
        }
      };

      const _origClick = HTMLAnchorElement.prototype.click;
      HTMLAnchorElement.prototype.click = function() {
        if (this.target === '_blank' && this.href) {
          const ev = new CustomEvent('__AFS_popup__', { 
            detail: JSON.stringify({ url: this.href, target: '_blank' })
          });
          window.dispatchEvent(ev);
          
          const flag = document.documentElement.getAttribute('__afs_allow__');
          if (flag === 'yes') {
            document.documentElement.removeAttribute('__afs_allow__');
            return _origClick.call(this);
          }
          return;
        }
        return _origClick.call(this);
      };
    })();
    `;

    const methods = [
      function() {
        const s = document.createElement('script');
        s.textContent = code;
        (document.documentElement || document.head).appendChild(s);
        s.remove();
        return true;
      },
      function() {
        const blob = new Blob([code], { type: 'application/javascript' });
        const blobUrl = URL.createObjectURL(blob);
        const s = document.createElement('script');
        s.src = blobUrl;
        (document.documentElement || document.head).appendChild(s);
        s.remove();
        URL.revokeObjectURL(blobUrl);
        return true;
      },
      function() {
        const s = document.createElement('script');
        s.src = 'data:text/javascript;base64,' + btoa(code);
        (document.documentElement || document.head).appendChild(s);
        s.remove();
        return true;
      }
    ];

    for (let i = 0; i < methods.length; i++) {
      try {
        if (methods[i]()) {
          console.log("[AdsFriendly] Injected via method " + (i + 1));
          return true;
        }
      } catch(e) {
        console.log("[AdsFriendly] Method " + (i + 1) + " failed.");
      }
    }
    return false;
  }

  const injected = injectPageScript();

  // === 2. LẮNG NGHE SỰ KIỆN TỪ PAGE CONTEXT ===
  window.addEventListener('__AFS_popup__', function(e) {
    try {
      const data = JSON.parse(e.detail);
      const url = data.url;
      if (!url || url === '' || url.startsWith('javascript:')) return;

      if (!isCrossOrigin(url) || isWhitelisted(url)) {
        document.documentElement.setAttribute('__afs_allow__', 'yes');
        console.log("[AdsFriendly] Cho phép popup:", url);
        return;
      }

      console.log("[AdsFriendly] Đã chặn popup (window.open):", url);
      notifyBlocked(url);
    } catch(err) {
      console.log("[AdsFriendly] Error parsing popup event:", err);
    }
  });

  // === 3. CHẶN mousedown TRƯỚC KHI CLICK XẢY RA ===
  // Nhiều ad network dùng mousedown để mở popup vì nó xảy ra trước click
  document.addEventListener('mousedown', function(e) {
    if (e.button !== 0) return; // Chỉ xử lý chuột trái

    const aTag = e.target.closest('a');
    if (!aTag || !aTag.href) return;

    // Chỉ chặn target=_blank ở mousedown (không chặn Cmd+Click vì dễ false-positive)
    if (aTag.target === '_blank' && isCrossOrigin(aTag.href) && !isWhitelisted(aTag.href)) {
      e.preventDefault();
      e.stopPropagation();
      console.log("[AdsFriendly] Chặn mousedown -> <a target=_blank>:", aTag.href);
      notifyBlocked(aTag.href);
    }
  }, true);

  // === 4. BẮT CLICK VÀO THẺ <a> CÓ target="_blank" ===
  document.addEventListener('click', function(e) {
    const aTag = e.target.closest('a');
    if (!aTag || !aTag.href) return;

    const opensNewTab = aTag.target === '_blank' || e.metaKey || e.ctrlKey;

    if (opensNewTab && isCrossOrigin(aTag.href) && !isWhitelisted(aTag.href)) {
      console.log("[AdsFriendly] Đã chặn popup (click <a>):", aTag.href);
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      notifyBlocked(aTag.href);
    }
  }, true);

  // === 5. PHÁT HIỆN POP-UNDER / RAPID CLICK ===
  // Khi phát hiện nhiều pointerdown liên tiếp trong 2s (dấu hiệu pop-under),
  // chúng ta intercept toàn bộ thẻ <a target="_blank"> trong trang
  let pointerCount = 0;
  let pointerTimer = null;

  document.addEventListener('pointerdown', function(e) {
    pointerCount++;

    if (pointerTimer) clearTimeout(pointerTimer);
    pointerTimer = setTimeout(function() {
      if (pointerCount >= 3) {
        // Pop-under detected: vô hiệu hóa tất cả thẻ <a target="_blank"> cross-origin
        console.log("[AdsFriendly] Pop-under detected (" + pointerCount + " clicks)");
        document.querySelectorAll('a[target="_blank"]').forEach(function(a) {
          if (a.href && isCrossOrigin(a.href) && !isWhitelisted(a.href)) {
            const href = a.href;
            a.removeAttribute('href');
            a.setAttribute('data-afs-href', href);
            a.addEventListener('click', function(ev) {
              ev.preventDefault();
              notifyBlocked(href);
            }, true);
          }
        });
      }
      pointerCount = 0;
    }, 2000);
  }, true);

  // === 6. GIÁM SÁT THẺ <a> MỚI ĐƯỢC TẠO ĐỘNG ===
  if (typeof MutationObserver !== 'undefined') {
    const observer = new MutationObserver(function(mutations) {
      mutations.forEach(function(mutation) {
        mutation.addedNodes.forEach(function(node) {
          if (node.nodeType !== 1) return;

          const anchors = node.tagName === 'A' ? [node] : (node.querySelectorAll ? node.querySelectorAll('a[target="_blank"]') : []);

          anchors.forEach(function(a) {
            if (!a.href || !isCrossOrigin(a.href) || isWhitelisted(a.href)) return;

            const style = window.getComputedStyle(a);
            const isHidden = style.display === 'none' ||
              style.visibility === 'hidden' ||
              style.opacity === '0' ||
              (a.offsetWidth === 0 && a.offsetHeight === 0);

            const isOverlay = style.position === 'fixed' || style.position === 'absolute';

            if (isHidden || isOverlay) {
              const href = a.href;
              a.removeAttribute('href');
              a.setAttribute('data-afs-href', href);
              a.style.setProperty('pointer-events', 'none', 'important');
              a.addEventListener('click', function(ev) {
                ev.preventDefault();
                notifyBlocked(href);
              }, true);
              console.log("[AdsFriendly] Vô hiệu hóa thẻ <a> ẩn/overlay:", href);
            }
          });
        });
      });
    });

    if (document.documentElement) {
      observer.observe(document.documentElement, { childList: true, subtree: true, attributes: false });
    } else {
      document.addEventListener('DOMContentLoaded', function() {
        observer.observe(document.documentElement, { childList: true, subtree: true, attributes: false });
      });
    }
  }

  // === 7. NHẬN TIN NHẮN TỪ BACKGROUND SCRIPT (LỚP 2) ===
  api.runtime.onMessage.addListener(function(message) {
    if (message.action === "popup_blocked") {
      console.log("[AdsFriendly] Background đã chặn tab mới:", message.url);
      notifyBlocked(message.url);
    }
  });

  console.log("[AdsFriendly] Blocker đã khởi động (injected=" + injected + ").");
})();
