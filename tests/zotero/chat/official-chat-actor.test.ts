import { describe, expect, it, vi } from 'vitest';
import {
  OFFICIAL_CHAT_ACTOR,
  installOfficialChatResource,
  registerOfficialChatActor,
  removeOfficialChatResource,
  unregisterOfficialChatActor,
} from '../../../packages/zotero/src/chat/official-chat-actor.ts';

describe('official ChatGPT actor registration', () => {
  it('limits the actor to the exact official origin and this plugin browser group', () => {
    const registry = { registerWindowActor: vi.fn(), unregisterWindowActor: vi.fn() };
    registerOfficialChatActor('resource://zotero-chatgpt-plugin/', registry);
    expect(registry.registerWindowActor).toHaveBeenCalledWith(OFFICIAL_CHAT_ACTOR, {
      parent: { esModuleURI: 'resource://zotero-chatgpt-plugin/OfficialChatParent.mjs' },
      child: {
        esModuleURI: 'resource://zotero-chatgpt-plugin/OfficialChatChild.mjs',
        events: {
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
  });

  it('maps the XPI root through the standard resource protocol and removes it on shutdown', () => {
    const handler = { QueryInterface: vi.fn(), setSubstitution: vi.fn(), setSubstitutionWithFlags: vi.fn() };
    handler.QueryInterface.mockReturnValue(handler);
    const uri = { spec: 'jar:file:///plugin.xpi!/' };
    const host = {
      Services: { io: { getProtocolHandler: vi.fn(() => handler), newURI: vi.fn(() => uri) } },
      Ci: { nsIResProtocolHandler: {}, nsISubstitutingProtocolHandler: { ALLOW_CONTENT_ACCESS: 1, RESOLVE_JAR_URI: 2 } },
    };
    installOfficialChatResource('jar:file:///plugin.xpi!/', host);
    expect(host.Services.io.newURI).toHaveBeenCalledWith('jar:file:///plugin.xpi!/content/actors/');
    expect(handler.setSubstitutionWithFlags).toHaveBeenCalledWith('zotero-chatgpt-plugin', uri, 3);
    removeOfficialChatResource(host);
    expect(handler.setSubstitution).toHaveBeenLastCalledWith('zotero-chatgpt-plugin', null);
  });

  it('unregisters the actor on plugin shutdown', () => {
    const registry = { registerWindowActor: vi.fn(), unregisterWindowActor: vi.fn() };
    unregisterOfficialChatActor(registry);
    expect(registry.unregisterWindowActor).toHaveBeenCalledWith(OFFICIAL_CHAT_ACTOR);
  });
});
