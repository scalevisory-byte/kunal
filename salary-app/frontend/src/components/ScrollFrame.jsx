import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * A sheet wider than the room it has.
 *
 * The salary sheet is 1,674px of columns inside a 1,174px frame: five hundred
 * pixels of it are off the right-hand edge, the ESI column ends mid-heading,
 * and nothing on the screen says there is more. Chromium draws its scrollbar
 * as an overlay that fades out, so on a dense table the only clue is a column
 * that stops in the middle - which reads as a table that ends there.
 *
 * So: a hairline fade at whichever edge still has content behind it, and
 * NOTHING AT ALL when the table fits. A shadow that is always on would say
 * "there is more over here" about a table with nothing hidden, which is the
 * one thing a hint like this must never do.
 *
 * `box` is the scrolling element's own class - .table-wrap on a sheet,
 * .scroll on a report. Two kinds of frame existed already; what must not
 * exist is two answers to "does this table carry on past the edge", because
 * then a fade means "there is more" on one page and nothing on the next.
 *
 * It measures rather than guesses, because the frame's width changes with the
 * window, with the sidebar folding away, and with a filter that drops a
 * column - and a breakpoint cannot know about any of those.
 */
export default function ScrollFrame({ className = '', box = 'table-wrap', children, ...rest }) {
  const ref = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    // 1px of slack: a fractional scrollWidth on a zoomed or scaled screen
    // otherwise leaves the fade on for ever at the far end.
    const left = el.scrollLeft > 1;
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
    setEdges((was) => (was.left === left && was.right === right ? was : { left, right }));
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    // The frame resizes with the window; the table resizes when a row, a
    // column or a company filter changes under it. Both have to re-measure,
    // and only the second is invisible to a window listener.
    const ro = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    if (ro) {
      ro.observe(el);
      if (el.firstElementChild) ro.observe(el.firstElementChild);
    }
    window.addEventListener('resize', measure);
    return () => {
      el.removeEventListener('scroll', measure);
      if (ro) ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [measure, children]);

  return (
    <div className={`scroll-frame${edges.left ? ' more-left' : ''}${edges.right ? ' more-right' : ''}`}>
      <div className={`${box} ${className}`.trim()} ref={ref} {...rest}>
        {children}
      </div>
    </div>
  );
}
