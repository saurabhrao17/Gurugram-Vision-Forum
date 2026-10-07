(function(){
"use strict";
var D=window.GVF, L=D.L;
function $(id){return document.getElementById(id)}
function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function ic(n,cls){return '<svg class="i'+(cls?' '+cls:'')+'" aria-hidden="true"><use href="#i-'+n+'"/></svg>'}
function ext(h){return h&&h.indexOf("http")===0?' target="_blank" rel="noopener" class="ext"':''}
function store(k,v){try{localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function load(k,d){try{var v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
function toast(m){var t=$("toast");t.textContent=m;t.classList.add("show");clearTimeout(t._h);t._h=setTimeout(function(){t.classList.remove("show")},2600)}
function catById(id){for(var i=0;i<D.CATS.length;i++)if(D.CATS[i].id===id)return D.CATS[i];return null}
var reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/* api (Vercel functions on Supabase; see docs/deploy.md). Falls back to this device when unreachable. */
var API=(window.GVF_CONFIG&&window.GVF_CONFIG.api)||"/api";
var API_ON=location.protocol!=="file:"&&!!window.fetch&&!!window.Promise;
function api(path,opts){opts=opts||{};return new Promise(function(resolve,reject){if(!API_ON){reject({offline:true});return}
  var ctrl=window.AbortController?new AbortController():null,timer=setTimeout(function(){if(ctrl)ctrl.abort()},12000);
  fetch(API+path,{method:opts.method||"GET",headers:opts.body?{"Content-Type":"application/json"}:{},body:opts.body?JSON.stringify(opts.body):undefined,signal:ctrl?ctrl.signal:undefined,credentials:"same-origin"})
    .then(function(r){clearTimeout(timer);return r.json().then(function(j){return j},function(){return {}}).then(function(j){if(r.ok)resolve(j);else reject({status:r.status,error:j.error,fields:j.fields})})},
          function(){clearTimeout(timer);reject({offline:true})})})}
function t(key,en){return lang==="hi"&&D.HI&&D.HI[key]?D.HI[key]:en}

/* theme */
function setTheme(t){document.documentElement.setAttribute("data-theme",t);store("gvf_theme",t);var dark=t==="dark";["themeBtn","themeBtn2"].forEach(function(id){var b=$(id);if(b)b.innerHTML=ic(dark?"sun":"moon","i-s")})}
var th=load("gvf_theme",null); if(th) setTheme(th); else { var sysDark=window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches; ["themeBtn","themeBtn2"].forEach(function(id){var b=$(id);if(b)b.innerHTML=ic(sysDark?"sun":"moon","i-s")}) }
function toggleTheme(){var cur=document.documentElement.getAttribute("data-theme");if(!cur){cur=(window.matchMedia&&window.matchMedia("(prefers-color-scheme: dark)").matches)?"dark":"light"}setTheme(cur==="dark"?"light":"dark")}
$("themeBtn").addEventListener("click",toggleTheme); $("themeBtn2").addEventListener("click",toggleTheme);

/* i18n */
var EN={},ENPH={};
document.querySelectorAll("[data-i18n]").forEach(function(el){var k=el.getAttribute("data-i18n");if(!(k in EN))EN[k]=el.textContent});
document.querySelectorAll("[data-i18n-ph]").forEach(function(el){var k=el.getAttribute("data-i18n-ph");if(!(k in ENPH))ENPH[k]=el.getAttribute("placeholder")});
var lang=load("gvf_lang","en");
function applyLang(l){lang=l;var dict=l==="hi"?D.HI:EN;
  document.querySelectorAll("[data-i18n]").forEach(function(el){var k=el.getAttribute("data-i18n");if(dict[k]!=null)el.textContent=dict[k]});
  document.querySelectorAll("[data-i18n-ph]").forEach(function(el){var k=el.getAttribute("data-i18n-ph");var v=l==="hi"?D.HI[k]:ENPH[k];if(v!=null)el.setAttribute("placeholder",v)});
  document.documentElement.lang=l;
  ["langBtn","langBtn2"].forEach(function(id){var b=$(id);if(b)b.innerHTML=l==="hi"?'<span>EN</span><span>|</span><b lang="hi">हिं</b>':'<b>EN</b><span>|</span><span lang="hi">हिं</span>'});
  store("gvf_lang",l); renderTiles(); renderWhoFilter(); renderCatSelect();
}
function toggleLang(){applyLang(lang==="hi"?"en":"hi");toast(lang==="hi"?"हिंदी में। लंबे लेख अभी अंग्रेज़ी में हैं।":"English")}
$("langBtn").addEventListener("click",toggleLang); $("langBtn2").addEventListener("click",toggleLang);

/* sheet */
var lastFocus=null;
function openSheet(title,html){lastFocus=document.activeElement;$("sheetTitle").textContent=title;$("sheetBody").innerHTML=html;$("veil").classList.add("open");$("sheet").classList.add("open");document.body.style.overflow="hidden";setTimeout(function(){$("sheetClose").focus()},30)}
function closeSheet(){$("veil").classList.remove("open");$("sheet").classList.remove("open");document.body.style.overflow="";if(lastFocus&&lastFocus.focus)lastFocus.focus()}
$("sheetClose").addEventListener("click",closeSheet); $("veil").addEventListener("click",function(){closeSheet();closeCmd()});
document.addEventListener("keydown",function(e){if(e.key==="Escape"){closeSheet();closeCmd();closeMenu()} if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="k"){e.preventDefault();openCmd()}});
$("sheetBody").addEventListener("click",function(e){var t=e.target.closest("[data-stab]");if(t){var pane=t.getAttribute("data-stab");$("sheetBody").querySelectorAll(".stab").forEach(function(b){b.setAttribute("aria-selected",b===t?"true":"false")});$("sheetBody").querySelectorAll(".spane").forEach(function(p){p.classList.toggle("on",p.getAttribute("data-pane")===pane)});return}
  if(e.target.closest("a[href^='#/']")) closeSheet()});

/* menu */
function openMenu(){$("menu").classList.add("open");document.body.style.overflow="hidden";$("menuClose").focus()}
function closeMenu(){$("menu").classList.remove("open");if(!$("sheet").classList.contains("open"))document.body.style.overflow=""}
$("menuBtn").addEventListener("click",openMenu); $("menuClose").addEventListener("click",closeMenu);
$("menu").addEventListener("click",function(e){if(e.target.closest("a"))closeMenu()});

/* command search */
var INDEX=[];
D.CATS.forEach(function(c){INDEX.push({t:c.label,s:c.agency,h:"#/fix/"+c.id,ic:c.ic,k:"Issue"})});
D.PORTALS.forEach(function(p){INDEX.push({t:p.n,s:p.f,h:"#/directory",ic:"link",k:"Portal",ext:p.h})});
D.CHARTERS.forEach(function(c){INDEX.push({t:c.t,s:c.right,h:"#/rights/"+c.id,ic:"rights",k:"Right"})});
Object.keys(D.ROLES).forEach(function(id){var r=D.ROLES[id];INDEX.push({t:r.b,s:r.who||r.owns,h:"#/who/"+id,ic:"who",k:"Role"})});
D.WARDS.forEach(function(w){INDEX.push({t:"Ward "+w[0]+": "+w[1],s:w[2],h:"#/wards",ic:"wards",k:"Ward"})});
function openCmd(){$("veil").classList.add("open");$("cmdk").classList.add("open");$("cmdIn").value="";renderCmd("");$("cmdIn").focus()}
function closeCmd(){$("cmdk").classList.remove("open");if(!$("sheet").classList.contains("open"))$("veil").classList.remove("open")}
function renderCmd(q){q=q.trim().toLowerCase();var hits=q?INDEX.filter(function(x){return (x.t+" "+x.s).toLowerCase().indexOf(q)>-1}).slice(0,12):INDEX.slice(0,8);
  $("cmdList").innerHTML=hits.length?hits.map(function(x){return '<li><a href="'+x.h+'">'+ic(x.ic)+'<span><b>'+esc(x.t)+'</b><br><span class="small muted">'+esc(x.s)+'</span></span><small>'+x.k+'</small></a></li>'}).join(""):'<li class="none">Nothing matches. Try another word, or use Something else on the home page.</li>'}
$("searchBtn").addEventListener("click",openCmd); $("searchBtn2").addEventListener("click",function(){closeMenu();openCmd()}); $("cmdIn").addEventListener("input",function(){renderCmd(this.value)});
$("cmdList").addEventListener("click",function(e){if(e.target.closest("a"))closeCmd()});

/* router */
var VIEWS={home:"v-home",report:"v-report",track:"v-track",directory:"v-directory",rights:"v-rights",who:"v-who",wards:"v-wards",charter:"v-charter",dashboard:"v-dashboard",updates:"v-updates",post:"v-post",join:"v-join",about:"v-about",access:"v-access"};
var TITLES={home:"Who fixes my problem?",report:"Report an issue",track:"Track a report",directory:"Official channels",rights:"Your rights",who:"Who is responsible",wards:"Your ward",charter:"The civic charter",dashboard:"Accountability dashboard",updates:"Updates",post:"Updates",join:"Join the Forum",about:"About the Forum",access:"Accessibility statement"};
var curView=null;
function route(){
  var h=location.hash.replace(/^#\/?/,""); var parts=h.split("/"); var name=parts[0]||"home"; var arg=parts[1]?decodeURIComponent(parts[1]):"";
  var map={"":"home",home:"home",fix:"home",report:"report",track:"track",directory:"directory",rights:"rights",who:"who",wards:"wards",charter:"charter",dashboard:"dashboard",updates:"updates",join:"join",about:"about",accessibility:"access"};
  var v=map[name]; if(!v){location.hash="#/";return}
  if(name==="updates"&&arg){renderPost(arg);v="post"}
  var changed=v!==curView;
  document.querySelectorAll(".view").forEach(function(s){s.classList.toggle("on",s.id===VIEWS[v])});
  document.querySelectorAll("#nav a,.bbar a").forEach(function(a){a.classList.toggle("on",a.getAttribute("data-v")===v||(v==="post"&&a.getAttribute("data-v")==="updates"))});
  document.title="Gurugram Vision Forum — "+TITLES[v];
  if(name==="fix"&&arg){selectTile(arg,false)}
  if(name==="fix"&&!arg&&curView==="home"){clearTile()}
  if(name==="rights"&&arg){openRight(arg)}
  if(name==="who"&&arg){openRole(arg)}
  if(name==="track"&&arg){$("trRef").value=arg;showTrack()}
  if(name==="report"&&arg){pendingCat=arg}
  if(v==="report"){initReport()}
  if(v==="dashboard"){renderDash()}
  if(changed){window.scrollTo({top:0,behavior:"instant" in window?"instant":"auto"});curView=v}
  closeMenu();
}
window.addEventListener("hashchange",route);

/* tiles + panel */
var selected=null;
function renderTiles(){var q=($("tileSearch").value||"").trim().toLowerCase();var html="";var n=0;
  D.CATS.forEach(function(c){var lab=lang==="hi"?c.hl:c.label;var hit=!q||(c.label+" "+c.hl+" "+c.agency+" "+c.owns).toLowerCase().indexOf(q)>-1;if(hit)n++;
    html+='<button class="tile'+(hit?'':' hide')+'" type="button" data-cat="'+c.id+'" aria-pressed="'+(selected===c.id)+'">'+ic(c.ic)+'<span>'+esc(lab)+'</span></button>'});
  if(!n)html+='<div class="tiles-empty">Nothing matches. Pick Something else and describe it.</div>';
  $("tiles").innerHTML=html}
$("tileSearch").addEventListener("input",renderTiles);
$("tiles").addEventListener("click",function(e){var b=e.target.closest("[data-cat]");if(!b)return;var id=b.getAttribute("data-cat");if(selected===id){location.hash="#/fix";return}location.hash="#/fix/"+id});
function clearTile(){selected=null;$("panel").classList.remove("show");$("panel").innerHTML="";renderTiles()}
function chanRows(c){return '<ul class="ch">'+c.channels.map(function(ch){return '<li>'+ic(ch.ic||"link")+'<span><span class="k">'+esc(ch.k)+'</span>'+(ch.href?'<a href="'+ch.href+'"'+ext(ch.href)+'>'+esc(ch.v)+'</a>':esc(ch.v))+'</span></li>'}).join("")+'</ul>'}
function stepsHtml(arr,cls){return '<ol class="steps'+(cls?' '+cls:'')+'">'+arr.map(function(s){return '<li>'+esc(s)+'</li>'}).join("")+'</ol>'}
function selectTile(id,scroll){var c=catById(id);if(!c){clearTile();return}selected=id;renderTiles();
  var first=null;for(var i=0;i<c.channels.length;i++){if(c.channels[i].href&&c.channels[i].href.indexOf("http")===0){first=c.channels[i];break}}
  $("panel").innerHTML='<div class="panel-grid"><div class="pcol"><h4>'+ic("who")+'Responsible desk</h4><p class="agency">'+esc(c.agency)+'</p><p class="remit">'+esc(c.owns)+'</p></div><div class="pcol"><h4>'+ic("link")+'Official channels</h4>'+chanRows(c)+'</div><div class="pcol"><h4>'+ic("up")+'If nobody answers</h4>'+stepsHtml(c.ladder,"saffron")+'</div></div><div class="panel-foot"><a class="btn btn-primary" href="#/report/'+c.id+'">Report it here too</a>'+(first?'<a class="btn btn-line" href="'+first.href+'" target="_blank" rel="noopener">Open '+esc(first.k.toLowerCase()==="portal"?"the portal":first.v)+'</a>':'')+'<span class="small muted">Both matter: the official ticket creates the record; the Forum tracks it.</span></div>';
  $("panel").classList.add("show");
  if(scroll!==false&&window.innerWidth<1024){setTimeout(function(){$("panel").scrollIntoView({behavior:reduce?"auto":"smooth",block:"start"})},50)}
}

/* count-up */
(function(){var els=document.querySelectorAll("[data-count]");function run(el){var n=+el.getAttribute("data-count");if(reduce){el.textContent=n;return}var t0=null;function step(ts){if(!t0)t0=ts;var p=Math.min(1,(ts-t0)/800);el.textContent=Math.round(n*(1-Math.pow(1-p,3)));if(p<1)requestAnimationFrame(step)}requestAnimationFrame(step)}
  if("IntersectionObserver" in window){var io=new IntersectionObserver(function(en){en.forEach(function(x){if(x.isIntersecting){run(x.target);io.unobserve(x.target)}})},{threshold:.5});els.forEach(function(el){io.observe(el)})}else els.forEach(run)})();

/* report */
var pendingCat=null, geo=null, step=1, reportInit=false;
function renderCatSelect(){var sel=$("fCat");var cur=sel.value;sel.innerHTML='<option value="">'+(lang==="hi"?"निकटतम प्रकार चुनें":"Choose the closest match")+'</option>'+D.CATS.map(function(c){return '<option value="'+c.id+'">'+esc(lang==="hi"?c.hl:c.label)+'</option>'}).join("");if(cur)sel.value=cur}
function initReport(){if(!reportInit){reportInit=true;$("areaList").innerHTML=D.AREAS.map(function(a){return '<option value="'+esc(a)+'">'}).join("");$("fWard").innerHTML='<option value="">Not sure yet</option>'+D.WARDS.map(function(w){return '<option value="'+w[0]+'">Ward '+w[0]+', '+esc(w[1])+'</option>'}).join("");renderRecent()}
  if(pendingCat){$("fCat").value=pendingCat;pendingCat=null;showHint();goStep(1)}}
function showHint(){var c=catById($("fCat").value),h=$("fHint");if(!c){h.classList.remove("show");h.innerHTML="";return}var first=null;for(var i=0;i<c.channels.length;i++){if(c.channels[i].href&&c.channels[i].href.indexOf("http")===0){first=c.channels[i];break}}
  h.innerHTML='<b>'+esc(c.agency)+'</b> handles this. Also file it officially: '+(first?'<a href="'+first.href+'"'+ext(first.href)+'>'+esc(first.v)+'</a>':esc(c.channels[0].v))+'.';h.classList.add("show")}
$("fCat").addEventListener("change",showHint);
$("fWard").addEventListener("change",function(){var n=+this.value;var p=$("wardHint");if(n){var w=D.WARDS[n-1];p.innerHTML='<b>Ward '+n+'.</b> Councillor '+esc(w[1])+' ('+esc(w[2])+'). The report is copied to the councillor once the office contact is verified.'}else{p.innerHTML='<span data-i18n="f.wardHint">'+(lang==="hi"?"पता नहीं?":"Not sure?")+'</span> <a href="'+L.onemap+'" target="_blank" rel="noopener" class="ext">OneMap</a>, <a href="'+L.voterList+'" target="_blank" rel="noopener" class="ext">voter lists</a>, <a href="#/wards">ward directory</a>'}});
$("geoBtn").addEventListener("click",function(){var o=$("geoOut");if(!navigator.geolocation){o.textContent="Location is not available here. Type the spot instead.";return}o.textContent="Finding you…";navigator.geolocation.getCurrentPosition(function(p){geo={lat:p.coords.latitude.toFixed(5),lng:p.coords.longitude.toFixed(5)};o.innerHTML='Pinned '+geo.lat+', '+geo.lng+'. <a href="https://www.google.com/maps?q='+geo.lat+','+geo.lng+'" target="_blank" rel="noopener">Check on a map</a>'},function(){o.textContent="Could not get a location. Type the spot instead."},{enableHighAccuracy:true,timeout:10000})});
function valid(ids){var ok=true;ids.forEach(function(id){var el=$(id);var v=el.type==="checkbox"?el.checked:el.value.trim();var bad=!v||(el.type==="tel"&&!/^\+?[0-9\s-]{10,14}$/.test(el.value.trim()))||(el.type==="email"&&el.required&&!/^\S+@\S+\.\S+$/.test(v));if(bad){ok=false;el.setAttribute("aria-invalid","true")}else el.removeAttribute("aria-invalid")});return ok}
var STEP_FIELDS={1:["fCat","fScope"],2:["fWhere","fSpot"],3:["fDesc","fName","fPhone","fConsent"]};
function goStep(n){step=n;document.querySelectorAll(".fstep").forEach(function(s){s.classList.toggle("on",+s.getAttribute("data-step")===n)});var segs=$("prog").children;for(var i=0;i<4;i++){segs[i].className=i+1<n?"done":i+1===n?"now":""}if(n===4)renderSummary();$("fErr").classList.remove("show");var f=$("reportForm");f.scrollIntoView({behavior:reduce?"auto":"smooth",block:"start"})}
$("reportForm").addEventListener("click",function(e){var b=e.target.closest("[data-go]");if(!b)return;var to=+b.getAttribute("data-go");if(to>step){var ok=true;for(var s=step;s<to;s++){if(!valid(STEP_FIELDS[s])){ok=false;break}}if(!ok){$("fErr").classList.add("show");var bad=$("reportForm").querySelector('[aria-invalid="true"]');if(bad)bad.focus();return}}goStep(to)});
function renderSummary(){var c=catById($("fCat").value);var rows=[["Issue",c?c.label:""],["Affects",$("fScope").value],["Area",$("fWhere").value],["Ward",$("fWard").value?"Ward "+$("fWard").value:"Not sure"],["Spot",$("fSpot").value+(geo?" ("+geo.lat+", "+geo.lng+")":"")],["Details",$("fDesc").value],["Name",$("fName").value],["Mobile",$("fPhone").value]];if($("fEmail").value)rows.push(["Email",$("fEmail").value]);
  $("summary").innerHTML=rows.map(function(r){return '<div><dt>'+esc(r[0])+'</dt><dd>'+esc(r[1])+'</dd></div>'}).join("")}
function makeRef(){var a="ABCDEFGHJKLMNPQRSTUVWXYZ23456789",s="";for(var i=0;i<5;i++)s+=a[Math.floor(Math.random()*a.length)];return "GVF-"+new Date().getFullYear()+"-"+s}
function recents(){return load("gvf_reports",[])}
function renderRecent(){var list=recents(),box=$("recent");if(!list.length){box.hidden=true;return}$("recentList").innerHTML=list.map(function(r){return '<li class="row">'+ic("track")+'<div><b><a href="#/track/'+r.ref+'">'+esc(r.ref)+'</a></b><p class="for">'+esc(r.cat)+', '+esc(r.where)+(r.ward?', ward '+r.ward:'')+'</p><div class="meta">'+esc(r.date)+(r.ticket?' · ticket '+esc(r.ticket):'')+'</div></div></li>'}).join("");box.hidden=false}
$("reportForm").addEventListener("submit",function(e){e.preventDefault();if(!valid(STEP_FIELDS[1].concat(STEP_FIELDS[2],STEP_FIELDS[3]))){$("fErr").textContent=t("f.err","Fill in the highlighted fields to continue.");$("fErr").classList.add("show");return}
  var form=this,c=catById($("fCat").value),ward=$("fWard").value,btn=form.querySelector('button[type=submit]');
  var p={issue_type:c.id,affects:$("fScope").value,area:$("fWhere").value.trim(),ward:ward||null,spot:$("fSpot").value.trim(),lat:geo?geo.lat:null,lng:geo?geo.lng:null,description:$("fDesc").value.trim(),name:$("fName").value.trim(),phone:$("fPhone").value.trim(),email:$("fEmail").value.trim()||null,consent:$("fConsent").checked};
  if(window.turnstile&&$("tsReport"))p.turnstile=window.turnstile.getResponse($("tsReport"))||"";
  var old=btn.textContent;btn.disabled=true;btn.textContent=t("f.sending","Sending…");
  function restore(){btn.disabled=false;btn.textContent=old}
  api("/report",{method:"POST",body:p}).then(function(j){restore();finishReport(form,c,p,ward,j.ref,true,null)},function(err){restore();
    if(err.status===400&&err.fields){$("fErr").textContent=t("f.err3","Please check: ")+err.fields.join(", ");$("fErr").classList.add("show");goStep(/phone|name|description|email|consent/.test(err.fields.join())?3:/area|spot|ward/.test(err.fields.join())?2:1);return}
    finishReport(form,c,p,ward,makeRef(),false,err)})});
function finishReport(form,c,p,ward,ref,synced,err){
  var date=new Date().toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"});
  var rec={ref:ref,catId:c.id,cat:c.label,where:p.area,ward:ward,date:date,stage:0,ticket:"",synced:synced,last4:p.phone.replace(/\D/g,"").slice(-4)};var list=recents();list.unshift(rec);store("gvf_reports",list.slice(0,20));renderRecent();
  var body="Reference: "+ref+"\nIssue: "+c.label+"\nAffects: "+p.affects+"\nArea: "+p.area+(ward?"\nWard: "+ward:"")+"\nSpot: "+p.spot+(p.lat!=null?"\nCoordinates: "+p.lat+", "+p.lng:"")+"\n\n"+p.description+"\n\nName: "+p.name+"\nMobile: "+p.phone+(p.email?"\nEmail: "+p.email:"")+"\n\nResponsible desk: "+c.agency+(synced?"":"\n\n(Not yet received by the Forum's server; sent by email.)");
  var mail="mailto:contact@gurugramvisionforum.org?subject="+encodeURIComponent("Issue report "+ref+": "+c.label)+"&body="+encodeURIComponent(body);
  var official=c.channels.filter(function(ch){return ch.href&&ch.href.indexOf("tel:")!==0&&ch.href.indexOf("#")!==0}).map(function(ch){return esc(ch.k)+": <a href=\""+ch.href+"\""+ext(ch.href)+">"+esc(ch.v)+"</a>"});
  var notice=synced?'':'<div class="err show" style="margin:.75rem 0 0">'+(err&&err.status===429?t("f.limit","Too many reports came from this connection in the last hour, so this one is saved on this device only. Email a copy so it is not lost."):t("f.offline","We could not reach the Forum\'s server, so this report is saved on this device only. Email a copy so it is not lost."))+'</div>';
  var box=$("confirm");box.innerHTML='<p class="small muted" style="margin:0 0 .25rem">Report received</p><div class="ref">'+ref+'</div><p style="margin:.5rem 0 0">A volunteer maps it to <b>'+esc(c.agency)+'</b> within three working days. <a href="#/track/'+ref+'">Track it</a>'+(synced?' '+t("f.keep","from any device with this reference and the last 4 digits of your mobile."):'.')+'</p>'+notice+'<div class="box"><h4 style="margin-bottom:.5rem">Now file it officially</h4>'+stepsHtml([official.length?"Open the official channel: "+official[0].replace(/<[^>]+>/g,""):"Use the channel shown for your issue.","Note the ticket or complaint number.","Save it here so the Forum can escalate."])+'<div class="ch" style="margin:.5rem 0 1rem">'+official.map(function(o){return '<div style="font-size:1rem">'+o+'</div>'}).join("")+'</div><div class="ticket"><div class="field"><label for="tk_'+ref+'">Official ticket number</label><input type="text" id="tk_'+ref+'" placeholder="e.g. GMDA ticket number"></div><button class="btn btn-line" type="button" data-ticket="'+ref+'">Save</button></div></div><div style="display:flex;gap:.6rem;flex-wrap:wrap"><a class="btn '+(synced?'btn-line':'btn-ink')+'" href="'+mail+'">Email a copy to the Forum</a><button class="btn btn-line" type="button" id="copyBtn">Copy the report</button></div>';
  box.classList.add("show");$("copyBtn").addEventListener("click",function(){if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(body).then(function(){toast("Report copied")},function(){toast("Could not copy")});else toast("Copy is not supported here")});
  form.reset();geo=null;$("geoOut").textContent="";showHint();goStep(1);box.scrollIntoView({behavior:reduce?"auto":"smooth",block:"start"})}
document.addEventListener("click",function(e){var b=e.target.closest("[data-ticket]");if(!b)return;var ref=b.getAttribute("data-ticket"),v=$("tk_"+ref).value.trim();if(!v){toast("Enter the ticket number first");return}var list=recents();list.forEach(function(r){if(r.ref===ref){r.ticket=v;r.stage=Math.max(r.stage,2)}});store("gvf_reports",list);renderRecent();toast("Ticket "+v+" saved with "+ref)});

/* track */
var STAGES=[["Received","With the Forum, being read."],["Mapped","Agency, officer level and ward councillor identified."],["Filed officially","An official ticket exists; its number is on the report."],["Escalated","No action in time; moved one level up the ladder."],["Resolved","You confirmed the fix, or the case closed with a reason."]];
function renderTrack(r){var st=r.stage||0,ev={};(r.events||[]).forEach(function(e){ev[e.stage]=e.at});
  $("trOut").innerHTML='<p><b>'+esc(r.ref)+'</b> '+esc(r.cat)+', '+esc(r.where)+(r.ward?', ward '+r.ward:'')+'. Sent '+esc(r.date)+(r.ticket?'. Ticket '+esc(r.ticket):'')+(r.desk?'. Desk: '+esc(r.desk):'')+'</p>'+(r.live?'':'<p class="small muted">'+t("k.local","Shown from this device. Enter the last 4 digits of your mobile to check the Forum\'s record.")+'</p>')+'<ol class="tl">'+STAGES.map(function(s,i){var tag=i<st?'<span class="tag tag-green">'+ic("check")+'Done</span>':i===st?'<span class="tag tag-saffron">Now</span>':'';var when=ev[i]&&i<=st?'<span class="small muted"> · '+esc(fmtDate(ev[i]))+'</span>':'';return '<li class="'+(i<st?'done':i===st?'now':'')+'"><b>'+esc(s[0])+' '+tag+'</b><span>'+esc(s[1])+when+'</span></li>'}).join("")+'</ol>'}
function showTrack(){var ref=$("trRef").value.trim().toUpperCase(),last4=($("trLast4").value||"").replace(/\D/g,"").slice(-4),out=$("trOut");if(!ref){out.innerHTML='<p class="muted">'+t("k.enter","Enter a reference number.")+'</p>';return}
  var r=null;recents().forEach(function(x){if(x.ref===ref)r=x});
  if(!last4&&r&&r.last4){last4=r.last4;$("trLast4").value=last4}
  if(r)renderTrack(r);
  if(!API_ON){if(!r)out.innerHTML='<div class="empty"><b>'+esc(ref)+'</b> '+t("k.notHere","is not on this device, and the Forum\'s server cannot be reached from here.")+'</div>';return}
  if(last4.length!==4){if(!r)out.innerHTML='<div class="empty">'+t("k.needLast4","Enter the last 4 digits of the mobile number used in the report to see its status from any device.")+'</div>';return}
  if(!r)out.innerHTML='<p class="muted">'+t("k.checking","Checking…")+'</p>';
  api("/status?ref="+encodeURIComponent(ref)+"&last4="+last4).then(function(j){var s=j.report,c=catById(s.issue_type);
    if(r){var list=recents();list.forEach(function(x){if(x.ref===ref){x.stage=s.stage;if(s.official_ticket)x.ticket=s.official_ticket;x.last4=last4}});store("gvf_reports",list);renderRecent()}
    renderTrack({ref:s.ref,cat:c?c.label:s.issue_type,where:s.area,ward:s.ward,date:fmtDate(s.created_at),ticket:s.official_ticket||"",desk:s.desk,stage:s.stage,events:s.events,live:true})},function(err){
    var m=err.status===404?'<div class="empty">'+t("k.nomatch","No report matches this reference and mobile number. Check both and try again.")+'</div>':'<div class="empty">'+t("k.offline","The Forum\'s server could not be reached. Try again in a minute.")+'</div>';
    if(r){renderTrack(r);out.insertAdjacentHTML("beforeend",m)}else out.innerHTML=m})}
$("trGo").addEventListener("click",showTrack); $("trRef").addEventListener("keydown",function(e){if(e.key==="Enter")showTrack()}); $("trLast4").addEventListener("keydown",function(e){if(e.key==="Enter")showTrack()});

/* directory */
var dFilter="all";
function renderDir(){var lv={city:"Gurugram",state:"Haryana",central:"India"};
  $("dChips").innerHTML=D.FILTERS.map(function(f){return '<button class="chip" type="button" data-f="'+f[0]+'" aria-pressed="'+(f[0]===dFilter)+'">'+f[1]+'</button>'}).join("");
  var items=D.PORTALS.filter(function(p){return dFilter==="all"||p.t.indexOf(dFilter)>-1});
  $("dRows").innerHTML=items.map(function(p){return '<li class="row">'+ic("link")+'<div><b><a href="'+p.h+'" target="_blank" rel="noopener">'+esc(p.n)+'</a><span class="lvl '+p.l+'">'+lv[p.l]+'</span></b><p class="for">'+esc(p.f)+'</p><div class="meta">'+esc(p.how)+'</div></div><div class="acts">'+(p.ph?'<a class="btn btn-line btn-sm" href="tel:'+p.ph+'">'+ic("phone","i-s")+esc(p.ph.replace(/^(\d{4})(\d{3})(\d{4})$/,"$1 $2 $3"))+'</a>':'')+'<a class="btn btn-ink btn-sm" href="'+p.h+'" target="_blank" rel="noopener">Open</a></div></li>'}).join("");
  $("dVerified").textContent="Links and numbers verified "+D.VERIFIED+". Tell us if one changed."}
$("dChips").addEventListener("click",function(e){var b=e.target.closest("[data-f]");if(!b)return;dFilter=b.getAttribute("data-f");renderDir()});
renderDir();

/* rights */
function renderRights(){$("rCards").innerHTML=D.CHARTERS.map(function(c){return '<button class="rcard" type="button" data-right="'+c.id+'"><div class="top">'+ic(c.ic)+'<span class="tag tag-saffron">'+esc(c.dl)+'</span></div><b>'+esc(c.t)+'</b><p>'+esc(c.right)+'</p><span class="go">Steps and source</span></button>'}).join("")}
function openRight(id){var c=null;D.CHARTERS.forEach(function(x){if(x.id===id)c=x});if(!c)return;
  openSheet(c.t,'<div class="stabs" role="tablist"><button class="stab" data-stab="r" aria-selected="true">Your right</button><button class="stab" data-stab="h" aria-selected="false">How to claim</button><button class="stab" data-stab="s" aria-selected="false">Source</button></div><div class="spane on" data-pane="r"><p><span class="tag tag-saffron">'+esc(c.dl)+'</span></p><p style="font-size:1.15rem;color:var(--ink)"><b>'+esc(c.right)+'</b></p><p>'+esc(c.why)+'</p></div><div class="spane" data-pane="h">'+stepsHtml(c.how)+'<p><a class="btn btn-primary" href="#/report">Report it to the Forum</a></p></div><div class="spane" data-pane="s"><ul class="linklist">'+c.src.map(function(s){return '<li>'+ic("link")+'<a href="'+s[1]+'"'+ext(s[1])+'>'+esc(s[0])+'</a></li>'}).join("")+'</ul><p class="small muted" style="margin-top:1rem">Plain-language summary for orientation, not legal advice. Verified '+D.VERIFIED+'.</p></div>')}
$("rCards").addEventListener("click",function(e){var b=e.target.closest("[data-right]");if(!b)return;location.hash="#/rights/"+b.getAttribute("data-right")});
renderRights();

/* who */
function renderWhoFilter(){var s=$("whoFilter");var cur=s.value;s.innerHTML='<option value="">'+(lang==="hi"?"सभी भूमिकाएँ":"All roles")+'</option>'+D.CATS.map(function(c){return c.roles.length?'<option value="'+c.id+'">'+esc(lang==="hi"?c.hl:c.label)+'</option>':''}).join("");if(cur)s.value=cur}
function renderWho(){$("bands").innerHTML=D.TIERS.map(function(t,i){return (i?'<div class="connector" aria-hidden="true"></div>':'')+'<div class="bandrow"><div class="bl">'+esc(t.h)+'<small>'+esc(t.s)+'</small></div><div class="roles">'+t.r.map(function(id){return '<button class="role" type="button" data-role="'+id+'">'+esc(D.ROLES[id].b)+'</button>'}).join("")+'</div></div>'}).join("")}
$("whoFilter").addEventListener("change",function(){var c=catById(this.value);var bands=$("bands");bands.classList.toggle("filtered",!!c);bands.querySelectorAll(".role").forEach(function(b){b.classList.toggle("hot",!!c&&c.roles.indexOf(b.getAttribute("data-role"))>-1)})});
function openRole(id){var r=D.ROLES[id];if(!r)return;openSheet(r.b,(r.who?'<p><span class="tag tag-blue">'+esc(r.who)+'</span></p>':'')+'<p style="font-size:1.1rem">'+esc(r.owns)+'</p><h4>Official pages</h4><ul class="linklist">'+r.links.map(function(l){return '<li>'+ic("link")+'<a href="'+l[1]+'"'+ext(l[1])+'>'+esc(l[0])+'</a></li>'}).join("")+'</ul>')}
$("bands").addEventListener("click",function(e){var b=e.target.closest("[data-role]");if(!b)return;location.hash="#/who/"+b.getAttribute("data-role")});
renderWho();

/* wards */
function renderWards(q){q=(q||"").toLowerCase();var rows=D.WARDS.filter(function(w){return !q||String(w[0])===q||(w[1]+" "+w[2]).toLowerCase().indexOf(q)>-1});
  $("wardBody").innerHTML=rows.length?rows.map(function(w){return '<tr><td class="n">'+w[0]+'</td><td data-l="Councillor">'+esc(w[1])+'</td><td data-l="Party">'+esc(w[2])+'</td><td data-l="Verify"><a href="'+L.mcg+'" target="_blank" rel="noopener" class="ext">MCG</a> · <a href="'+L.voterList+'" target="_blank" rel="noopener" class="ext">Voter list</a></td></tr>'}).join(""):'<tr><td colspan="4" class="muted">No ward matches that.</td></tr>'}
$("wardSearch").addEventListener("input",function(){renderWards(this.value.trim())}); renderWards("");

/* charter */
var cvTab=load("gvf_cvtab","home"),cvChecks=load("gvf_civic",{});
(function(){var s="";for(var i=0;i<36;i++){s+='<circle class="seg" data-i="'+i+'" cx="48" cy="48" r="40" stroke-dasharray="5.6 245.7" transform="rotate('+(i*10-90)+' 48 48)"/>'}$("ring").innerHTML=s+'<text x="48" y="55" text-anchor="middle" id="ringTxt">0%</text>'})();
function renderCivic(){$("cvTabs").innerHTML=D.CIVIC.map(function(s){return '<button class="tab" role="tab" type="button" data-tab="'+s.id+'" aria-selected="'+(s.id===cvTab)+'">'+esc(s.t)+'</button>'}).join("");var s=null;D.CIVIC.forEach(function(x){if(x.id===cvTab)s=x});
  $("cvBody").innerHTML='<div class="owe"><div><h3>'+ic("check")+'What I owe the city</h3><ul class="task">'+s.owe.map(function(o){return '<li'+(o.dont?' class="dont"':'')+'><label><input type="checkbox" data-cv="'+o.id+'"'+(cvChecks[o.id]?' checked':'')+'><span>'+esc(o.t)+'</span></label></li>'}).join("")+'</ul></div><div><h3>'+ic("rights")+'What the city owes me</h3><ul class="ent">'+s.ent.map(function(x){return '<li><span>'+esc(x.t)+'</span><a href="'+x.h+'"'+ext(x.h)+'>'+esc(x.l)+'</a></li>'}).join("")+'</ul></div></div>';renderScore()}
function renderScore(){var total=0,done=0;D.CIVIC.forEach(function(s){s.owe.forEach(function(o){total++;if(cvChecks[o.id])done++})});var pct=total?done/total:0;$("cvScore").textContent=done+" / "+total;$("ringTxt").textContent=Math.round(pct*100)+"%";var lit=Math.round(pct*36);$("ring").querySelectorAll(".seg").forEach(function(c){c.classList.toggle("on",+c.getAttribute("data-i")<lit)});
  $("cvMsg").textContent=pct===0?"Tick what already applies. Nobody sees this but you.":pct<.4?"A start. The ward items are the fastest wins.":pct<.8?"Better than most of the city.":"The resident every ward needs."}
$("cvTabs").addEventListener("click",function(e){var b=e.target.closest("[data-tab]");if(!b)return;cvTab=b.getAttribute("data-tab");store("gvf_cvtab",cvTab);renderCivic()});
$("cvBody").addEventListener("change",function(e){var c=e.target.closest("[data-cv]");if(!c)return;cvChecks[c.getAttribute("data-cv")]=c.checked;store("gvf_civic",cvChecks);renderScore()});
renderCivic();

/* dashboard */
var sample=false,dash=null,dashAt=0;
function renderDash(){if(API_ON&&!sample&&(!dash||Date.now()-dashAt>300000)){api("/dashboard").then(function(j){dash=j;dashAt=Date.now();paintDash()},function(){dash={ok:false};dashAt=Date.now();paintDash()})}paintDash()}
function fmtDate(iso){try{return new Date(iso).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}catch(e){return ""}}
function paintDash(){var S=D.STATS;var local=recents().length;var live=!sample&&dash&&dash.ok&&dash.published;
  var rows=[],tot=[0,0,0,0],all=0,updated="",actuals=null;
  if(live){var s=dash.summary;rows=(dash.by_issue||[]).map(function(r){return [r.label,[+r.received||0,+r.filed||0,+r.escalated||0,+r.resolved||0]]});tot=[+s.received||0,+s.filed||0,+s.escalated||0,+s.resolved||0];all=+s.total||0;updated=fmtDate(dash.updated_at);actuals=[s.mapped_in_3_days_pct,s.acted_in_21_days_pct,null]}
  else if(sample){rows=S.rows;S.rows.forEach(function(r){r[1].forEach(function(v,i){tot[i]+=v;all+=v})})}
  var show=live||sample;
  $("kpis").innerHTML='<div class="kpi"><b>'+(show?all:"—")+'</b><span>reports received</span></div><div class="kpi"><b>'+(show?tot[1]:"—")+'</b><span>filed with the authority</span></div><div class="kpi"><b>'+(show?tot[2]:"—")+'</b><span>past due, escalated</span></div><div class="kpi"><b>'+(show?tot[3]:"—")+'</b><span>resolved and closed</span></div>';
  var h='<div class="dash-card"><h3>Commitments</h3><table class="commit"><thead><tr><th>Promise</th><th>What it means</th><th>Actual</th></tr></thead><tbody>'+S.commit.map(function(c,i){var actual;
    if(live){var pct=actuals[i];if(pct==null)actual=i===2?'<span class="tag tag-green">'+ic("check")+'Updated '+esc(updated)+'</span>':'<span class="tag">No data yet</span>';else actual='<span class="tag '+(pct>=80?'tag-green':pct>=50?'tag-warn':'tag-danger')+'">'+Math.round(pct)+'% on time</span>'}
    else if(sample)actual='<span class="tag tag-green">'+ic("check")+'On target</span>';else actual='<span class="tag">Reporting starts at launch</span>';
    return '<tr><td class="n">'+esc(c[0])+'</td><td>'+esc(c[1])+'</td><td>'+actual+'</td></tr>'}).join("")+'</tbody></table></div>';
  if(!show){var sofar=dash&&dash.ok&&dash.total?' The Forum has received '+dash.total+' so far.':'';
    h+='<div class="dash-card"><h3>Reports by cause and status</h3><div class="emptybox"><svg class="ring" viewBox="0 0 96 96" aria-hidden="true"><circle cx="48" cy="48" r="40" fill="none" stroke="var(--line)" stroke-width="6" stroke-dasharray="5.6 1.4"/></svg><p>We publish from the first 50 reports. Be one of them: <a href="#/report">report an issue</a>.'+sofar+(local?' This device has sent '+local+'.':'')+'</p></div><p class="src">Live figures come from the Forum\'s case system; counts only, never names. <button class="btn btn-line btn-sm" type="button" id="sampleBtn" style="margin-left:.5rem">Preview the layout with sample data</button></p></div>'}
  else{var max=0;rows.forEach(function(r){var s=r[1].reduce(function(a,b){return a+b},0);if(s>max)max=s});
    h+='<div class="dash-card"><h3>Reports by cause and status '+(sample?'<span class="tag tag-saffron">Sample data</span>':'')+'</h3><div class="bars">'+rows.map(function(r){var s=r[1].reduce(function(a,b){return a+b},0);return '<div class="bar"><span>'+esc(r[0])+'</span><div class="trk" style="width:'+(max?s/max*100:0)+'%">'+r[1].map(function(v,i){return v?'<div class="seg" style="width:'+(v/s*100)+'%;background:'+S.statuses[i][1]+'" title="'+esc(S.statuses[i][0])+': '+v+'"></div>':''}).join("")+'</div><span class="tot">'+s+'</span></div>'}).join("")+'</div><div class="legend">'+S.statuses.map(function(s){return '<span><span class="sw" style="background:'+s[1]+'"></span>'+esc(s[0])+'</span>'}).join("")+'</div>'+
      (live?'<p class="src">Source: '+esc(dash.source||"the Forum case system")+' · Updated '+esc(updated)+'. Counts only, never names.</p>':'<p class="src">Sample figures for layout only. Source: the Forum case system, updated monthly. <button class="btn btn-line btn-sm" type="button" id="sampleBtn" style="margin-left:.5rem">Hide sample data</button></p>')+'</div>'}
  $("dashBody").innerHTML=h;var sb=$("sampleBtn");if(sb)sb.addEventListener("click",function(){sample=!sample;renderDash()})}

/* updates */
var uTab="stories";
function ph(t,video){return '<span class="ph"><svg viewBox="0 0 400 225" role="img" aria-label="'+esc(t)+'"><rect width="400" height="225" fill="var(--surface-2)"/><g fill="var(--line)"><rect x="30" y="150" width="34" height="60"/><rect x="74" y="120" width="26" height="90"/><rect x="110" y="135" width="44" height="75"/><rect x="164" y="95" width="30" height="115"/><rect x="204" y="125" width="22" height="85"/><rect x="236" y="110" width="42" height="100"/><rect x="288" y="140" width="48" height="70"/><rect x="346" y="160" width="30" height="50"/></g><rect x="0" y="210" width="400" height="3" fill="var(--saffron)"/>'+(video?'<circle cx="200" cy="100" r="28" fill="var(--ink)"/><polygon points="192,86 192,114 216,100" fill="#fff"/>':'')+'</svg></span>'}
function renderUpdates(){var tabs=[["stories","Stories"],["photos","Photos"],["videos","Videos"],["news","In the news"]];$("uTabs").innerHTML=tabs.map(function(t){return '<button class="tab" role="tab" type="button" data-utab="'+t[0]+'" aria-selected="'+(t[0]===uTab)+'">'+t[1]+'</button>'}).join("");var h="";
  if(uTab==="stories")h='<div class="cards">'+D.BLOG.map(function(p){return '<article class="card"><div class="meta">'+esc(p.tag)+', '+esc(p.d)+'</div><h3><a href="#/updates/'+p.slug+'">'+esc(p.t)+'</a></h3><p>'+esc(p.x)+'</p></article>'}).join("")+'</div>';
  else if(uTab==="photos")h='<div class="cards">'+D.MEDIA.photos.map(function(m){return '<article class="card">'+ph(m.t,false)+'<h3>'+esc(m.t)+'</h3><p>'+esc(m.s)+'</p><div class="meta">Placeholder until the team publishes</div></article>'}).join("")+'</div>';
  else if(uTab==="videos")h='<div class="cards">'+D.MEDIA.videos.map(function(m){return '<article class="card">'+ph(m.t,true)+'<h3>'+esc(m.t)+'</h3><p>'+esc(m.s)+'</p><div class="meta">Loads on tap; no autoplay</div></article>'}).join("")+'</div>';
  else h='<ul class="rows">'+D.MEDIA.news.map(function(n){return '<li class="row">'+ic("news")+'<div><b>'+esc(n.t)+'</b><div class="meta">'+esc(n.d)+'</div></div></li>'}).join("")+'</ul>';
  $("uBody").innerHTML=h}
$("uTabs").addEventListener("click",function(e){var b=e.target.closest("[data-utab]");if(!b)return;uTab=b.getAttribute("data-utab");renderUpdates()});
renderUpdates();
function renderPost(slug){var p=null;D.BLOG.forEach(function(x){if(x.slug===slug)p=x});$("postBody").innerHTML=p?'<p class="small muted">'+esc(p.tag)+', '+esc(p.d)+'</p><h1>'+esc(p.t)+'</h1>'+p.b:'<p>That post does not exist. <a href="#/updates">All updates</a></p>'}

/* join */
var jRole="Volunteer";var JR=[["Volunteer","Sewa drives, events and issue follow-ups in your sector."],["Area chapter lead","Map your sector's issues and run its monthly civic slot."],["Youth fellow","Research and innovation support; one ward is yours."]];
function renderJoin(){$("jRoles").innerHTML=JR.map(function(r){return '<button class="jrole" type="button" data-jr="'+esc(r[0])+'" aria-pressed="'+(r[0]===jRole)+'"><b>'+esc(r[0])+'</b><span>'+esc(r[1])+'</span></button>'}).join("")}
$("jRoles").addEventListener("click",function(e){var b=e.target.closest("[data-jr]");if(!b)return;jRole=b.getAttribute("data-jr");renderJoin()});renderJoin();
$("joinForm").addEventListener("submit",function(e){e.preventDefault();if(!valid(["jName","jPhone","jEmail"])){$("jErr").textContent=t("f.err2","Fill in the highlighted fields to send.");$("jErr").classList.add("show");return}$("jErr").classList.remove("show");
  var form=this,btn=form.querySelector('button[type=submit]'),p={name:$("jName").value.trim(),phone:$("jPhone").value.trim(),email:$("jEmail").value.trim(),role:jRole,area:$("jSector").value.trim(),note:$("jNote").value.trim()};
  var body="Name: "+p.name+"\nMobile: "+p.phone+"\nEmail: "+p.email+"\nRole: "+jRole+"\nArea: "+p.area+"\n\n"+p.note;
  var mail="mailto:contact@gurugramvisionforum.org?subject="+encodeURIComponent("Joining as "+jRole)+"&body="+encodeURIComponent(body);
  var first=esc(p.name.split(" ")[0]),old=btn.textContent;btn.disabled=true;btn.textContent=t("f.sending","Sending…");
  function done(sent){btn.disabled=false;btn.textContent=old;var box=$("jConfirm");box.innerHTML='<p style="margin:0 0 .6rem"><b>Thank you, '+first+'.</b> The Forum writes to you within a week about the '+esc(jRole.toLowerCase())+' role.</p>'+(sent?'':'<div class="err show" style="margin:0 0 .75rem">'+t("jn.offline","We could not reach the Forum's server. Please email your details instead.")+'</div>')+'<a class="btn btn-ink btn-sm" href="'+mail+'">Email a copy to the Forum</a>';box.classList.add("show");form.reset()}
  api("/join",{method:"POST",body:p}).then(function(){done(true)},function(err){if(err.status===400&&err.fields){btn.disabled=false;btn.textContent=old;$("jErr").textContent=t("f.err3","Please check: ")+err.fields.join(", ");$("jErr").classList.add("show");return}done(false)})});

/* about */
$("mix").innerHTML=D.FUNDING.map(function(f){return '<div><span>'+esc(f[0])+'</span><div class="trk"><div class="fill" style="width:'+f[1]+'%"></div></div><span class="num" style="text-align:right">'+f[1]+'%</span></div>'}).join("");

/* boot */
renderTiles(); renderWhoFilter(); renderCatSelect();
if(lang==="hi")applyLang("hi");
route();
})();
