'use client';

import { useEffect, useRef } from 'react';

type ErrorPayload = {
  message: string;
  stack?: string;
  filename?: string;
  lineno?: number;
  colno?: number;
  userAgent?: string;
  url?: string;
  timestamp: string;
};

const MAX_REPORTS = 3;

export default function ClientErrorReporter() {
  const sentCountRef = useRef(0);

  useEffect(() => {
    const sendPayload = (payload: ErrorPayload) => {
      if (sentCountRef.current >= MAX_REPORTS) return;
      sentCountRef.current += 1;

      fetch('/api/client-error', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        keepalive: true,
      }).catch(() => {
        // Swallow errors to avoid impacting UX
      });
    };

    const handleError = (
      message: string | Event,
      source?: string,
      lineno?: number,
      colno?: number,
      error?: Error,
    ) => {
      const payload: ErrorPayload = {
        message: typeof message === 'string' ? message : 'Unknown error',
        stack: error?.stack,
        filename: source,
        lineno,
        colno,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        url: typeof location !== 'undefined' ? location.href : undefined,
        timestamp: new Date().toISOString(),
      };
      sendPayload(payload);
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const payload: ErrorPayload = {
        message:
          typeof reason === 'string'
            ? reason
            : reason?.message || 'Unhandled promise rejection',
        stack: typeof reason === 'object' ? reason?.stack : undefined,
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        url: typeof location !== 'undefined' ? location.href : undefined,
        timestamp: new Date().toISOString(),
      };
      sendPayload(payload);
    };

    window.addEventListener('error', handleError as any);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError as any);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, []);

  return null;
}
