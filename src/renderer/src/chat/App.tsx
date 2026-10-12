import {
  type ClipboardEvent,
  type KeyboardEvent,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { type GuideSubject, guideModeOf, hasGuide } from '../../../shared/ai/install-guide.ts';
import type { AiProvider, AiStatus } from '../../../shared/ai/types.ts';
import type { ChatMessage, ChatState } from '../../../shared/chat-state.ts';
import { t } from '../../../shared/i18n/index.ts';
import type { OutgoingImage, ProviderView } from '../../../shared/ipc.ts';
import { PetFace } from '../PetFace.tsx';
import { AiManager } from './AiManager.tsx';
import { InlineGuide, InstallGuide } from './InstallGuide.tsx';
import { toOutgoing } from './images.ts';
import { chatKey, lastQuestion } from './keys.ts';
import { Markdown } from './Markdown.tsx';
import { ProviderPicker } from './ProviderPicker.tsx';
import { isReady, statusText } from './providerStatus.ts';
import { contentKey, conversationChanged, isNearBottom, jumpBehavior, scrollDecision } from './scroll.ts';
import { singleFlight } from './single-flight.ts';
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
  /** 설치 방법 시트를 연 AI (#29) */
  const [guideFor, setGuideFor] = useState<AiProvider>();
  // 덮개(AI 관리, 그림 크게 보기)가 열려 있으면 입력칸으로 포커스를 옮기지 않는다 (가려진 입력칸에 붙여 넣고 보내졌다)
  const overlayRef = useRef(false);
  overlayRef.current = managing || !!zoom || !!guideFor;
  const focusInput = useCallback(() => {
    if (!overlayRef.current) inputRef.current?.focus();
  }, []);
  /** 새 대화를 누른 직후 잠깐 보이는 되돌리기 알림 */
  const [undoShown, setUndoShown] = useState(false);
  const undoTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // 아래 따라가기 (scroll.ts). following: 사용자가 맨 아래를 보고 있다. unseen: 위를 읽는 사이 새것이 왔다
  const following = useRef(true);
  const [unseen, setUnseen] = useState(false);
  /** 내가 막 보냈다: 읽던 자리와 상관없이 내 질문과 답을 보여 준다 */
  const sentRef = useRef(false);
  /** "새 메시지" 단추로 부드럽게 내려가는 중 (그사이 스크롤 사건으로 따라가기를 끄지 않게) */
  const jumping = useRef(false);
  const jumpTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const seen = useRef<{ messages?: ChatState['messages']; key: string; provider?: string }>({ key: '' });
  const readFilesRef = useRef<(files: FileList | File[]) => void>(() => {});
  /** 창 전체 단축키(Esc, Cmd/Ctrl+N)가 지금 화면 값을 보게 매번 바꿔 끼운다 */
  const globalKeyRef = useRef<(e: globalThis.KeyboardEvent) => void>(() => {});
  /** 화면 읽기 프로그램에 읽어 줄 다 온 답. 조각마다 읽으면 시끄러워서 끝났을 때 한 번만 */
  const [announce, setAnnounce] = useState('');
  /** 이미 끝난 답 id. 처음 열 때 남아 있던 대화(다시 켬)는 읽지 않는다 */
  const doneIds = useRef<Set<string>>(undefined);

  const refreshStatus = useCallback(async (refresh: boolean) => {
    setChecking(true);
    setProviders(await bridge.providers());
    const list = await bridge.status(refresh);
    setStatus(Object.fromEntries(list.map((s) => [s.provider, s])));
    setChecking(false);
  }, []);

  // 무료 AI 받기가 끝나면(AI 관리에서 받았을 때) 상태를 다시 읽어 "받기" 를 "준비됐어" 로
  const downloadingModel = !!state?.modelDownload && !state.modelDownload.failed;
  useEffect(() => {
    if (!downloadingModel) void refreshStatus(false);
  }, [downloadingModel, refreshStatus]);

  const addImages = useCallback(
    async (incoming: OutgoingImage[]) => {
      setImages((prev) => {
        const next = [...prev, ...incoming].slice(0, MAX_IMAGES);
        if (prev.length + incoming.length > MAX_IMAGES)
          setNotice(t('chat.tooManyImages', { max: MAX_IMAGES }));
        return next;
      });
      focusInput();
    },
    [focusInput],
  );

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
    const onFocus = focusInput;
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, [addImages, refreshStatus, focusInput]);

  // 덮개를 닫으면 입력칸으로 돌아온다
  const covered = managing || !!zoom || !!guideFor;
  const wasCovered = useRef(false);
  useEffect(() => {
    if (wasCovered.current && !covered) focusInput();
    wasCovered.current = covered;
  }, [covered, focusInput]);

  // 그림이 붙으면(같이 보기 포함) 바로 질문을 쓰게 입력칸으로. 새 창이면 입력칸이 그려진 뒤에 한다.
  useEffect(() => {
    if (images.length > 0) focusInput();
  }, [images.length, focusInput]);

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

  // 무료 AI 모델을 다 받으면(받기 진행이 사라지면) 고르기 단추의 "받기 전" 점을 다시 본다
  const downloading = !!state?.modelDownload && !state.modelDownload.failed;
  const wasDownloading = useRef(false);
  useEffect(() => {
    if (wasDownloading.current && !downloading) void refreshStatus(false);
    wasDownloading.current = downloading;
  }, [downloading, refreshStatus]);

  // 새 대화 뒤 새로 물었으면 되돌리기 알림을 거둔다 (되돌릴 수 없다)
  const hasMessages = (state?.messages.length ?? 0) > 0;
  useEffect(() => {
    if (hasMessages) setUndoShown(false);
  }, [hasMessages]);
  useEffect(
    () => () => {
      clearTimeout(undoTimer.current);
      clearTimeout(jumpTimer.current);
    },
    [],
  );

  // 답이 새로 끝나면 한 번 알린다
  useEffect(() => {
    if (!state) return;
    const done = state.messages.filter((m) => m.role === 'pet' && m.status === 'done');
    if (!doneIds.current) {
      doneIds.current = new Set(done.map((m) => m.id));
      return;
    }
    const fresh = done.filter((m) => !doneIds.current?.has(m.id));
    for (const m of fresh) doneIds.current.add(m.id);
    const last = fresh.at(-1);
    if (last) setAnnounce(t('chat.a11yAnswered', { name: petName, text: last.text }));
  }, [state, petName]);

  // Esc, Cmd/Ctrl+N 은 입력칸 밖(답 단추 등)에 있어도 듣는다
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => globalKeyRef.current(e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // 새 메시지, 답 조각, 생각 중 표시가 생기면 맨 아래로 (그리기 전에 옮겨 깜빡이지 않게).
  // 사용자가 위로 올려 읽는 중이면 끌어내리지 않고 "새 메시지" 단추를 띄운다
  useLayoutEffect(() => {
    const el = listRef.current;
    if (!el || !state) return;
    const before = seen.current;
    const key = contentKey(state.messages, state.pendingId);
    const grew = key !== before.key;
    const switched =
      (before.messages !== state.messages && conversationChanged(before.messages, state.messages)) ||
      (before.provider !== undefined && before.provider !== state.provider);
    const decision = scrollDecision({ following: following.current, grew, sent: sentRef.current, switched });
    if (decision === 'follow') {
      following.current = true;
      jumping.current = false;
      el.scrollTop = el.scrollHeight;
      setUnseen(false);
    } else if (decision === 'notify') setUnseen(true);
    if (grew) sentRef.current = false;
    seen.current = { messages: state.messages, key, provider: state.provider };
  });

  // 다시 그리기 없이 크기만 바뀌어도(늦게 뜨는 그림, 5초 뒤 "오래 걸려" 안내, 창 크기) 아래를 보고 있었으면 아래에 둔다
  const resizeObs = useRef<ResizeObserver>(undefined);
  useEffect(() => {
    const ro = new ResizeObserver(() => {
      const el = listRef.current;
      // 단추로 내려가는 중이어도 갈 곳은 맨 아래라 바로 맞춘다 (창 크기가 바뀌면 부드러운 스크롤이 도중에 멈춘다)
      if (el && following.current) el.scrollTop = el.scrollHeight;
    });
    resizeObs.current = ro;
    return () => ro.disconnect();
  }, []);
  useEffect(() => {
    const el = listRef.current;
    const ro = resizeObs.current;
    if (!el || !ro) return;
    ro.observe(el);
    for (const child of el.children) ro.observe(child);
  });

  const jumpToBottom = () => {
    const el = listRef.current;
    if (!el) return;
    following.current = true;
    setUnseen(false);
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    jumping.current = !reduced;
    el.scrollTo({ top: el.scrollHeight, behavior: jumpBehavior(reduced) });
    // 부드러운 스크롤이 끝에 닿지 못하고 멈춰도 오래 붙잡지 않는다
    clearTimeout(jumpTimer.current);
    jumpTimer.current = setTimeout(() => {
      jumping.current = false;
    }, 1500);
    focusInput();
  };

  if (!state) return <div className="loading">{t('chat.loading')}</div>;

  const pending = !!state.pendingId;
  const current = status[state.provider];
  const spec = providers.find((p) => p.id === state.provider);
  const guideSpec = providers.find((p) => p.id === guideFor);
  const subjectOf = (id?: AiProvider): GuideSubject | undefined => {
    const p = providers.find((x) => x.id === id);
    if (!p || !hasGuide(p)) return undefined;
    return { id: p.id, label: p.label, custom: p.custom, bin: p.bin };
  };
  const guideSubject = subjectOf(guideFor);
  // 머리 안내 줄: 못 찾음이면 설치, 로그인 안 됨이면 로그인 안내
  const bannerMode = guideModeOf(current);
  const bannerSubject = bannerMode ? subjectOf(state.provider) : undefined;
  const labelOf = (id?: AiProvider) => providers.find((p) => p.id === id)?.label ?? id ?? '';
  const imagesBlocked = !!spec && !spec.images && images.length > 0;
  // 한도에 걸리면 바로 물어볼 수 있는 다른 AI (설치, 로그인 확인된 것)
  const alternatives = providers.filter((p) => {
    const st = status[p.id];
    return p.id !== state.provider && !!st && isReady(st);
  });

  // 새 대화: 바로 지우되 몇 초 동안 되돌릴 수 있다 (메인이 지운 대화를 잠깐 들고 있다, UNDO_RESET_MS)
  const newChat = () => {
    bridge.reset();
    setUndoShown(true);
    clearTimeout(undoTimer.current);
    undoTimer.current = setTimeout(() => setUndoShown(false), 6000);
    inputRef.current?.focus();
  };
  const undoNewChat = async () => {
    clearTimeout(undoTimer.current);
    setUndoShown(false);
    if (await bridge.undoReset()) following.current = true;
  };

  const send = () => {
    if (pending || (!text.trim() && images.length === 0)) return;
    bridge.send(text, images);
    setText('');
    setImages([]);
    setNotice('');
    sentRef.current = true;
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // 한글 조합 중 Enter 는 글자를 확정하는 키라 보내지 않는다.
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && e.keyCode !== 229) {
      e.preventDefault();
      send();
      return;
    }
    // 빈 입력칸에서 ↑: 마지막 질문을 다시 불러온다 (고쳐서 다시 묻기)
    if (chatKey(e.nativeEvent, bridge.platform) === 'recall' && !text) {
      const last = lastQuestion(state.messages);
      if (!last) return;
      e.preventDefault();
      setText(last);
      // 값이 들어간 뒤 커서를 끝으로
      requestAnimationFrame(() => {
        const el = inputRef.current;
        el?.setSelectionRange(el.value.length, el.value.length);
      });
    }
  };

  globalKeyRef.current = (e) => {
    const key = chatKey(e, bridge.platform);
    if (key === 'escape') {
      // 그림 크게 보기, 설치 방법, AI 관리가 열려 있으면 그것부터 닫는다 (설치 방법은 AI 관리 위에 뜰 수 있어 먼저).
      // 답을 기다리면 멈춘다. 아무것도 없고 쓰던 글도 없으면 창을 닫는다 (패널, 설정 창과 같게. 쓰던 글은 Esc 하나로 잃지 않게 둔다)
      if (zoom) setZoom(undefined);
      else if (guideFor) setGuideFor(undefined);
      else if (managing) setManaging(false);
      else if (pending) bridge.cancel();
      else if (!text.trim() && !e.defaultPrevented) window.close();
      else return;
      e.preventDefault();
    } else if (key === 'new-chat') {
      e.preventDefault();
      if (!pending && state.messages.length > 0) newChat();
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
          {/* 긴 이름은 말줄임이라 올리면 전체 이름 (패널의 대화 단추와 같다) */}
          {/* 창 제목: 화면 읽기 프로그램에는 h1, 보이는 글은 그대로 */}
          <h1 className="sr-only">{petName}</h1>
          <strong title={petName} aria-hidden="true">
            {petName}
          </strong>
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
          onClick={newChat}
        >
          {t('chat.newChat')}
        </button>
      </header>
      <UsageBar
        usage={state.usage[state.provider]}
        spec={spec}
        hidden={!!current && !current.installed}
        asked={state.messages.length > 0}
      />
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
          onGuide={setGuideFor}
          onDownload={() => {
            bridge.setProvider('local');
            bridge.downloadModel();
          }}
          download={state.modelDownload}
        />
      )}
      {guideFor && guideSubject && (
        <InstallGuide
          subject={guideSubject}
          mode={guideModeOf(status[guideFor]) ?? 'install'}
          platform={bridge.platform}
          checking={checking}
          statusLine={guideSpec ? statusText(guideSpec, status[guideFor]) : undefined}
          onRecheck={() => refreshStatus(true)}
          onLink={bridge.openLink}
          onClose={() => setGuideFor(undefined)}
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
        <div className="banner action-row" role="status">
          <span className="grow">{statusText(spec, current)}</span>
          {bannerSubject && (
            <button type="button" className="ghost" onClick={() => setGuideFor(spec.id)}>
              {bannerMode === 'login' ? t('ai.guide.showLogin') : t('ai.guide.show')}
            </button>
          )}
          <button type="button" className="ghost" disabled={checking} onClick={() => refreshStatus(true)}>
            {checking ? t('chat.checking') : t('chat.recheck')}
          </button>
        </div>
      )}

      {/* 대화가 창의 본문 (화면 읽기 프로그램의 main 이동) */}
      <main className="chat-main">
        <div
          className="messages"
          ref={listRef}
          // 새 메시지(내 질문, 오류)는 덧붙을 때 읽는다. 답 조각은 그리는 중이라 숨기고 끝나면 아래 announce 로
          role="log"
          aria-live="polite"
          aria-relevant="additions"
          aria-label={t('chat.a11yLog', { name: petName })}
          onScroll={(e) => {
            const near = isNearBottom(e.currentTarget);
            // 단추로 내려가는 중의 중간 자리는 사용자가 올린 것이 아니다
            if (jumping.current && !near) return;
            jumping.current = false;
            following.current = near;
            if (near) setUnseen(false);
          }}
          // 내려가는 중에 사용자가 직접 굴리면 그 손을 따른다
          onWheel={() => {
            jumping.current = false;
          }}
        >
          {state.messages.length === 0 && (
            <div className="empty">
              <p>{t('chat.emptyLead')}</p>
              <p className="hint">{t('chat.emptyHint', { name: petName })}</p>
              {/* 무엇을 물을지 막막할 때: 누르면 입력칸에 채운다 (바로 보내지 않아 고쳐 쓸 수 있다) */}
              <ul className="starters" aria-label={t('chat.starters')}>
                {(['chat.starter.today', 'chat.starter.polish', 'chat.starter.break'] as const).map((key) => (
                  <li key={key}>
                    <button
                      type="button"
                      onClick={() => {
                        setText(t(key));
                        const el = inputRef.current;
                        el?.focus();
                        // 커서는 글 끝에 (다듬을 글을 바로 붙여 넣게)
                        requestAnimationFrame(() => el?.setSelectionRange(el.value.length, el.value.length));
                      }}
                    >
                      {t(key).trim()}
                    </button>
                  </li>
                ))}
              </ul>
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
              download={m.id === state.messages.at(-1)?.id ? state.modelDownload : undefined}
              isLast={m.id === state.messages.at(-1)?.id}
              freeModelMb={freeModelMb(m)}
              guide={{
                subject: subjectOf(m.provider),
                checking,
                statusLine: (() => {
                  const p = providers.find((x) => x.id === m.provider);
                  return p ? statusText(p, status[p.id]) : undefined;
                })(),
                onRecheck: () => refreshStatus(true),
              }}
            />
          ))}
        </div>
      </main>

      {unseen && (
        <div className="new-below-wrap">
          <button
            type="button"
            className="new-below"
            // 눌러도 입력칸의 커서를 뺏지 않는다
            onMouseDown={(e) => e.preventDefault()}
            onClick={jumpToBottom}
          >
            {t('chat.newBelow')}
            <span aria-hidden="true"> ↓</span>
          </button>
        </div>
      )}

      <span className="sr-only" role="status" aria-live="polite">
        {announce}
      </span>

      <footer>
        {undoShown && (
          <div className="undo-toast action-row" role="status">
            <span className="grow">{t('chat.resetDone')}</span>
            <button type="button" className="ghost" onClick={undoNewChat}>
              {t('chat.undo')}
            </button>
          </div>
        )}
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
            title={spec && !spec.ephemeral ? undefined : t('chat.ephemeralTitle')}
          >
            <input
              type="checkbox"
              checked={!!state.ephemeral}
              disabled={pending || (!!spec && !spec.ephemeral)}
              aria-describedby={spec && !spec.ephemeral ? 'ephemeral-why' : undefined}
              onChange={(e) => bridge.setEphemeral(e.target.checked)}
            />
            {t('chat.ephemeral')}
          </label>
          {/* 못 켜는 까닭은 풀이(마우스를 올려야 보임)가 아니라 바로 아래 글로. 꺼진 칸은 키보드로 갈 수 없어 풀이를 못 봤다 */}
          {spec && !spec.ephemeral && (
            <small id="ephemeral-why" className="opt-why">
              {t('chat.ephemeralUnsupported', { label: spec.label })}
            </small>
          )}
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
            // 화면 읽기 프로그램이 칸 이름을 "Enter로 보내고..."(title)로 읽었다. 이름은 칸이 하는 일, title 은 설명으로
            aria-label={t('chat.placeholder', { name: petName })}
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
  /** 무료 AI 모델 받기 진행 (v2, 마지막 메시지에만) */
  download?: ChatState['modelDownload'];
  /** 받을 모델 크기 (오류 문구에서 읽는다) */
  freeModelMb?: string;
  isLast: boolean;
  /** 못 찾음, 로그인 안 됨 오류 아래에 펼칠 안내 (#29). subject 가 없으면(무료 AI 등) 단추를 두지 않는다 */
  guide: {
    subject?: GuideSubject;
    checking: boolean;
    /** 지금 상태 한 줄 (다시 확인하면 바뀐다) */
    statusLine?: string;
    onRecheck: () => void;
  };
}

