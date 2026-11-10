export default async function handler(req,res){
  if(req.method!=="GET")return res.status(405).json({error:"Method not allowed"});
  const supabaseUrl=process.env.SUPABASE_URL||process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey=process.env.SUPABASE_PUBLISHABLE_KEY||process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY||process.env.SUPABASE_ANON_KEY;
  const auth=String(req.headers.authorization||"");
  const token=auth.startsWith("Bearer ")?auth.slice(7):"";
  if(!supabaseUrl||!anonKey)return res.status(503).json({error:"Authentication is not configured."});
  if(!token)return res.status(401).json({error:"Sign in is required."});
  try{
    const response=await fetch(supabaseUrl.replace(/\/$/,"")+"/auth/v1/user",{headers:{apikey:anonKey,Authorization:"Bearer "+token},signal:AbortSignal.timeout(10000)});
    const user=await response.json().catch(()=>({}));
    if(!response.ok)return res.status(response.status===401?401:502).json({error:"Unable to verify the signed-in account."});
    const meta=user.user_metadata||{};
    return res.status(200).json({id:user.id,email:user.email||null,phone:user.phone||null,name:meta.full_name||meta.name||meta.display_name||meta.first_name||null});
  }catch(e){return res.status(502).json({error:"Account profile service is unavailable."});}
}
