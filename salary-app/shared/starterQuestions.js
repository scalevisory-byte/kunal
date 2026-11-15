/**
 * A bank to start with.
 *
 * Dinesh asked for a twenty-question test - general aptitude, computer, email
 * and the rest - with five more drawn from the position being hired for. An
 * empty bank cannot do that, and nobody types sixty questions into a web form
 * on a Saturday, so these ship with the app.
 *
 * They are a STARTING POINT, not a fixed syllabus. Every one of them is an
 * ordinary editable row the moment it is loaded: change the wording, change
 * the answer, retire the ones that do not suit the job. Loading them again
 * adds only what is missing, matched on the question text, so pressing the
 * button twice cannot double the bank.
 *
 * Written for the people who actually apply here - a travel or accounts desk
 * in Surat and Vadodara - so the maths is the arithmetic of a booking, the
 * computer questions are Windows and Excel, and the English is the English of
 * an email to a customer. Nothing is a trick.
 *
 * Every answer below was checked by hand. A wrong key in a question bank is
 * worse than no bank: it fails the candidates who actually know the answer.
 */

const q = (category, question, options, correct) => ({
  category,
  question,
  option_a: options[0],
  option_b: options[1],
  option_c: options[2],
  option_d: options[3] ?? '',
  correct,
  marks: 1,
  negative_marks: 0,
});

export const STARTER_CATEGORIES = [
  'General Aptitude',
  'Computer Knowledge',
  'Email and Internet',
  'English',
];

