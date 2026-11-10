/*
 * B站观看统计 · 共享核心逻辑
 * 无第三方依赖，同时用于 content script / service worker / popup / Node 单元测试。
 * 所有数据保存在 chrome.storage.local，不发起任何网络请求。
 */
(function (root) {
  'use strict';

  const VERSION = 1;
  const MAX_TITLE = 120;
  const WEEKDAY_LABELS = ['日', '一', '二', '三', '四', '五', '六'];

  // 只统计这些页面路径下的视频，避免首页预览、直播、动态里的自动播放被计入
  const VIDEO_PATH_RES = [
    /^\/video\/(?:BV[0-9A-Za-z]{10}|av\d+)/i,
    /^\/(?:bangumi|cheese)\/(?:play|media)\//i,
    /^\/(?:list|medialist\/play|festival)\//i
  ];

  function pad2(n) {
    return n < 10 ? '0' + n : String(n);
  }

  /** 本地时区的 YYYY-MM-DD */
  function dateKey(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function startOfDay(date) {
    const d = new Date(date.getTime());
    d.setHours(0, 0, 0, 0);
    return d;
  }

  /** 周一作为一周的第一天 */
  function startOfWeek(date) {
    const d = startOfDay(date);
    const offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return d;
  }

  function startOfMonth(date) {
    const d = startOfDay(date);
    d.setDate(1);
    return d;
  }

  function isVideoPage(url) {
    let u;
    try {
      u = new URL(url);
    } catch (err) {
      return false;
    }
    if (!/(^|\.)bilibili\.com$/i.test(u.hostname)) return false;
    if (/^\/live\//.test(u.pathname)) return false;
    return VIDEO_PATH_RES.some(function (re) { return re.test(u.pathname); });
  }

  /** 从 URL 中解析稳定的视频 ID：BV 号 / av 号 / 番剧 ep|ss 号 */
  function videoIdFromUrl(url) {
    let u;
    try {
      u = new URL(url);
    } catch (err) {
      return null;
    }
    let m = u.pathname.match(/\/video\/(BV[0-9A-Za-z]{10})/);
    if (m) return m[1];
    m = u.pathname.match(/\/video\/av(\d+)/i);
    if (m) return 'av' + m[1];
    m = u.pathname.match(/\/(?:bangumi|cheese)\/(?:play|media)\/(ep\d+|ss\d+)/i);
    if (m) return m[1].toLowerCase();
    const bvid = u.searchParams.get('bvid');
    if (bvid) return bvid;
    const aid = u.searchParams.get('aid');
    if (aid) return 'av' + aid;
    const epid = u.searchParams.get('ep_id');
    if (epid) return 'ep' + epid;
    const path = u.pathname.replace(/\/+$/, '');
    return path || null;
  }

  /** 去掉 "xxx_哔哩哔哩_bilibili" 这类后缀，并限制长度 */
  function cleanTitle(title) {
    let s = String(title == null ? '' : title).replace(/\s+/g, ' ').trim();
    s = s.replace(/\s*[-_|]\s*哔哩哔哩(?:[-_|]\s*bilibili)?\s*$/i, '');
    s = s.replace(/\s*[-_|]\s*bilibili\s*$/i, '');
    if (s.length > MAX_TITLE) s = s.slice(0, MAX_TITLE - 1).trim() + '…';
    return s || '未命名视频';
  }

  function emptyRecords() {
    return { version: VERSION, days: {} };
  }

  function ensureDay(records, key) {
    if (!records.days) records.days = {};
    let day = records.days[key];
    if (!day) {
      day = { count: 0, seconds: 0, videos: {} };
      records.days[key] = day;
    }
    if (!day.videos) day.videos = {};
    if (typeof day.count !== 'number') day.count = 0;
    if (typeof day.seconds !== 'number') day.seconds = 0;
    return day;
  }

  function ensureVideo(day, id, now) {
    let video = day.videos[id];
    if (!video) {
      video = {
        title: '',
        seconds: 0,
        count: 0,
        first: now.getTime(),
        last: now.getTime()
      };
      day.videos[id] = video;
    }
    return video;
  }

  /**
   * 记一次“看了 1 个视频”。
   * 同一视频同一天默认只计一次；opts.countRepeats 为 true 时每次观看都计。
   * @returns {boolean} 是否真的 +1
   */
  function registerWatch(records, opts) {
    const id = String(opts.id || '');
    if (!id) return false;
    const now = opts.now instanceof Date ? opts.now : new Date();
    const day = ensureDay(records, dateKey(now));
    let video = day.videos[id];

    if (video && video.count > 0 && !opts.countRepeats) {
      video.last = now.getTime();
      return false;
    }

    video = ensureVideo(day, id, now);
    day.count += 1;
    video.count += 1;
    video.last = now.getTime();
    if (opts.title) video.title = cleanTitle(opts.title);
    return true;
  }

  /** 累计观看秒数（在达到计数阈值之前也会先记录下来） */
  function addSeconds(records, opts) {
    const seconds = Number(opts.seconds);
    if (!isFinite(seconds) || seconds <= 0) return;
    const capped = Math.min(seconds, 3600);
    const now = opts.now instanceof Date ? opts.now : new Date();
    const day = ensureDay(records, dateKey(now));
    const id = String(opts.id || '') || '_unknown';
    const video = ensureVideo(day, id, now);
    day.seconds += capped;
    video.seconds += capped;
    video.last = now.getTime();
    if (opts.title) video.title = cleanTitle(opts.title);
  }

  function listVideos(day) {
    if (!day || !day.videos) return [];
    return Object.keys(day.videos)
      .map(function (id) {
        const video = day.videos[id] || {};
        return {
          id: id,
          title: video.title || '未命名视频',
          seconds: Number(video.seconds) || 0,
          count: Number(video.count) || 0,
          first: Number(video.first) || 0,
          last: Number(video.last) || 0
        };
      })
      .filter(function (video) { return video.count > 0; })
      .sort(function (a, b) { return b.last - a.last; });
  }

  /**
   * 生成今日 / 本周 / 本月 / 最近 7 天统计。
   * 日期键是补零的 YYYY-MM-DD，可直接按字符串比较。
   */
  function summarize(records, now) {
    const at = now instanceof Date ? now : new Date();
    const todayKey = dateKey(at);
    const weekKey = dateKey(startOfWeek(at));
    const monthKey = dateKey(startOfMonth(at));
    const days = (records && records.days) || {};

    const out = {
      today: { key: todayKey, count: 0, seconds: 0, videos: [] },
      week: { key: weekKey, count: 0, seconds: 0 },
      month: { key: monthKey, count: 0, seconds: 0 },
      total: { count: 0, seconds: 0 },
      last7: []
    };

    Object.keys(days).forEach(function (key) {
      const day = days[key] || {};
      const count = Number(day.count) || 0;
      const seconds = Number(day.seconds) || 0;
      out.total.count += count;
      out.total.seconds += seconds;
      if (key <= todayKey && key >= monthKey) {
        out.month.count += count;
        out.month.seconds += seconds;
      }
      if (key <= todayKey && key >= weekKey) {
        out.week.count += count;
        out.week.seconds += seconds;
      }
      if (key === todayKey) {
        out.today.count = count;
        out.today.seconds = seconds;
        out.today.videos = listVideos(day);
      }
    });

    for (let i = 6; i >= 0; i -= 1) {
      const d = new Date(at.getTime());
      d.setDate(d.getDate() - i);
      const key = dateKey(d);
      const day = days[key] || {};
      out.last7.push({
        key: key,
        label: WEEKDAY_LABELS[d.getDay()],
        count: Number(day.count) || 0
      });
    }

    return out;
  }

  /** 删除 keepDays 天之前的记录，避免存储无限增长 */
  function prune(records, now, keepDays) {
    const limit = keepDays || 500;
    const at = now instanceof Date ? now : new Date();
    const cutoff = new Date(at.getTime());
    cutoff.setDate(cutoff.getDate() - limit);
    const cutoffKey = dateKey(cutoff);
    const days = records && records.days;
    if (!days) return 0;
    let removed = 0;
    Object.keys(days).forEach(function (key) {
      if (key < cutoffKey) {
        delete days[key];
        removed += 1;
      }
    });
    return removed;
  }

  /**
   * 压缩旧记录：detailDays 天以前的日期只保留数量与时长，清空视频标题明细。
   * 长期使用（每天几十上百个视频、保留 500 天）时把存储控制在配额内。
   */
  function compact(records, now, detailDays) {
    const limit = detailDays || 60;
    const at = now instanceof Date ? now : new Date();
    const cutoff = new Date(at.getTime());
    cutoff.setDate(cutoff.getDate() - limit);
    const cutoffKey = dateKey(cutoff);
    const days = records && records.days;
    if (!days) return 0;
    let cleared = 0;
    Object.keys(days).forEach(function (key) {
      const day = days[key];
      if (key < cutoffKey && day && day.videos && Object.keys(day.videos).length) {
        day.videos = {};
        cleared += 1;
      }
    });
    return cleared;
  }

  function formatDuration(seconds) {
    const s = Number(seconds) || 0;
    if (s < 1) return '0 分钟';
    if (s < 60) return Math.round(s) + ' 秒';
    const mins = Math.floor(s / 60);
    if (mins < 60) return mins + ' 分钟';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return m ? h + ' 小时 ' + m + ' 分' : h + ' 小时';
  }

  function formatTime(timestamp) {
    const d = new Date(Number(timestamp) || Date.now());
    return pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  // ---------- 单次观看会话（内容脚本使用，纯函数便于测试） ----------

  function createSession() {
    return {
      url: '',
      id: '',
      title: '',
      seconds: 0,
      pending: 0,
      counted: false,
      lastTime: null,
      lastNow: 0,
      minSeconds: 5
    };
  }

  function resetSession(session, opts) {
    session.url = opts.url || '';
    session.id = opts.id || '';
    session.title = opts.title || '';
    session.seconds = 0;
    session.pending = 0;
    session.counted = false;
    session.lastTime = null;
    session.lastNow = 0;
    if (typeof opts.minSeconds === 'number' && opts.minSeconds > 0) {
      session.minSeconds = opts.minSeconds;
    }
    return session;
  }

  /**
   * 采样一次播放进度，累加“真实观看时长”。
   * - 暂停 / 结束不累计
   * - 拖进度条导致的跳变会被忽略
   * - 按播放倍速折算为真实时间（2 倍速看 10 分钟内容 = 5 分钟）
   * - 跨过阈值时返回 justCounted: true（每次会话只触发一次）
   */
  function sampleSession(session, sample) {
    const rawNow = Number(sample.now);
    const now = isFinite(rawNow) ? rawNow : Date.now();
    const currentTime = Number(sample.currentTime);

    if (sample.paused || sample.ended || !isFinite(currentTime)) {
      session.lastTime = null;
      session.lastNow = now;
      return { delta: 0, justCounted: false };
    }

    const rate = Number(sample.playbackRate) > 0 ? Number(sample.playbackRate) : 1;
    let delta = 0;

    if (session.lastTime !== null && now > session.lastNow) {
      const raw = currentTime - session.lastTime;
      const elapsed = (now - session.lastNow) / 1000;
      const wall = raw / rate;
      // 正常播放时 wall 应接近 elapsed；明显超出说明是用户拖动进度条
      if (raw > 0 && elapsed > 0 && wall <= Math.max(2, elapsed * 3)) delta = wall;
    }

    session.lastTime = currentTime;
    session.lastNow = now;

    if (delta > 0) {
      session.seconds += delta;
      session.pending += delta;
    }

    let justCounted = false;
    if (!session.counted && session.seconds >= session.minSeconds) {
      session.counted = true;
      justCounted = true;
    }

    return { delta: delta, justCounted: justCounted };
  }

  const api = {
    VERSION: VERSION,
    emptyRecords: emptyRecords,
    dateKey: dateKey,
    startOfDay: startOfDay,
    startOfWeek: startOfWeek,
    startOfMonth: startOfMonth,
    isVideoPage: isVideoPage,
    videoIdFromUrl: videoIdFromUrl,
    cleanTitle: cleanTitle,
    registerWatch: registerWatch,
    addSeconds: addSeconds,
    summarize: summarize,
    listVideos: listVideos,
    prune: prune,
    compact: compact,
    formatDuration: formatDuration,
    formatTime: formatTime,
    createSession: createSession,
    resetSession: resetSession,
    sampleSession: sampleSession
  };

  root.WatchCore = api;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== 'undefined' ? globalThis : this);
