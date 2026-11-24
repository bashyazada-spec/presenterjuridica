(function (global) {
  'use strict';

  const OVERRIDE_KEY = 'slidesync_platform_override';
  const ROUTES = {
    mobile: 'remote.html',
    desktop: 'index.html'
  };

  function isMobileDevice() {
    // 1. User-Agent Client Hints
    if (navigator.userAgentData && typeof navigator.userAgentData.mobile === 'boolean') {
      if (navigator.userAgentData.mobile) return true;
    }

    // 2. Mobile & Tablet User-Agent check
    const ua = navigator.userAgent || navigator.vendor || global.opera || '';
    if (/Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini|Mobi/i.test(ua)) {
      return true;
    }

    // 3. iPadOS 13+ desktop UA spoofing check
    if (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1) {
      return true;
    }

    // 4. Touch-first device check
    const hasCoarsePointer =
      typeof global.matchMedia === 'function' &&
      global.matchMedia('(pointer: coarse)').matches;
    const screenWidth = Math.min(
      global.innerWidth || Infinity,
      global.screen?.width || Infinity
    );
    if (hasCoarsePointer && screenWidth <= 900) return true;

    // 5. Phone-width viewport fallback
    if (global.innerWidth > 0 && global.innerWidth <= 640) return true;

    return false;
  }

  function detectPlatform() {
    return isMobileDevice() ? 'mobile' : 'desktop';
  }

  function getTargetUrl(platform) {
    const base = platform === 'mobile' ? ROUTES.mobile : ROUTES.desktop;
    return base + global.location.search + global.location.hash;
  }

  function enforcePlatform(expectedPlatform) {
    const params = new URLSearchParams(global.location.search);
    if (params.get('redirect') === 'false') return false;

    const forced = (params.get('platform') || '').toLowerCase();
    if (forced === 'mobile' || forced === 'desktop') {
      sessionStorage.setItem(OVERRIDE_KEY, forced);
      if (forced !== expectedPlatform) {
        global.location.replace(getTargetUrl(forced));
        return true;
      }
      return false;
    }

    if (sessionStorage.getItem(OVERRIDE_KEY) === expectedPlatform) {
      return false;
    }

    const detected = detectPlatform();
    if (detected !== expectedPlatform) {
      global.location.replace(getTargetUrl(detected));
      return true;
    }

    return false;
  }

  global.PlatformDetector = {
    isMobileDevice,
    detectPlatform,
    getTargetUrl,
    enforcePlatform
  };
})(window);
