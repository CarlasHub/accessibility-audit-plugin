export default {
  async fetch(request, environment) {
    const url = new URL(request.url);
    if (!environment.ASSETS || typeof environment.ASSETS.fetch !== 'function') {
      return new Response('Static assets are unavailable.', { status: 503 });
    }

    const response = await environment.ASSETS.fetch(request);
    if (response.status !== 404 || request.method !== 'GET') return response;
    if (url.pathname.includes('.')) return response;

    return environment.ASSETS.fetch(new Request(new URL('/', url), request));
  }
};
