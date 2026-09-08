function handler(event) {
  var request = event.request;
  // API and file requests must never turn into a successful HTML response.
  if (request.uri === '/api' || request.uri.indexOf('/api/') === 0) {
    return { statusCode: 404, statusDescription: 'Not Found' };
  }
  if (request.uri.indexOf('.') === -1) request.uri = '/index.html';
  return request;
}
