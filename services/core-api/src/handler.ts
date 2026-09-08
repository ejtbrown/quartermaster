interface Request {
  rawPath?: string;
  requestContext?: { http?: { method?: string } };
}

// Liveness only: deliberately makes no database call and cannot keep Aurora awake.
// No asset routes are exposed until authenticated tenant resolution is implemented.
export async function handler(event: Request) {
  const isHealth =
    (event.rawPath === '/health' || event.rawPath === '/api/health') &&
    event.requestContext?.http?.method === 'GET';
  return {
    statusCode: isHealth ? 200 : 404,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
    body: JSON.stringify(
      isHealth
        ? {
            service: 'quartermaster',
            status: 'foundation',
            assetApiReady: false,
            release: process.env.QM_RELEASE_SHA ?? 'local-preview',
          }
        : { error: 'not_found' },
    ),
  };
}
