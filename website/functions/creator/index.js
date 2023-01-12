export async function onRequest(context) {
  return Response.redirect('/', 301);
}