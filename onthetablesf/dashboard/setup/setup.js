import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';
const SUPABASE_URL='https://iddzcbknnddkonrcwgpt.supabase.co';
const PUBLISHABLE_KEY='sb_publishable_qYWrm4tJE1n80lJx7PFoEw_WCkcV1ZL';
const ENDPOINT=`${SUPABASE_URL}/functions/v1/salute-event-viewer-admin`;
const db=createClient(SUPABASE_URL,PUBLISHABLE_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
const form=document.getElementById('setupForm'),signedOut=document.getElementById('signedOut'),message=document.getElementById('setupMessage');
let session=null;
const {data}=await db.auth.getSession();session=data.session;
if(session){form.hidden=false}else{signedOut.hidden=false}
form.addEventListener('submit',async event=>{
  event.preventDefault();
  const password=document.getElementById('password').value,confirm=document.getElementById('confirmPassword').value;
  if(password!==confirm){message.textContent='The passwords do not match.';return}
  message.textContent='Saving…';
  const response=await fetch(ENDPOINT,{method:'POST',headers:{Authorization:`Bearer ${session.access_token}`,apikey:PUBLISHABLE_KEY,'Content-Type':'application/json'},body:JSON.stringify({password})});
  const result=await response.json().catch(()=>({}));
  if(!response.ok){message.textContent=result.error||'The password could not be saved.';return}
  form.reset();message.textContent='Password saved. Sheela can now sign in to her Bay Area dashboard.';
});
