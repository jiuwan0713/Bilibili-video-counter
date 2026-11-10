/* B站观看统计 · 弹窗 */
(function () {
  'use strict';

  const C = window.WatchCore;
  const DEFAULTS = { minSeconds: 5, countRepeats: false };

  function $(id) {
    return document.getElementById(id);
  }

  function fmtCount(n) {
    return n > 999 ? '999+' : String(n);
  }

  function renderChart(days) {
    const chart = $('chart');
    chart.textContent = '';

    let max = 1;
    days.forEach(function (day) {
      if (day.count > max) max = day.count;
    });

    days.forEach(function (day, index) {
      const col = document.createElement('div');
      col.className = 'chart-col' + (index === days.length - 1 ? ' is-today' : '');
      col.title = day.key + '：' + day.count + ' 个视频';

      const count = document.createElement('span');
      count.className = 'chart-count';
      count.textContent = day.count ? String(day.count) : '';

      const wrap = document.createElement('div');
      wrap.className = 'chart-bar-wrap';

      const bar = document.createElement('div');
      bar.className = 'chart-bar' + (day.count ? '' : ' is-empty');
      if (day.count) {
        bar.style.height = Math.max(10, Math.round((day.count / max) * 100)) + '%';
      }
      wrap.appendChild(bar);

      const label = document.createElement('span');
      label.className = 'chart-label';
      label.textContent = day.label;

      col.appendChild(count);
      col.appendChild(wrap);
      col.appendChild(label);
      chart.appendChild(col);
    });
  }

  function renderRecent(videos) {
    const list = $('recent');
    const note = $('today-note');
    list.textContent = '';
    note.textContent = videos.length ? '共 ' + videos.length + ' 个' : '';

    if (!videos.length) {
      const empty = document.createElement('li');
      empty.className = 'empty';
      empty.textContent = '今天还没有看视频';
      list.appendChild(empty);
      return;
    }

    videos.slice(0, 5).forEach(function (video, index) {
      const item = document.createElement('li');
      item.className = 'recent-item';

      const rank = document.createElement('span');
      rank.className = 'recent-rank';
      rank.textContent = String(index + 1);

      const title = document.createElement('span');
      title.className = 'recent-title';
      title.textContent = video.title;
      title.title = video.title;

      const time = document.createElement('span');
      time.className = 'recent-time';
      time.textContent = video.seconds >= 1 ? C.formatDuration(video.seconds) : '—';

      item.appendChild(rank);
      item.appendChild(title);
      item.appendChild(time);
      list.appendChild(item);
    });
  }

  function render(records, settings) {
    const summary = C.summarize(records, new Date());

    $('today-count').textContent = fmtCount(summary.today.count);
    $('week-count').textContent = fmtCount(summary.week.count);
    $('month-count').textContent = fmtCount(summary.month.count);

    $('today-time').textContent = C.formatDuration(summary.today.seconds);
    $('week-time').textContent = C.formatDuration(summary.week.seconds);
    $('month-time').textContent = C.formatDuration(summary.month.seconds);

    const weekTotal = summary.last7.reduce(function (sum, day) {
      return sum + day.count;
    }, 0);
    $('week-summary').textContent = '共 ' + weekTotal + ' 个';
    $('repeat-toggle').checked = !!settings.countRepeats;

    renderChart(summary.last7);
    renderRecent(summary.today.videos);
  }

  async function load() {
    try {
      const data = await chrome.storage.local.get({
        records: C.emptyRecords(),
        settings: DEFAULTS
      });
      render(
        data.records || C.emptyRecords(),
        Object.assign({}, DEFAULTS, data.settings || {})
      );
    } catch (err) {
      render(C.emptyRecords(), DEFAULTS);
    }
  }

  function send(message) {
    return new Promise(function (resolve) {
      try {
        chrome.runtime.sendMessage(message, function (response) {
          void chrome.runtime.lastError;
          resolve(response || null);
        });
      } catch (err) {
        resolve(null);
      }
    });
  }

  $('refresh').addEventListener('click', function () {
    const button = $('refresh');
    button.classList.add('is-spinning');
    load().then(function () {
      setTimeout(function () {
        button.classList.remove('is-spinning');
      }, 400);
    });
  });

  $('repeat-toggle').addEventListener('change', async function (event) {
    await send({
      type: 'settings:update',
      settings: { countRepeats: event.target.checked }
    });
    await load();
  });

  $('clear').addEventListener('click', async function () {
    if (!window.confirm('确定清空全部观看记录？此操作不可恢复。')) return;
    await send({ type: 'data:clear' });
    await load();
  });

  if (chrome.storage && chrome.storage.onChanged) {
    chrome.storage.onChanged.addListener(function (changes, area) {
      if (area === 'local' && (changes.records || changes.settings)) load();
    });
  }

  load();
})();
