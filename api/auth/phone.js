export default async function handler(req,res){
 if(req.method!=="POST")return res.status(405).json({error:"Method not allowed"});
 const url=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
 const key=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY;
 if(!url||!key)return res.status(503).json({error:"Phone sign-in is not configured. Add Supabase URL and publishable key in Vercel."});
 const {action,phone,token}=req.body||{};
 if(typeof phone!=="string"||!/^\+[1-9]\d{7,14}$/.test(phone))return res.status(400).json({error:"Use an international phone number with country code."});
 try{
  const endpoint=action==="send"?"/auth/v1/otp":action==="verify"?"/auth/v1/verify":null;
  if(!endpoint)return res.status(400).json({error:"Unknown authentication action."});
  if(action==="verify"&&(typeof token!=="string"||!/^[0-9]{4,8}$/.test(token)))return res.status(400).json({error:"Enter the verification code from your SMS."});
  const response=await fetch(url.replace(/\/$/,"")+endpoint,{method:"POST",headers:{"Content-Type":"application/json",apikey:key,Authorization:"Bearer "+key},body:JSON.stringify(action==="send"?{phone,create_user:true}:{phone,token,type:"sms"}),signal:AbortSignal.timeout(12000)});
  const body=await response.json().catch(()=>({}));
  if(!response.ok)return res.status(response.status).json({error:body.msg||body.message||body.error_description||"Authentication provider rejected the request."});
  return res.status(200).json(body);
 }catch(e){return res.status(502).json({error:e instanceof Error?e.message:"Authentication provider unavailable."});}
}