/**
 * A crude structure check for PowerShell.
 *
 * NOT a parser — PowerShell's grammar is far bigger than this. It knows
 * comments, single- and double-quoted strings, backtick escapes, `$(...)`
 * subexpressions and here-strings well enough to answer the one question
 * worth answering before somebody runs a script on a server they cannot
 * easily recover: are the braces, brackets and quotes balanced, and does
 * every `try` have a `catch` or a `finally`.
 *
 * It exists because there is no PowerShell on the machine this app is built
 * on, so these scripts are otherwise never parsed by anything at all until
 * they run on the server. A clean result here does not mean a script works.
 * It means it is not obviously broken, which is a different and much
 * smaller claim.
 */

const OPEN = { ')': '(', '}': '{', ']': '[' };

export function psProblems(src, label = 'script') {
  const problems = [];
  const stack = [];
  let i = 0;
  let line = 1;
  const n = src.length;

  while (i < n) {
    const c = src[i];

    if (c === '\n') {
      line += 1;
      i += 1;
      continue;
    }

    // Here-strings: @' ... '@ and @" ... "@
    if (c === '@' && (src[i + 1] === "'" || src[i + 1] === '"')) {
      const q = src[i + 1];
      const end = src.indexOf(`\n${q}@`, i);
      if (end < 0) {
        problems.push(`${label}:${line}: here-string opened and never closed`);
        break;
      }
      line += count(src, '\n', i, end + 3);
      i = end + 3;
      continue;
    }

    if (src.startsWith('<#', i)) {
      const end = src.indexOf('#>', i);
      if (end < 0) {
        problems.push(`${label}:${line}: block comment never closed`);
        break;
      }
      line += count(src, '\n', i, end);
      i = end + 2;
      continue;
    }

    if (c === '#') {
      const end = src.indexOf('\n', i);
      i = end < 0 ? n : end;
      continue;
    }

    if (c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === "'") {
          if (src[j + 1] === "'") { j += 2; continue; }  // '' is a literal quote
          break;
        }
        if (src[j] === '\n') line += 1;
        j += 1;
      }
      if (j >= n) {
        problems.push(`${label}:${line}: single-quoted string never closed`);
        break;
      }
      i = j + 1;
      continue;
    }

    if (c === '"') {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        const ch = src[j];
        if (ch === '`') { j += 2; continue; }             // backtick escape
        if (ch === '\n') line += 1;
        if (ch === '$' && src[j + 1] === '(') { depth += 1; j += 2; continue; }
        if (ch === ')' && depth) { depth -= 1; j += 1; continue; }
        if (ch === '"' && !depth) {
          if (src[j + 1] === '"') { j += 2; continue; }
          break;
        }
        j += 1;
      }
      if (j >= n) {
        problems.push(`${label}:${line}: double-quoted string never closed`);
        break;
      }
      i = j + 1;
      continue;
    }

    if (c === '(' || c === '{' || c === '[') {
      stack.push([c, line]);
    } else if (c === ')' || c === '}' || c === ']') {
      if (!stack.length) {
        problems.push(`${label}:${line}: a '${c}' with nothing open`);
      } else if (stack[stack.length - 1][0] !== OPEN[c]) {
        const [o, ol] = stack.pop();
        problems.push(`${label}:${line}: '${c}' closes a '${o}' opened on line ${ol}`);
      } else {
        stack.pop();
      }
    }
    i += 1;
  }

  for (const [ch, ln] of stack) problems.push(`${label}:${ln}: '${ch}' is never closed`);

  const code = src.replace(/#[^\n]*/g, '');
  const tries = (code.match(/\btry\s*\{/g) || []).length;
  const ends = (code.match(/\b(finally|catch)\s*\{/g) || []).length;
  if (tries > ends) problems.push(`${label}: ${tries} try blocks but only ${ends} catch/finally`);

  return problems;
}

function count(s, needle, from, to) {
  let n = 0;
  for (let k = from; k < to; k += 1) if (s[k] === needle) n += 1;
  return n;
}