/** 무료 AI 오류 문구의 "(397MB)" 에서 크기를 읽는다. 단추에 같이 적는다 */
const freeModelMb = (m: ChatMessage) => /(\d+)\s?MB/.exec(m.error?.message ?? '')?.[1];

function Message({
  message: m,
  petName,
  label,
  onZoom,
  alternatives,
  download,
  freeModelMb: mb,
  isLast,
  guide,
}: MessageProps) {
  const guideMode = m.status === 'error' ? guideModeOf(m.error) : undefined;
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
        {m.text && (
          <div className="bubble" dir="auto">
            {m.text}
          </div>
        )}
      </div>
    );
  }
  return (
    <div className="msg pet">
      <PetFace />
      <div className="body">
        <span className="who">
          {petName}
          {/* 규칙 답("오늘 뭐부터")은 AI 이름 대신 "AI 없이" (AI 가 답한 줄 알지 않게) */}
          {m.game ? (
            // 끝말잇기 (AI 없이 하는 말놀이)
            <span className="tag" title={t('fun.chain.tagTitle')}>
              {t('fun.chain.tag')}
            </span>
          ) : m.byRules ? (
            <span className="tag" title={t('first.tagTitle')}>
              {t('first.tag')}
            </span>
          ) : (
            m.provider && <span className="tag">{label}</span>
          )}
        </span>
        {m.status === 'waiting' && (
          <Thinking streams={m.provider === 'claude'} label={label} petName={petName} />
        )}
        {m.text && (
          // 오는 중인 답은 화면 읽기에서 숨긴다 (조각마다 읽지 않게). 끝나면 보이고 한 번 알린다
          <div className="bubble" dir="auto" aria-hidden={m.status === 'streaming' || undefined}>
            <Markdown text={m.text} onLink={bridge.openLink} />
            {m.status === 'done' && !m.game && <AnswerActions id={m.id} text={m.text} />}
          </div>
        )}
        {/* 규칙 답 아래: 맨 위 할 일로 집중 시작, 패널 열기 */}
        {m.status === 'done' && m.plan && (
          <div className="retry action-row">
            {m.plan.focusTodoId !== undefined && (
              <button
                type="button"
                className="ghost"
                onClick={() => bridge.planAction('focus', m.plan?.focusTodoId)}
              >
                {t('first.focus')}
              </button>
            )}
            <button type="button" className="ghost" onClick={() => bridge.planAction('panel')}>
              {t('first.panel')}
            </button>
          </div>
        )}
        {/* 무료 AI 모델 받기 안내는 오류가 아니라 다음 할 일이라 오류색을 쓰지 않는다 */}
        {m.status === 'error' && m.error && (
          <div className={`bubble ${m.error.kind === 'needs-model' ? 'guide' : `error ${m.error.kind}`}`}>
            {m.error.message}
          </div>
        )}
        {/* 받기 단추는 마지막 안내에만 (받은 뒤 위쪽 옛 안내에 단추가 남지 않게) */}
        {m.status === 'error' && m.error?.kind === 'needs-model' && mb && isLast && (
          <div className="retry action-row">
            {download && !download.failed ? (
              <span className="download">
                <progress max={100} value={download.pct} />
                {t('ai.local.downloading', { pct: download.pct })}
                <button type="button" className="ghost" onClick={() => bridge.cancel()}>
                  {t('common.cancel')}
                </button>
              </span>
            ) : (
              <>
                <button type="button" className="ghost" onClick={() => bridge.downloadModel()}>
                  {t('ai.local.download', { mb: mb ?? '' })}
                </button>
                {download?.failed && (
                  <span className="download failed">{download.message ?? t('ai.local.downloadFailed')}</span>
                )}
              </>
            )}
          </div>
        )}
        {/* 못 찾음, 로그인 안 됨: 말풍선은 짧게, 설치와 로그인 단계는 그 자리에 펼친다 (#29) */}
        {guideMode && guide.subject && (
          <InlineGuide
            subject={guide.subject}
            mode={guideMode}
            platform={bridge.platform}
            checking={guide.checking}
            statusLine={guide.statusLine}
            onRecheck={guide.onRecheck}
            onLink={bridge.openLink}
          />
        )}
        {/* 한도, 설치 안 됨, 로그인 안 됨: 바로 물어볼 수 있는 다른 AI (무료 AI 포함) */}
        {m.status === 'error' &&
          (m.error?.kind === 'rate-limit' ||
            m.error?.kind === 'not-installed' ||
            m.error?.kind === 'not-logged-in') &&
          alternatives.length > 0 && (
            <div className="retry action-row">
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

/** 저장한 뒤 단추 대신 알림이 보이는 동안 (그동안 누름은 버린다) */
const FLASH_HOLD_MS = 1800;

/** 답 아래 작은 단추: 복사, 메모로, 할 일로 (v1 "답변을 메모, 할 일로") */
function AnswerActions({ id, text }: { id: string; text: string }) {
  const [done, setDone] = useState<{ msg: string; failed?: boolean }>();
  // 단추가 답마다 있어서 화면 읽기에는 어느 답의 단추인지 앞부분을 같이 읽어 준다
  const about = snippet(text);
  const flash = (msg: string, failed = false) => {
    setDone({ msg, failed });
    setTimeout(() => setDone(undefined), failed ? 2600 : FLASH_HOLD_MS);
  };
  // 두 번 눌러도(더블클릭) 메모나 할 일이 두 벌 생기지 않게: 저장 답이 오기 전 누름은 버린다
  const [toNote] = useState(() =>
    singleFlight(async () => {
      const ok = await bridge.toNote(id);
      flash(ok ? t('chat.savedNote') : t('chat.saveFailed'), !ok);
    }, FLASH_HOLD_MS),
  );
  const [toTodos] = useState(() =>
    singleFlight(async () => {
      const n = await bridge.toTodos(id);
      flash(n > 0 ? t('chat.todosAdded', { n }) : t('chat.nothingToAdd'));
    }, FLASH_HOLD_MS),
  );
  if (done) return <span className={`answer-actions shown ${done.failed ? 'failed' : ''}`}>{done.msg}</span>;
  return (
    <span className="answer-actions">
      <button
        type="button"
        aria-label={t('chat.copyLabel', { text: about })}
        onClick={async () => {
          // 창이 앞에 없거나 권한이 막히면 복사가 실패한다. 됐다고 하지 않고 못 했다고 알린다
          try {
            await navigator.clipboard.writeText(text);
            flash(t('chat.copied'));
          } catch {
            flash(t('chat.copyFailed'), true);
          }
        }}
      >
        {t('chat.copy')}
      </button>
      <button type="button" aria-label={t('chat.toNoteLabel', { text: about })} onClick={() => void toNote()}>
        {t('chat.toNote')}
      </button>
      <button
        type="button"
        title={t('chat.toTodosTitle')}
        aria-label={t('chat.toTodosLabel', { text: about })}
        onClick={() => void toTodos()}
      >
        {t('chat.toTodos')}
      </button>
    </span>
  );
}

/** 답 앞부분 (단추 이름에 붙인다). 마크다운 기호는 읽을 때 거슬려서 뺀다 */
function snippet(text: string): string {
  const plain = text
    .replace(/[#*_`>[\]()~|-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > 40 ? `${plain.slice(0, 40)}…` : plain;
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
