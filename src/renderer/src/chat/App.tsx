import { type ClipboardEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { AiProvider, AiStatus } from '../../../shared/ai/types.ts';
import type { ChatMessage, ChatState } from '../../../shared/chat-state.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { OutgoingImage, ProviderView } from '../../../shared/ipc.ts';
import { PetFace } from '../PetFace.tsx';
import { AiManager } from './AiManager.tsx';
import { toOutgoing } from './images.ts';
import { Markdown } from './Markdown.tsx';
import { ProviderPicker } from './ProviderPicker.tsx';
import { isReady, statusText } from './providerStatus.ts';
import { UsageBar } from './UsageBar.tsx';

const bridge = window.jjakkungChat;
const MAX_IMAGES = 4;

export function App() {
  const [petName, setPetName] = useState(t('chat.defaultPetName'));
  const [state, setState] = useState<ChatState>();
  const [status, setStatus] = useState<Partial<Record<AiProvider, AiStatus>>>({});
  const [checking, setChecking] = useState(false);
  const [text, setText] = useState('');
  const [images, setImages] = useState<OutgoingImage[]>([]);
  const [notice, setNotice] = useState('');
  const [zoom, setZoom] = useState<string>();
  const [providers, setProviders] = useState<ProviderView[]>([]);
  const [managing, setManaging] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const stickToBottom = useRef(true);
  const readFilesRef = useRef<(files: FileList | File[]) => void>(() => {});

  const refreshStatus = useCallback(async (refresh: boolean) => {
    setChecking(true);
    setProviders(await bridge.providers());
    const list = await bridge.status(refresh);
    setStatus(Object.fromEntries(list.map((s) => [s.provider, s])));
    setChecking(false);
  }, []);

  const addImages = useCallback(async (incoming: OutgoingImage[]) => {
    setImages((prev) => {
      const next = [...prev, ...incoming].slice(0, MAX_IMAGES);
      if (prev.length + incoming.length > MAX_IMAGES) setNotice(t('chat.tooManyImages', { max: MAX_IMAGES }));
      return next;
    });
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    bridge.snapshot().then((snap) => {
      setPetName(snap.petName);
      setState(snap.state);
      if (snap.draft.length) addImages(snap.draft);
      document.title = t('chat.title', { name: snap.petName });
    });
    bridge.onState(setState);
    bridge.onDelta((id, full) =>
      setState(
        (s) =>
          s && {
            ...s,
            messages: s.messages.map((m) => (m.id === id ? { ...m, text: full, status: 'streaming' } : m)),
          },
      ),
    );
    bridge.onAttach((image) => addImages([image]));
    bridge.onPetName((name) => {
      setPetName(name);
      document.title = t('chat.title', { name });
    });
    if (bridge.platform === 'darwin') document.body.classList.add('mac');
    refreshStatus(false);
    inputRef.current?.focus();
    // 같이 보기로 창이 다시 앞에 오면 바로 질문을 쓸 수 있게 입력칸에 커서를 둔다.
    const onFocus = () => inputRef.current?.focus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [addImages, refreshStatus]);

  // 그림이 붙으면(같이 보기 포함) 바로 질문을 쓰게 입력칸으로. 새 창이면 입력칸이 그려진 뒤에 한다.
  useEffect(() => {
    if (images.length > 0) inputRef.current?.focus();
  }, [images.length]);

  // 창 어디에 그림을 끌어다 놓아도 붙인다.
  useEffect(() => {
    const over = (e: DragEvent) => e.preventDefault();
    const drop = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.files.length) readFilesRef.current(e.dataTransfer.files);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('drop', drop);
    };
  }, []);

  // 새 메시지가 오면 맨 아래로. 사용자가 위로 올려 읽는 중이면 두지 않는다.
  useEffect(() => {
    const el = listRef.current;
    if (el && stickToBottom.current) el.scrollTop = el.scrollHeight;
  });

  if (!state) return <div className="loading">{t('chat.loading')}</div>;

  const pending = !!state.pendingId;
  const current = status[state.provider];
  const spec = providers.find((p) => p.id === state.provider);
  const labelOf = (id?: AiProvider) => providers.find((p) => p.id === id)?.label ?? id ?? '';
  const imagesBlocked = !!spec && !spec.images && images.length > 0;
  // 한도에 걸리면 바로 물어볼 수 있는 다른 AI (설치, 로그인 확인된 것)
  const alternatives = providers.filter((p) => {
    const st = status[p.id];
    return p.id !== state.provider && !!st && isReady(st);
  });

  const send = () => {
    if (pending || (!text.trim() && images.length === 0)) return;
    bridge.send(text, images);
    setText('');
    setImages([]);
    setNotice('');
    stickToBottom.current = true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 조합 중 Enter 는 글자를 확정하는 키라 보내지 않는다.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      send();
    }
  };

  const readFiles = async (files: FileList | File[]) => {
    const list = [...files].filter((f) => f.type.startsWith('image/'));
    if (list.length === 0) return;
    try {
      addImages(await Promise.all(list.map((f) => toOutgoing(f))));
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    }
  };

  readFilesRef.current = readFiles;

  const onPaste = (e: ClipboardEvent) => {
    const files = [...e.clipboardData.files];
    if (files.some((f) => f.type.startsWith('image/'))) {
      e.preventDefault();
      readFiles(files);
    }
  };

  return (
    <div className="chat">
      <header>
        <div className="title">
          <PetFace />
          <strong>{petName}</strong>
        </div>
        <ProviderPicker
          providers={providers}
          status={status}
          current={state.provider}
          disabled={pending}
          onPick={(id) => bridge.setProvider(id)}
          onManage={() => setManaging(true)}
        />
        <button
          type="button"
          className="ghost"
          disabled={pending || state.messages.length === 0}
          onClick={() => bridge.reset()}
        >
          {t('chat.newChat')}
        </button>
      </header>
      <UsageBar usage={state.usage[state.provider]} spec={spec} hidden={!!current && !current.installed} />
      {managing && (
        <AiManager
          providers={providers}
          status={status}
          checking={checking}
          onRefresh={() => refreshStatus(true)}
          onAdd={async (input) => {
            const result = await bridge.addProvider(input);
            if (!result.ok) return result.error;
            await refreshStatus(false);
            bridge.setProvider(result.id);
            return undefined;
          }}
          onRemove={async (id) => {
            await bridge.removeProvider(id);
            refreshStatus(false);
          }}
          onClose={() => setManaging(false)}
        />
      )}
      {zoom && (
        <button
          type="button"
          className="lightbox"
          onClick={() => setZoom(undefined)}
          aria-label={t('chat.zoomClose')}
        >
          <img src={zoom} alt={t('chat.zoomAlt')} />
        </button>
      )}

      {spec && current && !isReady(current) && (
        <div className="banner" role="status">
          <span>{statusText(spec, current)}</span>
          <button type="button" className="ghost" disabled={checking} onClick={() => refreshStatus(true)}>
            {checking ? t('chat.checking') : t('chat.recheck')}
          </button>
        </div>
      )}

      <div
        className="messages"
        ref={listRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          stickToBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40;
        }}
      >
        {state.messages.length === 0 && (
          <div className="empty">
            <p>{t('chat.emptyLead')}</p>
            <p className="hint">{t('chat.emptyHint', { name: petName })}</p>
          </div>
        )}
        {state.messages.map((m) => (
          <Message
            key={m.id}
            message={m}
            petName={petName}
            label={labelOf(m.provider)}
            onZoom={setZoom}
            alternatives={m.id === state.messages.at(-1)?.id && !pending ? alternatives : []}
          />
        ))}
      </div>

      <footer>
        {notice && <p className="notice">{notice}</p>}
        {imagesBlocked && <p className="notice">{t('chat.imagesBlocked', { label: spec.label })}</p>}
        {images.length > 0 && (
          <div className="attachments">
            {images.map((img, i) => (
              <div className="attachment" key={img.thumb.thumb.slice(-24) + String(i)}>
                <img src={img.thumb.thumb} alt={t('chat.attachedAlt', { n: i + 1 })} />
                <button
                  type="button"
                  aria-label={t('chat.removeImage')}
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="options">
          <label className="opt" title={t('chat.knowsTodosTitle')}>
            <input
              type="checkbox"
              checked={!!state.knowsTodos}
              onChange={(e) => bridge.setKnowsTodos(e.target.checked)}
            />
            {t('chat.knowsTodos')}
          </label>
          <label
            className={`opt ${pending || (spec && !spec.ephemeral) ? 'disabled' : ''}`}
            title={
              spec && !spec.ephemeral
                ? t('chat.ephemeralUnsupported', { label: spec.label })
                : t('chat.ephemeralTitle')
            }
          >
            <input
              type="checkbox"
              checked={!!state.ephemeral}
              disabled={pending || (!!spec && !spec.ephemeral)}
              onChange={(e) => bridge.setEphemeral(e.target.checked)}
            />
            {t('chat.ephemeral')}
          </label>
        </div>
        <div className="composer">
          <label className="ghost icon" title={t('chat.attach')}>
            <input
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                if (e.target.files) readFiles(e.target.files);
                e.target.value = '';
              }}
            />
            <span aria-hidden="true">＋</span>
            <span className="sr-only">{t('chat.attach')}</span>
          </label>
          <textarea
            ref={inputRef}
            value={text}
            rows={1}
            placeholder={t('chat.placeholder', { name: petName })}
            title={t('chat.inputTitle')}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          {pending ? (
            <button type="button" className="primary" onClick={() => bridge.cancel()}>
              {t('chat.stop')}
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={!text.trim() && images.length === 0}
              onClick={send}
            >
              {t('chat.send')}
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

interface MessageProps {
  message: ChatMessage;
  petName: string;
  label: string;
  onZoom: (src: string) => void;
  /** 한도 오류일 때 다시 물어볼 다른 AI */
  alternatives: ProviderView[];
}

function Message({ message: m, petName, label, onZoom, alternatives }: MessageProps) {
  if (m.role === 'notice') return <p className="system">{m.text}</p>;
  if (m.role === 'user') {
    return (
      <div className="msg user">
        {m.images && (
          <div className={`shots ${m.images.length > 1 ? 'many' : ''}`}>
            {m.images.map((img, i) => (
              <button key={String(i)} type="button" className="shot" onClick={() => onZoom(img.thumb)}>
                <img src={img.thumb} alt={t('chat.sentAlt', { n: i + 1 })} />
              </button>
            ))}
          </div>
        )}
        {m.text && <div className="bubble">{m.text}</div>}
      </div>
    );
  }
  return (
    <div className="msg pet">
      <PetFace />
      <div className="body">
        <span className="who">
          {petName}
          {m.provider && <span className="tag">{label}</span>}
        </span>
        {m.status === 'waiting' && (
          <Thinking streams={m.provider === 'claude'} label={label} petName={petName} />
        )}
        {m.text && (
          <div className="bubble">
            <Markdown text={m.text} />
            {m.status === 'done' && <AnswerActions id={m.id} text={m.text} />}
          </div>
        )}
        {m.status === 'error' && m.error && (
          <div className={`bubble error ${m.error.kind}`}>{m.error.message}</div>
        )}
        {m.status === 'error' && m.error?.kind === 'rate-limit' && alternatives.length > 0 && (
          <div className="retry">
            {alternatives.slice(0, 3).map((p) => (
              <button key={p.id} type="button" className="ghost" onClick={() => bridge.retryWith(p.id)}>
                {t('chat.retryWith', { label: p.label })}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/** 답 아래 작은 단추: 복사, 메모로, 할 일로 (v1 "답변을 메모, 할 일로") */
function AnswerActions({ id, text }: { id: string; text: string }) {
  const [done, setDone] = useState('');
  const flash = (msg: string) => {
    setDone(msg);
    setTimeout(() => setDone(''), 1800);
  };
  if (done) return <span className="answer-actions shown">{done}</span>;
  return (
    <span className="answer-actions">
      <button
        type="button"
        onClick={async () => {
          await navigator.clipboard.writeText(text);
          flash(t('chat.copied'));
        }}
      >
        {t('chat.copy')}
      </button>
      <button
        type="button"
        onClick={async () => flash((await bridge.toNote(id)) ? t('chat.savedNote') : t('chat.saveFailed'))}
      >
        {t('chat.toNote')}
      </button>
      <button
        type="button"
        title={t('chat.toTodosTitle')}
        onClick={async () => {
          const n = await bridge.toTodos(id);
          flash(n > 0 ? t('chat.todosAdded', { n }) : t('chat.nothingToAdd'));
        }}
      >
        {t('chat.toTodos')}
      </button>
    </span>
  );
}

function Thinking({ streams, label, petName }: { streams: boolean; label: string; petName: string }) {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setSlow(true), 5000);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="bubble thinking" aria-live="polite">
      <span className="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      {t('chat.thinking', { name: petName })}
      {slow && !streams && <span className="hint">{t('chat.thinkingSlow', { label })}</span>}
    </div>
  );
}
