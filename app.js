// ===== 設定値：ここを変えれば人数上限や選択肢を変更できるよ =====
const APP_VERSION = "2026-11-26a"; // 更新のたびに変える目印（古い画面に「更新する」を出すために使う）
const MAX_MEMBERS = 15;
const SIZE_WARN = 700 * 1024, SIZE_MAX = 1000 * 1024; // データの大きさの目安（GitHubで同期できるのは約1MBまで）
const DUE_DAYS = 3; // 期限が「近い」とみなす日数（変えたい時はここの数字を書き換える）
const STATUS = [["todo","○","未着手"],["doing","◐","進行中"],["review","◎","レビュー待ち"],["done","●","完了"]];
const CATS = ["企画","プログラム","グラフィック","サウンド","シナリオ","テスト"];
const PRI = {high:"高",mid:"中",low:"低"};
const THEMES = {mint:"ぷにぷにミント",cream:"やさしいクリーム",mist:"霧のブルー",peach:"ピーチ",lavender:"ラベンダー",forest:"森の集落",night:"やさしいナイト",charcoal:"チャコール",retro:"ドットレトロ"};
const COLORS = ["#FFB4A2","#FFD27D","#B5E48C","#8ED1E8","#C3B1E1","#F7A8D0","#9BE3C9","#E6C79C"];

// ===== 便利な小道具 =====
const $ = id => document.getElementById(id);
const uid = () => Math.random().toString(36).slice(2,9);
// ユーザーの入力を安全に表示するための変換（HTMLとして解釈されないようにする）
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const opts = (arr, sel) => arr.map(([v,l]) => `<option value="${esc(v)}"${v===sel?" selected":""}>${esc(l)}</option>`).join("");
// 保存先が使えない場合でも落ちないように try/catch で包む
const get = k => { try { return localStorage.getItem(k); } catch(e) { return null; } };
const set = (k,v) => { try { localStorage.setItem(k,v); } catch(e) {} };

let db, filter = "", editing = null;
// ===== 検索と絞り込み（ボードとガントの両方に効く） =====
let F = {q:"", cat:"", ph:"", pri:"", due:""};
const filtering = () => Object.values(F).some(Boolean);
function passes(t){
  if(F.cat && t.cat !== F.cat) return false;
  if(F.ph && t.phase !== F.ph) return false;
  if(F.pri && t.pri !== F.pri) return false;
  if(F.q && !(t.title + " " + (t.memo || "") + " " + t.cat + " " + (t.phase || "")).toLowerCase().includes(F.q.toLowerCase())) return false;
  if(F.due){
    const today = ymd(new Date()), wk = new Date(); wk.setDate(wk.getDate() + 7);
    if(F.due === "none") return !t.due;
    if(!t.due) return false;
    if(F.due === "late") return t.due < today && t.status !== "done";
    if(F.due === "week") return t.due >= today && t.due <= ymd(wk);
  }
  return true;
}
const CARD_LIMIT = 50; // 1つの列に最初に出すカードの数（多いときは「さらに表示」で増やす）
// 「待ち」の判定：先に終わらせたいタスクのうち、まだ終わっていないもの
const blockers = (p, t) => t.status === "done" ? [] : (t.deps || []).map(id => p.tasks.find(x => x.id === id)).filter(x => x && !x.deleted && x.status !== "done");
// 順番指定がぐるぐる回っていないか（Aは Bを待ち、BはAを待つ、など）を調べる
function wouldCycle(p, id, deps){
  const seen = new Set(), go = x => { if(x === id) return true; if(seen.has(x)) return false; seen.add(x); const t = p.tasks.find(y => y.id === x); return !!t && (t.deps || []).some(go); };
  return deps.some(go);
}
let more = {}, feedShow = 30; const limitOf = k => CARD_LIMIT + (more[k] || 0);
let hideDone = get("gtm-hidedone") === "1"; // 完了タスクを隠すか（自分のブラウザに記憶される）

// ===== データの読み込みと保存 =====
function sample(){
  const m = ["ゆう","みく","けん"].map(n => ({id:uid(), name:n}));
  const T = (title,cat,pri,status,a) => ({id:uid(),title,cat,pri,status,assignee:a,due:"",memo:""});
  return {current:"p1", me:"", projects:[{id:"p1", name:"スライム冒険（サンプル）", theme:"mint", specUrl:"", members:m, feed:[],
    tasks:[T("ジャンプの挙動を調整","プログラム","high","doing",m[0].id), T("ステージ1のマップ作成","グラフィック","mid","todo",m[1].id),
           T("スライムの移動アニメ","グラフィック","mid","done",m[1].id), T("集落のBGM案","サウンド","low","review",m[2].id)]}]};
}
function load(){
  db = Store.read(); // 保存先は Store にまとめてある（後でフォルダ保存やオンライン保存に差し替えやすい）
  if(!db || !db.projects || !db.projects.length){ db = sample(); db.projects[0].tasks = []; db.projects[0].members = []; } // 最初は空のプロジェクトから始める
  db = migrate(db); // データの形を最新版にそろえる
  purgeTrash(); // ゴミ箱の古いタスクを消す
  // 以前のサンプルを「わんだーすらいむ」に変える（手を加えていないサンプルの中身は空にする）
  const ST = ["ジャンプの挙動を調整","ステージ1のマップ作成","スライムの移動アニメ","集落のBGM案"], SM = ["ゆう","みく","けん"];
  db.projects.forEach(p => {
    if(p.name !== "スライム冒険（サンプル）") return;
    p.name = "わんだーすらいむ";
    if(p.tasks.length === 4 && p.tasks.every(t => ST.includes(t.title))){ p.tasks = []; p.feed = []; }
    if(!p.tasks.length && p.members.length === 3 && p.members.every(m => SM.includes(m.name))) p.members = [];
  });
  save(); snapAll();
}
// 保存先をまとめた部分：今はブラウザ内保存。ここを入れ替えるだけで保存先を変えられる
const Store = {
  read(){ try { return JSON.parse(get("gtm-data")); } catch(e) { return null; } },
  write(d){ set("gtm-data", JSON.stringify(d)); }
};
function save(){ db.mtime = Date.now(); Store.write(db); scheduleSync(); } // 保存のついでに、更新時刻を記録して、自動同期も予約する

// データの形のバージョン管理：形を変えたら d.v を増やして、下に移行処理を足す
function migrate(d){
  if(!d.v) d.v = 1;
  if(d.v < 2){ // v2：タスクに「更新日時・更新者・削除の印」を追加
    d.projects.forEach(p => p.tasks.forEach(t => { t.updatedAt = t.updatedAt || 0; t.updatedBy = t.updatedBy || ""; t.deleted = !!t.deleted; }));
    d.v = 2;
  }
  if(d.v < 3){ d.projects.forEach(p => { p.milestones = p.milestones || []; }); d.v = 3; } // v3：最終目標（マイルストーン）を追加
  if(d.v < 4){ // v4：日記の「完了タスク」を、本文から別の欄(done)に分ける
    d.projects.forEach(p => (p.diary || []).forEach(x => { const i = (x.body || "").indexOf("【完了したタスク】"); if(i >= 0){ x.done = x.body.slice(i).split("\n").slice(1).filter(l => l.startsWith("・")).map(l => l.slice(1)); x.body = x.body.slice(0, i).trimEnd(); } }));
    d.v = 4;
  }
  if(d.v < 5){ d.projects.forEach(p => { p.assets = p.assets || []; p.tests = p.tests || []; p.versions = p.versions || []; }); d.v = 5; } // v5：素材・プレイテスト・バージョンを追加（タスクのサブタスク/順番指定は、無くても動く）
  return d;
}
// 読み込んだJSONがちゃんとした形かを確かめる
const isValid = d => d && Array.isArray(d.projects) && d.projects.length > 0 &&
  d.projects.every(p => p && typeof p.id === "string" && typeof p.name === "string" && Array.isArray(p.tasks) && Array.isArray(p.members) && Array.isArray(p.feed));
const cur = () => db.projects.find(p => p.id === db.current) || db.projects[0];
// 更新フィードに1行追加する（誰が・いつ・何をしたか）
// 更新フィードに1行追加する。同じ人が同じことを10分以内に繰り返したら、1行にまとめる（×回数）
function log(text){
  const p = cur(), who = db.me || "だれか", now = Date.now(), top = p.feed[0];
  if(top && top.who === who && top.text === text && now - top.t < 6e5){ top.n = (top.n || 1) + 1; top.t = now; return; }
  p.feed.unshift({t:now, who, text});
  if(p.feed.length > 100){ p.feedCut = (p.feedCut || 0) + p.feed.length - 100; p.feed = p.feed.slice(0, 100); } // 古いものは省略して、件数だけ覚えておく
}
// ===== 元に戻す（タスク・日記・予定の変更を、最大20回さかのぼれる） =====
// 変更前の中身を、1件ずつ文字にして覚えておく。メンバーや目標などの変更は対象外
const UNDO_KINDS = [["tasks","タスク"],["diary","日記"],["events","予定"],["assets","素材"],["tests","プレイテスト"],["versions","バージョン"],["sessions","作業"]];
let undoStack = [], lastSnap = {};
const snapProject = p => { const o = {}; UNDO_KINDS.forEach(([k]) => { o[k] = {}; (p[k] || []).forEach(i => o[k][i.id] = JSON.stringify(i)); }); return o; };
const snapAll = () => { lastSnap = {}; db.projects.forEach(p => lastSnap[p.id] = snapProject(p)); }; // 読み込み・同期のあとに、今の状態を「基準」にし直す
// 変更のあとに呼ぶ：基準と今を比べて、変わった所だけを「元に戻す」用に積む
function trackUndo(text){
  const p = cur(), prev = lastSnap[p.id], now = snapProject(p); lastSnap[p.id] = now;
  if(!prev) return;
  const changes = [];
  UNDO_KINDS.forEach(([k]) => new Set([...Object.keys(prev[k]), ...Object.keys(now[k])]).forEach(id => { if(prev[k][id] !== now[k][id]) changes.push({k, id, before: prev[k][id] || null}); }));
  if(!changes.length) return;
  undoStack.push({pid:p.id, label: text || (changes.some(c => c.k === "diary") ? "日記の変更" : "予定の変更"), changes});
  if(undoStack.length > 20) undoStack.shift();
}
function undoLast(){
  const u = undoStack.pop(); if(!u) return;
  const p = db.projects.find(x => x.id === u.pid); if(!p) return render();
  const now = Date.now();
  u.changes.forEach(c => {
    const arr = p[c.k] = p[c.k] || [], i = arr.findIndex(x => x.id === c.id);
    if(c.before){ const item = JSON.parse(c.before); item.updatedAt = now; item.updatedBy = db.me || ""; i >= 0 ? arr[i] = item : arr.push(item); } // 元の中身に戻す（同期で負けないよう、更新日時は今にする）
    else if(i >= 0){ arr[i].deleted = true; arr[i].updatedAt = now; } // 「追加」を取り消す＝消した印を付ける
  });
  db.current = p.id; lastSnap[p.id] = snapProject(p);
  log("元に戻した：" + u.label); save(); render();
}
function commit(text, noUndo){ if(!noUndo) trackUndo(text); if(text) log(text); save(); render(); }
$("undo").onclick = undoLast;
// Ctrl+Z（Macは⌘+Z）でも戻せる。文字を入力している時と、ダイアログを開いている時は、ふつうの動きにする
document.addEventListener("keydown", e => {
  if((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "z" && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName || "") && !document.querySelector("dialog[open]")){ e.preventDefault(); undoLast(); }
});

// 担当者の色つきマーク（色だけでなく頭文字でも区別する）
function dot(p, id){
  const i = p.members.findIndex(m => m.id === id);
  if(i < 0) return `<span class="dot" style="background:#ddd">?</span>`;
  return `<span class="dot" style="background:${COLORS[i % COLORS.length]}">${esc(p.members[i].name.slice(0,1))}</span>`;
}

