/* Gurugram Vision Forum embed widget.
   RWAs and local sites add:
     <script src="https://gurugramvisionforum.org/embed.js" data-ward="15" data-lang="en" async></script>
   and get a small card inviting residents to report a civic problem. Inline styles inside a shadow
   root, so nothing clashes with the host page; no iframe; no tracking. Only the public count from
   /api/dashboard is fetched, and only shown once the Forum publishes figures. */
(function () {
  "use strict";
  var script = document.currentScript;
  if (!script) { var all = document.getElementsByTagName("script"); script = all[all.length - 1]; }
  if (!script || !script.src) return;
  var origin;
  try { origin = new URL(script.src, location.href).origin; } catch (e) { return; }
  var ward = String(script.getAttribute("data-ward") || "").replace(/\D/g, "");
  var hi = (script.getAttribute("data-lang") || "en").toLowerCase() === "hi";
  var T = hi ? {
    h: "गुरुग्राम में नागरिक समस्या?", p: "2 मिनट में दर्ज करें", btn: "समस्या दर्ज करें", ward: "वार्ड {n}", wardLink: "वार्ड पेज", by: "गुरुग्राम विज़न फ़ोरम", count: "{n} रिपोर्टें अब तक"
  } : {
    h: "Civic problem in Gurugram?", p: "Report it in 2 minutes", btn: "Report an issue", ward: "Ward {n}", wardLink: "Ward page", by: "Gurugram Vision Forum", count: "{n} reports so far"
  };
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]; }); }

  var host = document.createElement("div");
  host.className = "gvf-embed";
  host.setAttribute("lang", hi ? "hi" : "en");
  var root = host.attachShadow ? host.attachShadow({ mode: "open" }) : host;
  var reportUrl = origin + "/report?ref=embed", wardUrl = origin + "/ward/" + ward, homeUrl = origin + (hi ? "/hi" : "") + "/?ref=embed";
  root.innerHTML =
    '<style>' +
    ':host{all:initial;display:block}' +
    '.c{box-sizing:border-box;font-family:"Noto Sans","Noto Sans Devanagari","Segoe UI",Arial,sans-serif;font-size:16px;line-height:1.5;color:#1B2430;background:#fff;border:1px solid #D9DEE5;border-top:4px solid #0B2545;border-radius:12px;padding:16px 18px;max-width:420px;margin:0}' +
    '.c *{box-sizing:border-box}' +
    '.h{font-weight:700;font-size:19px;color:#0B2545;margin:0 0 2px}' +
    '.p{margin:0 0 12px;color:#4B5563}' +
    '.b{display:inline-flex;align-items:center;justify-content:center;min-height:44px;padding:10px 18px;border-radius:8px;background:#0B2545;color:#fff;font-weight:600;text-decoration:none;border:1.5px solid #0B2545}' +
    '.b:hover{filter:brightness(1.1)}.b:focus-visible{outline:none;box-shadow:0 0 0 3px #0B2545,0 0 0 6px #FF9933}' +
    '.w{margin:12px 0 0;font-size:15px;color:#4B5563}.w a,.f a{color:#0A4A8C}' +
    '.n{display:inline-block;margin-left:8px;font-size:14px;color:#0A4A8C;font-weight:600}' +
    '.f{margin:10px 0 0;font-size:13px;color:#4B5563}' +
    '.f span{display:inline-block;width:10px;height:10px;border-radius:2px;background:#FF9933;margin-right:6px;vertical-align:middle}' +
    '</style>' +
    '<div class="c" role="region" aria-label="' + esc(T.by) + '">' +
    '<p class="h">' + esc(T.h) + '</p><p class="p">' + esc(T.p) + '<span class="n" id="n" hidden></span></p>' +
    '<a class="b" href="' + esc(reportUrl) + '" target="_blank" rel="noopener">' + esc(T.btn) + '</a>' +
    (ward ? '<p class="w">' + esc(T.ward.replace("{n}", ward)) + ' · <a href="' + esc(wardUrl) + '" target="_blank" rel="noopener">' + esc(T.wardLink) + '</a></p>' : '') +
    '<p class="f"><span aria-hidden="true"></span><a href="' + esc(homeUrl) + '" target="_blank" rel="noopener">' + esc(T.by) + '</a></p>' +
    '</div>';
  if (script.parentNode) script.parentNode.insertBefore(host, script.nextSibling); else document.body.appendChild(host);

  if (!window.fetch) return;
  fetch(origin + "/api/dashboard", { mode: "cors", credentials: "omit" }).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    // The Forum publishes figures from the first 50 reports; before that the API says published:false and no number is shown.
    if (!j || !j.ok || !j.published) return;
    var n = +j.total || (j.summary && +j.summary.total) || 0;
    if (!n) return;
    var el = root.getElementById ? root.getElementById("n") : root.querySelector("#n");
    if (!el) return;
    el.textContent = T.count.replace("{n}", n.toLocaleString(hi ? "hi-IN" : "en-IN"));
    el.hidden = false;
  }).catch(function () {});
})();
