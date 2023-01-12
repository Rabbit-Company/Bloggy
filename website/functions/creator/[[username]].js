let paths;
let username;
let html = null;
const cache = caches.default;

export async function onRequest(context) {
  paths = context.params.username;

  // Creator Page
  if(typeof(paths) === 'undefined'){
    return Response.redirect(context.env.DOMAIN, 301);
  }

  username = paths[0];

  // User Main Page
  if(paths.length == 1){
    let key = "content-" + username;
    // Pull from Cache
    let cacheKey = context.request.url + "?key=" + key;
    let res = await cache.match(cacheKey);
    if(res) html = await res.text();
    if(html != null) return new Response(html, { headers: { 'content-type': 'text/html;charset=UTF-8' }});
    // Pull from KV
    html = await context.env.KV.get(key);
    if(html === null) return Response.redirect(context.env.DOMAIN, 301);
    return new Response(html, { headers: { 'content-type': 'text/html;charset=UTF-8' }});
  }

  return new Response(JSON.stringify(context.params.username))
}