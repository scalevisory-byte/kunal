import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from './config.js';
import { log } from './logger.js';
import { today, todayLong, normalizeDueDate } from './dates.js';
import { isoAtLocal } from './quickparse.js';
import { recordUsage } from './db.js';

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

const ExtractionSchema = z.object({
  tasks: z.array(
    z.object({
      source_index: z
        .number()
        .describe('Index of the message in the numbered list this task came from.'),
      title: z.string().describe('Short imperative summary, max ~80 characters.'),
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

function renderBatch(messages) {
  return messages
    .map((m, i) => {
      const where = m.is_group ? `group "${m.chat_name}"` : `chat with ${m.chat_name}`;
      return [
        `[${i}] from: ${m.contact_name || m.contact_number || 'unknown'} (${where})`,
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

  const intro = [
    `Current date: ${todayLong()} (${today()}), timezone ${config.timezone}.`,
    '',
    `Here are ${messages.length} incoming WhatsApp message(s). Extract the actionable tasks.`,
    '',
    renderBatch(messages),
  ].join('\n');

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
  try {
    const response = await anthropic().messages.parse({
      model: config.model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content }],
      output_config: { format: zodOutputFormat(ExtractionSchema, 'extracted_tasks') },
    });
    parsed = response.parsed_output;
    const usage = response.usage || {};
    // Recorded per call, so spend is measured rather than guessed at later.
    recordUsage({
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

  if (!parsed?.tasks?.length) return [];

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
        contact: task.contact?.trim() || source?.contact_name || source?.contact_number || null,
        chat_name: task.chat_name?.trim() || source?.chat_name || null,
        chat_id: source?.chat_id ?? null,
        message_id: source?.id ?? null,
        source: 'whatsapp',
        origin: 'ai',
        due_date: dueDate,
        due_at: remindAt,
        priority: task.priority,
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
