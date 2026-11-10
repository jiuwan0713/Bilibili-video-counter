/*
 * B站观看统计 · 后台 service worker
 * 唯一的数据写入方：内容脚本只发消息，弹窗只读存储。
 */
importScripts('core.js');

const C = self.WatchCore;
const DEFAULT_SETTINGS = { minSeconds: 5, countRepeats: false };
const KEEP_DAYS = 500;
const DETAIL_DAYS = 60;
const ALARM_NAME = 'bili-watch-refresh';

// 串行化读改写，避免多条消息同时到达时互相覆盖
let queue = Promise.resolve();
function serial(task) {
  const run = queue.then(task, task);
  queue = run.then(function () {}, function () {});
  return run;
}

async function readState() {
  const data = await chrome.storage.local.get({
    records: C.emptyRecords(),
    settings: DEFAULT_SETTINGS
  });
  const records = data.records && typeof data.records === 'object' ? data.records : C.emptyRecords();
  if (!records.days || typeof records.days !== 'object') records.days = {};
  records.version = C.VERSION;
  const settings = Object.assign({}, DEFAULT_SETTINGS, data.settings || {});
  return { records: records, settings: settings };
}

async function refreshBadge() {
  try {
    const state = await readState();
    const summary = C.summarize(state.records, new Date());
    const count = summary.today.count;
    const text = count > 99 ? '99+' : String(count);
    await chrome.action.setBadgeBackgroundColor({ color: '#FB7299' });
    if (chrome.action.setBadgeTextColor) {
      await chrome.action.setBadgeTextColor({ color: '#FFFFFF' });
    }
    await chrome.action.setBadgeText({ text: count > 0 ? text : '' });
  } catch (err) {
    /* 忽略，不影响计数 */
  }
}

function handleCount(message) {
  return serial(async function () {
    const id = String(message.id || '').slice(0, 100);
    if (!id) return { ok: false, error: 'missing id' };
    const state = await readState();
    const added = C.registerWatch(state.records, {
      id: id,
      title: message.title,
      now: new Date(),
      countRepeats: state.settings.countRepeats
    });
    if (added) {
      C.prune(state.records, new Date(), KEEP_DAYS);
      C.compact(state.records, new Date(), DETAIL_DAYS);
      await chrome.storage.local.set({ records: state.records });
      await refreshBadge();
    }
    return { ok: true, added: added };
  });
}

function handleTime(message) {
  return serial(async function () {
    const seconds = Number(message.seconds);
    if (!isFinite(seconds) || seconds <= 0) return { ok: false, error: 'bad seconds' };
    const state = await readState();
    C.addSeconds(state.records, {
      id: String(message.id || ''),
      title: message.title,
      seconds: seconds,
      now: new Date()
    });
    await chrome.storage.local.set({ records: state.records });
    return { ok: true };
  });
}

function handleSettings(patch) {
  return serial(async function () {
    const state = await readState();
    const next = Object.assign({}, state.settings);
    if (patch && typeof patch.minSeconds === 'number') {
      next.minSeconds = Math.min(120, Math.max(1, Math.round(patch.minSeconds)));
    }
    if (patch && typeof patch.countRepeats === 'boolean') {
      next.countRepeats = patch.countRepeats;
    }
    await chrome.storage.local.set({ settings: next });
    return { ok: true, settings: next };
  });
}

function handleClear() {
  return serial(async function () {
    await chrome.storage.local.set({ records: C.emptyRecords() });
    await refreshBadge();
    return { ok: true };
  });
}

function handleGet() {
  return serial(async function () {
    const state = await readState();
    return {
      ok: true,
      summary: C.summarize(state.records, new Date()),
      settings: state.settings
    };
  });
}

chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
  if (!message || typeof message.type !== 'string') return false;

  let promise;
  switch (message.type) {
    case 'watch:count':
      promise = handleCount(message);
      break;
    case 'watch:time':
      promise = handleTime(message);
      break;
    case 'settings:update':
      promise = handleSettings(message.settings);
      break;
    case 'data:clear':
      promise = handleClear();
      break;
    case 'stats:get':
      promise = handleGet();
      break;
    default:
      return false;
  }

  promise.then(sendResponse, function (err) {
    sendResponse({ ok: false, error: String((err && err.message) || err) });
  });
  return true;
});

chrome.runtime.onInstalled.addListener(function () {
  serial(async function () {
    const data = await chrome.storage.local.get(['records', 'settings']);
    const patch = {};
    if (!data.records) patch.records = C.emptyRecords();
    if (!data.settings) patch.settings = DEFAULT_SETTINGS;
    if (Object.keys(patch).length) await chrome.storage.local.set(patch);
  })
    .then(async function () {
      try {
        await chrome.alarms.create(ALARM_NAME, { periodInMinutes: 30 });
      } catch (err) {
        /* 忽略 */
      }
      refreshBadge();
    })
    .catch(function () {});
});

chrome.runtime.onStartup.addListener(function () {
  refreshBadge();
});

chrome.alarms.onAlarm.addListener(function (alarm) {
  if (alarm.name === ALARM_NAME) refreshBadge();
});