// ===== 画面の描画 =====
function render(){
  const p = cur(); db.current = p.id;
  const solo = p.mode === "solo"; // 個人モードかどうか（古いデータは mode が無いのでチーム扱い）
  $("prj").innerHTML = opts(db.projects.map(x => [x.id, x.name]), p.id);
  // テーマ：自分で選んだもの → プロジェクトの標準 → 端末の明暗、の順で決まる
  const eff = get("gtm-theme") || p.theme || (matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "mint");
  document.documentElement.dataset.theme = eff;
  $("thm").innerHTML = opts(Object.entries(THEMES), eff);
  $("pTheme").innerHTML = opts(Object.entries(THEMES), p.theme);
  const okUrl = /^https:\/\//i.test(p.specUrl || ""); $("spec").hidden = !okUrl; $("spec").href = okUrl ? p.specUrl : "#";
  $("specUrl").value = p.specUrl || "";

  $("chips").innerHTML = `<button class="chip${filter?"":" on"}" data-f="">全員</button>` +
    p.members.map(m => `<button class="chip${filter===m.id?" on":""}" data-f="${m.id}">${dot(p,m.id)} ${esc(m.name)}</button>`).join("");

  const today = ymd(new Date());
  const order = {high:0, mid:1, low:2};
  const sub = t => (t.subs && t.subs.length) ? `<span class="tag" title="サブタスク">☑ ${t.subs.filter(s => s.done).length}/${t.subs.length}</span>` : "";
  const wait = t => { const b = blockers(p, t); return b.length ? `<span class="tag" title="先に終わらせる：${esc(b.map(x => x.title).join("、"))}">🔒 待ち</span>` : ""; };
  $("board").innerHTML = STATUS.filter(s => !(hideDone && s[0] === "done")).map(([k,icon,label]) => {
    const list = p.tasks.filter(t => !t.deleted && t.status===k && (!filter || t.assignee===filter) && passes(t))
      .sort((a,b) => order[a.pri]-order[b.pri] || (a.due||"9").localeCompare(b.due||"9"));
    return `<div class="col" data-st="${k}"><h3><span>${icon} ${label}</span><span>${list.length}</span></h3><div class="list">` +
      (list.slice(0, limitOf(k)).map(t => `<div class="card" data-id="${t.id}" draggable="true" tabindex="0" role="group" aria-label="${esc(t.title)}"><b>${esc(t.title)}</b>
        <div class="meta"><span class="tag">${esc(t.cat)}</span><span class="tag">優先 ${PRI[t.pri]}</span>${t.phase ? `<span class="tag">${esc(t.phase)}</span>` : ""}${t.est ? `<span class="tag">${t.est}h</span>` : ""}${sub(t)}${wait(t)}${/^https:\/\//i.test(t.spec || "") ? `<a class="tag" href="${esc(t.spec)}" target="_blank" rel="noopener" aria-label="仕様書を開く">📄 仕様書</a>` : ""}${solo ? "" : dot(p,t.assignee)}
        ${t.due ? (t.due < today && t.status!=="done" ? `<span class="late">期限切れ ${esc(t.due)}</span>` : `<span>〜${esc(t.due)}</span>`) : ""}</div>
        <div class="mv"><button data-mv="-1" aria-label="左の列へ">◀</button><button data-mv="1" aria-label="右の列へ">▶</button></div></div>`).join("") || `<p class="sub">なし</p>`) + (list.length > limitOf(k) ? `<button class="more" data-more="${k}">さらに ${list.length - limitOf(k)}件を表示</button>` : "") + `</div></div>`;
  }).join("");

  $("feed").innerHTML = p.feed.slice(0, feedShow).map(f =>
    `<li><span class="sub">${new Date(f.t).toLocaleString("ja-JP",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"})}</span> <b>${esc(f.who)}</b> ${esc(f.text)}${f.n > 1 ? ` <span class="sub">（×${f.n}）</span>` : ""}</li>`).join("")
    + (p.feed.length > feedShow ? `<li><button id="feedMore">さらに${Math.min(30, p.feed.length - feedShow)}件を表示</button></li>` : "")
    + (p.feedCut ? `<li class="sub">これより古い更新 ${p.feedCut}件は省略したよ</li>` : "")
    || `<li class="sub">まだ更新はないよ。タスクを動かすとここに記録される。</li>`;

  const known = a => [...new Set(a.filter(Boolean))];
  $("fcat").innerHTML = opts([["","カテゴリ：すべて"], ...known([...catsOf(p), ...p.tasks.map(t => t.cat)]).map(c => [c, c])], F.cat);
  $("fph").innerHTML = opts([["","工程：すべて"], ...known([...phasesOf(p), ...p.tasks.map(t => t.phase)]).map(c => [c, c])], F.ph);
  $("fpri").innerHTML = opts([["","優先度：すべて"], ...Object.entries(PRI).map(([k, v]) => [k, "優先度：" + v])], F.pri);
  $("fdue").innerHTML = opts([["","期限：すべて"],["late","期限切れ"],["week","7日以内"],["none","期限なし"]], F.due);
  $("fclr").hidden = !filtering();
  $("fcnt").textContent = filtering() ? `絞り込み中：${p.tasks.filter(t => !t.deleted && (!filter || t.assignee === filter) && passes(t)).length}件` : "";
  renderSize(); renderConf();
  const ul = undoStack[undoStack.length - 1]; $("undo").disabled = !ul; $("undo").title = ul ? "元に戻す：" + ul.label : "戻せる操作はまだないよ";
  $("cnt").textContent = `(${p.members.length}/${MAX_MEMBERS})`;
  $("mem").innerHTML = p.members.map(m => `<div class="row" style="margin:2px 0">${dot(p,m.id)} ${esc(m.name)} <button data-rm="${m.id}" aria-label="${esc(m.name)}を削除">削除</button></div>`).join("");
  $("me").innerHTML = opts([["","未選択"], ...p.members.map(m => [m.name, m.name])], db.me);
  renderAlert(); updateNotif(); renderReport(); renderMs(); backupNote(); renderTrash(); if(tab === "gantt") renderSched(); if(tab === "diary") renderDiary(); if(tab === "prod") renderProd(); renderTpl(); applyTab(); applyStab();
  // 個人/チームで表示を切り替える
  $("pMode").innerHTML = opts([["team","チーム"],["solo","個人"]], p.mode || "team");
  $("feedOn").checked = p.feedOn !== false;
  $("feedBox").hidden = p.feedOn === false;
  $("chips").style.display = solo ? "none" : "";
  $("whoBox").hidden = solo;
  $("pName").value = p.name;
  $("catIn").value = catsOf(p).join(", "); $("phIn").value = phasesOf(p).join(", ");
  $("evCatIn").value = evCats(p).join(", "); $("evShowIn").value = evShow(p).join(", ");
  $("delP").disabled = db.projects.length < 2; // 最後の1つは消せない
  delArm = false; $("delMsg").textContent = "";
  $("hd").textContent = hideDone ? `完了を表示する（${p.tasks.filter(t => !t.deleted && t.status === "done").length}件）` : "完了を隠す";
  document.querySelectorAll(".teamOnly").forEach(e => e.hidden = solo);
}

