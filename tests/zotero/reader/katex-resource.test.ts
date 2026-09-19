import { describe, expect, it, vi } from 'vitest';
import { installKatexResource, KATEX_RESOURCE, KATEX_STYLESHEET, removeKatexResource } from '../../../packages/zotero/src/reader/katex-resource.ts';

describe('reader KaTeX resource mapping', () => {
  it('exposes only the bundled KaTeX directory and removes the substitution on shutdown', () => {
    const handler = { QueryInterface: vi.fn(), setSubstitution: vi.fn(), setSubstitutionWithFlags: vi.fn() };
    handler.QueryInterface.mockReturnValue(handler);
    const uri = { spec: 'jar:file:///plugin.xpi!/content/assets/katex/' };
    const host = {
      Services: { io: { getProtocolHandler: vi.fn(() => handler), newURI: vi.fn(() => uri) } },
      Ci: { nsIResProtocolHandler: {}, nsISubstitutingProtocolHandler: { ALLOW_CONTENT_ACCESS: 1, RESOLVE_JAR_URI: 2 } },
    };
    installKatexResource('jar:file:///plugin.xpi!/', host);
    expect(host.Services.io.newURI).toHaveBeenCalledWith('jar:file:///plugin.xpi!/content/assets/katex/');
    expect(handler.setSubstitutionWithFlags).toHaveBeenCalledWith(KATEX_RESOURCE, uri, 3);
    expect(KATEX_STYLESHEET).toBe('resource://zotero-chatgpt-katex/katex.min.css');
    removeKatexResource(host);
    expect(handler.setSubstitution).toHaveBeenLastCalledWith(KATEX_RESOURCE, null);
  });
});
