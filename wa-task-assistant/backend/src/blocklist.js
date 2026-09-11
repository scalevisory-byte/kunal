/**
 * What one blocked pattern matches.
 *
 * Pulled out of the WhatsApp listener so that exactly one rule exists. The
 * listener uses it to decide whether to drop a message; the AI Usage page uses
 * it to answer "I blocked this yesterday, why is it still arriving?" - and that
 * answer is worth nothing unless it is the same rule, applied to the same
 * fields. A second copy that drifted would be worse than no answer at all.
 *
 * Names match loosely, because "Mummy" should also catch "Mummy ❤️ Home". A
 * number matches on its ending, so the same person matches with or without a
 * country code - but never as a loose substring, which would let a short
 * pattern block half a contact list.
 */
export const digitsOnly = (value) => String(value || '').replace(/\D/g, '');

export function matchesPattern(pattern, { chatName, chatId, contactNumber } = {}) {
  const raw = String(pattern || '').trim();
  if (!raw) return false;

  const name = String(chatName || '').toLowerCase();
  const numbers = [digitsOnly(contactNumber), digitsOnly(chatId)].filter(Boolean);

  const asDigits = digitsOnly(raw);
  const isNumeric = asDigits.length > 0 && asDigits.length === raw.replace(/[\s+()-]/g, '').length;

  if (isNumeric) {
    // Too short to identify anyone; refuse rather than block everything.
    if (asDigits.length < 6) return false;
    return numbers.some((n) => n === asDigits || n.endsWith(asDigits));
  }

  return name.includes(raw.toLowerCase());
}

/**
 * What a stored message would be tested against, had it arrived now.
 *
 * The same rule the listener applies: in a group only the group's own name and
 * id, because a block is about a chat and testing the sender would follow a
 * person into every group he writes in. In a one-to-one chat the person IS the
 * chat, so the contact's name and number are tested there.
 */
export const blockTargetsOf = (row) => (row?.is_group
  ? { names: [row.chat_name], chatId: row.chat_id, contactNumber: null }
  : { names: [row.chat_name, row.contact_name], chatId: row.chat_id, contactNumber: row.contact_number });

/** Would this pattern have dropped this stored message? */
export const patternWouldDrop = (pattern, row) => {
  const { names, chatId, contactNumber } = blockTargetsOf(row);
  return names.filter(Boolean).some((n) => matchesPattern(pattern, { chatName: n, chatId, contactNumber }))
    || matchesPattern(pattern, { chatId, contactNumber });
};
