(function (global) {
  'use strict';

  const ROUTES = {
    mobile: 'remote.html',
    desktop: 'presenter.html'
  };

  function isMobileDevice() {
    // 1. Modern User-Agent Client Hints
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
      if (navigator.userAgentData.mobile) return true;
    }

    // 2. Mobile & Tablet User-Agent check
    const ua = navigator.userAgent || navigator.vendor || global.opera || '';
    const mobileUARegex = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobi/i;
    if (mobileUARegex.test(ua)) return true;

    // 3. iPadOS 13+ desktop-spoofed UA detection
    if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) return true;

    // 4. Touch-first small screen fallback
    const hasCoarsePointer =
      typeof global.matchMedia === 'function' &&
      global.matchMedia('(pointer: coarse)').matches;
    const screenWidth = Math.min(global.innerWidth || Infinity, global.screen?.width || Infinity);
    if (hasCoarsePointer && screenWidth <= 900) return true;

    return false;
  }

  function getTargetUrl() {
    const params = new URLSearchParams(global.location.search);
    const forced = (params.get('platform') || '').toLowerCase();

    let targetBase;
    if (forced === 'mobile') {
      targetBase = ROUTES.mobile;
    } else if (forced === 'desktop') {
      targetBase = ROUTES.desktop;
    } else {
      targetBase = isMobileDevice() ? ROUTES.mobile : ROUTES.desktop;
    }

    return targetBase + global.location.search + global.location.hash;
  }

  function autoRedirect() {
    const params = new URLSearchParams(global.location.search);
    if (params.get('redirect') === 'false') return false;

    global.location.replace(getTargetUrl());
    return true;
  }

  global.PlatformDetector = {
    isMobileDevice,
    getTargetUrl,
    autoRedirect
  };
})(window);