// ===== タスクの編集ダイアログ =====
let eSubs = [], eDeps = []; // 編集中のサブタスクと、「先に終わらせる」タスクのID（保存するまで本体には入れない）
function renderSubs(){
  $("fSubs").innerHTML = eSubs.map((s, i) => `<div class="row subr"><input type="checkbox" data-sc="${i}"${s.done ? " checked" : ""} aria-label="完了"><input data-stx="${i}" value="${esc(s.t)}" aria-label="サブタスクの内容"><button type="button" data-sd="${i}" aria-label="削除">×</button></div>`).join("");
}
function renderDeps(){
  const others = cur().tasks.filter(t => !t.deleted && t.id !== editing.id).sort((a, b) => (a.status === "done") - (b.status === "done"));
  $("fDeps").innerHTML = others.map(t => `<label class="sub"><input type="checkbox" data-dp="${t.id}"${eDeps.includes(t.id) ? " checked" : ""}> ${esc(t.title)}${t.status === "done" ? "（完了）" : ""}</label>`).join("") || '<span class="sub">ほかのタスクがまだないよ</span>';
}
function addSub(){ const v = $("fSubIn").value.trim(); if(!v) return; eSubs.push({id:uid(), t:v, done:false}); $("fSubIn").value = ""; renderSubs(); }
$("fSubAdd").onclick = addSub;
$("fSubIn").onkeydown = e => { if(e.key === "Enter" && !e.isComposing && e.keyCode !== 229){ e.preventDefault(); addSub(); } }; // 日本語の変換中の Enter は無視する
$("fSubs").onchange = e => { const i = e.target.dataset.sc; if(i != null) eSubs[i].done = e.target.checked; };
$("fSubs").oninput = e => { const i = e.target.dataset.stx; if(i != null) eSubs[i].t = e.target.value; };
$("fSubs").onclick = e => { const i = e.target.dataset.sd; if(i != null){ eSubs.splice(i, 1); renderSubs(); } };
$("fDeps").onchange = e => { const id = e.target.dataset.dp; if(!id) return; eDeps = e.target.checked ? [...eDeps, id] : eDeps.filter(x => x !== id); };
function openEdit(id){
  const p = cur();
  editing = p.tasks.find(t => t.id === id) || {id:uid(), title:"", cat:catsOf(p)[1] || catsOf(p)[0], pri:"mid", status:"todo", assignee:"", due:"", memo:"", isNew:true};
  $("fTitle").value = editing.title; $("fPhase").innerHTML = opts([["","なし"], ...[...new Set([...phasesOf(p), editing.phase || ""])].filter(Boolean).map(c => [c,c])], editing.phase || ""); $("fEst").value = editing.est || ""; $("fCat").innerHTML = opts([...new Set([...catsOf(p), editing.cat])].map(c => [c,c]), editing.cat);
  $("fPri").innerHTML = opts(Object.entries(PRI), editing.pri);
  $("fSt").innerHTML = opts(STATUS.map(s => [s[0], s[1]+" "+s[2]]), editing.status);
  $("fWho").innerHTML = opts([["","未定"], ...p.members.map(m => [m.id, m.name])], editing.assignee);
  $("fSpec").value = editing.spec || ""; $("fStart").value = editing.start || ""; $("fDue").value = editing.due; $("fMemo").value = editing.memo;
  eSubs = JSON.parse(JSON.stringify(editing.subs || [])); eDeps = [...(editing.deps || [])]; $("fSubIn").value = ""; renderSubs(); renderDeps();
  $("err").textContent = ""; $("del").hidden = !!editing.isNew; $("dlg").showModal();
}
$("save").onclick = () => {
  const title = $("fTitle").value.trim();
  if(!title){ $("err").textContent = "タスク名を入力してね"; return; }
  const sd = $("fStart").value, dd = $("fDue").value;
  if(sd && dd && sd > dd){ $("err").textContent = "開始日は期限より前にしてね"; return; }
  const sp = $("fSpec").value.trim(); // 安全のため https:// のリンクだけ許可する
  if(sp && !/^https:\/\//i.test(sp)){ $("err").textContent = "仕様書リンクは https:// から始まるものだけ使えるよ"; return; }
  const p = cur(), t = editing, oldSt = t.status;
  const subs = eSubs.filter(s => s.t.trim()).map(s => ({id:s.id || uid(), t:s.t.trim(), done:!!s.done}));
  const deps = eDeps.filter(id => p.tasks.some(x => x.id === id && !x.deleted));
  if(wouldCycle(p, t.id, deps)){ $("err").textContent = "順番がぐるぐる回ってしまうよ（相手もこのタスクを待っている）"; return; }
  Object.assign(t, {subs, deps, title, cat:$("fCat").value, pri:$("fPri").value, status:$("fSt").value, assignee:$("fWho").value, phase:$("fPhase").value, est:Number($("fEst").value) || 0, spec:sp, start:$("fStart").value, due:$("fDue").value, memo:$("fMemo").value, updatedAt:Date.now(), updatedBy:db.me || ""});
  let msg = `「${title}」を編集`;
  if(t.isNew){ delete t.isNew; p.tasks.push(t); msg = `「${title}」を追加`; }
  else if(oldSt !== t.status) msg = `「${title}」を ${STATUS.find(s=>s[0]===t.status)[2]} にした`;
  $("dlg").close(); commit(msg);
  if(t.status === "done" && oldSt !== "done") celebrate();
};
$("cancel").onclick = () => $("dlg").close();
$("del").onclick = () => { // 削除は「消した印」を付けるだけ（Gitで合流しても復活しにくい）
  editing.deleted = true; editing.updatedAt = Date.now(); editing.updatedBy = db.me || "";
  $("dlg").close(); commit(`「${editing.title}」を削除`);
};

// ===== ボタン操作 =====
$("add").onclick = () => openEdit();
$("fq").oninput = e => { F.q = e.target.value.trim(); render(); };
[["fcat","cat"],["fph","ph"],["fpri","pri"],["fdue","due"]].forEach(([id, k]) => $(id).onchange = e => { F[k] = e.target.value; render(); });
$("fclr").onclick = () => { F = {q:"", cat:"", ph:"", pri:"", due:""}; $("fq").value = ""; render(); };
$("board").onclick = e => {
  if(e.target.closest("a")) return; // 仕様書リンクを押したときは、編集画面を開かない
  const card = e.target.closest(".card"); if(!card) return;
  const mv = e.target.closest("[data-mv]");
  if(!mv) return openEdit(card.dataset.id);
  const t = cur().tasks.find(x => x.id === card.dataset.id);
  const i = STATUS.findIndex(s => s[0] === t.status) + Number(mv.dataset.mv);
  if(i < 0 || i >= STATUS.length) return;
  t.status = STATUS[i][0]; t.updatedAt = Date.now(); t.updatedBy = db.me || ""; commit(`「${t.title}」を ${STATUS[i][2]} に移動`);
  if(t.status === "done") celebrate();
};
$("chips").onclick = e => { const b = e.target.closest("[data-f]"); if(b){ filter = b.dataset.f; render(); } };
$("prj").onchange = e => { db.current = e.target.value; filter = ""; F = {q:"", cat:"", ph:"", pri:"", due:""}; $("fq").value = ""; save(); render(); };
$("thm").onchange = e => { set("gtm-theme", e.target.value); render(); };
$("pTheme").onchange = e => { cur().theme = e.target.value; set("gtm-theme", ""); commit(`標準テーマを「${THEMES[e.target.value]}」にした`); };
$("specUrl").onchange = e => {
  const u = e.target.value.trim(); // 安全のため https:// のリンクだけ許可する
  if(u && !/^https:\/\//i.test(u)){ e.target.value = cur().specUrl || ""; $("specMsg").textContent = "仕様書のURLは https:// から始まるものだけ使えるよ"; return; }
  cur().specUrl = u; commit("仕様書のリンクを更新");
};
$("me").onchange = e => { db.me = e.target.value; save(); render(); };
$("addM").onclick = () => {
  const p = cur(), n = $("newM").value.trim();
  if(!n || p.members.length >= MAX_MEMBERS) return;
  p.members.push({id:uid(), name:n}); $("newM").value = ""; commit(`メンバー「${n}」を追加`);
};
$("mem").onclick = e => {
  const id = e.target.dataset.rm; if(!id) return;
  const p = cur(); p.members = p.members.filter(m => m.id !== id); (db.gone = db.gone || {})[id] = Date.now();
  p.tasks.forEach(t => { if(t.assignee === id) t.assignee = ""; }); commit("メンバーを削除");
};
$("addP").onclick = () => {
  const n = $("newP").value.trim(); if(!n) return;
  const old = cur(), p = {id:uid(), name:n, theme:old.theme, specUrl:"", members:$("keepM").checked ? JSON.parse(JSON.stringify(old.members)) : [], tasks:[], feed:[]};
  db.projects.push(p); db.current = p.id; $("newP").value = ""; filter = ""; commit(`プロジェクト「${n}」を作成`);
};
// 書き出し・読み込み：ファイル保存は使えないので、テキストをコピーして使う
$("exp").onclick = () => { $("json").value = JSON.stringify(db, null, 1); $("json").select(); $("msg").textContent = "コピーして保存してね"; };
$("imp").onclick = () => {
  try { const d = JSON.parse($("json").value); if(!isValid(d)) throw 0; db = migrate(d); if(!db.projects.some(p => p.id === db.current)) db.current = db.projects[0].id; save(); snapAll(); undoStack = []; render(); $("msg").textContent = "読み込んだよ"; }
  catch(e) { $("msg").textContent = "JSONの形式が違うみたい"; }
};

// ===== 期限が近いタスクのお知らせ =====
// 日付を「2026-11-18」の形にする（日本時間のズレが出ないよう、端末の日付を使う）
const ymd = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`;

// 「未完了」で「期限がDUE_DAYS日以内（期限切れ含む）」のタスクを集める
function dueTasks(){
  const p = cur(), limit = new Date(); limit.setDate(limit.getDate() + DUE_DAYS);
  // 設定で「あなたの名前」を選んでいれば、自分の担当だけに絞る
  const mine = p.mode === "solo" ? null : p.members.find(m => m.name === db.me);
  return p.tasks.filter(t => !t.deleted && t.due && t.status !== "done" && t.due <= ymd(limit) && (!mine || t.assignee === mine.id))
    .sort((a,b) => a.due.localeCompare(b.due));
}

// 画面の上に出すお知らせ欄
function renderAlert(){
  const box = $("alert"), list = dueTasks(), today = ymd(new Date());
  box.hidden = !list.length;
  if(!list.length) return;
  const own = cur().members.some(m => m.name === db.me);
  const canAsk = "Notification" in window && Notification.permission === "default";
  box.innerHTML = `<h3>期限が近いタスク（${DUE_DAYS}日以内）${list.length}件</h3>` +
    `<p class="sub" ${cur().mode === "solo" ? "hidden" : ""}>${own ? "あなたの担当だけ表示中" : "全員分を表示中（設定で名前を選ぶと自分の分だけになるよ）"}</p><ul>` +
    list.map(t => `<li>${cur().mode === "solo" ? "" : dot(cur(), t.assignee)} ${esc(t.title)} ${t.due < today ? `<span class="late">期限切れ ${esc(t.due)}</span>` : `<span class="tag">〜${esc(t.due)}</span>`}</li>`).join("") + `</ul>` +
    (canAsk ? `<button id="ask" style="margin-top:8px">デスクトップ通知を許可する</button>` : "");
  // 許可ボタン：押すとブラウザが許可の確認を出す
  if($("ask")) $("ask").onclick = () => Promise.resolve(Notification.requestPermission()).then(() => { renderAlert(); notifyOnce(); }).catch(() => {});
}

// ブラウザのデスクトップ通知（開いたときに1回だけ出す）
let notified = false;
function notifyOnce(){
  if(notified || !("Notification" in window) || Notification.permission !== "granted") return;
  const list = dueTasks(); if(!list.length) return;
  notified = true;
  try { new Notification("期限が近いタスクが" + list.length + "件あるよ", {body: list.slice(0,3).map(t => t.title + "（" + t.due + "）").join("\n")}); } catch(e) {}
}

// ===== 最終目標のカウントダウンと図（グラフ） =====
// カテゴリと工程（フェーズ）：プロジェクトごとに変えられる。未設定のときは標準のものを使う
const PHASES = ["企画","プロトタイプ","本制作","デバッグ","リリース"];
const catsOf = p => (p.cats && p.cats.length ? p.cats : CATS);
const phasesOf = p => (p.phases && p.phases.length ? p.phases : PHASES);
const SEG = {todo:"var(--bd)", doing:"var(--sub);opacity:.55", review:"var(--sub)", done:"var(--ac)"};
const dayText = d => d > 0 ? `あと ${d}日` : d === 0 ? "今日！" : `${-d}日すぎた`;
// 目標・件数・グラフに必要な数字をまとめて計算する（画面表示と画像の書き出しの両方で使う）
function repData(){
  const p = cur(), ts = p.tasks.filter(t => !t.deleted), today = new Date(); today.setHours(0,0,0,0);
  const cnt = {}; STATUS.forEach(([k]) => cnt[k] = ts.filter(t => t.status === k).length);
  const ms = (p.milestones || []).slice().sort((a,b) => a.date.localeCompare(b.date));
  const days = m => Math.round((new Date(m.date + "T00:00:00") - today) / 864e5);
  const next = ms.find(m => days(m) >= 0) || ms[ms.length - 1]; // いちばん近い未来の目標（なければ最後の目標）
  return {p, ts, cnt, ms, next, days, n:ts.length, pct: ts.length ? Math.round(cnt.done / ts.length * 100) : 0,
    left: next ? ts.filter(t => t.status !== "done" && t.due && t.due <= next.date).length : 0,
    cats: [...new Set([...catsOf(p), ...ts.map(t => t.cat)])].map(c => [c, ts.filter(t => t.cat === c && t.status === "done").length, ts.filter(t => t.cat === c).length]).filter(r => r[2]),
    phases: [...new Set([...phasesOf(p), ...ts.map(t => t.phase).filter(Boolean)])].map(c => [c, ts.filter(t => t.phase === c && t.status === "done").length, ts.filter(t => t.phase === c).length]).filter(r => r[2]),
    estAll: ts.reduce((s, t) => s + (t.est || 0), 0), estDone: ts.filter(t => t.status === "done").reduce((s, t) => s + (t.est || 0), 0),
    mem: p.mode === "solo" ? [] : p.members.map(m => [m.name, ts.filter(t => t.assignee === m.id && t.status !== "done").length]),
    open: ts.filter(t => t.status !== "done").sort((a,b) => (a.due || "9").localeCompare(b.due || "9"))};
}
// 画面に出すカウントダウンと棒グラフ
function renderReport(){
  const R = repData();
  const others = R.ms.filter(m => m !== R.next); // いちばん近い目標以外は、右側にカードで並べる
  $("cd").innerHTML = R.next ? `<div class="cd"><div class="bigbadge">${dayText(R.days(R.next))}</div><div><b>${esc(R.next.name)}</b> <span class="sub">${esc(R.next.date)}</span><br><span class="sub">それまでが期限の未完了タスク：${R.left}件</span></div>` +
    (others.length ? `<div class="cdr">${others.map(m => `<div class="cdm"><span class="sub">${esc(m.name)}</span><b>${R.days(m) >= 0 ? "あと" + R.days(m) + "日" : "終了"}</b><span class="sub">${esc(m.date)}</span></div>`).join("")}</div>` : "") + `</div>`
    : `<p class="sub">最終目標がまだないよ。設定の「最終目標」で「α版提出」などを決めてね。</p>`;
  // 1行ぶんの棒グラフ：左に名前、真ん中に棒、右に数字（どの項目も同じ並びにそろえる）
  const rowB = (label, inner, right) => `<div class="crow"><span>${esc(label)}</span><div class="bar">${inner}</div><span>${right}</span></div>`;
  const row = (label, w, right) => rowB(label, `<div class="seg" style="width:${w}%;background:var(--ac)"></div>`, right);
  // 項目ごとの枠（見出し＋中身）
  const sec = (title, body) => `<div class="sec"><h4>${title}</h4>${body}</div>`;
  const stack = R.n ? STATUS.map(([k]) => `<div class="seg" style="width:${R.cnt[k] / R.n * 100}%;background:${SEG[k]}"></div>`).join("") : "";
  const mx = Math.max(1, ...R.mem.map(r => r[1]));
  $("charts").innerHTML =
    sec(`全体（完了 ${R.cnt.done}/${R.n}件）`, row("完了率", R.pct, R.pct + "%") + rowB("内訳", stack, R.n + "件") +
      `<div class="sub legend">${STATUS.map(([k,i,l]) => `${i} ${l} ${R.cnt[k]}`).join("　")}</div>`) +
    (R.estAll ? sec("見積時間", row("完了", R.estDone / R.estAll * 100, `${R.estDone}/${R.estAll}h`)) : "") +
    (R.phases.length ? sec("工程ごとの完了", R.phases.map(([c,d,t]) => row(c, d / t * 100, d + "/" + t)).join("")) : "") +
    sec("カテゴリごとの完了", R.cats.map(([c,d,t]) => row(c, d / t * 100, d + "/" + t)).join("") || '<p class="sub">タスクがまだないよ</p>') +
    (R.mem.length ? sec("担当者ごとの未完了", R.mem.map(([m,k]) => row(m, k / mx * 100, k + "件")).join("")) : "");
}
// 設定欄：目標の一覧・追加・削除
function renderMs(){
  $("msList").innerHTML = (cur().milestones || []).map(m => `<div class="row" style="margin:2px 0">${esc(m.name)} <span class="sub">${esc(m.date)}</span> <button data-msrm="${m.id}" aria-label="${esc(m.name)}を削除">削除</button></div>`).join("") || '<p class="sub">まだないよ</p>';
}
$("msAdd").onclick = () => {
  const n = $("msName").value.trim(), d = $("msDate").value; if(!n || !d) return;
  const p = cur(); (p.milestones = p.milestones || []).push({id:uid(), name:n, date:d}); $("msName").value = ""; commit(`目標「${n}」（${d}）を追加`);
};
$("msList").onclick = e => { const id = e.target.dataset.msrm; if(!id) return; const p = cur(); p.milestones = p.milestones.filter(m => m.id !== id); (db.gone = db.gone || {})[id] = Date.now(); commit("目標を削除"); };

// 画像(PNG)とPDFの書き出し：レポートを<canvas>に絵として描いて、それを保存する
function drawReport(){
  const R = repData(), css = getComputedStyle(document.documentElement), v = n => css.getPropertyValue(n).trim();
  const rows = R.open.slice(0, 30), W = 720, H = Math.max(760, 400 + (R.cats.length + R.mem.length + R.phases.length) * 26 + (R.phases.length ? 30 : 0) + (R.estAll ? 56 : 0) + rows.length * 24 + 40);
  const c = document.createElement("canvas"); c.width = W * 2; c.height = H * 2; // 2倍の大きさで描いて、くっきりさせる
  const x = c.getContext("2d"); x.scale(2, 2);
  const font = '"Zen Maru Gothic","Hiragino Sans","Yu Gothic",sans-serif';
  // 文字を描く（長いときは「…」で省略）
  const txt = (s, px, X, Y, col, bold, maxW) => { x.font = `${bold ? "700 " : ""}${px}px ${font}`; x.fillStyle = col; let t = String(s); while(maxW && x.measureText(t).width > maxW && t.length > 1) t = t.slice(0, -1); x.fillText(t === String(s) ? t : t + "…", X, Y); };
  // 角丸の四角を描く
  const rect = (X, Y, w, h, col) => { x.fillStyle = col; x.beginPath(); x.roundRect(X, Y, Math.max(w, 0), h, h / 2); x.fill(); };
  x.fillStyle = v("--bg"); x.fillRect(0, 0, W, H);
  txt(`${R.p.name} 進捗レポート`, 22, 24, 40, v("--tx"), true); txt(ymd(new Date()), 13, 24, 62, v("--sub"));
  let y = 84;
  if(R.next){ rect(24, y, 190, 64, v("--ac")); txt(dayText(R.days(R.next)), 30, 40, y + 43, v("--on"), true);
    txt(R.next.name, 18, 232, y + 26, v("--tx"), true, 460); txt(`${R.next.date}　それまでが期限の未完了：${R.left}件`, 13, 232, y + 50, v("--sub")); }
  else txt("最終目標は未設定", 16, 24, y + 36, v("--sub"));
  y += 100;
  txt(`全体 ${R.pct}%（完了 ${R.cnt.done}/${R.n}件）`, 15, 24, y, v("--tx"), true);
  x.save(); x.beginPath(); x.roundRect(24, y + 12, 672, 16, 8); x.clip(); x.fillStyle = v("--panel"); x.fillRect(24, y + 12, 672, 16);
  let X = 24; STATUS.forEach(([k]) => { const w = R.n ? 672 * R.cnt[k] / R.n : 0; x.globalAlpha = k === "doing" ? .55 : 1; x.fillStyle = {todo:v("--bd"), doing:v("--sub"), review:v("--sub"), done:v("--ac")}[k]; x.fillRect(X, y + 12, w, 16); X += w; });
  x.restore(); x.globalAlpha = 1;
  txt(STATUS.map(([k,i,l]) => `${i} ${l} ${R.cnt[k]}`).join("　"), 13, 24, y + 50, v("--sub"));
  y += 84;
  // 棒グラフの1行ぶん
  const row = (label, f, right) => { txt(label, 13, 24, y + 12, v("--tx"), false, 90); rect(120, y, 460, 14, v("--panel")); rect(120, y, 460 * f, 14, v("--ac")); txt(right, 13, 600, y + 12, v("--tx")); y += 26; };
  if(R.phases.length){ txt("工程ごとの完了", 14, 24, y, v("--sub"), true); y += 16; R.phases.forEach(([n, d, t]) => row(n, d / t, `${d}/${t}`)); y += 14; }
  if(R.estAll){ txt("見積時間", 14, 24, y, v("--sub"), true); y += 16; row("完了", R.estDone / R.estAll, `${R.estDone}/${R.estAll}h`); y += 14; }
  txt("カテゴリごとの完了", 14, 24, y, v("--sub"), true); y += 16;
  R.cats.forEach(([n, d, t]) => row(n, d / t, `${d}/${t}`));
  if(R.mem.length){ y += 10; txt("担当者ごとの未完了", 14, 24, y, v("--sub"), true); y += 16; const mx = Math.max(1, ...R.mem.map(r => r[1])); R.mem.forEach(([n, k]) => row(n, k / mx, `${k}件`)); }
  y += 14; txt("未完了タスク", 14, 24, y, v("--sub"), true); y += 22;
  rows.forEach(t => { txt(`${STATUS.find(s => s[0] === t.status)[1]} ${t.title}`, 14, 24, y, v("--tx"), false, 440); txt(`${t.cat}${t.due ? "　〜" + t.due : ""}`, 12, 480, y, v("--sub"), false, 216); y += 24; });
  if(R.open.length > 30) txt(`ほか ${R.open.length - 30}件`, 12, 24, y, v("--sub"));
  return {c, W, H};
}
const fileName = ext => `${cur().name}_${ymd(new Date())}.${ext}`;
$("png").onclick = () => {
  try { drawReport().c.toBlob(b => { const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = fileName("png"); a.click(); }); $("repMsg").textContent = ""; }
  catch(e) { $("repMsg").textContent = "保存できなかったよ"; }
};
$("pdf").onclick = () => {
  try { const {c, W, H} = drawReport(), h = 210 * H / W, pdf = new window.jspdf.jsPDF({unit:"mm", format:[210, h]});
    pdf.addImage(c.toDataURL("image/png"), "PNG", 0, 0, 210, h); pdf.save(fileName("pdf")); $("repMsg").textContent = ""; }
  catch(e) { $("repMsg").textContent = "PDFを作れなかったよ（通信が必要）"; }
};

// ===== カテゴリと工程の編集（カンマ区切りで入力） =====
const parseList = s => [...new Set(s.split(/[,、，]/).map(x => x.trim()).filter(Boolean))].slice(0, 12); // 最大12個
$("catSave").onclick = () => { const l = parseList($("catIn").value); if(!l.length) return; cur().cats = l; commit("カテゴリを変更"); };
$("phSave").onclick = () => { const l = parseList($("phIn").value); if(!l.length) return; cur().phases = l; commit("工程を変更"); };

// ===== クラウド同期（GitHubの非公開リポジトリの data.json に保存して、端末間で共有） =====
const syncCfg = () => { try { return JSON.parse(get("gtm-sync")) || {}; } catch(e) { return {}; } }; // ユーザー名・リポジトリ名・トークンはこの端末だけに保存
// データの大きさを測って、大きくなってきたら知らせる
const dataSize = () => new Blob([JSON.stringify(db)]).size;
function renderSize(){
  const n = dataSize(), kb = Math.round(n / 1024), warn = n >= SIZE_WARN;
  $("sizeNote").textContent = `データの大きさ：${kb}KB（同期できる目安の上限は約${Math.round(SIZE_MAX / 1024)}KB）`;
  $("sizeBox").hidden = !warn;
  $("sizeBox").innerHTML = warn ? `<span>データが大きくなってきたよ（${kb}KB）。上限に近づくと同期できなくなるから、古い日記や完了タスクを整理しよう。まずは手元にバックアップしておくと安心だよ。</span> <button id="sizeBk" class="pri">ファイルで保存</button>` : "";
}
$("sizeBox").onclick = e => { if(e.target.id === "sizeBk") saveBackupFile(); };
// ゴミ箱の自動削除：削除から30日たったタスクを、データから完全に消す
const TRASH_DAYS = 30;
function purgeTrash(){ const lim = Date.now() - TRASH_DAYS * 864e5; db.projects.forEach(p => { p.tasks = p.tasks.filter(t => !(t.deleted && (t.updatedAt || 0) < lim)); p.diary = (p.diary || []).filter(d => !(d.deleted && (d.updatedAt || 0) < lim)); p.events = (p.events || []).filter(d => !(d.deleted && (d.updatedAt || 0) < lim)); ["assets","tests","versions","sessions"].forEach(k => p[k] = (p[k] || []).filter(d => !(d.deleted && (d.updatedAt || 0) < lim))); }); }
// トークンの期限まで何日か（メモが無ければ null）
const expDays = () => { const c = syncCfg(); return c.exp ? Math.ceil((new Date(c.exp + "T23:59:59") - new Date()) / 864e5) : null; };
// ヘッダーの同期バッジ（状態：busy=同期中 / ok=同期済み / wait=同期待ち / warn=期限が近い / err=失敗）
const badge = (st, text) => { const b = $("syncBadge"); b.hidden = false; b.dataset.st = st; b.textContent = text; };
const setSyncMsg = t => {
  $("syncMsg").textContent = t;
  const d = expDays(), warn = d !== null && d <= 7 ? "　⚠トークン期限" + (d < 0 ? "切れ" : "まで" + d + "日") : "";
  if(t.startsWith("同期中")) badge("busy", "☁ 同期中…");
  else if(t.startsWith("同期できたよ")) badge(warn ? "warn" : "ok", "☁ 同期済み " + new Date().toLocaleTimeString("ja-JP", {hour:"2-digit", minute:"2-digit"}) + warn);
  else if(t.startsWith("同期できなかった")) badge("err", "☁ 同期できてない");
};
const b64dec = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, "")), c => c.charCodeAt(0)));
const b64enc = s => { let t = ""; new TextEncoder().encode(s).forEach(x => t += String.fromCharCode(x)); return btoa(t); };
// GitHubに読み書きする（GET=読む、PUT=書く）
const gh = (c, method, body) => fetch(`https://api.github.com/repos/${c.owner}/${c.repo}/contents/data.json`, {
  method, cache: "no-store", body: body && JSON.stringify(body),
  headers: {Authorization: "Bearer " + c.token, Accept: "application/vnd.github+json", "Content-Type": "application/json"}});
