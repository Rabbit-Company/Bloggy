let request;
let env;
const cache = caches.default;

const DEFAULT_SECURITY_HEADERS = {
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "X-XSS-Protection": "1; mode=block",
  "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' https://storage.googleapis.com/ https://analytics.rabbithop.org; style-src 'report-sample' 'self'; object-src 'none'; base-uri 'self'; connect-src 'self' https://cdn.bloggy.io https://analytics.rabbithop.org; font-src 'self'; frame-src 'self'; frame-ancestors 'none'; img-src * 'self' https:; manifest-src 'self'; form-action 'self'; media-src 'self'; worker-src 'self'",
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

async function getFile(key, type = 'text/html;charset=UTF-8'){
  let value = await getValue(key);
  if(value !== null){
    let newHeaders = new Headers();
    newHeaders.set('content-type', type);
    Object.keys(DEFAULT_SECURITY_HEADERS).map(function (name) {
      newHeaders.set(name, DEFAULT_SECURITY_HEADERS[name]);
    });
    return new Response(value, { headers: newHeaders});
  }
  return new Response("Main page not found. Please contact administrator.", { status: 404 });
}

export async function onRequest(context) {
  request = context.request;
  env = context.env;
  return getFile('main');
}