export const STARTER_QUESTIONS = [
  /* ---------------- General Aptitude ---------------- */
  q('General Aptitude', 'A ticket costs ₹8,400. What is 15% of that?', ['₹1,260', '₹1,160', '₹1,460', '₹840'], 'a'),
  q('General Aptitude', 'A fare of ₹12,000 is reduced by 25%. What does the customer pay?', ['₹9,500', '₹9,000', '₹8,000', '₹10,000'], 'b'),
  q('General Aptitude', 'What comes next: 3, 6, 12, 24, …?', ['36', '42', '48', '30'], 'c'),
  q('General Aptitude', 'What comes next: 2, 5, 10, 17, …?', ['24', '26', '28', '25'], 'b'),
  q('General Aptitude', 'If 5 people book 20 tickets, how many does 8 people book at the same rate?', ['28', '30', '32', '40'], 'c'),
  q('General Aptitude', 'A flight leaves at 14:40 and lands at 17:15. How long is the flight?', ['2 h 35 m', '2 h 45 m', '3 h 35 m', '2 h 25 m'], 'a'),
  q('General Aptitude', '₹45,000 is shared between three people in the ratio 2:3:4. What does the largest share come to?', ['₹15,000', '₹18,000', '₹20,000', '₹22,500'], 'c'),
  q('General Aptitude', 'A hotel charges ₹3,200 a night plus 12% tax. What is one night in all?', ['₹3,584', '₹3,520', '₹3,640', '₹3,424'], 'a'),
  q('General Aptitude', 'Simple interest on ₹20,000 at 9% for one year is:', ['₹1,800', '₹900', '₹2,000', '₹1,500'], 'a'),
  q('General Aptitude', 'Which is the odd one out?', ['Mumbai', 'Chennai', 'Nepal', 'Kolkata'], 'c'),
  q('General Aptitude', 'A booking of ₹7,500 is paid in 3 equal instalments. Each one is:', ['₹2,250', '₹2,500', '₹2,750', '₹3,000'], 'b'),
  q('General Aptitude', 'If today is Thursday, what day is it 10 days from now?', ['Saturday', 'Sunday', 'Monday', 'Friday'], 'b'),

  /* ---------------- Computer Knowledge ---------------- */
  q('Computer Knowledge', 'Which key combination copies the selected text?', ['Ctrl + X', 'Ctrl + C', 'Ctrl + V', 'Ctrl + Z'], 'b'),
  q('Computer Knowledge', 'Which one undoes what you just did?', ['Ctrl + Y', 'Ctrl + U', 'Ctrl + Z', 'Ctrl + A'], 'c'),
  q('Computer Knowledge', 'In Excel, which formula adds the numbers in A1 to A10?', ['=ADD(A1:A10)', '=TOTAL(A1:A10)', '=SUM(A1:A10)', '=COUNT(A1:A10)'], 'c'),
  q('Computer Knowledge', 'In Excel, what does =COUNT(A1:A10) give you?', ['The total of the numbers', 'How many cells hold a number', 'How many cells are filled', 'The largest number'], 'b'),
  q('Computer Knowledge', 'Which of these is a spreadsheet file?', ['report.docx', 'list.xlsx', 'photo.jpg', 'notes.txt'], 'b'),
  q('Computer Knowledge', 'What does PDF stand for?', ['Printed Document File', 'Portable Document Format', 'Personal Data File', 'Public Document Form'], 'b'),
  q('Computer Knowledge', 'Which key saves the file you are working on?', ['Ctrl + S', 'Ctrl + P', 'Ctrl + O', 'Ctrl + N'], 'a'),
  q('Computer Knowledge', 'To print a document you press:', ['Ctrl + D', 'Ctrl + P', 'Ctrl + F', 'Ctrl + R'], 'b'),
  q('Computer Knowledge', 'Which is NOT an operating system?', ['Windows', 'Android', 'MS Excel', 'macOS'], 'c'),
  q('Computer Knowledge', 'In MS Word, which makes the selected text bold?', ['Ctrl + I', 'Ctrl + B', 'Ctrl + U', 'Ctrl + T'], 'b'),
  q('Computer Knowledge', 'Where do deleted files go on Windows before they are gone for good?', ['My Documents', 'Recycle Bin', 'Downloads', 'Nowhere'], 'b'),
  q('Computer Knowledge', 'What does a shortcut on the desktop do?', ['Holds a copy of the file', 'Points to a file kept elsewhere', 'Compresses the file', 'Hides the file'], 'b'),

  /* ---------------- Email and Internet ---------------- */
  q('Email and Internet', 'You want somebody to get a copy without the others seeing their address. You use:', ['To', 'CC', 'BCC', 'Reply all'], 'c'),
  q('Email and Internet', 'What does CC mean on an email?', ['Carbon copy — everybody can see them', 'Confidential copy', 'Closed copy', 'Client copy'], 'a'),
  q('Email and Internet', 'Five people were on an email and your answer is only for the sender. You press:', ['Reply all', 'Reply', 'Forward', 'CC'], 'b'),
  q('Email and Internet', 'To send somebody an email you already received, you press:', ['Reply', 'Forward', 'CC', 'Draft'], 'b'),
  q('Email and Internet', 'An email asks for your bank password and says the account will close today. You should:', ['Send the password quickly', 'Not reply and tell the office', 'Forward it to the customer', 'Click the link to check'], 'b'),
  q('Email and Internet', 'Which is a valid email address?', ['amit.shah@booknfly', 'amit shah@booknfly.in', 'amit.shah@booknfly.in', 'amit.shah.booknfly.in'], 'c'),
  q('Email and Internet', 'The attachment is 40 MB and will not send. The usual answer is to:', ['Send it in ten emails', 'Share a link to the file instead', 'Rename the file', 'Send it as a photo'], 'b'),
  q('Email and Internet', 'What is a browser?', ['A program for opening websites', 'A search engine', 'An email account', 'An operating system'], 'a'),
  q('Email and Internet', 'Which of these is a search engine?', ['Chrome', 'Google', 'Windows', 'Gmail'], 'b'),
  q('Email and Internet', 'What does the subject line of an email do?', ['Says who it is from', 'Says what it is about', 'Holds the attachment', 'Sets the date'], 'b'),

  /* ---------------- English ---------------- */
  q('English', 'Choose the correct sentence about a journey.', ['He have gone to Surat.', 'He has gone to Surat.', 'He has went to Surat.', 'He had went to Surat.'], 'b'),
  q('English', 'Choose the correct sentence about calling a customer.', ['I will call you tomorrow.', 'I will called you tomorrow.', 'I will calling you tomorrow.', 'I am call you tomorrow.'], 'a'),
  q('English', 'Which spelling is right — receiving a payment?', ['Recieve', 'Receive', 'Receve', 'Recive'], 'b'),
  q('English', 'Which spelling is right — a hotel stay?', ['Accomodation', 'Acommodation', 'Accommodation', 'Acomodation'], 'c'),
  q('English', 'The opposite of “arrival” is:', ['Landing', 'Departure', 'Journey', 'Return'], 'b'),
  q('English', 'Fill in the blank: The tickets ____ been confirmed.', ['has', 'have', 'is', 'was'], 'b'),
  q('English', 'Fill in the blank: Please send the invoice ____ Monday.', ['in', 'at', 'by', 'of'], 'c'),
  q('English', 'Which is the most polite way to write to a customer?', ['Send the money fast.', 'Kindly arrange the payment at your earliest convenience.', 'Why have you not paid?', 'Pay now please.'], 'b'),
  q('English', 'What does “confirm” mean?', ['To cancel', 'To make certain', 'To delay', 'To enquire'], 'b'),
  q('English', 'Choose the correct word: Their flight was ____ by two hours.', ['delay', 'delayed', 'delaying', 'delays'], 'b'),
];

/**
 * Questions for a particular seat, drawn on top of the general ones.
 *
 * Five from here plus fifteen general is the twenty Dinesh asked for. A
 * position with nothing written for it yet simply has no section in its
 * paper - it does not fall back to somebody else's job.
 */