// 2つのデータを合わせる：タスクは1つずつ新しいほうを残す。設定などは新しく保存したほうを優先する
// 同時編集のとき、どの項目が違ったかを知らせるための名前
const CONF_FIELDS = [["title","名前"],["status","ステータス"],["due","期限"],["start","開始日"],["assignee","担当者"],["cat","カテゴリ"],["pri","優先度"],["phase","工程"],["est","見積時間"],["spec","仕様書リンク"],["memo","メモ"],["subs","サブタスク"],["deps","先に終わらせるタスク"],["deleted","削除"]];
function mergeDb(a, b, conf, since){ // a=この端末、b=クラウド、conf=同時編集の記録を入れる配列、since=前回の同期の時刻
  const newer = (a.mtime || 0) >= (b.mtime || 0) ? a : b, older = newer === a ? b : a, copy = x => JSON.parse(JSON.stringify(x));
  const dead = new Set([...(a.deletedProjects || []), ...(b.deletedProjects || [])]);
  const out = copy(newer); out.deletedProjects = [...dead]; out.mtime = Math.max(a.mtime || 0, b.mtime || 0); out.me = a.me; out.current = a.current;
  const gone = {...(b.gone || {}), ...(a.gone || {})}; out.gone = gone; // 消したメンバー・目標・テンプレートの「消した印」
  const union = (older, newer) => { const m = new Map(); [...older, ...newer].forEach(i => m.set(i.id, i)); return [...m.values()].filter(i => !gone[i.id]); }; // 両方を合わせる（同じIDは新しいほう）
  const same = (x, y) => JSON.stringify({...x, updatedAt:0, updatedBy:""}) === JSON.stringify({...y, updatedAt:0, updatedBy:""});
  const byTime = (mine, other, track) => { const m = new Map(mine.map(i => [i.id, i])); other.forEach(i => { const x = m.get(i.id);
    if(x && track && since && (i.updatedAt || 0) > since && (x.updatedAt || 0) > since && !same(i, x)) (i.updatedAt || 0) > (x.updatedAt || 0) ? track(i, x) : track(x, i); // 両方が同期のあとに変更 → 負けた方を知らせる用に記録
    if(!x || (i.updatedAt || 0) > (x.updatedAt || 0)) m.set(i.id, copy(i)); }); return [...m.values()]; }; // 1件ずつ、更新日時が新しいほうを残す
  out.templates = union(older.templates || [], out.templates || []);
  older.projects.forEach(p => { if(!out.projects.some(x => x.id === p.id)) out.projects.push(copy(p)); });
  out.projects = out.projects.filter(p => !dead.has(p.id));
  out.projects.forEach(p => {
    p.members = p.members.filter(m => !gone[m.id]); p.milestones = (p.milestones || []).filter(m => !gone[m.id]);
    const o = older.projects.find(x => x.id === p.id); if(!o) return;
    p.tasks = byTime(p.tasks, o.tasks, (w, l) => conf && conf.push({pid:p.id, id:w.id, title:w.title, lose:copy(l), diff:CONF_FIELDS.filter(([k]) => JSON.stringify(w[k] ?? "") !== JSON.stringify(l[k] ?? "")).map(f => f[0])})); p.diary = byTime(p.diary || [], o.diary || []); p.events = byTime(p.events || [], o.events || []); ["assets","tests","versions","sessions"].forEach(k => p[k] = byTime(p[k] || [], o[k] || [])); // 制作管理の3つも1件ずつ // タスクと日記は1件ずつ // タスクは1件ずつ、メンバーと目標は両方を合わせる
    p.members = union(o.members, p.members); p.milestones = union(o.milestones || [], p.milestones || []);
    const seen = new Set(); // 更新フィードは両方を合わせて、重複を消して新しい順に100件
    p.feed = [...p.feed, ...o.feed].filter(f => { const k = f.t + f.who + f.text; return seen.has(k) ? false : seen.add(k); }).sort((x, y) => y.t - x.t).slice(0, 100);
  });
  return out;
}
// 同時編集の記録は、この端末にだけ保存する（同じものは重ねない・最大20件）
const confList = () => { try { return JSON.parse(get("gtm-conf")) || []; } catch(e) { return []; } };
function addConf(list){
  if(!list.length) return;
  const cur0 = confList(); list.forEach(c => { if(!cur0.some(x => x.id === c.id && x.lose.updatedAt === c.lose.updatedAt)) cur0.push(c); });
  set("gtm-conf", JSON.stringify(cur0.slice(-20)));
}
const confVal = (p, k, v) => (k === "subs" || k === "deps") ? (Array.isArray(v) && v.length ? v.length + "件" : "なし") : k === "status" ? ((STATUS.find(s => s[0] === v) || [])[2] || v) : k === "assignee" ? ((p.members.find(m => m.id === v) || {}).name || "未定") : k === "pri" ? (PRI[v] || v) : k === "deleted" ? (v ? "削除済み" : "削除なし") : (v === "" || v == null ? "なし" : String(v));
function renderConf(){
  const list = confList().filter(c => db.projects.some(p => p.id === c.pid && p.tasks.some(t => t.id === c.id)));
  $("confBox").hidden = !list.length;
  $("confBox").innerHTML = list.length ? `<h3>同時に編集されたタスク（${list.length}件）</h3><p class="sub">別の端末と同じタスクを同時に変えたから、新しい方を残したよ。古い方の内容は、ここから戻せる。</p>` + list.map((c, i) => {
    const p = db.projects.find(x => x.id === c.pid);
    return `<div class="sec"><b>${esc(c.title)}</b><div class="sub">古い方の内容：${c.diff.map(k => `${esc(CONF_FIELDS.find(f => f[0] === k)[1])}＝${esc(confVal(p, k, c.lose[k]))}`).join("、") || "（違いなし）"}</div><div class="row" style="margin-top:6px"><button data-confuse="${i}">古い方の内容に戻す</button><button data-confok="${i}">このままでOK</button></div></div>`; }).join("") : "";
}
$("confBox").onclick = e => {
  const all = confList(), u = e.target.dataset.confuse, o = e.target.dataset.confok, i = +(u ?? o); if(u == null && o == null) return;
  const list = all.filter(c => db.projects.some(p => p.id === c.pid && p.tasks.some(t => t.id === c.id))), c = list[i]; if(!c) return;
  set("gtm-conf", JSON.stringify(all.filter(x => x !== all.find(y => y.id === c.id && y.lose.updatedAt === c.lose.updatedAt))));
  if(u != null){ const p = db.projects.find(x => x.id === c.pid), t = p.tasks.find(x => x.id === c.id); db.current = p.id; Object.assign(t, c.lose, {updatedAt:Date.now(), updatedBy:db.me || ""}); commit(`「${t.title}」を古い方の内容に戻した`); }
  else render();
};
async function syncNow(retry = 1){
  const c = syncCfg(); if(!c.token || !c.owner || !c.repo){ setSyncMsg("ユーザー名・リポジトリ名・トークンを入れてね"); return; }
  setSyncMsg("同期中…");
  const t0 = Date.now(), since = Number(get("gtm-lastsync") || 0), conf = [];
  try {
    const r = await gh(c, "GET"); let sha, remote = null;
    if(r.status === 200){ const j = await r.json(); sha = j.sha; remote = JSON.parse(b64dec(j.content)); if(!isValid(remote)) throw new Error("クラウドのデータの形が違うよ"); remote = migrate(remote); }
    else if(r.status !== 404) throw new Error(r.status === 401 ? "トークンが違うか、期限切れかも" : r.status === 403 ? "権限がないよ（Contents を Read and write にしたか確認）" : "エラー " + r.status);
    if(remote) db = mergeDb(db, remote, conf, since);
    purgeTrash();
    if(dataSize() > SIZE_MAX) throw new Error("データが大きすぎて同期できないよ（約1MBまで）。古い日記や完了タスクを整理してね");
    const p = await gh(c, "PUT", {message: "sync " + new Date().toISOString(), content: b64enc(JSON.stringify(db)), ...(sha ? {sha} : {})});
    if(p.status === 409 || p.status === 422){ if(retry) return syncNow(0); throw new Error("他の端末と同時に更新したみたい。もう一度押してね"); }
    if(!p.ok) throw new Error(p.status === 404 ? "リポジトリが見つからないよ（名前とトークンの対象を確認）" : "保存できなかったよ（" + p.status + "）");
    Store.write(db); snapAll(); set("gtm-lastsync", String(t0)); addConf(conf); render(); setSyncMsg("同期できたよ（" + new Date().toLocaleTimeString("ja-JP") + "）");
  } catch(e) { setSyncMsg("同期できなかった：" + (e.message === "Failed to fetch" ? "通信できないみたい（オフラインかも）" : e.message)); }
}
// 変更から8秒後に自動で同期する（続けて変更したら、最後の変更から数え直す）
let syncTimer;
function scheduleSync(){ const c = syncCfg(); if(!c.token || c.auto === false) return; clearTimeout(syncTimer); badge("wait", "☁ 変更あり（同期待ち）"); syncTimer = setTimeout(syncNow, 8000); }
// 設定欄に保存済みの値を入れる（トークンは見せない）
function fillSync(){
  const c = syncCfg(); $("syOwner").value = c.owner || "naminapy"; $("syRepo").value = c.repo || "Game_Board_Data"; $("syAuto").checked = c.auto !== false;
  $("syToken").placeholder = c.token ? "保存済み（変える時だけ入力）" : ""; $("syToken").value = "";
  $("syExp").value = c.exp || ""; const d = expDays();
  $("syExpNote").textContent = d === null ? "" : d < 0 ? "⚠ 期限が切れてるよ。新しいトークンを作ってね" : d <= 7 ? "⚠ あと" + d + "日で期限切れ" : "あと" + d + "日で期限切れ";
}
$("sySave").onclick = () => {
  set("gtm-sync", JSON.stringify({owner:$("syOwner").value.trim(), repo:$("syRepo").value.trim(), token:$("syToken").value.trim() || syncCfg().token, auto:$("syAuto").checked, exp:$("syExp").value}));
  fillSync(); syncNow();
};
// この端末のトークンを消す（クラウドのデータはそのまま）
$("syClear").onclick = () => { const c = syncCfg(); delete c.token; set("gtm-sync", JSON.stringify(c)); $("syncBadge").hidden = true; fillSync(); setSyncMsg("この端末のトークンを消したよ"); };
// バッジを押すと、設定の「データ」タブを開く
$("syncBadge").onclick = () => { tab = "set"; stab = "data"; set("gtm-tab", tab); set("gtm-stab", stab); applyTab(); applyStab(); window.scrollTo(0, 0); };
$("syNow").onclick = () => syncNow();
// スマホとパソコンを行き来してアプリに戻ったときも、最新を取り込む
document.addEventListener("visibilitychange", () => { if(!document.hidden && syncCfg().token && syncCfg().auto !== false) syncNow(); });

