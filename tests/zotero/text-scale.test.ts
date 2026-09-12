import { Window } from 'happy-dom';
import { expect, it } from 'vitest';
import {
  CHAT_TEXT_SCALE_DEFAULT,
  CHAT_TEXT_SCALE_PREF,
  applyChatTextScale,
  bindUnifiedReaderZoom,
  clampChatTextScale,
} from '../../packages/zotero/src/chat/text-scale.ts';

function documentOf(): Document {
  return new Window({ url: 'https://zcr.test/' }).document as unknown as Document;
}

it('keeps the dock type pref at 1 and never treats reader zoom as chat scale', () => {
  expect(CHAT_TEXT_SCALE_PREF).toBe('extensions.zcr.chatTextScale');
  expect(CHAT_TEXT_SCALE_DEFAULT).toBe(1);
  const doc = documentOf();
  const sidebar = doc.createElement('section');
  expect(applyChatTextScale(sidebar)).toBe(1);
  expect(sidebar.style.getPropertyValue('--zcr-chat-text-scale')).toBe('1');
});

it('forwards Command zoom from the dock to the reader without changing dock type', () => {
  const doc = documentOf();
  const sidebar = doc.createElement('section');
  sidebar.dataset.zcrSidebar = '';
  const composer = doc.createElement('textarea');
  sidebar.append(composer);
  doc.body.append(sidebar);
  const reader = { factor: 1, ins: 0, outs: 0, resets: 0 };
  bindUnifiedReaderZoom(sidebar, {
    zoomIn: () => { reader.ins += 1; reader.factor = 1.25; },
    zoomOut: () => { reader.outs += 1; reader.factor = 1; },
    zoomReset: () => { reader.resets += 1; reader.factor = 1; },
    readZoom: () => reader.factor,
  }, [doc]);
  expect(sidebar.style.getPropertyValue('--zcr-chat-text-scale')).toBe('1');
  const view = doc.defaultView!;
  const key = (init: KeyboardEventInit) => new view.KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  const fromDock = key({ key: '=', code: 'Equal', metaKey: true });
  composer.dispatchEvent(fromDock);
  expect(fromDock.defaultPrevented).toBe(true);
  expect(reader.ins).toBe(1);
  expect(reader.factor).toBe(1.25);
  expect(sidebar.style.getPropertyValue('--zcr-chat-text-scale')).toBe('1');
  expect(composer.dispatchEvent(key({ key: '-', code: 'Minus', metaKey: true }))).toBe(false);
  expect(reader.outs).toBe(1);
  expect(sidebar.style.getPropertyValue('--zcr-chat-text-scale')).toBe('1');
  expect(doc.dispatchEvent(key({ key: '0', code: 'Digit0', metaKey: true }))).toBe(false);
  expect(reader.resets).toBe(1);
  expect(sidebar.style.getPropertyValue('--zcr-chat-text-scale')).toBe('1');
});
it('keeps an explicit chat scale independent of native PDF zoom and clamps invalid preferences', () => {
  const doc = documentOf(); const sidebar = doc.createElement('section'); doc.body.append(sidebar);
  expect(applyChatTextScale(sidebar, 1.5)).toBe(1.5);
  let zoomed = 0;
  const unbind = bindUnifiedReaderZoom(sidebar, { zoomIn: () => { zoomed++; }, zoomOut: () => {}, zoomReset: () => {}, readZoom: () => 4 }, [doc]);
  doc.dispatchEvent(new doc.defaultView!.KeyboardEvent('keydown', { key: '+', metaKey: true, cancelable: true }));
  expect(zoomed).toBe(1); expect(sidebar.style.getPropertyValue('--zcr-chat-text-scale')).toBe('1.5');
  expect(clampChatTextScale(Number.NaN)).toBe(1); expect(clampChatTextScale(99)).toBe(3); expect(clampChatTextScale(0.1)).toBe(0.5);
  unbind();
});
