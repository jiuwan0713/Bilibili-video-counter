/*
 * B站观看统计 · 内容脚本
 * 在 B 站页面里采样 <video> 的播放进度：看满阈值（默认 5 秒）记 1 个视频，
 * 每 15 秒把真实观看时长上报给 service worker。
 */
(function () {
  'use strict';

  if (window.__biliWatchCounterLoaded) return;
  window.__biliWatchCounterLoaded = true;

  const C = window.WatchCore;
  if (!C) return;

  const TICK_MS = 500;
  const FLUSH_INTERVAL_MS = 15000;
  const DEFAULT_SETTINGS = { minSeconds: 5, countRepeats: false };

  const settings = Object.assign({}, DEFAULT_SETTINGS);
  const session = C.createSession();
  session.minSeconds = settings.minSeconds;

  let currentUrl = '';
  let lastFlushAt = Date.now();
  let titleEl = null;
  let titleCheckedAt = 0;

  function send(message) {
    try {
      if (!chrome || !chrome.runtime || !chrome.runtime.id) return;
      chrome.runtime.sendMessage(message, function () {
        // 读取 lastError，避免扩展更新 / 卸载后控制台报错
        void chrome.runtime.lastError;
      });
    } catch (err) {
      /* 扩展上下文失效时忽略 */
    }
  }

  function applySettings(next) {
    if (!next) return;
    if (typeof next.minSeconds === 'number' && next.minSeconds >= 1) {
      settings.minSeconds = Math.round(next.minSeconds);
      session.minSeconds = settings.minSeconds;
    }
    settings.countRepeats = !!next.countRepeats;
  }

  function readSettings() {
    try {
      chrome.storage.local.get({ settings: DEFAULT_SETTINGS }, function (res) {
        applySettings(res && res.settings);
      });
      chrome.storage.onChanged.addListener(function (changes, area) {
        if (area === 'local' && changes.settings) applySettings(changes.settings.newValue);
      });
    } catch (err) {
      /* 忽略 */
    }
  }

  /** 页面里可能有多个 video（广告、预览、小窗），选面积最大且正在播放的那个 */
  function pickVideo() {
    const videos = document.querySelectorAll('video');
    let best = null;
    let bestScore = 0;
    for (let i = 0; i < videos.length; i += 1) {
      const video = videos[i];
      const rect = video.getBoundingClientRect();
      const area = Math.max(0, rect.width) * Math.max(0, rect.height);
      const score = area * (video.paused ? 1 : 2);
      if (score > bestScore) {
        best = video;
        bestScore = score;
      }
    }
    return best;
  }

  function readTitle() {
    const now = Date.now();
    if (!titleEl || !titleEl.isConnected || now - titleCheckedAt > 5000) {
      titleEl = document.querySelector('h1.video-title, .media-title, h1[class*="video-title"]');
      titleCheckedAt = now;
    }
    const raw = (titleEl && titleEl.textContent) || document.title;
    return C.cleanTitle(raw);
  }

  function beginSession(url) {
    currentUrl = url;
    if (!C.isVideoPage(url)) {
      C.resetSession(session, { url: url, id: '', title: '', minSeconds: settings.minSeconds });
      return;
    }
    C.resetSession(session, {
      url: url,
      id: C.videoIdFromUrl(url) || '',
      title: readTitle(),
      minSeconds: settings.minSeconds
    });
  }

  function flush(force) {
    lastFlushAt = Date.now();
    if (!session.id) {
      session.pending = 0;
      return;
    }
    const seconds = session.pending;
    if (seconds < 0.5 && !(force && seconds > 0)) return;
    session.pending = 0;
    send({
      type: 'watch:time',
      id: session.id,
      title: session.title,
      seconds: Math.round(seconds * 10) / 10,
      url: session.url
    });
  }

  function tick() {
    // B 站是单页应用，路由变化时 URL 会变但脚本不会重载
    if (location.href !== currentUrl) {
      flush(true);
      beginSession(location.href);
    }
    if (!session.id) return;

    const video = pickVideo();
    if (!video || video.readyState < 2) {
      session.lastTime = null;
      return;
    }

    const title = readTitle();
    if (title && title !== '未命名视频' && title !== session.title) {
      session.title = title;
    }

    const result = C.sampleSession(session, {
      currentTime: video.currentTime,
      paused: video.paused,
      ended: video.ended,
      playbackRate: video.playbackRate,
      now: Date.now()
    });

    if (result.justCounted) {
      send({ type: 'watch:count', id: session.id, title: session.title, url: session.url });
    }
    if (Date.now() - lastFlushAt >= FLUSH_INTERVAL_MS) flush(false);
  }

  function boot() {
    readSettings();
    beginSession(location.href);
    setInterval(tick, TICK_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.hidden) flush(true);
    });
    window.addEventListener('pagehide', function () {
      flush(true);
    });
  }

  boot();
})();
