"use client";

import { useEffect } from "react";

const BASE = "Second Brain";

export function UnreadTitle({ count }: { count: number }) {
  useEffect(() => {
    document.title = count > 0 ? `(${count.toLocaleString()}) ${BASE}` : BASE;
    return () => {
      document.title = BASE;
    };
  }, [count]);
  return null;
}
