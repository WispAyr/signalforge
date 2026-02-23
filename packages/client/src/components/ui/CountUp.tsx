import React, { useEffect, useState, useRef } from 'react';

interface CountUpProps {
  end: number;
  duration?: number;
  className?: string;
  formatter?: (n: number) => string;
}

export const CountUp: React.FC<CountUpProps> = ({ end, duration = 800, className, formatter }) => {
  const [val, setVal] = useState(0);
  const prev = useRef(0);
  const prefersReduced = useRef(window.matchMedia?.('(prefers-reduced-motion: reduce)').matches);

  useEffect(() => {
    if (prefersReduced.current) { setVal(end); prev.current = end; return; }
    const start = prev.current;
    const diff = end - start;
    const startTime = performance.now();
    const step = (now: number) => {
      const t = Math.min((now - startTime) / duration, 1);
      const ease = 1 - Math.pow(1 - t, 3); // easeOutCubic
      setVal(Math.round(start + diff * ease));
      if (t < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    prev.current = end;
  }, [end, duration]);

  return <span className={className}>{formatter ? formatter(val) : val.toLocaleString()}</span>;
};
