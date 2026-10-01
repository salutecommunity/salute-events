import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL='https://iddzcbknnddkonrcwgpt.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_qYWrm4tJE1n80lJx7PFoEw_WCkcV1ZL';
const ALLOWED_EMAIL='skrothapalli@gmail.com';
const db=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const $=id=>document.getElementById(id);
const loginView=$('loginView'),appView=$('appView'),authMessage=$('authMessage'),rows=$('rows'),cards=$('cards'),status=$('status');
let registrations=[];
const availabilityLabel=value=>value==='can_attend_october_14'?'Can attend October 14':'Interested in a future dinner';
const fmt=value=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(value));
const esc=value=>String(value??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const safeLinkedIn=value=>{try{const u=new URL(value);return u.protocol==='https:'&&/(^|\.)linkedin\.com$/i.test(u.hostname)?u.href:null}catch{return null}};

$('loginForm').addEventListener('submit',async event=>{
  event.preventDefault();authMessage.textContent='Sending your secure link…';
  const email=$('email').value.trim().toLowerCase();
  if(email!==ALLOWED_EMAIL){authMessage.textContent='This dashboard is not enabled for that email address.';return}
  const {error}=await db.auth.signInWithOtp({email,options:{emailRedirectTo:`${location.origin}/onthetablesf/dashboard/`,shouldCreateUser:true}});
  authMessage.textContent=error?'We could not send the link. Please try again.':'Check your email for a secure sign-in link. The link will return you to this dashboard.';
});

$('signOut').addEventListener('click',async()=>{await db.auth.signOut();showLogin()});
$('search').addEventListener('input',render);
$('exportCsv').addEventListener('click',exportCsv);

function showLogin(){loginView.hidden=false;appView.hidden=true}
function showApp(email){loginView.hidden=true;appView.hidden=false;$('userEmail').textContent=email}

async function loadRegistrations(){
  status.textContent='Loading registrations…';
  const {data,error}=await db.from('salute_on_the_table_interests').select('first_name,last_name,email,job_title,company,linkedin_url,availability,created_at,updated_at').eq('source_event','palo_alto_2026_10_14').order('updated_at',{ascending:false});
  if(error){status.textContent='We could not load the interest list. Please sign out and request a new secure link.';return}
  registrations=data??[];renderStats();render();
}

function renderStats(){
  const attend=registrations.filter(item=>item.availability==='can_attend_october_14').length;
  const future=registrations.filter(item=>item.availability==='future_interest').length;
  $('stats').innerHTML=`<div class="stat"><strong>${registrations.length}</strong><span>Total responses</span></div><div class="stat"><strong>${attend}</strong><span>Can attend</span></div><div class="stat"><strong>${future}</strong><span>Future interest</span></div>`;
}

function filtered(){const q=$('search').value.trim().toLowerCase();return q?registrations.filter(r=>[r.first_name,r.last_name,r.email,r.job_title,r.company].some(v=>String(v??'').toLowerCase().includes(q))):registrations}
function render(){
  const list=filtered();status.textContent=`${list.length} ${list.length===1?'response':'responses'}`;
  if(!list.length){rows.innerHTML='<tr><td colspan="4" class="empty">No matching responses.</td></tr>';cards.innerHTML='<div class="empty">No matching responses.</div>';return}
  rows.innerHTML=list.map(r=>{const li=safeLinkedIn(r.linkedin_url);return `<tr><td class="guest"><strong>${esc(r.first_name)} ${esc(r.last_name)}</strong><a href="mailto:${encodeURIComponent(r.email)}">${esc(r.email)}</a>${li?`<br><a href="${esc(li)}" target="_blank" rel="noopener">LinkedIn</a>`:''}</td><td class="role"><strong>${esc(r.job_title)}</strong><span>${esc(r.company)}</span></td><td><span class="badge ${r.availability==='can_attend_october_14'?'attend':'future'}">${esc(availabilityLabel(r.availability))}</span></td><td>${esc(fmt(r.updated_at))}</td></tr>`}).join('');
  cards.innerHTML=list.map(r=>{const li=safeLinkedIn(r.linkedin_url);return `<article class="card"><h3>${esc(r.first_name)} ${esc(r.last_name)}</h3><p class="meta">${esc(r.job_title)} · ${esc(r.company)}</p><span class="badge ${r.availability==='can_attend_october_14'?'attend':'future'}">${esc(availabilityLabel(r.availability))}</span><dl><dt>Email</dt><dd><a href="mailto:${encodeURIComponent(r.email)}">${esc(r.email)}</a></dd>${li?`<dt>LinkedIn</dt><dd><a href="${esc(li)}" target="_blank" rel="noopener">View profile</a></dd>`:''}<dt>Submitted</dt><dd>${esc(fmt(r.updated_at))}</dd></dl></article>`}).join('');
}

function exportCsv(){
  const header=['First name','Last name','Email','Job title','Company','LinkedIn','Availability','Submitted'];
  const values=filtered().map(r=>[r.first_name,r.last_name,r.email,r.job_title,r.company,r.linkedin_url,availabilityLabel(r.availability),r.updated_at]);
  const csv=[header,...values].map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='on-the-table-bay-area-interest.csv';a.click();URL.revokeObjectURL(url);
}

async function start(){
  const {data:{session}}=await db.auth.getSession();
  if(!session){showLogin();return}
  const email=session.user.email?.toLowerCase();
  if(email!==ALLOWED_EMAIL){await db.auth.signOut();authMessage.textContent='This account does not have access to the Bay Area dashboard.';showLogin();return}
  showApp(email);await loadRegistrations();
}

db.auth.onAuthStateChange((_event,session)=>{if(!session)showLogin()});
start();
