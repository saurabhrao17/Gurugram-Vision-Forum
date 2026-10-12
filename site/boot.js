/* boot.js: runs in <head> before the first paint. Keep it tiny and free of
   dependencies; it is the only render-blocking script on the page.
   0. Forwards an old "#/rights" style address to "/rights" (see below).
   1. Applies the saved theme, so a dark-mode visitor never sees a light flash.
   2. Lets the home page paint before data.js and app.js arrive: on the home
      URL in English it sets html[data-boot=home], which styles.css uses to show
      #v-home; route() in app.js removes the flag on its first run. Hindi
      visitors wait for app.js, which translates the page before showing it,
      so English never flashes. Every other view still waits for app.js.
   3. Loads the Google Fonts stylesheet without blocking the paint: text shows
      in the fallback font first and swaps when the fonts arrive (display=swap).
      index.html keeps a <noscript> copy of the same link. */
(function () {
  var d = document.documentElement;
  function get(k) { try { var v = localStorage.getItem(k); return v ? JSON.parse(v) : null; } catch (e) { return null; } }
  var t = get("gvf_theme");
  if (t === "dark" || t === "light") d.setAttribute("data-theme", t);
  // 0. Old "#/rights" style links: forward to the real address "/rights" (the server never sees the part after "#", so this runs here). file:// keeps the hash.
  var old = /^#\/(.*)$/.exec(location.hash);
  if (old && location.protocol !== "file:" && /^((report|track|directory|rights|who|wards|charter|dashboard|updates|join|about|accessibility|privacy|map|desk|r|fix|news|pulse|home)(\/[^\/?#]*)?)?$/.test(old[1])) {
    location.replace("/" + old[1].replace(/^home$/, "") + location.search);
    return;
  }
  var h = location.hash.replace(/^#\/?/, ""), p = location.pathname;
  var home = (p === "" || p === "/" || /\/index\.html$/.test(p)) && /^(home|fix)?(\/|$)/.test(h);
  if (home && get("gvf_lang") !== "hi") d.setAttribute("data-boot", "home");
  var l = document.createElement("link");
  l.rel = "stylesheet";
  l.href = "https://fonts.googleapis.com/css2?family=Anek+Latin:wght@500;600;700&family=Anek+Devanagari:wght@600;700&family=Noto+Sans:wght@400;600&family=Noto+Sans+Devanagari:wght@400;600&display=swap";
  document.head.appendChild(l);
})();
