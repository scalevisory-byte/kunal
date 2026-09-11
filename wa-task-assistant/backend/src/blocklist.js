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

/**
 * A name with the spacing and punctuation taken out.
 *
 * Typed by a person and stored by WhatsApp are two different spellings of the
 * same chat: "shubham prajapati" is filed as `shubhamprajapatis747`, and "Sai
 * Samarth" as "SaiSamarth". A literal substring test says no to both, so the
 * block silently never fires and the chat goes on being read and paid for -
 * which is exactly what happened to five of seven blocks added in one evening.
 *
 * Only spacing and punctuation are dropped. The letters still have to be
 * there, in order, so this cannot start matching chats that were not meant.
 */
export const flatten = (value) => String(value || '').toLowerCase().replace(/[^a-z0-9]+/g, '');

/** Does this pattern name a WhatsApp chat id rather than a person? */
const looksLikeId = (raw) => /@(c\.us|g\.us|lid|broadcast)$/i.test(raw);

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

  /*
   * A whole chat id is the one pattern that identifies a chat exactly, and it
   * was the one that never worked: it is not all digits, so it was tested
   * against the chat's NAME, where a chat id never appears. Blocking a group
   * whose name WhatsApp has not resolved yet is precisely when you have only
   * the id to go on.
   */
  if (looksLikeId(raw)) return String(chatId || '').toLowerCase() === raw.toLowerCase();

  const flat = flatten(raw);
  // An emoji-only pattern flattens to nothing; match it literally rather than
  // matching everything.
  if (!flat) return name.includes(raw.toLowerCase());

  return flatten(name).includes(flat);
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
