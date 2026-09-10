import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from './config.js';
import { log } from './logger.js';
import { today, todayLong, normalizeDueDate } from './dates.js';
import { isoAtLocal } from './quickparse.js';
import { recordUsage } from './db.js';
import { listGroups, routeTask } from './groups.js';
import { isRawId } from './wid.js';

let client = null;

/** Built on first use so a missing key fails the extraction, not the whole process. */
function anthropic() {
  if (!client) {
    client = config.anthropicApiKey
      ? new Anthropic({ apiKey: config.anthropicApiKey })
      : new Anthropic(); // falls back to ANTHROPIC_AUTH_TOKEN / `ant auth login` profile
  }
  return client;
}

/**
 * Stand in for the Anthropic client, for tests only.
 *
 * The behaviour worth testing here is what this file does with a reply it did
 * not like - cut off, or unreadable - and the only honest way to produce one
 * is to hand it one. Nothing in production calls this.
 */
export function setClientForTests(stub) {
  client = stub;
}

const ExtractionSchema = z.object({
  tasks: z.array(
    z.object({
      source_index: z
        .number()
        .describe('Index of the message in the numbered list this task came from.'),
      title: z
        .string()
        .describe(
          'Short imperative summary, max ~80 characters. Sentence case with ' +
            'misspellings fixed, whatever case the message was typed in; ' +
            'acronyms and proper names kept as they are.'
        ),
      description: z
        .string()
        .describe(
          'Context the title does not already carry - what exactly, for whom, why. ' +
            'Empty string when the title says it all; never restate the title.'
        ),
      contact: z.string().describe('Who asked for it. Empty string if unclear.'),
      chat_name: z.string().describe('The chat or group the request came from.'),
      due_date: z
        .string()
        .describe('Due date as YYYY-MM-DD, resolved against today. Empty string if none stated or implied.'),
      remind_time: z
        .string()
        .describe(
          'A specific clock time the message states, as HH:MM in 24-hour form ' +
            '(e.g. "10 baje" -> "10:00", "5pm" -> "17:00"). Empty string if no time is given.'
        ),
      priority: z.enum(['high', 'medium', 'low']),
      assigned_to: z
        .string()
        .describe(
          'The person who is meant to DO this, when the task is one he is giving ' +
            'to somebody else. Their name as it appears in the chat. Empty string ' +
            'when the task is his own to do - which is most of them.'
        ),
      group: z
        .string()
        .describe(
          'Which of the named businesses this task belongs to, copied exactly from ' +
            'the list given. Empty string when it belongs to none of them or you cannot tell.'
        ),
      confidence: z
        .enum(['high', 'medium', 'low'])
        .describe(
          'How sure you are this is genuinely a task he must do. "low" when the ' +
            'message is ambiguous, conversational, or might not be aimed at him.'
        ),
    })
  ),
});

