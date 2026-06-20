'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

type DialogKind = 'alert' | 'confirm' | 'prompt';

type DialogRequest = {
  kind: DialogKind;
  message: string;
  title?: string;
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  resolve: (value: boolean | string | null | void) => void;
};

export type AppDialogOptions = {
  title?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
};

export type AppDialogApi = {
  alert: (message: string, options?: AppDialogOptions) => Promise<void>;
  confirm: (message: string, options?: AppDialogOptions) => Promise<boolean>;
  prompt: (message: string, defaultValue?: string, options?: AppDialogOptions) => Promise<string | null>;
};

const AppDialogContext = createContext<AppDialogApi | null>(null);

let globalDialogApi: AppDialogApi | null = null;

function fallbackAlert(message: string) {
  if (typeof window !== 'undefined') window.alert(message);
}

function fallbackConfirm(message: string): boolean {
  if (typeof window !== 'undefined') return window.confirm(message);
  return false;
}

function fallbackPrompt(message: string, defaultValue = ''): string | null {
  if (typeof window !== 'undefined') return window.prompt(message, defaultValue);
  return null;
}

export function appAlert(message: string, options?: AppDialogOptions): Promise<void> {
  if (globalDialogApi) return globalDialogApi.alert(message, options);
  fallbackAlert(message);
  return Promise.resolve();
}

export function appConfirm(message: string, options?: AppDialogOptions): Promise<boolean> {
  if (globalDialogApi) return globalDialogApi.confirm(message, options);
  return Promise.resolve(fallbackConfirm(message));
}

export function appPrompt(
  message: string,
  defaultValue = '',
  options?: AppDialogOptions,
): Promise<string | null> {
  if (globalDialogApi) return globalDialogApi.prompt(message, defaultValue, options);
  return Promise.resolve(fallbackPrompt(message, defaultValue));
}

export function useAppDialog(): AppDialogApi {
  const ctx = useContext(AppDialogContext);
  if (!ctx) throw new Error('useAppDialog must be used within AppDialogProvider');
  return ctx;
}

const DEFAULT_TITLES: Record<DialogKind, string> = {
  alert: '알림',
  confirm: '확인',
  prompt: '입력',
};

function AppDialogModal({
  request,
  onClose,
}: {
  request: DialogRequest;
  onClose: (value: boolean | string | null | void) => void;
}) {
  const [input, setInput] = useState(request.defaultValue ?? '');
  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

  useEffect(() => {
    setInput(request.defaultValue ?? '');
  }, [request]);

  useEffect(() => {
    if (request.kind !== 'prompt') return;
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [request]);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose(request.kind === 'alert' ? undefined : request.kind === 'confirm' ? false : null);
      }
      if (e.key === 'Enter' && request.kind !== 'prompt') {
        e.preventDefault();
        onClose(request.kind === 'alert' ? undefined : true);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, request.kind]);

  const title = request.title ?? DEFAULT_TITLES[request.kind];
  const confirmLabel = request.confirmLabel ?? (request.kind === 'alert' ? '확인' : '확인');
  const cancelLabel = request.cancelLabel ?? '취소';
  const confirmClass = request.destructive
    ? 'btn-sm rounded-md border border-huma-err bg-[var(--err-bg)] px-3 py-1.5 text-[12px] font-semibold text-huma-err hover:bg-huma-err hover:text-white'
    : 'btn-primary btn-sm';

  return (
    <div
      className="m-modal-bg open z-[700]"
      role="presentation"
      onClick={() =>
        onClose(request.kind === 'alert' ? undefined : request.kind === 'confirm' ? false : null)
      }
    >
      <div
        className="m-modal max-w-md"
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-dialog-title"
        onClick={(e) => e.stopPropagation()}
      >
        <div id="app-dialog-title" className="m-modal-t">
          {title}
        </div>
        <p className="whitespace-pre-line text-[13px] leading-relaxed text-huma-t2">{request.message}</p>

        {request.kind === 'prompt' ? (
          request.message.includes('\n') && request.message.length > 80 ? (
            <textarea
              ref={inputRef as React.RefObject<HTMLTextAreaElement>}
              className="m-modal-input m-modal-textarea mt-3 min-h-[72px] resize-y"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  onClose(input);
                }
              }}
            />
          ) : (
            <input
              ref={inputRef as React.RefObject<HTMLInputElement>}
              className="m-modal-input mt-3"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  onClose(input);
                }
              }}
            />
          )
        ) : null}

        <div className="mt-4 flex justify-end gap-2">
          {request.kind !== 'alert' ? (
            <button
              type="button"
              className="btn-ghost btn-sm"
              onClick={() => onClose(request.kind === 'confirm' ? false : null)}
            >
              {cancelLabel}
            </button>
          ) : null}
          <button
            type="button"
            className={confirmClass}
            onClick={() =>
              onClose(
                request.kind === 'alert'
                  ? undefined
                  : request.kind === 'confirm'
                    ? true
                    : input,
              )
            }
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

export function AppDialogProvider({ children }: { children: ReactNode }) {
  const queueRef = useRef<DialogRequest[]>([]);
  const currentRef = useRef<DialogRequest | null>(null);
  const [current, setCurrent] = useState<DialogRequest | null>(null);

  const showNext = useCallback(() => {
    const next = queueRef.current.shift() ?? null;
    currentRef.current = next;
    setCurrent(next);
  }, []);

  const enqueue = useCallback(
    (partial: Omit<DialogRequest, 'resolve'>) =>
      new Promise<boolean | string | null | void>((resolve) => {
        const item: DialogRequest = { ...partial, resolve };
        if (!currentRef.current) {
          currentRef.current = item;
          setCurrent(item);
        } else {
          queueRef.current.push(item);
        }
      }),
    [],
  );

  const finish = useCallback(
    (value: boolean | string | null | void) => {
      currentRef.current?.resolve(value);
      showNext();
    },
    [showNext],
  );

  const api = useMemo<AppDialogApi>(
    () => ({
      alert: (message, options) =>
        enqueue({ kind: 'alert', message, ...options }).then(() => undefined),
      confirm: (message, options) =>
        enqueue({ kind: 'confirm', message, ...options }).then((v) => Boolean(v)),
      prompt: (message, defaultValue = '', options) =>
        enqueue({ kind: 'prompt', message, defaultValue, ...options }).then((v) =>
          typeof v === 'string' ? v : null,
        ),
    }),
    [enqueue],
  );

  useEffect(() => {
    globalDialogApi = api;
    return () => {
      globalDialogApi = null;
    };
  }, [api]);

  return (
    <AppDialogContext.Provider value={api}>
      {children}
      {current ? <AppDialogModal request={current} onClose={finish} /> : null}
    </AppDialogContext.Provider>
  );
}
