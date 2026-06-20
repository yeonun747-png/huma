'use client';

import { useState } from 'react';
import type { HumaAccount, Workspace } from '@huma/shared';
import { readBlogWritingPersona, mergeBlogWritingPersona } from '@/lib/blog-writing-persona';

interface BlogPersonaModalProps {
  account: HumaAccount;
  open: boolean;
  onClose: () => void;
  onSave: (personaText: string) => Promise<void>;
  saving?: boolean;
  error?: string;
}

export function BlogPersonaModal({ account, open, onClose, onSave, saving, error }: BlogPersonaModalProps) {
  const ws = account.workspace as Workspace;
  const initial = readBlogWritingPersona(ws, account.persona ?? null);

  if (!open) return null;

  return (
    <div className="m-modal-bg open" onClick={onClose} role="presentation">
      <div className="m-modal m-modal-queue max-w-lg" onClick={(e) => e.stopPropagation()} role="dialog">
        <div className="m-modal-t">✍️ 포스팅 페르소나 · {account.name}</div>
        <p className="mb-3 text-[12px] text-huma-t3">
          Claude Sonnet이 네이버 블로그 글을 쓸 때 따를 톤·말투입니다. 연운은 ~요체·경험담·AI 티 금지를 권장합니다.
          DB speech_style·character_mode_prompts와 함께 적용됩니다.
        </p>
        <BlogPersonaForm
          key={account.id}
          initial={initial}
          onSave={onSave}
          onClose={onClose}
          saving={saving}
          error={error}
        />
      </div>
    </div>
  );
}

function BlogPersonaForm({
  initial,
  onSave,
  onClose,
  saving,
  error,
}: {
  initial: string;
  onSave: (text: string) => Promise<void>;
  onClose: () => void;
  saving?: boolean;
  error?: string;
}) {
  const [text, setText] = useState(initial);

  return (
    <>
      {error ? <p className="mb-2 text-xs text-huma-err">{error}</p> : null}
      <textarea
        className="m-modal-input m-modal-textarea min-h-[220px] font-mono text-[11px]"
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="블로그 글 문체 지침…"
      />
      <div className="m-modal-foot mt-3">
        <button
          type="button"
          className="btn-primary flex-[2] py-2"
          disabled={saving || !text.trim()}
          onClick={() => void onSave(text)}
        >
          {saving ? '저장 중…' : '저장'}
        </button>
        <button type="button" className="btn-ghost flex-1 py-2" onClick={onClose} disabled={saving}>
          취소
        </button>
      </div>
    </>
  );
}

export { mergeBlogWritingPersona };
