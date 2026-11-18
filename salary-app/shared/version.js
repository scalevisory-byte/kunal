/**
 * What version this is, and what changed in each one.
 *
 * Dinesh: *"version no and history bhi do jisse pata chale ki kya naya aaya
 * he"*. The build stamp beside the title already said WHICH FILE he had — it
 * could never say what was in it, so a feature that had shipped read as
 * missing more than once.
 *
 * Two different questions, so two different answers, and both are shown:
 *
 *   **The version** says which release this is. It is written by hand,
 *   because "is this a small fix or a new module" is a judgement and not
 *   something a build script can work out.
 *
 *   **The build stamp** says which copy of that release you are looking at.
 *   Two people can hold the same version built at different minutes, and when
 *   an update does not seem to have taken, that is the figure that settles it.
 *
 * The entries are written for the office, not for the code: what somebody can
 * now do that they could not before. Anything that moved money says so.
 */

export const VERSION = '1.17.0';

/** Newest first. The first entry is what `VERSION` names. */
export const CHANGELOG = [
  {
    version: '1.17.0',
    date: '18 Nov 2026',
    title: 'Asset groups — Computer, Furniture, Mobile',
    items: [
      '**Groups above the register**, each button carrying its own count: Furniture 369, Computer 264, Electrical 130, Mobile 123, Office equipment 67, Security 27, Network 18. Press one to see only those. The group also shows under every name and is a column in the CSV.',
      '**A group is worked out from the kind, never stored beside it.** Correct a chair’s kind and it moves group by itself, and the Group column can never disagree with the Kind next to it.',
      '**457 of your 1,004 assets were landing in “other”.** The app only knew eight kinds. It now knows the words your own list uses — LIGHT, MOUSE, CALCULATOR, KEYBOARD, STORAGE, CCTV, AC, PENDRIVE, WI-FI DONGAL, FREEDGE, ALMARI and the rest, spelt as you spell them. **Six are left**, and they are shown as Other rather than guessed at.',
      'Fixed on the way: a two-letter kind was being matched inside longer words, so RACK, BLACK BOARD and every ACCESS POINT were being filed as air conditioners. A kind now has to match a whole word.',
    ],
  },
  {
    version: '1.16.0',
    date: '17 Nov 2026',
    title: 'Your own asset list, imported as it is written',
    items: [
      '**The asset import now reads your sheet’s own words.** Asset ID, Item Name, **Modal**, assignee, seat No., Room, Purchased Date, **Warenty date**, Purchase Invoice and location were all being thrown away because the importer only knew the textbook spellings. A column is matched on what it SAYS, not on what it should have said.',
      '**Model, location, room and condition now come across**, so the register holds what your list holds.',
      '**An empty cell written as “-” is read as empty.** Five hundred and fifty assets were about to arrive with a condition of “-” and a vendor of “-” — worse than blank, because a blank says “not recorded” and a dash says it confidently.',
      '**Status is carried only where it cannot be worked out.** In Repair and Retired are stored; Available and Allocated are not, because the register already knows who holds what and a second opinion drifts.',
      '**A 15-digit IMEI in a plain Excel cell is destroyed by Excel before the file reaches us** — it saves 3.52E+14. Two of your phones had been rounded to the same number, so one was being skipped as a duplicate: a real asset silently missing. Those rows are now named and imported **without** a serial rather than with a wrong one. On your list that is 20 assets that would have gone missing.',
      '**Brackets in a code no longer stop the file.** “BNF-AST-Big Storage (Almari)-0006” threw, and the import died at 998 of 1,004 with no report of what was lost. A code is now tidied (that one becomes BNF-AST-BIG-STORAGE-ALMARI-0006) and **one bad row can never take the file down** — every other row still goes in and the failures are named by row and reason.',
      'Driven against your real 1,008-row list: 1,004 in, 2 genuine repeats passed over, every column read.',
    ],
  },
  {
    version: '1.15.0',
    date: '17 Nov 2026',
    title: 'People who have left come off the attendance grid',
    items: [
      '**Untick Active and they leave the month too.** Opening a month puts every active employee on the sheet, and until now the row just stayed once somebody left — so they were gone from the staff list and the Excel and still sitting on the attendance grid. Re-opening the month now takes them off.',
      '**Unless something is recorded against them.** Somebody who left on the 10th is owed ten days, and their row carries the marks that pay them. A row with attendance, a typed-over figure, an addition, a deduction, a remark or a payment against it is never thrown away — only a row with nothing on it, where there is nothing to lose.',
      'When such a row does stay, the grid now says **· left** beside the name, so a name the Employees tab says is gone reads as money still to pay rather than as a fault.',
      '**A closed month is never rewritten** — it sits behind a PF return and a payslip somebody is holding.',
      'Somebody who comes back is simply put on again.',
    ],
  },
  {
    version: '1.14.2',
    date: '16 Nov 2026',
    title: 'Deleting an employee added by mistake',
    items: [
      'The **Delete** button on an employee row now **counts before it asks**. "Delete X and all their payroll history?" was true and no use: somebody added by mistake this morning and a cashier of four years read identically. It now names the months of payroll, the days of attendance, the documents and the loans that would go — and for a wrongly added person it says **"Nothing is recorded against them"**, which is the answer.',
      '**A closed month refuses.** Somebody paid in a locked month is filed behind a PF return and a payslip they are holding, so deleting them would rewrite a figure already reported. Set their status to **Left** instead. An open month does not block — that is where a mistake sits.',
      'Anyone **reporting to them** is counted and named. They are left without a manager, never deleted alongside.',
      'Fixed: deleting an employee used to leave their PAN, Aadhaar and photograph on the disk with nothing pointing at them. The same hole the candidate delete had.',
      'Saying no no longer flashes an error — changing your mind is not a fault.',
    ],
  },
  {
    version: '1.14.1',
    date: '16 Nov 2026',
    title: 'Delete, beside Archive',
    items: [
      '**Delete** on the candidate row, next to Archive. It says what goes before it asks — the whole file, and the CV and documents off the disk — and it cannot be undone.',
      '**Somebody on the payroll is refused**, and told to archive instead. Their hiring record is how that appointment is explained: what was agreed, who approved it, what they were told. Archive hides them; this would destroy that while they carry on drawing a salary.',
      'Archiving is not a lock — an archived person can still be deleted. Only the payroll stops it.',
      'Fixed: deleting used to leave the uploaded documents on the disk with nothing pointing at them. A folder of strangers’ Aadhaar cards that nobody can account for.',
    ],
  },
  {
    version: '1.14.0',
    date: '15 Nov 2026',
    title: 'A candidate’s whole file, and an archive to put it in',
    items: [
      '**Everything, in order** — a candidate’s whole story on one page, oldest first: added, applied, screened, paper drawn, paper sat (with the answer sheet on the line), each interview round, the offer, the day they went on the payroll.',
      '**The particulars form and the interviewer’s rating are READ on the record**, not downloaded. They were printable from the Interviews tab and nowhere else, which meant finding the same interview twice.',
      '**Documents** — anything a candidate handed over: Aadhaar, PAN, a marksheet, the last payslip. The file sits on disk behind a link that expires, never in the database or an export, and the name they gave it never becomes a path. **Nothing is required** — a candidate owes you nothing, and the KYC list starts on their employee record.',
      '**Filter the candidate list by where they are** — Selected, Rejected, Shortlisted, Joined and the rest.',
      '**Add to payroll is on the row**, instead of only on the pipeline card.',
      '**An archive.** Putting somebody on the payroll takes them off the hiring list by itself — they work here now. Nothing is deleted: the whole file stays and **Restore** brings them back in one press. You can archive anybody by hand, and **a rejection does not archive itself**, because turning somebody down for one opening is how the next opening finds them.',
      'The export carries the list you are looking at, archive included.',
      'Fixed: the story could come out in the wrong order by half a day. Two date formats meet on that page, and the older one was being read as local time when it was written as UTC — five and a half hours out on this server.',
    ],
  },
  {
    version: '1.13.0',
    date: '15 Nov 2026',
    title: 'Where the results are, and how a candidate’s record ends',
    items: [
      '**Test results** — a new panel on Screening & tests listing **every paper anybody has sat**, newest first. Search by name, mobile, job or test; narrow to Qualified / Not qualified / Flagged / Clean; **Export CSV**. The counts on the buttons say how many are in each pile.',
      'A result **stays on that list after the person is taken on or turned down**. The queue above it is a list of people still being hired, so a score used to disappear with them — and a score that disappears is not a record.',
      '**Flagged** says exactly what was recorded — left the test and for how long, copy/paste attempts, answers under two seconds, ran out of time. **Clean** is written out, never left blank: an empty cell reads as “nobody looked”.',
      'The **answer key never travels** to any of this. The flags are worked out on the server and only the finished words come back; the questions stay behind the one screen that shows them.',
      'On a candidate’s record, the interview history now **opens the particulars form and the evaluation** instead of only summarising them in a line.',
      '**Selected — the offer** is a new section on the record: designation, salary, joining date, department and place, the offer letter, and whether they are **on the payroll yet** — which is not the same question as whether they accepted. The record used to stop at the evaluation, which is exactly where the hiring gets decided.',
    ],
  },
  {
    version: '1.12.1',
    date: '15 Nov 2026',
    title: 'One question at a time reaches the paper you already had',
    items: [
      '**Your Accounts test was still showing all twenty questions on one page, and no update was going to change that.** Adding the one-at-a-time mode gave every paper made before it a column set to “all on one page”, and the only way out was a control in the question bank that there was no reason to look for. This update **moves every existing paper over by itself** — nothing to find, nothing to press.',
      'It runs **once**. If somebody later chooses to put a paper back on one page, that choice survives every update after it.',
      'A paper somebody is **sitting at that moment** is left alone, so the page cannot change shape under their hand. An **abandoned** attempt — a link opened for a look, a clock long run out — no longer counts as being sat, which is what was quietly protecting the wrong paper.',
      '**A link drawn before a paper was corrected now follows the correction.** The layout is fixed when the candidate presses Start, not when the link is made — so a paper fixed this morning reaches every link already sent out and not yet opened.',
      'The test card no longer says **“Sent”**. Drawing the paper and handing it over are two different things and only the first happens in here, so it reads **“Paper ready — not sat yet”** and the line underneath says **who drew it and when**.',
    ],
  },
  {
    version: '1.12.0',
    date: '15 Nov 2026',
    title: 'The test, built to your ZYNTA module’s own rules',
    items: [
      '**The question cannot be selected or copied**, and an attempt to copy, cut, paste or right-click is blocked **and counted**.',
      '**Leaving the test counts the seconds away**, not just the number of times — “2× left the test (35s away)” reads very differently from “2× left the test”. A tab switch and the window losing focus both count.',
      '**Closing the tab mid-test warns first.**',
      '**The flags now follow your ZYNTA wording exactly** — “2× left the test (35s away)”, “copy/paste attempts: 1”, “19 answers under 2s”, “3 questions unanswered / timed out”, “auto-submitted (time over)” — so the two screens cannot mean different things by the same words.',
      '**One quick answer is no longer flagged.** It takes half the paper, which is your rule and the right one: a single fast answer is somebody who knew it.',
      '**The candidate is shown their score** when they finish — never which answers were wrong, because the next person gets the same bank.',
      'Honest about the limit, in the app: these catch tab-switching, copy and paste, impossible speed and timeouts. They **cannot** catch a second phone or another person in the room. Treat a flag as a reason to ring somebody back, never as proof.',
    ],
  },
  {
    version: '1.11.3',
    date: '15 Nov 2026',
    title: 'The update now checks that the new server is the one answering',
    items: [
      '**This is why nothing changed all day.** An old copy of the server was still holding port 3002. The new one could not start, the old one kept answering — and because it reads the screens off disk, the dashboard showed the new version while everything behind it was three releases old.',
      'The update now **stops whatever else is holding the port**, not only the scheduled task.',
      'And it **reads the version back** from the server afterwards. “It answered” is not “the new one answered” — the old one answers just as happily, which is how this printed “Done” every time while changing nothing.',
      'If the old one is still there, the update now **says so and stops**, with the command to find it.',
    ],
  },
  {
    version: '1.11.2',
    date: '15 Nov 2026',
    title: 'The browser can no longer run yesterday’s app',
    items: [
      '**This is why the test page kept behaving like an old version even after the update.** The page that points at the app’s code could be kept by the browser (and by Cloudflare), so a tab went on running the build from three releases back while the server was new.',
      'That page is now **never cached**. The code files keep their long cache, which is safe — their name changes whenever they change.',
      '**A missing code file now says so** instead of quietly handing back the app, which is how a stale page failed strangely rather than loudly.',
      'After this update, a tab picks up a new version on its own. No more Ctrl+F5.',
    ],
  },
  {
    version: '1.11.1',
    date: '15 Nov 2026',
    title: 'A paper can be switched once nobody is sitting it',
    items: [
      '**Switching a paper to “one at a time” was refused if anybody had EVER sat it** — which locked the one paper you were trying to change. It is refused only while somebody is **sitting it right now**, because switching mid-test would reshape the page under them.',
      'A finished attempt is untouched either way: its questions and answers live on its own record, and the answer sheet does not report how the paper was laid out.',
      '**A link that was opened before the update will never show the start screen** — the old version started its clock the moment it was opened, and that cannot be undone. Draw a fresh paper for anybody in that position.',
    ],
  },
  {
    version: '1.11.0',
    date: '15 Nov 2026',
    title: 'The test screen, built to match ZYNTA',
    items: [
      '**A bar that drains for the question you are on**, with its seconds beside it, exactly as your ZYNTA test does. The clock at the top is now the whole paper’s time, where it belongs.',
      '**The topic above each question** — “Q2 / 20 · ACCOUNTS” — so somebody knows what is being asked about before they read it.',
      '**Next →** rather than a tap that jumps: pick your answer, then move on. How far through you are runs along the bottom.',
      '**Leaving the test page is recorded**, with a red line when they come back — “You left the test, this has been recorded. Please carry on.” It is never refused: a phone rings, and blocking would fail the honest candidate.',
      '**How long each question took is kept.** The result now shows the **average seconds a question**, and flags a paper **“Worth a look”** when they left the page, when questions timed out unanswered, or when answers came in under two seconds. A clean paper says **“Clean”**.',
      'Every one of those is a **flag, not a verdict** — a fast answer can be a known answer. Nothing fails anybody, and none of it is shown to the candidate.',
      '**Open /healthz and it says which version is running** — no signing in. Three afternoons went on “is the update actually installed?”, and that question now has a one-click answer.',
    ],
  },
  {
    version: '1.10.2',
    date: '15 Nov 2026',
    title: 'Papers made on an older version catch up',
    items: [
      '**A paper made before the one-at-a-time mode existed stayed in the old shape**, and pressing “Add starter questions” again said “already there” and changed nothing — so the test still came out all on one page. A starter paper **nobody has sat** is now brought up to date: one question at a time, 30 seconds each. Its sections are left exactly as they are, in case you had tuned them.',
      '**A paper somebody has already sat never changes** — a test taken under one set of rules has to keep them, or the answer sheet and the test stop describing the same thing. Make a new paper instead.',
      '**The papers list says how each one is put** — “All on one page” or “One at a time · 30s each”. It was only visible inside Edit, so two papers that behave completely differently looked identical.',
      '**One press switches a paper**, from that same list. It is refused, with the reason, on a paper somebody has sat.',
    ],
  },
  {
    version: '1.10.1',
    date: '15 Nov 2026',
    title: 'The clock starts when they press Start',
    items: [
      '**Opening the link no longer spends the test.** It used to start the clock the moment the page loaded — tap it on a bus to see what it is, come back later, and the time had gone. Now opening shows a page saying how many questions, how long, and that there is no going back, with a **Start the test** button. Nothing runs until that is pressed.',
      '**The questions are not even sent until they start**, so they cannot be read ahead of the clock.',
      '**A reload no longer loses their answers.** With one question at a time a phone reloading the page used to put somebody back on question one with nothing recorded while the paper’s clock carried on. It now picks up where they were.',
      'Looking at the link twice still does not start it, and starting twice does not put the clock back up.',
      '**“Another paper”** on somebody who has already sat one — for a phone that died mid-test. It asks first, the old attempt and its answer sheet stay on record, and the new paper draws different questions.',
    ],
  },
  {
    version: '1.10.0',
    date: '15 Nov 2026',
    title: 'The test runs one question at a time, like ZYNTA',
    items: [
      '**One question on the screen, each with its own clock.** When the seconds run out the next one comes up by itself — there is no going back, because that question’s time is spent.',
      'Answering also moves straight on, so somebody can go faster than the clock but never slower.',
      'The big number is **that question’s seconds**; the whole paper’s time stays under it in small type.',
      'A question the clock ran out on counts as **not answered** — nought marks and no penalty, never a wrong answer.',
      '**It is set per paper, not app-wide**, so a paper somebody is halfway through cannot change shape under them. Screening → Questions and papers → the paper → “How it is put to them”.',
      'The ready-made paper is set this way: **20 questions, 30 seconds each, 10 minutes**.',
      'Said plainly on the office screen: the per-question clock **paces** the test, and the whole-paper total is what is actually checked by the server.',
      'On the interview row, “Form” now reads **“Their form”** — it is the candidate’s, and it carries ● when they have sent it back and nobody has read it yet.',
    ],
  },
  {
    version: '1.9.2',
    date: '15 Nov 2026',
    title: 'The test lives inside Screening, and the link stays put',
    items: [
      '**The Tests tab is gone — it is inside Screening now.** The tab reads “Screening & tests”, and the question bank sits folded at the bottom of that page, under the day’s work.',
      '**The link no longer disappears.** Sending somebody a paper used to take them off the list and take the link with them, so there was no way back to it. The list now shows the whole stage: **not sent yet** (pick a paper and send it), **sent** (Copy link / Send on WhatsApp, any time until they sit it), and **done** (the score and the answer sheet).',
      'It is always the **same link**, never a fresh paper — a second one would let somebody read the questions, close it, and start again.',
      'The page runs in the order you work it: screen them, test them, then the questions and papers underneath.',
      'The screening figures read properly — “0 waiting to be screened” rather than “0waiting”.',
    ],
  },
  {
    version: '1.9.1',
    date: '15 Nov 2026',
    title: 'The hiring tabs run in the order the work happens',
    items: [
      '**Screening now comes after Candidates**, not before Vacancies. The strip reads Overview · Pipeline · **Vacancies · Candidates · Screening · Tests · Interviews** · Reports · Follow-ups — post the opening, take the applications, screen them, test them, interview them.',
      'Overview and Pipeline stay in front because they are where you look, not steps; Reports and Follow-ups sit at the end because they run across all of it.',
      '“How an interview goes” now sends you to **Screening → “Eligible — ready for the test”** for the test step, and names the department head in step 7.',
    ],
  },
  {
    version: '1.9.0',
    date: '15 Nov 2026',
    title: 'The four gaps in the hiring flow',
    items: [
      '**The department head now sits between HR and management.** Submit → HR → department head → Management → Approve, exactly as your flow has it. It is **optional** — HR can still send it straight to management, because not every seat needs the head’s eye.',
      'Sending it to the head **asks who it is going to**, and that name is kept in its own place along with when they passed it on — so “who saw this” has an answer even after three more people have touched it. There are no department-head logins, so the name is typed: the app records who it went to, it does not police who clicks.',
      '**Employee codes are generated.** “Add to payroll” now shows the next free code for that company — BPL-001, SCA-014 — before you press it. Change it if you number people your own way. **A number is never reused**, so a leaver’s code can never land on a new joiner.',
      '**“Eligible — ready for the test”** is a list on the Screening page. Marking somebody Eligible used to take them off the screen, so sending the test meant hunting for them under Candidates. Now the next step stands where the decision was made, with the paper picker and a WhatsApp button on the row.',
      '**The interview panel can be typed.** The interviewer box is editable on the row and there is a second box beside it for everybody else who was in the room.',
    ],
  },
  {
    version: '1.8.3',
    date: '15 Nov 2026',
    title: 'The evaluation tells you why Submit will not work',
    items: [
      '**The two questions are asked separately now.** “What do you recommend?” and “And what should happen next?” used to be two rows of buttons under one heading with nothing to tell them apart — pick a recommendation and the section looked answered, but the row below was a different question.',
      'The unanswered one is marked **still to answer** right where the answer goes.',
      '**A greyed-out Submit says why**, in red beside the button: “Can’t submit yet — …”, and it lists **everything** it is waiting on, not one reason at a time.',
      'Nothing about who can do what has changed — the evaluator’s name is still required and typed, and a recommendation is still not a selection.',
    ],
  },
  {
    version: '1.8.2',
    date: '14 Nov 2026',
    title: 'The test result, the answer sheet, and one candidate’s whole file',
    items: [
      '**Send the test link from the candidate** — open them, and every test they have been given is listed with a WhatsApp button and a Copy link beside it. It sends the SAME link, never a new paper, so nobody can look at the questions and then sit a fresh one.',
      '**The result is on the candidate now** — the score, right, wrong and how many were left blank, for every test they have sat.',
      '**The whole answer sheet** — every question, what they chose, what the right answer was, and which topic it came from, with a line per topic so you can see they got the accounts questions right and lost the English ones. Narrow it to just the wrong ones, or just the blanks.',
      '**“Print the whole file”** at the top of a candidate — ONE document carrying the screening, each round’s particulars form, the interviewer’s evaluation, every answer sheet and the offer. Opens on any machine and prints to PDF, for when the boss wants to see the file.',
      'The CV downloads beside it as its own file. A CV is a PDF or a Word document and cannot be put inside a printed page — the file names it rather than leaving a blank page where it should be.',
      'The file also names what is **missing** — “evaluation: not written up” — because a pack that quietly leaves a section out reads as a complete file.',
      'A question nobody answered is shown as **not answered**, never as a wrong answer. They are different facts about a candidate.',
    ],
  },
  {
    version: '1.8.1',
    date: '14 Nov 2026',
    title: 'A test that is ready to give on the first day',
    items: [
      '**Sixty-four questions come with the app.** Tests → “Ready-made questions” fills the bank in one click: general aptitude, computer knowledge, email and internet, and English, plus ten each for Travel Consultant and Accounts.',
      '**The paper is set up for you too** — twenty questions, fifteen general and five for the seat being hired for, at about thirty seconds a question, so ten minutes in all. Pass mark 50%.',
      '**Pressing the button twice is safe.** It only adds what is missing, matched on the question, so a question you have reworded is never put back the way it was. Every one of them is yours to edit or remove.',
      'The clock runs on the whole paper, not on each question — the candidate’s screen says so, so nobody rushes an answer thinking they are about to be cut off.',
      'Each candidate still gets a **different draw and a different order of answers**, and the answer key never reaches their screen.',
    ],
  },
  {
    version: '1.8.0',
    date: '15 Nov 2026',
    title: 'The candidate fills their own form in, and it prints properly',
    items: [
      '**Send the candidate the interview form before they come in.** A link on the interview row — they fill in their own particulars on their phone, and you are not typing it while they sit opposite.',
      'That form carries **no decision and no interviewer notes** any more. It is filled in before the interview, by the candidate, so a verdict could not belong on it. Everything the interviewer judges is on the evaluation.',
      'A **declaration** at the bottom — the candidate ticks that what they have given is true before it sends.',
      '**A candidate cannot touch a decision.** Their page is built from a list of what they may write; anything else they send is dropped, and the decision, the notes and the whole evaluation are never even sent to them.',
      '**Print or save as PDF, properly.** The form and the evaluation each download as a complete document with every section open. The old Print button printed only the sections that happened to be expanded.',
      '**The evaluator’s name is now required and typed.** It is not taken from the login — the office signs in as one or two people and the person in the room is often neither.',
      '**Languages are ticked, not picked from a list** — it was a dropdown, so only one could be chosen and it did not save as a list at all. Every short list on these forms is ticks now.',
      '**Delete a duplicate.** An interview booked twice can be removed; one that has been written up is cancelled instead, which keeps the record.',
      'A screening, a draft form, a draft evaluation and a draft offer can all be undone. Anything decided is withdrawn or re-decided, never deleted.',
      '**The screening verdict is on the candidate list** — Eligible, On hold or Not eligible without opening anybody. A hold or a rejection still asks why.',
      'An **age range** on the opening, and **date of birth and address** on the application form — the screening report works their age out from it.',
      '**“How an interview goes” on the Interviews tab** — the nine steps in order, each naming the tab and the click, and what that step does NOT do. Fold it away once you know it.',
      '**A form a candidate sends back announces itself.** The overview says how many are waiting to be read and names them, and the interview row’s button changes to “Read what they sent”.',
    ],
  },
  {
    version: '1.7.0',
    date: '15 Nov 2026',
    title: 'Hiring: screening, interview forms, tests and the offer letter',
    items: [
      '**Screening** — a tab of its own. Mark somebody Eligible, On hold or Not eligible, with the reason. A hold keeps them exactly where they are; a rejection has to say why, because that is what the rejection report counts.',
      'Beside each name, how they measure against what the opening asked for — age, experience, expected salary, skills. **It is advice, not a gate**: you can take somebody who misses every line of it.',
      'Somebody who told us nothing shows a dash, never a cross. Nobody asked, so nothing failed.',
      'The screening list is **oldest first**, so a merely good candidate from three weeks ago is not left at the bottom until they take another job.',
      '**A candidate can be put forward for an opening from their own record** — the picker is on their card, where you are already standing.',
      '**The physical interview form**: who they are, qualifications, experience, languages, computer knowledge, ten questions, salary and joining, address and references. No ratings — it records what was said.',
      'A date of birth or an address corrected during an interview is corrected **on their record**, not just on that form. Three rounds cannot produce three addresses.',
      '**The interviewer’s evaluation** is a separate form: ten things rated 1–5 with remarks, practical knowledge, strengths and concerns, a recommendation and what should happen next.',
      'The score counts **what you rated, not all ten** — rating three is 12 out of 15, not 12 out of 50 — and nothing anywhere uses the score to decide.',
      '**A recommendation is not a selection.** Submitting an evaluation sends the paperwork to HR or management and moves the candidate nowhere. Only an approval moves anybody, and approving is an Admin’s.',
      'Every round keeps its own form and its own evaluation. Nothing is overwritten, and the whole history is on the candidate’s record.',
      '**Tests of our own** — a question bank by position, and papers that say how many to draw from each. Every candidate gets a **different selection, in a different order, with the options shuffled**.',
      'The candidate sits it from a link on their phone. Timer, auto-submit when the time runs out, and the score works itself out. **The right answer never reaches their browser.**',
      'A question you leave blank costs you nothing extra — negative marking is there to discourage guessing, not to punish an honest blank.',
      'The ZYNTA test is untouched. An opening uses its own link or draws from the bank.',
      '**The offer letter** — one self-contained file per person, opens on any phone with no login, prints to PDF.',
      '**There is no letter until somebody has approved the offer**, and approving is an Admin’s. An approved offer is locked: changing it means withdrawing it.',
      'Approving tells the candidate nothing — only marking it sent moves them to Offer Sent. A decline is recorded as a decline, so “we turned them down” and “they turned us down” never get counted as the same thing.',
      '**Eleven recruitment reports** — the interview schedule, today’s and upcoming interviews, interviews completed, selected, on hold, rejected, next round pending, interviewer-wise, the funnel and time to hire. Filter them, print them, export them to Excel.',
      'Nothing in a report is worked out twice. Every figure was decided on another screen and stored, so a report can never disagree with the screen it came from.',
      '**“Where they are” on the candidate list is now the way in** — click it to open the application, where Move, Screening, the offer and scheduling an interview all live.',
      'The application card reads in the order the work happens: Move, Screening, Interviews, Offer — then the payroll and the history. Payroll used to be the second thing on the page.',
    ],
  },
  {
    version: '1.6.0',
    date: '14 Nov 2026',
    title: 'Logins, leave approvals and working from home',
    items: [
      'A new sign-in screen, with show/hide password and "remember me". Nothing about how signing in works has changed.',
      'Staff can apply to **work from home**. It is paid in full and uses no leave.',
      'A **manager approves their own team** from their own login — and the office then confirms it. Nothing reaches attendance until the office has.',
      'A manager sees only their own team: names and what they asked for, never salaries.',
      'Rejecting ends it there. A refusal costs nothing and does not need confirming twice.',
      'Staff can now take back a request from their own login, until the office approves it.',
      'The dashboard line saying people are waiting now opens the approvals queue, instead of the People tab.',
      'The Approve button no longer sits off the edge of the screen on a laptop.',
      'Searchable **Help** inside the app, and this list.',
    ],
  },
  {
    version: '1.5.0',
    date: '14 Nov 2026',
    title: 'Live on the web, Excel in and out, and the eSSL file',
    items: [
      'The HRMS is reachable at its own address over the internet, on its own tunnel.',
      'Reads the **eSSL "Basic Work Duration"** export, clock times and all. A day the machine has no record of is named, not written through as absence.',
      'Fixed: a day the clock calls a half day but the machine marked present was paid in full. **This was costing real money** — 149 hours in one fortnight.',
      'The **staff list** out to Excel and back, as one file, for bulk updates.',
      'The **month’s attendance** out to Excel and back.',
      'The lunch break can be recorded without being deducted.',
      'Every setting in one place under Settings, including the usual day and what it adds up to.',
      'The build stamp carries the time, not just the date.',
    ],
  },
  {
    version: '1.4.0',
    date: '13 Nov 2026',
    title: 'The dashboard rebuilt, and the asset register finished',
    items: [
      'The dashboard opens on a daily roll call: who is in, who is out, who is late, who is on overtime.',
      'A day-by-day attendance trend, and attendance by department.',
      'The morning register gained code, department, hours, search, sort and a file.',
      'Four "needs attention" lines were being worked out and never shown. They are on the page now.',
      'Two dashboard figures were simply wrong and are corrected.',
      'Assets: a way in for "add an asset", somewhere to type the AMC, and a stock take that fits on screen.',
    ],
  },
  {
    version: '1.3.0',
    date: '1 Nov 2026',
    title: 'A real HRMS: logins, people registers, assets, hiring',
    items: [
      '**Real logins** with three office roles — Admin, HR, Viewer — and a login for every employee.',
      'Staff can see their own pay, attendance and payslip, and apply for leave.',
      '**Punching from a phone**, with a location fence, and corrections that need approving.',
      '**Salary structure** — Basic, HRA, conveyance, medical. It never changes what anybody is paid.',
      'PF, ESI and PT **worked out from the rules** rather than typed. Nothing switches itself on.',
      'Warnings and appreciations, appraisals, expense claims, staff tasks, a helpdesk, exits and full-and-final.',
      'The **asset register**: codes, printable labels, handovers, a stock take, and maintenance.',
      'Late in and early out, with a 300-minute monthly concession that can be priced before it is switched on.',
      'Weekly off (alternate Saturdays included) and sandwich leave.',
      'Hiring moved inside the HRMS — a person who joins becomes an employee without being typed twice.',
      'Reporting manager, employee documents and KYC, and a change history on every record.',
      'A per-employee report: one person down the months.',
      'An absent/present report, and a joining checklist for new staff.',
    ],
  },
  {
    version: '1.2.0',
    date: '7 Oct 2026',
    title: 'The monthly report pack',
    items: [
      'The three sheets that actually go out each month, in the office’s own layout: bank, cash, and Sunday + festival.',
      'Checked against the real September files — every row matches on gross and net.',
      'The grids were made to look like a spreadsheet: gridlines, row numbers, and the cell IS the input.',
    ],
  },
  {
    version: '1.1.0',
    date: '1 Sep 2026',
    title: 'Hours, and the first dashboard',
    items: [
      'The **Time tab**: in, lunch out, lunch in, out — and the hours become money through the same column the sheet already paid from.',
      'A dashboard, with the month’s figures and what needs attention.',
      'New joinees, birthdays and work anniversaries.',
      'Festivals know which religion they belong to, so a festival never silently applies to nobody.',
    ],
  },
  {
    version: '1.0.0',
    date: '31 Aug 2026',
    title: 'The salary sheet, as software',
    items: [
      'The April sheet’s calculation, column by column, so the app and the sheet cannot disagree.',
      'Attendance by name rather than by code, with paid and unpaid leave added.',
      'Short hours by the minute, per day.',
      '26 working days every month, fixed.',
      'Sunday pay in its own register, settled apart from the month.',
      'Festival holidays that are paid for some staff and a working day for others.',
      'Leave balances, loans and advances, and the PF/ESI/PT registers.',
      'Imports the sheet and exports it back; also builds as one file that runs with no server at all.',
    ],
  },
];

/** The entry `VERSION` names, for the line at the top of the panel. */
export const CURRENT = CHANGELOG[0];

/**
 * Everything newer than the version somebody last looked at.
 *
 * Used for the "new" dot. An unknown or missing `seen` means they have never
 * opened the panel, which is NOT the same as having seen everything — so it
 * returns the lot rather than nothing.
 */
export function since(seen) {
  if (!seen) return CHANGELOG;
  const at = CHANGELOG.findIndex((entry) => entry.version === seen);
  return at < 0 ? CHANGELOG : CHANGELOG.slice(0, at);
}

/** Is there anything they have not read? */
export const hasNews = (seen) => since(seen).length > 0;
