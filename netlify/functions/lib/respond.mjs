export function send(data, status = 200, headers = {}) {
  return Response.json(data, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

export function problem(error, requestId) {
  const status = error.status || 500;
  const expose = status < 500 || error.code === 'CONFIG_ERROR' || error.code === 'PROVIDER_ERROR';
  return send({
    error: error.code || (status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR'),
    message: expose ? error.message : 'Funding Desk could not complete this request.',
    details: expose ? error.details : undefined,
    requestId,
  }, status);
}

export function fail(message, status = 400, code = 'REQUEST_ERROR', details) {
  const error = new Error(message); error.status = status; error.code = code; error.details = details; throw error;
}

export function text(value, name, max = 5000) {
  if (typeof value !== 'string' || !value.trim()) fail(`${name} is required.`);
  return value.trim().slice(0, max);
}

export function uuid(value) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value || '')) fail('Invalid record ID.');
  return value;
}
