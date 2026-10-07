/* Volunteer desk: sign in, list and filter reports, update stage, desk and
   official ticket numbers, manage volunteer accounts. Talks only to /api/triage/*. */
(function(){
"use strict";
var D=window.GVF; function $(id){return document.getElementById(id)}
var API=(window.GVF_CONFIG&&window.GVF_CONFIG.api)||"/api";
var STAGES=["Received","Mapped","Filed officially","Escalated","Resolved"];
var STAGE_TAG=["tag","tag-blue","tag-blue","tag-saffron","tag-green"];
var CHANNELS=["GMDA portal","Swachhata app","DHBVN 1912","Police or 112","HRERA","DTCP","HSPCB or Sameer","CM Window","CPGRAMS","Consumer helpline 1915","RTI","Other"];
var reduce=window.matchMedia&&window.matchMedia("(prefers-reduced-motion: reduce)").matches;
/* follow the theme chosen on the public site, if any */
try{var th=JSON.parse(localStorage.getItem("gvf_theme")||"null");if(th==="dark"||th==="light")document.documentElement.setAttribute("data-theme",th)}catch(e){}

function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
function ic(n,cls){return '<svg class="i'+(cls?' '+cls:'')+'" aria-hidden="true"><use href="#i-'+n+'"/></svg>'}
function store(k,v){try{if(v==null)localStorage.removeItem(k);else localStorage.setItem(k,JSON.stringify(v))}catch(e){}}
function load(k,d){try{var v=localStorage.getItem(k);return v?JSON.parse(v):d}catch(e){return d}}
function toast(m){var t=$("toast");t.textContent=m;t.classList.add("show");clearTimeout(t._h);t._h=setTimeout(function(){t.classList.remove("show")},2600)}
function fmt(iso){if(!iso)return "";try{return new Date(iso).toLocaleDateString("en-IN",{day:"numeric",month:"short",year:"numeric"})}catch(e){return ""}}
function fmtT(iso){if(!iso)return "";try{return new Date(iso).toLocaleString("en-IN",{day:"numeric",month:"short",hour:"numeric",minute:"2-digit"})}catch(e){return ""}}
function ago(iso){var d=Math.floor((Date.now()-new Date(iso).getTime())/864e5);return d<=0?"today":d===1?"1 day ago":d+" days ago"}
function catById(id){for(var i=0;i<D.CATS.length;i++)if(D.CATS[i].id===id)return D.CATS[i];return null}
function stageTag(n){return '<span class="tag '+STAGE_TAG[n]+'">'+esc(STAGES[n]||"?")+'</span>'}
function flags(r){var h="";if(r.unmapped_overdue)h+='<span class="tag tag-danger">'+ic("alert")+'Unmapped 3+ working days</span>';if(r.filed_overdue)h+='<span class="tag tag-danger">'+ic("alert")+'Filed 21+ days</span>';return h?'<span class="flags">'+h+'</span>':''}

/* session */
var S=load("gvf_staff",null);
function setSession(s){S=s;store("gvf_staff",s)}
function api(path,opts,retry){opts=opts||{};var h={};if(opts.body)h["Content-Type"]="application/json";if(S&&S.session)h.Authorization="Bearer "+S.session.access_token;
  return fetch(API+path,{method:opts.method||"GET",headers:h,body:opts.body?JSON.stringify(opts.body):undefined}).then(function(r){return r.json().then(function(j){return j},function(){return {}}).then(function(j){
    if(r.status===401&&S&&S.session&&S.session.refresh_token&&retry!==false){return refresh().then(function(){return api(path,opts,false)})}
    if(!r.ok){var e=new Error(j.error||("http_"+r.status));e.status=r.status;e.fields=j.fields;throw e}return j})})}
function refresh(){return fetch(API+"/triage/refresh",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({refresh_token:S.session.refresh_token})}).then(function(r){return r.json().then(function(j){if(!r.ok||!j.session){signOut(true);throw new Error("expired")}setSession({session:j.session,staff:j.staff})})},function(){signOut(true);throw new Error("offline")})}
function signOut(silent){setSession(null);show("login");if(!silent)toast("Signed out")}
function show(v){$("v-login").classList.toggle("on",v==="login");$("v-desk").classList.toggle("on",v==="desk");$("userBar").hidden=v!=="desk";
  if(v==="desk"&&S){$("whoAmI").textContent=(S.staff.name||S.staff.email)+" · "+S.staff.role;$("teamTab").hidden=!(S.staff.role==="owner"||S.staff.role==="coordinator")}
  if(v==="login"){$("lErr").classList.remove("show");setTimeout(function(){$("lEmail").focus()},50)}}

$("loginForm").addEventListener("submit",function(e){e.preventDefault();var btn=$("lBtn"),email=$("lEmail").value.trim(),pass=$("lPass").value;$("lErr").classList.remove("show");
  if(!email||!pass){$("lErr").textContent="Enter your email and password.";$("lErr").classList.add("show");return}
  btn.disabled=true;btn.textContent="Signing in…";
  api("/triage/login",{method:"POST",body:{email:email,password:pass}},false).then(function(j){setSession({session:j.session,staff:j.staff});$("lPass").value="";show("desk");boot()},function(err){
    $("lErr").textContent=err.status===403?"This account is not on the volunteer list. Ask the coordinator.":err.status===401?"Wrong email or password.":"Could not reach the server. Try again.";$("lErr").classList.add("show")}).then(function(){btn.disabled=false;btn.textContent="Sign in"})});
$("signOut").addEventListener("click",function(){signOut(false)});

/* tabs */
$("tTabs").addEventListener("click",function(e){var b=e.target.closest("[data-tab]");if(!b)return;var t=b.getAttribute("data-tab");$("tTabs").querySelectorAll(".tab").forEach(function(x){x.setAttribute("aria-selected",x===b)});$("tReports").hidden=t!=="reports";$("tTeam").hidden=t!=="team";if(t==="team")loadStaff()});

/* filters */
var F={stage:"open",issue:"",ward:"",flag:"",q:""},offset=0,LIMIT=50,total=0,rowsCache={};
var STAGE_CHIPS=[["open","All open"],["0","Received"],["1","Mapped"],["2","Filed"],["3","Escalated"],["4","Resolved"],["all","Everything"]];
function renderChips(){$("stageChips").innerHTML=STAGE_CHIPS.map(function(c){return '<button class="chip" type="button" data-stage="'+c[0]+'" aria-pressed="'+(F.stage===c[0])+'">'+c[1]+'</button>'}).join("")}
$("stageChips").addEventListener("click",function(e){var b=e.target.closest("[data-stage]");if(!b)return;F.stage=b.getAttribute("data-stage");renderChips();loadReports(true)});
$("fIssue").innerHTML+=D.CATS.map(function(c){return '<option value="'+c.id+'">'+esc(c.label)+'</option>'}).join("");
$("fWard").innerHTML+=D.WARDS.map(function(w){return '<option value="'+w[0]+'">Ward '+w[0]+', '+esc(w[1])+'</option>'}).join("");
["fIssue","fWard","fFlag"].forEach(function(id){$(id).addEventListener("change",function(){F.issue=$("fIssue").value;F.ward=$("fWard").value;F.flag=$("fFlag").value;loadReports(true)})});
var qT;$("fQ").addEventListener("input",function(){clearTimeout(qT);qT=setTimeout(function(){F.q=$("fQ").value.trim();loadReports(true)},350)});
$("tRefresh").addEventListener("click",function(){loadReports(true)});
$("tMore").addEventListener("click",function(){loadReports(false)});

function qs(){var p=["stage="+encodeURIComponent(F.stage),"offset="+offset,"limit="+LIMIT];if(F.issue)p.push("issue="+encodeURIComponent(F.issue));if(F.ward)p.push("ward="+F.ward);if(F.flag)p.push("flag="+F.flag);if(F.q)p.push("q="+encodeURIComponent(F.q));return p.join("&")}
function loadReports(reset){if(reset){offset=0;$("tList").innerHTML="";rowsCache={}}
  $("tSummary").textContent="Loading…";
  return api("/triage/reports?"+qs()).then(function(j){total=j.total||0;(j.reports||[]).forEach(function(r){rowsCache[r.ref]=r});
    $("tList").insertAdjacentHTML("beforeend",(j.reports||[]).map(rowHtml).join(""));offset+=(j.reports||[]).length;
    var got=(j.reports||[]).length;$("tEmpty").hidden=offset>0;$("tMore").hidden=typeof total==="number"?offset>=total:got<LIMIT;
    var s=j.summary;$("tSummary").textContent=s?(s.total+" reports in all · "+s.received+" received · "+s.filed+" filed · "+s.escalated+" escalated · "+s.resolved+" resolved"+((+s.unmapped_past_due||+s.filed_past_due)?" · past due: "+(+s.unmapped_past_due)+" unmapped, "+(+s.filed_past_due)+" filed":"")):(total+" reports");
  },function(err){$("tSummary").textContent=err.status===401||err.status===403?"Signed out.":"Could not load reports. "+(err.message||"");if(err.status===403)signOut(true)})}
function rowHtml(r){var c=catById(r.issue_type);return '<li class="row" id="row_'+esc(r.ref)+'">'+ic(c?c.ic:"alert")+'<div><b><a href="#" data-open="'+esc(r.ref)+'">'+esc(r.ref)+'</a> '+stageTag(r.stage)+flags(r)+'</b><p class="for">'+esc(r.issue_label||r.issue_type)+' · '+esc(r.area)+(r.ward?', ward '+r.ward:'')+(r.spot?' · '+esc(r.spot):'')+'</p><div class="meta">Sent '+esc(fmt(r.created_at))+' ('+esc(ago(r.created_at))+')'+(r.desk?' · '+esc(r.desk):'')+(r.official_ticket?' · ticket '+esc(r.official_ticket):'')+' · '+(r.events_count||0)+' update'+(r.events_count==1?'':'s')+' · via '+esc(r.source)+'</div></div></li>'}
$("tList").addEventListener("click",function(e){var a=e.target.closest("[data-open]");if(!a)return;e.preventDefault();openReport(a.getAttribute("data-open"))});

/* sheet */
var lastFocus=null;
function openSheet(title,html){lastFocus=document.activeElement;$("sheetTitle").textContent=title;$("sheetBody").innerHTML=html;$("veil").classList.add("open");$("sheet").classList.add("open");document.body.style.overflow="hidden";setTimeout(function(){$("sheetClose").focus()},30)}
function closeSheet(){$("veil").classList.remove("open");$("sheet").classList.remove("open");document.body.style.overflow="";if(lastFocus&&lastFocus.focus)lastFocus.focus()}
$("sheetClose").addEventListener("click",closeSheet);$("veil").addEventListener("click",closeSheet);
document.addEventListener("keydown",function(e){if(e.key==="Escape"&&$("sheet").classList.contains("open"))closeSheet()});

var current=null;
function openReport(ref){openSheet(ref,'<p class="muted">Loading…</p>');api("/triage/reports/"+encodeURIComponent(ref)).then(function(j){current=j;renderDetail(j)},function(err){$("sheetBody").innerHTML='<div class="empty">'+(err.status===404?'No report with this reference.':'Could not load this report.')+'</div>'})}
function authorityText(r){var c=catById(r.issue_type);return "Gurugram Vision Forum report "+r.ref+"\nIssue: "+(r.issue_label||r.issue_type)+"\nArea: "+r.area+(r.ward?"\nWard: "+r.ward:"")+(r.spot?"\nSpot: "+r.spot:"")+(r.lat!=null?"\nCoordinates: "+r.lat+", "+r.lng:"")+"\nReported: "+fmt(r.created_at)+"\n\n"+r.description+"\n\nResponsible desk: "+(r.desk||(c?c.agency:""))+"\nContact: Gurugram Vision Forum, contact@gurugramvisionforum.org (the reporter's details are held by the Forum)"}
function renderDetail(j){var r=j.report,ev=j.events||[],c=catById(r.issue_type);
  var h='<p>'+stageTag(r.stage)+' '+flags(r)+'</p>';
  h+='<dl class="sl"><div><dt>Issue</dt><dd>'+esc(r.issue_label||r.issue_type)+'</dd></div><div><dt>Affects</dt><dd>'+esc(r.affects||"—")+'</dd></div><div><dt>Area</dt><dd>'+esc(r.area)+'</dd></div><div><dt>Ward</dt><dd>'+(r.ward?'Ward '+r.ward+(r.councillor?', councillor '+esc(r.councillor):''):'Not given')+'</dd></div><div><dt>Spot</dt><dd>'+esc(r.spot||"—")+(r.lat!=null?' · <a href="https://www.google.com/maps?q='+encodeURIComponent(r.lat+','+r.lng)+'" target="_blank" rel="noopener" class="ext">map</a>':'')+'</dd></div><div><dt>Sent</dt><dd>'+esc(fmtT(r.created_at))+' via '+esc(r.source)+'</dd></div></dl>';
  h+='<p class="desc">'+esc(r.description)+'</p>';
  h+='<div class="rbox"><b>Reporter</b><br>'+esc(r.reporter_name)+' · <a href="tel:'+esc(r.reporter_phone)+'">'+esc(r.reporter_phone)+'</a>'+(r.reporter_email?' · <a href="mailto:'+esc(r.reporter_email)+'">'+esc(r.reporter_email)+'</a>':'')+'<p class="note">Consent given '+esc(fmt(r.consent_at))+'. Share the issue and the place with the authority, never the phone number.</p></div>';
  h+='<p><button class="btn btn-line btn-sm" type="button" id="copyAuth">Copy for the authority (no reporter details)</button></p>';
  h+='<h4>Updates</h4><ol class="tl">'+ev.map(function(e,i){return '<li class="'+(i<ev.length-1?'done':'now')+'"><b>'+esc(STAGES[e.stage]||"")+' <span class="small muted">· '+esc(e.actor||"system")+'</span></b><span>'+esc(e.note||"")+' · '+esc(fmtT(e.created_at))+'</span></li>'}).join("")+'</ol>';
  h+='<form class="form" id="editForm" novalidate style="margin-top:1.25rem"><h4 style="margin-top:0">Update</h4><div class="err" id="eErr" role="alert"></div>'+
     '<div class="frow"><div class="field"><label for="eIssue">Issue type</label><select id="eIssue">'+D.CATS.map(function(x){return '<option value="'+x.id+'"'+(x.id===r.issue_type?' selected':'')+'>'+esc(x.label)+'</option>'}).join("")+'</select></div>'+
     '<div class="field"><label for="eWard">Ward</label><select id="eWard"><option value="">Not known</option>'+D.WARDS.map(function(w){return '<option value="'+w[0]+'"'+(w[0]===r.ward?' selected':'')+'>Ward '+w[0]+', '+esc(w[1])+'</option>'}).join("")+'</select></div></div>'+
     '<div class="frow"><div class="field"><label for="eDesk">Responsible desk</label><input type="text" id="eDesk" list="deskList" value="'+esc(r.desk||"")+'" placeholder="'+esc(c?c.agency:"")+'"><datalist id="deskList">'+D.CATS.map(function(x){return '<option value="'+esc(x.agency)+'">'}).join("")+'</datalist></div>'+
     '<div class="field"><label for="eStage">Stage</label><select id="eStage">'+STAGES.map(function(s,i){return '<option value="'+i+'"'+(i===r.stage?' selected':'')+'>'+i+'. '+s+'</option>'}).join("")+'</select></div></div>'+
     '<div class="frow"><div class="field"><label for="eChan">Official channel</label><select id="eChan"><option value="">Not filed yet</option>'+CHANNELS.map(function(x){return '<option'+(x===r.official_channel?' selected':'')+'>'+esc(x)+'</option>'}).join("")+'</select></div>'+
     '<div class="field"><label for="eTicket">Official ticket number</label><input type="text" id="eTicket" value="'+esc(r.official_ticket||"")+'" placeholder="GMDA or MCG ticket"><p class="hint">Saving a ticket number moves the stage to Filed officially.</p></div></div>'+
     '<div class="frow"><div class="field"><label for="eEsc">Escalated to</label><input type="text" id="eEsc" value="'+esc(r.escalated_to||"")+'" placeholder="Zone Joint Commissioner, GMDA CEO, CM Window"></div>'+
     '<div class="field"><label for="eRes">Resolution note</label><input type="text" id="eRes" value="'+esc(r.resolution_note||"")+'" placeholder="Fixed on 12 Oct, reporter confirmed"></div></div>'+
     '<div class="field"><label for="eNote">Add a note to the timeline (optional)</label><textarea id="eNote" style="min-height:80px" placeholder="Called the JE; site visit promised Thursday."></textarea></div>'+
     '<div class="fnav"><span></span><button class="btn btn-primary" type="submit" id="eSave">Save</button></div></form>';
  $("sheetBody").innerHTML=h;
  $("copyAuth").addEventListener("click",function(){var t=authorityText(r);if(navigator.clipboard&&navigator.clipboard.writeText)navigator.clipboard.writeText(t).then(function(){toast("Copied without reporter details")},function(){toast("Could not copy")});else toast("Copy is not supported here")});
  $("editForm").addEventListener("submit",function(e){e.preventDefault();saveReport(r)});
}
function saveReport(r){var p={},note=$("eNote").value.trim();
  var v;v=$("eIssue").value;if(v!==r.issue_type)p.issue_type=v;
  v=$("eWard").value;if((v||"")!==(r.ward==null?"":String(r.ward)))p.ward=v;
  v=$("eDesk").value.trim();if(v!==(r.desk||""))p.desk=v;
  v=+$("eStage").value;if(v!==r.stage)p.stage=v;
  v=$("eChan").value;if(v!==(r.official_channel||""))p.official_channel=v;
  v=$("eTicket").value.trim();if(v!==(r.official_ticket||""))p.official_ticket=v;
  v=$("eEsc").value.trim();if(v!==(r.escalated_to||""))p.escalated_to=v;
  v=$("eRes").value.trim();if(v!==(r.resolution_note||""))p.resolution_note=v;
  if(!Object.keys(p).length&&!note){toast("Nothing changed");return}
  if(note)p.note=note;
  var btn=$("eSave");btn.disabled=true;btn.textContent="Saving…";
  api("/triage/reports/"+encodeURIComponent(r.ref),{method:"PATCH",body:p}).then(function(j){current=j;renderDetail(j);toast("Saved");var row=$("row_"+r.ref);if(row){rowsCache[r.ref]=Object.assign({},rowsCache[r.ref]||{},j.report,{events_count:(j.events||[]).length});row.outerHTML=rowHtml(rowsCache[r.ref])}},function(err){var el=$("eErr");el.textContent=err.fields?"Please check: "+err.fields.join(", "):err.status===401?"Session expired. Sign in again.":"Could not save. "+(err.message||"");el.classList.add("show");btn.disabled=false;btn.textContent="Save"})}

/* team */
function loadStaff(){$("staffList").innerHTML='<li class="row"><div>Loading…</div></li>';api("/triage/staff").then(function(j){var me=S&&S.staff?S.staff.user_id:null;var isOwner=S&&S.staff&&S.staff.role==="owner";
  $("staffList").innerHTML=(j.staff||[]).map(function(s){return '<li class="row">'+ic("who")+'<div><b>'+esc(s.name||s.email)+' <span class="tag tag-blue">'+esc(s.role)+'</span></b><p class="for">'+esc(s.email||"")+'</p>'+(isOwner&&s.user_id!==me?'<div class="acts"><button class="btn btn-line btn-sm" type="button" data-remove="'+esc(s.user_id)+'" data-name="'+esc(s.name||s.email)+'">Remove</button></div>':'')+'</div></li>'}).join("")||'<li class="row"><div>No accounts yet.</div></li>'},function(err){$("staffList").innerHTML='<li class="row"><div>'+(err.status===403?'Only owners and coordinators manage the team.':'Could not load the team.')+'</div></li>'})}
$("staffList").addEventListener("click",function(e){var b=e.target.closest("[data-remove]");if(!b)return;if(!confirm("Remove "+b.getAttribute("data-name")+"'s access? Their account is deleted."))return;api("/triage/staff",{method:"DELETE",body:{user_id:b.getAttribute("data-remove")}}).then(function(){toast("Removed");loadStaff()},function(){toast("Could not remove")})});
$("staffForm").addEventListener("submit",function(e){e.preventDefault();var el=$("sErr");el.classList.remove("show");var b={name:$("sName").value.trim(),email:$("sEmail").value.trim(),password:$("sPass").value,role:$("sRole").value};
  if(!b.name||!b.email||b.password.length<10){el.textContent="Name, email and a password of at least 10 characters are needed.";el.classList.add("show");return}
  api("/triage/staff",{method:"POST",body:b}).then(function(){toast("Account created");$("staffForm").reset();loadStaff()},function(err){el.textContent=err.status===409?"An account with this email already exists.":err.fields?"Please check: "+err.fields.join(", "):err.status===403?"Your role cannot create this kind of account.":"Could not create the account.";el.classList.add("show")})});

/* boot */
function boot(){renderChips();loadReports(true)}
if(S&&S.session){show("desk");boot()}else show("login");
})();
