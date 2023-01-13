let paths;
let username;
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

async function getFile(key, type = 'text/html;charset=UTF-8'){
  let value = await getValue(key);
  if(value !== null) return new Response(value, { headers: { 'content-type': type }});
  return Response.redirect(env.DOMAIN, 307);
}

export async function onRequest(context) {
  request = context.request;
  env = context.env;
  paths = context.params.username;

  // Creator Page
  if(typeof(paths) === 'undefined'){
    return Response.redirect(env.DOMAIN, 301);
  }

  username = paths[0];

  // User Main Page
  if(paths.length == 1){
    return getFile("content_" + username);
  }

  let file = paths[1];

  if(paths.length == 2){
    if(file === 'feed.rss'){
      return getFile("feed_rss_" + username, 'application/rss+xml');
    }else if(file === 'feed.atom'){
      return getFile("feed_atom_" + username, 'application/atom+xml');
    }else if(file === 'feed.json'){
      return getFile("feed_json_" + username, 'application/json');
    }else{
      return getFile("post_" + username + "_" + file);
    }
  }

  return new Response(JSON.stringify(context.params.username))
}