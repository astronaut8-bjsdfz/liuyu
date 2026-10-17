/* ============================================================
   刘语 · 逻辑
   ------------------------------------------------------------
   一句话说清权限：**看是公开的，改要钥匙**。
     · 语录和篇目：开 select 策略，谁都能读 → 这里直接 GET，不用函数
     · 增 / 改 / 删：全走 rpc，函数里先验钥匙 → 网页端拿不到写权限
   所以就算有人把这份 JS 改烂，也改不了数据库里一个字。
   ============================================================ */

(function () {
  "use strict";

  var CFG = window.LY_CONFIG || {};
  var BASE = String(CFG.supabaseUrl || "").replace(/\/+$/, "");
  var ANON = CFG.anonKey || "";
  var HAS_BACKEND = !!(BASE && ANON);
  var T_SEC = CFG.sectionTable || "ly_sections";
  var T_QUO = CFG.quoteTable || "ly_quotes";

  var LS_KEY = "liuyu.key.v1";      // 编辑钥匙存在这台设备上

  var state = {
    sections: [],
    quotes: [],
    key: "",                        // 有值 = 编辑模式
    ready: false,
    err: ""
  };

  var REQUIRED_IDS = [
    "toc", "board", "boardEmpty", "footNote", "editBtn", "logoutBtn",
    "keyLayer", "keyInput", "keyErr", "keyOk", "keyCancel", "toast"
  ];

  /* ---------- 小工具 ---------- */

  function $(id) { return document.getElementById(id); }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined && text !== null) n.textContent = text;
    return n;
  }

  var CN = "零一二三四五六七八九";

  /* 1 → 一，10 → 十，11 → 十一，23 → 二十三。超过 99 就直接用阿拉伯数字 */
  function cn(n) {
    if (n <= 0 || n > 99) return String(n);
    if (n < 10) return CN.charAt(n);
    if (n === 10) return "十";
    var t = Math.floor(n / 10), r = n % 10;
    return n < 20 ? "十" + CN.charAt(r) : CN.charAt(t) + "十" + (r ? CN.charAt(r) : "");
  }

  function fmtDate(s) {
    if (!s) return "";
    var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s));
    if (!m) return String(s);
    var y = +m[1], mo = +m[2], d = +m[3];
    var md = mo + "月" + d + "日";
    return (y === new Date().getFullYear()) ? md : y + "年" + md;
  }

  var toastTimer = 0;
  function toast(msg) {
    var t = $("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("is-on"); }, 2600);
  }

  /* ---------- 接口 ---------- */

  function sbFetch(path, opts) {
    opts = opts || {};
    if (!HAS_BACKEND) return Promise.reject(new Error("没有配置数据库"));
    var headers = {
      "apikey": ANON,
      "Authorization": "Bearer " + ANON,
      "Content-Type": "application/json"
    };
    return fetch(BASE + "/rest/v1/" + path, {
      method: opts.method || "GET",
      headers: headers,
      body: opts.body
    }).then(function (res) {
      return res.text().then(function (txt) {
        if (!res.ok) {
          var msg = txt;
          try { var j = JSON.parse(txt); msg = j.message || j.hint || txt; } catch (e) {}
          throw new Error(msg || ("HTTP " + res.status));
        }
        if (!txt) return null;
        try { return JSON.parse(txt); } catch (e) { return null; }
      });
    });
  }

  function rpc(name, body) {
    return sbFetch("rpc/" + name, {
      method: "POST",
      body: JSON.stringify(body || {})
    });
  }

  /* ---------- 读 ---------- */

  function loadAll() {
    var p1 = sbFetch(T_SEC + "?select=id,name,note,sort&order=sort.asc,id.asc");
    var p2 = sbFetch(T_QUO + "?select=id,section_id,who,body,scene,said_on&order=id.asc&limit=2000");
    return Promise.all([p1, p2]).then(function (r) {
      state.sections = r[0] || [];
      state.quotes = r[1] || [];
      state.ready = true;
      state.err = "";
    }).catch(function (e) {
      state.ready = false;
      state.err = String((e && e.message) || e);
      throw e;
    });
  }

  function quotesOf(secId) {
    return state.quotes.filter(function (q) {
      return String(q.section_id) === String(secId);
    });
  }

  /* ---------- 画：篇目录 ---------- */

  function renderToc() {
    var box = $("toc");
    box.innerHTML = "";
    if (!state.sections.length) { box.hidden = true; return; }
    box.hidden = false;
    state.sections.forEach(function (s) {
      var a = el("a", null, s.name);
      a.href = "#sec-" + s.id;
      box.appendChild(a);
    });
  }

  /* ---------- 画：一个框 ---------- */

  function sectionNode(sec, idx) {
    var box = el("section", "sec");
    box.id = "sec-" + sec.id;

    var head = el("div", "sec-head");
    head.appendChild(el("span", "sec-no", "篇" + cn(idx + 1)));
    head.appendChild(el("h2", "sec-name", sec.name));
    if (sec.note) head.appendChild(el("span", "sec-note", sec.note));

    var qs = quotesOf(sec.id);

    if (state.key) {
      var tools = el("div", "sec-tools");
      var bRen = el("button", "btn-mini is-ghost", "改篇名");
      bRen.type = "button";
      bRen.addEventListener("click", function () {
        box.replaceChild(sectionForm(sec, idx), head);
      });
      var bDel = el("button", "btn-mini danger", "删本篇");
      bDel.type = "button";
      bDel.addEventListener("click", function () {
        if (!confirm("要删掉「" + sec.name + "」这一篇吗？\n里面的 " + qs.length + " 条语录会一起没掉。")) return;
        rpc("ly_section_delete", { p_key: state.key, p_id: sec.id })
          .then(function () { toast("已删掉这一篇"); return refresh(); })
          .catch(function (e) { toast("删除失败：" + e.message); });
      });
      tools.appendChild(bRen);
      tools.appendChild(bDel);
      head.appendChild(tools);
    }

    box.appendChild(head);

    if (!qs.length) {
      box.appendChild(el("p", "sec-empty", state.key
        ? "这一篇还空着。点下面加第一条。"
        : "这一篇还空着。"));
    } else {
      var ol = el("ol", "q-list");
      qs.forEach(function (q, i) { ol.appendChild(quoteNode(q, i)); });
      box.appendChild(ol);
    }

    if (state.key) {
      var add = el("button", "btn-mini add-q", "＋ 在本篇添一条");
      add.type = "button";
      add.addEventListener("click", function () {
        add.disabled = true;
        box.appendChild(quoteForm(sec.id, null, function () {
          add.disabled = false;
          refresh();
        }));
        var ta = box.querySelector(".form textarea");
        if (ta) ta.focus();
      });
      box.appendChild(add);
    }

    return box;
  }

  /* ---------- 画：一条语录 ---------- */

  function quoteNode(q, i) {
    var li = el("li", "q");

    var p = el("p", "q-text");
    p.appendChild(el("span", "q-who", q.who));
    p.appendChild(document.createTextNode("曰：「"));
    p.appendChild(el("span", "q-body", q.body));
    p.appendChild(document.createTextNode("」"));
    li.appendChild(p);

    var meta = el("p", "q-meta");
    meta.appendChild(el("span", "q-idx", "其" + cn(i + 1)));

    var scene = q.scene || "";
    var date = fmtDate(q.said_on);
    if (scene && date) {
      meta.appendChild(document.createTextNode(scene));
      meta.appendChild(el("span", "q-sep", "·"));
      meta.appendChild(document.createTextNode(date));
    } else if (scene || date) {
      meta.appendChild(document.createTextNode(scene || date));
    }

    if (state.key) {
      var tools = el("div", "q-tools");
      var bEdit = el("button", "btn-mini is-ghost", "改");
      bEdit.type = "button";
      bEdit.addEventListener("click", function () {
        li.replaceChild(quoteForm(q.section_id, q, function () { refresh(); }), p);
        var ta = li.querySelector("textarea");
        if (ta) ta.focus();
      });
      var bDel = el("button", "btn-mini danger", "删");
      bDel.type = "button";
      bDel.addEventListener("click", function () {
        if (!confirm("删掉这一条？\n\n" + q.who + "曰：「" + q.body + "」")) return;
        rpc("ly_delete", { p_key: state.key, p_id: q.id })
          .then(function (n) {
            if (typeof n === "number" && n === 0) { toast("这条已经不在了，刷新看看"); }
            else { toast("已删掉"); }
            return refresh();
          })
          .catch(function (e) { toast("删除失败：" + e.message); });
      });
      tools.appendChild(bEdit);
      tools.appendChild(bDel);
      meta.appendChild(tools);
    }

    li.appendChild(meta);
    return li;
  }

  /* ---------- 表单：一条语录 ---------- */

  function quoteForm(secId, q, done) {
    var box = el("div", "form");

    var row = el("div", "form-row");

    var fWho = el("label", "field grow");
    fWho.appendChild(el("span", null, "说话人"));
    var inWho = el("input", "in");
    inWho.type = "text";
    inWho.maxLength = 12;
    inWho.value = q ? q.who : "";
    inWho.placeholder = "化名或外号";
    inWho.autocomplete = "off";
    fWho.appendChild(inWho);

    var fScene = el("label", "field grow");
    fScene.appendChild(el("span", null, "场合"));
    var inScene = el("input", "in");
    inScene.type = "text";
    inScene.maxLength = 40;
    inScene.value = q ? (q.scene || "") : "";
    inScene.placeholder = "哪天哪节课";
    inScene.autocomplete = "off";
    fScene.appendChild(inScene);

    var fDate = el("label", "field");
    fDate.appendChild(el("span", null, "日期"));
    var inDate = el("input", "in");
    inDate.type = "date";
    inDate.value = q && q.said_on ? String(q.said_on).slice(0, 10) : "";
    fDate.appendChild(inDate);

    row.appendChild(fWho);
    row.appendChild(fScene);
    row.appendChild(fDate);
    box.appendChild(row);

    var ta = el("textarea", "in");
    ta.maxLength = 200;
    ta.rows = 3;
    ta.placeholder = "原话照录。别改意思，也别把两句拼成一句。";
    ta.value = q ? q.body : "";
    box.appendChild(ta);

    var foot = el("div", "form-foot");
    var counter = el("span", "counter");
    var em = el("em", null, String((q ? q.body : "").length));
    counter.appendChild(em);
    counter.appendChild(document.createTextNode("/200"));

    function syncCount() {
      em.textContent = String(ta.value.length);
      counter.classList.toggle("is-full", ta.value.length >= 200);
    }
    ta.addEventListener("input", syncCount);
    syncCount();
    foot.appendChild(counter);

    var bCancel = el("button", "btn-mini is-ghost", "取消");
    bCancel.type = "button";
    bCancel.addEventListener("click", function () { if (done) done(); });

    var bSave = el("button", "btn-mini is-solid", q ? "保存" : "加上");
    bSave.type = "button";
    bSave.addEventListener("click", function () {
      var who = inWho.value.trim();
      var body = ta.value.trim();
      if (!who) { toast("说话人得写一个，化名就行"); inWho.focus(); return; }
      if (!body) { toast("正文还是空的"); ta.focus(); return; }

      bSave.disabled = true;
      bSave.textContent = "保存中…";
      rpc("ly_save", {
        p_key: state.key,
        p_id: q ? q.id : null,
        p_section: secId,
        p_who: who,
        p_body: body,
        p_scene: inScene.value.trim(),
        p_said: inDate.value || null
      }).then(function () {
        toast(q ? "改好了" : "加上了");
        if (done) done();
      }).catch(function (e) {
        bSave.disabled = false;
        bSave.textContent = q ? "保存" : "加上";
        toast("没存上：" + e.message);
      });
    });

    foot.appendChild(bCancel);
    foot.appendChild(bSave);
    box.appendChild(foot);

    ta.addEventListener("keydown", function (ev) {
      if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") bSave.click();
    });

    return box;
  }

  /* ---------- 表单：一个篇目 ---------- */

  function sectionForm(sec, idx) {
    var box = el("div", "form");

    var row = el("div", "form-row");

    var fName = el("label", "field");
    fName.appendChild(el("span", null, "篇名"));
    var inName = el("input", "in");
    inName.type = "text";
    inName.maxLength = 8;
    inName.value = sec ? sec.name : "";
    inName.placeholder = "比如：课堂";
    fName.appendChild(inName);

    var fNote = el("label", "field grow");
    fNote.appendChild(el("span", null, "一句话说明"));
    var inNote = el("input", "in");
    inNote.type = "text";
    inNote.maxLength = 30;
    inNote.value = sec ? (sec.note || "") : "";
    inNote.placeholder = "可不填，比如：课上说的";
    fNote.appendChild(inNote);

    row.appendChild(fName);
    row.appendChild(fNote);
    box.appendChild(row);

    var foot = el("div", "form-foot");
    var hint = el("span", "counter", sec ? "改完点保存" : "新建一个框");
    foot.appendChild(hint);

    var bCancel = el("button", "btn-mini is-ghost", "取消");
    bCancel.type = "button";
    bCancel.addEventListener("click", function () { refresh(); });

    var bSave = el("button", "btn-mini is-solid", sec ? "保存" : "建一个");
    bSave.type = "button";
    bSave.addEventListener("click", function () {
      var name = inName.value.trim();
      if (!name) { toast("篇名得写一个"); inName.focus(); return; }
      bSave.disabled = true;
      rpc("ly_section_save", {
        p_key: state.key,
        p_id: sec ? sec.id : null,
        p_name: name,
        p_note: inNote.value.trim(),
        p_sort: sec ? (sec.sort || 0) : (state.sections.length + 1)
      }).then(function () {
        toast(sec ? "改好了" : "建好了");
        refresh();
      }).catch(function (e) {
        bSave.disabled = false;
        toast("没存上：" + e.message);
      });
    });

    foot.appendChild(bCancel);
    foot.appendChild(bSave);
    box.appendChild(foot);

    return box;
  }

  /* ---------- 总渲染 ---------- */

  function render() {
    var board = $("board");
    board.innerHTML = "";

    renderToc();

    // 数据库那边还没跑脚本
    if (!state.ready) {
      $("boardEmpty").hidden = false;
      $("boardEmpty").textContent = HAS_BACKEND
        ? "这块还没开通，等管理员把数据库那一步做完就能用了。" +
          "（原始信息：" + state.err + "）"
        : "预览版：还没接数据库。";
      return;
    }

    $("boardEmpty").hidden = state.sections.length > 0;

    if (!state.sections.length) {
      $("boardEmpty").textContent = state.key
        ? "还没有框。点下面的「＋ 新建一个框」开始。"
        : "还没有内容。等编辑同学来写第一条。";
    } else {
      state.sections.forEach(function (s, i) {
        board.appendChild(sectionNode(s, i));
      });
    }

    if (state.key) {
      var wrap = el("div");
      wrap.style.textAlign = "center";
      var b = el("button", "btn-mini is-solid", "＋ 新建一个框");
      b.type = "button";
      b.addEventListener("click", function () {
        b.hidden = true;
        board.appendChild(sectionForm(null, -1));
        var inp = board.querySelector(".form .in");
        if (inp) inp.focus();
      });
      wrap.appendChild(b);
      board.appendChild(wrap);
    }

    renderFoot();
  }

  function renderFoot() {
    var on = !!state.key;
    $("footNote").textContent = on
      ? "编辑中 · 改完立刻生效，全班都能看到"
      : "只读浏览 · 想改就点右边「编辑」";
    $("editBtn").hidden = on;
    $("logoutBtn").hidden = !on;
  }

  function refresh() {
    return loadAll().then(render).catch(function (e) {
      render();
      toast("刷新失败：" + e.message);
    });
  }

  /* ---------- 编辑钥匙 ---------- */

  function readKey() {
    try { return localStorage.getItem(LS_KEY) || ""; } catch (e) { return ""; }
  }

  function writeKey(k) {
    try {
      if (k) localStorage.setItem(LS_KEY, k);
      else localStorage.removeItem(LS_KEY);
    } catch (e) {}
  }

  function openKeyBox() {
    $("keyErr").hidden = true;
    $("keyInput").value = "";
    $("keyLayer").hidden = false;
    setTimeout(function () { $("keyInput").focus(); }, 30);
  }

  function closeKeyBox() { $("keyLayer").hidden = true; }

  function submitKey() {
    var k = $("keyInput").value.trim().toLowerCase();
    var err = $("keyErr");
    if (!k) { err.textContent = "钥匙还没填"; err.hidden = false; return; }

    $("keyOk").disabled = true;
    $("keyOk").textContent = "核对中…";

    rpc("ly_check", { p_key: k }).then(function (ok) {
      $("keyOk").disabled = false;
      $("keyOk").textContent = "进入";

      if (ok !== true) {
        err.textContent = "这把钥匙不对，或者已经被作废了。找管理员再要一把。";
        err.hidden = false;
        return;
      }
      writeKey(k);
      state.key = k;
      closeKeyBox();
      render();
      toast("已进入编辑模式");
    }).catch(function (e) {
      $("keyOk").disabled = false;
      $("keyOk").textContent = "进入";
      err.textContent = "核对没成功：" + e.message;
      err.hidden = false;
    });
  }

  function logout() {
    writeKey("");
    state.key = "";
    render();
    toast("已退出编辑模式，这台设备不再记得钥匙");
  }

  /* ---------- 绑定 ---------- */

  function bind() {
    $("editBtn").addEventListener("click", openKeyBox);
    $("logoutBtn").addEventListener("click", logout);
    $("keyCancel").addEventListener("click", closeKeyBox);
    $("keyMask").addEventListener("click", closeKeyBox);
    $("keyOk").addEventListener("click", submitKey);

    $("keyInput").addEventListener("keydown", function (ev) {
      if (ev.key === "Enter") { ev.preventDefault(); submitKey(); }
      if (ev.key === "Escape") closeKeyBox();
    });

    document.addEventListener("keydown", function (ev) {
      if (ev.key === "Escape" && !$("keyLayer").hidden) closeKeyBox();
    });
  }

  function missingParts() {
    var miss = [];
    REQUIRED_IDS.forEach(function (id) {
      if (!document.getElementById(id)) miss.push(id);
    });
    return miss;
  }

  /* ---------- 启动 ---------- */

  function boot() {
    var miss = missingParts();
    if (miss.length) {
      console.error("缺少元素：" + miss.join(", "));
      document.body.insertAdjacentHTML("afterbegin",
        '<p style="padding:16px;background:#fdecec;color:#8a2b22;font:14px/1.7 sans-serif">' +
        "页面文件没搭配上（缺 " + miss.join("、") + "），多半是浏览器缓存了旧文件。" +
        "按 Ctrl + F5 强制刷新一次；手机上在网址后面加个 ?1 再回车。</p>");
      return;
    }

    bind();

    state.key = readKey();

    refresh().then(function () {
      if (!state.key) return;
      // 钥匙可能在别处被作废了，开机时静默核对一次
      return rpc("ly_check", { p_key: state.key }).then(function (ok) {
        if (ok === true) return;
        state.key = "";
        writeKey("");
        render();
        toast("这把编辑钥匙已经失效了，重新找管理员要一把");
      }).catch(function () {});
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }

})();
