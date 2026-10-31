/* ui/share_card.js — 第83轮: 对局结果分享卡 (canvas 生成 PNG, 一键下载)
 * 传播机制: 打完一局的访客一键得到一张排版好的战报图 (双方模型/比分/手数/终局盘面/天梯变化),
 * 社交平台发图即可带回流量 — 图上有项目地址水印。
 * 结构: buildData() 纯数据装配 (Node 可测); draw() 浏览器 canvas 绘制; download() 触发保存。
 * 文案由调用方 (app.js) 用 t()/tArgs() 解析后传入, 本模块不含 i18n 依赖。 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};

  /* 卡面几何常量 (Node 可测): 9x10 交点棋盘, cell 为交点间距 */
  var GEO = { W: 1000, H: 1500, BOARD_X: 75, BOARD_Y: 250, CELL: 100, PIECE_R: 44 };
  function gridPoint(x, y) {
    return { px: GEO.BOARD_X + (x % 9) * GEO.CELL, py: GEO.BOARD_Y + (y % 10) * GEO.CELL };
  }

  /* 纯数据装配 — 全部文案已由调用方解析, 这里只做拼装与裁剪 */
  function buildData(opts) {
    opts = opts || {};
    var rec = opts.record || {};
    var redName = String(rec.red || 'Red').slice(0, 24);
    var blackName = String(rec.black || 'Black').slice(0, 24);
    var winner = opts.winner;   // 'red' | 'black' | 'draw' | null
    var dur = opts.elapsedSec;
    var durText = (typeof dur === 'number' && isFinite(dur) && dur >= 0)
      ? (dur >= 60 ? Math.floor(dur / 60) + 'm ' + Math.round(dur % 60) + 's' : Math.round(dur) + 's')
      : '';
    return {
      title: opts.titleText || 'LLM Xiangqi Battle',
      redName: redName,
      blackName: blackName,
      resultText: String(opts.resultText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60),
      metaText: String(opts.metaText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90),
      eloText: String(opts.eloText || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 90),
      footerText: opts.footerText || 'github.com/yydsdbc/LLM-Chess',
      winner: winner || null,
      moves: opts.moves | 0,
      durText: durText,
      stamp: String(rec.stamp || Date.now()).replace(/[^\w-]/g, '').slice(0, 40)
    };
  }

  /* 终局盘面绘制数据: 从引擎枚举 90 格 → [{x,y,color,type,char}] (红下黑上, 标准朝向) */
  function collectPieces(engine) {
    var out = [];
    if (!engine || typeof engine.pieceAt !== 'function') return out;
    for (var y = 0; y < 10; y++) {
      for (var x = 0; x < 9; x++) {
        var p = engine.pieceAt(x, y);
        if (p && p.color && p.type && XQ.Piece && XQ.Piece.CHARS) {
          var chars = XQ.Piece.CHARS[p.color];
          out.push({ x: x, y: y, color: p.color, char: (chars && chars[p.type]) || '?' });
        }
      }
    }
    return out;
  }

  /* 浏览器绘制 → 返回 canvas (调用方自行 append/下载) */
  function draw(opts) {
    var data = opts.data || buildData(opts);
    var pieces = opts.pieces || [];
    var doc = root.document;
    var canvas = doc.createElement('canvas');
    canvas.width = GEO.W; canvas.height = GEO.H;
    var ctx = canvas.getContext('2d');

    /* 背景: 暗金主题 */
    var bg = ctx.createRadialGradient(GEO.W / 2, GEO.H * 0.3, 80, GEO.W / 2, GEO.H * 0.5, GEO.H);
    bg.addColorStop(0, '#1a1410'); bg.addColorStop(1, '#080607');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, GEO.W, GEO.H);

    /* 头部: 标题 + 对阵 */
    ctx.textAlign = 'center';
    ctx.fillStyle = '#f0d9a0';
    ctx.font = 'bold 56px "Microsoft YaHei", sans-serif';
    ctx.fillText(data.title, GEO.W / 2, 120);
    ctx.font = '40px "Microsoft YaHei", sans-serif';
    ctx.fillStyle = data.winner === 'red' ? '#ff9a6a' : data.winner === 'black' ? '#9ab8ff' : '#f0d9a0';
    var vsLine = '🔴 ' + data.redName + '  vs  ' + data.blackName + ' ⚫';
    ctx.fillText(vsLine, GEO.W / 2, 185);

    /* 棋盘: 外框 + 网格 + 楚河汉界 */
    var bw = 8 * GEO.CELL, bh = 9 * GEO.CELL;
    ctx.strokeStyle = '#7a5a2a'; ctx.lineWidth = 3;
    ctx.strokeRect(GEO.BOARD_X - 14, GEO.BOARD_Y - 14, bw + 28, bh + 28);
    ctx.lineWidth = 2;
    var gi, gj, p1, p2;
    for (gi = 0; gi < 10; gi++) {   // 横线
      p1 = gridPoint(0, gi); p2 = gridPoint(8, gi);
      ctx.beginPath(); ctx.moveTo(p1.px, p1.py); ctx.lineTo(p2.px, p2.py); ctx.stroke();
    }
    for (gj = 0; gj < 9; gj++) {   // 竖线 (中段被楚河汉界断开: y=4..5)
      p1 = gridPoint(gj, 0); p2 = gridPoint(gj, 4);
      ctx.beginPath(); ctx.moveTo(p1.px, p1.py); ctx.lineTo(p2.px, p2.py); ctx.stroke();
      p1 = gridPoint(gj, 5); p2 = gridPoint(gj, 9);
      ctx.beginPath(); ctx.moveTo(p1.px, p1.py); ctx.lineTo(p2.px, p2.py); ctx.stroke();
    }
    ctx.fillStyle = '#7a5a2a';
    ctx.font = '34px "Microsoft YaHei", serif';
    p1 = gridPoint(2, 4.55); p2 = gridPoint(6, 4.55);
    ctx.fillText('楚  河', p1.px, p1.py);
    ctx.fillText('汉  界', p2.px, p2.py);

    /* 棋子: 红方暖金底, 黑方墨底亮边 */
    pieces.forEach(function (pc) {
      var pt = gridPoint(pc.x, pc.y);
      ctx.beginPath();
      ctx.arc(pt.px, pt.py, GEO.PIECE_R, 0, Math.PI * 2);
      ctx.fillStyle = pc.color === 'red' ? '#3d1a10' : '#101826';
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = pc.color === 'red' ? '#e06a4a' : '#5a86c8';
      ctx.stroke();
      ctx.fillStyle = pc.color === 'red' ? '#ffb59a' : '#b8d4f0';
      ctx.font = 'bold 50px "Microsoft YaHei", serif';
      ctx.fillText(pc.char, pt.px, pt.py + 17);
    });

    /* 结算区 */
    ctx.fillStyle = '#f0d9a0';
    ctx.font = 'bold 52px "Microsoft YaHei", sans-serif';
    ctx.fillText(data.resultText, GEO.W / 2, GEO.BOARD_Y + bh + 95);
    if (data.metaText) {
      ctx.fillStyle = '#c8b088';
      ctx.font = '34px "Microsoft YaHei", sans-serif';
      ctx.fillText(data.metaText, GEO.W / 2, GEO.BOARD_Y + bh + 165);
    }
    if (data.eloText) {
      ctx.fillStyle = '#e0a030';
      ctx.font = '36px "Microsoft YaHei", sans-serif';
      ctx.fillText(data.eloText, GEO.W / 2, GEO.BOARD_Y + bh + 235);
    }
    /* 底部水印: 项目地址 + 行动号召 */
    ctx.fillStyle = '#a08858';
    ctx.font = '32px "Microsoft YaHei", sans-serif';
    ctx.fillText('▶ ' + data.footerText, GEO.W / 2, GEO.H - 60);
    return canvas;
  }

  /* 下载: toBlob → 临时 <a download> */
  function download(canvas, filename) {
    var doc = root.document;
    if (!canvas || !canvas.toBlob || !doc) return Promise.resolve(false);
    return new Promise(function (resolve) {
      canvas.toBlob(function (blob) {
        if (!blob) { resolve(false); return; }
        var url = URL.createObjectURL(blob);
        var a = doc.createElement('a');
        a.href = url;
        a.download = filename || 'llm-chess-share.png';
        doc.body.appendChild(a);
        a.click();
        setTimeout(function () { doc.body.removeChild(a); URL.revokeObjectURL(url); resolve(true); }, 200);
      }, 'image/png');
    });
  }

  XQ.ShareCard = { GEO: GEO, gridPoint: gridPoint, buildData: buildData, collectPieces: collectPieces, draw: draw, download: download };
})(typeof window !== 'undefined' ? window : this);
