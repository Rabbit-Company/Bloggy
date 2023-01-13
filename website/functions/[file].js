let file;
let request;
let env;
const cache = caches.default;

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

async function getFile(key, type = 'text/html;charset=UTF-8', redirect = env.DOMAIN){
  let value = await getValue(key);
  if(value !== null) return new Response(value, { headers: { 'content-type': type }});
  return Response.redirect(redirect, 307);
}

export async function onRequest(context) {
  request = context.request;
  env = context.env;
  file = context.params.file;

  if(file === 'sitemap.xml'){
    return getFile('sitemap', 'application/xml');
  }else if(file === 'manifest.json'){
    return getFile('manifest', 'application/json');
  }else if(file === 'robots.txt'){
    return getFile('robots', 'text/plain;charset=utf-8');
  }else if(file === 'metadata.js'){
    return getFile('metadata', 'application/javascript');
  }

  return Response.redirect(env.DOMAIN, 307);
}