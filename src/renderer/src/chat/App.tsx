import { type ClipboardEvent, type KeyboardEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { AiProvider, AiStatus } from '../../../shared/ai/types.ts';
import type { ChatMessage, ChatState } from '../../../shared/chat-state.ts';
import type { OutgoingImage, ProviderView } from '../../../shared/ipc.ts';
import { withParticle } from '../../../shared/josa.ts';
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
  const [petName, setPetName] = useState('짝꿍');
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
      if (prev.length + incoming.length > MAX_IMAGES)
        setNotice(`그림은 한 번에 ${MAX_IMAGES}장까지 붙일 수 있어.`);
      return next;
    });
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    bridge.snapshot().then((snap) => {
      setPetName(snap.petName);
      setState(snap.state);
      if (snap.draft.length) addImages(snap.draft);
      document.title = `${withParticle(snap.petName, '과')} 대화`;
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
      document.title = `${withParticle(name, '과')} 대화`;
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

  if (!state) return <div className="loading">불러오는 중</div>;

  const pending = !!state.pendingId;
  const current = status[state.provider];
  const spec = providers.find((p) => p.id === state.provider);
  const labelOf = (id?: AiProvider) => providers.find((p) => p.id === id)?.label ?? id ?? '';
  const imagesBlocked = !!spec && !spec.images && images.length > 0;

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
          새 대화
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
          aria-label="크게 보기 닫기"
        >
          <img src={zoom} alt="크게 본 그림" />
        </button>
      )}

      {spec && current && !isReady(current) && (
        <div className="banner" role="status">
          <span>{statusText(spec, current)}</span>
          <button type="button" className="ghost" disabled={checking} onClick={() => refreshStatus(true)}>
            {checking ? '확인 중' : '다시 확인'}
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
            <p>뭐든 물어봐. 같이 볼 화면이 있으면 보여 줘.</p>
            <p className="hint">
              {withParticle(petName, '을')} 우클릭하고 "{withParticle(petName, '이랑')} 같이 보기"를 고르면
              화면 일부를 찍어 여기 붙여. 그림을 붙여 넣거나 끌어다 놓아도 돼.
            </p>
          </div>
        )}
        {state.messages.map((m) => (
          <Message key={m.id} message={m} petName={petName} label={labelOf(m.provider)} onZoom={setZoom} />
        ))}
      </div>

      <footer>
        {notice && <p className="notice">{notice}</p>}
        {imagesBlocked && (
          <p className="notice">
            {withParticle(spec.label, '은')} 그림을 받지 않아서 글만 보낼게. 그림을 같이 보려면 그림을 받는 AI
            로 바꿔 줘.
          </p>
        )}
        {images.length > 0 && (
          <div className="attachments">
            {images.map((img, i) => (
              <div className="attachment" key={img.thumb.thumb.slice(-24) + String(i)}>
                <img src={img.thumb.thumb} alt={`붙인 그림 ${i + 1}`} />
                <button
                  type="button"
                  aria-label="그림 빼기"
                  onClick={() => setImages((prev) => prev.filter((_, j) => j !== i))}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="composer">
          <label className="ghost icon" title="그림 붙이기">
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
            <span className="sr-only">그림 붙이기</span>
          </label>
          <textarea
            ref={inputRef}
            value={text}
            rows={1}
            placeholder={`${petName}에게 물어보기`}
            title="Enter 로 보내고, Shift+Enter 로 줄을 바꿔요"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          {pending ? (
            <button type="button" className="primary" onClick={() => bridge.cancel()}>
              멈춤
            </button>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={!text.trim() && images.length === 0}
              onClick={send}
            >
              보내기
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
}

function Message({ message: m, petName, label, onZoom }: MessageProps) {
  if (m.role === 'notice') return <p className="system">{m.text}</p>;
  if (m.role === 'user') {
    return (
      <div className="msg user">
        {m.images && (
          <div className={`shots ${m.images.length > 1 ? 'many' : ''}`}>
            {m.images.map((img, i) => (
              <button key={String(i)} type="button" className="shot" onClick={() => onZoom(img.thumb)}>
                <img src={img.thumb} alt={`보낸 그림 ${i + 1}`} />
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
            {m.status === 'done' && <CopyButton text={m.text} />}
          </div>
        )}
        {m.status === 'error' && m.error && (
          <div className={`bubble error ${m.error.kind}`}>{m.error.message}</div>
        )}
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="copy"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? '복사함' : '복사'}
    </button>
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
      {withParticle(petName, '이')} 생각 중
      {slow && !streams && (
        <span className="hint">{withParticle(label, '은')} 답을 다 만든 뒤 한 번에 보여 줘</span>
      )}
    </div>
  );
}