const SYSTEM_PROMPT = `You extract actionable tasks for a single busy entrepreneur from his incoming personal WhatsApp messages.

He runs several businesses (travel, accounting/tax/legal advisory, recruitment, debt recovery, furniture/interiors), so requests arrive mixed in with ordinary chat.

Extract a task ONLY when a message implies something HE needs to do or follow up on. Examples of what qualifies:
- someone asks him to send, share, book, confirm, pay, check, arrange, or prepare something
- a commitment he made ("I'll send it tomorrow")
- a deadline, appointment, or payment he is responsible for

Do NOT extract:
- greetings, small talk, jokes, forwards, memes, "good morning" broadcasts
- news, promotional or automated messages
- purely informational updates that need no action from him
- something already clearly completed in the same conversation
- a duplicate of another task in the same batch (merge them into one)

Rules:
- title: short and imperative, e.g. "Send GST invoice to Rakesh".

  Write it properly, whatever state the message was in. These are typed fast on
  a phone, often shouting and usually misspelt - "ADV IDMC AUDIT QUERY REVIW",
  "complete sunhine audit tommorow" - and the title is what he reads back on a
  list for weeks, so it should read like something a person wrote on purpose:

  * Sentence case. Not ALL CAPS, however the message was typed.
  * Fix obvious misspellings: REVIW -> review, sunhine -> Sunshine,
    tommorow -> tomorrow, arroohan -> Arrohan, recieved -> received.
  * Keep acronyms and codes exactly as they are - GST, TDS, TCS, GSTR-3B, IDMC,
    BNF, RRTM, PAN, NOC, JV, HR. Capitalise names of people and companies.
  * Correct the spelling, never the meaning. If a word might be a name, a place
    or a product you do not recognise, leave it alone - a wrong "correction" to
    somebody's name is worse than a typo, because he will not recognise the task
    as his own.
- description: leave it an EMPTY STRING unless it adds something the title does not.
  "Process BNF salary" needs no description saying "BNF salary payment needs to be done";
  that is the same sentence twice and it clutters the list.
- due_date: only when the message states or clearly implies one. Resolve relative words
  ("today", "tomorrow", "by Friday", "month end") against the current date given below,
  and output YYYY-MM-DD. If there is no date signal, use an empty string. Do not guess.
- remind_time: only when a clock time is actually stated ("10 baje", "by 5pm",
  "subah 9 baje"). Give it as HH:MM in 24-hour form. Empty string if no time is
  mentioned - do not invent one just because there is a date.
- priority: "high" for money, legal/statutory deadlines, travel about to happen, or an
  explicitly urgent ask; "low" for vague or nice-to-have; "medium" otherwise.
- confidence: your own honest judgement of whether this really is a task for him.
  Use "low" when the message is ambiguous, when it might be aimed at somebody else,
  or when you are extracting it only because it might matter. A "low" task is held
  back for him to confirm rather than being chased, so marking one honestly costs
  nothing - inventing confidence you do not have is what causes wrong reminders.
- assigned_to: who has to do the work.

  Each message says who wrote it and where. That is the whole signal - never
  the wording, which reads the same either way.

  * Somebody else wrote it, asking him for something - "invoice bhej dijiye",
    "kal tak documents chahiye". The work is HIS. Leave assigned_to empty.

  * Somebody else wrote it in a group, asking SOMEBODY ELSE - "please advise
    for payment @abdul bhai kiski tkt he?", "@Meera send the ledger". He is in
    the group but he is not the one being asked, and this is not his work.
    DO NOT EXTRACT IT AT ALL - not as his task, not as a delegated one. He did
    not hand it out and nobody asked him for it; putting it on his list means
    he is chased for somebody else's job.

    Read who is being addressed, not who would normally do it: an @mention, a
    name at the start, or a reply aimed at one person. If the message names
    nobody, or names him as well, it is a request to the group and he is part
    of that group - treat it as his.

  * He wrote it in his own notes-to-self chat - "kal BNF salary karni hai",
    "pay arroohan tds today last day". A note to himself. The work is HIS.
    Leave assigned_to empty.

  * He wrote it to one person - "Rahul, GST documents kal 5 baje tak bhej
    dena". The work is THEIRS: assigned_to is that person.

  * He wrote it into a work group - "Need all tds entry till aug 26", "Send me
    data, current year". These groups are how he runs his teams, so an
    instruction he types into one is work he is handing to that team, not work
    he is taking on. If he names somebody ("@Meera - send me data"), that
    person is assigned_to. If he names nobody, assigned_to is the group's own
    name, exactly as given.

  A question he is asking rather than work he is handing out - "Ledger pan ek
  ma karu ke agal rakhu?" - is not a task at all; do not extract it.

  When you genuinely cannot tell, leave assigned_to empty and set confidence
  "low". A task filed against the wrong person is worse than one filed against
  nobody: he will chase somebody who was never asked.

- source_index must be the index of the message the task came from.

Some messages arrive with a PHOTO attached; the picture follows the message it belongs
to and is labelled with the same index. People here send invoices, bills, cheques,
tickets, forms and screenshots of bank transfers as photos, often with no caption at
all, and the thing to do is usually visible only in the picture.

- Read the photo the way you read the text: extract a task only when it implies
  something HE must do. An invoice to be paid, a form to be filled, a bill to be
  checked, a document to be sent on - those are tasks.
- Put what identifies it in the title, from the image itself: a name, a bill number,
  an amount. "Pay Sunshine invoice 4471 - Rs 84,000" is useful; "Pay invoice" is not.
- A date printed on the document (a due date, a filing deadline) counts as stated.
  A date it was merely issued on does not.
- Ignore photos that are not work: greetings and festival images, memes, forwards,
  screenshots of jokes, family pictures, status broadcasts. These are the majority of
  photos in a personal chat, and returning nothing for them is the correct outcome.
- If a photo is too blurred or cropped to read, do not guess at what it says. Either
  leave it alone or, if it is clearly a document that matters, extract it with
  confidence "low" so he is asked rather than reminded about something invented.
- If nothing in the batch is actionable, return an empty tasks array. That is a normal,
  expected outcome - do not invent tasks to fill the list.
`;