// ===== メンバーの予定カレンダー（スケジュールタブの中で、ガントと切り替え） =====
const EV_CATS = ["私用","病院","授業","バイト","制作","その他"], EV_SHOW = ["制作"]; // 標準の項目と、他の人にも内容を見せる項目
const evCats = p => p.evCats && p.evCats.length ? p.evCats : EV_CATS, evShow = p => p.evShow || EV_SHOW;
const meId = p => (p.members.find(m => m.name === db.me) || {}).id; // 「あなたの名前」に対応するメンバーID
const memColor = (p, id) => { const i = p.members.findIndex(m => m.id === id); return COLORS[(i < 0 ? 3 : i) % COLORS.length]; };
// 予定の内容を見せていいか：個人モード・自分の予定・「見せる」指定・項目の設定の順で決める。それ以外は「予定あり」だけ
function evDetail(p, e){
  if(p.mode === "solo" || (e.memberId && e.memberId === meId(p)) || e.show === "detail") return true;
  return e.show === "busy" ? false : evShow(p).includes(e.cat);
}
const evTime = e => e.allDay ? "終日" : (e.start || "") + (e.end ? "–" + e.end : "");
let gmode = get("gtm-gmode") || "gantt", calCur = new Date(), calDay = "", calSel = new Set(), calTasks = get("gtm-caltasks") !== "0", editingE = null;
calCur.setDate(1);
// その日にある予定（複数日の予定も含む。メンバーを選んでいればその人だけ）
const evOn = (p, ds) => (p.events || []).filter(e => !e.deleted && e.date <= ds && ds <= (e.endDate || e.date) && (!calSel.size || calSel.has(e.memberId)))
  .sort((a, b) => (a.allDay ? "" : a.start || "~").localeCompare(b.allDay ? "" : b.start || "~"));
function applyG(){
  $("ganttView").hidden = gmode !== "gantt"; $("calView").hidden = gmode !== "cal";
  document.querySelectorAll("#gsw button").forEach(b => b.classList.toggle("on", b.dataset.g === gmode));
}
function renderSched(){ applyG(); gmode === "cal" ? renderCal() : renderGantt(); }
function renderCal(){
  const p = cur(), solo = p.mode === "solo", y = calCur.getFullYear(), m = calCur.getMonth(), today = ymd(new Date());
  if(!calDay) calDay = today; // 最初は今日を選んでおく
  const lead = new Date(y, m, 1).getDay(), weeks = Math.ceil((lead + new Date(y, m + 1, 0).getDate()) / 7);
  $("calHead").innerHTML = `<button data-cal="-1" aria-label="前の月">◀</button><b>${y}年${m + 1}月</b><button data-cal="1" aria-label="次の月">▶</button><button data-cal="0">今日</button>`;
  $("calWho").innerHTML = solo ? "" : `<button class="chip${calSel.size ? "" : " on"}" data-who="">全員</button>` + p.members.map(mm => `<button class="chip${calSel.has(mm.id) ? " on" : ""}" data-who="${mm.id}">${dot(p, mm.id)} ${esc(mm.name)}</button>`).join("");
  $("calTk").checked = calTasks;
  let cells = WD.map((w, i) => `<div class="kw${i === 0 ? " su" : i === 6 ? " sa" : ""}">${w}</div>`).join("");
  for(let i = 0; i < weeks * 7; i++){
    const d = new Date(y, m, 1 - lead + i), ds = ymd(d);
    const items = [ ...(p.milestones || []).filter(x => x.date === ds).map(x => `<div class="kev flag">⚑ ${esc(x.name)}</div>`),
      ...evOn(p, ds).map(e => `<div class="kev" style="background:${memColor(p, e.memberId)}">${esc(evDetail(p, e) ? e.title : "予定あり")}</div>`),
      ...(calTasks ? p.tasks.filter(t => !t.deleted && t.due === ds && t.status !== "done").map(t => `<div class="kev tk">◆ ${esc(t.title)}</div>`) : []) ];
    cells += `<div class="kc${d.getMonth() !== m ? " out" : ""}${[0, 6].includes(d.getDay()) ? " wk" : ""}${ds === today ? " today" : ""}${ds === calDay ? " sel" : ""}" data-day="${ds}"><span class="kn">${d.getDate()}</span>${items.slice(0, 3).join("")}${items.length > 3 ? `<div class="kmore">+${items.length - 3}</div>` : ""}</div>`;
  }
  $("calGrid").innerHTML = cells;
  // 選んだ日の一覧
  const evs = evOn(p, calDay), tks = p.tasks.filter(t => !t.deleted && t.due === calDay && t.status !== "done");
  $("calDay").innerHTML = `<h4>${calDay}（${WD[new Date(calDay + "T00:00:00").getDay()]}）</h4>` +
    (p.milestones || []).filter(x => x.date === calDay).map(x => `<div class="kd" style="cursor:default">⚑ <b>${esc(x.name)}</b> <span class="sub">目標の日</span></div>`).join("") +
    evs.map(e => `<div class="kd" data-eid="${e.id}">${solo ? "" : dot(p, e.memberId)} <span class="sub">${evTime(e)}</span> ${evDetail(p, e) ? `<b>${esc(e.title)}</b> <span class="tag">${esc(e.cat)}</span>` : "<b>予定あり</b>"}</div>`).join("") +
    tks.map(t => `<div class="kd" style="cursor:default">◆ ${esc(t.title)} <span class="sub">タスクの期限</span></div>`).join("") +
    `<button id="evAdd" class="pri" style="margin-top:8px">＋ この日に予定を追加</button>`;
}
$("gsw").onclick = e => { const b = e.target.closest("[data-g]"); if(!b) return; gmode = b.dataset.g; set("gtm-gmode", gmode); renderSched(); };
$("calHead").onclick = e => { const b = e.target.closest("[data-cal]"); if(!b) return; const v = +b.dataset.cal;
  if(v === 0){ calCur = new Date(); calCur.setDate(1); calDay = ymd(new Date()); } else calCur = new Date(calCur.getFullYear(), calCur.getMonth() + v, 1); renderCal(); };
$("calWho").onclick = e => { const b = e.target.closest("[data-who]"); if(!b) return; const id = b.dataset.who;
  if(!id) calSel.clear(); else if(calSel.has(id)) calSel.delete(id); else calSel.add(id); renderCal(); }; // 複数選べる。「全員」でリセット
$("calGrid").onclick = e => { const c = e.target.closest("[data-day]"); if(c){ calDay = c.dataset.day; renderCal(); } };
$("calTk").onchange = e => { calTasks = e.target.checked; set("gtm-caltasks", calTasks ? "1" : "0"); renderCal(); };
$("calDay").onclick = e => { if(e.target.id === "evAdd") return openEv(); const r = e.target.closest("[data-eid]"); if(r) openEv(r.dataset.eid); };
// 予定の編集画面（内容が見えない人の予定は開かない）
function openEv(id){
  const p = cur(), e = (p.events || []).find(x => x.id === id);
  if(e && !evDetail(p, e)) return;
  editingE = e || {id:uid(), memberId:meId(p) || "", date:calDay, endDate:"", allDay:true, start:"", end:"", title:"", cat:evCats(p)[0], show:"", isNew:true};
  $("eMem").innerHTML = opts(p.members.map(m => [m.id, m.name]), editingE.memberId); $("eMemBox").hidden = p.mode === "solo";
  $("eCat").innerHTML = opts([...new Set([...evCats(p), editingE.cat])].map(c => [c, c]), editingE.cat);
  $("eShow").innerHTML = opts([["", "項目の設定に従う"], ["detail", "内容を見せる"], ["busy", "予定ありだけ"]], editingE.show || "");
  $("eDate").value = editingE.date; $("eEnd").value = editingE.endDate || ""; $("eAll").checked = !!editingE.allDay;
  $("eS").value = editingE.start || ""; $("eE").value = editingE.end || ""; $("eTitle").value = editingE.title;
  $("eErr").textContent = ""; $("eDel").hidden = !!editingE.isNew; $("eTime").hidden = $("eAll").checked; $("edlg").showModal();
}
$("eAll").onchange = () => { $("eTime").hidden = $("eAll").checked; };
$("eSave").onclick = () => {
  const date = $("eDate").value, end = $("eEnd").value, title = $("eTitle").value.trim();
  if(!date || !title){ $("eErr").textContent = "日付とタイトルを入れてね"; return; }
  if(end && end < date){ $("eErr").textContent = "終了日は開始日より後にしてね"; return; }
  const p = cur(), e = editingE, all = $("eAll").checked;
  Object.assign(e, {memberId: p.mode === "solo" ? "" : $("eMem").value, date, endDate:end, allDay:all, start: all ? "" : $("eS").value, end: all ? "" : $("eE").value, title, cat:$("eCat").value, show:$("eShow").value, updatedAt:Date.now(), updatedBy:db.me || ""});
  if(e.isNew){ delete e.isNew; (p.events = p.events || []).push(e); }
  calDay = date; $("edlg").close(); commit(); // プライベートな予定なので、更新フィードには流さない
};
$("eCancel").onclick = () => $("edlg").close();
$("eDel").onclick = () => { editingE.deleted = true; editingE.updatedAt = Date.now(); $("edlg").close(); commit(); };
// 予定の項目の設定（「内容を見せる項目」は項目の中から選ぶ）
$("evSave").onclick = () => {
  const l = parseList($("evCatIn").value), s = parseList($("evShowIn").value).filter(x => l.includes(x)); if(!l.length) return;
  const p = cur(); p.evCats = l; p.evShow = s; commit("予定の項目を変更");
};

