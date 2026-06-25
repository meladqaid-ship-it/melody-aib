export function corsHeaders(origin: string | null) {
  const allowedOrigins = [
    'https://melody-ai.netlify.app',
    'http://localhost:3000',
  ];

  const allowOrigin =
    origin && allowedOrigins.includes(origin)
      ? origin
      : allowedOrigins[0];

  return {
    'Access-Control-Allow-Origin': allowOrigin,
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Credentials': 'true',
  };
}