/** A message that could be handing work to somebody: his, and not to himself. */
const canDelegate = (source) => Boolean(source?.from_me) && !source?.is_self;

function renderBatch(messages) {
  return messages
    .map((m, i) => {
      const where = m.is_group ? `group "${m.chat_name}"` : `chat with ${m.chat_name}`;
      // Direction is what separates work he has been given from work he is
      // giving out, so it is stated rather than left to be inferred.
      const who = m.is_self
        ? 'HE WROTE THIS in his own notes-to-self chat'
        : m.from_me
          ? `HE WROTE THIS, to ${m.is_group ? `the team in "${m.chat_name}"` : m.chat_name || 'someone'}`
          : `${m.contact_name || m.contact_number || 'unknown'} wrote this to him`;
      // Only stated when it is known and it matters: an incoming group message
      // that names somebody, where that somebody is not him.
      const aimed =
        !m.from_me && m.is_group && m.mentions_someone && !m.mentions_me
          ? '\n    addressed to somebody else in the group, not to him'
          : '';

      return [
        `[${i}] ${who} (${where})${aimed}`,
        `    sent: ${m.sent_at}`,
        // Says so explicitly, so a caption-less photo does not look like an
        // empty message the model should ignore.
        m.image?.data ? '    a photo is attached below' : null,
        `    text: ${m.body || '(no text, see the photo)'}`,
      ].filter(Boolean).join('\n');
    })
    .join('\n\n');
}

/**
 * Send a batch of buffered messages to Claude and return normalized task rows.
 * `messages` are message records as stored in the `messages` table.
 */
