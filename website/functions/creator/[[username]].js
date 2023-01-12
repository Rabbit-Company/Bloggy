export function onRequest(context) {
  return new Response(JSON.stringify(context.params.user))
}