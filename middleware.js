const SITE_SESSION_COOKIE = "site_access";
const ADMIN_SESSION_COOKIE = "admin_access";
const SESSION_SECRET = "SITE_SESSION_SECRET";

function b64(bytes){let s="";for(let i=0;i<bytes.length;i+=0x8000)s+=String.fromCharCode(...bytes.subarray(i,i+0x8000));return btoa(s).replace(/\+/g,"-").replace(/\//g,"_").replace(/=+$/g,"");}
function b64d(v){const p=v.replace(/-/g,"+").replace(/_/g,"/").padEnd(v.length+(4-v.length%4)%4,"=");const s=atob(p),b=new Uint8Array(s.length);for(let i=0;i<s.length;i++)b[i]=s.charCodeAt(i);return b;}
function cookie(request,name){const h=request.headers.get("cookie")||"";const m=h.match(new RegExp("(?:^|;\\s*)"+name+"=([^;]+)"));return m?decodeURIComponent(m[1]):null;}
async function sig(payload){const secret=process.env[SESSION_SECRET];if(!secret)return null;const data=new TextEncoder().encode(secret+"|"+payload);return b64(new Uint8Array(await crypto.subtle.digest("SHA-256",data)));}
async function validSession(request,name){const token=cookie(request,name);if(!token)return false;const p=token.split(".");if(p.length!==2)return false;const exp=Number(p[0]);if(!Number.isFinite(exp)||exp<=Date.now())return false;const expected=await sig(p[0]);if(!expected)return false;try{const a=b64d(p[1]),b=b64d(expected);if(a.length!==b.length)return false;let x=0;for(let i=0;i<a.length;i++)x|=a[i]^b[i];return x===0}catch{return false;}}
export default async function middleware(request){
 const url=new URL(request.url),path=url.pathname;
 if(path==="/unlock.html"||path==="/api/access"||path==="/favicon.ico")return;
 if(path==="/admin.html")return;
 if(path==="/api/keys")return;
 if(path.startsWith("/api/roblox")){if(await validSession(request,SITE_SESSION_COOKIE))return new Response(null,{status:204});return new Response(JSON.stringify({error:"Unauthorized"}),{status:401,headers:{"Content-Type":"application/json"}});}
 if(await validSession(request,SITE_SESSION_COOKIE))return;
 return Response.redirect(new URL("/unlock.html",request.url),302);
}
