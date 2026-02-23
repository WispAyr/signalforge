import React, { useRef, useState, useEffect } from 'react';

interface ScrollShadowProps extends React.HTMLAttributes<HTMLDivElement> {
  children: React.ReactNode;
}

export const ScrollShadow: React.FC<ScrollShadowProps> = ({ children, className = '', ...rest }) => {
  const ref = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(false);
  const [bottom, setBottom] = useState(false);

  const check = () => {
    const el = ref.current;
    if (!el) return;
    setTop(el.scrollTop > 4);
    setBottom(el.scrollTop + el.clientHeight < el.scrollHeight - 4);
  };

  useEffect(() => { check(); }, [children]);

  return (
    <div className={`relative ${className}`} {...rest}>
      {top && <div className="absolute top-0 left-0 right-0 h-4 bg-gradient-to-b from-forge-bg/80 to-transparent z-10 pointer-events-none" />}
      <div ref={ref} onScroll={check} className="h-full overflow-y-auto">
        {children}
      </div>
      {bottom && <div className="absolute bottom-0 left-0 right-0 h-4 bg-gradient-to-t from-forge-bg/80 to-transparent z-10 pointer-events-none" />}
    </div>
  );
};
