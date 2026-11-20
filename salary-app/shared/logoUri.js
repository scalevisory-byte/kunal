/**
 * The one rule for writing a logo into a document.
 *
 * The offer letter and the payslip both carry the company's logo INSIDE the
 * file, as a `data:` URI, because both are handed to one person and opened
 * wherever they happen to be - on a phone with no signal, in an email client,
 * days later. A picture fetched from this server would be a blank box there,
 * and would also tell us every time somebody opened the document.
 *
 * SO THE SRC IS THE ONE PLACE A STRING SOMEBODY ELSE CHOSE COULD REACH OUT OF
 * THESE FILES, and this is the single gate it goes through. Anything that is
 * not a base64 data: image is ignored - a URL, a data:text/html, anything
 * carrying a quote that would break out of the attribute. Ignored rather than
 * refused: a letter that will not print because of a logo is worse than a
 * letter with no logo.
 *
 * Dependency-free, and deliberately its own file so the letter and the slip
 * cannot end up with two different ideas of what is safe to write.
 */

const DATA_IMAGE = /^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/;

/** The logo if it is one we may write into a document, else '' (meaning none). */
export const safeLogo = (value) => (DATA_IMAGE.test(String(value || '')) ? String(value) : '');