// ===== 日記（制作日誌）：プロジェクトごと、月ごとに折りたたんで表示 =====
let diaryOpen = {}, editingD = null, dDone = [], diaryExp = new Set(); // 月の開閉 / 編集中の日記 / 挿入した完了タスク / 開いているカード
const WD = ["日","月","火","水","木","金","土"];
function renderDiary(){
  const p = cur(), q = $("dq").value.trim().toLowerCase(), cm = ymd(new Date()).slice(0, 7);
  const list = (p.diary || []).filter(d => !d.deleted && (!q || (d.title + " " + d.body + " " + (d.done || []).join(" ")).toLowerCase().includes(q)))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt || 0) - (a.updatedAt || 0));
  const months = [...new Set(list.map(d => d.date.slice(0, 7)))]; // 新しい月から順に
  $("diaryList").innerHTML = months.map(m => {
    const items = list.filter(d => d.date.startsWith(m)), open = q || (m in diaryOpen ? diaryOpen[m] : m === cm); // 今月だけ最初は開く。検索中は全部開く
    return `<details class="dmonth" data-m="${m}"${open ? " open" : ""}><summary>${m.slice(0, 4)}年${+m.slice(5)}月（${items.length}件）</summary>` +
      items.map(d => {
        const o = diaryExp.has(d.id), n = (d.done || []).length; // o = このカードが開いているか
        return `<div class="dcard${o ? " open" : ""}" data-did="${d.id}" tabindex="0" role="button" aria-expanded="${o}" aria-label="${esc(d.title)}を${o ? "閉じる" : "開く"}">` +
          `<div class="sub">${esc(d.date)}（${WD[new Date(d.date + "T00:00:00").getDay()]}）</div><b>${esc(d.title || "（見出しなし）")}</b>` +
          (n && !o ? ` <span class="tag">✓ 完了タスク ${n}件</span>` : "") + `<div class="dbody">${esc(d.body)}</div>` +
          (o ? (n ? `<div class="ddone"><div class="sub">この日に完了したタスク（自動で挿入）</div><ul>${d.done.map(t => `<li>${esc(t)}</li>`).join("")}</ul></div>` : "") + `<div class="dact"><button data-dedit="${d.id}">編集</button></div>` : "") + `</div>`;
      }).join("") + `</details>`;
  }).join("") || `<p class="sub">${q ? "見つからなかったよ" : "まだ日記がないよ。「日記を書く」から、今日のことを残そう。"}</p>`;
}
// カードを開く／閉じる（開くと、隠れていた部分と「編集」ボタンが出る）
function toggleDiary(id){
  diaryExp.has(id) ? diaryExp.delete(id) : diaryExp.add(id); renderDiary();
  const c = $("diaryList").querySelector(`[data-did="${id}"]`); if(c) c.focus(); // キーボード操作でも位置が飛ばないように
}
// 日記の編集画面を開く（id が無ければ新しい日記）
function openDiary(id){
  const d = (cur().diary || []).find(x => x.id === id);
  editingD = d || {id:uid(), date:ymd(new Date()), title:"", body:"", isNew:true};
  dDone = [...(editingD.done || [])];
  $("dDate").value = editingD.date; $("dTitle").value = editingD.title; $("dBody").value = editingD.body; renderDDone();
  $("dErr").textContent = ""; $("dDel").hidden = !!editingD.isNew; $("ddlg").showModal();
}
// 挿入した完了タスクの囲みを、編集画面に出す
function renderDDone(){ $("dDoneBox").hidden = !dDone.length; $("dDoneList").innerHTML = dDone.map(t => `<li>${esc(t)}</li>`).join(""); }
$("dAdd").onclick = () => openDiary();
$("diaryList").onclick = e => {
  const ed = e.target.closest("[data-dedit]"); if(ed) return openDiary(ed.dataset.dedit); // 「編集」ボタン
  const c = e.target.closest("[data-did]"); if(!c || String(getSelection())) return; // 文字を選んでいる間は開閉しない
  toggleDiary(c.dataset.did);
};
$("diaryList").onkeydown = e => { if((e.key === "Enter" || e.key === " ") && e.target.dataset.did){ e.preventDefault(); toggleDiary(e.target.dataset.did); } };
$("diaryList").addEventListener("toggle", e => { if(e.target.dataset.m) diaryOpen[e.target.dataset.m] = e.target.open; }, true); // 月の開閉を覚えておく
$("dq").oninput = renderDiary; // 入力するたびに絞り込む
// 「この日に完了したタスク」を、日記の文章とは別の欄として挿入する（もう一度押すと最新の内容に入れ替わる）
$("dTasks").onclick = () => {
  const day = $("dDate").value, done = cur().tasks.filter(t => !t.deleted && t.status === "done" && t.updatedAt && ymd(new Date(t.updatedAt)) === day);
  if(!done.length){ $("dErr").textContent = "この日に完了したタスクはないよ"; return; }
  $("dErr").textContent = ""; dDone = done.map(t => t.title); renderDDone();
};
$("dDoneDel").onclick = () => { dDone = []; renderDDone(); };
$("dSave").onclick = () => {
  const date = $("dDate").value, title = $("dTitle").value.trim(), body = $("dBody").value;
  if(!date || (!title && !body.trim() && !dDone.length)){ $("dErr").textContent = "日付と、見出しか内容を入れてね"; return; }
  const p = cur(), d = editingD; Object.assign(d, {date, title, body, done:[...dDone], updatedAt:Date.now(), updatedBy:db.me || ""});
  if(d.isNew){ delete d.isNew; (p.diary = p.diary || []).push(d); }
  $("ddlg").close(); commit(); // 日記の変更は更新フィードには流さない
};
$("dCancel").onclick = () => $("ddlg").close();
$("dDel").onclick = () => { editingD.deleted = true; editingD.updatedAt = Date.now(); $("ddlg").close(); commit(); }; // 削除は「消した印」を付けるだけ（30日後に完全削除）

// ===== 新しいバージョンの検知（開きっぱなしの画面や、インストールしたアプリに「更新する」を出す） =====
async function checkUpdate(){
  try {
    const t = await (await fetch("./app.js", {cache: "no-store"})).text(); // 公開されている最新の app.js を読む
    const m = t.match(/const APP_VERSION = "([^"]+)"/);
    if(m && m[1] !== APP_VERSION) $("upd").hidden = false;
  } catch(e) {}
}
$("updNow").onclick = () => location.reload();
document.addEventListener("visibilitychange", () => { if(!document.hidden) checkUpdate(); }); // 画面に戻ってきたとき
setInterval(checkUpdate, 30 * 60 * 1000); // 開きっぱなしでも30分ごと
setTimeout(checkUpdate, 3000); // 開いた直後

// ===== 設定の中の小タブ（一般 / 編集 / データ） =====
let stab = get("gtm-stab") || "gen"; // 最後に見た小タブを覚えておく
function applyStab(){
  document.querySelectorAll("#stabs button").forEach(b => { b.classList.toggle("on", b.dataset.stab === stab); b.setAttribute("aria-current", b.dataset.stab === stab ? "page" : "false"); });
  document.querySelectorAll(".pane").forEach(p => p.classList.toggle("on", p.dataset.pane === stab));
}
$("stabs").onclick = e => { const b = e.target.closest("[data-stab]"); if(!b) return; stab = b.dataset.stab; set("gtm-stab", stab); applyStab(); };

// ===== タブの切り替え（ボード / スケジュール / 進み具合 / 設定） =====
let tab = get("gtm-tab") || "board"; // 最後に見たタブをブラウザが覚えてくれる
function applyTab(){
  document.body.dataset.tab = tab; // CSSがこの値で表示する場所を切り替える
  document.querySelectorAll("#tabs button").forEach(b => { b.classList.toggle("on", b.dataset.tab === tab); b.setAttribute("aria-current", b.dataset.tab === tab ? "page" : "false"); }); // aria-current：読み上げソフトに「今このタブ」を伝える
}
$("tabs").onclick = e => {
  const b = e.target.closest("[data-tab]"); if(!b) return;
  tab = b.dataset.tab; set("gtm-tab", tab); applyTab();
  if(tab === "gantt") renderSched(); if(tab === "diary") renderDiary(); if(tab === "prod") renderProd(); // 表示されたときに幅を測り直す・日記を描く
};
addEventListener("resize", () => { if(tab === "gantt") renderGantt(); });

// ===== ガント風スケジュール（横に日付、縦にタスク） =====
let ganttScrolled = false, gW = 28, gDrag = null, gSkipUntil = 0; // gW=1日の幅 / gDrag=ドラッグ中のバー
function renderGantt(){
  const p = cur(), box = $("gantt"), D = 864e5, LW = 190; // LW=左のタスク名欄の幅(px)
  const parse = s => new Date(s + "T00:00:00"), today = new Date(); today.setHours(0,0,0,0);
  // 期限があるタスクだけを、開始日順に並べる（開始日が無ければ期限の1日だけのバー）
  const allTs = p.tasks.filter(t => !t.deleted && t.due && passes(t) && !(hideDone && t.status === "done")).sort((a,b) => (a.start || a.due).localeCompare(b.start || b.due));
  const ts = allTs.slice(0, 150); // 行が多すぎると重いので、最大150行まで
  if(!ts.length){ box.innerHTML = '<p class="sub">期限（と開始日）を入れたタスクが、ここに並ぶよ。</p>'; return; }
  const ms = p.milestones || [];
  const from = new Date(Math.min(today, ...ts.map(t => parse(t.start || t.due))) - 2 * D);
  const to = new Date(Math.max(today, ...ts.map(t => parse(t.due)), ...ms.map(m => parse(m.date))) + 3 * D);
  const n = Math.round((to - from) / D) + 1, idx = d => Math.round((d - from) / D); // idx = 左端から何日目か
  const W = gW = Math.max(28, Math.floor(((box.clientWidth || 900) - LW) / n)); // 1日の幅。画面の幅いっぱいに広げる（狭いときは横スクロール）
  const head = Array.from({length:n}, (_, i) => { const d = new Date(+from + i * D), wk = d.getDay() === 0 || d.getDay() === 6;
    return `<span class="gd${wk ? " we" : ""}" style="width:${W}px">${d.getDate() === 1 || i === 0 ? (d.getMonth() + 1) + "/" : ""}${d.getDate()}</span>`; }).join("");
  const rows = ts.map(t => { const s = idx(parse(t.start || t.due)), e = idx(parse(t.due)), late = t.due < ymd(today) && t.status !== "done";
    return `<div class="gr"><span class="gl" title="${esc(t.title)}">${p.mode !== "solo" && p.members.some(m => m.id === t.assignee) ? dot(p, t.assignee) : ""}${STATUS.find(x => x[0] === t.status)[1]} ${blockers(p, t).length ? "🔒 " : ""}${esc(t.title)}</span><div class="gt" style="width:${n * W}px"><div class="gb s-${t.status}${late ? " glate" : ""}" data-id="${t.id}" tabindex="0" role="button" aria-label="${esc(t.title)} 〜${t.due}" style="left:${s * W}px;width:${(e - s + 1) * W - 2}px${p.mode !== "solo" && p.members.some(m => m.id === t.assignee) ? ";box-shadow:inset 5px 0 0 " + memColor(p, t.assignee) : ""}"></div></div></div>`; }).join("");
  // 縦線（目標は点線、今日は実線）
  const line = (cls, d, label) => `<div class="${cls}" style="left:${LW + idx(d) * W + W / 2}px">${label ? `<span>${esc(label)}</span>` : ""}</div>`;
  box.innerHTML = `<div style="position:relative;width:${LW + n * W}px"><div class="gr"><span class="gl"></span><div class="gt" style="width:${n * W}px">${head}</div></div>${rows}` +
    ms.map(m => line("gm", parse(m.date), m.name)).join("") + line("gtd", today, "") + `</div>` +
    (allTs.length > ts.length ? `<p class="sub">ほか ${allTs.length - ts.length}件は省略したよ。「完了を隠す」などで絞ってね。</p>` : "");
  if(!ganttScrolled){ box.scrollLeft = Math.max(0, LW + idx(today) * W - 220); ganttScrolled = true; } // 最初だけ今日の位置へスクロール
}
$("gantt").onclick = e => { if(Date.now() < gSkipUntil) return; const b = e.target.closest("[data-id]"); if(b) openEdit(b.dataset.id); }; // ドラッグの直後は、編集画面を開かない
$("gToday").onclick = () => { ganttScrolled = false; renderGantt(); };
// バーをドラッグして、開始日と期限をまとめてずらす（マウス・ペン用。タッチは、横スクロールと区別がつかないので押して編集）
$("gantt").addEventListener("pointerdown", e => {
  const b = e.target.closest(".gb"); if(!b || e.pointerType === "touch" || e.button) return;
  gDrag = {id:b.dataset.id, x:e.clientX, dx:0, bar:b, left:parseFloat(b.style.left)};
  try { b.setPointerCapture(e.pointerId); } catch(err) {}
});
$("gantt").addEventListener("pointermove", e => {
  if(!gDrag) return; const dx = e.clientX - gDrag.x;
  if(Math.abs(dx) > 4) gDrag.dx = dx;
  if(gDrag.dx) gDrag.bar.style.left = (gDrag.left + Math.round(gDrag.dx / gW) * gW) + "px"; // 1日ぶんずつ動く
});
$("gantt").addEventListener("pointerup", () => {
  if(!gDrag) return; const g = gDrag; gDrag = null; if(!g.dx) return;
  gSkipUntil = Date.now() + 300;
  const days = Math.round(g.dx / gW), t = cur().tasks.find(x => x.id === g.id);
  if(!days || !t) return renderGantt(); // 動かしていなければ、元の位置に戻す
  const sh = v => { const d = new Date(v + "T00:00:00"); d.setDate(d.getDate() + days); return ymd(d); };
  if(t.start) t.start = sh(t.start); t.due = sh(t.due); t.updatedAt = Date.now(); t.updatedBy = db.me || "";
  commit(`「${t.title}」の期間を ${days > 0 ? "+" : ""}${days}日 ずらした`);
});
$("gantt").addEventListener("pointercancel", () => { if(gDrag){ gDrag = null; renderGantt(); } });
$("gantt").onkeydown = e => { if(e.key === "Enter" && e.target.dataset.id) openEdit(e.target.dataset.id); }; // キーボードでもバーを開ける

// ===== テンプレート（タスクの雛形を保存して、新しいプロジェクトに使い回す） =====
function renderTpl(){
  $("tplList").innerHTML = (db.templates || []).map(t => `<div class="row" style="margin:2px 0">${esc(t.name)} <span class="sub">${t.tasks.length}件</span> <button data-tpluse="${t.id}">これで作る</button> <button data-tpldel="${t.id}">削除</button></div>`).join("") || '<p class="sub">まだないよ</p>';
}
$("tplSave").onclick = () => {
  const n = $("tplName").value.trim(); if(!n) return; const p = cur();
  // タイトル・カテゴリ・優先度・メモだけを保存（担当者や日付は入れない）
  (db.templates = db.templates || []).push({id:uid(), name:n, theme:p.theme, tasks:p.tasks.filter(t => !t.deleted).map(t => ({title:t.title, cat:t.cat, pri:t.pri, memo:t.memo}))});
  $("tplName").value = ""; save(); render();
};
$("tplList").onclick = e => {
  const use = e.target.dataset.tpluse, del = e.target.dataset.tpldel;
  if(del){ db.templates = db.templates.filter(t => t.id !== del); (db.gone = db.gone || {})[del] = Date.now(); save(); render(); return; }
  if(!use) return;
  const name = $("newP").value.trim();
  if(!name){ $("tplMsg").textContent = "「一般」タブの「新規プロジェクト」にゲーム名を入れてから押してね"; return; }
  const tp = db.templates.find(t => t.id === use);
  const p = {id:uid(), name, theme:tp.theme, specUrl:"", members:[], milestones:[], feed:[],
    tasks: tp.tasks.map(t => ({id:uid(), ...t, status:"todo", assignee:"", due:"", start:"", updatedAt:Date.now(), updatedBy:db.me || "", deleted:false}))};
  db.projects.push(p); db.current = p.id; $("newP").value = ""; filter = "";
  commit(`テンプレート「${tp.name}」から「${name}」を作成`);
};