export async function extractTasks(messages) {
  if (!messages.length) return [];

  const withImages = messages.filter((m) => m.image?.data);

  /*
   * Everything that does not change from one call to the next, in one block,
   * marked for caching.
   *
   * This is where the money was going. The instructions are two thousand tokens
   * and the business list several hundred more, and both were sent again on
   * every single call - six hundred calls a day, each carrying the same three
   * thousand tokens of preamble around two or three lines of actual WhatsApp.
   * Roughly nine tokens in ten were a re-run of the previous call.
   *
   * A cached read costs a tenth of an ordinary input token, so the preamble
   * becomes almost free while the entry is warm - and with a batch going out
   * every minute or two it stays warm all day. The business list sits inside
   * the cached block deliberately: it changes when a business is added, which
   * costs one write, not on every call.
   *
   * Nothing volatile may appear before this point. The date and the messages
   * come after it, in the user turn, for exactly that reason.
   */
  const groups = listGroups();
  const groupNames = groups.map((g) => g.name);
  const system = [
    {
      type: 'text',
      text: groupNames.length
        ? [
            SYSTEM_PROMPT,
            '',
            'He runs these businesses. Put each task under the one it belongs to, copying the',
            'name exactly. Use an empty string when a task belongs to none of them or you',
            'cannot tell - a task in the wrong company\'s list is worse than one in no list.',
            groupNames.map((n) => `- ${n}`).join('\n'),
          ].join('\n')
        : SYSTEM_PROMPT,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const intro = [
    `Current date: ${todayLong()} (${today()}), timezone ${config.timezone}.`,
    '',
    `Here are ${messages.length} incoming WhatsApp message(s). Extract the actionable tasks.`,
    '',
    renderBatch(messages),
  ].filter(Boolean).join('\n');

  /*
   * Text first, then each picture introduced by its own index. The API takes
   * images as separate blocks rather than inside the text, so the index line is
   * what ties a photo back to the message it arrived with.
   */
  const content = [{ type: 'text', text: intro }];
  for (const m of withImages) {
    content.push({
      type: 'text',
      text: `Photo attached to message [${messages.indexOf(m)}]:`,
    });
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: m.image.mime, data: m.image.data },
    });
  }

  let parsed;
  let truncated = false;
  try {
    const response = await anthropic().messages.parse({
      model: config.model,
      /*
       * Room for the answer, because running out of it loses tasks silently.
       *
       * A batch of forty messages can carry a lot of work, and a reply cut off
       * at the ceiling comes back as a half-written object: it fails the schema,
       * `parsed_output` is null, and the old code read that as "no tasks here"
       * and marked every message read. 16k is the SDK's own guidance for a
       * non-streaming call, and a ceiling costs nothing unless it is used.
       */
      max_tokens: 16000,
      system,
      messages: [{ role: 'user', content }],
      output_config: { format: zodOutputFormat(ExtractionSchema, 'extracted_tasks') },
    });
    parsed = response.parsed_output;
    truncated = response.stop_reason === 'max_tokens';
    const usage = response.usage || {};
    // Recorded per call, so spend is measured rather than guessed at later.
    recordUsage({
      kind: 'extract',
      model: config.model,
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_read: usage.cache_read_input_tokens,
      cache_write: usage.cache_creation_input_tokens,
      messages: messages.length,
      tasks: parsed?.tasks?.length ?? 0,
    });
    log.info(
      `Claude extraction: ${messages.length} message(s) -> ${parsed?.tasks?.length ?? 0} task(s)` +
        ` (in ${usage.input_tokens} / out ${usage.output_tokens} tokens)`
    );
  } catch (err) {
    log.error('Claude extraction failed:', err?.message || err);
    throw err;
  }

  /*
   * A cut-off answer is split and asked again, not accepted.
   *
   * `stop_reason: 'max_tokens'` means the reply ran out of room, so whatever
   * tasks were still to come were never written. Half the batch is half the
   * work to describe, so it fits - and each half goes through this same path,
   * so a very dense batch narrows until it does. Reported as "there is more
   * task, couldn't read properly", which is exactly what a truncated answer
   * looks like from the outside.
   */
  if (truncated && messages.length > 1) {
    const half = Math.ceil(messages.length / 2);
    log.warn(
      `Claude's answer was cut off on ${messages.length} messages; splitting into ${half} + ${messages.length - half}.`
    );
    const first = await extractTasks(messages.slice(0, half));
    const second = await extractTasks(messages.slice(half));
    return [...first, ...second];
  }

  /*
   * No parsed answer is a failure, not an empty one.
   *
   * `parsed_output` is null when the reply did not validate - truncated, or
   * malformed. Returning [] here would mark every message in the batch read
   * and move on, which loses them for good. Throwing leaves them unprocessed,
   * which is what the re-run is for.
   */
  if (!parsed) {
    throw new Error(
      truncated
        ? 'Claude ran out of room to answer and the reply could not be read'
        : 'Claude returned an answer that did not match the expected shape'
    );
  }

  if (!parsed.tasks?.length) return [];

  return parsed.tasks
    .map((task) => {
      const source = messages[task.source_index] ?? null;
      const title = String(task.title || '').trim();
      if (!title) return null;
      const dueDate = normalizeDueDate(task.due_date);
      const timeMatch = /^(\d{1,2}):(\d{2})$/.exec((task.remind_time || '').trim());
      let remindAt = null;
      if (timeMatch && dueDate) {
        const hour = Number(timeMatch[1]);
        const minute = Number(timeMatch[2]);
        if (hour <= 23 && minute <= 59) {
          remindAt = isoAtLocal(dueDate, hour, minute, config.timezone);
        }
      }

      return {
        title,
        description: task.description?.trim() || null,
        /*
         * Who sent it. In a group the message itself knows, and that beats a
         * guess every time - the model was filling this with the group's own
         * name often enough that the row had the same text twice and collapsed
         * to one label, losing the sender the group name was meant to sit
         * beside. Claude's answer is kept for a one-to-one chat, where it can
         * name somebody the message only mentions.
         */
        contact: source?.is_group
          ? source.contact_name || source.contact_number || task.contact?.trim() || null
          : task.contact?.trim() || source?.contact_name || source?.contact_number || null,
        /*
         * Where it came from. The message knows this outright - it is the chat
         * it arrived in - so nothing the model says can improve on it.
         *
         * Taking the model's answer first is what lost the group names: asked
         * which chat a message came from, it answers with the person who wrote
         * it often enough, and "Preeti Khandelwal" then stood where "Vikas
         * Travel | Pinetree accounting services" belonged - the same text as
         * the sender, so the row printed one name instead of both. Kept only as
         * a fallback for the case where the model points at no message at all.
         */
        chat_name: source?.chat_name || task.chat_name?.trim() || null,
        chat_id: source?.chat_id ?? null,
        is_group: source?.is_group ? 1 : 0,
        message_id: source?.id ?? null,
        source: 'whatsapp',
        origin: 'ai',
        due_date: dueDate,
        due_at: remindAt,
        priority: task.priority,

        /*
         * Who the work is between.
         *
         * Direction is decided here, from who sent the message, not from what
         * the message says - somebody can write "main kar dunga" in a request
         * and it is still a request. Only a message he wrote can hand work out;
         * only a message somebody else wrote can be work he was given.
         */
        /*
         * Only a message he wrote can hand work out, and never one written in
         * his own notes chat - a note to himself is his own work however it is
         * phrased. The wid is the chat the instruction was given in, which for
         * a group is the group: that is where a nudge belongs, since that is
         * where the work was handed over in front of everybody.
         */
        /*
         * Never an id, whatever the model read.
         *
         * The batch it is given carries the chat name, and when that name was
         * a lid the model dutifully answered with it - so a task was "given
         * to" 202383321759941:33, which names nobody and put a number on the
         * staff button. The lid is stopped at the source now; this refuses it
         * a second time, because a wrong assignee is worse than none.
         */
        assigned_to: canDelegate(source) && task.assigned_to?.trim() && !isRawId(task.assigned_to)
          ? task.assigned_to.trim().slice(0, 80)
          : null,
        assigned_to_wid:
          canDelegate(source) && task.assigned_to?.trim() && !isRawId(task.assigned_to)
            ? source.chat_id
            : null,
        requested_by:
          source && !source.from_me && !source.is_self
            ? (source.contact_name || source.contact_number || source.chat_name || null)
            : null,
        requested_by_wid: source && !source.from_me ? source.chat_id : null,
        // Keyword rules decide first; this is only consulted for what they
        // do not catch. See groups.js.
        group_id: routeTask(
          {
            title,
            description: task.description,
            // The real chat, for the same reason: a business is matched on
            // where the work came from, and the model's guess is not that.
            chat_name: source?.chat_name || task.chat_name,
            contact: task.contact,
          },
          task.group,
          groups
        ),
        // The model's own report, kept as such. A task it was unsure about is
        // created but held back for confirmation rather than being chased.
        ai_confidence: task.confidence || null,
        needs_confirmation: task.confidence === 'low' ? 1 : 0,
        status: 'open',
        // Not a column: the caller attaches this to the created task so the
        // invoice is on the task it produced, then drops it.
        _image: source?.image || null,
      };
    })
    .filter(Boolean);
}

