import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL='https://iddzcbknnddkonrcwgpt.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_qYWrm4tJE1n80lJx7PFoEw_WCkcV1ZL';
const ALLOWED_EMAILS=new Set(['skrothapalli@gmail.com','jaime.patel@gmail.com']);
const db=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
const $=id=>document.getElementById(id);
const loginView=$('loginView'),appView=$('appView'),authMessage=$('authMessage'),rows=$('rows'),cards=$('cards'),status=$('status');
let people=[];
let activeFilter='all';
const esc=value=>String(value??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const norm=value=>String(value??'').trim().toLowerCase();
const normName=(first,last)=>`${norm(first)} ${norm(last)}`.replace(/[^a-z0-9 ]/g,'').replace(/\s+/g,' ').trim();
const responseLabel=value=>value==='can_attend_october_14'?'Can attend October 14':value==='future_interest'?'Interested in a future dinner':'No form response';
const responseClass=value=>value==='can_attend_october_14'?'attend':value==='future_interest'?'future':'none';
const safeLinkedIn=value=>{try{const u=new URL(value);return u.protocol==='https:'&&/(^|\.)linkedin\.com$/i.test(u.hostname)?u.href:null}catch{return null}};

$('loginForm').addEventListener('submit',async event=>{
  event.preventDefault();
  authMessage.textContent='Opening dashboard…';
  const email=norm($('email').value),password=$('accessCode').value;
  if(!ALLOWED_EMAILS.has(email)){authMessage.textContent='This email is not approved for this dashboard.';return}
  const {data,error}=await db.auth.signInWithPassword({email,password});
  if(error||!ALLOWED_EMAILS.has(norm(data.user?.email))||data.user?.user_metadata?.access_scope!=='ott_bay_area'){
    await db.auth.signOut();authMessage.textContent='The email or access code is incorrect.';return;
  }
  authMessage.textContent='';showApp(email);await loadData();
});
$('signOut').addEventListener('click',async()=>{await db.auth.signOut();showLogin()});
$('search').addEventListener('input',render);
$('exportCsv').addEventListener('click',exportCsv);
document.querySelectorAll('.filter').forEach(button=>button.addEventListener('click',()=>{
  activeFilter=button.dataset.filter;
  document.querySelectorAll('.filter').forEach(item=>item.classList.toggle('active',item===button));
  render();
}));

function showLogin(){loginView.hidden=false;appView.hidden=true;$('accessCode').value=''}
function showApp(email){loginView.hidden=true;appView.hidden=false;$('userEmail').textContent=email}

async function loadData(){
  status.textContent='Loading guests…';
  const [rosterResult,responseResult]=await Promise.all([
    db.from('salute_ott_bay_area_roster').select('first_name,last_name,email,role_title,company,salute_relationship,linkedin_url,display_order').order('display_order',{ascending:true}),
    db.from('salute_on_the_table_interests').select('first_name,last_name,email,job_title,company,linkedin_url,availability,created_at,updated_at').eq('source_event','palo_alto_2026_10_14').order('updated_at',{ascending:false})
  ]);
  if(rosterResult.error||responseResult.error){status.textContent='We could not load the dashboard. Please sign out and try again.';return}
  people=mergePeople(rosterResult.data??[],responseResult.data??[]);
  renderStats(rosterResult.data??[],responseResult.data??[]);
  render();
}

function mergePeople(roster,responses){
  const used=new Set();
  const byEmail=new Map(responses.filter(r=>r.email).map(r=>[norm(r.email),r]));
  const byName=new Map();
  for(const response of responses){const key=normName(response.first_name,response.last_name);if(!byName.has(key))byName.set(key,[]);byName.get(key).push(response)}
  const merged=roster.map((r,index)=>{
    let response=r.email?byEmail.get(norm(r.email)):null;
    if(!response){const matches=byName.get(normName(r.first_name,r.last_name))??[];if(matches.length===1)response=matches[0]}
    if(response)used.add(response);
    return {
      first_name:r.first_name,last_name:r.last_name,email:r.email||response?.email||'',role:r.role_title||response?.job_title||'',company:r.company||response?.company||'',linkedin_url:r.linkedin_url||response?.linkedin_url||'',salute_relationship:r.salute_relationship||'',availability:response?.availability||'',submitted_at:response?.updated_at||'',on_roster:true,from_form:Boolean(response),display_order:r.display_order??index+1,identity_note:response&&r.email&&norm(r.email)!==norm(response.email)?'Matched by name; email differs between sources.':''
    };
  });
  for(const response of responses){
    if(used.has(response))continue;
    merged.push({first_name:response.first_name,last_name:response.last_name,email:response.email||'',role:response.job_title||'',company:response.company||'',linkedin_url:response.linkedin_url||'',salute_relationship:'',availability:response.availability||'',submitted_at:response.updated_at||'',on_roster:false,from_form:true,display_order:1000+merged.length,identity_note:''});
  }
  return merged.sort((a,b)=>a.display_order-b.display_order||`${a.last_name} ${a.first_name}`.localeCompare(`${b.last_name} ${b.first_name}`));
}

function renderStats(roster,responses){
  const attend=responses.filter(item=>item.availability==='can_attend_october_14').length;
  const future=responses.filter(item=>item.availability==='future_interest').length;
  $('stats').innerHTML=`<div class="stat"><strong>${roster.length}</strong><span>Planning roster</span></div><div class="stat"><strong>${responses.length}</strong><span>Form responses</span></div><div class="stat"><strong>${attend}</strong><span>Can attend</span></div><div class="stat"><strong>${future}</strong><span>Future interest</span></div>`;
}

function filtered(){
  const q=norm($('search').value);
  return people.filter(person=>{
    const matchesFilter=activeFilter==='all'||(activeFilter==='can_attend'&&person.availability==='can_attend_october_14')||(activeFilter==='future'&&person.availability==='future_interest')||(activeFilter==='no_response'&&!person.from_form);
    const matchesSearch=!q||[person.first_name,person.last_name,person.email,person.role,person.company].some(value=>norm(value).includes(q));
    return matchesFilter&&matchesSearch;
  });
}
function sourceLabel(person){return person.on_roster&&person.from_form?'Roster + form':person.on_roster?'Planning roster':'Interest form'}
function render(){
  const list=filtered();status.textContent=`${list.length} ${list.length===1?'guest':'guests'}`;
  if(!list.length){rows.innerHTML='<tr><td colspan="5" class="empty">No matching guests.</td></tr>';cards.innerHTML='<div class="empty">No matching guests.</div>';return}
  rows.innerHTML=list.map(person=>{
    const linkedIn=safeLinkedIn(person.linkedin_url);
    const email=person.email?`<a href="mailto:${encodeURIComponent(person.email)}">${esc(person.email)}</a>`:'<span class="missing">Email not provided</span>';
    return `<tr><td class="guest"><strong>${esc(person.first_name)} ${esc(person.last_name)}</strong>${email}${linkedIn?`<br><a href="${esc(linkedIn)}" target="_blank" rel="noopener">LinkedIn</a>`:''}${person.identity_note?`<span class="identity-note">${esc(person.identity_note)}</span>`:''}</td><td class="role"><strong>${esc(person.role||'—')}</strong><span>${esc(person.company||'—')}</span>${person.salute_relationship?`<small>SALUTE: ${esc(person.salute_relationship)}</small>`:''}</td><td><span class="badge ${responseClass(person.availability)}">${esc(responseLabel(person.availability))}</span></td><td><span class="badge pending">Not yet recorded</span></td><td>${esc(sourceLabel(person))}</td></tr>`;
  }).join('');
  cards.innerHTML=list.map(person=>{
    const linkedIn=safeLinkedIn(person.linkedin_url);
    return `<article class="card"><h3>${esc(person.first_name)} ${esc(person.last_name)}</h3><p class="meta">${esc(person.role||'Role not provided')}${person.company?` · ${esc(person.company)}`:''}</p><div class="badges"><span class="badge ${responseClass(person.availability)}">${esc(responseLabel(person.availability))}</span><span class="badge pending">Seat not recorded</span></div><dl><dt>Email</dt><dd>${person.email?`<a href="mailto:${encodeURIComponent(person.email)}">${esc(person.email)}</a>`:'Not provided'}</dd>${linkedIn?`<dt>LinkedIn</dt><dd><a href="${esc(linkedIn)}" target="_blank" rel="noopener">View profile</a></dd>`:''}<dt>Source</dt><dd>${esc(sourceLabel(person))}</dd>${person.salute_relationship?`<dt>SALUTE</dt><dd>${esc(person.salute_relationship)}</dd>`:''}</dl></article>`;
  }).join('');
}

function exportCsv(){
  const header=['First name','Last name','Email','Role','Company','SALUTE relationship','Form response','Seat status','Source','LinkedIn','Submitted'];
  const values=filtered().map(person=>[person.first_name,person.last_name,person.email,person.role,person.company,person.salute_relationship,responseLabel(person.availability),'Not yet recorded',sourceLabel(person),person.linkedin_url,person.submitted_at]);
  const csv=[header,...values].map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='on-the-table-bay-area-dashboard.csv';a.click();URL.revokeObjectURL(url);
}

async function start(){
  const {data:{session}}=await db.auth.getSession();
  if(!session){showLogin();return}
  const email=norm(session.user.email);
  if(!ALLOWED_EMAILS.has(email)||session.user.user_metadata?.access_scope!=='ott_bay_area'){await db.auth.signOut();showLogin();return}
  showApp(email);await loadData();
}

db.auth.onAuthStateChange((_event,session)=>{if(!session)showLogin()});
start();
