import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { config } from './config.js';
import { log } from './logger.js';
import { today, todayLong, normalizeDueDate } from './dates.js';
import { isoAtLocal } from './quickparse.js';

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
        .describe('One or two sentences of context. Empty string if none is needed.'),
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
- due_date: only when the message states or clearly implies one. Resolve relative words
  ("today", "tomorrow", "by Friday", "month end") against the current date given below,
  and output YYYY-MM-DD. If there is no date signal, use an empty string. Do not guess.
- remind_time: only when a clock time is actually stated ("10 baje", "by 5pm",
  "subah 9 baje"). Give it as HH:MM in 24-hour form. Empty string if no time is
  mentioned - do not invent one just because there is a date.
- priority: "high" for money, legal/statutory deadlines, travel about to happen, or an
  explicitly urgent ask; "low" for vague or nice-to-have; "medium" otherwise.
- source_index must be the index of the message the task came from.
- If nothing in the batch is actionable, return an empty tasks array. That is a normal,
  expected outcome - do not invent tasks to fill the list.`;

function renderBatch(messages) {
  return messages
    .map((m, i) => {
      const where = m.is_group ? `group "${m.chat_name}"` : `chat with ${m.chat_name}`;
      return [
        `[${i}] from: ${m.contact_name || m.contact_number || 'unknown'} (${where})`,
        `    sent: ${m.sent_at}`,
        `    text: ${m.body}`,
      ].join('\n');
    })
    .join('\n\n');
}

/**
 * Send a batch of buffered messages to Claude and return normalized task rows.
 * `messages` are message records as stored in the `messages` table.
 */
export async function extractTasks(messages) {
  if (!messages.length) return [];

  const userContent = [
    `Current date: ${todayLong()} (${today()}), timezone ${config.timezone}.`,
    '',
    `Here are ${messages.length} incoming WhatsApp message(s). Extract the actionable tasks.`,
    '',
    renderBatch(messages),
  ].join('\n');

  let parsed;
  try {
    const response = await anthropic().messages.parse({
      model: config.model,
      max_tokens: 8000,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userContent }],
      output_config: { format: zodOutputFormat(ExtractionSchema, 'extracted_tasks') },
    });
    parsed = response.parsed_output;
    log.info(
      `Claude extraction: ${messages.length} message(s) -> ${parsed?.tasks?.length ?? 0} task(s)` +
        ` (in ${response.usage.input_tokens} / out ${response.usage.output_tokens} tokens)`
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
        due_date: dueDate,
        remind_at: remindAt,
        priority: task.priority,
        status: 'open',
      };
    })
    .filter(Boolean);
}
