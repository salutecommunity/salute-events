import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL='https://iddzcbknnddkonrcwgpt.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_qYWrm4tJE1n80lJx7PFoEw_WCkcV1ZL';
const ALLOWED_EMAILS=new Set(['kinjil.mathur@gmail.com','melissa@mjosephstudio.com','melissa.joseph@gmail.com','ispadder@gmail.com','hello@salute.community']);
const LOGIN_ALIASES={'melissa.joseph@gmail.com':'melissa@mjosephstudio.com'};
const db=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
const $=id=>document.getElementById(id);
const loginView=$('loginView'),appView=$('appView'),authMessage=$('authMessage'),rows=$('rows'),cards=$('cards'),status=$('status');
const profileDialog=$('profileDialog'),profileChoices=$('profileChoices');
let guests=[];
let activeFilter='all';
let currentUserId='';
const esc=value=>String(value??'').replace(/[&<>\"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;'}[c]));
const norm=value=>String(value??'').trim().toLowerCase();
const purchaseLabel=value=>({actively_looking:'Actively looking',within_one_year:'Within one year',beginning_to_explore:'Beginning to explore',not_at_this_time:'Not at this time'}[value]||'Not provided');

$('loginForm').addEventListener('submit',async event=>{
  event.preventDefault();
  authMessage.textContent='Opening dashboard…';
  const email=norm($('email').value),password=$('accessCode').value;
  if(!ALLOWED_EMAILS.has(email)){authMessage.textContent='This email is not approved for this dashboard.';return}
  const authEmail=LOGIN_ALIASES[email]||email;
  const {data,error}=await db.auth.signInWithPassword({email:authEmail,password});
  const user=data?.user;
  if(error||!user||!ALLOWED_EMAILS.has(norm(user.email))){
    await db.auth.signOut();authMessage.textContent='The email or access code is incorrect.';return;
  }
  authMessage.textContent='';showApp(user);await loadGuests();
});
$('signOut').addEventListener('click',async()=>{await db.auth.signOut();showLogin()});
$('search').addEventListener('input',render);
rows.addEventListener('change',handleSelection);
cards.addEventListener('change',handleSelection);
profileChoices.addEventListener('change',handleSelection);
rows.addEventListener('click',handleProfileClick);
cards.addEventListener('click',handleProfileClick);
$('closeProfile').addEventListener('click',()=>profileDialog.close());
profileDialog.addEventListener('click',event=>{if(event.target===profileDialog)profileDialog.close()});
document.querySelectorAll('.filter').forEach(button=>button.addEventListener('click',()=>{
  activeFilter=button.dataset.filter;
  document.querySelectorAll('.filter').forEach(item=>item.classList.toggle('active',item===button));
  render();
}));

function showLogin(){currentUserId='';loginView.hidden=false;appView.hidden=true;$('accessCode').value=''}
function showApp(user){currentUserId=user.id;loginView.hidden=true;appView.hidden=false;$('userEmail').textContent=user.email}

async function loadGuests(){
  status.textContent='Loading guests…';
  const {data,error}=await db.rpc('get_living_with_art_speaker_guests');
  if(error){status.textContent='We could not load the guest dashboard. Please sign out and try again.';return}
  guests=(data??[]).map(item=>({...item,sit_near:Boolean(item.sit_near),of_interest:Boolean(item.of_interest)}));
  render();
}

function filtered(){
  const q=norm($('search').value);
  return guests.filter(guest=>{
    const matchesFilter=activeFilter==='all'||Boolean(guest[activeFilter]);
    const matchesSearch=!q||[guest.full_name,guest.email,guest.job_title,guest.company,guest.brief,guest.previous_roles,purchaseLabel(guest.purchase_intent)].some(value=>norm(value).includes(q));
    return matchesFilter&&matchesSearch;
  });
}

function renderStats(){
  const sitNear=guests.filter(g=>g.sit_near).length,interest=guests.filter(g=>g.of_interest).length;
  $('stats').innerHTML=`<div class="stat"><strong>${guests.length}</strong><span>Confirmed guests</span></div><div class="stat"><strong>${sitNear}</strong><span>Selected to sit near</span></div><div class="stat"><strong>${interest}</strong><span>Marked of interest</span></div>`;
}

function checkbox(guest,field,label){
  return `<label class="choice"><input type="checkbox" data-id="${esc(guest.guest_response_id)}" data-field="${field}"${guest[field]?' checked':''}><span aria-hidden="true"></span><em>${label}</em></label>`;
}

function profileButton(guest){
  return `<button class="profile-link" type="button" data-profile="${esc(guest.guest_response_id)}">${esc(guest.full_name)}</button>`;
}

function render(){
  renderStats();
  const list=filtered();status.textContent=`${list.length} ${list.length===1?'guest':'guests'}`;
  if(!list.length){rows.innerHTML='<tr><td colspan="5" class="empty">No matching guests.</td></tr>';cards.innerHTML='<div class="empty">No matching guests.</div>';return}
  rows.innerHTML=list.map(guest=>`<tr><td class="guest">${profileButton(guest)}${guest.email?`<a href="mailto:${encodeURIComponent(guest.email)}">${esc(guest.email)}</a>`:'<span class="missing">Email not provided</span>'}</td><td class="role"><strong>${esc(guest.job_title||'Not provided')}</strong><span>${esc(guest.company||'Not provided')}</span></td><td><span class="stage">${esc(purchaseLabel(guest.purchase_intent))}</span></td><td class="choice-cell">${checkbox(guest,'sit_near','Sit near')}</td><td class="choice-cell">${checkbox(guest,'of_interest','Of interest')}</td></tr>`).join('');
  cards.innerHTML=list.map(guest=>`<article class="card"><h3>${profileButton(guest)}</h3><p class="meta">${esc(guest.job_title||'Title not provided')}${guest.company?` · ${esc(guest.company)}`:''}</p><p class="email">${guest.email?`<a href="mailto:${encodeURIComponent(guest.email)}">${esc(guest.email)}</a>`:'Email not provided'}</p><button class="view-profile" type="button" data-profile="${esc(guest.guest_response_id)}">View profile</button><p class="stage-line"><span>Art-purchase stage</span>${esc(purchaseLabel(guest.purchase_intent))}</p><div class="card-choices">${checkbox(guest,'sit_near','Sit near')}${checkbox(guest,'of_interest','Of interest')}</div></article>`).join('');
}

function handleProfileClick(event){
  const button=event.target.closest('[data-profile]');
  if(!button)return;
  const guest=guests.find(item=>item.guest_response_id===button.dataset.profile);
  if(guest)openProfile(guest);
}

function fallbackBrief(guest){
  if(guest.job_title&&guest.company)return `${guest.full_name} is ${guest.job_title} at ${guest.company}.`;
  if(guest.job_title)return `${guest.full_name} is a ${guest.job_title}.`;
  if(guest.company)return `${guest.full_name} is affiliated with ${guest.company}.`;
  return 'A concise profile brief is being added.';
}

function openProfile(guest){
  $('profileName').textContent=guest.full_name;
  $('profileRole').textContent=[guest.job_title,guest.company].filter(Boolean).join(' · ')||'Professional details not provided';
  $('profileBrief').textContent=guest.brief||fallbackBrief(guest);
  const previousWrap=$('profilePreviousWrap');
  if(guest.previous_roles){$('profilePrevious').textContent=guest.previous_roles;previousWrap.hidden=false}else{$('profilePrevious').textContent='';previousWrap.hidden=true}
  $('profileEmail').innerHTML=guest.email?`<a href="mailto:${encodeURIComponent(guest.email)}">${esc(guest.email)}</a>`:'Not provided';
  $('profileStage').textContent=purchaseLabel(guest.purchase_intent);
  profileChoices.innerHTML=`${checkbox(guest,'sit_near','Sit near')}${checkbox(guest,'of_interest','Of interest')}`;
  const source=$('profileSource');
  if(guest.source_url){source.innerHTML=`<a href="${esc(guest.source_url)}" target="_blank" rel="noopener noreferrer">Public profile source ↗</a>`;source.hidden=false}else{source.textContent='';source.hidden=true}
  profileDialog.showModal();
}

async function handleSelection(event){
  const input=event.target.closest('input[type="checkbox"][data-id]');
  if(!input)return;
  const guest=guests.find(item=>item.guest_response_id===input.dataset.id);
  if(!guest)return;
  const field=input.dataset.field,previous=guest[field];
  guest[field]=input.checked;render();status.textContent=`Saving ${guest.full_name}…`;
  const payload={speaker_user_id:currentUserId,event_id:guest.event_id,guest_response_id:guest.guest_response_id,sit_near:guest.sit_near,of_interest:guest.of_interest,updated_at:new Date().toISOString()};
  const {error}=await db.from('salute_living_with_art_speaker_selections').upsert(payload,{onConflict:'speaker_user_id,event_id,guest_response_id'});
  if(error){guest[field]=previous;render();status.textContent='That selection could not be saved. Please try again.';return}
  status.textContent='Saved';
}

async function start(){
  const {data:{session}}=await db.auth.getSession();
  if(!session){showLogin();return}
  const user=session.user,email=norm(user.email);
  if(!ALLOWED_EMAILS.has(email)){await db.auth.signOut();showLogin();return}
  showApp(user);await loadGuests();
}

db.auth.onAuthStateChange((_event,session)=>{if(!session)showLogin()});
start();
