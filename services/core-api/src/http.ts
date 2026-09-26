export interface Request {
  rawPath?: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  cookies?: string[];
  body?: string;
  isBase64Encoded?: boolean;
  requestContext?: { http?: { method?: string } };
}
export class Problem extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code);
  }
}
export function header(request: Request, name: string) {
  return Object.entries(request.headers ?? {}).find(
    ([key]) => key.toLowerCase() === name.toLowerCase(),
  )?.[1];
}
export function json(
  statusCode: number,
  value: unknown,
  cookies: string[] = [],
  extra: Record<string, string> = {},
): {
  statusCode: number;
  cookies: string[];
  headers: Record<string, string>;
  body: string;
} {
  return {
    statusCode,
    cookies,
    headers: {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
      ...extra,
    },
    body: JSON.stringify(value),
  };
}
export function cookie(request: Request, name: string): string | undefined {
  const values = (request.cookies ?? [header(request, 'cookie') ?? ''])
    .flatMap((item) => item.split(';'))
    .map((item) => item.trim())
    .filter((item) => item.startsWith(name + '='));
  if (values.length !== 1) return undefined;
  const value = values[0]!.slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : undefined;
}
export function browserCookie(name: string, value: string, age: number) {
  return `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${age}`;
}