/* ---------------- tidying up titles that are already on the list ---------------- */

const TidySchema = z.object({
  titles: z.array(
    z.object({
      id: z.number().describe('The id given with the title, copied back exactly.'),
      title: z.string().describe('The title rewritten, or the original unchanged.'),
      changed: z.boolean().describe('Whether anything was actually changed.'),
    })
  ),
});

const TIDY_PROMPT = `You are tidying the titles of tasks on one person's list.

He runs several businesses in Gujarat - travel, accounting and tax, recruitment,
debt recovery, furniture - and types these on a phone, fast, in a hurry. They are
read back on a list for weeks, so they should read like something written on
purpose.

Fix, in each title:

- Spelling. "regstaon" -> "registration", "pendig" -> "pending", "documnets" ->
  "documents", "reviw" -> "review", "sunhine" -> "Sunshine", "tommorow" ->
  "tomorrow", "recieved" -> "received".
- Capitalisation. Names of people, places and companies get capitals: odisha ->
  Odisha, jayesh chelaramani -> Jayesh Chelaramani, nidhi -> Nidhi. Sentence case
  otherwise.
- Acronyms and codes stay exactly as they are: GST, TDS, TCS, GSTR-3B, PAN, NOC,
  ITR, JV, IDMC, BNF, RRTM, AY 2026-27.

Do NOT:

- Change what the task means, or shorten it, or make it more formal. "Give Reva
  money" is a complete instruction; leave it as one.
- Translate. Hindi and Gujarati words stay in the words he used - "kal", "karna",
  "bhej dena" - because that is how he will recognise the task.
- "Correct" a word you do not recognise into one you do. An unfamiliar word is
  far more likely to be somebody's name, a place, or a product than a mistake,
  and a name rewritten into a different word is worse than the typo was.

Copy each id back exactly. Set changed to false, and return the title unchanged,
whenever there is nothing genuinely wrong with it - most titles are fine.`;

