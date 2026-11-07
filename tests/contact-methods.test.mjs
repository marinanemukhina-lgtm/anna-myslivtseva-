import test from 'node:test';
import assert from 'node:assert/strict';
import { contactMethods } from '../src/contact-methods.mjs';

test('published Russian mobile gives tel and explicit SMS, not invented messengers', () => {
  const result = contactMethods({ phone: '8 (900) 000-00-00' });
  assert.equal(result.phone, '+79000000000');
  assert.deepEqual(result.messages, [{ label: 'Написать SMS', href: 'sms:+79000000000' }]);
});
test('empty, malformed and landline contacts never invent a messaging destination', () => {
  assert.deepEqual(contactMethods().messages, []);
  assert.equal(contactMethods({phone:'javascript:alert(1)'}).phone, '');
  assert.deepEqual(contactMethods({phone:'+74950000000'}).messages, []);
});
test('messenger and email destinations come only from published settings', () => {
  const result = contactMethods({email:' owner@example.invalid ',socialLinks:{telegram:'https://t.me/synthetic_test',whatsapp:'javascript:alert(1)'}});
  assert.deepEqual(result.messages, [
    {label:'Открыть Telegram',href:'https://t.me/synthetic_test',external:true},
    {label:'Написать на почту',href:'mailto:owner@example.invalid'},
  ]);
});