// ===== バックアップ：ファイル保存と、忘れ防止のお知らせ =====
const BK_DAYS = 7; // 何日バックアップしてないとお知らせするか
function backupNote(){
  const last = Number(get("gtm-lastbackup") || 0), d = last ? Math.floor((Date.now() - last) / 864e5) : null;
  const hasData = db.projects.some(p => p.tasks.length);
  $("bk").hidden = !hasData || (d !== null && d < BK_DAYS);
  $("bk").innerHTML = `<span>${d === null ? "まだバックアップしてないよ" : `最後のバックアップから${d}日たってるよ`}。ブラウザのデータが消えても戻せるように、ファイルで保存しておこう。</span> <button id="bkNow" class="pri">今すぐ保存</button>`;
}
// データをJSONファイルとしてダウンロードする
function saveBackupFile(){
  const b = new Blob([JSON.stringify(db, null, 1)], {type:"application/json"}), a = document.createElement("a");
  a.href = URL.createObjectURL(b); a.download = `game-board-backup_${ymd(new Date())}.json`; a.click();
  set("gtm-lastbackup", String(Date.now())); backupNote();
}
$("expF").onclick = saveBackupFile;
$("bk").onclick = e => { if(e.target.id === "bkNow") saveBackupFile(); };
// 選んだファイルの中身を、読み込み欄に入れて読み込む
$("impF").onchange = e => {
  const f = e.target.files[0]; if(!f) return;
  f.text().then(t => { $("json").value = t; $("imp").click(); }).catch(() => { $("msg").textContent = "ファイルを読めなかったよ"; });
  e.target.value = "";
};

// ===== 削除したタスクのゴミ箱（元に戻せる） =====
function renderTrash(){
  $("trash").innerHTML = cur().tasks.filter(t => t.deleted).map(t => `<div class="row" style="margin:2px 0">${esc(t.title)} <button data-undel="${t.id}">戻す</button></div>`).join("") || '<p class="sub">ないよ</p>';
}
$("trash").onclick = e => {
  const id = e.target.dataset.undel; if(!id) return;
  const t = cur().tasks.find(x => x.id === id); t.deleted = false; t.updatedAt = Date.now(); t.updatedBy = db.me || "";
  commit(`「${t.title}」を元に戻した`);
};

// ===== キーボード操作：カードを選んで Enter で編集、Alt+← / Alt+→ で隣の列へ移動 =====
$("board").onkeydown = e => {
  const card = e.target.closest(".card"); if(!card || e.target !== card) return;
  if(e.key === "Enter"){ e.preventDefault(); openEdit(card.dataset.id); return; }
  if(e.altKey && (e.key === "ArrowLeft" || e.key === "ArrowRight")){
    e.preventDefault();
    const t = cur().tasks.find(x => x.id === card.dataset.id), i = STATUS.findIndex(s => s[0] === t.status) + (e.key === "ArrowRight" ? 1 : -1);
    if(i < 0 || i >= STATUS.length) return;
    t.status = STATUS[i][0]; t.updatedAt = Date.now(); t.updatedBy = db.me || "";
    commit(`「${t.title}」を ${STATUS[i][2]} に移動`);
    const again = document.querySelector(`.card[data-id="${t.id}"]`); if(again) again.focus(); // 描き直した後も同じカードを選んだままにする
  }
};

// ===== ドラッグ＆ドロップでカードを別の列へ移動（PC用。スマホは ◀ ▶ ボタン） =====

// ===== すばやく追加（タイトルだけ入れて Enter） =====
$("qin").onkeydown = e => {
  if(e.key !== "Enter" || e.isComposing || e.keyCode === 229) return; // 日本語の変換を決める Enter では追加しない
  const title = e.target.value.trim(); if(!title) return;
  const p = cur(), me = p.members.find(m => m.name === db.me); // 名前を選んでいれば、その人の担当にする
  p.tasks.push({id:uid(), title, cat:catsOf(p)[1] || catsOf(p)[0], pri:"mid", status:"todo", assignee:me ? me.id : "", due:"", memo:"", updatedAt:Date.now(), updatedBy:db.me || ""});
  e.target.value = ""; commit(`「${title}」を追加`);
  $("qin").focus(); // 続けて入力できるように
};

// ===== タスク完了のごほうび演出 =====
function celebrate(){
  if(matchMedia("(prefers-reduced-motion: reduce)").matches) return; // 「動きを減らす」設定の人には出さない
  const box = document.createElement("div"); box.className = "party"; box.setAttribute("aria-hidden", "true");
  const em = ["✨", "🎉", "⭐", "💚"];
  for(let i = 0; i < 14; i++){
    const s = document.createElement("span"); s.textContent = em[i % em.length];
    s.style.setProperty("--x", (Math.random() * 200 - 100) + "px"); s.style.setProperty("--y", (-60 - Math.random() * 140) + "px");
    s.style.left = (35 + Math.random() * 30) + "%"; s.style.animationDelay = (Math.random() * .25) + "s"; box.appendChild(s);
  }
  document.body.appendChild(box); setTimeout(() => box.remove(), 1500);
}

