// Inquiry imports may contain a mailbox header instead of a person's name.
// Strip surrounding quoting, never apostrophes inside names such as O'Connor.
function unquote(value: string): string {
  let result = value.trim();
  const pairs = [['"', '"'], ["'", "'"], ['„', '”'], ['“', '”'], ['‘', '’']];
  while (result.length > 1 && pairs.some(([start, end]) => result.startsWith(start) && result.endsWith(end))) {
    result = result.slice(1, -1).trim();
  }
  return result.replace(/\\(["'\\])/g, '$1').replace(/\s+/g, ' ').trim();
}

function parseMailbox(value: string) {
  const text = value.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"').replace(/&#0?39;|&apos;/gi, "'").trim();
  const email = text.match(/[A-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Z0-9](?:[A-Z0-9.-]*[A-Z0-9])?/i)?.[0] || '';
  const angleStart = text.indexOf('<');
  const name = unquote(angleStart >= 0
    ? text.slice(0, angleStart)
    : text.replace(email, '').replace(/^mailto:/i, ''));
  return { email, name };
}

export function parseInquiryContact(nameValue: unknown, emailValue: unknown) {
  const fromName = parseMailbox(String(nameValue || ''));
  const fromEmail = parseMailbox(String(emailValue || ''));
  const email = fromEmail.email || fromName.email;
  const name = fromName.name || fromEmail.name;
  const parts = name.split(/\s+/).filter(Boolean);
  return {
    email,
    fullName: name,
    firstName: parts[0] || 'Kontakt',
    lastName: parts.slice(1).join(' '),
  };
}
