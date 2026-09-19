/** Parent/content actor registration for the hosted official ChatGPT page. */

export const OFFICIAL_CHAT_ACTOR = 'ZoteroChatGPTOfficialChat';
export const OFFICIAL_CHAT_BRIDGE_EVENT = 'ZoteroChatGPT:OfficialChatBridge';
export const OFFICIAL_CHAT_RESOURCE = 'zotero-chatgpt-plugin';
export const OFFICIAL_CHAT_RESOURCE_ROOT = `resource://${OFFICIAL_CHAT_RESOURCE}/`;

interface WindowActorRegistry {
  registerWindowActor(name: string, options: Record<string, unknown>): void;
  unregisterWindowActor(name: string): void;
}

declare const ChromeUtils: WindowActorRegistry;
declare const Services: ResourceHost['Services'];
declare const Ci: ResourceHost['Ci'];

interface ResourceHost {
  Services: {
    io: {
      getProtocolHandler(name: string): { QueryInterface(iface: unknown): { setSubstitution(name: string, uri: unknown): void; setSubstitutionWithFlags(name: string, uri: unknown, flags: number): void } };
      newURI(uri: string): unknown;
    };
  };
  Ci: { nsIResProtocolHandler: unknown; nsISubstitutingProtocolHandler: { ALLOW_CONTENT_ACCESS: number; RESOLVE_JAR_URI: number } };
}

function registry(value?: WindowActorRegistry): WindowActorRegistry {
  return value ?? ChromeUtils;
}

export function registerOfficialChatActor(rootURI: string, target?: WindowActorRegistry): void {
  registry(target).registerWindowActor(OFFICIAL_CHAT_ACTOR, {
    parent: { esModuleURI: `${rootURI}OfficialChatParent.mjs` },
    child: {
      esModuleURI: `${rootURI}OfficialChatChild.mjs`,
      events: {
        // Ordinary capture runs before the website's own bubble handlers. The system event group runs
        // later and could let the unaugmented question escape before the actor prevents it.
        click: { capture: true },
        input: { capture: true },
        keydown: { capture: true },
        submit: { capture: true },
      },
    },
    matches: ['https://chatgpt.com/*'],
    messageManagerGroups: ['zchatgpt'],
    allFrames: false,
  });
}

/** Map this add-on's jar root to a trusted Gecko resource URI for JSWindowActor ES modules. */
export function installOfficialChatResource(rootURI: string, host?: ResourceHost): void {
  const current = host ?? { Services, Ci };
  const handler = current.Services.io.getProtocolHandler('resource').QueryInterface(current.Ci.nsIResProtocolHandler);
  // Only the three actor modules are content-process-readable. The runtime binary, local records and
  // every other XPI file remain outside this substitution.
  const flags = current.Ci.nsISubstitutingProtocolHandler.ALLOW_CONTENT_ACCESS
    | current.Ci.nsISubstitutingProtocolHandler.RESOLVE_JAR_URI;
  handler.setSubstitutionWithFlags(OFFICIAL_CHAT_RESOURCE, current.Services.io.newURI(`${rootURI}content/actors/`), flags);
}

export function removeOfficialChatResource(host?: ResourceHost): void {
  const current = host ?? { Services, Ci };
  const handler = current.Services.io.getProtocolHandler('resource').QueryInterface(current.Ci.nsIResProtocolHandler);
  handler.setSubstitution(OFFICIAL_CHAT_RESOURCE, null);
}

export function unregisterOfficialChatActor(target?: WindowActorRegistry): void {
  registry(target).unregisterWindowActor(OFFICIAL_CHAT_ACTOR);
}
