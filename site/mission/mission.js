/* Private Mission page, step 2: sign-in, the signed-in state, sign out, withdraw consent.
   Talks only to /api/mission/*. Shows no data. The session lives in this tab only (sessionStorage);
   no answer from the server is ever stored. Does not load the Forum's app.js, data.js or boot.js. */
(function () {
  "use strict";
  var S = window.MISSION_STR, lang = "en", session = null, role = "", timer = null, KEY = "gvfm_s", LKEY = "gvfm_l";
  function $(id) { return document.getElementById(id); }
  function t(k) { return (S[lang] && S[lang][k]) || S.en[k] || k; }
  function store(op, k, v) {
    try { if (op === "get") return window.sessionStorage.getItem(k); if (op === "set") window.sessionStorage.setItem(k, v); else window.sessionStorage.removeItem(k); } catch (e) { /* private mode: stay in memory */ }
    return null;
  }
  var lastErr = { err: "", err2: "" };
  function showErr(id, key) { lastErr[id] = key; $(id).className = key === "withdrawn" ? "ok" : "err"; $(id).textContent = key ? t(key) : ""; }
  function render() {
    document.documentElement.lang = lang;
    document.title = t("pageTitle");
    var els = document.querySelectorAll("[data-m]");
    for (var i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute("data-m"));
    $("lang").textContent = t("langLabel");
    $("lang").setAttribute("aria-label", t("langAria"));
    $("lang").setAttribute("lang", lang === "en" ? "hi" : "en");
    if (role) $("role").textContent = t("role_" + role);
    showErr("err", lastErr.err); showErr("err2", lastErr.err2);
  }
  function api(path, body, token) {
    var h = { "Content-Type": "application/json" };
    if (token) h.Authorization = "Bearer " + token;
    return fetch("/api/mission/" + path, { method: "POST", headers: h, body: JSON.stringify(body || {}), cache: "no-store", credentials: "omit" })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, body: j }; }); });
  }
  function errKey(r) {
    if (r.status === 400) return "errInvalid";
    if (r.status === 401) return r.body.error === "expired" ? "errExpired" : "errBad";
    if (r.status === 403) return "errNotMember";
    return "errServer";
  }
  function view(signedIn) {
    $("signin").hidden = signedIn; $("signed").hidden = !signedIn;
    $("confirm").hidden = true;
    $(signedIn ? "hSigned" : "hSignin").focus();
  }
  function keep(j) {
    session = j.session; role = j.member.role; store("set", KEY, JSON.stringify(session));
    clearTimeout(timer);
    var ms = Math.max(30, (session.expires_at || 0) - Math.floor(Date.now() / 1000) - 60) * 1000;
    timer = setTimeout(refresh, Math.min(ms, 2147000000));
  }
  function clear() { clearTimeout(timer); session = null; role = ""; store("del", KEY); }
  function refresh() {
    if (!session) return Promise.resolve(false);
    return api("refresh", { refresh_token: session.refresh_token }).then(function (r) {
      if (r.status === 200 && r.body.ok) { keep(r.body); return true; }
      clear(); showErr("err", r.status === 0 ? "" : errKey(r)); view(false); render(); return false;
    }, function () { return false; });
  }
  function busy(btn, on, key) { btn.disabled = on; if (on) btn.textContent = t(key); else btn.textContent = t(btn.getAttribute("data-m")); }

  $("form").addEventListener("submit", function (e) {
    e.preventDefault();
    var email = $("email").value.trim(), pw = $("password").value;
    if (!email || !pw) { showErr("err", "errInvalid"); (email ? $("password") : $("email")).focus(); return; }
    showErr("err", ""); busy($("go"), true, "signingIn");
    api("login", { email: email, password: pw }).then(function (r) {
      busy($("go"), false);
      if (r.status === 200 && r.body.ok) {
        $("password").value = ""; keep(r.body); showErr("err", ""); $("msg").textContent = "";
        view(true); render();
      } else { showErr("err", errKey(r)); $("password").value = ""; $("password").focus(); }
    }, function () { busy($("go"), false); showErr("err", "errNetwork"); });
  });
  function out(key) {
    clear(); showErr("err2", ""); $("email").value = ""; $("password").value = ""; $("msg").textContent = "";
    view(false); showErr("err", key);
  }
  $("out").addEventListener("click", function () { out(""); render(); });
  $("wd").addEventListener("click", function () { showErr("err2", ""); $("confirm").hidden = false; $("hConfirm").focus(); });
  $("wdNo").addEventListener("click", function () { $("confirm").hidden = true; $("wd").focus(); });
  $("wdYes").addEventListener("click", function () {
    if (!session) return;
    showErr("err2", ""); busy($("wdYes"), true, "working");
    api("withdraw", {}, session.access_token).then(function (r) {
      busy($("wdYes"), false);
      if (r.status === 200 && r.body.ok) { out("withdrawn"); render(); }
      else if (r.status === 401) { refresh().then(function (ok) { if (ok) showErr("err2", "errServer"); }); }
      else showErr("err2", r.status === 403 ? "errNotMember" : "errServer");
    }, function () { busy($("wdYes"), false); showErr("err2", "errNetwork"); });
  });
  $("lang").addEventListener("click", function () { lang = lang === "en" ? "hi" : "en"; store("set", LKEY, lang); render(); });

  try { var l = store("get", LKEY); if (l === "hi" || l === "en") lang = l; } catch (e) { /* ignore */ }
  render();
  var saved = null;
  try { saved = JSON.parse(store("get", KEY) || "null"); } catch (e) { saved = null; }
  if (saved && saved.refresh_token) { session = saved; refresh().then(function (ok) { if (ok) { view(true); render(); } }); }
})();
