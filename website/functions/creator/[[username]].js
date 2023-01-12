let paths;
let username;
let html = null;
let request;
let env;
const cache = caches.default;

async function setValue(key, value, expirationTime = 86400, cacheTime = 600){
	let cacheKey = request.url + "?key=" + key;
	await env.KV.put(key, value, { expirationTtl: expirationTime });
	let nres = new Response(value);
	nres.headers.append('Cache-Control', 's-maxage=' + cacheTime);
	await cache.put(cacheKey, nres);
}

async function getValue(key, cacheTime = 600){
	let value = null;

	let cacheKey = request.url + "?key=" + key;
	let res = await cache.match(cacheKey);
	if(res) value = await res.text();

	if(value == null){
		value = await env.KV.get(key, { cacheTtl: cacheTime });
		let nres = new Response(value);
		nres.headers.append('Cache-Control', 's-maxage=' + cacheTime);
		if(value != null) await cache.put(cacheKey, nres);
	}

	return value;
}

export async function onRequest(context) {
  request = context.request;
  env = context.env;
  paths = context.params.username;

  // Creator Page
  if(typeof(paths) === 'undefined'){
    return Response.redirect(context.env.DOMAIN, 301);
  }

  username = paths[0];

  // User Main Page
  if(paths.length == 1){
    let key = "content-" + username;
    html = await getValue(key);
    if(html !== null) return new Response(html, { headers: { 'content-type': 'text/html;charset=UTF-8' }});
    return Response.redirect(context.env.DOMAIN, 301);
  }

  return new Response(JSON.stringify(context.params.username))
}