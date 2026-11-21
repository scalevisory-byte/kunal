/**
 * THE EXIT, AS THE FIVE STEPS IT ACTUALLY IS.
 *
 * Dinesh: *"Employee exit procedures banavo proper"*. Every part of it
 * existed — the resignation, the date, the clearance list, the settlement,
 * and now the letters — but they were five cards down one long page, so
 * there was no way to look at somebody and say where they had got to, or
 * what was holding them up.
 *
 * It computes NOTHING of its own: each step reads the record that owns it.
 * A strip that worked out its own idea of "cleared" would be a sixth
 * opinion, and the first one to go stale.
 */
export function exitSteps({ exit = null, clearance = null, settlement = null } = {}) {
  const recorded = Boolean(exit);
  const dated = Boolean(exit?.last_working_day);
  const cleared = Boolean(clearance?.ready);
  const settled = Boolean(exit?.settled_on);

  const steps = [
    {
      key: 'resignation',
      step: 1,
      label: 'Resignation recorded',
      done: recorded,
      why: recorded
        ? [exit.type, exit.resigned_on ? `told us ${exit.resigned_on}` : ''].filter(Boolean).join(' · ')
        : 'how they went, and when they told you',
    },
    {
      key: 'notice',
      step: 2,
      label: 'Last working day',
      done: dated,
      why: dated
        ? `${exit.last_working_day}${
            settlement?.notice?.known
              ? ` · notice ${settlement.notice.served}/${settlement.notice.required}`
              : ''
          }`
        : 'until this is set, nothing else can be finished',
    },
    {
      key: 'clearance',
      step: 3,
      label: 'Handover and clearance',
      done: cleared,
      /*
       * "Not ready" is never "refused": the checklist says what is open and
       * somebody decides. A system that will not let a payment through gets
       * worked around with cash nobody records.
       */
      why: !clearance
        ? 'IT, accounts, store, manager, HR'
        : clearance.ready
          ? 'everything signed and nothing outstanding'
          : `${clearance.outstanding} still open — ${(clearance.blocking || []).join(', ')}`,
    },
    {
      key: 'settlement',
      step: 4,
      label: 'Full and final',
      done: settled,
      why: settled
        ? `settled ${String(exit.settled_on).slice(0, 10)}`
        : 'the last month, leave encashed, gratuity, what is to be recovered',
    },
    {
      key: 'letters',
      step: 5,
      label: 'Relieving and experience letters',
      /*
       * Marked done only once the settlement is paid, because that is when
       * the relieving letter may say the dues are cleared - which is the
       * sentence the next employer reads it for.
       */
      done: settled && dated,
      why: !dated
        ? 'needs a last working day'
        : settled
          ? 'ready to print, dues settled'
          : 'can be printed, but it will not say the dues are settled',
    },
  ];

  const at = steps.find((s) => !s.done) || null;
  return {
    steps: steps.map((s) => ({ ...s, current: s.key === at?.key })),
    at: at?.key || 'done',
    done: steps.every((s) => s.done),
  };
}