/**
 * Cleaned-up versions of titles already on the list.
 *
 * A separate call rather than part of extraction, because these are tasks that
 * exist: some were typed by hand and never went near the model, and the rest
 * were written before the extractor was asked to write them properly. One call
 * for the whole batch - the cost of a page of text, once, on a button.
 *
 * It only ever proposes. Nothing is written here; see the route.
 */
export async function tidyTitles(tasks) {
  if (!tasks.length) return [];

  const listed = tasks.map((t) => `${t.id}: ${t.title}`).join('\n');
  const response = await anthropic().messages.parse({
    model: config.model,
    max_tokens: 4000,
    system: TIDY_PROMPT,
    messages: [{ role: 'user', content: `Tidy these ${tasks.length} titles:\n\n${listed}` }],
    output_config: { format: zodOutputFormat(TidySchema, 'tidied_titles') },
  });

  const usage = response.usage || {};
  recordUsage({
    kind: 'tidy',
    model: config.model,
    input_tokens: usage.input_tokens,
    output_tokens: usage.output_tokens,
    cache_read: usage.cache_read_input_tokens,
    cache_write: usage.cache_creation_input_tokens,
    messages: tasks.length,
    tasks: 0,
  });

  const byId = new Map(tasks.map((t) => [t.id, t]));
  return (response.parsed_output?.titles ?? [])
    .map((row) => {
      const original = byId.get(row.id);
      const title = String(row.title || '').trim().slice(0, 200);
      // A rewrite that comes back identical, or empty, is not a proposal.
      if (!original || !title || title === original.title) return null;
      return { id: row.id, from: original.title, to: title };
    })
    .filter(Boolean);
}