// ===== 制作管理タブ（素材リスト・プレイテスト記録・バージョン履歴） =====
// 3つとも同じしくみで動く：PK に「項目の一覧」を書いておくと、一覧・追加・編集の画面が自動でできる
// 項目の型：text=1行 / area=複数行 / date=日付 / sel=選択 / url=リンク(https://のみ) / who=担当者(チームのみ)
const ASSET_ST = [["none","未依頼"],["ask","依頼中"],["got","納品済"],["in","組み込み済"]];
const ASSET_KIND = [["art","🎨 絵"],["sound","🔊 音・BGM"],["model","🧊 モデル"],["ui","🖼 UI"],["other","📦 その他"]];
const WSTEPS = [ // GitHub Desktop で作業するときの流れ（上から順に）
  ["fetch","🔄","フェッチ","GitHub Desktop の上にある「Fetch origin」を押す。「Pull origin」に変わったら、それも押して最新にする。"],
  ["start","📣","作業開始の報告","「報告文をコピー」を押して、連絡先（Discordなど）に貼って送る。"],
  ["commit","💾","コミット","変更したファイルを確認 → 左下の Summary に内容を書く → 「Commit to ブランチ名」を押す。"],
  ["pr","🔀","プルリクエスト","「Push origin」→「Create Pull Request」を押して、開いたGitHubのページで作成する。できたページのリンクは「編集」に貼っておく。"],
  ["end","✅","作業終了の報告","「報告文をコピー」を押して、終了の報告を送る。これで今回の作業は完了。"]
];
const PK = {
  sessions:{label:"作業", tab:"作業の流れ", add:"作業を始める", fields:[["goal","今日やること","text","例：ジャンプの挙動を直す"],["branch","ブランチ名（GitHub Desktop の Current Branch）","text","例：feature/jump"],["commitMsg","コミットのメッセージ（Summary）","text"],["prUrl","プルリクのリンク（https://）","url"],["summary","やったこと（終了の報告に入る）","area"]],
    init:() => { const last = (cur().sessions || []).filter(i => !i.deleted).sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt || 0) - (a.updatedAt || 0))[0]; return {date:ymd(new Date()), who:db.me || "", branch:last ? last.branch || "" : "", steps:{}}; },
    title:i => i.goal || i.branch || "作業", check:i => (i.goal || i.branch) ? "" : "「今日やること」かブランチ名を入れてね"},
  assets:{label:"素材", fields:[["name","名前","text","例：スライムの歩きアニメ"],["kind","種類","sel",ASSET_KIND],["status","状態","sel",ASSET_ST],["who","担当（作る人）","who"],["link","ファイルのリンク（任意・https://）","url"],["memo","メモ","area"]],
    init:() => ({kind:"art", status:"none"}), title:i => i.name, check:i => i.name ? "" : "名前を入力してね"},
  tests:{label:"プレイテスト", fields:[["date","遊んだ日","date"],["who","遊んでくれた人","text"],["notes","感想・気づいたこと","area"],["fixes","直すこと（1行に1つ。あとでタスクにできる）","area"]],
    init:() => ({date:ymd(new Date())}), title:i => `${i.date} ${i.who || ""}`.trim(), check:i => !i.date ? "日付を入れてね" : (i.who || i.notes || i.fixes) ? "" : "人・感想・直すこと のどれかは書いてね"},
  versions:{label:"バージョン", fields:[["name","バージョン名","text","例：α版 v0.1"],["date","日付","date"],["notes","変更点（1行に1つ）","area"],["link","ビルドのリンク（任意・https://）","url"]],
    init:() => ({date:ymd(new Date())}), title:i => i.name, check:i => i.name ? "" : "バージョン名を入力してね"}
};
let pk = get("gtm-pk") in PK ? get("gtm-pk") : "sessions", editingP = null;
const pItems = k => (cur()[k] || []).filter(i => !i.deleted);
function renderProd(){
  const p = cur(), solo = p.mode === "solo", K = PK[pk];
  $("pSw").innerHTML = Object.entries(PK).map(([k, v]) => `<button class="chip${k === pk ? " on" : ""}" data-pk="${k}">${v.tab || v.label}（${pItems(k).length}）</button>`).join("");
  $("pAdd").textContent = `＋ ${K.add || K.label + "を追加"}`;
  const items = pItems(pk), who = i => !solo && p.members.some(m => m.id === i.who) ? dot(p, i.who) : "", link = i => /^https:\/\//i.test(i.link || "") ? `<a class="tag" href="${esc(i.link)}" target="_blank" rel="noopener">🔗 リンク</a>` : "";
  let html = "";
  if(pk === "sessions"){
    const open = items.filter(i => !(i.steps || {}).end), closed = items.filter(i => (i.steps || {}).end);
    const tm = ts => new Date(ts).toLocaleString("ja-JP", {month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit"});
    $("pSum").textContent = open.length ? "" : "いまの作業はないよ。「作業を始める」から、フェッチ→報告→コミット→プルリク→終了報告の流れを進められる。";
    html = open.slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).map(i => {
      const s = i.steps || {}, done = WSTEPS.filter(w => s[w[0]]).length, nextKey = (WSTEPS.find(w => !s[w[0]]) || [])[0];
      return `<div class="pcard" data-pid="${i.id}"><div class="row"><b style="flex:1">${esc(i.goal || "（今日やることなし）")}</b><button data-pid="${i.id}">編集</button></div><div class="meta">${i.branch ? `<span class="tag">🌿 ${esc(i.branch)}</span>` : ""}<span class="tag">${done}/${WSTEPS.length} 完了</span>${who(i)}</div>` +
        WSTEPS.map(([k, ic, lb, hint]) => `<div class="wstep${s[k] ? " ok" : ""}${k === nextKey ? " next" : ""}"><button data-wstep="${i.id}:${k}" aria-pressed="${!!s[k]}" aria-label="${lb}を${s[k] ? "未完了に戻す" : "完了にする"}">${s[k] ? "☑" : "☐"}</button><div style="flex:1;min-width:0"><b>${ic} ${lb}</b>${s[k] ? ` <span class="sub">${tm(s[k])}</span>` : k === nextKey ? ` <span class="tag">← 次はここ</span>` : ""}${(k === "start" || k === "end") ? ` <button data-wcopy="${i.id}:${k}">報告文をコピー</button>` : ""}<div class="sub">${esc(k === "commit" && i.commitMsg ? "メッセージ：" + i.commitMsg : hint)}</div>${k === "pr" && /^https:\/\//i.test(i.prUrl || "") ? `<a class="tag" href="${esc(i.prUrl)}" target="_blank" rel="noopener">🔗 プルリクを開く</a>` : ""}</div></div>`).join("") + `</div>`;
    }).join("") + (closed.length ? `<h4 style="margin:14px 0 4px">終わった作業（${closed.length}件）</h4>` + closed.slice().sort((a, b) => b.steps.end - a.steps.end).slice(0, 30).map(i => `<div class="pcard" data-pid="${i.id}" tabindex="0" role="button" aria-label="${esc(PK.sessions.title(i))}を編集"><b>${esc(i.goal || i.branch || "作業")}</b> <span class="sub">${esc(i.date)}</span><div class="meta">${i.branch ? `<span class="tag">🌿 ${esc(i.branch)}</span>` : ""}${who(i)}${/^https:\/\//i.test(i.prUrl || "") ? `<a class="tag" href="${esc(i.prUrl)}" target="_blank" rel="noopener">🔗 プルリク</a>` : ""}<button data-wcopy="${i.id}:end">終了の報告文をコピー</button><button data-wreopen="${i.id}">作業に戻す</button></div></div>`).join("") : "");
  } else if(pk === "assets"){
    const n = s => items.filter(i => i.status === s).length;
    $("pSum").textContent = items.length ? `組み込み済 ${n("in")}/${items.length}件（` + ASSET_ST.map(([s, l]) => `${l} ${n(s)}`).join(" ・ ") + "）" : "";
    html = items.slice().sort((a, b) => ASSET_ST.findIndex(s => s[0] === a.status) - ASSET_ST.findIndex(s => s[0] === b.status) || a.name.localeCompare(b.name, "ja")).map(i => {
      const si = ASSET_ST.findIndex(s => s[0] === i.status), nx = ASSET_ST[si + 1];
      return `<div class="pcard" data-pid="${i.id}" tabindex="0" role="button" aria-label="${esc(i.name)}を編集"><b>${esc(i.name)}</b><div class="meta"><span class="tag">${esc((ASSET_KIND.find(k => k[0] === i.kind) || ["", "📦"])[1])}</span><span class="tag">${esc(ASSET_ST[si < 0 ? 0 : si][1])}</span>${who(i)}${link(i)}${nx ? `<button data-pnext="${i.id}" aria-label="状態を「${nx[1]}」にする">→ ${nx[1]}</button>` : ""}</div>${i.memo ? `<div class="sub">${esc(i.memo)}</div>` : ""}</div>`;
    }).join("");
  } else if(pk === "tests"){
    $("pSum").textContent = items.length ? `${items.length}回ぶんの記録` : "";
    html = items.slice().sort((a, b) => b.date.localeCompare(a.date)).map(i => {
      const fx = (i.fixes || "").split("\n").filter(s => s.trim()).length;
      return `<div class="pcard" data-pid="${i.id}" tabindex="0" role="button" aria-label="${esc(PK.tests.title(i))}を編集"><b>${esc(i.date)} ${esc(i.who || "")}</b>${i.notes ? `<div class="sub">${esc(i.notes)}</div>` : ""}<div class="meta">${fx ? `<span class="tag">直すこと ${fx}件</span>` + (i.tasked ? `<span class="tag">✓ タスク化済み</span>` : `<button data-ptask="${i.id}">タスクにする</button>`) : ""}</div></div>`;
    }).join("");
  } else {
    $("pSum").textContent = "";
    html = items.slice().sort((a, b) => b.date.localeCompare(a.date) || (b.updatedAt || 0) - (a.updatedAt || 0)).map(i => {
      const ls = (i.notes || "").split("\n").map(s => s.trim()).filter(Boolean);
      return `<div class="pcard" data-pid="${i.id}" tabindex="0" role="button" aria-label="${esc(i.name)}を編集"><b>${esc(i.name)}</b> <span class="sub">${esc(i.date)}</span> ${link(i)}${ls.length ? `<ul>${ls.map(l => `<li>${esc(l)}</li>`).join("")}</ul>` : ""}</div>`;
    }).join("");
  }
  $("pList").innerHTML = html || `<p class="sub">まだないよ。「＋ ${K.add || K.label + "を追加"}」から始めよう。</p>`;
}
function openProd(id){
  const K = PK[pk], p = cur(), solo = p.mode === "solo";
  const it = (p[pk] || []).find(x => x.id === id) || {id:uid(), ...K.init(), isNew:true};
  editingP = {k:pk, it};
  $("pForm").innerHTML = K.fields.filter(f => !(f[2] === "who" && solo)).map(([key, label, type, extra]) => {
    const v = it[key] ?? "", id = "pf_" + key;
    const ctl = type === "area" ? `<textarea id="${id}" rows="4">${esc(v)}</textarea>`
      : type === "sel" ? `<select id="${id}">${opts(extra, v)}</select>`
      : type === "who" ? `<select id="${id}">${opts([["", "未定"], ...p.members.map(m => [m.id, m.name])], v)}</select>`
      : `<input id="${id}" type="${type === "date" ? "date" : "text"}" autocomplete="off" placeholder="${esc(type === "url" ? "https://..." : extra || "")}" value="${esc(v)}">`;
    return `<p class="lb">${esc(label)}</p>${ctl}`;
  }).join("");
  $("pErr").textContent = ""; $("pDel").hidden = !!it.isNew; $("pdlg").showModal();
}
$("pSave").onclick = () => {
  const {k, it} = editingP, K = PK[k], vals = {};
  for(const [key, , type] of K.fields){
    const el = $("pf_" + key); if(!el) continue; vals[key] = el.value.trim();
    if(type === "url" && vals[key] && !/^https:\/\//i.test(vals[key])){ $("pErr").textContent = "リンクは https:// から始まるものだけ使えるよ"; return; } // 安全のため
  }
  const err = K.check({...it, ...vals}); if(err){ $("pErr").textContent = err; return; }
  if(k === "tests" && (it.fixes || "") !== vals.fixes) it.tasked = false; // 直すことを書き換えたら、またタスクにできるように
  Object.assign(it, vals, {updatedAt:Date.now(), updatedBy:db.me || ""});
  const p = cur(), isNew = it.isNew; if(isNew){ delete it.isNew; (p[k] = p[k] || []).push(it); }
  $("pdlg").close(); commit(`${K.label}「${K.title(it)}」を${isNew ? "追加" : "編集"}`);
};
$("pCancel").onclick = () => $("pdlg").close();
$("pDel").onclick = () => { const {k, it} = editingP; it.deleted = true; it.updatedAt = Date.now(); it.updatedBy = db.me || ""; $("pdlg").close(); commit(`${PK[k].label}「${PK[k].title(it)}」を削除`); };
$("pAdd").onclick = () => openProd();
$("pSw").onclick = e => { const b = e.target.closest("[data-pk]"); if(b){ pk = b.dataset.pk; set("gtm-pk", pk); renderProd(); } };
$("pList").onclick = e => {
  const p = cur(), nx = e.target.closest("[data-pnext]"), tk = e.target.closest("[data-ptask]");
  if(nx){ const it = p.assets.find(x => x.id === nx.dataset.pnext), i = ASSET_ST.findIndex(s => s[0] === it.status); if(!ASSET_ST[i + 1]) return; it.status = ASSET_ST[i + 1][0]; it.updatedAt = Date.now(); it.updatedBy = db.me || ""; return commit(`素材「${it.name}」を ${ASSET_ST[i + 1][1]} にした`); }
  if(tk) return testToTasks(p.tests.find(x => x.id === tk.dataset.ptask));
  const st = e.target.closest("[data-wstep]"), cp = e.target.closest("[data-wcopy]"), ro = e.target.closest("[data-wreopen]");
  if(st){ const [id, k] = st.dataset.wstep.split(":"), it = (p.sessions || []).find(x => x.id === id); if(!it) return; it.steps = it.steps || {}; const on = !it.steps[k]; it.steps[k] = on ? Date.now() : 0; it.updatedAt = Date.now(); it.updatedBy = db.me || ""; return commit(`作業「${PK.sessions.title(it)}」：${WSTEPS.find(w => w[0] === k)[2]}を${on ? "完了" : "取り消し"}`); }
  if(ro){ const it = (p.sessions || []).find(x => x.id === ro.dataset.wreopen); if(!it) return; it.steps.end = 0; it.updatedAt = Date.now(); it.updatedBy = db.me || ""; return commit(`作業「${PK.sessions.title(it)}」を作業中に戻した`); }
  if(cp){ const [id, k] = cp.dataset.wcopy.split(":"), it = (p.sessions || []).find(x => x.id === id); if(it) copyText(workReport(it, k), cp); return; }
  if(e.target.closest("a")) return; // リンクを押したときは編集画面を開かない
  const c = e.target.closest("[data-pid]"); if(c) openProd(c.dataset.pid);
};
$("pList").onkeydown = e => { const c = e.target.closest("[data-pid]"); if(e.key === "Enter" && c && e.target === c){ e.preventDefault(); openProd(c.dataset.pid); } };
// 作業開始・終了の報告文を作る（連絡先に貼り付けて使う）
function workReport(it, kind){
  const p = cur(), who = it.who || db.me || "", now = Date.now(), s = it.steps || {};
  const t = ts => new Date(ts).toLocaleString("ja-JP", {month:"numeric", day:"numeric", hour:"2-digit", minute:"2-digit"});
  const L = [`【作業${kind === "start" ? "開始" : "終了"}】${p.name}`];
  if(who) L.push(`担当：${who}`);
  if(it.branch) L.push(`ブランチ：${it.branch}`);
  if(kind === "start"){ L.push(`日時：${t(now)}`); if(it.goal) L.push(`やること：${it.goal}`); }
  else {
    const end = s.end || now, from = s.start || s.fetch || 0; L.push(`日時：${t(end)}`);
    if(from && end > from){ const m = Math.max(1, Math.round((end - from) / 60000)); L.push(`作業時間：約${m >= 60 ? Math.floor(m / 60) + "時間" : ""}${m % 60 ? m % 60 + "分" : ""}`); }
    if(it.summary || it.goal) L.push(`やったこと：${it.summary || it.goal}`);
    if(it.commitMsg) L.push(`コミット：${it.commitMsg}`);
    if(it.prUrl) L.push(`プルリク：${it.prUrl}`);
  }
  return L.join("\n");
}
// 文章をクリップボードにコピーする（使えない環境では、古い方法で試す）
function copyText(text, btn){
  const done = ok => { const old = btn.textContent; btn.textContent = ok ? "コピーしたよ ✓" : "コピーできなかった"; setTimeout(() => { btn.textContent = old; }, 1800); };
  const old = () => { try { const ta = document.createElement("textarea"); ta.value = text; ta.style.cssText = "position:fixed;opacity:0"; document.body.appendChild(ta); ta.select(); const ok = document.execCommand("copy"); ta.remove(); done(ok); } catch(e) { done(false); } };
  navigator.clipboard && navigator.clipboard.writeText ? navigator.clipboard.writeText(text).then(() => done(true), old) : old();
}
// プレイテストの「直すこと」を、1行ずつタスクにする
function testToTasks(it){
  const p = cur(), lines = (it.fixes || "").split("\n").map(s => s.trim()).filter(Boolean); if(!it || !lines.length || it.tasked) return;
  const me = p.members.find(m => m.name === db.me), now = Date.now();
  lines.forEach(l => p.tasks.push({id:uid(), title:"【テスト】" + l, cat:catsOf(p)[1] || catsOf(p)[0], pri:"mid", status:"todo", assignee:me ? me.id : "", due:"", memo:`プレイテスト（${it.date} ${it.who || ""}）より`, updatedAt:now, updatedBy:db.me || ""}));
  it.tasked = true; it.updatedAt = now; it.updatedBy = db.me || "";
  commit(`プレイテスト（${it.date}）から ${lines.length}件のタスクを作った`);
}

let dragId = null;
$("board").ondragstart = e => { const c = e.target.closest(".card"); if(c){ dragId = c.dataset.id; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", dragId); } };
$("board").ondragover = e => { if(dragId && e.target.closest(".col")) e.preventDefault(); }; // 「ここに置いていいよ」の合図
$("board").ondrop = e => {
  const col = e.target.closest(".col"); if(!dragId || !col) return; e.preventDefault();
  const t = cur().tasks.find(x => x.id === dragId), st = col.dataset.st; dragId = null;
  if(!t || t.status === st) return;
  t.status = st; t.updatedAt = Date.now(); t.updatedBy = db.me || "";
  commit(`「${t.title}」を ${STATUS.find(s => s[0] === st)[2]} に移動`);
  if(st === "done") celebrate();
};
$("board").ondragend = () => { dragId = null; };

// 「さらに表示」ボタン（カードが多い列と、更新フィード）
$("board").addEventListener("click", e => { const b = e.target.closest("[data-more]"); if(b){ more[b.dataset.more] = (more[b.dataset.more] || 0) + CARD_LIMIT; render(); } });
$("feed").onclick = e => { if(e.target.id === "feedMore"){ feedShow += 30; render(); } };

// 完了タスクの表示/非表示
$("hd").onclick = () => { hideDone = !hideDone; set("gtm-hidedone", hideDone ? "1" : "0"); render(); };

// プロジェクト名の変更
$("rename").onclick = () => {
  const n = $("pName").value.trim(), p = cur(); if(!n || n === p.name) return;
  const old = p.name; p.name = n; commit(`プロジェクト名を「${old}」から「${n}」に変更`);
};

// プロジェクトの削除（うっかり防止で、1回目は確認だけ、2回目で削除）
let delArm = false;
$("delP").onclick = () => {
  if(!delArm){ delArm = true; $("delMsg").textContent = "もう一度押すと、タスクごと完全に消えるよ"; return; }
  const p = cur(); db.projects = db.projects.filter(x => x.id !== p.id); (db.deletedProjects = db.deletedProjects || []).push(p.id); // 消した印を残す（同期で復活させないため）
  db.current = db.projects[0].id; filter = ""; save(); render();
};

// 個人/チームの切り替え（個人にした時は、更新フィードを初期で隠す）
$("pMode").onchange = e => {
  const p = cur(); p.mode = e.target.value; filter = "";
  if(p.mode === "solo") p.feedOn = false;
  commit(`制作形態を${p.mode === "solo" ? "個人" : "チーム"}にした`);
};
$("feedOn").onchange = e => { cur().feedOn = e.target.checked; save(); render(); };

// 設定欄の通知ボタン：いつでも許可の状態を確認・変更できる
function updateNotif(){
  $("notifSt").textContent = !("Notification" in window) ? "このブラウザでは使えないよ"
    : {granted:"許可済み", denied:"ブロック中（ブラウザの設定で許可してね）", default:"まだ許可してないよ"}[Notification.permission];
}
$("notif").onclick = () => {
  if(!("Notification" in window)) return;
  Promise.resolve(Notification.requestPermission()).then(() => { updateNotif(); renderAlert(); notifyOnce(); }).catch(() => {});
};

load(); render(); notifyOnce(); fillSync();
$("dq").value = ""; setTimeout(() => { $("dq").value = ""; if(tab === "diary") renderDiary(); }, 600); // ブラウザの自動入力が入っても、検索欄は空に戻す
if(syncCfg().token && syncCfg().auto !== false) syncNow(); // 開いたときに自動で同期
// アプリとしてインストールできるように、オフライン用の仕組みを登録する（http/https のときだけ）
if("serviceWorker" in navigator && location.protocol.startsWith("http")) navigator.serviceWorker.register("sw.js").catch(() => {});
