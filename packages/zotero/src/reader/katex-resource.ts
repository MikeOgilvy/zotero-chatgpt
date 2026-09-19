/** Content-readable resource mapping for the bundled KaTeX stylesheet and its relative fonts only. */
export const KATEX_RESOURCE = 'zotero-chatgpt-katex';
export const KATEX_RESOURCE_ROOT = `resource://${KATEX_RESOURCE}/`;
export const KATEX_STYLESHEET = `${KATEX_RESOURCE_ROOT}katex.min.css`;

interface KatexResourceHost {
  Services: {
    io: {
      getProtocolHandler(name: string): { QueryInterface(iface: unknown): { setSubstitution(name: string, uri: unknown): void; setSubstitutionWithFlags(name: string, uri: unknown, flags: number): void } };
      newURI(uri: string): unknown;
    };
  };
  Ci: { nsIResProtocolHandler: unknown; nsISubstitutingProtocolHandler: { ALLOW_CONTENT_ACCESS: number; RESOLVE_JAR_URI: number } };
}

declare const Services: KatexResourceHost['Services'];
declare const Ci: KatexResourceHost['Ci'];

function currentHost(host?: KatexResourceHost): KatexResourceHost { return host ?? { Services, Ci }; }

/**
 * Reader documents use the `resource://zotero/` principal and Gecko rejects direct `jar:file:` CSS.
 * Expose only `content/assets/katex/`; the CSS can then resolve its bundled `fonts/...` URLs without
 * making the add-on root, runtime, records or actor modules content-readable.
 */
export function installKatexResource(rootURI: string, host?: KatexResourceHost): void {
  const current = currentHost(host);
  const handler = current.Services.io.getProtocolHandler('resource').QueryInterface(current.Ci.nsIResProtocolHandler);
  const flags = current.Ci.nsISubstitutingProtocolHandler.ALLOW_CONTENT_ACCESS
    | current.Ci.nsISubstitutingProtocolHandler.RESOLVE_JAR_URI;
  handler.setSubstitutionWithFlags(KATEX_RESOURCE, current.Services.io.newURI(`${rootURI}content/assets/katex/`), flags);
}

export function removeKatexResource(host?: KatexResourceHost): void {
  const current = currentHost(host);
  const handler = current.Services.io.getProtocolHandler('resource').QueryInterface(current.Ci.nsIResProtocolHandler);
  handler.setSubstitution(KATEX_RESOURCE, null);
}