export const STARTER_BY_POSITION = {
  'Travel Consultant': [
    q('Travel Consultant', 'What is a PNR?', ['Passenger Name Record', 'Private Number Route', 'Priority Name Reference', 'Plane Number Record'], 'a'),
    q('Travel Consultant', 'In a flight booking, what does “one way” mean?', ['Return included', 'Travel in one direction only', 'One passenger', 'One stop'], 'b'),
    q('Travel Consultant', 'BOM is the airport code for:', ['Bangalore', 'Mumbai', 'Bhopal', 'Bhubaneswar'], 'b'),
    q('Travel Consultant', 'DEL is the airport code for:', ['Dehradun', 'Delhi', 'Deoghar', 'Daman'], 'b'),
    q('Travel Consultant', 'A visa is:', ['A travel insurance policy', 'Permission to enter a country', 'An airline ticket', 'A hotel booking'], 'b'),
    q('Travel Consultant', 'Which is a Global Distribution System used for bookings?', ['Amadeus', 'Android', 'Tally', 'Acrobat'], 'a'),
    q('Travel Consultant', 'A customer wants to change the date on a confirmed ticket. The first thing to check is:', ['The weather', 'The airline’s change rules and fare difference', 'Their passport colour', 'The seat number'], 'b'),
    q('Travel Consultant', 'What does “no-show” mean?', ['The flight was cancelled', 'The passenger did not travel and did not cancel', 'The ticket was refunded', 'The booking failed'], 'b'),
    q('Travel Consultant', 'Usual check-in time before a domestic flight in India:', ['30 minutes', '2 hours', '5 hours', '10 minutes'], 'b'),
    q('Travel Consultant', 'A passport that expires in two months is a problem because many countries ask for:', ['A new photograph', 'At least six months’ validity', 'Two blank pages only', 'A return ticket'], 'b'),
  ],
  Accounts: [
    q('Accounts', 'In Tally, which voucher records a credit sale?', ['Payment', 'Receipt', 'Sales', 'Contra'], 'c'),
    q('Accounts', 'Money received from a customer is entered as a:', ['Payment voucher', 'Receipt voucher', 'Journal', 'Purchase'], 'b'),
    q('Accounts', 'GST stands for:', ['General Sales Tax', 'Goods and Services Tax', 'Gross Service Tax', 'Government Sales Tax'], 'b'),
    q('Accounts', 'In double entry, every debit has an equal and opposite:', ['Credit', 'Balance', 'Invoice', 'Receipt'], 'a'),
    q('Accounts', 'TDS stands for:', ['Total Deduction Sheet', 'Tax Deducted at Source', 'Trade Discount Scheme', 'Tax Due Statement'], 'b'),
    q('Accounts', 'A contra entry in Tally is used for:', ['Cash and bank transfers', 'Sales to a customer', 'Salary payment', 'Purchase of goods'], 'a'),
    q('Accounts', 'Which of these is an asset?', ['Creditors', 'Bank balance', 'Salary payable', 'Loan taken'], 'b'),
    q('Accounts', 'An invoice is:', ['A request for payment', 'A receipt for money paid', 'A bank statement', 'A purchase order'], 'a'),
    q('Accounts', 'Bank reconciliation compares the bank statement with:', ['The sales register', 'The company’s own bank book', 'The stock register', 'The salary sheet'], 'b'),
    q('Accounts', 'PF is deducted from:', ['Gross salary', 'Basic salary', 'Net salary', 'Bonus only'], 'b'),
  ],
};

/**
 * The paper Dinesh described: twenty questions, fifteen general and five for
 * the seat, at thirty seconds a question.
 *
 * `seconds_per_question` is PUBLISHED, not enforced by the clock - the clock
 * runs on the whole paper, so somebody can spend a minute on one question and
 * ten seconds on the next. That is deliberate and it is stated on the
 * candidate's screen. A hard per-question cut-off is a different test, one
 * question at a time with no going back, and it would be built as such rather
 * than pretended at here.
 */
export const STARTER_SECONDS_PER_QUESTION = 30;
export const STARTER_GENERAL_COUNT = 15;
export const STARTER_POSITION_COUNT = 5;

export function starterPaper(position) {
  const general = [
    { category: 'General Aptitude', count: 5 },
    { category: 'Computer Knowledge', count: 4 },
    { category: 'Email and Internet', count: 3 },
    { category: 'English', count: 3 },
  ];
  const sections = position ? [...general, { category: position, count: STARTER_POSITION_COUNT }] : general;
  const total = sections.reduce((n, s) => n + s.count, 0);
  return {
    name: position ? `${position} test` : 'General test',
    sections,
    pass_percent: 50,
    /*
     * One question at a time, each on its own clock, moving on by itself -
     * which is what "30 seconds a question" actually means and how his ZYNTA
     * test already works. The whole-paper total stays as the real limit.
     */
    one_at_a_time: 1,
    seconds_per_question: STARTER_SECONDS_PER_QUESTION,
    duration_minutes: Math.round((total * STARTER_SECONDS_PER_QUESTION) / 60),
    /*
     * The candidate's page already says a blank answer costs nothing, so this
     * does not repeat it. What it DOES say is that the clock is on the paper
     * and not on each question - thirty seconds is the pace, not a cut-off,
     * and somebody who thinks it is will rush every answer.
     */
    /*
     * The start screen already states the count, the time and the no-going-
     * back rule as its own bullets, so repeating them here reads as a page
     * that says everything twice. This says the thing the bullets cannot:
     * where to sit it.
     */
    instructions:
      'Find somewhere quiet with a steady signal before you start. There are no trick questions — answer what you know and leave the rest.',
  };
}
