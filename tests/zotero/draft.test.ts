import { expect, it } from 'vitest';
import { addImage, makeAsk, removeImage } from '../../packages/zotero/src/chat/draft.ts';
import { imageA, paperA, settings } from '../contracts/factories.ts';

it('adds and removes pending images on a draft and includes them on ask', () => {
  const empty = { settings, paper: paperA, question: '图里的符号是什么？', citations: [], images: [] };
  const withImage = addImage(empty, imageA);
  expect(addImage(withImage, imageA).images).toHaveLength(1);
  expect(makeAsk(withImage, '2e4a6c8e-0b1d-4f3a-a5c7-9e1b3d5f7a90', '9a1c3e5f-7b2d-4c6e-8f0a-1b3d5f7a9c0e', settings).images).toEqual([imageA]);
  expect(removeImage(withImage, imageA.id).images).toEqual([]);
});
