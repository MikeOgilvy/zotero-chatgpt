import { expect, it } from 'vitest';
import { messageTimeLabel } from '../../../packages/zotero/src/chat/message-time.ts';

// Local-time construction keeps the calendar branches deterministic in any test timezone.
const now = new Date(2026, 8, 13, 20, 0).getTime();
const sameDay = new Date(2026, 8, 13, 9, 5).toISOString();
const previousDay = new Date(2026, 8, 12, 22, 15).toISOString();
const older = new Date(2026, 7, 30, 10, 0).toISOString();

const timeOf = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { hour: 'numeric', minute: '2-digit' }).format(Date.parse(iso));

it('shows only the clock time for a request accepted on the same calendar day', () => {
  const label = messageTimeLabel(sameDay, now, 'en-US');
  expect(label).toBe(timeOf(sameDay, 'en-US'));
  expect(label!.toLowerCase()).not.toContain('yesterday');
  // No absolute date sneaks in when the day part is unnecessary.
  expect(label).not.toContain('2026');
});

it('prefixes a previous-day timestamp with the reader language’s yesterday word', () => {
  const label = messageTimeLabel(previousDay, now, 'en-US');
  expect(label).toContain('Yesterday');
  expect(label).toContain(timeOf(previousDay, 'en-US'));
  expect(label).not.toContain('2026');
});

it('falls back to an absolute date for anything older than yesterday', () => {
  const label = messageTimeLabel(older, now, 'en-US');
  expect(label).toContain('2026');
  expect(label!.toLowerCase()).not.toContain('yesterday');
});

it('uses the requested locale for both the time and the yesterday word', () => {
  const label = messageTimeLabel(previousDay, now, 'zh-CN');
  expect(label).toContain('昨天');
  expect(label).toContain(timeOf(previousDay, 'zh-CN'));
  expect(messageTimeLabel(sameDay, now, 'zh-CN')).not.toContain('昨天');
});

it('returns null for a missing or unparseable timestamp instead of inventing a time', () => {
  expect(messageTimeLabel('', now, 'en-US')).toBeNull();
  expect(messageTimeLabel('not a date', now, 'en-US')).toBeNull();
  expect(messageTimeLabel('2026-13-40T99:99:99Z', now, 'en-US')).toBeNull();
});
