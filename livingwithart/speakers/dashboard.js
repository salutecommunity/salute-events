import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

const SUPABASE_URL='https://iddzcbknnddkonrcwgpt.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_qYWrm4tJE1n80lJx7PFoEw_WCkcV1ZL';
const ALLOWED_EMAILS=new Set(['kinjil.mathur@gmail.com','melissa@mjosephstudio.com','ispadder@gmail.com']);
const db=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:false}});
const $=id=>document.getElementById(id);
const loginView=$('loginView'),appView=$('appView'),authMessage=$('authMessage'),rows=$('rows'),cards=$('cards'),status=$('status');
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
  const {data,error}=await db.auth.signInWithPassword({email,password});
  const user=data?.user;
  if(error||!user||!ALLOWED_EMAILS.has(norm(user.email))||user.user_metadata?.access_scope!=='living_with_art_speaker'){
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
    const matchesSearch=!q||[guest.full_name,guest.email,guest.job_title,guest.company,purchaseLabel(guest.purchase_intent)].some(value=>norm(value).includes(q));
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

function render(){
  renderStats();
  const list=filtered();status.textContent=`${list.length} ${list.length===1?'guest':'guests'}`;
  if(!list.length){rows.innerHTML='<tr><td colspan="5" class="empty">No matching guests.</td></tr>';cards.innerHTML='<div class="empty">No matching guests.</div>';return}
  rows.innerHTML=list.map(guest=>`<tr><td class="guest"><strong>${esc(guest.full_name)}</strong>${guest.email?`<a href="mailto:${encodeURIComponent(guest.email)}">${esc(guest.email)}</a>`:'<span class="missing">Email not provided</span>'}</td><td class="role"><strong>${esc(guest.job_title||'Not provided')}</strong><span>${esc(guest.company||'Not provided')}</span></td><td><span class="stage">${esc(purchaseLabel(guest.purchase_intent))}</span></td><td class="choice-cell">${checkbox(guest,'sit_near','Sit near')}</td><td class="choice-cell">${checkbox(guest,'of_interest','Of interest')}</td></tr>`).join('');
  cards.innerHTML=list.map(guest=>`<article class="card"><h3>${esc(guest.full_name)}</h3><p class="meta">${esc(guest.job_title||'Title not provided')}${guest.company?` · ${esc(guest.company)}`:''}</p><p class="email">${guest.email?`<a href="mailto:${encodeURIComponent(guest.email)}">${esc(guest.email)}</a>`:'Email not provided'}</p><p class="stage-line"><span>Art-purchase stage</span>${esc(purchaseLabel(guest.purchase_intent))}</p><div class="card-choices">${checkbox(guest,'sit_near','Sit near')}${checkbox(guest,'of_interest','Of interest')}</div></article>`).join('');
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
  if(!ALLOWED_EMAILS.has(email)||user.user_metadata?.access_scope!=='living_with_art_speaker'){await db.auth.signOut();showLogin();return}
  showApp(user);await loadGuests();
}

db.auth.onAuthStateChange((_event,session)=>{if(!session)showLogin()});
start();
