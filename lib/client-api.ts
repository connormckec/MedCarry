export type ApiResult = {error?: string; signInUrl?: string; [key:string]:unknown};
export async function api<T=ApiResult>(path:string,method="GET",payload?:unknown,raw=false):Promise<T>{
  const view=typeof window!=="undefined"&&window.location.pathname.startsWith("/patient")?"patient":"staff";
  const headers:Record<string,string>={"X-Medcarry-Request":"1","X-Medcarry-View":view};
  if(payload!==undefined&&!raw)headers["Content-Type"]="application/json";
  const res=await fetch(`/api/${path}`,{method,headers,body:payload===undefined?undefined:raw?payload as BodyInit:JSON.stringify(payload),cache:"no-store"});
  const data=await res.json() as ApiResult;
  if(!res.ok)throw Object.assign(new Error(data.error||"The action could not be completed."),{status:res.status,signInUrl:data.signInUrl});
  return data as T;
}
