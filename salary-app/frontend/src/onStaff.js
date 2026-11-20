/**
 * THE PEOPLE YOU CAN STILL CHOOSE.
 *
 * Dinesh: *"exited employee abhi bhi dikha rahe he current list me / agar
 * employee exited he to o current list me nahi aana chahiye"*.
 *
 * Every "pick somebody" box in this app listed the whole master, leavers
 * included — so a laptop could be issued to somebody who left in August, a
 * warning written against them, a loan given, a licence seat handed over.
 *
 * THE LINE THIS DRAWS, and it is the reason it is a helper and not a delete:
 * somebody who has left disappears from the lists you choose FROM, and stays
 * in every list of what already happened. Their old warnings, the asset they
 * never returned and the loan still outstanding are facts, and a settlement
 * is worked out from exactly those. Hiding them would lose money, not tidy it.
 */
export const onStaff = (employees = []) => employees.filter((e) => e.active);

/** How many are no longer on the list, for a line that says so. */
export const leftCount = (employees = []) => employees.filter((e) => !e.active).length;
