"use client";

import { useEffect } from "react";

/** Arrow-key navigation, and nothing else.
 *
 *  Everything this component adds is already available without it: the rail on every slide
 *  is a pair of real anchors with real hrefs, scroll-snap moves the deck a slide at a time,
 *  and `/deck#5` lands on slide five because slide five's element id is `5`. This is
 *  enhancement on top of a document that works with scripting switched off — which is what a
 *  judge opening the printed PDF, or a reader behind a strict CSP, actually gets.
 */
export default function DeckKeys({ count }: { count: number }) {
  useEffect(() => {
    const nearest = () => {
      // The slide whose top is closest to the top of the scroller. Cheap, exact enough at a
      // slide a screen, and it needs no observer to stay in step with a mid-scroll keypress.
      let best = 1;
      let bestD = Infinity;
      for (const s of document.querySelectorAll<HTMLElement>(".d-slide")) {
        const d = Math.abs(s.getBoundingClientRect().top);
        if (d < bestD) {
          bestD = d;
          best = Number(s.id) || best;
        }
      }
      return best;
    };

    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const t = e.target as HTMLElement | null;
      if (t?.isContentEditable || (t && /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;

      let n: number | null = null;
      if (e.key === "ArrowRight" || e.key === "ArrowDown" || e.key === "PageDown") {
        n = Math.min(count, nearest() + 1);
      } else if (e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp") {
        n = Math.max(1, nearest() - 1);
      } else if (e.key === "Home") {
        n = 1;
      } else if (e.key === "End") {
        n = count;
      }
      if (n === null) return;

      const el = document.getElementById(String(n));
      if (!el) return;
      e.preventDefault();
      // scrollIntoView inherits scroll-behavior from the stylesheet, where smooth scrolling
      // is declared only under `prefers-reduced-motion: no-preference`.
      el.scrollIntoView();
      // replaceState, not a hash assignment: forty arrow presses should not bury the page a
      // reader arrived from under forty history entries.
      history.replaceState(null, "", `#${n}`);
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [count]);

  return null;
}
