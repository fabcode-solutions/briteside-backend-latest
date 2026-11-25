import { describe, expect, it } from 'vitest';
import { CONTACT_HIDDEN, hideContactInfo } from '../src/utils/contactInfo.js';

const hides = text => expect(hideContactInfo(text).hidden, text).toBe(true);
const keeps = text => {
  const r = hideContactInfo(text);
  expect(r.hidden, text).toBe(false);
  expect(r.text).toBe(text);
};

describe('hideContactInfo', () => {
  it('hides emails, plain and spelled out', () => {
    hides('mail me at jane.doe@gmail.com please');
    hides('jane @ gmail.com');
    hides('jane [at] gmail [dot] com');
    hides('jane (at) gmail (dot) com');
    hides('jane at gmail dot com');
    hides('jane at gmail.com');
  });

  it('hides phone numbers in any format', () => {
    hides('call 555-123-4567');
    hides('+1 (555) 123 4567');
    hides('my number is 555 123 45 67');
    hides('5.5.5.1.2.3.4.5.6.7');
    hides('+44 7911 123456');
  });

  it('hides messaging-app links', () => {
    hides('text me on wa.me/15551234567');
    hides('https://t.me/janedoe');
  });

  it('keeps ordinary messages', () => {
    keeps('Do you have anything open on 2026-11-23 at 3:30pm?');
    keeps('How much is a haircut? Is $45 right for 2 people?');
    keeps('I will arrive at home.');
    keeps('Can we meet at noon? I am at the gym dot dot dot');
  });

  it('replaces only the contact part', () => {
    expect(hideContactInfo('Hi! Call 555-123-4567 tomorrow').text).toBe(`Hi! Call ${CONTACT_HIDDEN} tomorrow`);
  });
});
