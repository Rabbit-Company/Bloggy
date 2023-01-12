let paths;
let username;
let html = null;

async function serveFile(id, type){

}

export async function onRequest(context) {
  paths = context.params.username;
  username = paths[0];

  // User Main Page
  if(paths.length == 1){
    html = await context.env.KV.get("content-" + username);
    if(html == null) return Response.redirect(context.env.DOMAIN, 301);
    return new Response(html, { headers: { 'content-type': 'text/html;charset=UTF-8' }});
  }

  return new Response(JSON.stringify(context.params.username))
}