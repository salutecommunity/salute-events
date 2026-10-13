import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL='https://iddzcbknnddkonrcwgpt.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_qYWrm4tJE1n80lJx7PFoEw_WCkcV1ZL';
const ALLOWED_EMAILS=new Set(['skrothapalli@gmail.com','jaime.patel@gmail.com','hello@salute.community']);
const HOSTS=[
  {name:'Sheela Krothapalli',email:'skrothapalli@gmail.com'},
  {name:'Jaime Patel',email:'jaime.patel@gmail.com'}
];
const db=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
const $=id=>document.getElementById(id);
const loginView=$('loginView'),appView=$('appView'),authMessage=$('authMessage'),rows=$('rows'),cards=$('cards'),status=$('status');
let guests=[];
let adminSelectionRows=[];
let activeFilter='all';
let currentUserId='';
let currentEmail='';
const esc=value=>String(value??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const norm=value=>String(value??'').trim().toLowerCase();
const safeLinkedIn=value=>{try{const u=new URL(value);return u.protocol==='https:'&&/(^|\.)linkedin\.com$/i.test(u.hostname)?u.href:null}catch{return null}};

$('loginForm').addEventListener('submit',async event=>{
  event.preventDefault();
  authMessage.textContent='Opening seating preferences…';
  const email=norm($('email').value),password=$('accessCode').value;
  if(!ALLOWED_EMAILS.has(email)){authMessage.textContent='This email is not approved for this page.';return}
  const {data,error}=await db.auth.signInWithPassword({email,password});
  const user=data?.user;
  if(error||!user||!ALLOWED_EMAILS.has(norm(user.email))||user.user_metadata?.access_scope!=='ott_bay_area'){
    await db.auth.signOut();authMessage.textContent='The email or access code is incorrect.';return;
  }
  authMessage.textContent='';showApp(user);await loadGuests();
});
$('signOut').addEventListener('click',async()=>{await db.auth.signOut();showLogin()});
$('search').addEventListener('input',render);
rows.addEventListener('change',handleSelection);
cards.addEventListener('change',handleSelection);
document.querySelectorAll('.filter').forEach(button=>button.addEventListener('click',()=>{
  activeFilter=button.dataset.filter;
  document.querySelectorAll('.filter').forEach(item=>item.classList.toggle('active',item===button));
  render();
}));

function isAdmin(){return currentEmail==='hello@salute.community'}
function showLogin(){currentUserId='';currentEmail='';adminSelectionRows=[];loginView.hidden=false;appView.hidden=true;$('accessCode').value=''}
function showApp(user){currentUserId=user.id;currentEmail=norm(user.email);loginView.hidden=true;appView.hidden=false;$('userEmail').textContent=user.email;$('adminSelections').hidden=!isAdmin();document.querySelector('.privacy-note').innerHTML=isAdmin()?'Read-only SALUTE view of Sheela and Jaime’s selections.':'Use <strong>Sit near</strong> for table placement and <strong>Would like to meet</strong> for an introduction during the evening. Choices save automatically.'}

async function loadGuests(){
  status.textContent='Loading guests…';
  const {data,error}=await db.rpc('get_ott_bay_area_host_guests');
  if(error){status.textContent='We could not load the seating dashboard. Please sign out and try again.';return}
  guests=(data??[]).map(item=>({...item,sit_near:Boolean(item.sit_near),of_interest:Boolean(item.of_interest)}));
  render();
  if(isAdmin())await loadAdminSelections();
}

async function loadAdminSelections(){
  const {data,error}=await db.rpc('get_ott_bay_area_admin_selection_summary');
  if(error){$('adminSelectionCards').innerHTML='<p class="empty">Host selections could not be loaded.</p>';return}
  adminSelectionRows=data??[];
  renderAdminSelections();
  renderStats();
}

function renderAdminSelections(){
  $('adminSelectionCards').innerHTML=HOSTS.map(host=>{
    const selections=adminSelectionRows.filter(row=>norm(row.reviewer_email)===host.email);
    const sitCount=selections.filter(row=>row.sit_near).length;
    const interestCount=selections.filter(row=>row.of_interest).length;
    const list=selections.length?`<ul>${selections.map(row=>`<li><strong>${esc(row.guest_name)}</strong><span>${row.sit_near?'<em>Sit near</em>':''}${row.of_interest?'<em>Would like to meet</em>':''}</span></li>`).join('')}</ul>`:'<p class="no-selections">No selections saved yet.</p>';
    return `<article class="admin-selection-card"><div class="admin-host"><div><h3>${esc(host.name)}</h3><p>${esc(host.email)}</p></div><div class="admin-counts"><span>${sitCount} sit near</span><span>${interestCount} to meet</span></div></div>${list}</article>`;
  }).join('');
}

function filtered(){
  const q=norm($('search').value);
  return guests.filter(guest=>{
    const matchesFilter=activeFilter==='all'||Boolean(guest[activeFilter]);
    const matchesSearch=!q||[guest.full_name,guest.role_title,guest.company].some(value=>norm(value).includes(q));
    return matchesFilter&&matchesSearch;
  });
}

function renderStats(){
  const sitNear=isAdmin()?adminSelectionRows.filter(row=>row.sit_near).length:guests.filter(g=>g.sit_near).length;
  const interest=isAdmin()?adminSelectionRows.filter(row=>row.of_interest).length:guests.filter(g=>g.of_interest).length;
  $('stats').innerHTML=`<div class="stat"><strong>${guests.length}</strong><span>Attending guests</span></div><div class="stat"><strong>${sitNear}</strong><span>${isAdmin()?'Host sit-near selections':'Selected to sit near'}</span></div><div class="stat"><strong>${interest}</strong><span>${isAdmin()?'Host meet selections':'Would like to meet'}</span></div>`;
}

function checkbox(guest,field,label){
  if(isAdmin())return '<span class="readonly-mark">Read only</span>';
  return `<label class="choice"><input type="checkbox" data-id="${esc(guest.guest_roster_id)}" data-field="${field}"${guest[field]?' checked':''}><span aria-hidden="true"></span><em>${label}</em></label>`;
}

function render(){
  renderStats();
  const list=filtered();status.textContent=`${list.length} ${list.length===1?'guest':'guests'}`;
  if(!list.length){rows.innerHTML='<tr><td colspan="4" class="empty">No matching guests.</td></tr>';cards.innerHTML='<div class="empty">No matching guests.</div>';return}
  rows.innerHTML=list.map(guest=>{
    const linkedIn=safeLinkedIn(guest.linkedin_url);
    return `<tr><td class="guest"><strong>${esc(guest.full_name)}</strong>${linkedIn?`<a href="${esc(linkedIn)}" target="_blank" rel="noopener">LinkedIn</a>`:''}</td><td class="role"><strong>${esc(guest.role_title||'Not provided')}</strong><span>${esc(guest.company||'Not provided')}</span></td><td class="choice-cell">${checkbox(guest,'sit_near','Sit near')}</td><td class="choice-cell">${checkbox(guest,'of_interest','Would like to meet')}</td></tr>`;
  }).join('');
  cards.innerHTML=list.map(guest=>{
    const linkedIn=safeLinkedIn(guest.linkedin_url);
    return `<article class="card"><h3>${esc(guest.full_name)}</h3><p class="meta">${esc(guest.role_title||'Title not provided')}${guest.company?` · ${esc(guest.company)}`:''}</p>${linkedIn?`<a class="linkedin" href="${esc(linkedIn)}" target="_blank" rel="noopener">View LinkedIn</a>`:''}<div class="card-choices">${checkbox(guest,'sit_near','Sit near')}${checkbox(guest,'of_interest','Would like to meet')}</div></article>`;
  }).join('');
}

async function handleSelection(event){
  const input=event.target.closest('input[type="checkbox"][data-id]');
  if(!input||isAdmin())return;
  const guest=guests.find(item=>item.guest_roster_id===input.dataset.id);
  if(!guest)return;
  const field=input.dataset.field,previous=guest[field];
  guest[field]=input.checked;render();status.textContent=`Saving ${guest.full_name}…`;
  const payload={reviewer_user_id:currentUserId,guest_roster_id:guest.guest_roster_id,sit_near:guest.sit_near,of_interest:guest.of_interest,updated_at:new Date().toISOString()};
  const {error}=await db.from('salute_ott_bay_area_host_selections').upsert(payload,{onConflict:'reviewer_user_id,guest_roster_id'});
  if(error){guest[field]=previous;render();status.textContent='That selection could not be saved. Please try again.';return}
  status.textContent='Saved';
}

async function start(){
  const {data:{session}}=await db.auth.getSession();
  if(!session){showLogin();return}
  const user=session.user,email=norm(user.email);
  if(!ALLOWED_EMAILS.has(email)||user.user_metadata?.access_scope!=='ott_bay_area'){await db.auth.signOut();showLogin();return}
  showApp(user);await loadGuests();
}

db.auth.onAuthStateChange((_event,session)=>{if(!session)showLogin()});
start();

