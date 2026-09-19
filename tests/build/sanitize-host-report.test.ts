import { expect, it } from 'vitest';
import { sanitizeHostReport } from '../../scripts/sanitize-host-report.mjs';

it('removes OAuth query, fragment and userinfo from every serialized report URL', () => {
  const input = {
    currentURI: 'https://owner:password@appleid.apple.com/auth/authorize?client_id=secret#callback-token',
    timeline: [{ uri: 'https://chatgpt.com/c/synthetic?oauth=private#state' }],
    error: 'Redirected through https://auth.openai.com/authorize?code=credential#done',
    popupURL: 'custom-auth://callback/private?token=secret',
  };
  const result = sanitizeHostReport(input);
  expect(result.report).toEqual({
    currentURI: 'https://appleid.apple.com/auth/authorize',
    timeline: [{ uri: 'https://chatgpt.com/c/synthetic' }],
    error: 'Redirected through https://auth.openai.com/authorize',
    popupURL: '[custom-auth-url-omitted]',
  });
  const serialized = JSON.stringify(result.report);
  expect(serialized).not.toMatch(/password|client_id|callback-token|oauth=|credential|token=secret/u);
  expect(result.redactedCount).toBe(4);
});
