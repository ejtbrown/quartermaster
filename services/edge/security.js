function handler(event) {
  var response = event.response;
  response.headers['content-security-policy'] = {
    value:
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob: QM_MEDIA_ORIGIN; connect-src 'self' QM_MEDIA_ORIGIN; worker-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
  };
  response.headers['permissions-policy'] = {
    value: 'camera=(self), microphone=(self), geolocation=()',
  };
  response.headers['x-robots-tag'] = { value: 'noindex, nofollow' };
  return response;
}
