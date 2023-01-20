let paths;
let username;
let request;
let env;
const cache = caches.default;

const DEFAULT_SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-XSS-Protection": "1; mode=block",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://storage.googleapis.com/ https://analytics.bloggy.io; style-src 'report-sample' 'self'; object-src 'none'; base-uri 'self'; connect-src 'self' https://cdn.bloggy.io https://analytics.bloggy.io; font-src 'self'; frame-src 'self'; frame-ancestors 'none'; img-src * 'self' https:; manifest-src 'self'; form-action 'self'; media-src 'self'; worker-src 'self'",
  "Permissions-Policy": "interest-cohort=()"
};

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
  if(value !== null){
    let newHeaders = new Headers();
    newHeaders.set('content-type', type);
    Object.keys(DEFAULT_SECURITY_HEADERS).map(function (name) {
      newHeaders.set(name, DEFAULT_SECURITY_HEADERS[name]);
    });
    return new Response(value, { headers: newHeaders});
  }
  return Response.redirect(redirect, 307);
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
    if(file === 'metadata.js'){
      return getFile('metadata_' + username, 'application/javascript');
    }else if(file === 'feed.rss'){
      return getFile("feed_rss_" + username, 'application/rss+xml');
    }else if(file === 'feed.atom'){
      return getFile("feed_atom_" + username, 'application/atom+xml');
    }else if(file === 'feed.json'){
      return getFile("feed_json_" + username, 'application/json');
    }else{
      return getFile("post_" + username + "_" + file, 'text/html;charset=UTF-8', env.DOMAIN + "/creator/" + username);
    }
  }

  return Response.redirect(env.DOMAIN, 301);
}