/* ui/fight_card.js — VS 开场卡 (第95轮, 零依赖): 红黑选手介绍 (名字/Elo/战绩), 2.6s 自动收起或点击跳过
 * 对标 AI 斗蛐蛐品类的赛事仪式感 (选手卡 + 大 VS)。名字/Elo/战绩取天梯 (xq_elo_v1) — 无对局记录显示 '—'。
 * buildData 纯函数 Node 直测; show 为纯展示 (aria-hidden 装饰层 — 信息在思考面板/终局卡均可读)。
 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};
  var timer = null;

  function buildData(o) {
    o = o || {};
    function side(name, rating, stats, form) {
      var st = stats && typeof stats === 'object' ? stats : null;
      var hasGames = !!(st && typeof st.games === 'number' && st.games > 0);
      var f = form && typeof form === 'object' ? form : null;
      return {
        name: name || '?',
        rating: hasGames && typeof rating === 'number' && isFinite(rating)
          ? String(Math.round(rating * 10) / 10) : '—',
        record: hasGames ? { w: st.win || 0, d: st.draw || 0, l: st.loss || 0 } : null,
        /* 第100轮: 选手状态 (斗蛐蛐人气层) — last5 战绩串与带符号连胜/连败 */
        last5: f && typeof f.last5 === 'string' ? f.last5 : '',
        streak: f && typeof f.streak === 'number' ? f.streak : 0
      };
    }
    return {
      red: side(o.redName, o.redRating, o.redStats, o.redForm),
      black: side(o.blackName, o.blackRating, o.blackStats, o.blackForm)
    };
  }

  function hide() {
    if (timer) { clearTimeout(timer); timer = null; }
    var el = document.getElementById('fight-card');
    if (el && el.parentNode) el.parentNode.removeChild(el);
  }

  function show(data) {
    if (typeof document === 'undefined' || !data) return;
    hide();
    var T = XQ.I18N ? XQ.I18N.tArgs : function (k) { return k; };
    var t = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
    var ov = document.createElement('div');
    ov.id = 'fight-card';
    ov.setAttribute('aria-hidden', 'true');
    ov.addEventListener('click', hide);
    var inner = document.createElement('div');
    inner.className = 'fc-inner';
    [[data.red, 'fc-red'], [data.black, 'fc-black']].forEach(function (pair) {
      var sd = pair[0], cls = pair[1];
      var col = document.createElement('div');
      col.className = 'fc-side ' + cls;
      var nm = document.createElement('div');
      nm.className = 'fc-name';
      nm.textContent = sd.name;   // 名字来自配置/棋谱 — textContent 防注入
      col.appendChild(nm);
      var elo = document.createElement('div');
      elo.className = 'fc-meta';
      elo.textContent = t('fc_elo').replace('{r}', sd.rating);
      col.appendChild(elo);
      if (sd.record) {
        var rec = document.createElement('div');
        rec.className = 'fc-meta';
        rec.textContent = T('fc_record', sd.record);
        col.appendChild(rec);
      }
      if (sd.last5) {
        var form = document.createElement('div');
        form.className = 'fc-meta fc-form';
        form.textContent = T('fc_form', { f: sd.last5.split('').join(' ') });
        col.appendChild(form);
      }
      if (sd.streak >= 2 || sd.streak <= -2) {
        var flair = document.createElement('div');
        flair.className = 'fc-streak ' + (sd.streak > 0 ? 'fc-hot' : 'fc-cold');
        flair.textContent = T(sd.streak > 0 ? 'fc_streak_win' : 'fc_streak_loss', { n: Math.abs(sd.streak) });
        col.appendChild(flair);
      }
      inner.appendChild(col);
    });
    var vs = document.createElement('div');
    vs.className = 'fc-vs';
    vs.textContent = t('fc_vs');
    inner.appendChild(vs);
    ov.appendChild(inner);
    document.body.appendChild(ov);
    timer = setTimeout(hide, 2600);
  }

  XQ.FightCard = { buildData: buildData, show: show, hide: hide };
})(typeof window !== 'undefined' ? window : globalThis);
