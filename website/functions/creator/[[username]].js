export function onRequest(context) {
  return new Response("Hello World");
  return new Response(JSON.stringify(context.params.user))
}