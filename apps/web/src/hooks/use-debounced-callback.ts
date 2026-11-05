// Adapted from tablecn (MIT) https://github.com/sadmann7/shadcn-table

import * as React from 'react';

export function useDebouncedCallback<T extends (...args: any[]) => any>(
  callback: T,
  delay: number
) {
  const callbackRef = React.useRef(callback);
  React.useEffect(() => {
    callbackRef.current = callback;
  });
  const timerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

  const debounced = React.useCallback(
    (...args: Parameters<T>) => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
      timerRef.current = setTimeout(() => {
        callbackRef.current(...args);
      }, delay);
    },
    [delay]
  );

  React.useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return debounced;
}
