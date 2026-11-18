import { describe, expect, it } from 'vitest';
import { buildRequest, convert, curlFor, defaults, findEndpoint } from './endpoints.ts';

describe('curlFor', () => {
  it('escapes single quotes in the JSON body for the shell', () => {
    const ep = findEndpoint('text');
    const req = buildRequest(ep, convert(ep, { ...defaults(ep), text: "McDonald's fries" }, {}));
    const curl = curlFor(req, 'https://api.example');
    expect(curl).toContain(`-d '{"text":"McDonald'\\''s fries","ai":false}'`);
  });

  it('leaves a GET without a body', () => {
    const ep = findEndpoint('search');
    expect(curlFor(buildRequest(ep, convert(ep, defaults(ep), {})), 'https://api.example')).toBe(
      'curl "https://api.example/v1/foods/search?q=greek+yogurt&limit=8" \\\n  -H "Authorization: Bearer $NUTRIKIT_KEY"',
    );
  });
});
