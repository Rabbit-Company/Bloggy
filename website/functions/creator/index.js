export function onRequest(context) {
  return Response.redirect(context.env.DOMAIN, 301);
}