// 메모 편집 창의 저장 줄. 화면(NoteTab.tsx)에서 떼어 단위 시험이 되게 했다.
//
// - 저장은 한 줄로 선다: 뒤 저장은 앞 저장의 답(저장된 본문과 시각)을 받은 다음 그것을 바탕으로 보낸다.
//   겹쳐 보내면 두 번째가 첫 저장 전 바탕과 시각을 들고 가 혼자 고쳐도 "다른 곳이 먼저 고쳤다"로 거절된다.
// - 다른 곳이 먼저 고쳐 거절되면(stale) 저장된 글을 받아 두고 멈춘다. 사용자가 덮기를 고르기 전에는
//   어느 쪽도 덮지 않는다 (overwrite).

export interface NotePatch {
  title?: string;
  body?: string;
}

export interface NoteResult {
  ok: boolean;
  error?: string;
  body?: string;
  updatedAt?: number;
  stale?: boolean;
}

export interface SaverApi {
  update(patch: NotePatch, base?: { body: string; at: number }): Promise<NoteResult>;
  get(): Promise<{ body: string; updatedAt: number } | undefined>;
}

export interface SaverHooks {
  /** 저장됐다. sentBody 는 보낸 본문(없으면 제목만), stored 는 저장된 본문, merged 는 저장된 글이 보낸 글과 다르다 */
  saved(sentBody: string | undefined, stored: string, merged: boolean): void;
  /** 저장하지 못했다. conflict 면 다른 곳이 먼저 고쳐서(저장된 글을 받아 둠) 멈췄다 */
  failed(r: NoteResult, conflict: boolean): void;
  /** 다른 곳이 먼저 고친 것을 보고 있어 보내지 않았다 */
  blocked(): void;
}

export class NoteSaver {
  pending: NotePatch = {};
  /** 마지막으로 받은 저장된 본문과 그 시각 */
  base: string;
  baseAt: number;
  failed = false;
  sending = false;
  conflict: { body: string; at: number } | undefined;
  hooks: SaverHooks;
  #api: SaverApi;
  #chain: Promise<boolean> = Promise.resolve(true);

  constructor(body: string, at: number, api: SaverApi, hooks: SaverHooks) {
    this.base = body;
    this.baseAt = at;
    this.#api = api;
    this.hooks = hooks;
  }

  /** 보낼 고침에 모은다 (뒤에 쓴 것이 이긴다) */
  save(patch: NotePatch) {
    this.pending = { ...this.pending, ...patch };
  }

  /** 남은 고침을 보낸다. 앞 저장이 끝난 뒤에 간다. 저장되면 true */
  flush(): Promise<boolean> {
    const run = this.#chain.then(
      () => this.#send(),
      () => this.#send(),
    );
    this.#chain = run;
    return run;
  }

  /** 다른 곳이 먼저 고친 뒤 "내 글로 덮기"를 골랐다: 저장된 글을 바탕으로 삼는다. 이어서 flush 를 부른다 */
  overwrite() {
    const c = this.conflict;
    if (!c) return;
    this.base = c.body;
    this.baseAt = c.at;
    this.conflict = undefined;
  }

  async #send(): Promise<boolean> {
    if (Object.keys(this.pending).length === 0) return !this.failed;
    if (this.conflict) {
      this.failed = true;
      this.hooks.blocked();
      return false;
    }
    const sent = this.pending;
    this.pending = {};
    let r: NoteResult;
    this.sending = true;
    try {
      r = await this.#api.update(
        sent,
        sent.body !== undefined ? { body: this.base, at: this.baseAt } : undefined,
      );
    } catch {
      r = { ok: false };
    } finally {
      this.sending = false;
    }
    if (r.ok) {
      this.failed = false;
      if (r.updatedAt !== undefined) this.baseAt = r.updatedAt;
      const stored = r.body ?? sent.body;
      if (sent.body !== undefined && stored !== undefined) this.base = stored;
      this.hooks.saved(sent.body, stored ?? this.base, r.body !== undefined);
      return true;
    }
    this.failed = true;
    this.pending = { ...sent, ...this.pending };
    if (r.stale) {
      const n = await this.#api.get().catch(() => undefined);
      if (n) this.conflict = { body: n.body, at: n.updatedAt };
    }
    this.hooks.failed(r, this.conflict !== undefined);
    return false;
  }
}
